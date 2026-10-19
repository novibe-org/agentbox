import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Session, SessionRequest } from '../lib/api.ts'
import { onPath } from '../lib/process.ts'

export const root = '/var/lib/agentbox'
const sessionsDir = join(root, 'sessions')
// Mounted into every session by the Feature, so they must exist before one is built.
const shared = ['claude', 'gh', 'git', 'pnpm-store']

// Sessions being created, and those whose creation failed. A ready session is its container.
const pending = new Map<string, Session>()

type Result = { status: number; stdout: string; stderr: string }

// Runs a command without blocking the API; its errors go to agentboxd's log too.
export function execute(command: string, args: string[], { input = '', env = {} } = {}): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => {
      stderr += data
      process.stderr.write(data)
    })
    child.on('error', (error) => resolve({ status: 127, stdout, stderr: error.message }))
    child.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr }))
    child.stdin.end(input)
  })
}

// Why a command failed: the Dev Container CLI ends its output with a JSON outcome, other
// commands with their last line of errors.
function reason({ stdout, stderr }: Result): string {
  try {
    const outcome = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
    if (outcome?.outcome === 'error') return [outcome.message, outcome.description].filter(Boolean).join(': ')
  } catch {}
  return stderr.trim().split('\n').filter((line) => !/^\s+at /.test(line)).at(-1) ?? ''
}

async function run(command: string, args: string[], options: { input?: string; env?: Record<string, string> } = {}): Promise<string> {
  const result = await execute(command, args, options)
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed${reason(result) ? `: ${reason(result)}` : ''}`)
  return result.stdout
}

async function container(id: string): Promise<string | undefined> {
  return (await run('docker', ['ps', '-aq', '--filter', `label=agentbox.session=${id}`])).split('\n').find(Boolean)
}

export async function listSessions(): Promise<Session[]> {
  const format = '{{.Label "agentbox.session"}}\t{{.State}}'
  const lines = (await run('docker', ['ps', '-a', '--filter', 'label=agentbox.session', '--format', format])).split('\n').filter(Boolean)
  const ready = lines
    .map((line): Session => {
      const [id = '', state] = line.split('\t')
      return { id, status: 'ready', state }
    })
    .filter((session) => !pending.has(session.id))
  return [...ready, ...pending.values()]
}

export async function getSession(id: string): Promise<Session | undefined> {
  const session = pending.get(id)
  if (session) return session
  const c = await container(id)
  if (!c) return undefined
  return { id, status: 'ready', state: (await run('docker', ['inspect', '-f', '{{.State.Status}}', c])).trim() }
}

// Accepts the session and creates it in the background; false if the id is taken.
export async function startSession(request: SessionRequest): Promise<Session | false> {
  if (pending.get(request.id)?.status === 'creating') return false
  const session: Session = { id: request.id, status: 'creating' }
  pending.set(request.id, session)
  if (await container(request.id)) {
    pending.delete(request.id)
    return false
  }
  createSession(request).then(
    () => pending.delete(request.id),
    (error: Error) => {
      console.error(`Session ${request.id} failed: ${error.message}`)
      pending.set(request.id, { id: request.id, status: 'failed', error: error.message })
    },
  )
  return session
}

// GitHub over HTTPS with the host's GitHub login if it has one, else without credentials.
function credentials(): string[] {
  if (!onPath('gh')) return []
  return ['-c', 'credential.https://github.com.helper=', '-c', 'credential.https://github.com.helper=!gh auth git-credential']
}

async function createSession({ id, repository, branch, authorizedKey }: SessionRequest): Promise<void> {
  for (const dir of [...shared, 'sessions']) mkdirSync(join(root, dir), { recursive: true })
  const dir = join(sessionsDir, id)
  // Clone fresh every time. A clone left by an earlier session may carry changes its
  // agent made, and devcontainer.json's initializeCommand runs on the host.
  rmSync(dir, { recursive: true, force: true })
  await run('git', [...credentials(), 'clone', '-q', ...(branch ? ['-b', branch] : []), '--', repository, dir], {
    env: { GIT_TERMINAL_PROMPT: '0', GH_CONFIG_DIR: join(root, 'gh') },
  })
  // The Dev Container CLI writes a lockfile into the clone unless the repo has one, which
  // would leave every session with uncommitted work. Use a committed one; else write none.
  const locked = existsSync(join(dir, '.devcontainer/devcontainer-lock.json')) || existsSync(join(dir, '.devcontainer-lock.json'))
  const workspace = ['--workspace-folder', dir, '--id-label', `agentbox.session=${id}`]
  await run('devcontainer', ['up', ...workspace, '--skip-post-create', ...(locked ? [] : ['--no-lockfile'])])
  const c = await container(id)
  if (!c) throw new Error('devcontainer up left no container')
  await run('docker', ['exec', '-i', '-u', '1000', c, 'sh', '-c', 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'], {
    input: `${authorizedKey.trim()}\n`,
  })
  await run('devcontainer', ['run-user-commands', ...workspace])
}

// The workspace repo and each repo under projects/ with uncommitted or unpushed work.
async function unpushedWork(dir: string): Promise<string[]> {
  const projects = existsSync(join(dir, 'projects'))
    ? readdirSync(join(dir, 'projects'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `projects/${entry.name}`)
    : []
  const unpushed: string[] = []
  for (const repo of ['.', ...projects]) {
    const path = join(dir, repo)
    if (!existsSync(join(path, '.git'))) continue
    const status = await run('git', ['-C', path, 'status', '--porcelain'])
    const commits = await run('git', ['-C', path, 'log', '--branches', '--not', '--remotes', '--oneline'])
    if (status.trim() || commits.trim()) unpushed.push(repo)
  }
  return unpushed
}

export async function deleteSession(id: string): Promise<'deleted' | 'missing' | { unpushed: string[] }> {
  const c = await container(id)
  if (!c) return 'missing'
  const dir = join(sessionsDir, id)
  const unpushed = await unpushedWork(dir)
  if (unpushed.length) return { unpushed }
  // The Dev Container CLI builds <name>-features, then <name>-features-uid on top for the container.
  const image = (await run('docker', ['inspect', '-f', '{{.Config.Image}}', c])).trim()
  await run('docker', ['rm', '-f', c])
  await execute('docker', ['rmi', image, image.replace(/-uid$/, '')])
  rmSync(dir, { recursive: true, force: true })
  pending.delete(id)
  return 'deleted'
}
