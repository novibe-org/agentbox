import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { chmodSync, rmSync } from 'node:fs'
import { version } from '../package.json'
import type { SessionRequest } from '../lib/api.ts'
import { idPattern } from '../lib/names.ts'
import { health } from './health.ts'
import { deleteSession, getSession, listSessions, recoverSessions, startSession } from './sessions.ts'

function send(res: ServerResponse, status: number, body?: unknown, type = 'application/json'): void {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  res.writeHead(status, { 'content-type': type }).end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let text = ''
  for await (const chunk of req) text += chunk
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isSessionRequest(body: unknown): body is SessionRequest {
  const r = body as Partial<SessionRequest> | undefined
  return (
    typeof r?.id === 'string' &&
    idPattern.test(r.id) &&
    typeof r.repository === 'string' &&
    !r.repository.startsWith('-') &&
    (r.branch === undefined || (typeof r.branch === 'string' && !r.branch.startsWith('-'))) &&
    typeof r.authorizedKey === 'string' &&
    !r.authorizedKey.includes('\n')
  )
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://agentboxd').pathname
  if (path === '/health' && req.method === 'GET') {
    const report = await health()
    return send(res, report.status === 'pass' ? 200 : 503, report, 'application/health+json')
  }
  if (path === '/sessions' && req.method === 'GET') return send(res, 200, await listSessions())
  if (path === '/sessions' && req.method === 'POST') {
    const body = await readJson(req)
    if (!isSessionRequest(body)) return send(res, 400, { error: 'A session needs an id, a repository and an authorizedKey' })
    const session = await startSession(body)
    return session ? send(res, 202, session) : send(res, 409, { error: `Session ${body.id} exists` })
  }
  const id = path.match(/^\/sessions\/([^/]+)$/)?.[1]
  if (id && idPattern.test(id) && req.method === 'GET') {
    const session = await getSession(id)
    return session ? send(res, 200, session) : send(res, 404, { error: `No session ${id}` })
  }
  if (id && idPattern.test(id) && req.method === 'DELETE') {
    const result = await deleteSession(id)
    if (result === 'deleted') return send(res, 204)
    if (result === 'missing') return send(res, 404, { error: `No session ${id}` })
    return send(res, 409, result)
  }
  send(res, 404, { error: `No ${req.method} ${path}` })
}

export function serve(socket: string): void {
  recoverSessions()
  rmSync(socket, { force: true })
  const server = http.createServer((req, res) => {
    route(req, res).catch((error: Error) => {
      console.error(error)
      send(res, 500, { error: error.message })
    })
  })
  server.listen(socket, () => {
    chmodSync(socket, 0o600)
    console.log(`agentboxd ${version} on ${socket}`)
  })
}
