import { Command } from 'commander'
import { version } from '../package.json'
import { socketPath } from '../lib/api.ts'
import { dialStdio } from './dial-stdio.ts'
import { serve } from './server.ts'

const program = new Command('agentboxd').description('The session API of an agentbox host.').version(version)

program
  .command('serve')
  .description("serve the API on its Unix socket; run by systemd as the host's agentbox user")
  .option('--socket <path>', 'Unix socket to listen on', socketPath)
  .action((options: { socket: string }) => serve(options.socket))

program
  .command('dial-stdio')
  .description("join stdin and stdout to the API's socket, for clients over SSH")
  .option('--socket <path>', 'Unix socket to connect to', socketPath)
  .action((options: { socket: string }) => dialStdio(options.socket))

await program.parseAsync()
