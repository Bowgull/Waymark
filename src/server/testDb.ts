// Tests only: an in-memory SQLite with every migration in drizzle/ applied,
// behind the same drizzle query API the Worker uses on D1. Never imported by
// the app.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import type { createDB } from '../db/client'

export type TestDB = ReturnType<typeof createDB>

export function testDb(): TestDB {
  const sqlite = new Database(':memory:')
  const dir = join(process.cwd(), 'drizzle')
  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    // The table-copy INSERTs lean on D1 reading an unknown "column" as a string;
    // the tables are empty here, so they are left out.
    sqlite.exec(readFileSync(join(dir, f), 'utf8').replace(/--> statement-breakpoint/g, '').replace(/INSERT INTO `__new_\w+`[^;]*;/g, ''))
  }
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema }) as unknown as TestDB
}
