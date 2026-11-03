import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ActivityEvent, Agent, AgentInput, Approval, ManagedFile, MemoryRecord, ProviderConfig, Task, TaskInput } from '../shared/domain'

type Sqlite = Database.Database
const now = (): string => new Date().toISOString()

export class OfficeDatabase {
  readonly db: Sqlite

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
    this.seed()
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE agents (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          instructions TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT 'OA',
          color TEXT NOT NULL DEFAULT '#5B7CFA', provider TEXT NOT NULL DEFAULT 'openai', model TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
          workspace_id TEXT, permission_profile TEXT NOT NULL DEFAULT 'standard', memory_enabled INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'idle', current_task_id TEXT, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, objective TEXT NOT NULL, assigned_agent_id TEXT REFERENCES agents(id),
          parent_task_id TEXT REFERENCES tasks(id), status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 2,
          progress INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT,
          completed_at TEXT, updated_at TEXT NOT NULL
        );
        CREATE TABLE approvals (
          id TEXT PRIMARY KEY, agent_id TEXT REFERENCES agents(id), task_id TEXT REFERENCES tasks(id), action_type TEXT NOT NULL,
          description TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, payload TEXT NOT NULL,
          risk TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT
        );
        CREATE TABLE activity_events (
          id TEXT PRIMARY KEY, agent_id TEXT, task_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT 'info', created_at TEXT NOT NULL
        );
        CREATE TABLE memories (
          id TEXT PRIMARY KEY, agent_id TEXT, task_id TEXT, category TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE memory_search USING fts5(memory_id UNINDEXED, content);
        CREATE TABLE managed_files (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, mime TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0, agent_id TEXT, task_id TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE provider_configs (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL,
          has_credential INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX tasks_status_idx ON tasks(status);
        CREATE INDEX approvals_status_idx ON approvals(status);
        CREATE INDEX activity_created_idx ON activity_events(created_at DESC);
        PRAGMA user_version = 1;
      `)
    }
  }

  private seed(): void {
    const count = this.db.prepare('SELECT COUNT(*) count FROM agents').get() as { count: number }
    if (count.count === 0) {
      const timestamp = now()
      this.db.prepare(`INSERT INTO agents
        (id,name,role,description,instructions,goal,avatar,color,provider,model,workspace_id,permission_profile,memory_enabled,status,current_task_id,archived_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(), 'Office Manager', 'Chief AI Orchestrator',
        'Plans work, delegates to specialists, reviews their output, and reports one clear result.',
        'Break objectives into bounded tasks. Delegate only when useful. Never bypass permissions or approvals. Synthesize results and disclose uncertainty.',
        'Turn the user’s objectives into safe, traceable, completed work.', 'OM', '#5B7CFA', 'openai', 'gpt-4.1-mini', null,
        'standard', 1, 'idle', null, null, timestamp, timestamp
      )
      this.addActivity({ type: 'system', title: 'Office initialized', detail: 'Office Manager is ready for provider setup.', level: 'success' })
    }
  }

  close(): void { this.db.close() }

  listAgents(includeArchived = false): Agent[] {
    const rows = this.db.prepare(`SELECT * FROM agents ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at`).all() as Record<string, unknown>[]
    return rows.map(mapAgent)
  }

  getAgent(id: string): Agent | undefined {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? mapAgent(row) : undefined
  }

  createAgent(input: Required<AgentInput>): Agent {
    const id = randomUUID(); const timestamp = now()
    this.db.prepare(`INSERT INTO agents
      (id,name,role,description,instructions,goal,avatar,color,provider,model,workspace_id,permission_profile,memory_enabled,status,current_task_id,archived_at,created_at,updated_at)
      VALUES (@id,@name,@role,@description,@instructions,@goal,@avatar,@color,@provider,@model,@workspaceId,@permissionProfile,@memoryEnabled,'idle',NULL,NULL,@createdAt,@updatedAt)`)
      .run({ ...input, id, memoryEnabled: input.memoryEnabled ? 1 : 0, createdAt: timestamp, updatedAt: timestamp })
    this.addActivity({ agentId: id, type: 'agent.created', title: `${input.name} joined the office`, detail: input.role, level: 'success' })
    return this.getAgent(id)!
  }

  updateAgent(id: string, changes: Partial<Agent>): Agent {
    const current = this.getAgent(id)
    if (!current) throw new Error('Agent not found')
    const next = { ...current, ...changes, id, updatedAt: now() }
    this.db.prepare(`UPDATE agents SET name=@name,role=@role,description=@description,instructions=@instructions,goal=@goal,
      avatar=@avatar,color=@color,provider=@provider,model=@model,workspace_id=@workspaceId,permission_profile=@permissionProfile,
      memory_enabled=@memoryEnabled,status=@status,current_task_id=@currentTaskId,archived_at=@archivedAt,updated_at=@updatedAt WHERE id=@id`)
      .run({ ...next, memoryEnabled: next.memoryEnabled ? 1 : 0 })
    return this.getAgent(id)!
  }

  archiveAgent(id: string): void {
    const agent = this.getAgent(id)
    if (!agent) throw new Error('Agent not found')
    if (agent.name === 'Office Manager') throw new Error('Office Manager cannot be archived')
    this.updateAgent(id, { archivedAt: now(), status: 'offline' })
    this.addActivity({ agentId: id, type: 'agent.archived', title: `${agent.name} archived`, level: 'warning' })
  }

  listTasks(): Task[] {
    return (this.db.prepare('SELECT * FROM tasks ORDER BY priority DESC, created_at DESC').all() as Record<string, unknown>[]).map(mapTask)
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? mapTask(row) : undefined
  }

  createTask(input: Required<TaskInput>): Task {
    if (input.parentTaskId && !this.getTask(input.parentTaskId)) throw new Error('Parent task not found')
    if (input.assignedAgentId && !this.getAgent(input.assignedAgentId)) throw new Error('Assigned agent not found')
    const id = randomUUID(); const timestamp = now()
    this.db.prepare(`INSERT INTO tasks
      (id,title,objective,assigned_agent_id,parent_task_id,status,priority,progress,result,error,created_at,started_at,completed_at,updated_at)
      VALUES (?,?,?,?,?,'queued',?,0,NULL,NULL,?,NULL,NULL,?)`)
      .run(id, input.title, input.objective, input.assignedAgentId, input.parentTaskId, input.priority, timestamp, timestamp)
    this.addActivity({ agentId: input.assignedAgentId, taskId: id, type: 'task.created', title: input.title, detail: 'Task queued', level: 'info' })
    return this.getTask(id)!
  }

  updateTask(id: string, changes: Partial<Task>): Task {
    const current = this.getTask(id)
    if (!current) throw new Error('Task not found')
    const next = { ...current, ...changes, id, updatedAt: now() }
    this.db.prepare(`UPDATE tasks SET title=@title,objective=@objective,assigned_agent_id=@assignedAgentId,parent_task_id=@parentTaskId,
      status=@status,priority=@priority,progress=@progress,result=@result,error=@error,started_at=@startedAt,
      completed_at=@completedAt,updated_at=@updatedAt WHERE id=@id`).run(next)
    return this.getTask(id)!
  }

  listApprovals(): Approval[] {
    return (this.db.prepare("SELECT * FROM approvals ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC").all() as Record<string, unknown>[]).map(mapApproval)
  }

  createApproval(input: Omit<Approval, 'id' | 'status' | 'createdAt' | 'decidedAt'>): Approval {
    const id = randomUUID(); const createdAt = now()
    this.db.prepare(`INSERT INTO approvals (id,agent_id,task_id,action_type,description,target,reason,payload,risk,status,created_at,decided_at)
      VALUES (@id,@agentId,@taskId,@actionType,@description,@target,@reason,@payload,@risk,'pending',@createdAt,NULL)`)
      .run({ ...input, id, createdAt })
    this.addActivity({ agentId: input.agentId, taskId: input.taskId, type: 'approval.requested', title: input.description, detail: input.target, level: 'warning' })
    return this.listApprovals().find((item) => item.id === id)!
  }

  decideApproval(id: string, status: 'approved' | 'denied'): Approval {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error('Approval not found')
    const approval = mapApproval(row)
    if (approval.status !== 'pending') throw new Error('Approval has already been decided')
    this.db.prepare('UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?').run(status, now(), id)
    this.addActivity({ agentId: approval.agentId, taskId: approval.taskId, type: `approval.${status}`, title: `${status === 'approved' ? 'Approved' : 'Denied'}: ${approval.description}`, detail: approval.target, level: status === 'approved' ? 'success' : 'warning' })
    return this.listApprovals().find((item) => item.id === id)!
  }

  addActivity(event: { agentId?: string | null; taskId?: string | null; type: string; title: string; detail?: string; level: ActivityEvent['level'] }): ActivityEvent {
    const item: ActivityEvent = { id: randomUUID(), agentId: event.agentId ?? null, taskId: event.taskId ?? null, type: event.type, title: event.title, detail: event.detail ?? '', level: event.level, createdAt: now() }
    this.db.prepare('INSERT INTO activity_events (id,agent_id,task_id,type,title,detail,level,created_at) VALUES (@id,@agentId,@taskId,@type,@title,@detail,@level,@createdAt)').run(item)
    return item
  }

  listActivity(limit = 200): ActivityEvent[] {
    return (this.db.prepare('SELECT * FROM activity_events ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map(mapActivity)
  }

  addMemory(input: Omit<MemoryRecord, 'id' | 'createdAt'>): MemoryRecord {
    const item: MemoryRecord = { ...input, id: randomUUID(), createdAt: now() }
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO memories (id,agent_id,task_id,category,content,created_at) VALUES (@id,@agentId,@taskId,@category,@content,@createdAt)').run(item)
      this.db.prepare('INSERT INTO memory_search (memory_id,content) VALUES (?,?)').run(item.id, item.content)
    })()
    return item
  }

  listMemories(query = ''): MemoryRecord[] {
    const sql = query
      ? `SELECT m.* FROM memories m JOIN memory_search s ON s.memory_id=m.id WHERE memory_search MATCH ? ORDER BY m.created_at DESC LIMIT 200`
      : 'SELECT * FROM memories ORDER BY created_at DESC LIMIT 200'
    return (this.db.prepare(sql).all(...(query ? [query.replace(/['"]/g, '')] : [])) as Record<string, unknown>[]).map(mapMemory)
  }

  deleteMemory(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM memory_search WHERE memory_id=?').run(id)
      this.db.prepare('DELETE FROM memories WHERE id=?').run(id)
    })()
  }

  listFiles(): ManagedFile[] {
    return (this.db.prepare('SELECT * FROM managed_files ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(mapFile)
  }

  addFile(file: Omit<ManagedFile, 'id' | 'createdAt'>): ManagedFile {
    const item = { ...file, id: randomUUID(), createdAt: now() }
    this.db.prepare('INSERT OR REPLACE INTO managed_files (id,name,path,mime,size,agent_id,task_id,created_at) VALUES (@id,@name,@path,@mime,@size,@agentId,@taskId,@createdAt)').run(item)
    return item
  }

  listProviders(): ProviderConfig[] {
    return (this.db.prepare('SELECT * FROM provider_configs ORDER BY name').all() as Record<string, unknown>[]).map(mapProvider)
  }

  saveProvider(provider: ProviderConfig): void {
    this.db.prepare(`INSERT INTO provider_configs (id,name,type,base_url,model,has_credential,enabled)
      VALUES (@id,@name,@type,@baseUrl,@model,@hasCredential,@enabled)
      ON CONFLICT(id) DO UPDATE SET name=@name,type=@type,base_url=@baseUrl,model=@model,has_credential=@hasCredential,enabled=@enabled`)
      .run({ ...provider, hasCredential: provider.hasCredential ? 1 : 0, enabled: provider.enabled ? 1 : 0 })
  }

  getSetting(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
  }

  recoverInterruptedTasks(): number {
    const result = this.db.prepare(`UPDATE tasks SET status='paused', error='Application closed while this task was active. Review and resume when ready.', updated_at=? WHERE status IN ('planning','running','waiting_approval')`).run(now())
    this.db.prepare(`UPDATE agents SET status='idle', current_task_id=NULL, updated_at=? WHERE status NOT IN ('offline','paused')`).run(now())
    if (result.changes > 0) this.addActivity({ type: 'recovery', title: `${result.changes} interrupted task${result.changes === 1 ? '' : 's'} recovered`, detail: 'Tasks were paused for review.', level: 'warning' })
    return result.changes
  }
}

const s = (r: Record<string, unknown>, key: string): string => String(r[key])
const nullable = (r: Record<string, unknown>, key: string): string | null => r[key] == null ? null : String(r[key])
const mapAgent = (r: Record<string, unknown>): Agent => ({ id:s(r,'id'),name:s(r,'name'),role:s(r,'role'),description:s(r,'description'),instructions:s(r,'instructions'),goal:s(r,'goal'),avatar:s(r,'avatar'),color:s(r,'color'),provider:s(r,'provider'),model:s(r,'model'),workspaceId:nullable(r,'workspace_id'),permissionProfile:s(r,'permission_profile') as Agent['permissionProfile'],memoryEnabled:Boolean(r.memory_enabled),status:s(r,'status') as Agent['status'],currentTaskId:nullable(r,'current_task_id'),archivedAt:nullable(r,'archived_at'),createdAt:s(r,'created_at'),updatedAt:s(r,'updated_at') })
const mapTask = (r: Record<string, unknown>): Task => ({ id:s(r,'id'),title:s(r,'title'),objective:s(r,'objective'),assignedAgentId:nullable(r,'assigned_agent_id'),parentTaskId:nullable(r,'parent_task_id'),status:s(r,'status') as Task['status'],priority:Number(r.priority),progress:Number(r.progress),result:nullable(r,'result'),error:nullable(r,'error'),createdAt:s(r,'created_at'),startedAt:nullable(r,'started_at'),completedAt:nullable(r,'completed_at'),updatedAt:s(r,'updated_at') })
const mapApproval = (r: Record<string, unknown>): Approval => ({ id:s(r,'id'),agentId:nullable(r,'agent_id'),taskId:nullable(r,'task_id'),actionType:s(r,'action_type'),description:s(r,'description'),target:s(r,'target'),reason:s(r,'reason'),payload:s(r,'payload'),risk:s(r,'risk') as Approval['risk'],status:s(r,'status') as Approval['status'],createdAt:s(r,'created_at'),decidedAt:nullable(r,'decided_at') })
const mapActivity = (r: Record<string, unknown>): ActivityEvent => ({ id:s(r,'id'),agentId:nullable(r,'agent_id'),taskId:nullable(r,'task_id'),type:s(r,'type'),title:s(r,'title'),detail:s(r,'detail'),level:s(r,'level') as ActivityEvent['level'],createdAt:s(r,'created_at') })
const mapMemory = (r: Record<string, unknown>): MemoryRecord => ({ id:s(r,'id'),agentId:nullable(r,'agent_id'),taskId:nullable(r,'task_id'),category:s(r,'category') as MemoryRecord['category'],content:s(r,'content'),createdAt:s(r,'created_at') })
const mapFile = (r: Record<string, unknown>): ManagedFile => ({ id:s(r,'id'),name:s(r,'name'),path:s(r,'path'),mime:s(r,'mime'),size:Number(r.size),agentId:nullable(r,'agent_id'),taskId:nullable(r,'task_id'),createdAt:s(r,'created_at') })
const mapProvider = (r: Record<string, unknown>): ProviderConfig => ({ id:s(r,'id'),name:s(r,'name'),type:s(r,'type') as ProviderConfig['type'],baseUrl:s(r,'base_url'),model:s(r,'model'),hasCredential:Boolean(r.has_credential),enabled:Boolean(r.enabled) })
