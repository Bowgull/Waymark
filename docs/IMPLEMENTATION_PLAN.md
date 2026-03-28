# Waymark — implementation plan (living document)

This file is the **roadmap snapshot** the setup guide §18 describes. **Update it** after major Plan mode sessions. It is **not** a duplicate of [MASTER_BUILD_DOCUMENT.md](master/MASTER_BUILD_DOCUMENT.md) (product vision + phases); this doc tracks **how** the repo evolves and **what’s left** for “guide closure” vs **product** work.

## 1. Purpose

- Record **stack status** and **next slices** after bootstrap.  
- Point to **prompts** ([MASTER_PLAN_PROMPT.md](prompts/MASTER_PLAN_PROMPT.md), [PLAN_FIRST_SLICE.md](prompts/PLAN_FIRST_SLICE.md)).  
- Centralize **deploy** and **environment** notes without committing secrets.

## 2. Current stack status (audit — §7–§17)

| Area | Status | Key paths |
|------|--------|-----------|
| Frontend | Done | `vite.config.ts` (`base: './'`), `src/` React + Tailwind |
| Capacitor iOS | Done | `capacitor.config.ts`, `ios/` |
| Docs + brand | Done | `docs/master/`, `docs/style-guide/`, `assets/brand/`, `docs/reference/` |
| Worker + D1 | Done | `wrangler.jsonc` — `main` `src/index.ts`, binding **`DB`**, DB `waymark-db` |
| Drizzle | Done | `src/db/schema.ts`, `drizzle.config.ts`, `drizzle/0000_init_sessions.sql` |
| Hono API | Done | `src/server/app.ts` — `/`, `/api/health`, `/api/sessions` |
| Folder scaffold §16 | Done | `src/features/*`, `src/components/*`, `src/lib/*` |
| Env template §17 | Done | `.env.example`, `.env` gitignored |
| Plan prompts §18 | Done | `docs/prompts/MASTER_PLAN_PROMPT.md`, `PLAN_FIRST_SLICE.md` |
| Testing doc §20 | Done | [TESTING.md](TESTING.md) |
| Troubleshooting §22 | Done | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

**Human-only (not in git):** Wrangler OAuth login, physical iPhone signing, Cloudflare dashboard actions, **remote** D1 changes, real API tokens.

## 3. Setup guide closure checklist

- [x] React + Vite + Tailwind + Capacitor shell in repo  
- [x] Worker + D1 + Drizzle + Hono baseline  
- [x] `MASTER_PLAN_PROMPT.md` saved  
- [x] `IMPLEMENTATION_PLAN.md` (this file)  
- [x] Testing / troubleshooting docs  
- [x] **Deploy** — Worker live at `https://waymark.bocas-joshua.workers.dev`; smoke **`/api/health`** (see §4)  
- [x] **Remote D1** — **`npm run db:migrate:remote`** applied; prod **`/api/sessions`** returns `[]` / HTTP 200  
- [ ] **Physical device** — optional; Simulator verified separately; real iPhone when you need that gate  

**Definition of done (handbook):** Stack + docs + prompts are in place; **you** have smoke-tested **deploy** and chosen **device** strategy. Product phases (§19) are **ongoing**, not a single checkbox.

## 4. Deploy and production API (setup guide §21)

**Human steps:**

1. From repo root: **`npx wrangler login`** (if session expired).  
2. **`npx wrangler deploy`** — Wrangler prints a **workers.dev** URL.  
3. In a browser: **`https://<YOUR_SUBDOMAIN>.workers.dev/api/health`** — expect JSON like `{ "status": "Waymark API running" }`.  
4. For the **React app** to call production API: set **`VITE_API_URL`** in **local** `.env` (copy from `.env.example`) to that base URL **without** committing `.env`. Rebuild: `npm run build` / Capacitor sync as needed.  
5. **Remote D1 schema** — when the cloud database must match migrations:

```bash
npm run db:migrate:remote
```

(or `npx wrangler d1 execute waymark-db --remote --file=./drizzle/0000_init_sessions.sql` until you add newer migration files — update `package.json` scripts when filenames change.)

**Do not** commit secrets. Use `wrangler secret put <NAME>` for Worker secrets in production.

## 5. Post-setup product work (setup guide §19)

Build in **this order** — **one phase at a time**: Plan → small Agent prompts → test ([TESTING.md](TESTING.md)) → commit.

| Phase | Focus |
|-------|--------|
| 1 | App shell and routing |
| 2 | Today screen |
| 3 | Wellness flow |
| 4 | Workout session engine |
| 5 | Timer engine |
| 6 | Bag work / combo engine |
| 7 | Running system |
| 8 | History and review |
| 9 | Offline handling |
| 10 | Active session recovery |

**Rule:** Never implement multiple phases in one shot. Use [MASTER_PLAN_PROMPT.md](prompts/MASTER_PLAN_PROMPT.md) for a **big** replan; use [PLAN_FIRST_SLICE.md](prompts/PLAN_FIRST_SLICE.md) for a **single** slice.

## 6. Environments

| Environment | UI | API |
|-------------|-----|-----|
| Local dev | Vite **http://localhost:5173** | `npx wrangler dev` **http://localhost:8787** |
| Production | Built `dist` / Capacitor | `https://<worker>.workers.dev` (after deploy) |

## 7. Human gates (summary)

- Apple **Xcode** signing and **Trust** on device  
- **Cloudflare** login, **deploy**, **secrets**  
- **Remote D1** migrations (irreversible data path)  
- Pasting **richer** Plan output into **this file** when you want history  

## 8. Revision log

| Date | Note |
|------|------|
| 2026-03-28 | Initial plan: §18–§22 doc closure; stack audit inlined |
| 2026-03-28 | Phase 0: `VITE_API_URL` helper in app, dev health badge, remote D1 migrate, prod `/api/sessions` OK; Deploy + Remote D1 checkboxes satisfied |
| 2026-03-28 | Phase 1: `react-router-dom`, shell layout, Today / History / Settings placeholders; Vite starter removed |
