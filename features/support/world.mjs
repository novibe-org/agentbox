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
// Session pods clone over the network, as from GitHub: from a git daemon on the host's address,
// which on a CI runner is the runner itself and on a real host comes with ship().
const origin = (address) => `git://${address}`
const runner = execFileSync('hostname', ['-I'], { encoding: 'utf8' }).split(' ')[0]
const testHosts = join(tmpdir(), 'agentbox-test-hosts')
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
        postCreateCommand: 'bash .devcontainer/setup.sh',
      },
      null,
      2,
    ),
    '.devcontainer/setup.sh': `[ -d projects/app/.git ] || git clone -q "$(git remote get-url origin | sed 's|/workspace.git$|/app.git|')" projects/app\n`,
    '.gitignore': 'projects/\n',
  })
  execFileSync('sudo', ['chown', '-R', '1000:1000', fixtures])
  if (!cloud) daemon = spawn('git', ['daemon', '--reuseaddr', '--export-all', `--base-path=${fixtures}`, fixtures], { stdio: 'ignore' })
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
  if (spawnSync('sh', ['-c', 'command -v k3s']).status === 0) {
    execFileSync('sudo', ['k3s', 'kubectl', 'delete', 'pod,pvc,configmap,secret', '--all', '--wait=true'], { stdio: 'ignore' })
  }
  rmSync(testHosts, { force: true })
  rmSync(join(home, '.agentbox'), { recursive: true, force: true })
  rmSync(join(home, '.ssh/agentbox.conf'), { force: true })
  rmSync(join(home, '.ssh/cm'), { recursive: true, force: true })
}

function destroy() {
  const hosts = join(home, '.agentbox/hosts')
  for (const host of existsSync(hosts) ? readdirSync(hosts) : []) {
    for (const key of ['ssh_host_ed25519_key', 'ssh_host_ed25519_key.pub']) writeFileSync(join(hosts, host, key), '', { flag: 'a' })
    spawnSync('tofu', [`-chdir=${join(hosts, host)}`, 'destroy', '-input=false', '-auto-approve'], { stdio: 'inherit' })
  }
  spawnSync(join(repo, 'test/sweep'), { stdio: 'inherit' })
}

Before(reset)
After(function ({ result }) {
  for (const undo of this.unblock) undo()
  if (cloud) destroy()
  if (result?.status === 'FAILED' && this.testHosts().length) {
    const pods = spawnSync('sudo', ['k3s', 'kubectl', 'describe', 'pods'], { encoding: 'utf8' })
    const logs = spawnSync('sudo', ['k3s', 'kubectl', 'logs', '-l', 'agentbox.session', '--tail', '40'], { encoding: 'utf8' })
    console.error(`--- session pods\n${pods.stdout}${logs.stdout}${logs.stderr}`)
    const sessions = join(home, '.agentbox/sessions')
    for (const session of existsSync(sessions) ? readdirSync(sessions) : []) {
      const ssh = spawnSync('ssh', ['-v', `${session}.agentbox`, 'true'], { env: this.env, encoding: 'utf8', input: '' })
      console.error(`--- ssh ${session}.agentbox: exit ${ssh.status}\n${ssh.stderr.split('\n').slice(-25).join('\n')}`)
    }
  }
  reset()
})

class World {
  constructor() {
    this.workspace = `${origin(runner)}/acme/workspace.git`
    this.app = `${origin(runner)}/acme/app.git`
    this.cloud = cloud
    this.unblock = []
    this.env = {
      ...process.env,
      ...agent,
      PATH: cloud ? `${repo}/dist:${process.env.PATH}` : `${repo}/test/bin:${repo}/dist:${process.env.PATH}`,
      HCLOUD_TOKEN: cloud ? process.env.HCLOUD_TOKEN : 'test-token',
      AGENTBOX_TEST_FIXTURES: fixtures,
      AGENTBOX_TEST_HOSTS: testHosts,
    }
    delete this.env.AGENTBOX_MACHINE
  }

  agentbox(...args) {
    this.result = spawnSync('agentbox', args, { env: this.env, encoding: 'utf8', input: '' })
    return this.result
  }

  // A real host serves the fixtures to its session pods itself.
  ship(host) {
    if (!this.cloud) return
    const tar = spawnSync('tar', ['-C', fixtures, '-c', '.'])
    const served = '/var/lib/agentbox/fixtures'
    const result = spawnSync(
      'ssh',
      [host, `sudo mkdir -p ${served} && sudo tar -C ${served} -x && sudo git daemon --detach --reuseaddr --export-all --base-path=${served} ${served} && hostname -I`],
      { env: this.env, input: tar.stdout, encoding: 'utf8' },
    )
    if (result.status !== 0) throw new Error(`Cannot ship the fixtures to ${host}: ${result.stderr}`)
    const address = result.stdout.split(' ')[0].trim()
    this.workspace = `${origin(address)}/acme/workspace.git`
    this.app = `${origin(address)}/acme/app.git`
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

  // The hosts the fake tofu provided on this runner
  testHosts() {
    return existsSync(testHosts) ? readFileSync(testHosts, 'utf8').split('\n').filter(Boolean) : []
  }
}

setWorldConstructor(World)
