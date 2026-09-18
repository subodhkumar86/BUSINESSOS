// cPanel helper that installs dependencies and builds the SPA without a terminal.
//
// cPanel > Setup Node.js App > your application > Run JS script > scripts/cpanel-build.cjs
//
// cPanel runs npm install with NODE_ENV=production, which skips devDependencies.
// Vite, TypeScript and Tailwind are devDependencies, so the build needs --include=dev.
const { execSync } = require('node:child_process')

function run(command, timeout) {
  console.log('> ' + command)
  console.log(execSync(command + ' 2>&1', { encoding: 'utf8', timeout }))
}

try {
  run('npm install --include=dev --no-audit --no-fund', 900000)
  run('npm run build', 600000)
  console.log('Build finished. dist/index.html should now exist.')
} catch (e) {
  console.log((e.stdout || '') + (e.message || String(e)))
  process.exitCode = 1
}
