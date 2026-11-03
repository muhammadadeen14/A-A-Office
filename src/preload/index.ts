import { contextBridge, ipcRenderer } from 'electron'
import type { Agent, AgentInput, ApiResult, DashboardSnapshot, MemoryRecord, ProviderConfig, ProviderInput, Task, TaskInput } from '../shared/domain'

const invoke = <T>(channel: string, payload?: unknown): Promise<ApiResult<T>> => ipcRenderer.invoke(channel, payload) as Promise<ApiResult<T>>

export const officeApi = {
  snapshot: (): Promise<ApiResult<DashboardSnapshot>> => invoke('office:snapshot'),
  createAgent: (input: AgentInput): Promise<ApiResult<Agent>> => invoke('agents:create', input),
  updateAgent: (id: string, changes: Partial<Agent>): Promise<ApiResult<Agent>> => invoke('agents:update', { id, changes }),
  archiveAgent: (id: string): Promise<ApiResult<void>> => invoke('agents:archive', id),
  createTask: (input: TaskInput): Promise<ApiResult<Task>> => invoke('tasks:create', input),
  transitionTask: (id: string, status: Task['status']): Promise<ApiResult<Task>> => invoke('tasks:transition', { id, status }),
  startTask: (id: string): Promise<ApiResult<Task>> => invoke('tasks:start', id),
  retryTask: (id: string): Promise<ApiResult<Task>> => invoke('tasks:retry', id),
  decideApproval: (id: string, decision: 'approved' | 'denied'): Promise<ApiResult<void>> => invoke('approvals:decide', { id, decision }),
  addMemory: (input: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<ApiResult<MemoryRecord>> => invoke('memory:add', input),
  deleteMemory: (id: string): Promise<ApiResult<void>> => invoke('memory:delete', id),
  saveProvider: (input: ProviderInput): Promise<ApiResult<ProviderConfig>> => invoke('providers:save', input),
  testProvider: (id: string): Promise<ApiResult<void>> => invoke('providers:test', id),
  submitCommand: (message: string, agentId?: string): Promise<ApiResult<string>> => invoke('office:command', { message, agentId }),
  stopAll: (): Promise<ApiResult<void>> => invoke('office:stop-all'),
  resumeOffice: (): Promise<ApiResult<void>> => invoke('office:resume'),
  completeOnboarding: (): Promise<ApiResult<void>> => invoke('office:complete-onboarding'),
  createBackup: (): Promise<ApiResult<string>> => invoke('backups:create'),
  listBackups: (): Promise<ApiResult<Array<{ name: string; path: string; size: number; createdAt: string }>>> => invoke('backups:list'),
  openFile: (path: string): Promise<ApiResult<void>> => invoke('files:open', path)
}

contextBridge.exposeInMainWorld('office', officeApi)

export type OfficeApi = typeof officeApi
