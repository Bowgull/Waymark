# Plan Mode — first slice (Waymark)

Use this as the **first message** in Cursor **Plan** mode before asking for implementation.

---

**Read first (source of truth):**

- `docs/master/MASTER_BUILD_DOCUMENT.md`
- `docs/style-guide/WAYMARK_STYLE_GUIDE.md`
- `docs/SETUP_NOTES.md`

**Then** skim the repo layout (`src/features/*`, `src/server`, `src/db`) and `docs/reference/waymark-full-stack-setup.txt` if you need stack details.

**Project:** Waymark — dark, mobile-first training app for one athlete (Capacitor + React + Vite + Tailwind; API on Cloudflare Workers + D1 + Drizzle + Hono).

**Ask of Plan mode:**

1. Propose the **smallest next vertical slice** from the master build phases (e.g. “app shell + routing” or “today screen skeleton only”).
2. List **exact files** you will add or change; say **explicitly** what you will **not** touch.
3. Call out **risks** (Capacitor `base`, `npm run build` + `cap sync`, Worker vs Vite ports).
4. End with **checkpoints**: commands to run (`npm run build`, `npx wrangler dev`, etc.) and what “done” looks like.

**Rules:** One slice only. No full-app rewrite. Match existing patterns and the style guide.
