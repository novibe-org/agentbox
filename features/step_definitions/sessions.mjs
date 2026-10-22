import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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

Given('the container of session {string} is gone', function (session) {
  const ids = execFileSync('docker', ['ps', '-aq', '--filter', `label=agentbox.session=${session}`], { encoding: 'utf8' }).split('\n').filter(Boolean)
  assert.notEqual(ids.length, 0)
  execFileSync('docker', ['rm', '-f', ...ids], { stdio: 'ignore' })
})

When('the developer removes session {string}', function (session) {
  this.agentbox('rm', session)
})

Then('the developer is told the work in {string} cannot be checked', function (session) {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, new RegExp(`Session ${session} has lost its container, so its work cannot be checked`))
})

Then('the note in {string} is still on {string}', function (session, _host) {
  assert.equal(readFileSync(`/var/lib/agentbox/sessions/${session}/notes.md`, 'utf8').trim(), 'Login fails after password reset')
})

Given('the developer has session {string} on {string}, and host {string} does not answer', function (session, host, silent) {
  succeeded(this.agentbox('host', 'create', host, '--provider', 'hetzner'))
  succeeded(this.agentbox('new', session, this.workspace, '--host', host))
  this.env.AGENTBOX_MACHINE = silent
})

When('the developer lists their sessions', function () {
  this.agentbox('ls')
})

Then('the developer is told there are no sessions yet, and how to start one on {string}', function (host) {
  succeeded(this.result)
  assert.equal(this.result.stdout, '')
  assert.match(this.result.stderr, new RegExp(`No sessions yet: agentbox new .*--host ${host}`))
})

Then('the developer is told {string} does not answer', function (host) {
  assert.match(this.result.stderr, new RegExp(`${host} does not answer`))
})

Then('the developer sees session {string} on {string}', function (session, host) {
  assert.match(this.result.stdout, new RegExp(`^${session}\t${host}\t`, 'm'))
})
