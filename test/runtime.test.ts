import { afterEach, describe, expect, it } from 'vitest'
import { OfficeDatabase } from '../src/main/database'
import { OfficeRuntime } from '../src/main/services/officeRuntime'
import type { CredentialStore } from '../src/main/security/credentials'

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
})
