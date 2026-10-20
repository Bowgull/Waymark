// Replay harness only (P0, coach-brain §12): a D1Database over better-sqlite3,
// so the real Worker app (server/app.ts) and the nightly job run in Node on a
// scratch SQLite file. Implements what drizzle-orm/d1 and the app call:
// prepare().bind().all()/run()/raw()/first(), batch() and exec(). Never
// imported by the app or the Worker.
import Database from 'better-sqlite3'

type Param = string | number | bigint | Buffer | null

function toParam(v: unknown): Param {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof ArrayBuffer) return Buffer.from(v)
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  return v as Param
}

interface Meta { changes: number; last_row_id: number; duration: number; rows_read: number; rows_written: number }

class ShimStatement {
  readonly sqlite: Database.Database
  readonly sql: string
  readonly params: Param[]
  constructor(sqlite: Database.Database, sql: string, params: Param[] = []) {
    this.sqlite = sqlite
    this.sql = sql
    this.params = params
  }

  bind(...values: unknown[]): ShimStatement {
    return new ShimStatement(this.sqlite, this.sql, values.map(toParam))
  }

  /** Sync core, shared by the async API and batch(). */
  exec(): { results: Record<string, unknown>[]; meta: Meta } {
    const stmt = this.sqlite.prepare(this.sql)
    if (stmt.reader) {
      const results = stmt.all(...this.params) as Record<string, unknown>[]
      return { results, meta: { changes: 0, last_row_id: 0, duration: 0, rows_read: results.length, rows_written: 0 } }
    }
    const info = stmt.run(...this.params)
    return { results: [], meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid), duration: 0, rows_read: 0, rows_written: info.changes } }
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Meta }> {
    const r = this.exec()
    return { results: r.results as T[], success: true, meta: r.meta }
  }

  async run(): Promise<{ results: unknown[]; success: true; meta: Meta }> {
    const r = this.exec()
    return { results: r.results, success: true, meta: r.meta }
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.sqlite.prepare(this.sql)
    if (!stmt.reader) {
      stmt.run(...this.params)
      return []
    }
    return stmt.raw(true).all(...this.params) as T[]
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const { results } = this.exec()
    const row = results[0]
    if (!row) return null
    return (column ? row[column] : row) as T
  }
}

export interface D1Shim {
  prepare(sql: string): ShimStatement
  batch(stmts: ShimStatement[]): Promise<Array<{ results: unknown[]; success: true; meta: Meta }>>
  exec(sql: string): Promise<{ count: number; duration: number }>
  dump(): Promise<ArrayBuffer>
  /** The underlying SQLite, for the harness's own reads. */
  sqlite: Database.Database
}

export function d1Shim(sqlite: Database.Database): D1Shim {
  return {
    sqlite,
    prepare: (sql: string) => new ShimStatement(sqlite, sql),
    async batch(stmts) {
      const tx = sqlite.transaction(() => stmts.map(s => s.exec()))
      return tx().map(r => ({ results: r.results, success: true as const, meta: r.meta }))
    },
    async exec(sql: string) {
      sqlite.exec(sql)
      return { count: 1, duration: 0 }
    },
    async dump() {
      throw new Error('dump is not supported by the replay shim')
    },
  }
}
