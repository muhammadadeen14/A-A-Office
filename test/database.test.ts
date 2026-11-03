import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OfficeDatabase } from '../src/main/database'
import { TaskService, canTransitionTask } from '../src/main/services/taskService'
import { BackupService } from '../src/main/services/backupService'
import Database from 'better-sqlite3'

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
    expect(database.db.pragma('user_version', { simple: true })).toBe(2)
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
    expect(() => database.createTask({ title:'Unavailable', objective:'Do not assign', assignedAgentId:agent.id, parentTaskId:null, priority:2 })).toThrow('unavailable')
  })

  it('protects the default Office Manager from archival', () => {
    const database = memoryDatabase()
    const manager = database.listAgents()[0]!
    expect(() => database.archiveAgent(manager.id)).toThrow('cannot be archived')
    expect(() => database.updateAgent(manager.id,{ name:'Renamed' })).toThrow('cannot be renamed')
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

  it('supports the full approval-gated task state path', () => {
    const database = memoryDatabase(); const service = new TaskService(database)
    const task = database.createTask({ title:'Approval flow', objective:'controlled action', assignedAgentId:null, parentTaskId:null, priority:2 })
    service.transition(task.id,'planning'); service.transition(task.id,'waiting_approval'); service.transition(task.id,'running'); const completed = service.transition(task.id,'completed',{ result:'done' })
    expect(completed).toMatchObject({ status:'completed', progress:100, result:'done' })
    expect(completed.startedAt).not.toBeNull(); expect(completed.completedAt).not.toBeNull()
  })

  it('creates and denies an approval exactly once', () => {
    const database = memoryDatabase()
    const approval = database.createApproval({ agentId:null, taskId:null, actionType:'system.execute', description:'Run report', target:'report.exe', reason:'Requires execution', payload:'{}', risk:'high' })
    expect(approval.status).toBe('pending')
    expect(database.decideApproval(approval.id,'denied').status).toBe('denied')
    expect(database.getApproval(approval.id)?.executionStatus).toBe('not_applicable')
    expect(() => database.decideApproval(approval.id,'approved')).toThrow('already been decided')
  })

  it('migrates an existing version-one database without losing approvals', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aa-office-migration-')); directories.push(directory); const path = join(directory,'office.sqlite')
    const legacy = new Database(path)
    legacy.exec(`CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',instructions TEXT NOT NULL DEFAULT '',goal TEXT NOT NULL DEFAULT '',avatar TEXT NOT NULL DEFAULT 'OA',color TEXT NOT NULL DEFAULT '#5B7CFA',provider TEXT NOT NULL DEFAULT 'openai',model TEXT NOT NULL DEFAULT 'm',workspace_id TEXT,permission_profile TEXT NOT NULL DEFAULT 'standard',memory_enabled INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'idle',current_task_id TEXT,archived_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,objective TEXT NOT NULL,assigned_agent_id TEXT,parent_task_id TEXT,status TEXT NOT NULL DEFAULT 'queued',priority INTEGER NOT NULL DEFAULT 2,progress INTEGER NOT NULL DEFAULT 0,result TEXT,error TEXT,created_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,updated_at TEXT NOT NULL); CREATE TABLE approvals(id TEXT PRIMARY KEY,agent_id TEXT,task_id TEXT,action_type TEXT NOT NULL,description TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,payload TEXT NOT NULL,risk TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,decided_at TEXT); CREATE TABLE activity_events(id TEXT PRIMARY KEY,agent_id TEXT,task_id TEXT,type TEXT NOT NULL,title TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',level TEXT NOT NULL DEFAULT 'info',created_at TEXT NOT NULL); CREATE TABLE memories(id TEXT PRIMARY KEY,agent_id TEXT,task_id TEXT,category TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL); CREATE VIRTUAL TABLE memory_search USING fts5(memory_id UNINDEXED,content); CREATE TABLE managed_files(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL UNIQUE,mime TEXT NOT NULL,size INTEGER NOT NULL DEFAULT 0,agent_id TEXT,task_id TEXT,created_at TEXT NOT NULL); CREATE TABLE provider_configs(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,has_credential INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 1); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;`)
    legacy.prepare("INSERT INTO approvals VALUES ('a',NULL,NULL,'test','Legacy','target','reason','{}','low','pending','2026-01-01',NULL)").run(); legacy.close()
    const migrated = new OfficeDatabase(path); databases.push(migrated)
    expect(migrated.db.pragma('user_version',{ simple:true })).toBe(2)
    expect(migrated.getApproval('a')?.executionStatus).toBe('not_applicable')
  })

  it('indexes, searches, and deletes inspectable memory', () => {
    const database = memoryDatabase()
    const memory = database.addMemory({ agentId:null, taskId:null, category:'context', content:'Dubai commercial property outlook' })
    expect(database.listMemories('Dubai')).toHaveLength(1)
    database.deleteMemory(memory.id)
    expect(database.listMemories()).toHaveLength(0)
  })

  it('keeps agent-scoped memory isolated', () => {
    const database = memoryDatabase(); const base = { role:'Worker', description:'', instructions:'', goal:'', avatar:'A', color:'#123456', provider:'openai', model:'m', workspaceId:null, permissionProfile:'standard' as const, memoryEnabled:true }
    const first = database.createAgent({ ...base, name:'First' }); const second = database.createAgent({ ...base, name:'Second' })
    database.addMemory({ agentId:first.id, taskId:null, category:'agent', content:'private first context' }); database.addMemory({ agentId:second.id, taskId:null, category:'agent', content:'private second context' })
    expect(database.listMemoriesForAgent(first.id).map((item) => item.content)).toEqual(['private first context'])
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

  it('restores an integrity-checked backup and preserves a safety copy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aa-office-restore-')); directories.push(directory); const path = join(directory,'office.sqlite')
    const database = new OfficeDatabase(path); databases.push(database); const backups = new BackupService(database,join(directory,'Backups'),3)
    database.createTask({ title:'Before backup', objective:'preserved', assignedAgentId:null, parentTaskId:null, priority:2 }); const backupPath = await backups.create()
    database.createTask({ title:'After backup', objective:'removed by restore', assignedAgentId:null, parentTaskId:null, priority:2 })
    await backups.restore(backupPath)
    const restored = new OfficeDatabase(path); databases.push(restored)
    expect(restored.listTasks().map((task) => task.title)).toContain('Before backup')
    expect(restored.listTasks().map((task) => task.title)).not.toContain('After backup')
    expect((await new BackupService(restored,join(directory,'Backups'),3).list()).length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a corrupted backup without closing the live database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aa-office-corrupt-')); directories.push(directory); const path = join(directory,'office.sqlite')
    const database = new OfficeDatabase(path); databases.push(database); const backupDirectory = join(directory,'Backups'); const backups = new BackupService(database,backupDirectory)
    mkdirSync(backupDirectory,{ recursive:true }); writeFileSync(join(backupDirectory,'broken.sqlite'),'not a database')
    await expect(backups.restore(join(backupDirectory,'broken.sqlite'))).rejects.toThrow()
    expect(database.listAgents()[0]?.name).toBe('Office Manager')
  })

  it('deletes unused agents but preserves agents with audit history', () => {
    const database = memoryDatabase(); const input = { name:'Disposable', role:'Temp', description:'', instructions:'', goal:'', avatar:'DP', color:'#123456', provider:'openai', model:'m', workspaceId:null, permissionProfile:'standard' as const, memoryEnabled:false }
    const unused = database.createAgent(input); database.deleteAgent(unused.id); expect(database.getAgent(unused.id)).toBeUndefined()
    const used = database.createAgent({ ...input, name:'Used' }); database.createTask({ title:'History', objective:'keep', assignedAgentId:used.id, parentTaskId:null, priority:2 })
    expect(() => database.deleteAgent(used.id)).toThrow('Archive it instead')
  })
})
