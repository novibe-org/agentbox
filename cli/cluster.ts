import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, connect as connectTcp } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import chart from '../chart/Chart.yaml' with { type: 'text' }
import setup from '../chart/setup.sh' with { type: 'text' }
import session from '../chart/templates/session.yaml' with { type: 'text' }
import values from '../chart/values.yaml' with { type: 'text' }
import { fail, run } from '../lib/process.ts'
import { hosts } from './paths.ts'

export const kubeconfig = (host: string) => join(hosts, host, 'kubeconfig')

// k3s writes its kubeconfig readable by root only, pointing at 127.0.0.1:6443.
export function fetchKubeconfig(host: string): void {
  const config = run('ssh', ['-o', 'ControlPath=none', host, 'sudo cat /etc/rancher/k3s/k3s.yaml'])
  writeFileSync(kubeconfig(host), config, { mode: 0o600 })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectTcp({ host: '127.0.0.1', port })
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })
}

type Tool = 'kubectl' | 'helm'
type Result = { status: number | null; stdout: string; stderr: string }

// run fails the command on an error; attempt returns the result for the caller to judge.
export type Cluster = { run: (tool: Tool, args: string[]) => string; attempt: (tool: Tool, args: string[]) => Result }

// The host's Kubernetes API answers the host and its pods only, so every call goes through an SSH tunnel.
export async function withCluster<T>(host: string, work: (cluster: Cluster) => Promise<T>): Promise<T> {
  const port = await freePort()
  const tunnel = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ControlPath=none', '-L', `${port}:127.0.0.1:6443`, host], {
    stdio: 'ignore',
  })
  try {
    for (let i = 0; !(await answers(port)); i++) {
      if (i === 50 || tunnel.exitCode !== null) fail(`Cannot reach the Kubernetes API of ${host} through SSH`)
      await sleep(200)
    }
    const server = `https://127.0.0.1:${port}`
    const connection = (tool: Tool) => ['--kubeconfig', kubeconfig(host), tool === 'helm' ? '--kube-apiserver' : '--server', server]
    return await work({
      run: (tool, args) => run(tool, [...connection(tool), ...args]),
      attempt: (tool, args) => spawnSync(tool, [...connection(tool), ...args], { encoding: 'utf8' }),
    })
  } finally {
    tunnel.kill()
  }
}

// The chart is part of the binary, so a session always matches the CLI that created it.
export function withChart<T>(work: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'agentbox-chart-'))
  try {
    mkdirSync(join(dir, 'templates'))
    writeFileSync(join(dir, 'Chart.yaml'), chart)
    writeFileSync(join(dir, 'values.yaml'), values)
    writeFileSync(join(dir, 'setup.sh'), setup)
    writeFileSync(join(dir, 'templates', 'session.yaml'), session)
    return work(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
