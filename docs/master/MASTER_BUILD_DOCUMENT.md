# Waymark — master build document

This file is the **high-level product + build contract** for Waymark. Keep it in sync with how you actually ship.

## What Waymark is (ELI5)

Waymark is a **dark, mobile-first training system for one athlete**. It is not a generic fitness app and not a spreadsheet clone. The iPhone app should support:

- AM / PM plan
- Starting sessions
- Timers
- Logging training
- Reviewing history
- Later: running data integration

## Architecture (target stack)

```
iPhone shell (Capacitor)
  → Web UI (React + Vite + Tailwind)
  → API (Hono)
  → Cloudflare Workers
  → Drizzle ORM
  → Cloudflare D1
```

**Cursor** is only as good as the docs in this repo — that is why `docs/` and `assets/brand/` exist.

## Safe feature build order

Build in **phases**, not all at once:

1. App shell and routing  
2. Today screen  
3. Wellness flow  
4. Workout session engine  
5. Timer engine  
6. Bag work / combo engine  
7. Running system  
8. History and review  
9. Offline handling  
10. Active session recovery  

## Canonical references in this repo

| Document | Path |
|----------|------|
| Full stack setup + Cursor guide (verbatim export) | `docs/reference/waymark-full-stack-setup.txt` |
| Style assets (PNGs) | `assets/brand/` |
| Style notes (markdown) | `docs/style-guide/WAYMARK_STYLE_GUIDE.md` |
| Environment / machine notes | `docs/SETUP_NOTES.md` |
| Cursor-oriented prompts | `docs/prompts/` |

## Golden rule for AI-assisted work

One **plan** prompt first. **Small** implementation prompts after. Do not ask for the entire app in one shot.
