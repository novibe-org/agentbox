import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { version } from '../package.json'
import rotateHostKeyScript from './host/rotate-host-key.sh' with { type: 'text' }
import { hostName } from './names.ts'
import { hosts } from './paths.ts'
import { fail, onPath, run, succeeds } from './process.ts'
import { writeSshConfig } from './ssh.ts'

export const providers = ['hetzner']

// The provider is one of providers; hetzner is the only one so far.
export async function createHost(name: string, _provider: string): Promise<void> {
  hostName(name)
  const d = join(hosts, name)
  if (existsSync(d)) fail(`Host ${name} already exists`)
  if (!process.env.HCLOUD_TOKEN) {
    fail(
      'agentbox needs an API token for a Hetzner project: create one in the Hetzner Console under Security > API tokens, with read and write access, and set HCLOUD_TOKEN',
    )
  }
  if (!onPath('tofu')) fail('agentbox needs OpenTofu to create hosts: https://opentofu.org/docs/intro/install/')

  mkdirSync(d, { recursive: true })
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `agentbox-${name}`, '-f', join(d, 'id_ed25519')])
  // The server's first host key is made here, so the first connection is already
  // pinned; it is replaced once that connection works, as cloud-init data stays readable.
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', join(d, 'ssh_host_ed25519_key')])
  const hostKey = readFileSync(join(d, 'ssh_host_ed25519_key.pub'), 'utf8').split(' ').slice(0, 2).join(' ')
  writeFileSync(join(d, 'known_hosts'), `${name} ${hostKey}\n`)
  writeFileSync(
    join(d, 'main.tf'),
    `module "host" {
  source         = "git::https://github.com/novibe-org/agentbox.git//modules/hetzner?ref=v${version}"
  name           = "${name}"
  ssh_public_key = file("\${path.module}/id_ed25519.pub")
  host_key       = file("\${path.module}/ssh_host_ed25519_key")
  host_key_pub   = file("\${path.module}/ssh_host_ed25519_key.pub")
}

output "ipv4" {
  value = module.host.ipv4
}
`,
  )
  run('tofu', [`-chdir=${d}`, 'init', '-input=false'], { stdout: 'ignore' })
  run('tofu', [`-chdir=${d}`, 'apply', '-input=false', '-auto-approve'], { stdout: 'ignore' })
  const ip = run('tofu', [`-chdir=${d}`, 'output', '-raw', 'ipv4']).trim()
  if (!/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(ip)) fail(`OpenTofu gave no IPv4 address for ${name}: ${ip}`)
  writeFileSync(
    join(d, 'ssh_config'),
    `Host ${name}
  HostName ${ip}
  User agentbox
  IdentityFile ${d}/id_ed25519
  IdentitiesOnly yes
  HostKeyAlias ${name}
  UserKnownHostsFile ${d}/known_hosts
  StrictHostKeyChecking yes
  ControlMaster auto
  ControlPath ~/.ssh/cm/%r@%h:%p
  ControlPersist 30m
  ServerAliveInterval 20

`,
  )
  writeSshConfig()

  // The server answers SSH before cloud-init has mounted the volume and set up Docker.
  // A shared connection opened that early would keep the user's groups from before.
  for (let i = 0; i < 60; i++) {
    const ready = ['-o', 'ConnectTimeout=5', '-o', 'ControlPath=none', name, 'mountpoint -q /var/lib/agentbox && docker info']
    if (succeeds('ssh', ready, { stderr: 'ignore' })) {
      await rotateHostKey(name, d)
      console.log(`Host ${name} is ready: agentbox new <id> <repo> --host ${name}`)
      return
    }
    await sleep(5000)
  }
  fail(`Host ${name} was created but is not ready after 5 minutes: ssh ${name} to look`)
}

async function rotateHostKey(name: string, d: string): Promise<void> {
  const key = run('ssh', ['-o', 'ControlPath=none', name, 'sudo bash -s'], { input: rotateHostKeyScript }).trim()
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+=*$/.test(key)) fail(`Host ${name} gave no new host key: ${key}`)
  writeFileSync(join(d, 'known_hosts'), `${name} ${key}\n`)
  rmSync(join(d, 'ssh_host_ed25519_key'), { force: true })
  rmSync(join(d, 'ssh_host_ed25519_key.pub'), { force: true })
  for (let i = 0; i < 10; i++) {
    if (succeeds('ssh', ['-o', 'ConnectTimeout=5', '-o', 'ControlPath=none', name, 'true'], { stderr: 'ignore' })) return
    await sleep(1000)
  }
  fail(`Host ${name} does not answer with its new host key: ssh ${name} to look`)
}
