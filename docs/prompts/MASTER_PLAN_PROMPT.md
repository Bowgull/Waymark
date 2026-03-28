# Master Plan prompt (Waymark) — paste into Cursor Plan Mode

**Context:** The **technical bootstrap is already done** in this repo (Vite + React + Tailwind + Capacitor, Wrangler Worker, D1 binding `DB`, Drizzle + migrations, Hono `/api/health` and `/api/sessions`, folder scaffold, `.env.example`). Your job is **not** to reinstall the stack from zero — it is to produce an **implementation plan for the product** (UI, features, API evolution) in **safe phases**.

---

Read these files first and treat them as the source of truth:

- `docs/master/MASTER_BUILD_DOCUMENT.md`
- `docs/style-guide/WAYMARK_STYLE_GUIDE.md`
- `docs/SETUP_NOTES.md`
- `docs/IMPLEMENTATION_PLAN.md` (current roadmap snapshot, if present)

Also inspect the **full repository structure** before making recommendations or writing code.

**Project name:** Waymark

**Required stack (already in use — do not replace):**

- React + Vite  
- Tailwind CSS  
- Hono API on Cloudflare Workers  
- Cloudflare D1 + Drizzle ORM  
- Capacitor iOS shell  
- Xcode  
- GitHub  

**Critical implementation requirements:**

- dark-mode-first  
- mobile-first  
- iPhone-first  
- timer-heavy UI  
- offline-aware behavior  
- active session recovery  
- no hardcoded secrets  
- no invented external config values  

---

I want you to create a **complete implementation plan** for the repository **from its current state** (not a greenfield bootstrap).

Your plan must include:

1. Recommended project structure (what to use under `src/features/`, `src/components/`, `src/lib/` — already scaffolded)  
2. Routing structure (React)  
3. React component structure  
4. Tailwind organization strategy  
5. Hono API structure (extend existing routes; do not break `/api/health` without reason)  
6. D1 + Drizzle setup structure (extend schema only when a feature needs it)  
7. Environment/config file strategy (`.env.example`, Wrangler secrets)  
8. Capacitor integration structure  
9. Placeholder handling for secrets and future integrations  
10. Local development workflow (Vite **5173** + Worker **`npx wrangler dev`** **8787** — see `docs/SETUP_NOTES.md`)  
11. Build and sync workflow for iOS  
12. MVP implementation phases aligned to `MASTER_BUILD_DOCUMENT.md` and setup guide §19 (Phase 1–10 order)  
13. Key risks or failure points to avoid  
14. What should be scaffolded now vs what should remain placeholder-only  

**Do not write code yet.**

**Output:**

- A phased implementation roadmap  
- Recommended file/folder architecture (incremental on what exists)  
- Setup checkpoints  
- A list of placeholders/config values that must exist  
- Clear notes where human input will be required later (Apple signing, Cloudflare dashboard, `wrangler deploy`, remote D1 migrations)  

---

**After Plan mode:** save or merge the result into `docs/IMPLEMENTATION_PLAN.md`. Then use **smaller** prompts — **one feature slice at a time** (see `docs/prompts/PLAN_FIRST_SLICE.md`).

**Example next-step prompt (Agent mode, Phase 1 only):**

Implement only Phase 1:

- app shell  
- routing skeleton  
- Today screen placeholder  
- shared layout structure  
- symbol-aware card components  
- no fake data beyond minimal hardcoded examples  

Requirements: Tailwind only; reusable React components; no over-ornamentation; dark-mode-first; **keep Hono route structure intact**; **do not touch database schema unless necessary**.

---

**Golden rule:** One big plan prompt first. Small implementation prompts after. Never ask Cursor to build the whole app in one shot.
