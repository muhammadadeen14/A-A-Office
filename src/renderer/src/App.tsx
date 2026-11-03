import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, AlertTriangle, Archive, Bot, Brain, BriefcaseBusiness, Check, ChevronRight, CircleStop,
  FileText, FolderOpen, LayoutDashboard, MemoryStick, MessageSquareText, Moon, Pause, Play, Plus,
  RefreshCw, Search, Settings, ShieldCheck, Sparkles, Sun, Users, X, Zap
} from 'lucide-react'
import type { Agent, AgentInput, Approval, DashboardSnapshot, NavigationSection, ProviderInput, Task, TaskInput } from '../../shared/domain'

const emptySnapshot: DashboardSnapshot = { agents: [], tasks: [], approvals: [], activity: [], memories: [], files: [], providers: [], emergencyStopped: false, onboardingComplete: false }
type Toast = { id: number; text: string; tone: 'success' | 'error' | 'info' }

const nav: Array<{ id: NavigationSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'office', label: 'Office', icon: LayoutDashboard }, { id: 'agents', label: 'Agents', icon: Users },
  { id: 'tasks', label: 'Tasks', icon: BriefcaseBusiness }, { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { id: 'files', label: 'Files', icon: FolderOpen }, { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'activity', label: 'Activity', icon: Activity }, { id: 'settings', label: 'Settings', icon: Settings }
]

export default function App(): ReactNode {
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const [section, setSection] = useState<NavigationSection>('office')
  const [loading, setLoading] = useState(true)
  const [dark, setDark] = useState(true)
  const [agentModal, setAgentModal] = useState(false)
  const [taskModal, setTaskModal] = useState(false)
  const [onboarding, setOnboarding] = useState(false)
  const [search, setSearch] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now(); setToasts((items) => [...items, { id, text, tone }])
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3500)
  }, [])

  const refresh = useCallback(async (quiet = false) => {
    const result = await window.office.snapshot()
    if (result.ok && result.data) { setSnapshot(result.data); setOnboarding(!result.data.onboardingComplete); if (!quiet) setLoading(false) }
    else { toast(result.error ?? 'Could not load office data', 'error'); setLoading(false) }
  }, [toast])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const timer = setInterval(() => void refresh(true), 2500)
    return () => clearInterval(timer)
  }, [refresh])

  const pending = snapshot.approvals.filter((item) => item.status === 'pending').length
  const active = snapshot.tasks.filter((item) => ['planning', 'running', 'waiting_approval'].includes(item.status)).length
  const execute = async (call: Promise<{ ok: boolean; error?: string }>, success: string): Promise<boolean> => {
    const result = await call
    if (!result.ok) { toast(result.error ?? 'Action failed', 'error'); return false }
    toast(success, 'success'); await refresh(true); return true
  }

  const content = useMemo(() => {
    const props = { snapshot, refresh, toast, search }
    switch (section) {
      case 'office': return <OfficePage {...props} onNewTask={() => setTaskModal(true)} />
      case 'agents': return <AgentsPage {...props} onNew={() => setAgentModal(true)} />
      case 'tasks': return <TasksPage {...props} onNew={() => setTaskModal(true)} />
      case 'approvals': return <ApprovalsPage {...props} />
      case 'files': return <FilesPage {...props} />
      case 'memory': return <MemoryPage {...props} />
      case 'activity': return <ActivityPage {...props} />
      case 'settings': return <SettingsPage {...props} dark={dark} setDark={setDark} />
    }
  }, [section, snapshot, refresh, toast, search, dark])

  if (loading) return <div className="boot"><div className="brand-mark"><Sparkles size={24} /></div><strong>A&A Office</strong><span>Opening your office…</span></div>

  return <div className={dark ? 'app dark' : 'app light'}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={20} /></div><div><b>A&A Office</b><small>AI operations center</small></div></div>
      <nav>{nav.map((item) => <button className={section === item.id ? 'active' : ''} key={item.id} onClick={() => setSection(item.id)}>
        <item.icon size={18} /><span>{item.label}</span>{item.id === 'approvals' && pending > 0 && <em>{pending}</em>}
      </button>)}</nav>
      <div className="sidebar-status"><span className={snapshot.emergencyStopped ? 'status-dot stopped' : 'status-dot'} />
        <div><b>{snapshot.emergencyStopped ? 'Office stopped' : `${active} active task${active === 1 ? '' : 's'}`}</b><small>{snapshot.providers.length ? `${snapshot.providers[0]?.name} connected` : 'Provider setup needed'}</small></div>
      </div>
      <div className="sidebar-footer"><button onClick={() => setSection('settings')}><Settings size={17} /> Preferences</button></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents, tasks, files, memory…" /></div>
        <div className="top-actions"><span className="provider-pill"><span />{snapshot.providers[0]?.model ?? 'No model configured'}</span>
          <button className={snapshot.emergencyStopped ? 'resume-button' : 'stop-button'} onClick={() => void execute(snapshot.emergencyStopped ? window.office.resumeOffice() : window.office.stopAll(), snapshot.emergencyStopped ? 'Office resumed' : 'All agents stopped')}>
            {snapshot.emergencyStopped ? <Play size={15} /> : <CircleStop size={15} />}{snapshot.emergencyStopped ? 'Resume office' : 'Stop all agents'}
          </button>
          <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        </div>
      </header>
      <div className="content">{content}</div>
    </main>
    {agentModal && <AgentModal onClose={() => setAgentModal(false)} onSaved={async () => { setAgentModal(false); await refresh(true); toast('Specialist agent created', 'success') }} />}
    {taskModal && <TaskModal agents={snapshot.agents} onClose={() => setTaskModal(false)} onSaved={async () => { setTaskModal(false); await refresh(true); toast('Task added to the queue', 'success') }} />}
    {onboarding && <Onboarding snapshot={snapshot} onDone={async () => { await window.office.completeOnboarding(); setOnboarding(false); await refresh(true) }} toast={toast} />}
    <div className="toast-stack">{toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}>{item.tone === 'success' ? <Check size={16} /> : item.tone === 'error' ? <AlertTriangle size={16} /> : <Zap size={16} />}{item.text}</div>)}</div>
  </div>
}

type PageProps = { snapshot: DashboardSnapshot; refresh: (quiet?: boolean) => Promise<void>; toast: (text: string, tone?: Toast['tone']) => void; search: string }

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }): ReactNode {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function OfficePage({ snapshot, refresh, toast, onNewTask }: PageProps & { onNewTask: () => void }): ReactNode {
  const manager = snapshot.agents.find((agent) => agent.name === 'Office Manager')
  const specialists = snapshot.agents.filter((agent) => agent.id !== manager?.id)
  const recentTasks = snapshot.tasks.slice(0, 4)
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState(manager?.id ?? '')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!message.trim()) return
    const result = await window.office.submitCommand(message, target || undefined)
    if (result.ok) { setMessage(''); toast('Work assigned', 'success'); await refresh(true) } else toast(result.error ?? 'Could not assign work', 'error')
  }
  return <>
    <PageHeader eyebrow="Command center" title="Good morning. What should the office handle?" description="Assign an objective to Office Manager or work directly with a specialist." action={<button className="primary" onClick={onNewTask}><Plus size={16} /> New task</button>} />
    {snapshot.emergencyStopped && <div className="emergency-banner"><CircleStop size={22} /><div><b>All agents are stopped</b><span>State is preserved. Resume the office when you are ready to continue.</span></div></div>}
    <section className="metrics">
      <Metric icon={<Zap />} label="Active work" value={String(snapshot.tasks.filter((task) => ['planning','running'].includes(task.status)).length)} detail="across the office" tone="blue" />
      <Metric icon={<ShieldCheck />} label="Approvals" value={String(snapshot.approvals.filter((item) => item.status === 'pending').length)} detail="waiting for you" tone="amber" />
      <Metric icon={<Check />} label="Completed" value={String(snapshot.tasks.filter((task) => task.status === 'completed').length)} detail="all time" tone="green" />
      <Metric icon={<Users />} label="Team" value={String(snapshot.agents.length)} detail="available agents" tone="violet" />
    </section>
    <div className="office-grid">
      <section className="manager-panel panel">
        <div className="section-title"><div><span className="eyebrow">Office manager</span><h2>Your central point of contact</h2></div><span className={`badge ${manager?.status ?? 'offline'}`}>{pretty(manager?.status ?? 'offline')}</span></div>
        {manager && <AgentHero agent={manager} task={snapshot.tasks.find((task) => task.id === manager.currentTaskId)} />}
        <form className="command-box" onSubmit={submit}>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the outcome you need. Office Manager will plan and coordinate the work…" />
          <div className="command-footer"><select value={target} onChange={(e) => setTarget(e.target.value)}>{snapshot.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button className="primary" disabled={!message.trim()}><MessageSquareText size={16} /> Assign work</button></div>
        </form>
      </section>
      <section className="panel task-preview"><div className="section-title"><div><span className="eyebrow">Task stream</span><h2>Recent work</h2></div></div>
        {recentTasks.length ? recentTasks.map((task) => <TaskRow key={task.id} task={task} agent={snapshot.agents.find((agent) => agent.id === task.assignedAgentId)} compact />) : <Empty icon={<BriefcaseBusiness />} title="No tasks yet" text="Give Office Manager an objective to begin." />}
      </section>
    </div>
    <section className="section-block"><div className="section-title"><div><span className="eyebrow">Specialists</span><h2>Your agent team</h2></div></div>
      {specialists.length ? <div className="agent-grid">{specialists.map((agent) => <AgentCard key={agent.id} agent={agent} task={snapshot.tasks.find((task) => task.id === agent.currentTaskId)} />)}</div> : <div className="empty-wide"><div><Users size={24} /><div><b>No specialists yet</b><span>Create agents for research, sales, operations, content, or any role you need.</span></div></div></div>}
    </section>
  </>
}

function Metric({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }): ReactNode {
  return <div className="metric"><span className={`metric-icon ${tone}`}>{icon}</span><div><span>{label}</span><b>{value}</b><small>{detail}</small></div></div>
}

function AgentHero({ agent, task }: { agent: Agent; task?: Task }): ReactNode {
  return <div className="agent-hero"><Avatar agent={agent} large /><div className="agent-hero-info"><h3>{agent.name}</h3><p>{agent.description}</p><div className="agent-meta"><span><Bot size={14} />{agent.model}</span><span><ShieldCheck size={14} />{pretty(agent.permissionProfile)}</span></div>{task && <div className="current-work"><span>Currently working</span><b>{task.title}</b><Progress value={task.progress} /></div>}</div></div>
}

function AgentCard({ agent, task }: { agent: Agent; task?: Task }): ReactNode {
  return <article className="agent-card"><div className="agent-card-top"><Avatar agent={agent} /><span className={`badge ${agent.status}`}>{pretty(agent.status)}</span></div><h3>{agent.name}</h3><p>{agent.role}</p><div className="agent-model"><Bot size={14} />{agent.model}</div>{task ? <div className="agent-task"><small>Current task</small><b>{task.title}</b><Progress value={task.progress} /></div> : <div className="agent-idle">Ready for work</div>}</article>
}

function AgentsPage({ snapshot, refresh, toast, search, onNew }: PageProps & { onNew: () => void }): ReactNode {
  const agents = snapshot.agents.filter((agent) => `${agent.name} ${agent.role}`.toLowerCase().includes(search.toLowerCase()))
  const archive = async (agent: Agent) => {
    const result = await window.office.archiveAgent(agent.id)
    if (result.ok) { toast(`${agent.name} archived`, 'success'); await refresh(true) } else toast(result.error ?? 'Could not archive agent', 'error')
  }
  return <><PageHeader eyebrow="Team" title="Agents" description="Create focused specialists with clear goals, tools, and permission boundaries." action={<button className="primary" onClick={onNew}><Plus size={16} /> New agent</button>} />
    <div className="agent-grid full">{agents.map((agent) => <article className="agent-card detailed" key={agent.id}><div className="agent-card-top"><Avatar agent={agent} /><span className={`badge ${agent.status}`}>{pretty(agent.status)}</span></div><h3>{agent.name}</h3><p>{agent.role}</p><span className="description">{agent.description}</span><div className="detail-list"><span><Bot size={14} />{agent.model}</span><span><ShieldCheck size={14} />{pretty(agent.permissionProfile)}</span><span><MemoryStick size={14} />Memory {agent.memoryEnabled ? 'on' : 'off'}</span></div>{agent.name !== 'Office Manager' && <button className="ghost danger-text" onClick={() => void archive(agent)}><Archive size={15} /> Archive</button>}</article>)}</div></>
}

function TasksPage({ snapshot, refresh, toast, search, onNew }: PageProps & { onNew: () => void }): ReactNode {
  const tasks = snapshot.tasks.filter((task) => `${task.title} ${task.objective}`.toLowerCase().includes(search.toLowerCase()))
  const transition = async (task: Task, status: Task['status']) => {
    const result = status === 'queued' && ['failed','completed','cancelled'].includes(task.status) ? await window.office.retryTask(task.id) : await window.office.transitionTask(task.id, status)
    if (result.ok) { toast(`Task ${pretty(status)}`, 'success'); await refresh(true) } else toast(result.error ?? 'Task could not be updated', 'error')
  }
  return <><PageHeader eyebrow="Work queue" title="Tasks" description="Track objectives, ownership, progress, dependencies, and recoverable results." action={<button className="primary" onClick={onNew}><Plus size={16} /> New task</button>} />
    <div className="panel table-panel"><div className="table-head task-columns"><span>Task</span><span>Owner</span><span>Status</span><span>Progress</span><span>Actions</span></div>{tasks.length ? tasks.map((task) => <div className="table-row task-columns" key={task.id}><div><b>{task.title}</b><small>{task.objective}</small>{task.error && <small className="error-line">{task.error}</small>}</div><span>{snapshot.agents.find((agent) => agent.id === task.assignedAgentId)?.name ?? 'Unassigned'}</span><span><i className={`badge ${task.status}`}>{pretty(task.status)}</i></span><div><Progress value={task.progress} /><small>{task.progress}%</small></div><div className="row-actions">{['queued','paused'].includes(task.status) && <button onClick={async () => { const result = await window.office.startTask(task.id); if (result.ok) { toast('Task started','success'); await refresh(true) } else toast(result.error ?? 'Task could not start','error') }} title={task.status === 'paused' ? 'Resume' : 'Start'}><Play size={15} /></button>}{['running','planning'].includes(task.status) && <button onClick={() => void transition(task, 'paused')} title="Pause"><Pause size={15} /></button>}{['failed','completed','cancelled'].includes(task.status) && <button onClick={() => void transition(task, 'queued')} title="Retry"><RefreshCw size={15} /></button>}</div></div>) : <Empty icon={<BriefcaseBusiness />} title="No matching tasks" text="Create a task or assign work from the Office." />}</div></>
}

function ApprovalsPage({ snapshot, refresh, toast }: PageProps): ReactNode {
  const decide = async (approval: Approval, decision: 'approved' | 'denied') => {
    const result = await window.office.decideApproval(approval.id, decision)
    if (result.ok) { toast(decision === 'approved' ? 'Action approved and executed' : 'Action denied', decision === 'approved' ? 'success' : 'info'); await refresh(true) }
    else toast(result.error ?? 'Could not record decision', 'error')
  }
  const pending = snapshot.approvals.filter((item) => item.status === 'pending')
  const history = snapshot.approvals.filter((item) => item.status !== 'pending')
  return <><PageHeader eyebrow="Human control" title="Approval center" description="Review the exact action, target, reason, and risk before sensitive work proceeds." />
    <section className="approval-list">{pending.length ? pending.map((item) => <article className="approval-card" key={item.id}><div className="approval-icon"><ShieldCheck /></div><div className="approval-body"><div className="approval-heading"><div><span className={`risk ${item.risk}`}>{item.risk} risk</span><h3>{item.description}</h3></div><span>{formatDate(item.createdAt)}</span></div><dl><div><dt>Agent</dt><dd>{snapshot.agents.find((agent) => agent.id === item.agentId)?.name ?? 'System'}</dd></div><div><dt>Action</dt><dd>{item.actionType}</dd></div><div><dt>Target</dt><dd>{item.target || 'Not specified'}</dd></div><div><dt>Reason</dt><dd>{item.reason}</dd></div></dl><div className="approval-actions"><button className="secondary" onClick={() => void decide(item, 'denied')}><X size={16} /> Deny</button><button className="primary" onClick={() => void decide(item, 'approved')}><Check size={16} /> Approve once</button></div></div></article>) : <Empty icon={<ShieldCheck />} title="No approvals waiting" text="Sensitive agent actions will pause here for your decision." />}</section>
    {history.length > 0 && <section className="section-block"><div className="section-title"><h2>Decision history</h2></div><div className="panel compact-list">{history.slice(0,10).map((item) => <div key={item.id}><span className={`decision ${item.status}`}>{item.status === 'approved' ? <Check size={14} /> : <X size={14} />}</span><div><b>{item.description}</b><small>{formatDate(item.decidedAt ?? item.createdAt)}</small></div><span className={`risk ${item.risk}`}>{item.risk}</span></div>)}</div></section>}
  </>
}

function FilesPage({ snapshot, toast, search }: PageProps): ReactNode {
  const files = snapshot.files.filter((file) => file.name.toLowerCase().includes(search.toLowerCase()))
  return <><PageHeader eyebrow="Managed output" title="Files" description="Reports and artifacts created inside trusted A&A Office workspaces." />
    <div className="panel table-panel"><div className="table-head file-columns"><span>Name</span><span>Created by</span><span>Size</span><span>Created</span><span /></div>{files.length ? files.map((file) => <div className="table-row file-columns" key={file.id}><div className="file-name"><FileText size={18} /><div><b>{file.name}</b><small>{file.path}</small></div></div><span>{snapshot.agents.find((agent) => agent.id === file.agentId)?.name ?? 'Office'}</span><span>{formatBytes(file.size)}</span><span>{formatDate(file.createdAt)}</span><button className="ghost" onClick={async () => { const result = await window.office.openFile(file.path); if (!result.ok) toast(result.error ?? 'Could not open file', 'error') }}>Open</button></div>) : <Empty icon={<FolderOpen />} title="No managed files" text="Agent exports will appear here with their origin and location." />}</div></>
}

function MemoryPage({ snapshot, refresh, toast, search }: PageProps): ReactNode {
  const memories = snapshot.memories.filter((item) => item.content.toLowerCase().includes(search.toLowerCase()))
  return <><PageHeader eyebrow="Local context" title="Memory" description="Inspect and control the information agents retain between tasks." />
    <div className="memory-grid">{memories.length ? memories.map((item) => <article className="memory-card" key={item.id}><div><span className="memory-type">{item.category}</span><button onClick={async () => { const result = await window.office.deleteMemory(item.id); if (result.ok) { toast('Memory removed', 'success'); await refresh(true) } }}><X size={15} /></button></div><p>{item.content}</p><footer><span>{snapshot.agents.find((agent) => agent.id === item.agentId)?.name ?? 'General'}</span><time>{formatDate(item.createdAt)}</time></footer></article>) : <Empty icon={<Brain />} title="No retained memory" text="Completed tasks can create inspectable local memory when enabled." />}</div></>
}

function ActivityPage({ snapshot, search }: PageProps): ReactNode {
  const activity = snapshot.activity.filter((item) => `${item.title} ${item.detail} ${item.type}`.toLowerCase().includes(search.toLowerCase()))
  return <><PageHeader eyebrow="Audit trail" title="Activity" description="See what happened, why it happened, and which agent or task was involved." />
    <div className="activity-feed">{activity.map((item) => <div className="activity-item" key={item.id}><span className={`activity-dot ${item.level}`} /><div><b>{item.title}</b><p>{item.detail}</p><small>{pretty(item.type)} · {formatDate(item.createdAt)}</small></div></div>)}</div></>
}

function SettingsPage({ snapshot, refresh, toast, dark, setDark }: PageProps & { dark: boolean; setDark: (value: boolean) => void }): ReactNode {
  const [provider, setProvider] = useState<ProviderInput>({ name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: '' })
  const [saving, setSaving] = useState(false)
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); const result = await window.office.saveProvider(provider); setSaving(false); if (result.ok) { setProvider((p) => ({ ...p, apiKey: '' })); toast('Provider saved securely', 'success'); await refresh(true) } else toast(result.error ?? 'Could not save provider', 'error') }
  const backup = async () => { const result = await window.office.createBackup(); if (result.ok) toast('Local backup created', 'success'); else toast(result.error ?? 'Backup failed', 'error') }
  return <><PageHeader eyebrow="Configuration" title="Settings" description="Manage providers, appearance, permissions, workspaces, backups, and advanced options." />
    <div className="settings-grid"><section className="panel settings-card"><div className="settings-title"><Bot /><div><h2>AI provider</h2><p>Credentials are encrypted by the operating system and never stored in the database.</p></div></div>
      <form className="form-grid" onSubmit={save}><label>Provider name<input value={provider.name} onChange={(e) => setProvider({ ...provider, name: e.target.value })} /></label><label>Provider type<select value={provider.type} onChange={(e) => setProvider({ ...provider, type: e.target.value as ProviderInput['type'] })}><option value="openai">OpenAI</option><option value="compatible">OpenAI-compatible</option></select></label><label className="wide">API base URL<input value={provider.baseUrl} onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })} /></label><label>Model<input value={provider.model} onChange={(e) => setProvider({ ...provider, model: e.target.value })} /></label><label>API key<input type="password" autoComplete="off" value={provider.apiKey} onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })} placeholder={snapshot.providers.length ? 'Leave blank to keep current key' : 'sk-…'} /></label><div className="form-actions wide"><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save provider'}</button>{snapshot.providers[0] && <button type="button" className="secondary" onClick={async () => { const result = await window.office.testProvider(snapshot.providers[0]!.id); toast(result.ok ? 'Provider connection works' : result.error ?? 'Connection failed', result.ok ? 'success' : 'error') }}>Test connection</button>}</div></form>
    </section><section className="panel settings-card"><div className="settings-title"><Sun /><div><h2>Appearance</h2><p>Choose the interface that works best in your environment.</p></div></div><div className="theme-options"><button className={dark ? 'selected' : ''} onClick={() => setDark(true)}><Moon />Dark<b>Midnight workspace</b></button><button className={!dark ? 'selected' : ''} onClick={() => setDark(false)}><Sun />Light<b>Bright workspace</b></button></div></section><section className="panel settings-card"><div className="settings-title"><Archive /><div><h2>Backups</h2><p>Create a timestamped local backup of critical office data.</p></div></div><button className="secondary" onClick={() => void backup()}><Archive size={16} /> Backup now</button></section><section className="panel settings-card"><div className="settings-title"><ShieldCheck /><div><h2>Safety defaults</h2><p>External actions, commands, destructive operations, and overwrites always stop for approval.</p></div></div><ul className="safety-list"><li><Check />Typed and validated tools</li><li><Check />Trusted workspace boundaries</li><li><Check />Auditable approval decisions</li><li><Check />Emergency stop control</li></ul></section></div>
  </>
}

function AgentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }): ReactNode {
  const [input, setInput] = useState<AgentInput>({ name: '', role: '', description: '', instructions: 'Work carefully, report progress, and never bypass approvals.', goal: '', avatar: 'AI', color: '#25B6A6', provider: 'openai', model: 'gpt-4.1-mini', workspaceId: null, permissionProfile: 'standard', memoryEnabled: true })
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = await window.office.createAgent(input); if (result.ok) await onSaved(); else setError(result.error ?? 'Could not create agent') }
  return <Modal title="Create specialist agent" subtitle="Give this agent a clear role and safe operating boundary." onClose={onClose}><form className="form-grid modal-form" onSubmit={submit}><label>Name<input required value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} placeholder="Research Analyst" /></label><label>Role<input required value={input.role} onChange={(e) => setInput({ ...input, role: e.target.value })} placeholder="Market research specialist" /></label><label className="wide">Description<textarea value={input.description} onChange={(e) => setInput({ ...input, description: e.target.value })} /></label><label className="wide">Goal<textarea value={input.goal} onChange={(e) => setInput({ ...input, goal: e.target.value })} /></label><label>Model<input value={input.model} onChange={(e) => setInput({ ...input, model: e.target.value })} /></label><label>Permission profile<select value={input.permissionProfile} onChange={(e) => setInput({ ...input, permissionProfile: e.target.value as AgentInput['permissionProfile'] })}><option value="research">Research only</option><option value="standard">Standard</option><option value="advanced">Advanced</option><option value="custom">Custom</option></select></label><label className="wide check-label"><input type="checkbox" checked={input.memoryEnabled} onChange={(e) => setInput({ ...input, memoryEnabled: e.target.checked })} /> Allow inspectable local memory</label>{error && <div className="form-error wide">{error}</div>}<div className="form-actions wide"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary">Create agent</button></div></form></Modal>
}

function TaskModal({ agents, onClose, onSaved }: { agents: Agent[]; onClose: () => void; onSaved: () => Promise<void> }): ReactNode {
  const [input, setInput] = useState<TaskInput>({ title: '', objective: '', assignedAgentId: agents[0]?.id ?? null, parentTaskId: null, priority: 2 })
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = await window.office.createTask(input); if (result.ok) await onSaved(); else setError(result.error ?? 'Could not create task') }
  return <Modal title="Create task" subtitle="Define a clear objective, owner, and priority." onClose={onClose}><form className="form-grid modal-form" onSubmit={submit}><label className="wide">Title<input required value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></label><label className="wide">Objective<textarea required rows={5} value={input.objective} onChange={(e) => setInput({ ...input, objective: e.target.value })} /></label><label>Assigned agent<select value={input.assignedAgentId ?? ''} onChange={(e) => setInput({ ...input, assignedAgentId: e.target.value || null })}><option value="">Unassigned</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label><label>Priority<select value={input.priority} onChange={(e) => setInput({ ...input, priority: Number(e.target.value) })}><option value={1}>Low</option><option value={2}>Normal</option><option value={3}>High</option><option value={4}>Urgent</option></select></label>{error && <div className="form-error wide">{error}</div>}<div className="form-actions wide"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary">Create task</button></div></form></Modal>
}

function Onboarding({ snapshot, onDone, toast }: { snapshot: DashboardSnapshot; onDone: () => Promise<void>; toast: (text: string, tone?: Toast['tone']) => void }): ReactNode {
  const [step, setStep] = useState(snapshot.providers.length ? 3 : 1)
  const [provider, setProvider] = useState<ProviderInput>({ name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: '' })
  const saveProvider = async () => { const result = await window.office.saveProvider(provider); if (!result.ok) { toast(result.error ?? 'Could not save provider', 'error'); return } setStep(3) }
  return <div className="onboarding-backdrop"><div className="onboarding"><div className="onboarding-aside"><div className="brand-mark"><Sparkles /></div><h2>Set up your office</h2><p>A few choices establish a safe local workspace.</p>{['Welcome', 'AI provider', 'Permission policy', 'Ready'].map((label, index) => <div className={`onboarding-step ${step >= index + 1 ? 'active' : ''}`} key={label}><span>{step > index + 1 ? <Check size={14} /> : index + 1}</span>{label}</div>)}</div><div className="onboarding-main">{step === 1 && <><span className="eyebrow">Welcome</span><h1>Your AI office, under your control.</h1><p>A&A Office keeps tasks, memory, files, and audit history on this computer. Sensitive actions wait for your approval.</p><div className="feature-list"><div><ShieldCheck /><b>Approval first</b><span>External and high-risk actions pause for you.</span></div><div><Brain /><b>Inspectable memory</b><span>See and clear what agents remember.</span></div><div><CircleStop /><b>Emergency control</b><span>Stop all agents while preserving work.</span></div></div><button className="primary next" onClick={() => setStep(2)}>Continue <ChevronRight size={17} /></button></>}{step === 2 && <><span className="eyebrow">AI provider</span><h1>Connect a model.</h1><p>Your API key is encrypted using the operating system’s secure storage.</p><div className="form-grid onboarding-form"><label>Provider<input value={provider.name} onChange={(e) => setProvider({ ...provider, name: e.target.value })} /></label><label>Model<input value={provider.model} onChange={(e) => setProvider({ ...provider, model: e.target.value })} /></label><label className="wide">API key<input type="password" value={provider.apiKey} onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })} placeholder="sk-…" /></label></div><div className="onboarding-actions"><button className="secondary" onClick={() => setStep(3)}>Set up later</button><button className="primary" disabled={!provider.apiKey} onClick={() => void saveProvider()}>Save securely</button></div></>}{step === 3 && <><span className="eyebrow">Safety</span><h1>Start with Standard permissions.</h1><p>Agents can research and create new files in trusted workspaces. Commands, overwrites, destructive changes, and external actions always require approval.</p><div className="policy-card selected"><ShieldCheck /><div><b>Standard</b><span>Safe defaults for everyday office work</span></div><Check /></div><button className="primary next" onClick={() => setStep(4)}>Use Standard <ChevronRight size={17} /></button></>}{step === 4 && <><span className="eyebrow">Ready</span><h1>Your office is ready.</h1><p>Office Manager is waiting. Create specialists at any time, then assign an outcome from the command center.</p><div className="ready-mark"><Check /></div><button className="primary next" onClick={() => void onDone()}>Open A&A Office <ChevronRight size={17} /></button></>}</div></div></div>
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }): ReactNode { return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><div className="modal"><div className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose}><X /></button></div>{children}</div></div> }
function Avatar({ agent, large = false }: { agent: Agent; large?: boolean }): ReactNode { return <span className={`avatar ${large ? 'large' : ''}`} style={{ background: `${agent.color}22`, color: agent.color, borderColor: `${agent.color}55` }}>{agent.avatar}</span> }
function Progress({ value }: { value: number }): ReactNode { return <div className="progress"><span style={{ width: `${Math.max(3, value)}%` }} /></div> }
function TaskRow({ task, agent, compact }: { task: Task; agent?: Agent; compact?: boolean }): ReactNode { return <div className={`task-row ${compact ? 'compact' : ''}`}><span className={`task-status ${task.status}`} /> <div><b>{task.title}</b><small>{agent?.name ?? 'Unassigned'} · {pretty(task.status)}</small></div><span>{task.progress}%</span></div> }
function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }): ReactNode { return <div className="empty">{icon}<b>{title}</b><span>{text}</span></div> }
const pretty = (value: string): string => value.replace(/[._]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const formatDate = (value: string): string => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const formatBytes = (bytes: number): string => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
