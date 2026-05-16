import { writeFileSync } from 'node:fs'
import { generateDemoSql } from '../src/db/demoSeed'

const lines = generateDemoSql()
const sql = lines.join('\n') + '\n'

writeFileSync('src/db/demoSeed.sql', sql)
console.log(`Wrote ${lines.length} statements to src/db/demoSeed.sql`)
