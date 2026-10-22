import { readFileSync } from 'node:fs'
import { version } from '../package.json'
import type { Check, Health } from '../lib/api.ts'
import { execute, root } from './sessions.ts'

function mounted(path: string): Check {
  const points = readFileSync('/proc/self/mountinfo', 'utf8')
    .split('\n')
    .map((line) => line.split(' ')[4])
  return points.includes(path) ? { status: 'pass' } : { status: 'fail', output: `${path} is not mounted` }
}

async function succeeds(command: string, args: string[]): Promise<Check> {
  const result = await execute(command, args)
  return result.status === 0 ? { status: 'pass' } : { status: 'fail', output: result.stderr.trim().split('\n').at(-1) }
}

export async function health(): Promise<Health> {
  const checks: Record<string, Check[]> = {
    'volume:mounted': [mounted(root)],
    'docker:responsive': [await succeeds('docker', ['info'])],
    'devcontainer:installed': [await succeeds('devcontainer', ['--version'])],
  }
  const status = Object.values(checks).every((list) => list.every((check) => check.status === 'pass')) ? 'pass' : 'fail'
  return { status, version, checks }
}
