# Waymark

Mobile-first training app for one athlete.

Waymark runs on React, Vite, Capacitor, Cloudflare Workers, D1, Drizzle, and Hono. The phone is the primary surface. The web preview is only a workbench.

## Current Build

- Block Zero is the entry point: a 6-week return-to-training ramp before the Fighter block.
- Block Zero can start fresh, which clears collected training history first.
- Strava run data is mapped into run evidence for coaching and Ledger context.
- AI is bounded. It can summarize, adapt inside rails, and explain changes.

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

For quick browser QA against the production Worker:

```bash
npm run dev:remote
```

This keeps the UI local and sends API calls to `https://waymark.bocas-joshua.workers.dev`.

## Core Commands

```bash
npm run test:lib
npm run lint
npm run build
npm run preview:remote
```

Block Zero fresh-start smoke check (local `wrangler dev` only):

```bash
npm run smoke:block-zero-reset
```

Do not run a destructive production fresh start unless that is the explicit task.

Targeted D1 migrations:

```bash
npm run db:migrate:0011:remote
npm run db:migrate:0019:remote
npm run db:migrate:0022:remote
```

Use the targeted script for the migration you mean. Do not pass extra `--file` arguments through `npm run db:migrate:remote`.

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

- Block Zero fresh start (`POST /api/blocks/block-zero` with `freshStart: true`) clears all collected training history and requires `confirmReset: true`.
- The Block Zero reset smoke resets local D1 state by design and refuses non-local API targets.
- Remote smoke scripts are non-destructive unless explicitly allowed.
- Foundation-run and offline-review smokes write ad-hoc sessions. They refuse non-local API targets unless `WAYMARK_ALLOW_REMOTE_SMOKE=1` is set.
- No live AI smoke runs unless `WAYMARK_LIVE_AI_SMOKE=1` is set.
- No remote Strava poll should be run casually. It can write real activities.

## Project Notes

- Handoff lives in `WAYMARK_SESSION_HANDOFF.md`.
- Style guide lives in `docs/style-guide/WAYMARK_STYLE_GUIDE.md`.
- Build plans live in `BUILD_PLAN.md`, `BUILD_PLAN_v1_DONE.md`, and `docs/IMPLEMENTATION_PLAN.md`.

Read the handoff first. Then run the checks. The ledger is the truth.
