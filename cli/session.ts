import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import createSessionScript from './host/create-session.sh' with { type: 'text' }
import deleteSessionScript from './host/delete-session.sh' with { type: 'text' }
import listSessionsScript from './host/list-sessions.sh' with { type: 'text' }
import prepareScript from './host/prepare.sh' with { type: 'text' }
import runUserCommandsScript from './host/run-user-commands.sh' with { type: 'text' }
import { hostName, sessionId } from './names.ts'
import { home, sessions } from './paths.ts'
import { exec, fail, run, succeeds } from './process.ts'
import unpushedWorkScript from './session/unpushed-work.sh' with { type: 'text' }
import { onHost } from './ssh.ts'

function machine(): string {
  return process.env.AGENTBOX_MACHINE || fail('Set AGENTBOX_MACHINE to the SSH host that runs sessions, or pass --host')
}

// The host a session was created on; sessions from before --host have no record.
function sessionHost(id: string): string {
  const record = join(sessions, id)
  return existsSync(record) ? readFileSync(record, 'utf8').trim() : machine()
}

// A session's container carries the label agentbox.session=<id>. Sessions created
// with DevPod have none; they are found by their workspace volume instead.
function container(id: string): string {
  return `$(docker ps -aq --filter label=agentbox.session=${id} | head -1)`
}

export function repoUrl(spec: string): string {
  // The host has no HTTPS credentials, so clone GitHub over SSH with the forwarded agent.
  if (spec.startsWith('https://github.com/')) {
    const path = spec.slice('https://github.com/'.length).replace('.git@', '@')
    return repoUrl(path.endsWith('.git') ? path.slice(0, -'.git'.length) : path)
  }
  if (spec.includes(':')) return spec
  if (/\/.*@/.test(spec)) {
    const at = spec.indexOf('@')
    return `git@github.com:${spec.slice(0, at)}.git@${spec.slice(at + 1)}`
  }
  if (spec.includes('/')) return `git@github.com:${spec}.git`
  return fail(`Not a git URL or GitHub owner/name: ${spec}`)
}

function openSession(id: string): never {
  if (process.env.CMUX_SOCKET_PATH) exec('cmux', ['ssh', `${id}.agentbox`, '-A', '--name', id])
  exec('ssh', ['-A', `${id}.agentbox`])
}

export async function newSession(id: string, repo: string | undefined, host: string | undefined): Promise<never> {
  sessionId(id)
  const m = host ? hostName(host) : machine()
  let url = repoUrl(repo || process.env.AGENTBOX_REPO || run('git', ['remote', 'get-url', 'origin']).trim())
  let branch = ''
  const at = url.lastIndexOf('.git@')
  if (at >= 0) {
    branch = url.slice(at + '.git@'.length)
    url = url.slice(0, at + '.git'.length)
  }
  onHost(m, prepareScript)
  // Clone on the host with the forwarded agent.
  onHost(m, createSessionScript, [id, url, branch], { forwardAgent: true })
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(sessions, id), `${m}\n`)
  const pubkey = process.env.AGENTBOX_PUBKEY || join(home, '.ssh/id_ed25519.pub')
  run('ssh', [m, `docker exec -i -u 1000 ${container(id)} sh -c 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'`], {
    input: readFileSync(pubkey, 'utf8'),
    stdout: 'inherit',
  })

  // The workspace's lifecycle commands (setup.sh) clone over SSH and need the agent.
  // Hold one forwarding connection into the session open while they run, and point
  // them at its socket; a socket mounted from the host would be gone after a restart.
  const holder = spawn('ssh', ['-n', '-A', `${id}.agentbox`, 'ln -sfn "$SSH_AUTH_SOCK" /tmp/agentbox-agent.sock && exec sleep 3600'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  try {
    for (let i = 0; i < 40; i++) {
      if (succeeds('ssh', [m, `docker exec -u 1000 ${container(id)} test -S /tmp/agentbox-agent.sock`])) break
      await sleep(500)
    }
    onHost(m, runUserCommandsScript, [id])
  } finally {
    holder.kill()
  }
  openSession(id)
}

export function openExisting(id: string): never {
  openSession(sessionId(id))
}

export function listSessions(): void {
  onHost(machine(), listSessionsScript)
}

export function removeSession(id: string): void {
  sessionId(id)
  const m = sessionHost(id)
  if (!run('ssh', [m, `docker ps -aq --filter label=agentbox.session=${id}`]).trim()) {
    fail(`${id} has no agentbox container. A session created with DevPod goes with: devpod delete ${id} --force`)
  }
  const dirty = run('ssh', [`${id}.agentbox`, `sh -s -- ${id}`], { input: unpushedWorkScript }).trim()
  if (dirty) fail(`Not deleting ${id}, unpushed or uncommitted work in:\n${dirty}`)
  onHost(m, deleteSessionScript, [id])
  rmSync(join(sessions, id), { force: true })
}

// Start the container if the host rebooted without it, then hand the connection to sshd.
export function proxy(target: string): never {
  const id = sessionId(target.replace(/\.agentbox$/, ''))
  exec('ssh', [
    sessionHost(id),
    `c=${container(id)}; [ -n "$c" ] || c=$(docker ps -aq --filter volume=/workspaces/${id} | head -1); ` +
      `[ -n "$c" ] || { echo 'No session ${id} on this host' >&2; exit 1; }; ` +
      `docker start $c >/dev/null && exec docker exec -i -u root $c sh -c 'mkdir -p /run/sshd && exec /usr/sbin/sshd -i'`,
  ])
}
