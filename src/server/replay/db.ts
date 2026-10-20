// Replay harness only: a scratch SQLite with every drizzle/ migration applied
// (as server/testDb.ts does), plus the exercise and combo library from
// src/db/seed.sql. A file path keeps the result for inspection; ':memory:'
// for tests. Never imported by the app or the Worker.
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

export function migratedSqlite(path = ':memory:', opts: { seedLibrary?: boolean; root?: string } = {}): Database.Database {
  const root = opts.root ?? process.cwd()
  if (path !== ':memory:' && existsSync(path)) unlinkSync(path)
  const sqlite = new Database(path)
  const dir = join(root, 'drizzle')
  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    // Table-copy INSERTs lean on D1 reading an unknown "column" as a string; the tables are empty here.
    sqlite.exec(readFileSync(join(dir, f), 'utf8').replace(/--> statement-breakpoint/g, '').replace(/INSERT INTO `__new_\w+`[^;]*;/g, ''))
  }
  if (opts.seedLibrary !== false) sqlite.exec(readFileSync(join(root, 'src', 'db', 'seed.sql'), 'utf8'))
  sqlite.pragma('foreign_keys = ON')
  return sqlite
}
