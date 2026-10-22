import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { home, hosts } from './paths.ts'

// Apps such as cmux run ssh without the shell's PATH, so the proxy names this binary by its full path.
const sessionsBlock = `Host *.agentbox
  User node
  ProxyCommand "${process.execPath}" proxy %h
  ForwardAgent yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel error
`

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
