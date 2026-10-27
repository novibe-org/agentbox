import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import chart from '../chart/Chart.yaml' with { type: 'text' }
import setup from '../chart/setup.sh' with { type: 'text' }
import session from '../chart/templates/session.yaml' with { type: 'text' }
import defaults from '../chart/values.yaml' with { type: 'text' }
import { fail } from '../lib/process.ts'
import type { Cluster } from './cluster.ts'

// The session pod marks its setup here; the CLI and the pod's readiness probe read them.
const readyMarker = '/run/agentbox-ready'
const failedMarker = '/run/agentbox-failed'
const setupCheckMs = 3000

export type SessionValues = { repository: string; branch: string; authorizedKey: string }
export type Installed = { outcome: 'installed' } | { outcome: 'taken' } | { outcome: 'refused'; reason: string }

// The chart is part of the binary, so a session always matches the CLI that created it.
function withChart<T>(work: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'agentbox-chart-'))
  try {
    mkdirSync(join(dir, 'templates'))
    writeFileSync(join(dir, 'Chart.yaml'), chart)
    writeFileSync(join(dir, 'values.yaml'), defaults)
    writeFileSync(join(dir, 'setup.sh'), setup)
    writeFileSync(join(dir, 'templates', 'session.yaml'), session)
    return work(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function installSession(cluster: Cluster, id: string, values: SessionValues): Installed {
  const installed = withChart((dir) => {
    const valuesFile = join(dir, 'values.json')
    writeFileSync(valuesFile, JSON.stringify({ ...values, readyMarker, failedMarker }))
    return cluster.attempt('helm', ['install', id, dir, '-f', valuesFile])
  })
  if (installed.status === 0) return { outcome: 'installed' }
  if (/cannot re-use a name that is still in use/.test(installed.stderr)) return { outcome: 'taken' }
  return { outcome: 'refused', reason: installed.stderr.trim() }
}

export async function awaitSetup(cluster: Cluster, id: string): Promise<void> {
  for (;;) {
    await sleep(setupCheckMs)
    if (cluster.run('kubectl', ['get', 'pod', id, '-o', 'jsonpath={.status.containerStatuses[0].ready}']).trim() === 'true') return
    const failed = cluster.attempt('kubectl', ['exec', id, '--', 'cat', failedMarker])
    if (failed.status === 0) fail(`The setup of ${id} failed:\n${failed.stdout.trim()}`)
  }
}

export type ListedSession = { id: string; state: string }

export function listSessionsOn(cluster: Cluster): ListedSession[] {
  const pods = JSON.parse(cluster.run('kubectl', ['get', 'pods', '-l', 'agentbox.session', '-o', 'json'])) as {
    items: { metadata: { name: string }; status: { phase: string; containerStatuses?: { ready: boolean }[] } }[]
  }
  return pods.items.map(({ metadata, status }) => ({
    id: metadata.name,
    state: status.containerStatuses?.[0]?.ready ? 'running' : status.phase.toLowerCase(),
  }))
}

// Lists, inside the dev container, each repo of the workspace with work not yet pushed.
const unpushedWork = (id: string) => `c=$(docker ps -q --filter label=devcontainer.local_folder=/workspaces/${id})
[ -n "$c" ] || exit 3
docker exec -u 1000 -w /workspaces/${id} "$c" sh -c '
for repo in . $(find projects -mindepth 2 -maxdepth 2 -name .git 2>/dev/null | sed "s|/.git$||"); do
  if [ -n "$(git -C "$repo" status --porcelain)" ] || [ -n "$(git -C "$repo" log --branches --not --remotes --oneline)" ]; then echo "$repo"; fi
done'`

export type Removed = { outcome: 'removed' } | { outcome: 'missing' } | { outcome: 'lost' } | { outcome: 'unpushed'; repos: string[] }

export function removeSessionFrom(cluster: Cluster, id: string): Removed {
  if (cluster.attempt('helm', ['status', id]).status !== 0) return { outcome: 'missing' }
  const checked = cluster.attempt('kubectl', ['exec', id, '--', 'sh', '-c', unpushedWork(id)])
  if (checked.status === 3) return { outcome: 'lost' }
  if (checked.status !== 0) fail(`Cannot check the work in ${id}: ${checked.stderr.trim()}`)
  const repos = checked.stdout.split('\n').filter(Boolean)
  if (repos.length) return { outcome: 'unpushed', repos }
  cluster.run('helm', ['uninstall', id, '--wait'])
  return { outcome: 'removed' }
}
