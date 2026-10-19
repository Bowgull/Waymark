// Run: tsx scripts/d1-dump-reorder.test.ts
import assert from 'node:assert/strict'

import { reorderDump, splitStatements } from './d1-dump-reorder'

const dump = [
  'PRAGMA defer_foreign_keys=TRUE;',
  'CREATE TABLE `active_recovery_sessions` (`id` text PRIMARY KEY, `session_id` text REFERENCES sessions(id));',
  "INSERT INTO \"active_recovery_sessions\" VALUES('a1','s1');",
  'CREATE TABLE `sessions` (`id` text PRIMARY KEY, `notes` text);',
  "INSERT INTO \"sessions\" VALUES('s1','Tight; then fine.\nNext day: ok; ''quoted''');",
  'CREATE UNIQUE INDEX `x` ON `sessions` (`id`);',
].join('\n')

const stmts = splitStatements(dump)
assert.equal(stmts.length, 6, 'semicolons inside a quoted value do not split')
assert.ok(stmts[4].includes("Tight; then fine.\nNext day: ok; ''quoted''"))

const out = splitStatements(reorderDump(dump))
assert.ok(out[0].startsWith('PRAGMA'))
assert.ok(out[1].includes('active_recovery_sessions') && out[1].startsWith('CREATE TABLE'))
assert.ok(out[2].startsWith('CREATE TABLE `sessions`'), 'every table exists before any insert')
assert.ok(out[3].startsWith('CREATE UNIQUE INDEX'))
assert.ok(out[4].startsWith('INSERT INTO "active_recovery_sessions"') && out[5].startsWith('INSERT INTO "sessions"'), 'inserts keep their order')
console.log('d1-dump-reorder tests passed')
