// The fresh-start batch must delete children before parents, or D1's foreign
// keys fail the whole batch (it did after any replace: sessions.adjustment_id
// points at week_adjustments). Checks the order against every FK in the schema.
import assert from 'node:assert/strict'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { clearCollectedTrainingData } from './trainingReset'

type Op = { kind: 'delete' | 'update'; table: SQLiteTable }
const ops: Op[] = []
const fakeDb = {
  delete: (table: SQLiteTable) => ({ kind: 'delete', table }),
  update: (table: SQLiteTable) => ({ set: () => ({ kind: 'update', table }) }),
  batch: async (items: Op[]) => { ops.push(...items) },
}

await clearCollectedTrainingData(fakeDb as unknown as Parameters<typeof clearCollectedTrainingData>[0])

const deleted = ops.filter(o => o.kind === 'delete').map(o => getTableConfig(o.table).name)
const position = new Map(deleted.map((name, i) => [name, i]))
assert.ok(position.has('sessions') && position.has('week_adjustments'))
assert.ok(position.get('sessions')! < position.get('week_adjustments')!, 'sessions go before week_adjustments')

let checked = 0
for (const op of ops.filter(o => o.kind === 'delete')) {
  const config = getTableConfig(op.table)
  for (const fk of config.foreignKeys) {
    const parent = getTableConfig(fk.reference().foreignTable).name
    if (!position.has(parent) || parent === config.name) continue
    checked++
    assert.ok(position.get(config.name)! < position.get(parent)!, `${config.name} is deleted before ${parent}`)
  }
}
assert.ok(checked >= 10, `checked the FK order (${checked} links)`)
assert.ok(deleted.includes('idempotency_keys'), 'stored idempotent replies are cleared too')

console.log('trainingReset order tests passed')
