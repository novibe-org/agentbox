import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'

function succeeded(result) {
  assert.equal(result.status, 0, `agentbox failed:\n${result.stdout}\n${result.stderr}`)
}

Given('the developer has host {string}', function (host) {
  succeeded(this.agentbox('host', 'create', host, '--provider', 'hetzner'))
})

Given('the developer has session {string} on {string} with a note in its workspace', function (session, host) {
  succeeded(this.agentbox('host', 'create', host, '--provider', 'hetzner'))
  succeeded(this.agentbox('new', session, this.workspace, '--host', host))
  const note = this.ssh(`${session}.agentbox`, `echo 'Login fails after password reset' > /workspaces/${session}/notes.md`)
  assert.equal(note.status, 0, note.stderr)
})

When('the developer starts session {string} from {string} on {string}', function (session, _workspace, host) {
  this.agentbox('new', session, this.workspace, '--host', host)
})

Then("session {string} opens with {string} checked out by the workspace's setup", function (session, _project) {
  succeeded(this.result)
  const origin = this.ssh(`${session}.agentbox`, `git -C /workspaces/${session}/projects/app remote get-url origin`)
  assert.equal(origin.status, 0, origin.stderr)
  assert.equal(origin.stdout.trim(), this.app)
})

Then('the developer is told session {string} already exists on {string}', function (session, host) {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, new RegExp(`Session ${session} already exists on ${host}`))
})

Then('session {string} opens with its note intact', function (session) {
  const note = this.ssh(`${session}.agentbox`, `cat /workspaces/${session}/notes.md`)
  assert.equal(note.status, 0, note.stderr)
  assert.equal(note.stdout.trim(), 'Login fails after password reset')
})
