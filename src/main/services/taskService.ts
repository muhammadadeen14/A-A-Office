import type { Task, TaskStatus } from '../../shared/domain'
import { OfficeDatabase } from '../database'

const transitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ['planning', 'running', 'paused', 'cancelled'],
  planning: ['running', 'waiting_approval', 'paused', 'failed', 'cancelled'],
  running: ['waiting_approval', 'paused', 'completed', 'failed', 'cancelled'],
  waiting_approval: ['running', 'paused', 'failed', 'cancelled'],
  paused: ['queued', 'running', 'cancelled'],
  completed: ['queued'],
  failed: ['queued', 'cancelled'],
  cancelled: ['queued']
}

export class TaskService {
  constructor(private readonly database: OfficeDatabase) {}

  transition(id: string, status: TaskStatus, details: Partial<Task> = {}): Task {
    const task = this.database.getTask(id)
    if (!task) throw new Error('Task not found')
    if (task.status !== status && !transitions[task.status].includes(status)) {
      throw new Error(`Task cannot move from ${task.status} to ${status}`)
    }
    const timing: Partial<Task> = {}
    if (status === 'running' && !task.startedAt) timing.startedAt = new Date().toISOString()
    if (['completed', 'failed', 'cancelled'].includes(status)) timing.completedAt = new Date().toISOString()
    if (status === 'completed') timing.progress = 100
    const updated = this.database.updateTask(id, { ...details, ...timing, status })
    this.database.addActivity({ agentId: task.assignedAgentId, taskId: id, type: 'task.status', title: `${task.title}: ${status.replace('_', ' ')}`, detail: details.error ?? '', level: status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'info' })
    return updated
  }

  retry(id: string): Task {
    return this.transition(id, 'queued', { error: null, result: null, progress: 0, startedAt: null, completedAt: null })
  }
}

export const canTransitionTask = (from: TaskStatus, to: TaskStatus): boolean => from === to || transitions[from].includes(to)
