import { spawnSync, type StdioOptions } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

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
  input?: string
  stdout?: 'pipe' | 'inherit' | 'ignore'
  stderr?: 'inherit' | 'ignore'
}

function spawn(command: string, args: string[], { input, stdout = 'pipe', stderr = 'inherit' }: Options) {
  const stdio: StdioOptions = [input === undefined ? 'inherit' : 'pipe', stdout, stderr]
  return spawnSync(command, args, { input, stdio, encoding: 'utf8' })
}

export function run(command: string, args: string[], options: Options = {}): string {
  const result = spawn(command, args, options)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Exit(result.status ?? 1)
  return result.stdout ?? ''
}

export type Outcome = { status: number; stdout: string; stderr: string }

export function attempt(command: string, args: string[]): Outcome {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

export function succeeds(command: string, args: string[], options: Options = {}): boolean {
  return spawn(command, args, { stdout: 'ignore', ...options }).status === 0
}

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
