# Waymark — style guide (working copy)

## Principles

- **Dark UI** — comfortable for early morning / evening training context.  
- **Mobile-first** — iPhone is the primary surface; layouts should work in a narrow viewport.  
- **Single athlete** — no social feed patterns unless explicitly added later.  
- **Clear hierarchy** — readable type, enough contrast, tap targets that feel natural on a phone.

## Brand assets (PNGs in repo)

These files live in **`assets/brand/`** (imported from the Waymark Bible Style Guide):

| File | Role |
|------|------|
| `Logo.png` | Primary mark |
| `Strength.png` | Strength / lifting motif |
| `MuayThai.png` | Striking / Muay Thai motif |
| `Running.png` | Running motif |
| `Bagwork.png` | Bag work motif |
| `Mobility.png` | Mobility motif |
| `Wellness.png` | Wellness motif |
| `Core.png` | Core training motif |

Use them for headers, empty states, and section accents as the product grows.

## Tailwind / implementation

- Tailwind v4 is wired via `@tailwindcss/vite` and `@import "tailwindcss"` in `src/index.css`.  
- Prefer **semantic layout** (`min-h-screen`, spacing scale, consistent radii) over one-off magic numbers.

## Original Word style guide

Pixel-level typography and color specs may still live in **`Waymark Style Guide.docx`** (Waymark Bible). If you change brand rules, update **this markdown** so Cursor sees the current intent without opening Word.
