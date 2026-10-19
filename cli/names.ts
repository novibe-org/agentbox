import { fail } from './process.ts'

const pattern = /^[a-z0-9][a-z0-9-]*$/

export function sessionId(id: string): string {
  return pattern.test(id) ? id : fail(`A session id is lowercase letters, digits and hyphens: ${id}`)
}

export function hostName(name: string): string {
  return pattern.test(name) ? name : fail(`A host name is lowercase letters, digits and hyphens: ${name}`)
}
