import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OfficeDatabase } from '../src/main/database'
import { TaskService, canTransitionTask } from '../src/main/services/taskService'
import { BackupService } from '../src/main/services/backupService'

const databases: OfficeDatabase[] = []
const directories: string[] = []
const memoryDatabase = (): OfficeDatabase => { const database = new OfficeDatabase(':memory:'); databases.push(database); return database }

afterEach(() => {
  for (const database of databases.splice(0)) { try { database.close() } catch { /* already closed */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('office database', () => {
  it('initializes schema and the Office Manager', () => {
    const database = memoryDatabase()
    expect(database.db.pragma('user_version', { simple: true })).toBe(1)
    expect(database.listAgents()).toHaveLength(1)
    expect(database.listAgents()[0]?.name).toBe('Office Manager')
  })

  it('creates, edits, and archives specialist agents', () => {
    const database = memoryDatabase()
    const agent = database.createAgent({ name:'Ada', role:'Researcher', description:'Finds evidence', instructions:'Cite sources', goal:'Reliable research', avatar:'AD', color:'#123456', provider:'openai', model:'gpt-test', workspaceId:null, permissionProfile:'research', memoryEnabled:true })
    expect(database.getAgent(agent.id)?.role).toBe('Researcher')
    database.updateAgent(agent.id, { role: 'Senior Researcher' })
    expect(database.getAgent(agent.id)?.role).toBe('Senior Researcher')
    database.archiveAgent(agent.id)
    expect(database.listAgents().some((item) => item.id === agent.id)).toBe(false)
    expect(database.listAgents(true).find((item) => item.id === agent.id)?.status).toBe('offline')
  })

  it('protects the default Office Manager from archival', () => {
    const database = memoryDatabase()
    expect(() => database.archiveAgent(database.listAgents()[0]!.id)).toThrow('cannot be archived')
  })

  it('creates parent and child tasks with persistent relationships', () => {
    const database = memoryDatabase(); const agent = database.listAgents()[0]!
    const parent = database.createTask({ title:'Campaign', objective:'Prepare campaign', assignedAgentId:agent.id, parentTaskId:null, priority:3 })
    const child = database.createTask({ title:'Research', objective:'Research segment', assignedAgentId:agent.id, parentTaskId:parent.id, priority:2 })
    expect(database.getTask(child.id)?.parentTaskId).toBe(parent.id)
    expect(() => database.createTask({ title:'Bad', objective:'Invalid parent', assignedAgentId:null, parentTaskId:'22222222-2222-4222-8222-222222222222', priority:2 })).toThrow('Parent task not found')
  })

  it('enforces task state transitions and supports retry', () => {
    const database = memoryDatabase(); const service = new TaskService(database)
    const task = database.createTask({ title:'Brief', objective:'Write a brief', assignedAgentId:null, parentTaskId:null, priority:2 })
    expect(canTransitionTask('queued','running')).toBe(true)
    expect(() => service.transition(task.id, 'completed')).toThrow('cannot move')
    service.transition(task.id, 'running'); service.transition(task.id, 'failed', { error:'Provider unavailable' })
    const retried = service.retry(task.id)
    expect(retried.status).toBe('queued'); expect(retried.error).toBeNull(); expect(retried.progress).toBe(0)
  })

  it('creates and denies an approval exactly once', () => {
    const database = memoryDatabase()
    const approval = database.createApproval({ agentId:null, taskId:null, actionType:'system.execute', description:'Run report', target:'report.exe', reason:'Requires execution', payload:'{}', risk:'high' })
    expect(approval.status).toBe('pending')
    expect(database.decideApproval(approval.id,'denied').status).toBe('denied')
    expect(() => database.decideApproval(approval.id,'approved')).toThrow('already been decided')
  })

  it('indexes, searches, and deletes inspectable memory', () => {
    const database = memoryDatabase()
    const memory = database.addMemory({ agentId:null, taskId:null, category:'context', content:'Dubai commercial property outlook' })
    expect(database.listMemories('Dubai')).toHaveLength(1)
    database.deleteMemory(memory.id)
    expect(database.listMemories()).toHaveLength(0)
  })

  it('recovers interrupted tasks after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aa-office-db-')); directories.push(directory)
    const path = join(directory, 'office.sqlite'); const first = new OfficeDatabase(path)
    const task = first.createTask({ title:'Interrupted', objective:'Long work', assignedAgentId:null, parentTaskId:null, priority:2 })
    new TaskService(first).transition(task.id,'running'); first.close()
    const second = new OfficeDatabase(path); databases.push(second)
    expect(second.recoverInterruptedTasks()).toBe(1)
    expect(second.getTask(task.id)?.status).toBe('paused')
    expect(second.getTask(task.id)?.error).toContain('closed')
  })

  it('creates a consistent live SQLite backup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aa-office-backup-')); directories.push(directory)
    const database = new OfficeDatabase(join(directory, 'office.sqlite')); databases.push(database)
    database.createTask({ title:'Preserved', objective:'Keep this task', assignedAgentId:null, parentTaskId:null, priority:2 })
    const backups = new BackupService(database, join(directory, 'Backups'), 2)
    const path = await backups.create()
    const restored = new OfficeDatabase(path); databases.push(restored)
    expect(restored.listTasks().map((task) => task.title)).toContain('Preserved')
    expect(await backups.list()).toHaveLength(1)
  })
})
