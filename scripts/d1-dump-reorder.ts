// Restore order for a `wrangler d1 export` dump (e2e tooling 28).
//
// The export writes each table's CREATE and then its INSERTs, table by table in
// name order, so child rows (active_recovery_sessions, ...) are inserted before
// `sessions` exists and an import into an empty D1 fails with
// "no such table: main.sessions". PRAGMA foreign_keys=OFF at the top does not
// help on D1. This rewrites the dump: PRAGMAs, then every CREATE TABLE, then
// the other CREATEs (indexes, triggers, views), then the rest in its order.
//
//   npx tsx scripts/d1-dump-reorder.ts <dump.sql> <out.sql>
//
// Then: npx wrangler d1 execute <db> --local --file=<out.sql> (add --remote only
// for a real restore) and check PRAGMA foreign_key_check returns no rows.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Split SQL into statements on ';' outside quotes ('...', "...", `...`) and comments. */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (quote) {
      cur += ch
      if (ch === quote) {
        if (sql[i + 1] === quote) { cur += sql[++i]; continue }
        quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      continue
    }
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function reorderDump(sql: string): string {
  const stmts = splitStatements(sql)
  const rank = (s: string): number => {
    const head = s.slice(0, 40).toUpperCase()
    if (head.startsWith('PRAGMA')) return 0
    if (head.startsWith('CREATE TABLE')) return 1
    if (head.startsWith('CREATE')) return 2
    return 3
  }
  // A stable sort keeps the original order inside each group.
  const ordered = stmts.map((s, i) => ({ s, i, r: rank(s) })).sort((a, b) => a.r - b.r || a.i - b.i)
  return ordered.map(x => `${x.s};`).join('\n') + '\n'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) {
    console.error('usage: npx tsx scripts/d1-dump-reorder.ts <dump.sql> <out.sql>')
    process.exit(1)
  }
  const sql = readFileSync(input, 'utf8')
  const out = reorderDump(sql)
  writeFileSync(output, out)
  console.log(`Wrote ${splitStatements(out).length} statements to ${output}`)
}
