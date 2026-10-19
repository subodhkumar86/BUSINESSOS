import { initializeDatabase, database } from '../server/mongo/database.ts'
try {
  await initializeDatabase()
  console.log('MongoDB indexes and subscription plans are ready.')
} finally {
  const d = await database()
  await d.client.close()
}
