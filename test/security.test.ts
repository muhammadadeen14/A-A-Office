import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PathGuard } from '../src/main/security/pathGuard'
import { PermissionService } from '../src/main/services/permissionService'
import { ToolRegistry } from '../src/main/services/toolRegistry'
import { OfficeDatabase } from '../src/main/database'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive:true, force:true }) })

describe('security boundaries', () => {
  it('accepts paths in trusted workspaces and blocks traversal', () => {
    const root = mkdtempSync(join(tmpdir(),'aa-guard-')); directories.push(root)
    const guard = new PathGuard([root])
    expect(guard.resolveWithin('reports/summary.md')).toBe(join(root,'reports','summary.md'))
    expect(() => guard.resolveWithin('../secret.txt')).toThrow('outside trusted')
    expect(guard.isAllowed(`${root}-lookalike/file`)).toBe(false)
  })

  it('supports spaces, Unicode, and long trusted paths while rejecting missing reads', async () => {
    const root = mkdtempSync(join(tmpdir(),'aa guard ü-')); directories.push(root)
    const nested = join(root,'Client Files','分析',...'x'.repeat(20).match(/.{1,20}/g)!)
    mkdirSync(nested,{ recursive:true }); const file = join(nested,'résumé.txt'); writeFileSync(file,'safe')
    const guard = new PathGuard([root])
    await expect(guard.resolveExisting(file)).resolves.toBe(file)
    await expect(guard.resolveExisting('missing.txt')).rejects.toMatchObject({ code:'ENOENT' })
  })

  const symlinkTest = process.platform === 'win32' ? it.skip : it
  symlinkTest('blocks symlinks that escape a trusted workspace', async () => {
    const root = mkdtempSync(join(tmpdir(),'aa-root-')); const outside = mkdtempSync(join(tmpdir(),'aa-outside-')); directories.push(root,outside)
    writeFileSync(join(outside,'secret.txt'),'secret'); symlinkSync(outside,join(root,'escape'),'dir')
    const guard = new PathGuard([root])
    await expect(guard.resolveExisting('escape/secret.txt')).rejects.toThrow('outside trusted')
    await expect(guard.resolveForWrite('escape/new.txt')).rejects.toThrow('outside trusted')
  })

  it('enforces research-only, overwrite, command, and external-action policy', () => {
    const service = new PermissionService()
    expect(service.decide('research',{ tool:'files.write', operation:'write', target:'x' }).allowed).toBe(false)
    expect(service.decide('standard',{ tool:'files.write', operation:'write', target:'x' }).requiresApproval).toBe(false)
    expect(service.decide('standard',{ tool:'files.write', operation:'write', target:'x', overwrites:true }).requiresApproval).toBe(true)
    expect(service.decide('advanced',{ tool:'system.execute', operation:'execute', target:'x' }).requiresApproval).toBe(true)
    expect(service.decide('advanced',{ tool:'mail.send', operation:'external_action', target:'x' }).risk).toBe('high')
  })

  it('executes a file overwrite only after explicit approval', async () => {
    const root = mkdtempSync(join(tmpdir(),'aa-tools-')); directories.push(root)
    const target = join(root,'report.txt'); writeFileSync(target,'old')
    const database = new OfficeDatabase(':memory:')
    const agent = database.createAgent({ name:'Writer', role:'Writer', description:'', instructions:'', goal:'', avatar:'WR', color:'#123456', provider:'openai', model:'test', workspaceId:null, permissionProfile:'standard', memoryEnabled:false })
    const tools = new ToolRegistry(database,new PathGuard([root]))
    const request = await tools.request(agent,null,{ name:'files.write', input:{ path:'report.txt', content:'new' } })
    expect(request.status).toBe('approval_required')
    const denied = database.decideApproval(request.approval!.id,'denied')
    await expect(tools.executeApproved(denied.id)).rejects.toThrow('claimed or executed')
    const second = await tools.request(agent,null,{ name:'files.write', input:{ path:'report.txt', content:'new' } })
    const approved = database.decideApproval(second.approval!.id,'approved')
    await expect(tools.executeApproved(approved.id)).resolves.toMatchObject({ size:3 })
    expect(database.getApproval(approved.id)?.executionStatus).toBe('completed')
    await expect(tools.executeApproved(approved.id)).rejects.toThrow('already been claimed or executed')
    database.close()
  })

  it('preserves approved command arguments, captures exit data, and blocks tools during emergency stop', async () => {
    const root = mkdtempSync(join(tmpdir(),'aa-command-')); directories.push(root)
    const database = new OfficeDatabase(':memory:'); const agent = database.listAgents()[0]!
    let stopped = false; const tools = new ToolRegistry(database,new PathGuard([root]),undefined,() => stopped)
    const executable = process.platform === 'win32' ? 'cmd.exe' : '/bin/echo'
    const args = process.platform === 'win32' ? ['/d','/s','/c','echo ok'] : ['ok']
    const call = { name:'system.execute' as const, input:{ executable, args, cwd:root } }
    const request = await tools.request(agent,null,call); call.input.args[call.input.args.length - 1] = 'changed'
    const approved = database.decideApproval(request.approval!.id,'approved')
    const output = await tools.executeApproved(approved.id) as { stdout:string; exitCode:number }
    expect(output.exitCode).toBe(0); expect(output.stdout.trim()).toBe('ok')
    stopped = true
    await expect(tools.request(agent,null,{ name:'files.list', input:{ path:'.' } })).rejects.toThrow('stopped')
    database.close()
  })

  it('cancels an active approved command and records failed execution', async () => {
    const root = mkdtempSync(join(tmpdir(),'aa-cancel-')); directories.push(root); const database = new OfficeDatabase(':memory:'); const agent = database.listAgents()[0]!
    const tools = new ToolRegistry(database,new PathGuard([root]))
    const executable = process.platform === 'win32' ? 'cmd.exe' : '/bin/sleep'; const args = process.platform === 'win32' ? ['/d','/s','/c','ping -n 10 127.0.0.1 > nul'] : ['10']
    const request = await tools.request(agent,null,{ name:'system.execute', input:{ executable,args,cwd:root } }); const approved = database.decideApproval(request.approval!.id,'approved')
    const execution = tools.executeApproved(approved.id); await new Promise((resolve) => setTimeout(resolve,20)); tools.abortActive()
    await expect(execution).rejects.toThrow('stopped'); expect(database.getApproval(approved.id)?.executionStatus).toBe('failed'); database.close()
  })
})
