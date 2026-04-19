import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/52820a42c0501aa4003902b563596a759dea1b77f555f630d35edb90dcc17ea8.sqlite',
  },
})
