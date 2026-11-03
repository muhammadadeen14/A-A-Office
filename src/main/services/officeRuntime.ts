import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Agent, DashboardSnapshot, ProviderConfig, Task, TaskStatus } from '../../shared/domain'
import { OfficeDatabase } from '../database'
import type { CredentialStore } from '../security/credentials'
import { ProviderService, type ChatMessage, type ProviderResponse } from './providerService'
import { TaskService } from './taskService'

export class OfficeRuntime {
  private readonly taskService: TaskService
  private readonly controllers = new Map<string, AbortController>()
  private readonly scheduled = new Set<string>()
  private emergencyStopped = false
  private active = 0
  private providerActive = 0
  private readonly providerWaiters: Array<() => void> = []
  private readonly queue: Array<{ taskId: string; job: () => Promise<void> }> = []

  constructor(private readonly database: OfficeDatabase, private readonly credentials: CredentialStore, private readonly maxConcurrency = 3, private readonly providerService = new ProviderService()) {
    this.taskService = new TaskService(database)
    this.emergencyStopped = database.getSetting('emergencyStopped') === 'true'
  }

  snapshot(): DashboardSnapshot {
    return {
      agents: this.database.listAgents(), tasks: this.database.listTasks(), approvals: this.database.listApprovals(),
      activity: this.database.listActivity(), memories: this.database.listMemories(), files: this.database.listFiles(),
      providers: this.database.listProviders(), emergencyStopped: this.emergencyStopped,
      onboardingComplete: this.database.getSetting('onboardingComplete') === 'true'
    }
  }

  async saveProvider(input: { name: string; type: 'openai' | 'compatible'; baseUrl: string; model: string; apiKey?: string }): Promise<ProviderConfig> {
    const existing = this.database.listProviders().find((provider) => provider.name.toLowerCase() === input.name.toLowerCase())
    const id = existing?.id ?? randomUUID()
    if (input.apiKey) await this.credentials.set(id, input.apiKey)
    const config: ProviderConfig = { id, name: input.name, type: input.type, baseUrl: input.baseUrl, model: input.model, hasCredential: Boolean(input.apiKey) || Boolean(existing?.hasCredential), enabled: true }
    this.database.saveProvider(config)
    this.database.addActivity({ type: 'provider.saved', title: `${input.name} configured`, detail: input.model, level: 'success' })
    return config
  }

  async testProvider(id: string): Promise<void> {
    const config = this.database.listProviders().find((item) => item.id === id)
    if (!config) throw new Error('Provider not found')
    const key = await this.credentials.get(id)
    if (!key) throw new Error('No credential is stored for this provider')
    await this.providerService.test(config, key)
  }

  async removeProviderCredential(id: string): Promise<ProviderConfig> {
    const provider = this.database.listProviders().find((item) => item.id === id)
    if (!provider) throw new Error('Provider not found')
    await this.credentials.remove(id)
    const updated = this.database.clearProviderCredential(id)
    this.database.addActivity({ type:'provider.credential_removed', title:`${provider.name} credential removed`, detail:'The encrypted credential file was deleted.', level:'warning' })
    return updated
  }

  isStopped(): boolean { return this.emergencyStopped }

  completeOnboarding(): void { this.database.setSetting('onboardingComplete', 'true') }

  submitCommand(message: string, agentId?: string): string {
    const agent = agentId ? this.database.getAgent(agentId) : this.database.listAgents().find((item) => item.name === 'Office Manager')
    if (!agent) throw new Error('Agent not found')
    if (this.emergencyStopped) throw new Error('All agents are stopped. Resume the office before assigning work.')
    const title = message.length > 72 ? `${message.slice(0, 69)}…` : message
    const task = this.database.createTask({ title, objective: message, assignedAgentId: agent.id, parentTaskId: null, priority: 2 })
    this.startTask(task.id)
    return task.id
  }

  startTask(id: string): Task {
    if (this.emergencyStopped) throw new Error('All agents are stopped. Resume the office before starting work.')
    let task = this.database.getTask(id)
    if (!task) throw new Error('Task not found')
    if (!task.assignedAgentId) throw new Error('Assign an agent before starting this task')
    const assigned = this.database.getAgent(task.assignedAgentId)
    if (!assigned || assigned.archivedAt || ['paused','failed','offline'].includes(assigned.status)) throw new Error('Reassign this task to an available agent before starting it')
    if (assigned.currentTaskId && assigned.currentTaskId !== task.id) throw new Error(`${assigned.name} is already working on another task`)
    if (this.scheduled.has(id) || this.controllers.has(id)) throw new Error('This task is already scheduled or running')
    if (task.status === 'paused' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'completed') task = this.taskService.retry(id)
    if (task.status !== 'queued') throw new Error(`A ${task.status.replace('_', ' ')} task cannot be started`)
    this.scheduled.add(id)
    this.enqueue(id, async () => this.runTask(id))
    return task
  }

  controlTask(id: string, status: TaskStatus): Task {
    if (status === 'running') return this.startTask(id)
    if (status === 'paused' || status === 'cancelled') {
      this.controllers.get(id)?.abort(); this.controllers.delete(id)
      const queuedIndex = this.queue.findIndex((entry) => entry.taskId === id)
      if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1)
      this.scheduled.delete(id)
      const task = this.taskService.transition(id, status, status === 'paused' ? { error: 'Paused by user.' } : {})
      if (task.assignedAgentId) this.database.updateAgent(task.assignedAgentId, { status: 'idle', currentTaskId: null })
      return task
    }
    return this.taskService.transition(id, status)
  }

  reassignTask(id: string, agentId: string): Task {
    const agent = this.database.getAgent(agentId)
    if (!agent || agent.archivedAt) throw new Error('The selected agent is unavailable')
    let task = this.database.getTask(id)
    if (!task) throw new Error('Task not found')
    if (['planning','running','waiting_approval'].includes(task.status)) task = this.controlTask(id,'paused')
    if (!['queued','paused','failed'].includes(task.status)) throw new Error(`A ${task.status} task cannot be reassigned`)
    const updated = this.database.updateTask(id,{ assignedAgentId:agentId })
    this.database.addActivity({ agentId, taskId:id, type:'task.reassigned', title:`${task.title} reassigned`, detail:`Assigned to ${agent.name}`, level:'info' })
    return updated
  }

  controlAgent(id: string, action: 'pause' | 'resume' | 'archive' | 'delete'): Agent | undefined {
    const agent = this.database.getAgent(id)
    if (!agent) throw new Error('Agent not found')
    if (agent.name === 'Office Manager' && (action === 'archive' || action === 'delete')) throw new Error(`Office Manager cannot be ${action}d`)
    if (action === 'pause') {
      if (agent.currentTaskId) this.controlTask(agent.currentTaskId, 'paused')
      return this.database.updateAgent(id, { status:'paused', currentTaskId:null })
    }
    if (action === 'resume') {
      if (agent.status !== 'paused' && agent.status !== 'failed') throw new Error('Only paused or failed agents can be resumed')
      return this.database.updateAgent(id, { status:'idle', currentTaskId:null })
    }
    if (agent.currentTaskId) this.controlTask(agent.currentTaskId, 'cancelled')
    if (action === 'archive') { this.database.archiveAgent(id); return undefined }
    this.database.deleteAgent(id); return undefined
  }

  async stopAll(): Promise<void> {
    this.emergencyStopped = true
    this.database.setSetting('emergencyStopped', 'true')
    this.controllers.forEach((controller) => controller.abort())
    this.controllers.clear()
    this.queue.length = 0
    this.scheduled.clear()
    for (const task of this.database.listTasks().filter((item) => ['queued', 'planning', 'running', 'waiting_approval'].includes(item.status))) {
      if (task.status === 'queued') this.taskService.transition(task.id, 'paused')
      else if (task.status !== 'paused') this.taskService.transition(task.id, 'paused', { error: 'Paused by STOP ALL AGENTS.' })
    }
    for (const agent of this.database.listAgents()) this.database.updateAgent(agent.id, { status: 'paused', currentTaskId: null })
    this.database.addActivity({ type: 'emergency.stop', title: 'All agents stopped', detail: 'Active work was interrupted and preserved.', level: 'warning' })
  }

  resumeOffice(): void {
    this.emergencyStopped = false
    this.database.setSetting('emergencyStopped', 'false')
    for (const agent of this.database.listAgents()) if (agent.status === 'paused') this.database.updateAgent(agent.id, { status: 'idle' })
    this.database.addActivity({ type: 'emergency.resume', title: 'Office resumed', detail: 'New work can now be assigned.', level: 'success' })
  }

  private enqueue(taskId: string, job: () => Promise<void>): void { this.queue.push({ taskId, job }); this.drain() }

  private drain(): void {
    while (!this.emergencyStopped && this.active < this.maxConcurrency && this.queue.length) {
      const { job } = this.queue.shift()!
      this.active += 1
      void job().catch(() => undefined).finally(() => { this.active -= 1; this.drain() })
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.database.getTask(taskId)
    if (!task || !task.assignedAgentId || task.status !== 'queued') { this.scheduled.delete(taskId); return }
    const agent = this.database.getAgent(task.assignedAgentId)
    if (!agent) { this.scheduled.delete(taskId); return }
    const controller = new AbortController(); this.controllers.set(task.id, controller)
    try {
      this.taskService.transition(task.id, 'planning', { progress: 10 })
      const latestAgent = this.database.getAgent(agent.id)
      if (!latestAgent || latestAgent.archivedAt || ['paused','failed','offline'].includes(latestAgent.status)) throw new Error('The assigned agent is unavailable')
      if (latestAgent.currentTaskId && latestAgent.currentTaskId !== task.id) throw new Error(`${latestAgent.name} is already working on another task`)
      this.database.updateAgent(agent.id, { status: 'thinking', currentTaskId: task.id })
      const provider = this.database.listProviders().find((item) => item.enabled && (item.name === agent.provider || item.type === agent.provider)) ?? this.database.listProviders().find((item) => item.enabled)
      if (!provider) throw new Error('Configure an AI provider in Settings before running this task.')
      const key = await this.credentials.get(provider.id)
      if (!key) throw new Error(`Add a credential for ${provider.name} before running this task.`)
      if (controller.signal.aborted || this.emergencyStopped) return
      this.taskService.transition(task.id, 'running', { progress: 25 })
      this.database.updateAgent(agent.id, { status: 'working' })
      if (agent.name === 'Office Manager' && !task.parentTaskId && this.database.listAgents().some((item) => item.id !== agent.id)) {
        await this.runManagerTask(task, agent, provider, key, controller)
        return
      }
      const memories = agent.memoryEnabled ? this.database.listMemoriesForAgent(agent.id) : []
      const memoryContext = memories.length ? `\nRelevant local memory:\n${memories.map((item) => `- ${item.content}`).join('\n')}` : ''
      const response = await this.completeProvider(provider, key, [
        { role: 'system', content: `${agent.instructions}\nRole: ${agent.role}. Goal: ${agent.goal}.${memoryContext}\nReturn a clear result. Do not claim to use tools you have not actually used.` },
        { role: 'user', content: task.objective }
      ], controller.signal)
      if (controller.signal.aborted || this.emergencyStopped) return
      this.completeAgentTask(task,agent,response.content)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected agent failure'
      const latest = this.database.getTask(task.id)
      if (this.controllers.get(task.id) === controller && latest && ['planning','running','waiting_approval'].includes(latest.status)) {
        this.taskService.transition(task.id, 'failed', { error: message })
        this.database.updateAgent(agent.id, { status: 'failed', currentTaskId: null })
      }
    } finally {
      if (this.controllers.get(task.id) === controller) {
        this.controllers.delete(task.id)
        this.scheduled.delete(task.id)
      }
    }
  }

  private async runManagerTask(task: Task, manager: Agent, provider: ProviderConfig, key: string, controller: AbortController): Promise<void> {
    const specialists = this.database.listAgents().filter((agent) => agent.id !== manager.id && agent.status !== 'offline')
    const roster = specialists.map(({ id, name, role, description }) => ({ id, name, role, description }))
    const planning = await this.completeProvider(provider, key, [
      { role:'system', content:'You are Office Manager. Return only valid JSON matching {"summary":"string","subtasks":[{"title":"string","objective":"string","agentId":"uuid"}]}. Use only listed agent IDs, create at most 4 independent subtasks, and use an empty subtask list when delegation adds no value.' },
      { role:'user', content:`Objective: ${task.objective}\nAvailable specialists: ${JSON.stringify(roster)}` }
    ], controller.signal)
    if (controller.signal.aborted || this.emergencyStopped) return
    const plan = parseManagerPlan(planning.content, new Set(specialists.map((agent) => agent.id)))
    if (!plan || plan.subtasks.length === 0) {
      const response = await this.completeProvider(provider, key, [
        { role:'system', content:`${manager.instructions}\nRole: ${manager.role}. Goal: ${manager.goal}. Return a clear result and disclose uncertainty.` },
        { role:'user', content:task.objective }
      ], controller.signal)
      this.completeAgentTask(task, manager, response.content)
      return
    }
    const children = plan.subtasks.map((subtask) => this.database.createTask({ title:subtask.title, objective:subtask.objective, assignedAgentId:subtask.agentId, parentTaskId:task.id, priority:task.priority }))
    this.database.updateTask(task.id, { progress:35 })
    const childConcurrency = Math.max(1, Math.min(3, this.maxConcurrency - 1))
    for (let index = 0; index < children.length; index += childConcurrency) {
      if (controller.signal.aborted || this.emergencyStopped) return
      await Promise.all(children.slice(index, index + childConcurrency).map((child) => this.runTask(child.id)))
    }
    if (controller.signal.aborted || this.emergencyStopped) return
    this.database.updateTask(task.id, { progress:75 })
    const results = children.map((child) => {
      const current = this.database.getTask(child.id)!
      const owner = this.database.getAgent(current.assignedAgentId ?? '')
      return { title:current.title, agent:owner?.name ?? 'Unknown', status:current.status, result:current.result, error:current.error }
    })
    const synthesis = await this.completeProvider(provider, key, [
      { role:'system', content:'You are Office Manager. Synthesize the specialist work into one complete, accurate final result. Identify failed or missing work clearly. Do not invent tool use or evidence.' },
      { role:'user', content:`Original objective: ${task.objective}\nPlan: ${plan.summary}\nSpecialist results: ${JSON.stringify(results)}` }
    ], controller.signal)
    if (controller.signal.aborted || this.emergencyStopped) return
    this.completeAgentTask(task, manager, synthesis.content)
  }

  private completeAgentTask(task: Task, agent: Agent, content: string): void {
    this.taskService.transition(task.id, 'completed', { result:content, progress:100 })
    this.database.updateAgent(agent.id, { status:'completed', currentTaskId:null })
    if (agent.memoryEnabled) this.database.addMemory({ agentId:agent.id, taskId:task.id, category:'task', content:`${task.title}: ${content.slice(0, 4000)}` })
    const timer = setTimeout(() => {
      try { const latest = this.database.getAgent(agent.id); if (latest?.status === 'completed') this.database.updateAgent(agent.id,{ status:'idle' }) }
      catch { /* The database may already be closed during application shutdown. */ }
    },2500)
    timer.unref()
  }

  private async completeProvider(config: ProviderConfig, key: string, messages: ChatMessage[], signal: AbortSignal): Promise<ProviderResponse> {
    await this.acquireProviderSlot()
    try {
      if (this.emergencyStopped || signal.aborted) throw new Error('Agent work was stopped')
      return await this.providerService.complete(config,key,messages,signal)
    } finally {
      this.providerActive -= 1
      this.providerWaiters.shift()?.()
    }
  }

  private async acquireProviderSlot(): Promise<void> {
    if (this.providerActive >= this.maxConcurrency) await new Promise<void>((resolve) => this.providerWaiters.push(resolve))
    this.providerActive += 1
  }
}

const managerPlanSchema = z.object({
  summary:z.string().max(4000),
  subtasks:z.array(z.object({ title:z.string().trim().min(1).max(200), objective:z.string().trim().min(1).max(20_000), agentId:z.string().uuid() })).max(4)
})

const parseManagerPlan = (content: string, allowedAgentIds: Set<string>): z.output<typeof managerPlanSchema> | undefined => {
  try {
    const start = content.indexOf('{'); const end = content.lastIndexOf('}')
    if (start < 0 || end <= start) return undefined
    const plan = managerPlanSchema.parse(JSON.parse(content.slice(start, end + 1)))
    const seen = new Set<string>()
    plan.subtasks = plan.subtasks.filter((task) => {
      const title = task.title.toLowerCase()
      if (!allowedAgentIds.has(task.agentId) || seen.has(title)) return false
      seen.add(title)
      return true
    })
    return plan
  } catch { return undefined }
}
