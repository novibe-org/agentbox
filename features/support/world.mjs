import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, setWorldConstructor } from '@cucumber/cucumber'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

setDefaultTimeout(20 * 60 * 1000)

const repo = resolve(import.meta.dirname, '../..')
const home = homedir()
const fixtures = mkdtempSync(join(tmpdir(), 'agentbox-fixtures-'))
chmodSync(fixtures, 0o755)
const cloud = process.env.AGENTBOX_CLOUD === '1'
const origin = cloud ? `git://${execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).trim()}` : `file://${fixtures}`
const workspace = `${origin}/acme/workspace.git`
const app = `${origin}/acme/app.git`
let agent
let daemon

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

  repository('acme/app', { 'README.md': '# acme app\n' })
  repository('acme/workspace', {
    '.devcontainer/devcontainer.json': JSON.stringify(
      {
        image: 'node:22-bookworm-slim',
        remoteUser: 'node',
        features: { './agentbox': {} },
        mounts: cloud ? [] : [{ source: fixtures, target: fixtures, type: 'bind' }],
        postCreateCommand: 'bash .devcontainer/setup.sh',
      },
      null,
      2,
    ),
    '.devcontainer/setup.sh': `[ -d projects/app/.git ] || git clone -q ${app} projects/app\n`,
    '.gitignore': 'projects/\n',
  })
  execFileSync('sudo', ['chown', '-R', '1000:1000', fixtures])
  if (cloud) {
    daemon = spawn('git', ['daemon', '--reuseaddr', '--export-all', `--base-path=${fixtures}`, `--listen=${origin.slice('git://'.length)}`, fixtures], { stdio: 'ignore' })
  }
})

function repository(name, files) {
  const tree = join(fixtures, 'tree', name)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(tree, path, '..'), { recursive: true })
    writeFileSync(join(tree, path), content)
  }
  if (name === 'acme/workspace') cpSync(join(repo, 'src/agentbox'), join(tree, '.devcontainer/agentbox'), { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: tree })
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('-c', 'user.name=acme', '-c', 'user.email=dev@acme.test', 'commit', '-q', '-m', name)
  execFileSync('git', ['clone', '-q', '--bare', tree, join(fixtures, `${name}.git`)])
}

AfterAll(() => {
  daemon?.kill()
  if (agent) execFileSync('ssh-agent', ['-k'], { env: { ...process.env, ...agent }, stdio: 'ignore' })
  execFileSync('sudo', ['rm', '-rf', fixtures])
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

function destroy() {
  const hosts = join(home, '.agentbox/hosts')
  for (const host of existsSync(hosts) ? readdirSync(hosts) : []) {
    spawnSync('tofu', [`-chdir=${join(hosts, host)}`, 'destroy', '-input=false', '-auto-approve'], { stdio: 'inherit' })
  }
}

Before(reset)
After(function ({ result }) {
  if (cloud) destroy()
  if (result?.status === 'FAILED') {
    for (const host of this.testHosts()) {
      const logs = spawnSync('docker', ['logs', '--tail', '80', host], { encoding: 'utf8' })
      console.error(`--- test host ${host}\n${logs.stdout}${logs.stderr}`)
    }
  }
  reset()
})

class World {
  constructor() {
    this.workspace = workspace
    this.app = app
    this.cloud = cloud
    this.env = {
      ...process.env,
      ...agent,
      PATH: cloud ? `${repo}/dist:${process.env.PATH}` : `${repo}/test/bin:${repo}/dist:${process.env.PATH}`,
      HCLOUD_TOKEN: cloud ? process.env.HCLOUD_TOKEN : 'test-token',
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
