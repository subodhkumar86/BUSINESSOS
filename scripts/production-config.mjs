export function productionProblems(
  env,
  { coreOnly = false, nodeVersion = process.versions.node } = {},
) {
  const problems = []
  if (Number(nodeVersion.split('.')[0]) !== 24)
    problems.push(
      'Use Node.js 24, matching package.json and the deployment runtime.',
    )
  const uri = env.MONGODB_URI || env.DATABASE_URL || ''
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri) || /<[^>]+>/.test(uri))
    problems.push(
      'Set DATABASE_URL or MONGODB_URI to a real MongoDB connection string.',
    )
  const origins = (env.APP_ORIGIN || '').split(',')
  if (origins.some((value) => !httpsUrl(value.trim(), true)))
    problems.push(
      'Set APP_ORIGIN to one or more comma-separated HTTPS origins without paths.',
    )
  if (env.COOKIE_SECURE !== 'true')
    problems.push('Set COOKIE_SECURE=true for production sessions.')
  if (coreOnly) return problems
  for (const name of ['APP_ENCRYPTION_KEY', 'CONNECTOR_ENCRYPTION_KEY']) {
    const value = env[name] || ''
    if (
      !/^[a-f\d]{64}$/i.test(value) &&
      !(
        /^[A-Za-z\d+/]{43}=$/.test(value) &&
        Buffer.from(value, 'base64').length === 32
      )
    )
      problems.push(
        `Set ${name} to a stable, random 32-byte base64 or 64-character hex key.`,
      )
  }
  if (env.ALLOW_DEVELOPMENT_RESET_TOKENS === 'true')
    problems.push(
      'Disable ALLOW_DEVELOPMENT_RESET_TOKENS in deployment configuration.',
    )
  if (env.NOTIFY_PROVIDER?.trim() !== 'webhook')
    problems.push(
      'Set NOTIFY_PROVIDER=webhook for recovery and queued notification delivery.',
    )
  if (!httpsUrl(env.NOTIFY_WEBHOOK_URL?.trim()))
    problems.push(
      'Set NOTIFY_WEBHOOK_URL to an HTTPS endpoint without embedded credentials or a fragment.',
    )
  for (const name of ['DELIVERY_WEBHOOK_SECRET', 'CRON_SECRET']) {
    if ((env[name] || '').trim().length < 32)
      problems.push(`Set ${name} to a random secret of at least 32 characters.`)
  }
  return problems
}

function httpsUrl(value, originOnly = false) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!originOnly || (url.pathname === '/' && !url.search))
    )
  } catch {
    return false
  }
}
