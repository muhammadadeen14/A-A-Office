import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
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
const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Requests from embedded frames are not allowed')
  const source = new URL(event.senderFrame.url)
  const loopback = ['localhost','127.0.0.1','::1'].includes(source.hostname)
  const trusted = app.isPackaged ? source.protocol === 'file:' : source.protocol === 'file:' || (source.protocol === 'http:' && loopback)
  if (!trusted) throw new Error('Request rejected from an untrusted application page')
}
const handle = <TSchema extends z.ZodTypeAny, TOutput>(channel: string, schema: TSchema, action: (input: z.output<TSchema>) => TOutput | Promise<TOutput>): void => {
  ipcMain.handle(channel, async (event, raw: unknown): Promise<ApiResult<TOutput>> => {
    try { assertTrustedSender(event); return ok(await action(schema.parse(raw))) } catch (error) { return fail<TOutput>(error) }
  })
}
const handleEmpty = <TOutput>(channel: string, action: () => TOutput | Promise<TOutput>): void => {
  ipcMain.handle(channel, async (event): Promise<ApiResult<TOutput>> => {
    try { assertTrustedSender(event); return ok(await action()) } catch (error) { return fail<TOutput>(error) }
  })
}

export interface IpcDependencies { database: OfficeDatabase; runtime: OfficeRuntime; backups: BackupService; tools: ToolRegistry }

export const registerIpc = ({ database, runtime, backups, tools }: IpcDependencies): void => {
  const tasks = new TaskService(database)
  handleEmpty('office:snapshot', () => runtime.snapshot())
  handle('agents:create', agentInputSchema, (input) => database.createAgent(input))
  handle('agents:update', z.object({ id: idSchema, changes: agentUpdateSchema }), ({ id, changes }) => database.updateAgent(id, changes))
  handle('agents:control', z.object({ id:idSchema, action:z.enum(['pause','resume','archive','delete']) }), ({ id, action }) => runtime.controlAgent(id, action))
  handle('tasks:create', taskInputSchema, (input) => database.createTask(input))
  handle('tasks:transition', taskTransitionSchema, ({ id, status }) => runtime.controlTask(id, status))
  handle('tasks:start', idSchema, (id) => runtime.startTask(id))
  handle('tasks:reassign', z.object({ id:idSchema, agentId:idSchema }), ({ id, agentId }) => runtime.reassignTask(id,agentId))
  handle('tasks:retry', idSchema, (id) => tasks.retry(id))
  handle('approvals:decide', z.object({ id: idSchema, decision: z.enum(['approved', 'denied']) }), async ({ id, decision }) => {
    if (decision === 'approved' && runtime.isStopped()) throw new Error('Resume the office before approving an action')
    const approval = database.decideApproval(id, decision)
    if (decision === 'approved') await tools.executeApproved(approval.id)
    return database.getApproval(id)!
  })
  handle('memory:add', memoryInputSchema, (input) => database.addMemory(input))
  handle('memory:delete', idSchema, (id) => database.deleteMemory(id))
  handle('providers:save', providerInputSchema, (input) => runtime.saveProvider(input))
  handle('providers:test', idSchema, (id) => runtime.testProvider(id))
  handle('providers:remove-credential', idSchema, (id) => runtime.removeProviderCredential(id))
  handle('office:command', commandInputSchema, ({ message, agentId }) => runtime.submitCommand(message, agentId))
  handleEmpty('office:stop-all', () => { tools.abortActive(); return runtime.stopAll() })
  handleEmpty('office:resume', () => runtime.resumeOffice())
  handleEmpty('office:complete-onboarding', () => runtime.completeOnboarding())
  handleEmpty('backups:create', () => backups.create())
  handleEmpty('backups:list', () => backups.list())
  handle('backups:restore', z.string().min(1).max(4096), async (path) => {
    const backup = (await backups.list()).find((item) => item.path === path)
    if (!backup) throw new Error('Backup not found')
    const choice = await dialog.showMessageBox({ type:'warning', buttons:['Cancel','Restore and restart'], defaultId:0, cancelId:0, title:'Restore A&A Office backup?', message:`Restore ${backup.name}?`, detail:'Current data will be backed up first. A&A Office will restart after restoration.' })
    if (choice.response !== 1) throw new Error('Restore cancelled')
    await runtime.stopAll(); await backups.restore(path); app.relaunch(); app.exit(0)
  })
  handle('files:open', z.string().min(1), async (path) => {
    if (!database.listFiles().some((file) => file.path === path)) throw new Error('This file is not registered in the managed workspace')
    const safePath = await tools.resolveManagedPath(path)
    const error = await shell.openPath(safePath); if (error) throw new Error(error)
  })
}
