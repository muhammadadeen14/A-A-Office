import type { PermissionProfile, RiskLevel } from '../../shared/domain'

export interface ToolRequest {
  tool: string
  operation: 'read' | 'write' | 'execute' | 'external_action'
  target: string
  overwrites?: boolean
}

export interface PermissionDecision {
  allowed: boolean
  requiresApproval: boolean
  risk: RiskLevel
  reason: string
}

export class PermissionService {
  decide(profile: PermissionProfile, request: ToolRequest): PermissionDecision {
    if (request.operation === 'external_action') return { allowed: true, requiresApproval: true, risk: 'high', reason: 'External side effects always require explicit approval.' }
    if (request.operation === 'execute') return { allowed: profile !== 'research', requiresApproval: true, risk: 'high', reason: profile === 'research' ? 'Research-only agents cannot execute commands.' : 'Command execution requires approval.' }
    if (request.operation === 'write') {
      if (profile === 'research') return { allowed: false, requiresApproval: false, risk: 'medium', reason: 'Research-only agents cannot write files.' }
      if (request.overwrites) return { allowed: true, requiresApproval: true, risk: 'medium', reason: 'Overwriting a file requires approval.' }
      return { allowed: true, requiresApproval: false, risk: 'low', reason: 'Creating a new file in the trusted workspace is allowed.' }
    }
    return { allowed: true, requiresApproval: false, risk: 'low', reason: 'Read access is limited to trusted workspaces.' }
  }
}
