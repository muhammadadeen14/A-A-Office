import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    await expect(tools.executeApproved(denied)).rejects.toThrow('not been approved')
    const second = await tools.request(agent,null,{ name:'files.write', input:{ path:'report.txt', content:'new' } })
    const approved = database.decideApproval(second.approval!.id,'approved')
    await expect(tools.executeApproved(approved)).resolves.toMatchObject({ size:3 })
    database.close()
  })
})
