import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { devServerAnswers, startDevServer } from '../support/dev-server.mjs'

function succeeded(result) {
  assert.equal(result.status, 0, `agentbox failed:\n${result.stdout}\n${result.stderr}`)
}

Given('the developer has no hosts yet', function () {
  assert.deepEqual(this.hosts(), [])
})

Given('the developer has not given agentbox access to a Hetzner project', function () {
  delete this.env.HCLOUD_TOKEN
})

Given('the developer has host {string} with session {string} on it', function (host, session) {
  succeeded(this.agentbox('host', 'create', host, '--provider', 'hetzner'))
  succeeded(this.agentbox('new', session, this.workspace, '--host', host))
  const draft = this.ssh(`${session}.agentbox`, `echo 'Login fails after password reset' > /workspaces/${session}/notes.md`)
  assert.equal(draft.status, 0, draft.stderr)
})

When('the developer creates host {string} on Hetzner', function (host) {
  this.agentbox('host', 'create', host, '--provider', 'hetzner')
})

Then('session {string} started on {string} from {string} opens with the workspace checked out', function (session, host, _workspace) {
  succeeded(this.result)
  this.ship(host)
  succeeded(this.agentbox('new', session, this.workspace, '--host', host))
  const origin = this.ssh(`${session}.agentbox`, `git -C /workspaces/${session} remote get-url origin`)
  assert.equal(origin.status, 0, origin.stderr)
  assert.equal(origin.stdout.trim(), this.workspace)
})

Then('the developer is told agentbox needs an API token for a Hetzner project', function () {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, /needs an API token for a Hetzner project/)
})

Then('the developer has no hosts', function () {
  assert.deepEqual(this.hosts(), [])
  assert.deepEqual(this.testHosts(), [])
})

Then('the developer is told host {string} already exists', function (host) {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, new RegExp(`Host ${host} already exists`))
})

Then('session {string} on {string} opens with its work intact', function (session, host) {
  assert.equal(this.sessionHost(session), host)
  const notes = this.ssh(`${session}.agentbox`, `cat /workspaces/${session}/notes.md`)
  assert.equal(notes.status, 0, notes.stderr)
  assert.equal(notes.stdout.trim(), 'Login fails after password reset')
})

Then('the developer is told in turn that server {string} is being created, is up at its address, and is ready', function (host) {
  succeeded(this.result)
  const steps = [`Creating server ${host}`, new RegExp(`Server ${host} is up at \\d+\\.\\d+\\.\\d+\\.\\d+`), `Host ${host} is ready`]
  let from = 0
  for (const step of steps) {
    const rest = this.result.stdout.slice(from)
    const at = typeof step === 'string' ? rest.indexOf(step) : rest.search(step)
    assert.notEqual(at, -1, `"${step}" missing, or out of order, in:\n${this.result.stdout}`)
    from += at + 1
  }
})

Given('the developer has not given agentbox access to their tailnet', function () {
  delete this.env.TAILSCALE_OAUTH_CLIENT_ID
  delete this.env.TAILSCALE_OAUTH_CLIENT_SECRET
})

When('the developer creates host {string} on Hetzner on their tailnet', function (host) {
  this.agentbox('host', 'create', host, '--provider', 'hetzner', '--tailnet')
})

Then('the developer is told agentbox needs an OAuth client for their tailnet', function () {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, /needs an OAuth client for your tailnet/)
})

Given('the developer has given agentbox access to their tailnet', function () {
  if (!this.cloud) return 'skipped'
  assert.ok(this.env.TAILSCALE_OAUTH_CLIENT_ID && this.env.TAILSCALE_OAUTH_CLIENT_SECRET, 'a cloud run needs the test tailnet\'s OAuth client')
})

Then('nothing on the internet outside the tailnet can connect to {string}', async function (host) {
  const ip = spawnSync('tofu', [`-chdir=${join(homedir(), '.agentbox/hosts', host)}`, 'output', '-raw', 'ipv4'], { env: this.env, encoding: 'utf8' }).stdout.trim()
  assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/)
  const connected = await new Promise((resolve) => {
    const socket = connect({ host: ip, port: 22, timeout: 10000 })
    socket.on('connect', () => (socket.destroy(), resolve(true)))
    socket.on('timeout', () => (socket.destroy(), resolve(false)))
    socket.on('error', () => resolve(false))
  })
  assert.equal(connected, false, `${host}'s public address ${ip} accepts SSH`)
})

Given('the developer has host {string} with session {string} on it, open to the internet', function (host, session) {
  if (!this.cloud) return 'skipped'
  succeeded(this.agentbox('host', 'create', host, '--provider', 'hetzner'))
  this.ship(host)
  succeeded(this.agentbox('new', session, this.workspace, '--host', host))
  const draft = this.ssh(`${session}.agentbox`, `echo 'Login fails after password reset' > /workspaces/${session}/notes.md`)
  assert.equal(draft.status, 0, draft.stderr)
})

Given('a dev server is running in {string}', function (session) {
  const started = this.ssh(`${session}.agentbox`, startDevServer)
  assert.equal(started.status, 0, started.stderr)
})

// Rejecting all traffic into the tailnet's ranges stands in for a tailnet policy that keeps the developer out.
Given('their tailnet does not let them reach {string}', function (_host) {
  for (const [tool, range] of [['iptables', '100.64.0.0/10'], ['ip6tables', 'fd7a:115c:a1e0::/48']]) {
    execFileSync('sudo', [tool, '-I', 'OUTPUT', '-d', range, '-j', 'REJECT'])
    this.unblock.push(() => execFileSync('sudo', [tool, '-D', 'OUTPUT', '-d', range, '-j', 'REJECT']))
  }
})

When('the developer moves {string} onto their tailnet', function (host) {
  this.agentbox('host', 'update', host, '--tailnet')
})

Then('the dev server in {string} is still running, with its work intact', function (session) {
  succeeded(this.result)
  const answers = this.ssh(`${session}.agentbox`, devServerAnswers)
  assert.equal(answers.status, 0, answers.stderr)
  const notes = this.ssh(`${session}.agentbox`, `cat /workspaces/${session}/notes.md`)
  assert.equal(notes.stdout.trim(), 'Login fails after password reset', notes.stderr)
})

Then('the developer is told {string} cannot be reached over their tailnet', function (host) {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, new RegExp(`${host} cannot be reached over your tailnet`))
})
