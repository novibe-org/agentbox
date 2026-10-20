import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Refusal, Session, SessionRequest } from '../lib/api.ts'
import { onPath } from '../lib/process.ts'

export const root = '/var/lib/agentbox'
const sessionsDir = join(root, 'sessions')
// Mounted into every session by the Feature, so they must exist before one is built.
const shared = ['claude', 'gh', 'git', 'pnpm-store']

// Each session's record, <id>.json next to its clone, holds whether its setup finished
// or why it failed; the container and the clone hold the rest. Only agentboxd writes it.
const recordPath = (id: string) => join(sessionsDir, `${id}.json`)

function readRecord(id: string): Session | undefined {
  try {
    return JSON.parse(readFileSync(recordPath(id), 'utf8')) as Session
  } catch {
    return undefined
  }
}

function writeRecord(session: Session): void {
  const path = recordPath(session.id)
  writeFileSync(`${path}.tmp`, JSON.stringify(session))
  renameSync(`${path}.tmp`, path)
}

// Sessions this agentboxd is setting up right now.
const creating = new Set<string>()

// A setup that agentboxd did not live to finish has failed.
export function recoverSessions(): void {
  mkdirSync(sessionsDir, { recursive: true })
  for (const file of readdirSync(sessionsDir).filter((name) => name.endsWith('.json'))) {
    const session = readRecord(file.slice(0, -'.json'.length))
    if (session?.status === 'creating') writeRecord({ ...session, status: 'failed', error: 'agentboxd restarted during setup' })
  }
}

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
  const states = new Map(lines.map((line) => line.split('\t') as [string, string]))
  return readdirSync(sessionsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readRecord(name.slice(0, -'.json'.length)))
    .filter((session) => session !== undefined)
    .map((session) => (session.status === 'ready' ? { ...session, state: states.get(session.id) ?? 'missing' } : session))
}

export async function getSession(id: string): Promise<Session | undefined> {
  const session = readRecord(id)
  if (session?.status !== 'ready') return session
  const c = await container(id)
  return { ...session, state: c ? (await run('docker', ['inspect', '-f', '{{.State.Status}}', c])).trim() : 'missing' }
}

// Accepts the session and creates it in the background; false if the id is taken.
export async function startSession(request: SessionRequest): Promise<Session | false> {
  const session: Session = { id: request.id, status: 'creating' }
  mkdirSync(sessionsDir, { recursive: true })
  // Writing the record reserves the id, failing if a session already has it.
  try {
    writeFileSync(recordPath(request.id), JSON.stringify(session), { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  let taken: boolean
  try {
    taken = (await container(request.id)) !== undefined
  } catch (error) {
    rmSync(recordPath(request.id), { force: true })
    throw error
  }
  if (taken) {
    rmSync(recordPath(request.id), { force: true })
    return false
  }
  creating.add(request.id)
  createSession(request)
    .then(
      () => writeRecord({ id: request.id, status: 'ready' }),
      (error: Error) => {
        console.error(`Session ${request.id} failed: ${error.message}`)
        writeRecord({ id: request.id, status: 'failed', error: error.message })
      },
    )
    .finally(() => creating.delete(request.id))
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
// git runs in the session's container: a repo's own config, which the session's agent
// can write, may run commands, and must never do so on the host. A repo git cannot
// check counts as unpushed, so its work is never deleted unseen.
async function unpushedWork(c: string, id: string): Promise<string[]> {
  await run('docker', ['start', c])
  const workspace = `/workspaces/${id}`
  const git = (repo: string, ...args: string[]) => execute('docker', ['exec', '-u', '1000', '-w', `${workspace}/${repo}`, c, 'git', ...args])
  const listed = await execute('docker', ['exec', '-u', '1000', '-w', workspace, c, 'find', 'projects', '-mindepth', '2', '-maxdepth', '2', '-name', '.git'])
  if (listed.status !== 0 && !/No such file/.test(listed.stderr)) throw new Error(`Cannot list the repos of ${id}: ${reason(listed)}`)
  const repos = ['.', ...listed.stdout.split('\n').filter(Boolean).map((path) => path.replace(/\/\.git$/, ''))]
  const unpushed: string[] = []
  for (const repo of repos) {
    const status = await git(repo, 'status', '--porcelain')
    const commits = await git(repo, 'log', '--branches', '--not', '--remotes', '--oneline')
    if (status.status !== 0 || commits.status !== 0 || status.stdout.trim() || commits.stdout.trim()) unpushed.push(repo)
  }
  return unpushed
}

export async function deleteSession(id: string): Promise<'deleted' | 'missing' | Refusal> {
  if (creating.has(id)) return { error: `Session ${id} is being set up` }
  const c = await container(id)
  if (!c && !readRecord(id)) return 'missing'
  // Without a container no agent ran, so a clone left by a failed setup holds no work.
  if (c) {
    const unpushed = await unpushedWork(c, id)
    if (unpushed.length) return { error: `Session ${id} has unpushed or uncommitted work`, unpushed }
    // The Dev Container CLI builds <name>-features, then <name>-features-uid on top for the container.
    const image = (await run('docker', ['inspect', '-f', '{{.Config.Image}}', c])).trim()
    await run('docker', ['rm', '-f', c])
    await execute('docker', ['rmi', image, image.replace(/-uid$/, '')])
  }
  rmSync(join(sessionsDir, id), { recursive: true, force: true })
  rmSync(recordPath(id), { force: true })
  return 'deleted'
}
