# Landing Page Redesign — Cartographer-Cinematic, Simple

**Date:** 2026-06-01
**Status:** Design locked, ready for implementation plan
**Scope:** Full replacement of `app/src/pages/Landing.jsx` and its CSS module

## Problem

The current landing page (`app/src/pages/Landing.jsx`, 346 lines, written 2026-02) is a generic SaaS template with a blue gradient hero, a six-feature grid, a single pricing card, and a "How It Works" strip. It predates the product's most distinctive capabilities — AI Compass coach, Stock Catalysts engine, 85-detector Pattern Engine, Voice Assistant, Charts Workspace V2 — none of which are mentioned. It also ignores the Uncharted Territory brand identity that the cinematic intro animation already establishes (parchment compass, wax seal, italic-serif decoration, "Navigate the market, effectively." tagline).

Visitors arrive primarily from the user's established social media channels — they are brand-aware and arrive with intent. The page does not need a long convincing scroll; it needs to land, prove the product is real, and convert.

## Goals

1. Establish the **cartographer-cinematic** visual language consistently with the rest of the brand (intro animation, in-app watermark, footer wax seal)
2. Surface the **current product capabilities** including the four major additions since the last redesign
3. Keep the page **short** — Hero → Features → Pricing → Footer — for warm social traffic
4. **Convert** via a clear single $20/mo offer with a free-tier callout
5. **No new dependencies** — pure CSS keyframes + SVG, matching the existing intro-animation approach

## Non-goals

- Long-form storytelling, FAQ, testimonials, methodology essay, how-it-works steps (cut for simplicity)
- New marketing copy strategy or A/B testing infrastructure
- Real product screenshots (deferred — hand-built mockup stays for now)
- Compass spotlight, Morning Wire spotlight, by-the-numbers strip (cut for simplicity)
- A separate mobile landing page (one responsive page handles all viewports)

## Page Structure

Sticky nav + four content surfaces + footer. Total scroll ≈ 2.5 screens on desktop:

1. **Sticky nav** — `⊕ UCT INTELLIGENCE` brand mark + `Log In` / `Begin` CTAs
2. **Hero** — cartographer-cinematic stage with animated equity-curve P&L (detailed below)
3. **Live engine strip** — single line of monospace status (ENGINE LIVE · CATALYSTS 20 · PATTERNS 347 · THEMES 99 · UNIVERSE 3,685 · EXPOSURE 115 · SPY +0.42%). Visually a thin extension of the hero; treated as its own surface for layout reasons.
4. **Feature grid** — 8 cards in a 4×2 grid (responsive: 4 → 2 → 1 col), one line each. Features: Morning Wire, UCT 20, AI Compass (NEW), Stock Catalysts (NEW), Breadth Monitor, Theme Tracker, Charts Workspace, Voice Assistant (NEW)
5. **Pricing** — single $20/mo "PRO · ALL ACCESS" card + free-tier callout below
6. **Footer** — small wax-seal UT medallion + brand mark + tagline + legal links + Qullamaggie/Minervini/O'Neil/Kell/Bonde attribution + copyright

## Hero — Detailed Spec

### Stage

- Dark backdrop: `radial-gradient(ellipse at 32% 50%, #1a1208 0%, #0a0604 65%, #06040a 100%)`
- Cinematic vignette layered on top: dark corners fading to transparent center + warm gold glow centered on compass
- Subtle cross-hatch parchment texture overlay at ~2.2% opacity (repeating linear gradients at ±45°)
- Min-height 640px desktop; mobile adjusts (see Responsive)

### Constellation

10 static-positioned twinkling dots in the upper third — gold and cream. CSS keyframe `starTwinkle` (4s ease-in-out, staggered delays). Decorative, no semantic meaning.

### Cartographer corner annotations

Four italic-serif labels in dim gold, positioned at the corners of the hero:

| Corner | Primary | Subtitle |
|---|---|---|
| top-left | `❦ Uncharted Territory` | `EST. PREMARKET` |
| top-right | `Charting the market ❦` | `SINCE THE OPENING BELL` |
| bottom-left | `❀ From — Pre-Market` | `04 : 00 EDT` |
| bottom-right | `To — Closing Bell ❀` | `16 : 00 EDT` |

### Date cartouche

Centered at the top of the hero between hairline rules with diamond pip framing:
`◆ Day {N} of the voyage · {Day} {DD} {Mon} {YYYY} ◆`

The day counter and date are **static strings** in v1 — the literal text "Day 1,247 of the voyage" plus the current ET-format date computed at first render. (Live counter is out of scope.)

### Compass (left half of hero, ~220×220 px)

- Outer **bearing tick ring** (inset -20px) — `repeating-conic-gradient`, rotates clockwise once per 90 seconds via `ringRotate` keyframe
- Cardinal letters **N E S W** in italic serif gold around the perimeter (S/W muted), positioned absolutely
- Inner circular face — 2px gold border, radial-gradient fill, two crosshair lines (horizontal + vertical) at 30% gold opacity
- Soft glow shadow + inset glow: `0 0 80px rgba(201,168,76,0.3), inset 0 0 40px rgba(201,168,76,0.08)`
- **Needle** — 5×160px, top half red `#ef4444`, bottom half green `#4ade80`, drop-shadow, gold pivot dot center. Wobbles 18°–26° rotation via `needleWobble` (6s ease-in-out infinite)
- Ground shadow below: ellipse glow

### Hero body (right half of hero)

- Greeting line — italic serif Georgia `Welcome, Trader.` preceded by a small green pulse dot (`greetingPulse`, 2s)
- Wordmark — `UCT Intelligence` at 60px, font-weight 300, letter-spacing -2px, gradient-clipped text with the shimmer sweep animation (200% background-size, `shimmerSweep` 6s pans 0% → 100% → 0%)
- Sub-wordmark — small italic-serif `— A product of Uncharted Territory —` beneath the wordmark, 18px, gold, 4px letter-spacing, uppercase
- Tagline divider — left gold-fade hairline + `◆` gem + italic-serif tagline `Navigate the market, effectively.` + `◆` gem + right gold-fade hairline (flex row)
- Capability pills — flex-wrap row of 8 pills, each 9px uppercase letter-spaced, rounded 14px, gold border. Order: Morning Wire · UCT 20 · AI Compass · Stock Catalysts · Live Breadth · Pattern Engine · Charts Workspace · Voice Assistant. Hover: brighter background, -1px translateY.
- CTA row:
  - Primary `Step Aboard — $20/mo` → gold gradient button, light-sweep on hover, routes to `/signup?plan=pro`
  - Ghost `Watch the Intro` → bordered gold, routes to a future intro-video URL (placeholder anchor for now; opens nothing in v1)
  - `▸ 2 min` — italic serif label beside the ghost CTA

### Wax seal (bottom-right of hero)

- 84×84 circular medallion, 2.5px wax-brown border (`#8a4520`), rust-red gradient fill
- Inner ring (1px cream at 30% inside an 8px inset) for the layered look
- `UT` monogram centered, 22px bold Georgia serif, cream
- Drop-shadow + inner shadows give the embossed look
- Slight `rotate(-8deg)` for the "stamped" feel
- Curved text label above: `— CHARTING THE MARKET —` in italic serif at 9px tracked letter-spacing, also rotated -8°

### Animated equity-curve P&L (background of hero)

This is the signature element — runs subtly behind/around the compass and wordmark, telling a quiet visual story of equity growth.

- **SVG layer** absolutely positioned over the hero, `pointer-events: none`, z-index 2
- viewBox `0 0 1200 640`, `preserveAspectRatio="none"` — stretches to fill the hero
- **Equity path** — a single cubic-bezier curve from `(90, 580)` to `(1130, 90)` with realistic small swings/drawdowns (defined in `<defs>` as a reusable path)
- **Y-axis labels** in monospace at the right edge: `$8K · $18K · $28K · $36K`. Three horizontal dashed gridlines at the same heights.
- **Ghost path** — the full curve drawn in 0.06 opacity dashed gold (so the user can subconsciously see where it's going)
- **Filled area** below the curve — soft gold-to-transparent gradient at 32% opacity, revealed progressively via SVG `<clipPath>` keyed to the marker's x-position
- **Drawn curve** — gold-to-green gradient stroke at 1.6px, drop-shadow. Reveals progressively via animated `stroke-dashoffset`
- **Marker** (gold diamond, 11×11 rect rotated 45°) with concentric halo circles and an SVG `<animate>` pulsing ring. Positioned via JS `transform="translate(x y)"` on a `<g>` group
- **P&L counter card** rides with the marker via the same `<g>` group (offset by `translate(12, -44)`) — a 130×46 rounded rect with three text labels:
  - `ACCOUNT P&L` (eyebrow, 7.5px gold)
  - `${value}` (17px green, IBM Plex Mono, drop-shadow)
  - `+${delta} · ${pct}%` (9px green delta line)
- **Animation loop** — vanilla `requestAnimationFrame`:
  - START_VAL = $8,000, END_VAL = $36,000, target gain = 350%
  - RUN_MS = 18,000ms (climb), HOLD_MS = 1,500ms (pause at peak), RESET_MS = 500ms (fade)
  - Total cycle = 20,000ms
  - Each frame: compute progress, use `path.getPointAtLength(pathLen * progress)` to get the SVG coordinate, translate the marker group there, update the curve's stroke-dashoffset, update the clipPath's width to the marker's x, format the counter value (rounded to nearest $10), check for drawdown (current y > last y + 0.4) and flip marker/counter to red if so
  - At cycle end, reset and loop
- **Chart caption** — italic-serif `— Account · Year-to-Date —` in the bottom-left of the hero with a live green pulse dot

## Live Engine Strip

Below the hero, a thin band:

- Background `#04030a`, top/bottom 1px gold-dim borders
- Monospace IBM Plex Mono, 11px, letter-spacing 1.5px, flex row centered
- Content:
  - `● ENGINE LIVE` (green pulse dot)
  - `|`
  - `CATALYSTS 20` `PATTERNS 347` `THEMES 99` `UNIVERSE 3,685` `EXPOSURE 115` `SPY +0.42%`
- Static text in v1. (Wiring to live counts deferred.)

## Feature Grid

- Centered section header with eyebrow `— Everything aboard —`, h2 `One screen. Every signal that matters.`, supporting paragraph
- 4×2 CSS grid (1px gold-dim gap, 1px outer border)
- Each card: 34×34 bordered gold icon (unicode glyph), name (some with gold `NEW` pill), one-line muted-gray description
- Hover: cell background lightens slightly

| # | Icon | Name | Tag | Description |
|---|---|---|---|---|
| 1 | ❧ | Morning Wire | — | Daily AI brief at 7:35 AM ET. Regime, exposure, top 5 picks with triggers. |
| 2 | ★ | UCT 20 | — | The 20 highest-conviction leadership stocks with entry/exit signals and live P&L. |
| 3 | ⊕ | AI Compass | NEW | Your trading coach — pre-trade verdicts, post-mortems, tilt detection, weekly reviews. |
| 4 | ◎ | Stock Catalysts | NEW | 20-row pre-market desk, 8 sources synthesized by Opus 4.7 every refresh. |
| 5 | ≣ | Breadth Monitor | — | 20+ internals, 8-tier heatmap, COT data, 500-day analogue matching. |
| 6 | ❋ | Theme Tracker | — | 99 themes, 12 sectors, 1,928 stocks, live intraday returns across 6 periods. |
| 7 | ⊞ | Charts Workspace | — | TradingView-grade drag-resize layout, 4 color groups, 8 timeframes. |
| 8 | ♪ | Voice Assistant | NEW | Ask Compass anything by voice. 88 tools, RAG memory, risk engine. |

## Pricing Section

- Eyebrow `— One price. Everything aboard. —`, h2 `$20/month. Cancel anytime.`
- Centered single card, max-width 440px:
  - `PRO · ALL ACCESS` gold badge
  - `$20` at 56px (font-weight 300, letter-spacing -2px) + `/month` 16px gold-dim
  - Italic-serif `— Less than one bad trade. —` tagline
  - Bullet list (8 items) with `✦` gold pips, hairline dividers between items:
    - Morning Wire — daily AI brief
    - UCT 20 portfolio + live signals
    - AI Compass — pre-trade, post-trade, weekly
    - Stock Catalysts — 20 rows / refresh
    - 85-detector pattern engine
    - 99-theme rotation tracker
    - Charts Workspace + 8 timeframes
    - Voice Assistant + real-time streaming
  - `Begin the Voyage` gold gradient CTA button → routes to `/signup?plan=pro`
  - Sub-note `No contracts. Cancel from your dashboard in 1 click.`
- Below the card: `Free forever: Dashboard, Breadth, Charts, Journal & Options Flow — no card required.` (Centered, gold-dim, single line)

## Footer

- Background `#06040a`, top 1px gold-dim border, centered content
- 60×60 wax seal medallion (smaller than the hero seal, same styling)
- `⊕ UCT INTELLIGENCE` brand row
- Italic-serif tagline `— A product of Uncharted Territory —`
- Link row: `Terms · Privacy · Disclaimers · Contact`
- Attribution: `Built on the methodologies of Qullamaggie · Minervini · O'Neil · Kell · Bonde.` + line break + `Not investment advice. Trade at your own risk.`
- Copyright: `© 2026 Uncharted Territory`

Existing `/terms` and `/privacy` routes already exist. `/disclaimers` is referenced in `project_disclaimer_page_planned` — link it even though the page is a stub; route is on the roadmap. `/contact` can route to mailto for now (`mailto:contact@uctintelligence.com`).

## Responsive Behavior

Following the existing app's responsive conventions (640px is the mobile/desktop breakpoint used throughout):

- **>1024px (desktop):** full design as spec'd
- **640–1024px (tablet):** feature grid collapses 4 → 2 col; pricing card unchanged; compass shrinks slightly; hero pills wrap more
- **<640px (mobile):**
  - Hero `flex-direction: column`, compass on top (sized ~160px), text below center-aligned
  - Wordmark scales down to ~40px
  - Corner annotations hide (too cluttered on mobile)
  - Wax seal hides
  - Equity curve stays as a background atmosphere but counter card simplifies (drop the delta line)
  - Feature grid collapses to 1 column
  - Live engine strip becomes horizontally scrollable
  - All text padding tightens

## Reduced Motion

Respect `@media (prefers-reduced-motion: reduce)`:
- Cancel `shimmerSweep`, `starTwinkle`, `ringRotate`, `needleWobble`, `greetingPulse`
- Skip the equity-curve animation loop entirely — render the full curve in its final state with the marker at $36K and `+$28,000 · 350%`
- Static parchment + compass + wordmark + tagline only

## Routes & CTAs

| Element | Route | Note |
|---|---|---|
| Nav `⊕ UCT INTELLIGENCE` | `/` | Self-link |
| Nav `Log In` | `/login` | Existing |
| Nav `Begin` | `/signup?plan=pro` | Existing — same as current Landing.jsx |
| Hero `Step Aboard — $20/mo` | `/signup?plan=pro` | Existing |
| Hero `Watch the Intro` | Placeholder `#` for v1 | Future: a hosted video URL or a modal that replays the intro animation |
| Pricing `Begin the Voyage` | `/signup?plan=pro` | Existing |
| Footer `Terms` | `/terms` | Existing |
| Footer `Privacy` | `/privacy` | Existing |
| Footer `Disclaimers` | `/settings` (Disclaimers card) for now | Per `project_disclaimer_page_planned` — settings card exists, standalone page pending |
| Footer `Contact` | `mailto:contact@uctintelligence.com` | Cloudflare Email Routing forwards to Gmail |

## File Plan

- **Replace** `app/src/pages/Landing.jsx` — new component, no `useIntersectionObserver`, no scroll-tracked sticky nav (the new nav is just sticky, no scroll state needed)
- **Replace** `app/src/pages/Landing.module.css` — new CSS module with the v6 design tokens
- **No new dependencies** — pure React + CSS modules + SVG; the equity-curve animation lives inline in the component using `useEffect` + `requestAnimationFrame` and refs
- **No backend changes** — the live engine strip is static text in v1
- **No new routes** — all CTA targets already exist
- **Reuse where possible** — the intro animation's design tokens (gold `#c9a84c`, cream `#f5e8c8`, ink `#1a1208`, parchment cross-hatch) are mirrored, not imported from `IntroAnimation.module.css`, to keep the two components independent

## Implementation Notes

1. **Component structure** — keep it as a single component file. The equity-curve animation is contained in a `useEffect` that runs on mount, attaches refs to the SVG path / drawn-curve / marker group / counter text nodes, and starts the rAF loop. Cleanup function cancels rAF on unmount.
2. **SVG sizing** — equity curve uses `preserveAspectRatio="none"` so it stretches to the hero dimensions. Marker position is computed in viewBox coordinates and applied via the `<g>` element's `transform` attribute — no DOM/pixel math needed.
3. **`useEffect` deps** — empty array; loop runs once on mount, runs indefinitely until unmount. No SWR, no React state inside the loop — direct DOM/SVG mutations for performance.
4. **Reduced motion check** — at the start of the `useEffect`, check `window.matchMedia('(prefers-reduced-motion: reduce)').matches`. If true, skip the rAF loop and set the marker to its final state via direct attribute writes; do not start the animation.
5. **Inline SVG path** — define the bezier path once in the SVG `<defs>` and `<use>` it three times (ghost, fill, drawn). Avoid duplicating the path string.
6. **CSS Modules naming** — flat class names (`.hero`, `.compass`, `.equityCurve`, etc.) following the existing convention; no nested selectors deeper than 2 levels.
7. **Brand colors as CSS custom properties** declared at `:root` level inside the module's `:global` scope OR scoped to the component. Match the design system: `--gold`, `--gold-dim`, `--gold-deep`, `--cream`, `--green`, `--red`, `--ink`, `--bg`, `--bg2`, `--text`, `--text-dim`, `--text-mute`.
8. **No prop API** — `Landing` takes no props (existing component takes none either).
9. **Browser support** — same evergreen targets as the rest of the app. SVG `getPointAtLength`, `clipPath`, `<animate>` are all universally supported in modern browsers.
10. **Testing** — no automated tests for the landing page in v1 (matching the existing `Landing.jsx` which has none). Manual verification: open `/` not logged in, check the hero animates, click each CTA, resize to 360/768/1280 widths, toggle reduced-motion.

## Acceptance Criteria

The redesign is done when:

1. `/` renders the new design when logged out (existing routing already serves `Landing.jsx` at `/`)
2. Hero compass animates (bearing ring rotates, needle wobbles, wordmark shimmers, equity curve climbs $8K → $36K with the P&L counter ticking up)
3. All 4 CTAs (nav Begin, hero Step Aboard, pricing Begin the Voyage, footer Contact) route correctly
4. Free-tier callout sits below the pricing card
5. Footer wax seal renders with `UT` monogram and methodology attribution
6. Mobile (360px width): compass + wordmark stack vertically, feature grid is 1-column, no horizontal scroll
7. Reduced-motion: no animation runs, equity curve renders in its final $36K / 350% state statically
8. No console errors, no broken images, no layout shift on initial load
9. Lighthouse Performance score ≥ 85 on desktop (no regression from current Landing.jsx)
10. Pushed to Railway and visible at `https://uctintelligence.com/`

## Out of Scope / Deferred

- Real product screenshots in feature cards or spotlights — hand-built mocks stay; replace later
- An intro-video modal or hosted intro video — `Watch the Intro` CTA is a placeholder
- Live data wiring on the engine strip — static text only
- A real `/disclaimers` standalone page — settings card link works for now
- A/B testing or analytics events — none in v1 (existing `Landing.jsx` has none either)
- FAQ, testimonials, methodology essay, "How It Works" steps, by-the-numbers strip — all cut for simplicity
- Internationalization, dark/light theme toggle — single dark theme matching the rest of the brand
