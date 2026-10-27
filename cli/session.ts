import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostName, sessionId } from '../lib/names.ts'
import { Exit, exec, fail, run } from '../lib/process.ts'
import { awaitSetup, installSession, listSessionsOn, removeSessionFrom } from './chart.ts'
import { withCluster } from './cluster.ts'
import { home, hosts, sessions } from './paths.ts'

function machine(): string {
  return process.env.AGENTBOX_MACHINE || fail('Set AGENTBOX_MACHINE to the SSH host that runs sessions, or pass --host')
}

function sessionHost(id: string): string {
  const record = join(sessions, id)
  return existsSync(record) ? readFileSync(record, 'utf8').trim() : machine()
}

export function repoSource(spec: string): { repository: string; branch?: string } {
  const github = spec.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?(?:@([^@]+))?$/)
  if (github?.[1]) {
    return { repository: `https://github.com/${github[1]}.git`, branch: github[2] }
  }
  if (spec.includes(':')) return { repository: spec }
  return fail(`Not a git URL or GitHub owner/name: ${spec}`)
}

function openSession(id: string): never {
  if (process.env.CMUX_SOCKET_PATH) openInCmux(id)
  exec('ssh', ['-A', `${id}.agentbox`])
}

type CmuxWorkspace = { ref: string; remote?: { destination?: string | null } }
type CmuxSession = { session_id: string; attachments: unknown[] }
type CmuxPane = { ref: string; focused: boolean }

function cmux<T>(args: string[]): T {
  return JSON.parse(run('cmux', [...args, '--json']))
}

function openInCmux(id: string): never {
  const workspace = cmux<{ workspaces: CmuxWorkspace[] }>(['workspace', 'list']).workspaces.find(
    (w) => w.remote?.destination === `${id}.agentbox`,
  )
  if (!workspace) exec('cmux', ['ssh', `${id}.agentbox`, '-A', '--name', id])
  run('cmux', ['select-workspace', '--workspace', workspace.ref], { stdout: 'ignore' })
  const panes = cmux<{ panes: CmuxPane[] }>(['list-panes', '--workspace', workspace.ref]).panes
  const pane = panes.find((p) => p.focused) ?? panes[0]
  const lost = cmux<{ sessions: CmuxSession[] }>(['ssh-session-list', '--workspace', workspace.ref]).sessions.filter(
    (s) => !s.attachments.length,
  )
  for (const s of lost) {
    run('cmux', ['ssh-session-attach', '--session-id', s.session_id, '--workspace', workspace.ref, ...(pane ? ['--pane', pane.ref] : [])], {
      stdout: 'ignore',
    })
  }
  if (lost.length) console.error(`Brought back ${lost.length} ${lost.length === 1 ? 'tab' : 'tabs'} of ${id}`)
  process.exit(0)
}

export async function newSession(id: string, repo: string | undefined, host: string | undefined): Promise<never> {
  sessionId(id)
  const record = join(sessions, id)
  const m = host ? hostName(host) : machine()
  const source = repoSource(repo || process.env.AGENTBOX_REPO || run('git', ['remote', 'get-url', 'origin']).trim())
  const authorizedKey = readFileSync(process.env.AGENTBOX_PUBKEY || join(home, '.ssh/id_ed25519.pub'), 'utf8').trim()
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
  await withCluster(m, async (cluster) => {
    const installed = installSession(cluster, id, { repository: source.repository, branch: source.branch ?? '', authorizedKey })
    if (installed.outcome === 'taken') refuse(`Session ${id} already exists on ${m}`)
    if (installed.outcome === 'refused') refuse(`${m} did not take session ${id}: ${installed.reason}`)
    console.log(`Setting up ${id} on ${m}`)
    await awaitSetup(cluster, id)
  })
  openSession(id)
}

export function openExisting(id: string): never {
  openSession(sessionId(id))
}

export async function listSessions(): Promise<void> {
  const known = existsSync(hosts) ? readdirSync(hosts).sort() : []
  const all = process.env.AGENTBOX_MACHINE && !known.includes(process.env.AGENTBOX_MACHINE) ? [...known, process.env.AGENTBOX_MACHINE] : known
  if (!all.length) return console.error('No hosts yet: agentbox host create <name> --provider hetzner')
  let unreachable = false
  let listed = 0
  for (const host of all) {
    try {
      const found = await withCluster(host, async (cluster) => listSessionsOn(cluster))
      for (const s of found) console.log([s.id, host, s.state].join('\t'))
      listed += found.length
    } catch (error) {
      if (!(error instanceof Exit)) throw error
      console.error(`${host} does not answer: ${error.message}`)
      unreachable = true
    }
  }
  if (!listed && !unreachable) console.error(`No sessions yet: agentbox new <id> <repo> --host ${all[0]}`)
  if (unreachable) throw new Exit(1)
}

export async function removeSession(id: string): Promise<void> {
  sessionId(id)
  const m = sessionHost(id)
  const removed = await withCluster(m, async (cluster) => removeSessionFrom(cluster, id))
  if (removed.outcome === 'missing') fail(`${m} has no session ${id}`)
  if (removed.outcome === 'lost') fail(`Session ${id} has lost its container, so its work cannot be checked; its workspace stays on ${m}`)
  if (removed.outcome === 'unpushed') fail(`Not deleting ${id}, unpushed or uncommitted work in:\n${removed.repos.join('\n')}`)
  rmSync(join(sessions, id), { force: true })
}

export function proxy(target: string): never {
  const id = sessionId(target.replace(/\.agentbox$/, ''))
  const startSshd = `c=$(docker ps -q --filter label=devcontainer.local_folder=/workspaces/${id}); ` +
    `[ -n "$c" ] || { echo "No session ${id} on this host" >&2; exit 1; }; ` +
    `exec docker exec -i -u root $c sh -c "mkdir -p -m 755 /run/sshd && exec /usr/sbin/sshd -i -e"`
  exec('ssh', [sessionHost(id), `sudo k3s kubectl exec -i ${id} -- sh -c '${startSshd}'`])
}
