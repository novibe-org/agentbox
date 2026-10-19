import { homedir } from 'node:os'
import { join } from 'node:path'

export const home = homedir()
export const hosts = join(home, '.agentbox/hosts')
export const sessions = join(home, '.agentbox/sessions')
