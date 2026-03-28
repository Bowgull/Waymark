import { Hono } from 'hono'

import { createDB } from '../db/client'
import { sessions } from '../db/schema'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.text('Waymark Worker')
})

app.get('/api/health', (c) => {
  return c.json({ status: 'Waymark API running' })
})

app.get('/api/sessions', async (c) => {
  const db = createDB(c.env)
  const rows = await db.select().from(sessions)
  return c.json(rows)
})

export default app
