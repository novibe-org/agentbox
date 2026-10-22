export const socketPath = '/run/agentboxd/agentboxd.sock'

export type Check = { status: 'pass' | 'fail'; output?: string }

export type Health = {
  status: 'pass' | 'fail'
  version: string
  checks: Record<string, Check[]>
}

export type SessionRequest = {
  id: string
  repository: string
  branch?: string
  authorizedKey: string
}

export type Session = {
  id: string
  status: 'creating' | 'ready' | 'failed'
  state?: string
  error?: string
}

export type Refusal = {
  error: string
  unpushed?: string[]
}
