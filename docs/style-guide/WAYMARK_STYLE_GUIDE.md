# Waymark — Style Guide

## Principles

- **Dark UI** — comfortable for early morning / evening training context.
- **Mobile-first** — iPhone is the primary surface via Capacitor.
- **Single athlete** — no social feed patterns.
- **Training command center** — disciplined, focused, calm intensity.
- **Clear hierarchy** — readable type, high contrast, large tap targets (min 48px).

## Color System

Dark-first palette with three accent colors.

### Base Colors

| Role | Color | Usage |
|------|-------|-------|
| Background | `zinc-950` / `#0a0a0a` | Root app background, full screen views |
| Card surface | `zinc-900` | Cards, panels, grouped UI |
| Primary text | `zinc-100` / `#f5f0e8` | Headers, labels, timer numbers |
| Secondary text | `zinc-400` | Descriptions, form cues, metadata |
| Muted text | `zinc-500` | Placeholders, labels, hints |
| Borders | `zinc-800` | Card borders, dividers |

### Accent Colors

| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| Gold (primary action) | Warm gold | `#E8C860` / `#C8A030` | Start buttons, active nav, progress bars, primary CTA |
| Turquoise/Jade (secondary) | Teal | `#4ACAAA` / `#1E8A68` | Wellness, posture, form cues, secondary accents |
| Clay/Burnt Red (MT emphasis) | Burnt clay | `#C45A3C` | MT class, bag work borders, timer warnings, high RPE |
| Forest Green (completion) | Dark green | `#2D6B4F` / `#4ABA8A` | Completed badges, low RPE |

### Session Type Left Border Colors

| Session Type | Border Color |
|-------------|-------------|
| Posture Correctives | Gold `#E8C860` |
| Strength | Dark gold `#C8A030` |
| MT Class | Clay red `#C45A3C` |
| Bag Work | Clay red `#C45A3C` |
| Running | Teal `#1E8A68` |
| Skip Rope | Teal `#1E8A68` |
| Active Recovery | `zinc-600` |

## Typography

- **Display / Headers**: `text-2xl font-bold` — screen titles, exercise names
- **Section labels**: `text-xs uppercase tracking-widest text-zinc-500`
- **Body / UI text**: `text-sm text-zinc-400` — form cues, descriptions
- **Timer numbers**: `text-8xl font-bold tabular-nums` — must dominate visual hierarchy
- **Badges**: `text-xs font-medium` — AM/PM, status indicators

## Navigation

5 tabs: **Today** | **Program** | **Library** | **History** | **Settings**

- Active tab: gold text `#E8C860` with gold underline indicator
- Inactive tab: `text-zinc-500`
- Icon + label per tab (icon 20px, label 10px)

## Components

| Component | File | Usage |
|-----------|------|-------|
| SessionCard | `src/features/today/SessionCard.tsx` | Today screen session blocks |
| SetTracker | `src/features/session/SetTracker.tsx` | Strength workout set input |
| RestTimer | `src/features/session/RestTimer.tsx` | Between-set rest countdown |
| BagWorkRoundView | `src/features/session/BagWorkRoundView.tsx` | Bag work combo cards + round timer |
| HoldTimer | `src/features/session/HoldTimer.tsx` | Posture hold count-up timer |
| WellnessPromptCard | `src/features/today/WellnessPromptCard.tsx` | Daily wellness logging |
| SessionComplete | `src/features/session/SessionComplete.tsx` | Post-session RPE/difficulty/notes |

## Symbol System

Custom inline SVG icons at 18-20px for session types and nav tabs.
Brand SVG crests (`assets/brand/*.svg`) reserved for hero moments and headers.

## Brand Assets

| File | Role |
|------|------|
| `Logo.svg` / `Logo.png` | Primary mark (shield) |
| `Strength.svg` | Strength motif |
| `MuayThai.svg` | Striking motif |
| `Bagwork.svg` | Bag work motif |
| `Mobility.svg` | Mobility motif |
| `Wellness.svg` | Wellness motif |
| `Core.svg` | Core training motif |
| `Cardio.svg` | Cardio motif |

## Implementation

- Tailwind v4 via `@tailwindcss/vite` and `@import "tailwindcss"` in `src/index.css`.
- All styling via Tailwind utility classes — no custom CSS beyond safe areas.
- iOS safe areas via `env(safe-area-inset-*)` and `viewport-fit=cover`.
- Timer UI must be visually dominant — `text-8xl` minimum.
- Buttons: `min-h-[48px]` minimum tap target.
- No hover states — use `active:` for press feedback (touch-only interface).

## Aesthetic

Dark premium with subtle fantasy DNA in details — gold "W" header accent, brand crests for hero moments. Not gamified, not decorative. A disciplined training command center with an atmospheric edge.
