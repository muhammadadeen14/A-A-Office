import { z } from 'zod'
import { agentStatuses, permissionProfiles, riskLevels, taskStatuses } from './domain'

export const idSchema = z.string().uuid()

export const agentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(''),
  instructions: z.string().max(20_000).default(''),
  goal: z.string().max(2000).default(''),
  avatar: z.string().max(8).default('OA'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#5B7CFA'),
  provider: z.string().max(80).default('openai'),
  model: z.string().max(120).default('gpt-4.1-mini'),
  workspaceId: z.string().uuid().nullable().default(null),
  permissionProfile: z.enum(permissionProfiles).default('standard'),
  memoryEnabled: z.boolean().default(true)
})

export const agentUpdateSchema = agentInputSchema.partial().extend({ status: z.enum(agentStatuses).optional() })

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(20_000),
  assignedAgentId: z.string().uuid().nullable().default(null),
  parentTaskId: z.string().uuid().nullable().default(null),
  priority: z.number().int().min(0).max(4).default(2)
})

export const taskTransitionSchema = z.object({ id: idSchema, status: z.enum(taskStatuses) })

export const approvalInputSchema = z.object({
  agentId: z.string().uuid().nullable(),
  taskId: z.string().uuid().nullable(),
  actionType: z.string().min(1).max(100),
  description: z.string().min(1).max(4000),
  target: z.string().max(2000),
  reason: z.string().max(4000),
  payload: z.string().max(20_000),
  risk: z.enum(riskLevels)
})

export const providerInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['openai', 'compatible']),
  baseUrl: z.string().url().refine((url) => url.startsWith('https://') || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost'), 'Provider URL must use HTTPS or local HTTP'),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().max(1000).optional()
})

export const memoryInputSchema = z.object({
  agentId: z.string().uuid().nullable(),
  taskId: z.string().uuid().nullable(),
  category: z.enum(['conversation', 'agent', 'task', 'preference', 'context']),
  content: z.string().trim().min(1).max(100_000)
})

export const commandInputSchema = z.object({
  message: z.string().trim().min(1).max(40_000),
  agentId: z.string().uuid().optional()
})
