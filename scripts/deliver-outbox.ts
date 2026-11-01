import { database } from '../server/mongo/database.ts'
import { deliverQueued } from '../server/mongo/outbox.ts'

try {
  console.log(await deliverQueued())
} finally {
  const d = await database()
  await d.client.close()
}
