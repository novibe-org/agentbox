import { Given, Then, When } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function succeeded(result) {
  assert.equal(result.status, 0, `agentbox failed:\n${result.stdout}\n${result.stderr}`)
}

// A host from agentbox 0.4 or older runs agentboxd and gave the CLI no kubeconfig.
Given('the developer has host {string} from agentbox 0.4', function (host) {
  succeeded(this.agentbox('host', 'create', host, '--provider', 'hetzner'))
  rmSync(join(homedir(), '.agentbox/hosts', host, 'kubeconfig'))
})

When('the developer starts session {string} on {string}', function (session, host) {
  this.agentbox('new', session, this.workspace, '--host', host)
})

Then('the developer is told {string} is too old to run sessions, and to create it again', function (host) {
  assert.notEqual(this.result.status, 0)
  assert.match(this.result.stderr, new RegExp(`${host} is too old to run sessions: .*create it again`))
})
