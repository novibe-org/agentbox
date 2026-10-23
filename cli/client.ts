import { spawn } from 'node:child_process'
import http from 'node:http'
import type { Socket } from 'node:net'
import { Duplex } from 'node:stream'
import { version } from '../package.json'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Health, Session } from '../lib/api.ts'
import { fail, run } from '../lib/process.ts'

export type Response<T> = { status: number; body: T }

export function request<T>(host: string, method: string, path: string, body?: unknown, ssh: string[] = []): Promise<Response<T>> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...ssh, host, 'agentboxd', 'dial-stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (data) => (stderr += data))
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const headers: Record<string, string | number> = { connection: 'close' }
    if (payload !== undefined) Object.assign(headers, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
    const req = http.request(
      {
        method,
        path,
        host: 'agentboxd',
        headers,
        createConnection: () => Duplex.from({ writable: child.stdin, readable: child.stdout } as never) as Socket,
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (data) => (text += data))
        res.on('end', () => {
          child.kill()
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined })
        })
      },
    )
    req.on('error', (error) => {
      child.kill()
      reject(new Error(stderr.trim() || error.message))
    })
    req.end(payload)
  })
}

export async function call<T>(host: string, method: string, path: string, body?: unknown): Promise<Response<T>> {
  try {
    return await request<T>(host, method, path, body)
  } catch (error) {
    return fail(`agentboxd on ${host} does not answer: ${(error as Error).message}`)
  }
}

function older(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  return false
}

// AGENTBOX_AGENTBOXD names a local build to install instead of the release's.
async function update(host: string, from: string): Promise<void> {
  const { body: sessions } = await call<Session[]>(host, 'GET', '/sessions')
  const busy = sessions.find((s) => s.status === 'creating')
  if (busy) fail(`${host} cannot be updated while ${busy.id} is being set up: try again once it is set up`)
  const local = process.env.AGENTBOX_AGENTBOXD
  if (local) run('scp', ['-q', local, `${host}:/tmp/agentboxd.new`])
  else run('ssh', [host, `curl -fsSLo /tmp/agentboxd.new https://github.com/novibe-org/agentbox/releases/download/v${version}/agentboxd-linux-x64`])
  run('ssh', [
    host,
    'sudo install -m 755 /tmp/agentboxd.new /usr/local/bin/agentboxd.new && sudo mv -f /usr/local/bin/agentboxd.new /usr/local/bin/agentboxd && rm /tmp/agentboxd.new && sudo systemctl restart agentboxd',
  ])
  for (let i = 0; i < 30; i++) {
    const health = await request<Health>(host, 'GET', '/health').catch(() => undefined)
    if (health?.body?.version === version) return console.log(`Updated ${host} from ${from} to ${version}`)
    await sleep(2000)
  }
  fail(`${host} does not answer as agentboxd ${version} after its update: ssh ${host} journalctl -u agentboxd to look`)
}

export async function connect(host: string): Promise<void> {
  const { body } = await call<Health>(host, 'GET', '/health')
  if (body?.version === version) return
  if (body?.version && older(body.version, version)) return update(host, body.version)
  fail(`Host ${host} runs agentboxd ${body?.version ?? 'of an unknown version'}, and this agentbox is ${version}: use agentbox ${body?.version} for it`)
}
