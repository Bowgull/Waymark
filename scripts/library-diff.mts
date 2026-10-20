/**
 * Library rows a database lacks: its exercises, combos, techniques and run
 * types against every drizzle/ migration plus src/db/seed.sql (what the code
 * expects). Run on a scratch copy of a backup (loaded into SQLite), never the
 * live database:
 *
 *   npx tsx scripts/library-diff.mts <backup-copy.sqlite>
 */
import Database from 'better-sqlite3'
import { migratedSqlite } from '../src/server/replay/db'
const fresh = migratedSqlite(':memory:')
const migOnly = migratedSqlite(':memory:', { seedLibrary: false })
const prod = new Database(process.argv[2], { readonly: true })
for (const t of ['exercises', 'combos', 'techniques', 'run_types']) {
  const ids = (db: Database.Database) => new Set((db.prepare(`SELECT id FROM ${t}`).all() as { id: string }[]).map(r => r.id))
  const p = ids(prod), f = ids(fresh), m = ids(migOnly)
  const missing = [...f].filter(x => !p.has(x))
  console.log(t, 'prod', p.size, 'expected', f.size, 'missing', missing.map(x => `${x}${m.has(x) ? '(migration)' : '(seed)'}`).join(' ') || '-')
}
