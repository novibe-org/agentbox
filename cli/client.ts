import { spawn } from 'node:child_process'
import http from 'node:http'
import type { Socket } from 'node:net'
import { Duplex } from 'node:stream'
import { version } from '../package.json'
import type { Health } from '../lib/api.ts'
import { fail } from '../lib/process.ts'

export type Response<T> = { status: number; body: T }

// One HTTP request to agentboxd on the host, over `ssh <host> agentboxd dial-stdio`.
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
        // Node accepts a pair of streams here; its types only know web streams.
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

// The CLI and agentboxd change together, so a host on another version is refused.
export async function connect(host: string): Promise<void> {
  const { body } = await call<Health>(host, 'GET', '/health')
  if (body?.version !== version) {
    fail(`Host ${host} runs agentboxd ${body?.version ?? 'of an unknown version'}, and this agentbox is ${version}: use agentbox ${body?.version} for it`)
  }
}
