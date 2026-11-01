import { MongoClient } from 'mongodb'
import nextEnv from '@next/env'
import { productionProblems } from './production-config.mjs'

// Match `next build` / `next start` environment-file precedence.
nextEnv.loadEnvConfig(process.cwd(), false)

const coreOnly = process.argv.includes('--core-only')
const problems = productionProblems(process.env, { coreOnly })
const uri = process.env.MONGODB_URI || process.env.DATABASE_URL || ''

if (problems.length) {
  for (const problem of problems) console.error(problem)
  process.exitCode = 1
} else {
  const deadline = setTimeout(() => {
    console.error(
      'Production database checks timed out. Verify database network access and DNS.',
    )
    process.exit(1)
  }, 20000)
  deadline.unref()
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    timeoutMS: 10000,
  })
  try {
    await client.connect()
    const db = client.db(process.env.MONGODB_DB || undefined)
    const hello = await db.admin().command({ hello: 1 })
    if (!hello.setName && hello.msg !== 'isdbgrid')
      throw Error(
        'MongoDB must be a replica set or sharded cluster for transactions.',
      )
    const schema = await db.collection('schema').findOne({ _id: 'mongodb' })
    if (!schema?.version)
      throw Error(
        'Database setup is missing. Run npm run db:migrate against the deployment database.',
      )
    if (!(await db.collection('plans').findOne({ _id: 'business' })))
      throw Error(
        'The business subscription plan is missing. Run npm run db:migrate.',
      )
    console.log(
      coreOnly
        ? 'Core configuration and database checks passed. Workflow readiness was NOT checked.'
        : 'Production configuration and database checks passed. Verify provider delivery and scheduler execution separately before release.',
    )
  } catch {
    // Driver errors may include credentials or deployment hostnames.
    console.error(
      'Production database checks failed. Verify connectivity, replica-set support, database permissions and npm run db:migrate. Connection details were withheld.',
    )
    process.exitCode = 1
  } finally {
    await client.close()
    clearTimeout(deadline)
  }
}
