# Waymark — testing habits (setup guide §20)

Test meaningful changes in **three places** when they touch that layer:

| Layer | Command / action |
|--------|-------------------|
| **Web UI** | `npm run dev` → browser at **http://localhost:5173** |
| **API + local D1** | `npx wrangler dev` → **http://localhost:8787** (`/`, `/api/health`, `/api/sessions`) |
| **iOS shell** | `npm run build` → `npx cap sync ios` → **Run** in Xcode (Simulator or device) |

**Production API** (after deploy): hit `https://<your-worker>.workers.dev/api/health` (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) deploy section).

## D1 migrations

- **Local:** after `npm run db:generate`, apply with `npm run db:migrate:local` (or `npx wrangler d1 execute waymark-db --local --file=./drizzle/<migration>.sql`).  
- **Remote:** only when you **intentionally** change cloud data — `npm run db:migrate:remote` or the same with `--remote`. **Human gate:** confirm you mean to touch production D1.

**Verify tables (local):**

```bash
npx wrangler d1 execute waymark-db --local --command "SELECT name FROM sqlite_master WHERE type='table';"
```

## Common slip-ups

- **Phone UI stale** — forgot `npm run build` + `npx cap sync ios` before Xcode Run.  
- **API 404** — wrong port (UI on 5173, API on 8787 unless you add a Vite proxy).  
- **D1 errors** — check `wrangler.jsonc` binding is **`DB`** and migration ran on the same environment (local vs remote).

## npm audit

- **Do not** run `npm audit fix --force` to chase `drizzle-kit` / esbuild advisories — see [SETUP_NOTES.md](SETUP_NOTES.md).

## Recovery

```bash
git status
git add .
git commit -m "Checkpoint"
git push
```

If the working tree is broken and uncommitted: `git reset --hard HEAD` (destroys uncommitted work).
