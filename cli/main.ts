import { Command, Option } from 'commander'
import { version } from '../package.json'
import { createHost, providers } from './host.ts'
import { Exit } from './process.ts'
import { listSessions, newSession, openExisting, proxy, removeSession } from './session.ts'

const program = new Command('agentbox')
  .description('One container per coding-agent session, on a remote Docker host.')
  .version(version)
  .addHelpText(
    'after',
    `
Environment:
  AGENTBOX_MACHINE  SSH host for sessions created without --host
  AGENTBOX_REPO     workspace repo to create sessions from
  AGENTBOX_PUBKEY   key to authorize in new sessions (default: ~/.ssh/id_ed25519.pub)
  HCLOUD_TOKEN      API token of the Hetzner project that hosts are created in`,
  )

program
  .command('new')
  .description('create a session and open it')
  .argument('<id>', 'session id: lowercase letters, digits and hyphens')
  .argument('[repo]', "workspace repo: a git URL or GitHub owner/name (default: AGENTBOX_REPO, then this directory's origin)")
  .option('--host <name>', 'host to create the session on (default: AGENTBOX_MACHINE)')
  .action((id: string, repo: string | undefined, options: { host?: string }) => newSession(id, repo, options.host))

program
  .command('open')
  .description('open a session (in cmux when inside it, plain ssh otherwise)')
  .argument('<id>')
  .action(openExisting)

program.command('ls').description('list sessions').action(listSessions)

program
  .command('rm')
  .description('delete a session (refuses if work is not pushed)')
  .argument('<id>')
  .action(removeSession)

program
  .command('host')
  .description('manage the hosts that run sessions')
  .command('create')
  .description('create a host for sessions')
  .argument('<name>', 'host name: lowercase letters, digits and hyphens')
  .addOption(new Option('--provider <provider>', 'where to create it').choices(providers).makeOptionMandatory())
  .action((name: string, options: { provider: string }) => createHost(name, options.provider))

// ssh's ProxyCommand for <id>.agentbox, written to ~/.ssh/agentbox.conf.
program.command('proxy', { hidden: true }).argument('<host>').action(proxy)

try {
  await program.parseAsync()
} catch (error) {
  if (!(error instanceof Exit)) throw error
  if (error.message) console.error(error.message)
  process.exit(error.status)
}
