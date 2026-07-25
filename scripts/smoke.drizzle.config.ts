// Used only by `npm run smoke:athlete-state` to push the schema into a throwaway
// SQLite (_smoke.sqlite). Not part of the app or real migrations.
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './node_modules/.cache/smoke-drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: 'file:./_smoke.sqlite' },
})
