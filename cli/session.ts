import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Refusal, Session } from '../lib/api.ts'
import { hostName, sessionId } from '../lib/names.ts'
import { Exit, exec, fail, run } from '../lib/process.ts'
import { call, connect } from './client.ts'
import { home, hosts, sessions } from './paths.ts'

function machine(): string {
  return process.env.AGENTBOX_MACHINE || fail('Set AGENTBOX_MACHINE to the SSH host that runs sessions, or pass --host')
}

// The host a session was created on; sessions from before --host have no record.
function sessionHost(id: string): string {
  const record = join(sessions, id)
  return existsSync(record) ? readFileSync(record, 'utf8').trim() : machine()
}

// A workspace repo as the host clones it: GitHub over HTTPS, so no forwarded agent is
// needed. owner/name and GitHub URLs may name a branch as @branch.
export function repoSource(spec: string): { repository: string; branch?: string } {
  const github = spec.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?(?:@([^@]+))?$/)
  if (github?.[1]) {
    return { repository: `https://github.com/${github[1]}.git`, branch: github[2] }
  }
  if (spec.includes(':')) return { repository: spec }
  return fail(`Not a git URL or GitHub owner/name: ${spec}`)
}

function openSession(id: string): never {
  if (process.env.CMUX_SOCKET_PATH) exec('cmux', ['ssh', `${id}.agentbox`, '-A', '--name', id])
  exec('ssh', ['-A', `${id}.agentbox`])
}

export async function newSession(id: string, repo: string | undefined, host: string | undefined): Promise<never> {
  sessionId(id)
  const record = join(sessions, id)
  const m = host ? hostName(host) : machine()
  const source = repoSource(repo || process.env.AGENTBOX_REPO || run('git', ['remote', 'get-url', 'origin']).trim())
  const authorizedKey = readFileSync(process.env.AGENTBOX_PUBKEY || join(home, '.ssh/id_ed25519.pub'), 'utf8').trim()
  // Writing the record reserves the id, failing if a session already has it. A refused
  // session releases it; one whose outcome is unknown keeps it, for rm to clear.
  mkdirSync(sessions, { recursive: true })
  try {
    writeFileSync(record, `${m}\n`, { flag: 'wx' })
  } catch {
    fail(`Session ${id} already exists on ${readFileSync(record, 'utf8').trim()}`)
  }
  const refuse = (message: string): never => {
    rmSync(record, { force: true })
    return fail(message)
  }
  await connect(m).catch((error: unknown) => refuse(error instanceof Exit ? error.message : String(error)))
  const created = await call<Session | Refusal>(m, 'POST', '/sessions', { id, ...source, authorizedKey })
  if (created.status === 409) refuse(`Session ${id} already exists on ${m}`)
  if (created.status !== 202) refuse(`agentboxd on ${m} refused session ${id}: ${(created.body as Refusal).error}`)

  // The host sets the session up whatever happens here; this only waits to open it.
  console.log(`Setting up ${id} on ${m}`)
  for (;;) {
    await sleep(2000)
    const { status, body } = await call<Session>(m, 'GET', `/sessions/${id}`)
    if (body?.status === 'ready') break
    if (status === 404 || body?.status === 'failed') fail(`The setup of ${id} failed: ${body?.error ?? `${m} has no session ${id}`}`)
  }
  openSession(id)
}

export function openExisting(id: string): never {
  openSession(sessionId(id))
}

export async function listSessions(): Promise<void> {
  const known = existsSync(hosts) ? readdirSync(hosts).sort() : []
  const all = process.env.AGENTBOX_MACHINE && !known.includes(process.env.AGENTBOX_MACHINE) ? [...known, process.env.AGENTBOX_MACHINE] : known
  for (const host of all) {
    await connect(host)
    const { body } = await call<Session[]>(host, 'GET', '/sessions')
    for (const s of body) console.log([s.id, host, s.status === 'ready' ? s.state : s.status].join('\t'))
  }
}

export async function removeSession(id: string): Promise<void> {
  sessionId(id)
  const m = sessionHost(id)
  await connect(m)
  const { status, body } = await call<Refusal | undefined>(m, 'DELETE', `/sessions/${id}`)
  if (status === 404) fail(`${m} has no session ${id}`)
  if (status === 409 && body?.unpushed) fail(`Not deleting ${id}, unpushed or uncommitted work in:\n${body.unpushed.join('\n')}`)
  if (status === 409) fail(`Not deleting ${id}: ${body?.error}`)
  if (status !== 204) fail(`agentboxd on ${m} did not delete ${id}: ${body?.error}`)
  rmSync(join(sessions, id), { force: true })
}

// ssh's ProxyCommand for <id>.agentbox: starts the container if the host rebooted
// without it, then hands the connection to the container's sshd.
export function proxy(target: string): never {
  const id = sessionId(target.replace(/\.agentbox$/, ''))
  exec('ssh', [
    sessionHost(id),
    `c=$(docker ps -aq --filter label=agentbox.session=${id} | head -1); ` +
      `[ -n "$c" ] || { echo 'No session ${id} on this host' >&2; exit 1; }; ` +
      `docker start $c >/dev/null && exec docker exec -i -u root $c sh -c 'mkdir -p /run/sshd && exec /usr/sbin/sshd -i'`,
  ])
}
