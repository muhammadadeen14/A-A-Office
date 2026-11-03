import { ipcMain, shell } from 'electron'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { agentInputSchema, agentUpdateSchema, commandInputSchema, idSchema, memoryInputSchema, providerInputSchema, taskInputSchema, taskTransitionSchema } from '../shared/schemas'
import type { ApiResult } from '../shared/domain'
import { OfficeDatabase } from './database'
import { OfficeRuntime } from './services/officeRuntime'
import { TaskService } from './services/taskService'
import { BackupService } from './services/backupService'
import { ToolRegistry } from './services/toolRegistry'

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data })
const fail = <T = undefined>(error: unknown): ApiResult<T> => ({ ok: false, error: error instanceof Error ? error.message : 'Unexpected application error' })
const handle = <TSchema extends z.ZodTypeAny, TOutput>(channel: string, schema: TSchema, action: (input: z.output<TSchema>) => TOutput | Promise<TOutput>): void => {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<ApiResult<TOutput>> => {
    try { return ok(await action(schema.parse(raw))) } catch (error) { return fail<TOutput>(error) }
  })
}

export interface IpcDependencies { database: OfficeDatabase; runtime: OfficeRuntime; backups: BackupService; tools: ToolRegistry }

export const registerIpc = ({ database, runtime, backups, tools }: IpcDependencies): void => {
  const tasks = new TaskService(database)
  ipcMain.handle('office:snapshot', () => ok(runtime.snapshot()))
  handle('agents:create', agentInputSchema, (input) => database.createAgent(input))
  handle('agents:update', z.object({ id: idSchema, changes: agentUpdateSchema }), ({ id, changes }) => database.updateAgent(id, changes))
  handle('agents:archive', idSchema, (id) => database.archiveAgent(id))
  handle('tasks:create', taskInputSchema, (input) => database.createTask(input))
  handle('tasks:transition', taskTransitionSchema, ({ id, status }) => runtime.controlTask(id, status))
  handle('tasks:start', idSchema, (id) => runtime.startTask(id))
  handle('tasks:retry', idSchema, (id) => tasks.retry(id))
  handle('approvals:decide', z.object({ id: idSchema, decision: z.enum(['approved', 'denied']) }), async ({ id, decision }) => {
    const approval = database.decideApproval(id, decision)
    if (decision === 'approved') await tools.executeApproved(approval)
    return approval
  })
  handle('memory:add', memoryInputSchema, (input) => database.addMemory(input))
  handle('memory:delete', idSchema, (id) => database.deleteMemory(id))
  handle('providers:save', providerInputSchema, (input) => runtime.saveProvider(input))
  handle('providers:test', idSchema, (id) => runtime.testProvider(id))
  handle('office:command', commandInputSchema, ({ message, agentId }) => runtime.submitCommand(message, agentId))
  ipcMain.handle('office:stop-all', async () => { try { await runtime.stopAll(); return ok(undefined) } catch (error) { return fail(error) } })
  ipcMain.handle('office:resume', () => { try { runtime.resumeOffice(); return ok(undefined) } catch (error) { return fail(error) } })
  ipcMain.handle('office:complete-onboarding', () => { try { runtime.completeOnboarding(); return ok(undefined) } catch (error) { return fail(error) } })
  ipcMain.handle('backups:create', async () => { try { return ok(await backups.create()) } catch (error) { return fail(error) } })
  ipcMain.handle('backups:list', async () => { try { return ok(await backups.list()) } catch (error) { return fail(error) } })
  handle('files:open', z.string().min(1), async (path) => {
    if (!database.listFiles().some((file) => file.path === path)) throw new Error('This file is not registered in the managed workspace')
    await stat(path); const error = await shell.openPath(path); if (error) throw new Error(error)
  })
}
