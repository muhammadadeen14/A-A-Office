export const agentStatuses = ['idle', 'thinking', 'researching', 'working', 'using_tool', 'waiting_approval', 'paused', 'completed', 'failed', 'offline'] as const
export const taskStatuses = ['queued', 'planning', 'running', 'waiting_approval', 'paused', 'completed', 'failed', 'cancelled'] as const
export const approvalStatuses = ['pending', 'approved', 'denied'] as const
export const riskLevels = ['low', 'medium', 'high', 'critical'] as const
export const permissionProfiles = ['research', 'standard', 'advanced', 'custom'] as const

export type AgentStatus = (typeof agentStatuses)[number]
export type TaskStatus = (typeof taskStatuses)[number]
export type ApprovalStatus = (typeof approvalStatuses)[number]
export type RiskLevel = (typeof riskLevels)[number]
export type PermissionProfile = (typeof permissionProfiles)[number]

export interface Agent {
  id: string
  name: string
  role: string
  description: string
  instructions: string
  goal: string
  avatar: string
  color: string
  provider: string
  model: string
  workspaceId: string | null
  permissionProfile: PermissionProfile
  memoryEnabled: boolean
  status: AgentStatus
  currentTaskId: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  title: string
  objective: string
  assignedAgentId: string | null
  parentTaskId: string | null
  status: TaskStatus
  priority: number
  progress: number
  result: string | null
  error: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export interface Approval {
  id: string
  agentId: string | null
  taskId: string | null
  actionType: string
  description: string
  target: string
  reason: string
  payload: string
  risk: RiskLevel
  status: ApprovalStatus
  createdAt: string
  decidedAt: string | null
}

export interface ActivityEvent {
  id: string
  agentId: string | null
  taskId: string | null
  type: string
  title: string
  detail: string
  level: 'info' | 'success' | 'warning' | 'error'
  createdAt: string
}

export interface MemoryRecord {
  id: string
  agentId: string | null
  taskId: string | null
  category: 'conversation' | 'agent' | 'task' | 'preference' | 'context'
  content: string
  createdAt: string
}

export interface ManagedFile {
  id: string
  name: string
  path: string
  mime: string
  size: number
  agentId: string | null
  taskId: string | null
  createdAt: string
}

export interface ProviderConfig {
  id: string
  name: string
  type: 'openai' | 'compatible'
  baseUrl: string
  model: string
  hasCredential: boolean
  enabled: boolean
}

export interface DashboardSnapshot {
  agents: Agent[]
  tasks: Task[]
  approvals: Approval[]
  activity: ActivityEvent[]
  memories: MemoryRecord[]
  files: ManagedFile[]
  providers: ProviderConfig[]
  emergencyStopped: boolean
  onboardingComplete: boolean
}

export interface AgentInput {
  name: string
  role: string
  description?: string
  instructions?: string
  goal?: string
  avatar?: string
  color?: string
  provider?: string
  model?: string
  workspaceId?: string | null
  permissionProfile?: PermissionProfile
  memoryEnabled?: boolean
}

export interface TaskInput {
  title: string
  objective: string
  assignedAgentId?: string | null
  parentTaskId?: string | null
  priority?: number
}

export interface ProviderInput {
  name: string
  type: 'openai' | 'compatible'
  baseUrl: string
  model: string
  apiKey?: string
}

export type NavigationSection = 'office' | 'agents' | 'tasks' | 'approvals' | 'files' | 'memory' | 'activity' | 'settings'

export interface ApiResult<T = undefined> {
  ok: boolean
  data?: T
  error?: string
}
