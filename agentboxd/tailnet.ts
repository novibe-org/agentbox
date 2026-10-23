import { rmSync, writeFileSync } from 'node:fs'
import type { TailnetRequest } from '../lib/api.ts'
import { execute } from './sessions.ts'

const setup = `set -e
mkdir -p /var/lib/agentbox/tailscale /var/lib/tailscale
grep -q " /var/lib/tailscale " /etc/fstab || echo "/var/lib/agentbox/tailscale /var/lib/tailscale none bind 0 0" >> /etc/fstab
mountpoint -q /var/lib/tailscale || mount /var/lib/tailscale
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
`

export async function joinTailnet({ authKey, hostname }: TailnetRequest): Promise<string | undefined> {
  const installed = await execute('sudo', ['sh', '-s'], { input: setup })
  if (installed.status !== 0) return `Tailscale did not install: ${installed.stderr.trim().split('\n').at(-1)}`
  const key = '/run/agentboxd/tailnet-key'
  writeFileSync(key, authKey, { mode: 0o600 })
  try {
    const up = await execute('sudo', ['tailscale', 'up', `--auth-key=file:${key}`, `--hostname=${hostname}`])
    if (up.status !== 0) return `The host did not join the tailnet: ${up.stderr.trim().split('\n').at(-1)}`
  } finally {
    rmSync(key, { force: true })
  }
}
