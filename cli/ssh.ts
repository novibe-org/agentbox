import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import functions from './host/functions.sh' with { type: 'text' }
import { home, hosts } from './paths.ts'
import { quote, run } from './process.ts'

// Runs the script on the host with the arguments as $1, $2, ...; the functions in
// host/functions.sh are defined first, so every script can use them.
export function onHost(host: string, script: string, args: string[] = [], { forwardAgent = false } = {}): void {
  // A shared ControlMaster connection may have been opened without forwarding, so a
  // forwarding one gets its own.
  const options = forwardAgent ? ['-A', '-o', 'ControlPath=none'] : []
  run('ssh', [...options, host, `bash -s -- ${args.map(quote).join(' ')}`], {
    input: `${functions}\n${script}`,
    stdout: 'inherit',
  })
}

const sessionsBlock = `Host *.agentbox
  User node
  ProxyCommand agentbox proxy %h
  ForwardAgent yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel error
`

// ~/.ssh/agentbox.conf holds every host and the way into sessions; ~/.ssh/config
// includes it first, so its entries apply before the developer's own.
export function writeSshConfig(): void {
  const dir = join(home, '.ssh')
  mkdirSync(join(dir, 'cm'), { recursive: true, mode: 0o700 })
  const entries = existsSync(hosts)
    ? readdirSync(hosts)
        .sort()
        .map((name) => join(hosts, name, 'ssh_config'))
        .filter((file) => existsSync(file))
        .map((file) => readFileSync(file, 'utf8'))
    : []
  writeFileSync(join(dir, 'agentbox.conf'), [...entries, sessionsBlock].join(''))
  const config = join(dir, 'config')
  const rest = existsSync(config) ? readFileSync(config, 'utf8') : ''
  if (!rest.split('\n').includes('Include agentbox.conf')) {
    writeFileSync(config, `Include agentbox.conf\n\n${rest}`)
  }
}
