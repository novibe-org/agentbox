import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, setWorldConstructor } from '@cucumber/cucumber'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

setDefaultTimeout(20 * 60 * 1000)

const repo = resolve(import.meta.dirname, '../..')
const home = homedir()
const fixtures = mkdtempSync(join(tmpdir(), 'agentbox-fixtures-'))
const workspace = `file://${fixtures}/acme/workspace.git`
let agent

// The scenarios create hosts from the real ~/.agentbox and ~/.ssh, since ssh reads
// the user's home whatever HOME says. Only a throwaway machine may run them.
BeforeAll(() => {
  if (process.env.AGENTBOX_E2E !== '1') {
    throw new Error('The scenarios delete ~/.agentbox and the Docker containers of agentbox sessions. Set AGENTBOX_E2E=1 on a throwaway machine, as CI does.')
  }
  const key = join(home, '.ssh/id_ed25519')
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 })
  if (!existsSync(key)) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key])
  agent = Object.fromEntries(
    [...execFileSync('ssh-agent', ['-s'], { encoding: 'utf8' }).matchAll(/(SSH_AUTH_SOCK|SSH_AGENT_PID)=([^;]+)/g)].map((m) => [m[1], m[2]]),
  )
  execFileSync('ssh-add', ['-q', key], { env: { ...process.env, ...agent } })

  const tree = join(fixtures, 'tree')
  mkdirSync(join(tree, '.devcontainer'), { recursive: true })
  cpSync(join(repo, 'src/agentbox'), join(tree, '.devcontainer/agentbox'), { recursive: true })
  writeFileSync(
    join(tree, '.devcontainer/devcontainer.json'),
    JSON.stringify({ image: 'node:22-bookworm-slim', remoteUser: 'node', features: { './agentbox': {} } }, null, 2),
  )
  const git = (...args) => execFileSync('git', args, { cwd: tree })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('-c', 'user.name=acme', '-c', 'user.email=dev@acme.test', 'commit', '-q', '-m', 'Workspace')
  execFileSync('git', ['clone', '-q', '--bare', tree, join(fixtures, 'acme/workspace.git')])
})

AfterAll(() => {
  if (agent) execFileSync('ssh-agent', ['-k'], { env: { ...process.env, ...agent }, stdio: 'ignore' })
  rmSync(fixtures, { recursive: true, force: true })
})

function reset() {
  for (const label of ['agentbox.test=host', 'agentbox.session']) {
    const ids = execFileSync('docker', ['ps', '-aq', '--filter', `label=${label}`], { encoding: 'utf8' }).split('\n').filter(Boolean)
    if (ids.length) execFileSync('docker', ['rm', '-f', ...ids], { stdio: 'ignore' })
  }
  execFileSync('sudo', ['rm', '-rf', '/var/lib/agentbox/sessions'])
  rmSync(join(home, '.agentbox'), { recursive: true, force: true })
  rmSync(join(home, '.ssh/agentbox.conf'), { force: true })
  rmSync(join(home, '.ssh/cm'), { recursive: true, force: true })
}

Before(reset)
After(reset)

class World {
  constructor() {
    this.workspace = workspace
    this.env = {
      ...process.env,
      ...agent,
      PATH: `${repo}/test/bin:${repo}/bin:${process.env.PATH}`,
      HCLOUD_TOKEN: 'test-token',
      AGENTBOX_TEST_FIXTURES: fixtures,
    }
    delete this.env.AGENTBOX_MACHINE
  }

  agentbox(...args) {
    this.result = spawnSync('agentbox', args, { env: this.env, encoding: 'utf8', input: '' })
    return this.result
  }

  ssh(host, command) {
    return spawnSync('ssh', [host, command], { env: this.env, encoding: 'utf8', input: '' })
  }

  hosts() {
    const dir = join(home, '.agentbox/hosts')
    return existsSync(dir) ? readdirSync(dir) : []
  }

  sessionHost(session) {
    return readFileSync(join(home, '.agentbox/sessions', session), 'utf8').trim()
  }

  testHosts() {
    return execFileSync('docker', ['ps', '-aq', '--filter', 'label=agentbox.test=host'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  }
}

setWorldConstructor(World)
