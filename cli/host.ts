import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { version } from '../package.json'
import type { Health } from '../lib/api.ts'
import { hostName } from '../lib/names.ts'
import { fail, onPath, run, succeeds } from '../lib/process.ts'
import { call, connect, request } from './client.ts'
import { hosts } from './paths.ts'
import { writeSshConfig } from './ssh.ts'

export const providers = ['hetzner']

export async function createHost(name: string, _provider: string, tailnet: boolean): Promise<void> {
  hostName(name)
  const d = join(hosts, name)
  if (existsSync(d)) fail(`Host ${name} already exists`)
  if (!process.env.HCLOUD_TOKEN) {
    fail(
      'agentbox needs an API token for a Hetzner project: create one in the Hetzner Console under Security > API tokens, with read and write access, and set HCLOUD_TOKEN',
    )
  }
  if (tailnet) requireTailnetAccess()
  if (!onPath('tofu')) fail('agentbox needs OpenTofu to create hosts: https://opentofu.org/docs/intro/install/')

  mkdirSync(d, { recursive: true })
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `agentbox-${name}`, '-f', join(d, 'id_ed25519')])
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', join(d, 'ssh_host_ed25519_key')])
  const hostKey = readFileSync(join(d, 'ssh_host_ed25519_key.pub'), 'utf8').split(' ').slice(0, 2).join(' ')
  writeFileSync(join(d, 'known_hosts'), `${name} ${hostKey}\n`)
  writeFileSync(join(d, 'main.tf'), rootModule(name, tailnet))
  console.log(`Creating server ${name} on Hetzner`)
  run('tofu', [`-chdir=${d}`, 'init', '-input=false'], { stdout: 'ignore' })
  run('tofu', [`-chdir=${d}`, 'apply', '-input=false', '-auto-approve'], { stdout: 'ignore' })
  const address = await hostAddress(d)
  if (!/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$|^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(address)) fail(`OpenTofu gave no address for ${name}: ${address}`)
  console.log(`Server ${name} is up at ${address}, setting it up`)
  writeEntry(name, d, address)

  const once = ['-o', 'ConnectTimeout=5', '-o', 'ControlPath=none']
  let waiting = ''
  for (let i = 0; i < 60; i++) {
    const health = await request<Health>(name, 'GET', '/health', undefined, once).catch(() => undefined)
    if (health?.body?.status === 'pass') {
      console.log(`Replacing the host key of ${name}`)
      await rotateHostKey(name, d)
      console.log(`Host ${name} is ready: agentbox new <id> <repo> --host ${name}`)
      return
    }
    const now = health?.body ? Object.keys(health.body.checks).filter((check) => health.body.checks[check]?.some((c) => c.status === 'fail')).join(', ') : 'agentboxd to answer'
    if (now !== waiting) console.log(`Waiting for ${name}: ${now}`)
    waiting = now
    await sleep(5000)
  }
  fail(`Host ${name} was created but is not ready after 5 minutes: ssh ${name} to look`)
}

// Tailscale's device list can lag behind the joined device, leaving the address null until a refresh.
function writeEntry(name: string, d: string, address: string): void {
  writeFileSync(
    join(d, 'ssh_config'),
    `Host ${name}
  HostName ${address}
  User agentbox
  IdentityFile ${d}/id_ed25519
  IdentitiesOnly yes
  HostKeyAlias ${name}
  UserKnownHostsFile ${d}/known_hosts
  StrictHostKeyChecking yes
  ControlMaster auto
  ControlPath ~/.ssh/cm/%r@%h:%p
  ControlPersist 30m
  ServerAliveInterval 5
  ServerAliveCountMax 2

`,
  )
  writeSshConfig()
}

async function hostAddress(d: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const outputs = JSON.parse(run('tofu', [`-chdir=${d}`, 'output', '-json'])) as Record<string, { value: unknown }>
    const address = outputs.address?.value
    if (typeof address === 'string' && address) return address
    await sleep(5000)
    run('tofu', [`-chdir=${d}`, 'apply', '-refresh-only', '-input=false', '-auto-approve'], { stdout: 'ignore' })
  }
  return ''
}

function moduleSource(module: string): string {
  const local = process.env.AGENTBOX_MODULE_SOURCE
  return local ? join(local, module) : `git::https://github.com/novibe-org/agentbox.git//modules/${module}?ref=v${version}`
}

// AGENTBOX_RELEASE starts a test host from a published release while this version has none.
function rootModule(name: string, tailnet: boolean, joining = false): string {
  const host = `module "host" {
  source         = "${moduleSource('hetzner')}"
  name           = "${name}"
  ssh_public_key = file("\${path.module}/id_ed25519.pub")
  host_key       = file("\${path.module}/ssh_host_ed25519_key")
  host_key_pub   = file("\${path.module}/ssh_host_ed25519_key.pub")
  release        = "${process.env.AGENTBOX_RELEASE || version}"${tailnet && !joining ? '\n  tailnet_auth_key = module.tailnet.auth_key' : ''}
}

output "ipv4" {
  value = module.host.ipv4
}
`
  if (!tailnet) return `${host}
output "address" {
  value = module.host.ipv4
}
`
  return `${host}
module "tailnet" {
  source    = "${moduleSource('tailscale')}"
  name      = "${name}"
  server_id = module.host.server_id
}

output "address" {
  value = module.tailnet.dns_name
}

output "auth_key" {
  value     = module.tailnet.auth_key
  sensitive = true
}
`
}

function requireTailnetAccess(): void {
  if (!(process.env.TAILSCALE_OAUTH_CLIENT_ID && process.env.TAILSCALE_OAUTH_CLIENT_SECRET)) {
    fail(
      'agentbox needs an OAuth client for your tailnet: create one in the Tailscale admin console under Settings > Trust credentials, with write access to auth keys for tag:agentbox, and set TAILSCALE_OAUTH_CLIENT_ID and TAILSCALE_OAUTH_CLIENT_SECRET',
    )
  }
}

// The firewall closes only once the host answers over the tailnet, so the developer is never locked out.
export async function updateHost(name: string, tailnet: boolean): Promise<void> {
  hostName(name)
  const d = join(hosts, name)
  if (!existsSync(d)) fail(`No host ${name}: agentbox host create ${name} --provider hetzner`)
  if (tailnet) requireTailnetAccess()
  await connect(name)
  if (!tailnet) return console.log(`${name} runs agentbox ${version}`)
  if (readFileSync(join(d, 'main.tf'), 'utf8').includes('module "tailnet"')) return console.log(`${name} is on your tailnet`)

  // Hosts from agentbox 0.2.1 deleted their first host key, which main.tf reads.
  for (const key of ['ssh_host_ed25519_key', 'ssh_host_ed25519_key.pub']) writeFileSync(join(d, key), '', { flag: 'a' })
  const tofu = (...args: string[]) => run('tofu', [`-chdir=${d}`, ...args], { stdout: 'ignore' })
  const ip = run('tofu', [`-chdir=${d}`, 'output', '-raw', 'ipv4']).trim()
  writeFileSync(join(d, 'main.tf'), rootModule(name, true, true))
  tofu('init', '-input=false', '-upgrade')
  tofu('apply', '-input=false', '-auto-approve', '-target=module.tailnet.tailscale_tailnet_key.host')
  const authKey = run('tofu', [`-chdir=${d}`, 'output', '-raw', 'auth_key']).trim()
  console.log(`Putting ${name} on your tailnet`)
  const joined = await call<{ error?: string }>(name, 'PUT', '/tailnet', { authKey, hostname: name })
  if (joined.status !== 204) fail(`${name} did not join your tailnet: ${joined.body?.error}`)
  tofu('apply', '-input=false', '-auto-approve')
  const address = await hostAddress(d)
  writeEntry(name, d, address)
  const answers = await request(name, 'GET', '/health', undefined, ['-o', 'ConnectTimeout=10', '-o', 'ControlPath=none']).catch(() => undefined)
  if (!answers) {
    writeEntry(name, d, ip)
    fail(`${name} cannot be reached over your tailnet at ${address}, so it stays open to the internet: check that your tailnet policy lets you reach tag:agentbox on port 22`)
  }
  writeFileSync(join(d, 'main.tf'), rootModule(name, true))
  tofu('apply', '-input=false', '-auto-approve')
  console.log(`${name} is on your tailnet at ${address}, and closed to the internet`)
}

const rotation = `set -euo pipefail
k=/etc/ssh/ssh_host_ed25519_key
rm -f "$k.new" "$k.new.pub"
ssh-keygen -q -t ed25519 -N '' -C '' -f "$k.new"
mv "$k.new" "$k" && mv "$k.new.pub" "$k.pub"
if [ -s /run/sshd.pid ]; then kill -HUP "$(cat /run/sshd.pid)"; else systemctl reload ssh; fi
cut -d' ' -f1,2 "$k.pub"
`

async function rotateHostKey(name: string, d: string): Promise<void> {
  const key = run('ssh', ['-o', 'ControlPath=none', name, 'sudo bash -s'], { input: rotation }).trim()
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+=*$/.test(key)) fail(`Host ${name} gave no new host key: ${key}`)
  // The first host key stays: main.tf reads it on destroy.
  writeFileSync(join(d, 'known_hosts'), `${name} ${key}\n`)
  for (let i = 0; i < 10; i++) {
    if (succeeds('ssh', ['-o', 'ConnectTimeout=5', '-o', 'ControlPath=none', name, 'true'], { stderr: 'ignore' })) return
    await sleep(1000)
  }
  fail(`Host ${name} does not answer with its new host key: ssh ${name} to look`)
}
