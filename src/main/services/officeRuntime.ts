import { randomUUID } from 'node:crypto'
import type { DashboardSnapshot, ProviderConfig, Task, TaskStatus } from '../../shared/domain'
import { OfficeDatabase } from '../database'
import type { CredentialStore } from '../security/credentials'
import { ProviderService } from './providerService'
import { TaskService } from './taskService'

export class OfficeRuntime {
  private readonly taskService: TaskService
  private readonly providerService = new ProviderService()
  private readonly controllers = new Map<string, AbortController>()
  private emergencyStopped = false
  private active = 0
  private readonly queue: Array<() => Promise<void>> = []

  constructor(private readonly database: OfficeDatabase, private readonly credentials: CredentialStore, private readonly maxConcurrency = 3) {
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

  completeOnboarding(): void { this.database.setSetting('onboardingComplete', 'true') }

  submitCommand(message: string, agentId?: string): string {
    const agent = agentId ? this.database.getAgent(agentId) : this.database.listAgents().find((item) => item.name === 'Office Manager')
    if (!agent) throw new Error('Agent not found')
    if (this.emergencyStopped) throw new Error('All agents are stopped. Resume the office before assigning work.')
    const title = message.length > 72 ? `${message.slice(0, 69)}…` : message
    const task = this.database.createTask({ title, objective: message, assignedAgentId: agent.id, parentTaskId: null, priority: 2 })
    this.enqueue(async () => this.runTask(task.id))
    return task.id
  }

  startTask(id: string): Task {
    if (this.emergencyStopped) throw new Error('All agents are stopped. Resume the office before starting work.')
    let task = this.database.getTask(id)
    if (!task) throw new Error('Task not found')
    if (!task.assignedAgentId) throw new Error('Assign an agent before starting this task')
    if (task.status === 'paused' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'completed') task = this.taskService.retry(id)
    if (task.status !== 'queued') throw new Error(`A ${task.status.replace('_', ' ')} task cannot be started`)
    this.enqueue(async () => this.runTask(id))
    return task
  }

  controlTask(id: string, status: TaskStatus): Task {
    if (status === 'running') return this.startTask(id)
    if (status === 'paused' || status === 'cancelled') {
      this.controllers.get(id)?.abort(); this.controllers.delete(id)
      const task = this.taskService.transition(id, status, status === 'paused' ? { error: 'Paused by user.' } : {})
      if (task.assignedAgentId) this.database.updateAgent(task.assignedAgentId, { status: 'idle', currentTaskId: null })
      return task
    }
    return this.taskService.transition(id, status)
  }

  async stopAll(): Promise<void> {
    this.emergencyStopped = true
    this.database.setSetting('emergencyStopped', 'true')
    this.controllers.forEach((controller) => controller.abort())
    this.controllers.clear()
    this.queue.length = 0
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

  private enqueue(job: () => Promise<void>): void { this.queue.push(job); this.drain() }

  private drain(): void {
    while (!this.emergencyStopped && this.active < this.maxConcurrency && this.queue.length) {
      const job = this.queue.shift()!
      this.active += 1
      void job().catch(() => undefined).finally(() => { this.active -= 1; this.drain() })
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.database.getTask(taskId)
    if (!task || !task.assignedAgentId) return
    const agent = this.database.getAgent(task.assignedAgentId)
    if (!agent) return
    const controller = new AbortController(); this.controllers.set(task.id, controller)
    try {
      this.taskService.transition(task.id, 'planning', { progress: 10 })
      this.database.updateAgent(agent.id, { status: 'thinking', currentTaskId: task.id })
      const provider = this.database.listProviders().find((item) => item.enabled && (item.name === agent.provider || item.type === agent.provider)) ?? this.database.listProviders().find((item) => item.enabled)
      if (!provider) throw new Error('Configure an AI provider in Settings before running this task.')
      const key = await this.credentials.get(provider.id)
      if (!key) throw new Error(`Add a credential for ${provider.name} before running this task.`)
      this.taskService.transition(task.id, 'running', { progress: 25 })
      this.database.updateAgent(agent.id, { status: 'working' })
      const memories = agent.memoryEnabled ? this.database.listMemories().filter((item) => item.agentId === agent.id).slice(0, 8) : []
      const memoryContext = memories.length ? `\nRelevant local memory:\n${memories.map((item) => `- ${item.content}`).join('\n')}` : ''
      const response = await this.providerService.complete(provider, key, [
        { role: 'system', content: `${agent.instructions}\nRole: ${agent.role}. Goal: ${agent.goal}.${memoryContext}\nReturn a clear result. Do not claim to use tools you have not actually used.` },
        { role: 'user', content: task.objective }
      ], controller.signal)
      if (this.emergencyStopped) return
      this.taskService.transition(task.id, 'completed', { result: response.content, progress: 100 })
      this.database.updateAgent(agent.id, { status: 'completed', currentTaskId: null })
      if (agent.memoryEnabled) this.database.addMemory({ agentId: agent.id, taskId: task.id, category: 'task', content: `${task.title}: ${response.content.slice(0, 4000)}` })
      setTimeout(() => { const latest = this.database.getAgent(agent.id); if (latest?.status === 'completed') this.database.updateAgent(agent.id, { status: 'idle' }) }, 2500)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected agent failure'
      const latest = this.database.getTask(task.id)
      if (latest && latest.status !== 'paused') this.taskService.transition(task.id, 'failed', { error: message })
      this.database.updateAgent(agent.id, { status: 'failed', currentTaskId: null })
    } finally { this.controllers.delete(task.id) }
  }
}
