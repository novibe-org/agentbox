import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'

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
