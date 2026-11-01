// Test-only server: one direct child lets the harness release it on Windows.
// Deployment continues to use the normal Next.js server.
import { createServer } from 'node:http'
import next from 'next'

const port = Number(process.argv[2])
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error('Invalid browser test port.')
const app = next({ dev: false, hostname: '127.0.0.1', port })
const handle = app.getRequestHandler()
await app.prepare()
const server = createServer((request, response) => {
  void handle(request, response)
})
server.on('upgrade', app.getUpgradeHandler())
server.listen(port, '127.0.0.1')
