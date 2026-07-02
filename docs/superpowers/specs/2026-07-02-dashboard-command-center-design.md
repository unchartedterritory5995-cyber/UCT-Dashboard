# Dashboard Command-Center Restyle

**Date:** 2026-07-02. **Approved direction (user):** command-center re-grid — slim market-status header + bento mosaic where tile size = morning-workflow importance. Desktop only; the mobile triaged stack is untouched.

## 1. MarketStatusBar (new — replaces FuturesStrip's desktop row)
`app/src/components/dashboard/MarketStatusBar.jsx` + `.module.css`, ~44px strip:
- **Session pill** (left): pulsing dot + label + live ET clock — `● MARKET OPEN · 9:47 AM ET`. States from `useMarketOpen`: open (gain green) / PRE-MARKET (amber) / AFTER-HOURS (amber) / MARKET CLOSED (muted). Clock ticks on a 30s interval.
- **Index chips** (center): SPY · QQQ · IWM · DIA · BTC · VIX — price + signed % colored, from the same `/api/snapshot` SWR feed FuturesStrip uses (10s refresh; BTC from `futures`, rest from `etfs`). Feed down → chips just don't render (bar never blanks the page).
- **UCT Exposure chip** (right): gold-bordered `EXPOSURE 85` from `/api/breadth` (`exposure.score`; same SWR key MarketBreadth uses → deduped). Hidden when absent.
- **Quote line** beneath the bar: ONE italic line — the daily quote + em-dash author. The 392-quote library moves verbatim to `app/src/data/quotes.js` exporting `QUOTES` + date-seeded `quoteOfTheDay()`; `FuturesStrip` (still used on mobile) imports from there. Same seed math (`seed*97 % len`) so the day's quote matches across surfaces.

## 2. Cockpit grid (desktop `.desktopOnly` only)
- Under the status bar: `IntradayPulse` (unchanged slim strip).
- **Row B — the decision row:** 12-col grid, `7fr / 5fr`: left = **Stock Catalysts hero** (gold-edge emphasis: 1px gold-tinted border + faint glow via a `.hero > :first-child` element selector so TileCard internals stay untouched; max-height ~680px, internal scroll). Right rail = `JournalSnapshotTile` stacked over `MoversSidebar` (movers wrapper max-height so the rail matches the hero, internal scroll).
- **Row C:** 4 equal columns — `MarketBreadth` · `ThemeTracker` · `LeadershipTile` · `TapeFeed` (2×2 at ≤1440px).
- **Row D:** `CatalystFlow` (earnings) · `OptionsFlowPreview` 2-col. **Row E:** `DeskVideoRail`.
- Uniform 14px gaps; tiles get hover lift (translateY(-1px) + border brighten, reduced-motion-gated) via a shared `.tileHover > *` rule in Dashboard.module.css (element selector on TileCard roots).
- Breakpoints (canonical 1024/640 + keep the existing 1100 desktop step): ≤1440 row C → 2×2; ≤1100 row B stacks (hero full width, journal+movers 2-col beneath), row C 2-col, row D 1-col. Mobile (≤~900 existing switch) unchanged — `.mobileOnly` stack still renders FuturesStrip + everything as today.

## 3. Constraints
- Every tile component reused untouched (zero data-flow changes). New code = MarketStatusBar, quotes.js move, Dashboard.jsx desktop JSX order, Dashboard.module.css grid.
- No new endpoints; SWR keys shared with existing tiles so no extra request load.
- No emoji as icons; gold chrome only; skeleton/blank-safety: the bar renders whatever chips have data.

## Testing
quotes.js determinism; MarketStatusBar (session states via mocked useMarketOpen, chips from mocked SWR, null-safe empty feed, exposure chip); Dashboard existing tests keep passing (update render expectations if they assert FuturesStrip on desktop).

## Out of scope
Mobile stack changes · tile-internal redesigns · draggable/customizable grid (Charts workspace already covers that need) · Quote library edits.
