import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

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

Then("session {string} opens from a terminal app that runs ssh without the developer's PATH", function (session) {
  succeeded(this.result)
  const opened = spawnSync('ssh', [`${session}.agentbox`, 'echo opened'], { env: { ...this.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8', input: '' })
  assert.equal(opened.status, 0, opened.stderr)
  assert.equal(opened.stdout.trim(), 'opened')
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

// The session's dev container runs in the Docker of its pod.
Given('the container of session {string} is gone', function (session) {
  const gone = spawnSync('sudo', ['k3s', 'kubectl', 'exec', session, '--', 'sh', '-c', `docker rm -f $(docker ps -aq --filter label=devcontainer.local_folder=/workspaces/${session})`], { encoding: 'utf8' })
  assert.equal(gone.status, 0, gone.stderr)
})

When('the developer removes session {string}', function (session) {
  this.agentbox('rm', session)
})

Then('the developer is told the work in {string} cannot be checked', function (session) {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, new RegExp(`Session ${session} has lost its container, so its work cannot be checked`))
})

Then('the note in {string} is still on {string}', function (session, _host) {
  const note = spawnSync('sudo', ['k3s', 'kubectl', 'exec', session, '--', 'cat', `/workspaces/${session}/notes.md`], { encoding: 'utf8' })
  assert.equal(note.stdout.trim(), 'Login fails after password reset', note.stderr)
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
