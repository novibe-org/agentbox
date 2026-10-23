import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { devServerAnswers, startDevServer } from '../support/dev-server.mjs'

function succeeded(result) {
  assert.equal(result.status, 0, `agentbox failed:\n${result.stdout}\n${result.stderr}`)
}

function sessionStatus(world, host, session) {
  const record = world.ssh(host, `cat /var/lib/agentbox/sessions/${session}.json`)
  return record.status === 0 ? JSON.parse(record.stdout).status : undefined
}

function hostFromOldAgentbox(world, host) {
  const old = world.oldAgentbox()
  succeeded(spawnSync(old, ['host', 'create', host, '--provider', 'hetzner'], { env: world.env, encoding: 'utf8', input: '' }))
  world.ship(host)
  return old
}

Given('the developer has host {string} from agentbox 0.2.1, with a dev server running in session {string}', function (host, session) {
  if (!this.cloud) return 'skipped'
  const old = hostFromOldAgentbox(this, host)
  succeeded(spawnSync(old, ['new', session, this.workspace, '--host', host], { env: this.env, encoding: 'utf8', input: '' }))
  const started = this.ssh(`${session}.agentbox`, startDevServer)
  assert.equal(started.status, 0, started.stderr)
})

Given('the developer has host {string} from agentbox 0.2.1, setting up session {string}', async function (host, session) {
  if (!this.cloud) return 'skipped'
  const old = hostFromOldAgentbox(this, host)
  this.settingUpOn = host
  this.settingUp = spawn(old, ['new', session, this.workspace, '--host', host], { env: this.env, stdio: 'ignore' })
  for (let i = 0; i < 30 && sessionStatus(this, host, session) !== 'creating'; i++) await sleep(2000)
  assert.equal(sessionStatus(this, host, session), 'creating')
})

When('the developer starts session {string} on {string} with agentbox 0.3.0', function (session, host) {
  assert.equal(this.agentbox('--version').stdout.trim(), '0.3.0')
  this.agentbox('new', session, this.workspace, '--host', host)
})

Then('the developer is told {string} was updated from 0.2.1 to 0.3.0', function (host) {
  assert.match(this.result.stdout, new RegExp(`Updated ${host} from 0\\.2\\.1 to 0\\.3\\.0`))
})

Then('session {string} opens, and the dev server in {string} is still running', function (session, running) {
  succeeded(this.result)
  const origin = this.ssh(`${session}.agentbox`, `git -C /workspaces/${session} remote get-url origin`)
  assert.equal(origin.stdout.trim(), this.workspace, origin.stderr)
  const answers = this.ssh(`${running}.agentbox`, devServerAnswers)
  assert.equal(answers.status, 0, answers.stderr)
})

Then('the developer is told {string} cannot be updated while {string} is being set up', function (host, session) {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, new RegExp(`${host} cannot be updated while ${session} is being set up`))
})

Then('session {string} finishes its setup', async function (session) {
  const host = this.settingUpOn
  for (let i = 0; i < 90 && sessionStatus(this, host, session) === 'creating'; i++) await sleep(10000)
  this.settingUp?.kill()
  assert.equal(sessionStatus(this, host, session), 'ready')
})
