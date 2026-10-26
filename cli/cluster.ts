import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { createServer, connect as connectTcp } from 'node:net'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { attempt, fail, onPath, run, type Outcome } from '../lib/process.ts'
import { hosts } from './paths.ts'

const apiPort = 6443
const tunnelChecks = 50
const tunnelCheckMs = 200

const kubeconfig = (host: string) => join(hosts, host, 'kubeconfig')

// k3s writes its kubeconfig readable by root only, pointing at 127.0.0.1.
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

async function awaitTunnel(port: number, tunnel: ChildProcess, host: string): Promise<void> {
  for (let check = 0; !(await answers(port)); check++) {
    if (check === tunnelChecks || tunnel.exitCode !== null) fail(`Cannot reach the Kubernetes API of ${host} through SSH`)
    await sleep(tunnelCheckMs)
  }
}

type Tool = 'kubectl' | 'helm'

export type Cluster = { run: (tool: Tool, args: string[]) => string; attempt: (tool: Tool, args: string[]) => Outcome }

// The host's Kubernetes API answers the host and its pods only, so every call goes through an SSH tunnel.
export async function withCluster<T>(host: string, work: (cluster: Cluster) => Promise<T>): Promise<T> {
  if (!existsSync(kubeconfig(host))) fail(`Host ${host} has no Kubernetes access: it was created by an agentbox before 0.5, so create it again`)
  if (!onPath('helm') || !onPath('kubectl')) fail('agentbox needs Helm and kubectl for sessions: brew install helm kubernetes-cli')
  const port = await freePort()
  const tunnel = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ControlPath=none', '-L', `${port}:127.0.0.1:${apiPort}`, host], {
    stdio: 'ignore',
  })
  try {
    await awaitTunnel(port, tunnel, host)
    const server = `https://127.0.0.1:${port}`
    const connectionFlags = (tool: Tool) => ['--kubeconfig', kubeconfig(host), tool === 'helm' ? '--kube-apiserver' : '--server', server]
    return await work({
      run: (tool, args) => run(tool, [...connectionFlags(tool), ...args]),
      attempt: (tool, args) => attempt(tool, [...connectionFlags(tool), ...args]),
    })
  } finally {
    tunnel.kill()
  }
}
