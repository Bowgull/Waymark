# Waymark — troubleshooting (setup guide §22)

## Web / Vite

| Symptom | Likely cause | What to try |
|--------|----------------|-------------|
| `npm run dev` fails | Syntax error, missing dep | Read the terminal error; `npm install` |
| Styles wrong | Tailwind not applied | Check `src/index.css` has `@import "tailwindcss"` and [vite.config.ts](../vite.config.ts) includes Tailwind plugin |

## Capacitor / iOS

| Symptom | Likely cause | What to try |
|--------|----------------|-------------|
| **Black screen** in app | Asset paths | [vite.config.ts](../vite.config.ts) must have `base: './'` |
| App **did not update** | Stale `dist` | `npm run build` then `npx cap sync ios` then Run in Xcode |
| Signing errors | Team / device | Xcode → Signing & Capabilities; plug in iPhone, Trust |

## Worker / Wrangler

| Symptom | Likely cause | What to try |
|--------|----------------|-------------|
| `wrangler: command not found` | Local install | Use **`npx wrangler`** (see [package.json](../package.json) scripts) |
| D1 query fails | Binding / migration | `wrangler.jsonc` → binding **`DB`**; `npx wrangler d1 list`; apply migrations locally |
| **404** on API | Wrong URL | API is **`http://localhost:8787/...`** in dev, not 5173 (unless proxied) |

## Drizzle / migrations

| Symptom | Likely cause | What to try |
|--------|----------------|-------------|
| Table missing | Migration not applied | `npm run db:migrate:local` or manual `npx wrangler d1 execute ... --local --file=...` |
| Remote vs local mismatch | Only migrated locally | Run **remote** migration only when intended ([TESTING.md](TESTING.md)) |

## Cursor / AI

| Symptom | What to try |
|--------|-------------|
| Cursor changes too much | Smaller prompts; say **do not modify** unrelated paths |
| Plan drift | Re-read `docs/prompts/MASTER_PLAN_PROMPT.md` and `docs/master/MASTER_BUILD_DOCUMENT.md` |

## Glossary (short)

- **Wrangler** — CLI for Workers + D1.  
- **D1** — Cloudflare SQLite (binding **`env.DB`**).  
- **Drizzle** — TypeScript ORM; schema in `src/db/schema.ts`.  
- **Hono** — API routes in `src/server/app.ts`.

Full glossary: `docs/reference/waymark-full-stack-setup.txt` §22.
