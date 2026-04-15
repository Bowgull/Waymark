# Splash Screen Animation — Seamless Launch Experience

> Option C: Match the iOS native splash, then animate in HTML/CSS.
> Planned 2026-04-15.

---

## Problem

Current launch sequence is jarring:

1. **iOS native splash** -- static "Splash" image on white background (LaunchScreen.storyboard)
2. **Black void** -- empty `<div id="root"></div>` while React loads, bundles parse, fonts download
3. **"Loading..." text** -- TodayPage shows plain text while API responds
4. **Actual content** -- app finally renders

The user sees three distinct visual states before the app is usable. Feels broken.

---

## Solution (Option C — Seamless Handoff)

Make the native iOS splash and the HTML splash look identical. The user sees one continuous experience: logo appears -> logo animates -> app fades in.

### Layer 1: iOS Native Splash (static)

Update `LaunchScreen.storyboard`:
- Background color: `#0a0a0a` (matches app theme, currently white)
- Waymark logo (shield) centered
- No text, no animation (Apple restriction -- native splash is always static)
- Add the logo to the iOS asset catalog (`Assets.xcassets`) as the splash image

### Layer 2: HTML Splash (animated, inline in index.html)

Add directly to `index.html` inside the `<body>`, before `<div id="root">`:
- Inline SVG of the Waymark logo, centered, same size/position as the iOS splash
- When the page loads, the logo is already visible in the exact same position -- seamless handoff from native splash
- CSS animation plays:
  - Subtle gold glow pulse (box-shadow or filter animation, ~1-1.5s)
  - Optional: slight scale-up (1.0 -> 1.05 -> 1.0)
  - Keep it short and tasteful -- this is a training app, not a movie studio
- All CSS is inline in a `<style>` tag (no external dependencies, renders before any JS loads)

### Layer 3: React Takeover

When React mounts and the app is ready:
- The splash element fades out (opacity 1 -> 0, ~300ms)
- The app content fades in underneath
- Remove the splash element from the DOM after transition completes
- Trigger this from `main.tsx` or a top-level `useEffect` in `AppRoutes`

---

## Implementation Details

### index.html changes

```html
<body>
  <!-- Splash — visible immediately, before React loads -->
  <div id="splash" style="
    position: fixed; inset: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    background: #0a0a0a;
  ">
    <!-- Inline Waymark logo SVG here -->
    <img src="/assets/brand/Logo.png" alt="" style="..." class="splash-logo" />
  </div>

  <style>
    .splash-logo {
      animation: splashGlow 1.5s ease-in-out;
    }
    @keyframes splashGlow {
      0% { opacity: 0.8; filter: drop-shadow(0 0 0px #E8C860); }
      50% { opacity: 1; filter: drop-shadow(0 0 20px #E8C860); transform: scale(1.03); }
      100% { opacity: 1; filter: drop-shadow(0 0 8px #E8C860); transform: scale(1); }
    }
    #splash.fade-out {
      opacity: 0;
      transition: opacity 0.3s ease;
    }
  </style>

  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

### React dismissal (main.tsx or AppRoutes)

```tsx
useEffect(() => {
  const splash = document.getElementById('splash')
  if (splash) {
    splash.classList.add('fade-out')
    setTimeout(() => splash.remove(), 300)
  }
}, [])
```

### LaunchScreen.storyboard changes

- Change background color from `systemBackgroundColor` (white) to custom `#0a0a0a`
- Ensure the Splash image in the asset catalog matches the logo used in HTML
- Logo should be centered with `contentMode="center"` (not `scaleAspectFill`)

---

## Files Touched

| File | Action |
|---|---|
| `index.html` | **Modify** -- add inline splash div, style, logo |
| `src/main.tsx` or `src/app/AppRoutes.tsx` | **Modify** -- add splash dismissal on mount |
| `ios/App/App/Base.lproj/LaunchScreen.storyboard` | **Modify** -- dark background, centered logo |
| `ios/App/App/Assets.xcassets/` | **Modify** -- update Splash image asset if needed |

## Design Decisions

- **Inline everything** -- the splash must render before any JS or CSS files load. External resources add latency and risk a flash.
- **Logo only, no text** -- the shield is the brand. Text adds clutter on a splash.
- **Gold glow, not spin/bounce** -- matches the app's aesthetic. Subtle, confident, fighter energy.
- **1.5s max animation** -- any longer feels like the app is stalling. The glow plays while React boots, then the app takes over.
- **No loading bar** -- loading bars on splash screens look cheap. The animation provides perceived progress.

## What We're NOT Doing

- No Lottie or JS animation library (overkill, adds bundle size)
- No loading progress indicator
- No text/tagline on the splash
- No sound on launch
