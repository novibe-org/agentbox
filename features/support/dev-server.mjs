export const startDevServer = `nohup node -e "require('http').createServer((q, s) => s.end('ok')).listen(8000)" >/dev/null 2>&1 </dev/null & echo $! > /tmp/dev-server.pid`
export const devServerAnswers = `kill -0 "$(cat /tmp/dev-server.pid)" && node -e "fetch('http://localhost:8000').then((r) => r.text()).then((t) => process.exit(t === 'ok' ? 0 : 1))"`
