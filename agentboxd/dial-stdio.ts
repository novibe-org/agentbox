import net from 'node:net'

// Joins stdin and stdout to the API's socket, so a client reaches the API over
// `ssh <host> agentboxd dial-stdio`, as Docker's CLI reaches dockerd.
export function dialStdio(socket: string): void {
  const connection = net.connect(socket)
  connection.on('error', (error) => {
    console.error(`agentboxd is not running on ${socket}: ${error.message}`)
    process.exit(1)
  })
  // A client that is done writing may still wait for the answer, so stdin's end does
  // not end the connection; the API closes it after answering.
  process.stdin.pipe(connection, { end: false })
  connection.pipe(process.stdout)
  connection.on('close', () => process.stdout.write('', () => process.exit(0)))
}
