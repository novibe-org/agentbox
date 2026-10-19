import { spawnSync, type StdioOptions } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

// Ends agentbox with the exit status, after printing the message if there is one.
export class Exit extends Error {
  constructor(
    readonly status: number,
    message = '',
  ) {
    super(message)
  }
}

export function fail(message: string): never {
  throw new Exit(1, message)
}

type Options = {
  // Written to the command's stdin; without it, the command reads agentbox's own.
  input?: string
  stdout?: 'pipe' | 'inherit' | 'ignore'
  stderr?: 'inherit' | 'ignore'
}

function spawn(command: string, args: string[], { input, stdout = 'pipe', stderr = 'inherit' }: Options) {
  const stdio: StdioOptions = [input === undefined ? 'inherit' : 'pipe', stdout, stderr]
  return spawnSync(command, args, { input, stdio, encoding: 'utf8' })
}

// Runs the command and returns what it printed; ends agentbox if it fails.
export function run(command: string, args: string[], options: Options = {}): string {
  const result = spawn(command, args, options)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Exit(result.status ?? 1)
  return result.stdout ?? ''
}

export function succeeds(command: string, args: string[], options: Options = {}): boolean {
  return spawn(command, args, { stdout: 'ignore', ...options }).status === 0
}

// Hands the terminal to the command, as the shell's exec does, and ends with its status.
export function exec(command: string, args: string[]): never {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

export function onPath(command: string): boolean {
  return (process.env.PATH ?? '').split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, command), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

export function quote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`
}
