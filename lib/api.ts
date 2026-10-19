// The contract between the CLI and agentboxd, as described in agentboxd/openapi.yaml.

export const socketPath = '/run/agentboxd/agentboxd.sock'

export type Check = { status: 'pass' | 'fail'; output?: string }

// IETF draft "Health Check Response Format for HTTP APIs", served as application/health+json.
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
  // The container's state once it exists, as Docker reports it: running, exited, ...
  state?: string
  error?: string
}

export type Refusal = {
  error: string
  // Repos in the session with uncommitted or unpushed work, when a delete is refused for them.
  unpushed?: string[]
}
