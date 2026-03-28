import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema'

export function createDB(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema })
}
