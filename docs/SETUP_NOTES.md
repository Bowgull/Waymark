# Waymark — setup notes

Machine-specific and “how we run this repo” facts. Safe to commit; **no secrets** here.

## Repository

- **Remote:** `https://github.com/Bowgull/Waymark.git`  
- **Branch:** `main`

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

## Docs and brand (step 7)

- **`docs/master/MASTER_BUILD_DOCUMENT.md`** — product + phases  
- **`docs/style-guide/WAYMARK_STYLE_GUIDE.md`** — style principles + PNG index  
- **`docs/reference/waymark-full-stack-setup.txt`** — full exported setup guide  
- **`assets/brand/*.png`** — logos / discipline symbols  

## Stack versions

See **`package.json`** for exact versions (React, Vite, Capacitor, Tailwind).

## Not used in this project

- **`clasp`** — Google Apps Script; ignore “Project settings not found” if run here by mistake.
