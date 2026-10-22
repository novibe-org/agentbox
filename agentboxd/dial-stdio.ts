import net from 'node:net'

export function dialStdio(socket: string): void {
  const connection = net.connect(socket)
  connection.on('error', (error) => {
    console.error(`agentboxd is not running on ${socket}: ${error.message}`)
    process.exit(1)
  })
  process.stdin.pipe(connection, { end: false })
  connection.pipe(process.stdout)
  connection.on('close', () => process.stdout.write('', () => process.exit(0)))
}
