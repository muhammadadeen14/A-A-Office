import { afterEach, describe, expect, it } from 'vitest'
import { OfficeDatabase } from '../src/main/database'
import { OfficeRuntime } from '../src/main/services/officeRuntime'
import type { CredentialStore } from '../src/main/security/credentials'
import type { ProviderService, ProviderResponse, ChatMessage } from '../src/main/services/providerService'
import type { ProviderConfig } from '../src/shared/domain'

const databases: OfficeDatabase[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })
const createRuntime = (): { database: OfficeDatabase; runtime: OfficeRuntime } => {
  const database = new OfficeDatabase(':memory:'); databases.push(database)
  const credentials = { get: async () => undefined } as unknown as CredentialStore
  return { database, runtime: new OfficeRuntime(database, credentials) }
}

describe('agent runtime isolation and emergency control', () => {
  it('stops queued work, pauses agents, and preserves task state', async () => {
    const { database, runtime } = createRuntime()
    const agent = database.listAgents()[0]!
    const task = database.createTask({ title:'Queued work', objective:'Wait here', assignedAgentId:agent.id, parentTaskId:null, priority:2 })
    await runtime.stopAll()
    expect(runtime.snapshot().emergencyStopped).toBe(true)
    expect(database.getTask(task.id)?.status).toBe('paused')
    expect(database.getAgent(agent.id)?.status).toBe('paused')
    expect(() => runtime.submitCommand('New work')).toThrow('stopped')
    runtime.resumeOffice()
    expect(runtime.snapshot().emergencyStopped).toBe(false)
    expect(database.getAgent(agent.id)?.status).toBe('idle')
  })

  it('contains a missing-provider failure to its assigned task', async () => {
    const { database, runtime } = createRuntime()
    const taskId = runtime.submitCommand('Prepare a concise operating brief')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(database.getTask(taskId)?.status).toBe('failed')
    expect(database.getTask(taskId)?.error).toContain('Configure an AI provider')
    expect(database.listAgents()).toHaveLength(1)
    expect(database.listActivity().some((item) => item.level === 'error')).toBe(true)
  })

  it('prevents duplicate scheduling and leaves paused work paused after cancellation', async () => {
    const database = new OfficeDatabase(':memory:'); databases.push(database); const agent = database.listAgents()[0]!
    database.saveProvider({ id:'11111111-1111-4111-8111-111111111111', name:'OpenAI', type:'openai', baseUrl:'https://example.com/v1', model:'m', hasCredential:true, enabled:true })
    const provider = { complete:async ():Promise<ProviderResponse> => new Promise(() => undefined) } as unknown as ProviderService
    const runtime = new OfficeRuntime(database,{ get:async () => 'secret' } as unknown as CredentialStore,3,provider)
    const task = database.createTask({ title:'Only once', objective:'work', assignedAgentId:agent.id, parentTaskId:null, priority:2 })
    runtime.startTask(task.id); expect(() => runtime.startTask(task.id)).toThrow('already scheduled')
    runtime.controlTask(task.id,'paused'); await new Promise((resolve) => setTimeout(resolve,10))
    expect(database.getTask(task.id)?.status).toBe('paused'); expect(database.getAgent(agent.id)?.status).toBe('idle')
  })

  it('keeps a resumed task cancellable while its previous request unwinds', async () => {
    const database = new OfficeDatabase(':memory:'); databases.push(database); const agent = database.listAgents()[0]!
    database.saveProvider({ id:'11111111-1111-4111-8111-111111111111', name:'OpenAI', type:'openai', baseUrl:'https://example.com/v1', model:'m', hasCredential:true, enabled:true })
    let aborts = 0
    const provider = { complete:async (_config:ProviderConfig,_key:string,_messages:ChatMessage[],signal?:AbortSignal):Promise<ProviderResponse> => new Promise((_resolve,reject) => {
      signal?.addEventListener('abort',() => { aborts += 1; setTimeout(() => reject(new Error('aborted')),1) },{ once:true })
    }) } as ProviderService
    const runtime = new OfficeRuntime(database,{ get:async () => 'secret' } as unknown as CredentialStore,3,provider)
    const task = database.createTask({ title:'Resume race', objective:'work', assignedAgentId:agent.id, parentTaskId:null, priority:2 })
    runtime.startTask(task.id); await new Promise((resolve) => setTimeout(resolve,5)); runtime.controlTask(task.id,'paused'); runtime.startTask(task.id)
    await new Promise((resolve) => setTimeout(resolve,10)); await runtime.stopAll()
    expect(aborts).toBe(2); expect(database.getTask(task.id)?.status).toBe('paused')
  })

  it('delegates bounded child tasks and synthesizes the Office Manager result', async () => {
    const database = new OfficeDatabase(':memory:'); databases.push(database)
    const specialistA = database.createAgent({ name:'Research', role:'Researcher', description:'Evidence', instructions:'Cite facts', goal:'Research', avatar:'R', color:'#123456', provider:'openai', model:'m', workspaceId:null, permissionProfile:'research', memoryEnabled:true })
    const specialistB = database.createAgent({ name:'Writer', role:'Writer', description:'Drafts', instructions:'Write clearly', goal:'Draft', avatar:'W', color:'#654321', provider:'openai', model:'m', workspaceId:null, permissionProfile:'standard', memoryEnabled:true })
    database.saveProvider({ id:'11111111-1111-4111-8111-111111111111', name:'OpenAI', type:'openai', baseUrl:'https://example.com/v1', model:'m', hasCredential:true, enabled:true })
    let providerActive = 0; let maxProviderActive = 0
    const provider = { complete: async (_config:ProviderConfig,_key:string,messages:ChatMessage[]):Promise<ProviderResponse> => {
      providerActive += 1; maxProviderActive = Math.max(maxProviderActive,providerActive)
      try {
        await new Promise((resolve) => setTimeout(resolve,5)); const system = messages[0]?.content ?? ''; const user = messages[1]?.content ?? ''
        if (system.includes('Return only valid JSON')) return { content:JSON.stringify({ summary:'Two-part plan', subtasks:[{ title:'Research facts', objective:'Find facts', agentId:specialistA.id },{ title:'Draft brief', objective:'Write brief', agentId:specialistB.id },{ title:'Research facts', objective:'duplicate', agentId:specialistA.id }] }), model:'m' }
        if (system.includes('Synthesize the specialist work')) return { content:'Final synthesized result', model:'m' }
        return { content:`Completed: ${user}`, model:'m' }
      } finally { providerActive -= 1 }
    } } as ProviderService
    const credentials = { get:async () => 'secret', remove:async () => undefined } as unknown as CredentialStore
    const runtime = new OfficeRuntime(database,credentials,2,provider)
    const parentId = runtime.submitCommand('Prepare a researched brief')
    for (let i=0;i<50 && database.getTask(parentId)?.status !== 'completed';i++) await new Promise((resolve) => setTimeout(resolve,10))
    const parent = database.getTask(parentId)!; const children = database.listTasks().filter((task) => task.parentTaskId === parentId)
    expect(parent).toMatchObject({ status:'completed', result:'Final synthesized result' })
    expect(children).toHaveLength(2); expect(children.every((task) => task.status === 'completed')).toBe(true); expect(maxProviderActive).toBeLessThanOrEqual(2)
  })

  it('does not retain memory when an agent has memory disabled', async () => {
    const database = new OfficeDatabase(':memory:'); databases.push(database)
    const agent = database.createAgent({ name:'Private', role:'Worker', description:'', instructions:'', goal:'', avatar:'P', color:'#123456', provider:'openai', model:'m', workspaceId:null, permissionProfile:'standard', memoryEnabled:false })
    database.saveProvider({ id:'11111111-1111-4111-8111-111111111111', name:'OpenAI', type:'openai', baseUrl:'https://example.com/v1', model:'m', hasCredential:true, enabled:true })
    const provider = { complete:async ():Promise<ProviderResponse> => ({ content:'done', model:'m' }) } as unknown as ProviderService
    const runtime = new OfficeRuntime(database,{ get:async () => 'secret' } as unknown as CredentialStore,3,provider)
    const id = runtime.submitCommand('Private task',agent.id)
    for (let i=0;i<30 && database.getTask(id)?.status !== 'completed';i++) await new Promise((resolve) => setTimeout(resolve,5))
    expect(database.listMemoriesForAgent(agent.id)).toHaveLength(0)
  })

  it('removes encrypted provider credentials and clears database metadata', async () => {
    const database = new OfficeDatabase(':memory:'); databases.push(database); let removed = ''
    database.saveProvider({ id:'11111111-1111-4111-8111-111111111111', name:'OpenAI', type:'openai', baseUrl:'https://example.com/v1', model:'m', hasCredential:true, enabled:true })
    const credentials = { remove:async (id:string) => { removed=id } } as CredentialStore
    const runtime = new OfficeRuntime(database,credentials)
    const updated = await runtime.removeProviderCredential('11111111-1111-4111-8111-111111111111')
    expect(removed).toBe(updated.id); expect(updated.hasCredential).toBe(false)
  })

  it('reassigns queued work and rejects reassignment after completion', () => {
    const { database, runtime } = createRuntime(); const specialist = database.createAgent({ name:'Assignee', role:'Worker', description:'', instructions:'', goal:'', avatar:'A', color:'#123456', provider:'openai', model:'m', workspaceId:null, permissionProfile:'standard', memoryEnabled:false })
    const task = database.createTask({ title:'Move me', objective:'work', assignedAgentId:null, parentTaskId:null, priority:2 })
    expect(runtime.reassignTask(task.id,specialist.id).assignedAgentId).toBe(specialist.id)
    database.updateTask(task.id,{ status:'completed' })
    expect(() => runtime.reassignTask(task.id,database.listAgents()[0]!.id)).toThrow('cannot be reassigned')
  })
})
