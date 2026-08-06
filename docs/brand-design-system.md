# UCT Intelligence — Brand & Design System Specification

> **Purpose:** Complete handoff document for any designer or developer building or revising a page so that it matches the rest of the UCT Intelligence dashboard.
>
> **Source of truth:** `app/src/styles/tokens.css` (imported globally by `app/src/index.css`). Every page, component, and tile consumes these tokens as CSS variables. Never hardcode hex values — always reference the variable so theme switching (default / OLED / Dim) works automatically.
>
> **Audience for this doc:** The developer rebuilding the Options Flow page. Same rules apply to anyone touching the UI.

---

## TABLE OF CONTENTS

1. Brand identity & positioning
2. Typography
3. Full color palette
4. Spacing, radii, shadows
5. Motion & animation
6. Z-index scale
7. Theme variants (default / OLED / Dim)
8. Layout primitives (page shell, sidebar, mobile)
9. The TileCard wrapper (canonical content container)
10. Modal pattern (ModalShell)
11. Form controls (inputs, pills, checkboxes, buttons)
12. Tables (spreadsheet density, hover, sort, heat-map cells)
13. Pills, badges, chips
14. Dropdowns & context menus
15. Notifications, toasts, alert states
16. Data-viz coloring (gain/loss/neutral, 8-tier heat-map, MA stacks)
17. Drill modals (split table+chart pattern)
18. Charts — visual conventions
19. Tickers — universal interaction model
20. Accessibility rules
21. Mobile / responsive rules
22. Anti-patterns ("never do this")
23. Options Flow page — specific guidance
24. Reference files to copy from

---

## 1. Brand Identity & Positioning

**Parent brand:** **Uncharted Territory**
**Product / dashboard:** **UCT Intelligence**
**Tagline (locked, never edit, never paraphrase):** *Navigate the market, effectively.*

**Brand mark:** compass + candlestick.
- Red/green is the primary version.
- Gold-embossed variant for premium contexts (intro animation finale, premium tier UI).
- Parchment-mark variant for the cartographer intro animation.

**Voice & visual personality.**
The dashboard reads as *editorial, restrained, and operator-grade*. Old-world cartography meets a Bloomberg-style trading terminal. Think:

- **Warm dark backgrounds** (`#0e0f0d`), never pure black except on the explicit OLED theme.
- **Gold as the singular accent color** — used for headings, focus rings, premium states, brand wordmarks. NOT for "selected" states on every checkbox, NOT for general highlights. Sparing use = luxury.
- **Green and red are for direction of money** (gains / losses, calls / puts, BUY / SELL). Don't use green for "active" UI states (use gold or muted variants) or red for "warnings" (use amber/gold).
- **Cream parchment** (`#d4c9a8`) is reserved for the cartographer / wax-seal / map graphic surfaces. Don't pour cream into general UI — it reads as off-brand.
- **No emojis** in the production UI unless a specific feature requires them.
- **No serifs** in UI text. Serifs are reserved exclusively for the cartographer intro animation graphic.
- **No exclamation points, no marketing-bro tone**, no "🚀". This is for operators.

**Brand vocabulary:**
- "Navigate the market" (signature phrase)
- "Uncharted Territory" / "Cartographer" / "Compass" (parent brand metaphors)
- "UCT 20" / "Leadership" / "Exposure" / "Regime" / "Breadth" (operator vocabulary)

---

## 2. Typography

### 2.1 Single Font Family

The entire UI uses **one** typeface: **Instrument Sans**.

⛔ **SELF-HOSTED SINCE 2026-08-05 — DO NOT RE-ADD THE `@import` BELOW.** It is kept
only to show which faces we ship. The real declarations are inline in
`app/index.html` against `/fonts/*.woff2` (`app/public/fonts`, routed by the
`/fonts` mount in `api/main.py`). Not a preference: lightweight-charts bakes
whichever font resolves AT DRAW TIME into its axis canvas and never repaints, so a
third-party font host is a correctness dependency of every chart — including the
headless Morning Wire → Substack renderer. Gated by
`tests/test_chart_parity_harness.py`; the argument is in
`docs/runbooks/chart-parity-gate.md`.

```css
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');

--font-sans:    'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono:    'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-display: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-heading: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
```

The four var names (`--font-sans`, `--font-mono`, `--font-display`, `--font-heading`) all alias the same family. The semantic naming is preserved in case we ever swap. **Use the semantic var that matches intent** (`--font-mono` for numeric tabular data, `--font-display` for big numbers, etc.).

For numeric columns, always pair with:
```css
font-variant-numeric: tabular-nums;
```
This is what makes tables of dollar values line up.

**Exception:** The cartographer intro animation uses `Georgia, 'Times New Roman', serif` for map decoration **only** — never in regular UI.

### 2.2 Type Scale

```
--text-xs:  10px   /* tile titles, badges, micro-labels */
--text-sm:  11px   /* secondary metadata, ticker chips */
--text-base: 12px  /* body small */
--text-md:  13px   /* default body */
--text-lg:  14px   /* emphasised body, drill chart symbol */
--text-xl:  16px   /* sub-headings */
--text-2xl: 20px   /* section headings */
--text-3xl: 24px   /* page headings (rarely used; most pages use 22px directly) */
```

`body` default in `tokens.css`:
```css
font-size: 15px;
line-height: 1.6;
-webkit-font-smoothing: antialiased;
```

### 2.3 Mobile typography guard

```css
@media (max-width: 640px) {
  input, select, textarea { font-size: 16px !important; }
}
```
This stops iOS Safari from auto-zooming on input focus. Don't override.

### 2.4 Canonical Type Patterns

**Page heading** (every top-level page — required on Options Flow):
```css
.heading {
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 800;
  color: var(--ut-gold);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 20px;
}
```
Sometimes pages use `letter-spacing: 4px` for extra-heavy section dividers (see `Breadth.module.css`). 1.5px is the safe default.

**Tile title** (inside the TileCard header):
```css
font-size: 10px;
font-weight: 600;
letter-spacing: 1.5px;
text-transform: uppercase;
color: var(--text-bright);
```

**Status pill / badge label:**
```css
font-size: 8px;
font-weight: 600;
letter-spacing: 1px;
text-transform: uppercase;
```

**Drill modal title:**
```css
font-family: var(--font-mono);
font-size: 15px;
font-weight: 700;
color: var(--ut-gold);
letter-spacing: 1px;
text-transform: uppercase;
```

**Big number readouts** (score gauges, KPI tiles):
```css
font-family: var(--font-mono);
font-size: 28px;          /* or 22px for compact */
font-weight: 700;
line-height: 1;
font-variant-numeric: tabular-nums;
```

**Metadata / row sub-labels:**
```css
font-family: var(--font-mono);
font-size: 9–11px;
letter-spacing: 0.5–2px;
color: var(--text-muted);
text-transform: uppercase;  /* when used as label */
```

---

## 3. Full Color Palette

### 3.1 Brand colors (UT = Uncharted Territory)

| Variable | Hex | Use |
|---|---|---|
| `--ut-green` | `#2d8c4e` | brand green (deep forest) — left-edge gradient bar on TileCard |
| `--ut-green-bright` | `#3cb868` | success / gains / sidebar active / scoreGreen |
| `--ut-green-dim` | `#2d8c4e18` | tinted backgrounds (active nav item) |
| `--ut-green-glow` | `#2d8c4e40` | glow / shadow effects |
| `--ut-red` | `#c0392b` | brand red (deep) — danger button hover |
| `--ut-red-bright` | `#e74c3c` | losses / errors / SELL |
| `--ut-red-dim` | `#c0392b18` | tinted bearish backgrounds |
| `--ut-gold` | `#c9a84c` | **the** accent color — page headings, focus rings, premium states, brand wordmark |
| `--ut-gold-dim` | `#c9a84c15` | gold-tinted bg |
| `--ut-gold-glow` | `#c9a84c35` | gold glow / soft outline |
| `--ut-cream` | `#d4c9a8` | parchment cream (intro animation / context menu text) |

### 3.2 Surface palette (default theme)

| Variable | Hex | Use |
|---|---|---|
| `--bg` | `#0e0f0d` | app background — warm near-black, NOT pure black |
| `--bg-surface` | `#1a1c17` | tile / card body |
| `--bg-elevated` | `#22251e` | modals, popovers, drill panels, table headers |
| `--bg-hover` | `#2a2d24` | hover state on rows, list items, buttons |
| `--border` | `#2e3127` | default border (1px) |
| `--border-accent` | `#3a3d32` | emphasized border (dropdowns, drawer chrome) |

### 3.3 Text palette

| Variable | Hex | Use |
|---|---|---|
| `--text` | `#a8a290` | default body |
| `--text-muted` | `#706b5e` | secondary / metadata / placeholder |
| `--text-bright` | `#e0dac8` | emphasised body, tile titles, primary action labels |
| `--text-heading` | `#f0ead8` | high-emphasis headings (modal titles) |

### 3.4 Semantic palette (gain/loss/warn/info)

| Variable | Hex | Use |
|---|---|---|
| `--gain` | `#3cb868` | positive P&L, BUY, calls |
| `--gain-bg` | `#3cb86815` | filled positive cell / badge background |
| `--gain-border` | `#3cb86835` | gain pill border |
| `--loss` | `#e74c3c` | negative P&L, SELL, puts |
| `--loss-bg` | `#e74c3c15` | filled negative cell / error banner |
| `--loss-border` | `#e74c3c35` | loss pill border |
| `--warn` | `#c9a84c` | caution / amber (same hex as `--ut-gold`) |
| `--warn-bg` | `#c9a84c15` | gold-tinted "watch" state |
| `--warn-border` | `#c9a84c35` | |
| `--info` | `#6ba3be` | informational blue — for ITM / metadata / non-directional state |
| `--info-bg` | `#6ba3be12` | |
| `--info-border` | `#6ba3be30` | |

### 3.5 Special-use shades found across the codebase

These are deliberate single-use hex values for visual depth — duplicate them when matching the look of those surfaces:

- **Treemap / group header tints** (subtle wash behind grouped sections):
  - Score: `#141414` bg with `#c9a84c` text, weight 900
  - Regime: `#1a1f2e` bg with `#7b9fc7` text
  - Primary Breadth: `#1f2012` bg with `#b8c94a` text
  - MA Breadth: `#122018` bg with `#4ac97d` text
  - Highs/Lows: `#201a12` bg with `#c9944a` text
  - Setups: `#201212` bg with `#c94a4a` text
  - Volume: `#12161f` bg with `#4a8fc9` text
  - Sentiment: `#1e1218` bg with `#b44ac9` text
- **Striped table odd row:** `#0e1014` (very subtle blue-black, distinct from `--bg`)
- **Drill chart panel background:** `#0e0e0e` (just slightly off-black to separate from page)

---

## 4. Spacing, Radii, Shadows

### 4.1 Spacing scale

```
--space-xs:  4px
--space-sm:  8px
--space-md:  12px
--space-lg:  16px
--space-xl:  24px
--space-2xl: 32px
--space-3xl: 48px
```

**Canonical page padding:** `padding: 20px 24px;` — every full-page surface uses this.
**Tile internal padding:** `padding: 14px 14px 14px 18px;` (the extra 4px on the left makes room for the gradient bar on the TileCard).

**Mobile tap target minimum:** `--tap-min: 44px;` — every interactive control must meet this on mobile.

### 4.2 Radii

```
--radius-sm:  4px   /* pills, chips, small buttons */
--radius-md:  6px   /* inputs, default buttons, search bars */
--radius-lg:  8px   /* cards, dropdowns, modals (when not tiles) */
--radius-xl:  12px  /* tiles — TileCard uses 12px */
```

**Modal corners:** `border-radius: 14px;` (slightly larger than `--radius-xl` for the ModalShell).
**Pill toggle (segmented control):** outer container `10px`, inner pills `7px`.

### 4.3 Shadows

```
--shadow-sm: 0 1px 2px rgba(0,0,0,0.3)
--shadow-md: 0 2px 8px rgba(0,0,0,0.4)
--shadow-lg: 0 4px 16px rgba(0,0,0,0.5)
```

**Custom shadows commonly used:**
- Modal: `box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);`
- Dropdown: `box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);`
- Context menu: `box-shadow: 0 8px 24px rgba(0,0,0,0.5);`

---

## 5. Motion & Animation

### 5.1 Timing tokens

```
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1)     /* default — UI feels confident */
--ease-in-out: cubic-bezier(0.45, 0, 0.55, 1)
--duration-fast:   150ms     /* hover states, color changes */
--duration-normal: 250ms     /* dropdown open, drawer slide */
--duration-slow:   400ms     /* progress bar fills */
```

### 5.2 Common transition idioms

```css
transition: all 0.15s;           /* hover on pills / nav items */
transition: color 0.15s, background 0.15s;
transition: filter 0.15s;        /* group header brightness on hover */
transition: width 0.2s ease;     /* sidebar expand */
transition: width 0.4s ease;     /* progress bar fill */
```

### 5.3 Hover brightness pattern

For grouped table headers (colored), use `filter: brightness(1.3)` on hover instead of swapping color. Keeps the palette but signals interactivity.

For tiles in the heatmap:
```css
.tmTile:hover { filter: brightness(1.25); z-index: 4; }
```

### 5.4 Reduced motion (global, do not override)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 5.5 Notable named animations

**Flag toast** (when a ticker is flagged):
```css
@keyframes flagFade {
  0%   { opacity: 0; transform: translateY(-3px); }
  15%  { opacity: 1; transform: translateY(0); }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
```
Plays `1.5s ease-in-out forwards`.

**Cartographer intro:** ~9.3s, three acts (Cartographer → Welcome → Brand Finale). Plays on every page load. Skippable via ESC / Enter / Space / click / Skip button. See `app/src/components/intro/IntroAnimation.module.css` for full keyframe inventory.

---

## 6. Z-index Scale

```
--z-base:     1
--z-dropdown: 100        /* sidebar nav */
--z-sticky:   200        /* drill modal overlay */
--z-nav:      300
--z-backdrop: 399
--z-drawer:   400
--z-modal:    1000       /* TickerPopup, primary modals */
--z-toast:    1100       /* nested modals stack above primary */
```

Context menu uses `9999`/`10000` explicitly (it must always win).
Heatmap tooltip uses `9999` for the same reason.

---

## 7. Theme Variants

Three themes available via `data-theme` attribute on the root element:

### 7.1 Default (parchment-dark) — no attribute needed
Uses all the values listed above. Warm dark.

### 7.2 OLED — `[data-theme="oled"]`
Overrides only background and border tokens for pure-black OLED screens:
```css
--bg:          #000000
--bg-surface:  #0a0a0a
--bg-elevated: #111111
--bg-hover:    #1a1a1a
--border:      #1e1e1e
--border-accent: #2a2a2a
```

### 7.3 Dim — `[data-theme="dim"]`
Softer, slightly green-tinted dark for low-contrast preference:
```css
--bg:          #1a1d1a
--bg-surface:  #22251f
--bg-elevated: #2a2d27
--bg-hover:    #32352e
--border:      #383b33
--border-accent: #44473d
```

**Critical rule:** *Brand, text, and semantic colors stay constant across themes.* Only surface/border vars change. As long as you reference `var(--bg)` etc., theme switching works for free.

---

## 8. Layout Primitives

### 8.1 App shell

```css
.shell {
  display: flex;
  height: 100vh;
  height: 100dvh;       /* iOS Safari dynamic viewport */
  overflow: hidden;
}
.main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--bg);
}
```

### 8.2 Desktop sidebar (NavBar)

- Collapsed default: `width: 60px`, expands to `200px` on hover (`transition: width 0.2s ease`).
- Background: `var(--bg-surface)`, right border `1px solid var(--border)`.
- Sticky at top, height `100vh`, `z-index: 100`.
- Brand wordmark at top: 13px, weight 700, `color: var(--ut-green-bright)`, `letter-spacing: 1.5px`, padded `0 18px`.
- Items: 12px / weight 500, `color: var(--text-muted)`, padding `10px 18px`, `gap: 12px` between icon and label.
- Active item: `color: var(--ut-green-bright) !important; background: var(--ut-green-dim);`
- Icon: 16px, `width: 24px` (fixed slot so collapsed items align).
- **Tablet** (`hover: none` or `max-width: 900px`): icons-only, no hover expand.
- **Phone** (`max-width: 640px`): desktop sidebar hidden; mobile drawer takes over.

### 8.3 Mobile header

Fixed top header bar at 48px height (36px in landscape), padding-top respects `env(safe-area-inset-top)`. Hamburger left, page title centered, AlertBell right.

### 8.4 Canonical page wrapper

Every page starts with:
```jsx
<div className={styles.page}>
  <h1 className={styles.heading}>OPTIONS FLOW</h1>
  {/* content */}
</div>
```
```css
.page { padding: 20px 24px; }
.heading {
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 800;
  color: var(--ut-gold);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 20px;
}
```

If the page has tabs (e.g. Live Flow / Historical / Unusual), use the tab pattern from `Breadth.module.css`:
```css
.tabs {
  display: flex;
  gap: 2px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: var(--radius-md);
  padding: 3px;
}
.tab {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.5px;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.tab:hover { color: var(--ut-gold); }
.tabActive {
  background: var(--ut-gold);
  color: #000;
}
```
Note the **active tab is solid gold with black text** — high contrast, signature look.

---

## 9. The TileCard Wrapper (canonical content container)

Every distinct content block in the dashboard sits inside a TileCard. **Use it for every section of Options Flow** (the unusual-activity table, the sweeps panel, the calls/puts split, etc.).

### 9.1 Anatomy

```css
.tile {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* SIGNATURE BRAND DETAIL — the gradient bar on the left edge */
.tile::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 2px;
  background: linear-gradient(180deg, var(--ut-green), var(--ut-gold), var(--ut-green));
  opacity: 0.3;
  border-radius: 2px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 10px 18px;
  border-bottom: 1px solid var(--border);
}

.title {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-bright);
}

.badge {
  font-family: var(--font-sans);
  font-size: 8px;
  font-weight: 600;
  padding: 2px 8px;
  letter-spacing: 1px;
  border-radius: 8px;
  background: var(--gain-bg);
  color: var(--gain);
  border: 1px solid var(--gain-border);
  text-transform: uppercase;
}

.body {
  padding: 14px 14px 14px 18px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
```

### 9.2 Why the left-edge gradient bar matters

This is the closest thing to a brand "stamp" in the dashboard. It is **green → gold → green** at 30% opacity, top-to-bottom. It silently identifies any tile as part of the UCT system. Do **not** remove it. Do **not** colorize it per tile (no "red bar for bearish tile"). It is constant.

### 9.3 Right-side header content

Tiles often place a status badge or last-updated meta on the right of the header:
```jsx
<div className={tileStyles.headerRight}>
  <span className={tileStyles.badge}>LIVE</span>
</div>
```

---

## 10. Modal Pattern (ModalShell)

The canonical modal lives at `app/src/pages/journal-2-0/components/ModalShell.module.css`. Use it (or replicate it) for any Options Flow modal — e.g., trade-details popout, filter modal, settings.

### 10.1 Backdrop

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 10, 0.72);
  backdrop-filter: blur(6px);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  overflow-y: auto;
}
```

### 10.2 Modal box

```css
.modal {
  width: min(520px, 100%);
  max-height: calc(100vh - 64px);
  background: var(--bg-elevated);
  color: var(--text-bright);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  font-family: var(--font-sans);
  font-size: 13px;
}
```

### 10.3 Header / body / footer

- Header: `padding: 18px 22px 14px;`, bottom border 1px.
- Title: 18px / weight 600 / `color: var(--text-heading)`.
- Close button: top-right, `font-size: 24px`, `color: var(--text-muted)`, hover bg `var(--bg-hover)`.
- Body: `padding: 18px 22px; gap: 14px;` (flex column).
- Footer: `padding: 14px 22px;`, top border, buttons right-aligned with `gap: 10px`.

### 10.4 Close on backdrop click + ESC

Both required for any modal. ESC must close. Backdrop click must close (but clicks inside the modal must not bubble).

---

## 11. Form Controls

### 11.1 Text/number/select/textarea (matched chrome)

```css
.textInput, .numberInput, .select, .textarea {
  padding: 9px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-bright);
  font-family: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.textInput:focus, ... {
  outline: 2px solid var(--ut-gold);
  outline-offset: -2px;
}
```

Always use **gold focus ring** (`var(--ut-gold)`), `outline-offset: -2px` for inputs (inset), `outline-offset: 2px` for buttons/links (offset).

### 11.2 Prefix-wrapped inputs (for $ / % / R values)

```css
.prefixInput {
  display: flex;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.prefix {
  padding: 0 10px;
  color: var(--text-muted);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.numberInputInner {
  flex: 1;
  background: transparent;
  border: none;
  padding: 9px 10px;
}
```

### 11.3 Pill toggles (segmented controls)

The dashboard's main interaction pattern for binary/ternary choices (e.g. CALLS / PUTS / BOTH on Options Flow).

```css
.pillToggle {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  height: 36px;
}
.pill {
  flex: 1;
  padding: 0 14px;
  background: transparent;
  border: none;
  color: var(--text-bright);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 7px;
}
.pill:hover { background: var(--bg-hover); }
.pillActive {
  background: var(--ut-gold);
  color: var(--bg);     /* dark text on gold */
}
```

### 11.4 Days/period pills (rounded — for "1D / 1W / 1M" selectors)

Used on `Breadth.module.css`, `Watchlists`, etc.

```css
.daysPill {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 3px 10px;
  border-radius: var(--radius-xl);   /* fully rounded ends */
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.daysPill:hover { border-color: var(--ut-gold); color: var(--ut-gold); }
.daysPillActive {
  background: var(--ut-gold);
  border-color: var(--ut-gold);
  color: #000;
  font-weight: 700;
}
```

### 11.5 Checkboxes

```css
.checkboxRow input[type="checkbox"] {
  margin-top: 3px;
  accent-color: var(--ut-gold);
}
```
Always set `accent-color: var(--ut-gold)`.

### 11.6 Buttons — three variants only

**Primary (gold):**
```css
.primaryBtn {
  padding: 9px 22px;
  background: var(--ut-gold);
  border: none;
  border-radius: 8px;
  color: var(--bg);          /* dark text on gold */
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
```

**Ghost (default secondary):**
```css
.ghostBtn {
  padding: 9px 18px;
  background: transparent;
  border: 1px solid var(--border-accent);
  border-radius: 8px;
  color: var(--text-bright);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.ghostBtn:hover { background: var(--bg-hover); }
```

**Danger (destructive only — close position, delete alert, etc.):**
```css
.dangerBtn {
  background: var(--loss);
  color: var(--bg);
}
.dangerBtn:hover:not(:disabled) { background: var(--ut-red); }
```

**Disabled state:** `opacity: 0.55; cursor: not-allowed;`

### 11.7 Copy / outline buttons (gold accent)

For "copy to clipboard," "export," "reset," etc., use the gold-outline pattern from drill modal:

```css
.copyBtn {
  font-family: var(--font-mono);
  font-size: 11px;
  background: transparent;
  border: 1px solid rgba(201,168,76,0.4);
  color: var(--ut-gold);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.copyBtn:hover  { background: rgba(201,168,76,0.12); }
.copyBtn:active { background: rgba(201,168,76,0.2); }
```

---

## 12. Tables — Spreadsheet Density

The Options Flow page is fundamentally a high-density table. Use the proven pattern from `Breadth.module.css`.

### 12.1 Container & scroll

```css
.tableWrap {
  overflow-x: auto;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
```

### 12.2 Table

```css
.table {
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  white-space: nowrap;
  width: max-content;
}
```

### 12.3 Sticky header

```css
.table thead {
  position: sticky;
  top: 0;
  z-index: 3;
}
.th {
  padding: 7px 12px;
  text-align: center;
  font-weight: 700;
  letter-spacing: 0.3px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  border-right: 1px solid rgba(255,255,255,0.04);
}
.colLabel {
  font-size: 11px;
  color: var(--text-muted);
}
```

### 12.4 Sticky left column (date / ticker)

```css
.dateCol {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  text-align: left;
  min-width: 90px;
}
```

### 12.5 Body cells

```css
.td {
  padding: 6px 12px;
  text-align: right;        /* numerics right-aligned */
  color: var(--text);
  border-right: 1px solid rgba(255,255,255,0.03);
  border-bottom: 1px solid rgba(255,255,255,0.03);
  font-variant-numeric: tabular-nums;
}
```

### 12.6 Row striping

```css
.rowEven { background: transparent; }
.rowOdd  { background: #0e1014; }     /* very subtle blue-black */
.table tbody tr:hover td { background: rgba(255,255,255,0.025); }
```

### 12.7 Drillable cells (clickable into detail)

```css
.drillable {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: rgba(255,255,255,0.25);
  text-underline-offset: 2px;
}
.drillable:hover {
  text-decoration-color: var(--ut-gold);
  color: var(--ut-gold);
}
```
This is the canonical "click for more" signal — dotted underline that turns gold on hover.

### 12.8 Sort indicators

```css
.sortIndicator { font-size: 9px; opacity: 0.8; }
```
Use ▲ / ▼ for ascending/descending.

### 12.9 Row phase indicator (left border color)

For tables that classify each row by directional sentiment:
```css
.phaseGreen { border-left: 3px solid rgba(74, 222, 128, 0.5); }
.phaseRed   { border-left: 3px solid rgba(248, 113, 113, 0.5); }
.phaseAmber { border-left: 3px solid rgba(201, 168, 76, 0.3); }
```

---

## 13. Pills, Badges, Chips

### 13.1 Gain / loss / warn / info pill

```css
.pill {
  font-size: 8px;
  font-weight: 600;
  padding: 2px 8px;
  letter-spacing: 1px;
  border-radius: 8px;
  background: var(--gain-bg);
  color: var(--gain);
  border: 1px solid var(--gain-border);
  text-transform: uppercase;
}
```
Swap `--gain-*` for `--loss-*`, `--warn-*`, or `--info-*` for the four semantic variants.

### 13.2 Tag chip (mistake tag / setup tag / etc.)

Larger than a pill, typically `padding: 3px 10px;`, `border-radius: 4px;`, `font-size: 10px;`, `text-transform: uppercase`, `letter-spacing: 0.8px`.

### 13.3 Cap/size badge (gold-outline)

For premium/highlighted indicators like UCT 20 ★, "LARGE PREMIUM", "SWEEP", "UNUSUAL":
```css
.hmScorePhase {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ut-gold);
  background: rgba(201, 168, 76, 0.1);
  border: 1px solid rgba(201, 168, 76, 0.25);
  border-radius: 3px;
  padding: 2px 8px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
```

### 13.4 "Latest" / "Live" gold pill

```css
.tmNavLatest {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--ut-gold);
  background: rgba(201,168,76,0.12);
  border: 1px solid rgba(201,168,76,0.3);
  border-radius: 3px;
  padding: 1px 5px;
}
```

---

## 14. Dropdowns & Context Menus

### 14.1 Dropdown (e.g. AlertBell, picker)

```css
.dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  width: min(320px, calc(100vw - 24px));
  max-height: 400px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 500;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.headerTitle {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--text-bright);
  text-transform: uppercase;
}
```

### 14.2 Context menu (right-click on tickers — the universal pattern)

```css
.menu {
  position: fixed;
  background: #1e1e22;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 6px 0;
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  z-index: 10000;
}
.header {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 700;
  color: var(--ut-gold);
  padding: 6px 14px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  letter-spacing: 1px;
}
.item {
  display: block;
  width: 100%;
  padding: 7px 14px;
  background: none;
  border: none;
  color: var(--ut-cream);
  font-family: var(--font-sans);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.item:hover { background: rgba(255,255,255,0.06); }
```
This is the only place `--ut-cream` appears in regular UI — context menu items. The gold header at the top, cream text below, dark hover. Don't repaint this; it's part of the dashboard's identity.

### 14.3 Color swatches (for tag picker)

```css
.swatches { display: flex; gap: 6px; }
.swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.1s;
}
.swatch:hover { transform: scale(1.2); }
.swatchActive { border-color: #fff; box-shadow: 0 0 4px rgba(255,255,255,0.3); }
```

---

## 15. Notifications, Toasts, Alert States

### 15.1 AlertBell notification item

```css
.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}
.item:hover { background: var(--bg-hover); }
.unread {
  background: rgba(74, 222, 128, 0.04);
  border-left: 2px solid var(--ut-green);
}
.sevCritical { border-left-color: var(--loss); }
.sevWarning  { border-left-color: var(--ut-gold); }
.sevInfo     { border-left-color: var(--ut-green); }
```
Severity is signaled via left border color only — never paint the whole item red.

### 15.2 Inline error banner

```css
.errorBanner {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--loss);
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.25);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  margin-bottom: 12px;
}
```

### 15.3 Info banner (gold)

```css
.infoBanner {
  padding: 10px 12px;
  background: var(--ut-gold-dim);
  border: 1px solid var(--ut-gold-glow);
  border-radius: 8px;
  color: var(--info);
  font-size: 12px;
}
```

### 15.4 Badge counts (red dot on bell)

```css
.badge {
  position: absolute;
  top: 2px; right: 0;
  min-width: 16px; height: 16px;
  background: var(--loss);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 9px; font-weight: 700;
  border-radius: var(--radius-lg);
  display: flex; align-items: center; justify-content: center;
  padding: 0 4px;
  line-height: 1;
}
```

---

## 16. Data-Viz Coloring

### 16.1 Direction-of-money (primary rule)

- **Calls / BUY / gains / bullish:** `var(--gain)` (`#3cb868`)
- **Puts / SELL / losses / bearish:** `var(--loss)` (`#e74c3c`)
- **Neutral / unusual / large-premium / aggressive flow:** `var(--ut-gold)` (`#c9a84c`)
- **ITM / metadata / non-directional:** `var(--info)` (`#6ba3be`)

Never use blue for calls, never use red for warnings, never use green for "active." Operators read color as direction of money; ambiguity breaks trust.

### 16.2 8-tier heat-map (use for any quantitative cell)

```css
.bgG3 { background: rgba(10,  50,  22, 0.97); }   /* extreme bullish — near-black green */
.bgG2 { background: rgba(22,  100, 48, 0.80); }   /* bullish — dark forest green */
.bgG1 { background: rgba(74,  222, 128, 0.16); }  /* mild bullish — light mint tint */
.bgA  { background: rgba(180, 130,  20, 0.32); }  /* caution — dark amber */
.bgR1 { background: rgba(248, 113, 113, 0.16); }  /* mild bearish — light red tint */
.bgR2 { background: rgba(160,  25,  25, 0.80); }  /* bearish — dark crimson */
.bgR3 { background: rgba(55,   6,   6, 0.97); }   /* extreme bearish — near-black red */
```

**Principle:** *Extremes = dark ink. Mild = light tint. Text stays uniform white.* This is the inverse of most heatmaps — extremes get heavier saturation, not lighter, so they read as "weight" rather than glare.

### 16.3 Drill-detail row heat tints (subtler version for selected rows)

```css
.drillHeatG1 { background: rgba(74,222,128,0.04) !important; }
.drillHeatG2 { background: rgba(74,222,128,0.10) !important; }
.drillHeatG3 { background: rgba(22,100,48,0.22) !important; }
.drillHeatR1 { background: rgba(248,113,113,0.04) !important; }
.drillHeatR2 { background: rgba(248,113,113,0.10) !important; }
.drillHeatR3 { background: rgba(160,25,25,0.22) !important; }
```

### 16.4 Selected row (overrides heat map)

```css
.drillRowSelected {
  background: rgba(201, 168, 76, 0.15) !important;
  outline: 1px solid rgba(201, 168, 76, 0.4);
  outline-offset: -1px;
}
```

### 16.5 Coloring scalar values

For percentage-change columns (e.g. % above MA, day change), apply conditional cell colors:
- `> +5%`: deep green text (`#4ade80`)
- `0 to +5%`: standard green (`var(--gain)`)
- `-5 to 0%`: standard red (`var(--loss)`)
- `< -5%`: deep red

For options-specific values, similar logic applies to **unusual volume / call-put ratio / premium**:
- > 3× normal: `--ut-gold` text + bold
- 1.5–3×: `--text-bright`
- Below normal: `--text-muted`

### 16.6 Forward returns / KPI deltas

```css
.analogueGreen { color: var(--ut-green-bright); }
.analogueRed   { color: var(--loss); }
```
Numeric values colored, label and frame stay muted.

---

## 17. Drill Modals (split table + chart pattern)

When a user clicks into a row from any table, the canonical detail view is a **split modal**: filterable table on the left (~540px), chart on the right (flexes). This pattern is in `Breadth.module.css` and should be used for "click an unusual options row → see ticker chart + related orders."

### 17.1 Overlay

```css
.drillOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
```

### 17.2 Dialog

```css
.drillDialog {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 1600px;
  height: 96vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

### 17.3 Header

- Padding `16px 20px 12px`, bottom border.
- Title: monospace, 15px / 700 / gold / uppercase, `letter-spacing: 1px`.
- Subtitle below in muted 11px mono.
- Close button top-right (transparent, muted, hover bright).

### 17.4 Split body

```css
.drillSplit {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.drillTablePanel {
  width: 540px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 10px 0 16px;
}
.drillChartPanel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #0e0e0e;
}
```

### 17.5 Chart tabs (centered in the chart bar)

```css
.drillChartTabs {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
}
.drillChartTab {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.6px;
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid transparent;
  background: transparent;
  color: #555;
  cursor: pointer;
}
.drillChartTabActive {
  color: var(--ut-gold);
  background: rgba(201,168,76,0.12);
  border-color: rgba(201,168,76,0.3);
}
```

### 17.6 Mobile drill modal

Stacks vertically: table on top (max-height 40vh) with bottom border, chart below. Padding reduces to `padding: 12px`.

---

## 18. Charts — Visual Conventions

The dashboard uses **TradingView Lightweight Charts v5** (NOT iframes) wrapped in `app/src/components/StockChart.jsx`. COT charts are an exception and use Chart.js.

### 18.1 Chart visual defaults (configurable via Settings → Chart)

- **Background:** transparent (inherits parent).
- **Grid:** subtle, `rgba(255,255,255,0.04)` for verticals, `rgba(255,255,255,0.06)` for horizontals.
- **Candle up:** `var(--gain)` body and wick.
- **Candle down:** `var(--loss)` body and wick.
- **Hollow candle option:** outline-only candles for the "hollow" preset.
- **Volume up:** `var(--gain)` at ~50% opacity.
- **Volume down:** `var(--loss)` at ~50% opacity.
- **HVC (52-week-high volume bars):** **gold** (`var(--ut-gold)`) — this is the "look here" highlight.
- **MA overlays:** 4 slots, defaults are 10 / 20 / 50 / 200, each user-colorable. Common color picks from `ColorPicker`: gold, cyan, magenta, teal.
- **Buy marker:** green up-arrow (`var(--gain)`) below candle.
- **Sell marker:** red down-arrow (`var(--loss)`) above candle.
- **Stop price line:** dashed red horizontal.
- **Target price line:** dashed green horizontal.
- **Entry price line:** solid gold horizontal (premium / "this is mine").

### 18.2 Crosshair OHLCV legend

Top-left overlay on hover, monospace, shows date/time, O/H/L/C, V (K/M-formatted), change + change%, MA values colored to match overlay.

### 18.3 Period tabs (5min / 30min / 1hr / D / W)

Use the same `daysPill` pattern from §11.4. Active pill is solid gold with black text.

### 18.4 Chart toolbar

Horizontal bar above the chart with tool buttons (cursor, trendline, fib, AVWAP, text, etc.) and a settings gear on the right. All buttons are 28×28 icon-only, transparent bg, muted color, hover bg `rgba(255,255,255,0.04)`, active state gold text + gold-tinted background.

---

## 19. Tickers — Universal Interaction Model

This is one of the strongest interaction patterns in the app — **the Options Flow page must wire into it**.

### 19.1 Tickers are always clickable

Every ticker symbol in the UI is rendered through `<TickerPopup>` (the 5-tab chart modal) or a wrapper that opens it. Click any ticker → modal with Daily / Weekly / 5min / 30min / 1hr chart tabs.

### 19.2 Tickers are always right-clickable

Right-click any ticker → `<TickerActions>` context menu with:
- Flag / Unflag (gold star toggle)
- 7-color tag swatches (green / blue / orange / red / purple / gold / teal)
- "Add to watchlist…" (sub-picker)
- "Set price alert" (above/below + price input)

This must work on Options Flow rows.

### 19.3 Ticker color in tables

- Default: `var(--text-bright)` or `var(--ut-gold)` if it's a header/title.
- Flagged: shows a small gold star next to the symbol.
- Tagged: shows a small color dot next to the symbol (corresponds to the tag color).

### 19.4 Hover ticker prefetch

`prefetchBars(sym)` is fired on hover so opening the modal is instant. Wire this into the Options Flow row hover.

---

## 20. Accessibility Rules

### 20.1 Focus rings

```css
:focus-visible {
  outline: 2px solid var(--ut-gold);
  outline-offset: 2px;
}
:focus:not(:focus-visible) {
  outline: none;
}
```
**Never remove the focus ring.** Mouse users won't see it; keyboard users will.

### 20.2 Screen-reader-only text

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```
Use for icon-only buttons (bell, gear, flag).

### 20.3 Modal roles

Use `role="dialog"` and `aria-modal="true"` on the modal box (not the backdrop). Add `aria-labelledby` pointing to the title `id`. Trap focus inside while open. ESC must close.

### 20.4 Tap targets

Mobile interactive elements ≥ `var(--tap-min)` = 44px (or rely on padding to hit it).

---

## 21. Mobile / Responsive Rules

### 21.1 Breakpoints used across the codebase

- `max-width: 900px` — tablet (sidebar locks to icon-only)
- `max-width: 700px` — analogue grids collapse to one column
- `max-width: 640px` — phone (sidebar hides, mobile drawer takes over, mobile header appears)

### 21.2 Page padding on mobile

- Desktop: `padding: 20px 24px`
- 900px: `padding: 14px 10px`
- 640px: `padding: 8px`

### 21.3 Mobile headings

Drop from 22px to 18px, letter-spacing from 4px to 2px.

### 21.4 Tables on mobile

- Reduce cell padding to `4px 6px`.
- Reduce font-size to 10px.
- Negative-margin the table wrapper (`margin: 0 -8px; padding: 0 8px;`) so it bleeds to screen edge.
- Add a right-edge scroll-shadow hint:
```css
.tableWrap::after {
  content: '';
  position: sticky;
  right: 0;
  top: 0;
  bottom: 0;
  width: 24px;
  background: linear-gradient(to left, var(--bg-surface), transparent);
  pointer-events: none;
  z-index: 2;
}
```

### 21.5 Modals on mobile

- Reduce overlay padding to `padding: 12px`.
- Dialog: `width: min(600px, calc(100vw - 24px)); height: 90vh;`
- Split layouts stack vertically.

---

## 22. Anti-patterns — Never Do This

❌ **Don't introduce new fonts.** Only Instrument Sans. Serif only for the cartographer intro graphic.
❌ **Don't use pure `#000`** for backgrounds. Use `#0e0f0d`. Pure black is only for the explicit OLED theme.
❌ **Don't hardcode hex values.** Reference `var(--*)` so OLED/Dim themes work.
❌ **Don't use blue as a primary accent.** Gold is the accent color. Blue is informational only.
❌ **Don't repaint the TileCard left-edge gradient bar.** It's green→gold→green at 30% opacity. Constant.
❌ **Don't use emojis in production UI.** Exception: voice/audio surfaces sometimes use ⚡ for "Notable Extremes" or ★ for premium. Use sparingly.
❌ **Don't use red for warnings.** Use amber/gold for warn. Red is reserved for losses and errors.
❌ **Don't use green for "active" UI states.** Use gold or a muted gold-tinted background. Green is reserved for gains.
❌ **Don't remove the focus ring.** It's gold and 2px. Accessibility required.
❌ **Don't override the `prefers-reduced-motion` block** in `tokens.css`.
❌ **Don't break the 44px mobile tap target.**
❌ **Don't introduce CSS-in-JS or styled-components.** This project uses CSS modules + global tokens. Stick with `.module.css` files.
❌ **Don't add a separate font for "code/numbers."** `font-variant-numeric: tabular-nums` on Instrument Sans gives you aligned numerics — don't bring in a monospace.
❌ **Don't redesign the page heading style.** 22px / 800 / gold / uppercase / 1.5px letter-spacing. This is the single most consistent identity element on every page.
❌ **Don't use marketing-bro tone** in microcopy. "Navigate the market, effectively" is the brand voice. Operator-grade, restrained, never hype.

---

## 23. Options Flow Page — Specific Guidance

### 23.1 Header

```jsx
<div className={styles.page}>
  <h1 className={styles.heading}>OPTIONS FLOW</h1>
  {/* tabs if needed: Live | Unusual | Sweeps | History */}
  <div className={styles.content}>{/* tiles */}</div>
</div>
```

### 23.2 Filter row

Build it as a horizontal row of `pillToggle` controls (e.g. CALLS / PUTS / BOTH), `daysPill` groups (e.g. 1D / 1W / 1M), text/number inputs (min premium, min volume), and a primary "Apply" or "Reset" button. Match the spacing/sizes from `Breadth.module.css` and `Watchlists.module.css`.

### 23.3 Main table

- Wrap in TileCard (title `LIVE FLOW`, optional `LIVE` gain badge on the right).
- Sticky header, sticky left column (ticker).
- Tabular monospace numerics.
- Calls in green family, puts in red family, sweeps in gold.
- "Bullish" verdict pill (gain-style) / "Bearish" verdict pill (loss-style) / "Aggressive" pill (gold-style) per row.
- Click row → drill modal (split: order details on left, chart on right).
- Right-click ticker → TickerActions context menu.
- Tickers wired through TickerPopup.

### 23.4 Color rules for this page specifically

| Field | Color |
|---|---|
| CALL contracts | `var(--gain)` |
| PUT contracts | `var(--loss)` |
| Premium > $1M / unusual / sweep | `var(--ut-gold)` (text + optional gold-glow bg) |
| ITM marker | `var(--info)` |
| ATM marker | `var(--text-bright)` |
| OTM marker | `var(--text-muted)` |
| Bullish flow row | left-border `phaseGreen` |
| Bearish flow row | left-border `phaseR2`/`phaseRed` (rgba(248,113,113,0.5)) |
| Mixed / neutral | left-border `phaseAmber` |
| Selected / drilled row | `rgba(201,168,76,0.15)` bg + gold outline |

### 23.5 Empty / loading states

```css
.placeholder { padding: 60px 0; text-align: center; }
.title {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 1.5px;
  margin-bottom: 12px;
}
.text {
  font-size: 13px;
  color: var(--text-muted);
  max-width: 400px;
  margin: 0 auto;
  line-height: 1.6;
}
```

### 23.6 Performance expectations

- Live polling 15s default (matches `useLivePrices`). Slow to 30s on mobile via `useMobileSWR`.
- When market closed: 10× slow polling via `useMarketOpen`.
- Pause polling on backgrounded tabs.

### 23.7 Required integrations (don't omit)

- `<TickerPopup>` for ticker click (chart modal).
- `<TickerActions>` for right-click (flag, tag, alert, add-to-list).
- `useRealtimePrices` if streaming tick-by-tick is wanted (the dashboard already has WebSocket infra; Options Flow is one of the few pages currently NOT wired in — consider this a chance to fix that).

---

## 24. Reference Files to Copy From

When in doubt, open these files and copy the pattern verbatim:

| Need | File |
|---|---|
| Design tokens (THE source of truth) | `app/src/styles/tokens.css` |
| Tile wrapper | `app/src/components/TileCard.module.css` + `TileCard.jsx` |
| Page heading + layout shell | `app/src/pages/DarkPool.module.css` (minimal stub — same pattern Options Flow should start from) |
| Sidebar / nav active states | `app/src/components/NavBar.module.css` |
| App shell (flex layout) | `app/src/components/Layout.module.css` |
| Tabs (gold-active segmented) | `app/src/pages/Breadth.module.css` (lines 16–43) |
| Spreadsheet table | `app/src/pages/Breadth.module.css` (lines 86–200) |
| 8-tier heatmap cells | `app/src/pages/Breadth.module.css` (lines 194–200) |
| Drillable cell styling | `app/src/pages/Breadth.module.css` (lines 433–443) |
| Split table+chart drill modal | `app/src/pages/Breadth.module.css` (lines 446–650) |
| Modal chrome (header/body/footer/buttons) | `app/src/pages/journal-2-0/components/ModalShell.module.css` |
| Form inputs (text/select/textarea) | `ModalShell.module.css` lines 94–124 |
| Pill toggle (segmented control) | `ModalShell.module.css` lines 148–182 |
| Primary/Ghost/Danger buttons | `ModalShell.module.css` lines 277–323 |
| Dropdown (notifications-style) | `app/src/components/AlertBell.module.css` |
| Context menu (right-click) | `app/src/components/TickerActions.module.css` |
| Watchlist-style filterable table | `app/src/pages/Watchlists.module.css` |
| Period pills (1W/1M/3M) | `app/src/pages/Breadth.module.css` (lines 319–341) |
| Right-click ticker integration | `app/src/components/TickerActions.jsx` |
| Ticker click → chart modal | `app/src/components/TickerPopup.jsx` |
| Lightweight Charts integration | `app/src/components/StockChart.jsx` |
| Brand identity / intro animation | `docs/superpowers/specs/2026-05-08-uct-intelligence-intro-animation-design.md` |

---

## TL;DR Checklist For the Options Flow Rebuild

- [ ] Page wrapped in `.page { padding: 20px 24px; }`
- [ ] `<h1>` uses `.heading` pattern (22px / 800 / gold / uppercase / 1.5px)
- [ ] All sections inside `<TileCard>` (gradient bar on left, 10px uppercase title)
- [ ] No hardcoded hex values — only `var(--*)` references
- [ ] Calls = `--gain`, puts = `--loss`, unusual = `--ut-gold`, neutral = `--info`
- [ ] Table uses sticky header, sticky left column, monospace + tabular nums, row striping with `#0e1014`
- [ ] Drillable cells use dotted-underline-to-gold pattern
- [ ] Filters use the pill toggle (`var(--ut-gold)` active) + days pill (rounded) patterns
- [ ] Tickers wired to `<TickerPopup>` (click) and `<TickerActions>` (right-click)
- [ ] Drill modal uses split-panel pattern (table left, chart right, 1600px max, 96vh)
- [ ] All inputs have gold inset focus ring (`outline: 2px solid var(--ut-gold); outline-offset: -2px`)
- [ ] Primary button = gold bg + dark text; Ghost = transparent + accent border; Danger = `--loss` bg
- [ ] Modal backdrop has `rgba(4,6,10,0.72)` + `backdrop-filter: blur(6px)`
- [ ] All mobile breakpoints handled (`900px`, `640px`); tap targets ≥ 44px
- [ ] Focus rings never removed; reduced-motion never overridden
- [ ] No emojis, no serifs, no new fonts, no pure black

When the page is done, it should look indistinguishable from the rest of the dashboard at a glance. If it doesn't, the most likely culprits in order are: (1) wrong page heading style, (2) missing TileCard wrappers, (3) hardcoded hex instead of tokens, (4) wrong gold-active-tab/pill pattern, (5) missing focus rings, (6) calls/puts colors not matching `--gain`/`--loss`.

---

*This document is the single source of truth for any new page or surface in UCT Intelligence. If anything here conflicts with what's already in the codebase, the codebase wins and this doc should be updated.*
