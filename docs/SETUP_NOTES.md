# Waymark — setup notes

Machine-specific and “how we run this repo” facts. Safe to commit; **no secrets** here.

## Repository

- **Remote:** `https://github.com/Bowgull/Waymark.git`  
- **Branch:** `main`

## Roadmap and ops docs

- **[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)** — living stack + deploy + §19 phase list  
- **[`TESTING.md`](TESTING.md)** — where to verify changes (browser, Worker, iOS)  
- **[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)** — common failures and fixes  

## Frontend

- **Package name:** `waymark-c3` (npm)  
- **Dev:** `npm run dev` → Vite (e.g. http://localhost:5173/)  
- **Production build:** `npm run build`  
- **Capacitor:** `webDir` is **`dist`** — always **build** before syncing to iOS.

## Vite + Capacitor (important)

- **`vite.config.ts`** sets `base: './'` so asset URLs are **relative** (`./assets/...`).  
  Without this, the iOS WebView often shows a **black screen** because `/assets/...` fails to load.

## iOS shell

- **Capacitor app ID:** `com.joshbocas.app`  
- **App display name (config):** `waymark-c3` — change `appName` in `capacitor.config.ts` to `Waymark` when you want that on the home screen.  
- **Sync after every web build:** `npm run build && npx cap sync ios`  
- **Open Xcode:** `npx cap open ios`

## Cloudflare Worker + D1 (setup guide §11–§12)

- **Wrangler** is a **devDependency** — run CLI with **`npx wrangler`** (not global `wrangler`), e.g. `npx wrangler login`, `npx wrangler dev`, `npx wrangler d1 list`.
- **`wrangler.jsonc`** — Worker `main` is **`src/index.ts`** (React stays on **`main.tsx`**).
- **D1** — database **`waymark-db`**; binding name **`DB`** in config so Worker code uses **`env.DB`** (matches the setup guide). `database_id` lives in **`wrangler.jsonc`** (not a secret like an API key).

## API + database (setup guide §13–§15)

- **Hono** app: [`src/server/app.ts`](src/server/app.ts) — routes **`/api/health`**, **`/api/sessions`** (reads from D1 via Drizzle).
- **Drizzle schema:** [`src/db/schema.ts`](src/db/schema.ts); **client:** [`src/db/client.ts`](src/db/client.ts). Config: [`drizzle.config.ts`](drizzle.config.ts).
- **Migrations** live in **`drizzle/`** (SQL + `meta/`). Initial file: **`drizzle/0000_init_sessions.sql`**.
- **npm scripts:** `npm run db:generate` (after schema changes), `npm run db:migrate:local` / `db:migrate:remote` (point at the latest `drizzle/0000_*.sql` — if you add a new migration, update **`package.json`** scripts or pass `--file` manually).
- **Local dev:** run **`npx wrangler dev`** (Worker + local D1, default **http://localhost:8787**). Vite (**`npm run dev`**) does **not** proxy to the Worker unless you add that later — the guide’s “open 5173/api/…” note assumes a combined dev setup; here the API is on **8787** until you wire a proxy.
- **Apply migration to remote D1** (only when you intend to change cloud data):

```bash
npx wrangler d1 execute waymark-db --remote --file=./drizzle/0000_init_sessions.sql
```

- **Verify tables (local):** `npx wrangler d1 execute waymark-db --local --command "SELECT name FROM sqlite_master WHERE type='table';"`

## Environment placeholders (§17)

- **[`.env.example`](.env.example)** — safe to commit; copy to **`.env`** for real values. **`.env`** is gitignored.
- **Wrangler secrets** (production): set in the Cloudflare dashboard or `npx wrangler secret put <NAME>` — never commit secret values.

## Docs and brand (step 7)

- **`docs/master/MASTER_BUILD_DOCUMENT.md`** — product + phases  
- **`docs/style-guide/WAYMARK_STYLE_GUIDE.md`** — style principles + PNG index  
- **`docs/reference/waymark-full-stack-setup.txt`** — full exported setup guide  
- **`assets/brand/*.png`** — logos / discipline symbols  

## Stack versions

See **`package.json`** for exact versions (React, Vite, Capacitor, Tailwind, **drizzle-orm**, **drizzle-kit**).

## Drizzle + `npm audit` (don’t loop)

- **`drizzle-kit`** may still report **moderate** advisories (transitive **esbuild**). That’s a **dev-tooling** finding, not your production Worker.
- **Do not run `npm audit fix --force`** to chase it — npm can **ping-pong `drizzle-kit` versions** (e.g. 0.18 ↔ 0.31) and never clear the warning. If versions drift, set **`drizzle-kit`** explicitly in **`package.json`** and run **`npm install`** (no `--force`).

## Not used in this project

- **`clasp`** — Google Apps Script; ignore “Project settings not found” if run here by mistake.
