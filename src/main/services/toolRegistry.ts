import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { z } from 'zod'
import type { Agent, Approval } from '../../shared/domain'
import { OfficeDatabase } from '../database'
import { PathGuard } from '../security/pathGuard'
import { PermissionService, type ToolRequest } from './permissionService'

export type ToolCall =
  | { name: 'files.list'; input: { path: string } }
  | { name: 'files.read'; input: { path: string } }
  | { name: 'files.write'; input: { path: string; content: string } }
  | { name: 'system.execute'; input: { executable: string; args: string[]; cwd: string } }
  | { name: 'web.research'; input: { url: string } }

export interface ToolResult { status: 'completed' | 'approval_required' | 'denied'; output?: unknown; approval?: Approval }

const toolCallSchema = z.discriminatedUnion('name', [
  z.object({ name:z.literal('files.list'), input:z.object({ path:z.string().min(1).max(4096) }) }),
  z.object({ name:z.literal('files.read'), input:z.object({ path:z.string().min(1).max(4096) }) }),
  z.object({ name:z.literal('files.write'), input:z.object({ path:z.string().min(1).max(4096), content:z.string().max(5_000_000) }) }),
  z.object({ name:z.literal('system.execute'), input:z.object({ executable:z.string().min(1).max(4096), args:z.array(z.string().max(10_000)).max(100), cwd:z.string().min(1).max(4096) }) }),
  z.object({ name:z.literal('web.research'), input:z.object({ url:z.string().url().max(4096) }) })
])

export class ToolRegistry {
  private readonly activeExecutions = new Map<string, AbortController>()
  constructor(
    private readonly database: OfficeDatabase,
    private readonly guard: PathGuard,
    private readonly permissions = new PermissionService(),
    private readonly isEmergencyStopped: () => boolean = () => false
  ) {}

  async request(agent: Agent, taskId: string | null, call: ToolCall): Promise<ToolResult> {
    if (this.isEmergencyStopped()) throw new Error('All agents are stopped. Tool execution is disabled.')
    const validated = toolCallSchema.parse(call) as ToolCall
    const request = this.describe(validated)
    const decision = this.permissions.decide(agent.permissionProfile, request)
    if (!decision.allowed) {
      this.database.addActivity({ agentId: agent.id, taskId, type: 'tool.denied', title: `${validated.name} denied`, detail: decision.reason, level: 'warning' })
      return { status: 'denied', output: decision.reason }
    }
    if (decision.requiresApproval) {
      const approval = this.database.createApproval({ agentId: agent.id, taskId, actionType: validated.name, description: `${agent.name} requests ${validated.name}`, target: request.target, reason: decision.reason, payload: JSON.stringify(validated), risk: decision.risk })
      return { status: 'approval_required', approval }
    }
    return { status: 'completed', output: await this.execute(validated, false) }
  }

  async executeApproved(approvalId: string): Promise<unknown> {
    if (this.isEmergencyStopped()) throw new Error('All agents are stopped. Approved actions remain paused.')
    const approval = this.database.claimApprovalExecution(approvalId)
    const controller = new AbortController(); this.activeExecutions.set(approval.id, controller)
    try {
      const call = toolCallSchema.parse(JSON.parse(approval.payload)) as ToolCall
      const output = await this.execute(call, true, controller.signal)
      this.database.finishApprovalExecution(approval.id)
      this.database.addActivity({ agentId: approval.agentId, taskId: approval.taskId, type: 'tool.completed', title: `${approval.actionType} completed`, detail: approval.target, level: 'success' })
      return output
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected tool failure'
      this.database.finishApprovalExecution(approval.id, message)
      this.database.addActivity({ agentId: approval.agentId, taskId: approval.taskId, type: 'tool.failed', title: `${approval.actionType} failed`, detail: message, level: 'error' })
      throw error
    } finally { this.activeExecutions.delete(approval.id) }
  }

  resolveManagedPath(path: string): Promise<string> { return this.guard.resolveExisting(path) }
  abortActive(): void { this.activeExecutions.forEach((controller) => controller.abort()); this.activeExecutions.clear() }

  private describe(call: ToolCall): ToolRequest {
    switch (call.name) {
      case 'files.list': return { tool: call.name, operation: 'read', target: call.input.path }
      case 'files.read': return { tool: call.name, operation: 'read', target: call.input.path }
      case 'files.write': return { tool: call.name, operation: 'write', target: call.input.path, overwrites: existsSync(this.guard.resolveWithin(call.input.path)) }
      case 'system.execute': return { tool: call.name, operation: 'execute', target: JSON.stringify({ executable:call.input.executable, args:call.input.args, cwd:call.input.cwd }) }
      case 'web.research': return { tool: call.name, operation: 'read', target: call.input.url }
    }
  }

  private async execute(call: ToolCall, approvedOverwrite: boolean, signal?: AbortSignal): Promise<unknown> {
    switch (call.name) {
      case 'files.list': {
        const path = await this.guard.resolveExisting(call.input.path)
        return Promise.all((await readdir(path)).map(async (name) => {
          const entry = await this.guard.resolveExisting(name, path)
          const info = await stat(entry)
          return { name, type: info.isDirectory() ? 'directory' : 'file', size: info.size, modifiedAt: info.mtime.toISOString() }
        }))
      }
      case 'files.read': return readFile(await this.guard.resolveExisting(call.input.path), 'utf8')
      case 'files.write': {
        const path = await this.guard.resolveForWrite(call.input.path)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, call.input.content, { encoding: 'utf8', flag: approvedOverwrite ? 'w' : 'wx' })
        const info = await stat(path)
        this.database.addFile({ name: basename(path), path, mime: 'text/plain', size: info.size, agentId: null, taskId: null })
        return { path, size: info.size }
      }
      case 'system.execute': {
        const cwd = await this.guard.resolveExisting(call.input.cwd)
        return executeCommand(call.input.executable, call.input.args, cwd, signal)
      }
      case 'web.research': {
        const url = new URL(call.input.url)
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP(S) research is supported')
        const timeout = AbortSignal.timeout(20_000)
        const response = await fetch(url, { signal:signal ? AbortSignal.any([signal,timeout]) : timeout, redirect: 'follow' })
        if (!response.ok) throw new Error(`Website returned ${response.status}`)
        return (await response.text()).slice(0, 200_000)
      }
    }
  }
}

const executeCommand = (executable: string, args: string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number | string | null; signal: string | null; timedOut: boolean }> =>
  new Promise((resolve, reject) => {
    execFile(executable, args, { cwd, timeout:30_000, windowsHide:true, maxBuffer:1024 * 1024, encoding:'utf8', signal }, (error, stdout, stderr) => {
      const processError = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null
      if (processError?.name === 'AbortError') { reject(new Error('Command execution was stopped')); return }
      resolve({ stdout, stderr, exitCode:processError?.code ?? 0, signal:processError?.signal ?? null, timedOut:Boolean(processError?.killed) })
    })
  })
