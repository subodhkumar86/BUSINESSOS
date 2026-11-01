import { database } from '../server/mongo/database.ts'
import { runScheduledStockReviews } from '../server/mongo/automation-worker.ts'
try {
  console.log(await runScheduledStockReviews())
} finally {
  const d = await database()
  await d.client.close()
}
