# Waymark

Mobile-first training app for one athlete.

Waymark runs on React, Vite, Capacitor, Cloudflare Workers, D1, Drizzle, and Hono. The phone is the primary surface. The web preview is only a workbench.

## Current Build

- Road Bootcamp is the active build slice.
- Road Bootcamp uses fixed 8-week rails.
- Strength generation is bounded to 18 approved variants.
- Strava run data is mapped into run evidence for coaching and Ledger context.
- AI is bounded. It can summarize, adapt inside rails, and explain changes. It does not invent Road Bootcamp workouts.

## Local Setup

```bash
npm install
npm run dev
```

Vite runs at `http://localhost:5173`.

For Worker API development:

```bash
npx wrangler dev
```

Wrangler runs at `http://localhost:8787`.

## Core Commands

```bash
npm run test:lib
npm run lint
npm run build
```

Road Bootcamp smoke checks:

```bash
npm run smoke:road-reset
npm run smoke:road-week
npm run smoke:road-strength
npm run smoke:road-strength-complete
npm run smoke:road-run
npm run smoke:road-remote
```

Remote reset is guarded. Do not run a destructive production Road Bootcamp reset unless that is the explicit task.

## iOS

Build web assets and sync Capacitor:

```bash
npm run ios:sync
```

Open in Xcode:

```bash
npm run ios:open
```

List paired devices:

```bash
npm run ios:devices
npm run ios:doctor
```

CLI native compile check:

```bash
npm run ios:build:generic
```

Physical-device build, once `ios:doctor` reports `READY`:

```bash
WAYMARK_IOS_DEVICE_ID=<CoreDevice id> npm run ios:build:device
```

The current native compile gate passes after installing the iOS 26.5 platform support. Physical sideload still depends on the phone being awake, trusted, available to Xcode, and signed with the configured Apple team.

## Deploy

```bash
npm run deploy
```

Production Worker:

```text
https://waymark.bocas-joshua.workers.dev
```

Native Capacitor builds fall back to this API when the configured API origin is blank, `localhost`, or `127.0.0.1`.

## Data Rules

- Production Road Bootcamp fresh start requires `confirmReset: true`.
- Local Road Bootcamp smoke scripts reset local D1 state by design.
- Remote smoke scripts are non-destructive unless explicitly allowed.
- No live AI smoke runs unless `WAYMARK_LIVE_AI_SMOKE=1` is set.
- No remote Strava poll should be run casually. It can write real activities.

## Project Notes

- Handoff lives in `WAYMARK_SESSION_HANDOFF.md`.
- Style guide lives in `docs/style-guide/WAYMARK_STYLE_GUIDE.md`.
- Build plans live in `BUILD_PLAN.md`, `BUILD_PLAN_v1_DONE.md`, and `docs/IMPLEMENTATION_PLAN.md`.

Read the handoff first. Then run the checks. The ledger is the truth.
