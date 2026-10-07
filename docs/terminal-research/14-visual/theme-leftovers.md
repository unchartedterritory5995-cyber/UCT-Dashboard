# Terminal theme leftovers — what changed (2026-10-06, branch `terminal/fn4-themes`)

**Ruling being implemented:** the terminal has no look of its own. Every panel follows the
member's app theme — dark, light, oled and the 18 catalog themes in
`app/src/styles/appThemes.js`. A colour is a token (`var(--…)`, `color-mix(… var(--…) …)`)
or, on a canvas, a token resolved through `lib/theme` (`useThemeInk` / `resolveThemeColor`).
Up/down colours are the theme's own `--gain` / `--loss`.

## What "terminal-mounted" means here

Derived, not typed: an import walk from every module under `app/src/pages/terminal/`
(static imports, re-exports, lazy `import()`, CSS `composes`) —
`app/src/pages/terminal/__tests__/themeScope.js`. It reaches ~900 files, because the
surface panels mount whole pages (Breadth → COT, UCT20, Screener, Morning Wire …) and the
Breadth drill board mounts the /charts widget host. The walk does not descend into files
other lanes own (`components/chart/**`, `StockChart`, Options Flow, Journal 2.0,
`useTapeFeed`).

## Fixed

| Surface | Was | Now |
|---|---|---|
| UCT20 equity chart (Lightweight Charts) | fixed `#1a1c17` card, fixed axis/grid/series hexes | `useThemeInk` (`--bg-surface`, `--text-muted`, `--border`, `--ut-green-bright`), repainted in place on a theme switch |
| UCT20 monthly heatmap | near-black green/red cell fills | `color-mix` tints of `--gain` / `--loss` |
| FuturesStrip sparklines | fixed rgba greens/reds | `--gain` / `--loss` / `--text-muted` via `style` |
| FundamentalSnapshot scores, grades, signs, checkup | the five score hexes, `#3cb868`/`#e74c3c` | `--score-*`, `--grade-*`, `--gain`, `--loss` |
| Score ramp on a light theme | five bright hexes tuned for dark (middle steps under 3:1 on white) | `[data-theme="light"]` variant derived from that theme's `--gain`/`--warn`/`--loss`; pinned in the earnings-modal island with the `--grade-*` aliases |
| About panel (TickerPopup) | a fixed dark card (`#181610` gradient, cream text) | every ink a token |
| TickerPopup flow chips, dark-pool toggle | fixed gold/grey/bull-bear hexes | tokens |
| COT pane | symbol search and phone sheet typed **white** text on the light surface | `--text-bright`; active sheet row uses on-fill `--bg` |
| Call-recap analyst rating chart | five fixed bucket hexes | `--gain`, `--score-strong`, `--text-muted`, `--score-weak`, `--loss` (the research-kit host resolves them per theme) |
| MarketBreadth score, watchlist rating, DailyOverview hero hue, Screener retry button, CompanyLogo plates, Regime clock hit area | fixed hexes | tokens |
| ~40 terminal-reachable stylesheets (Catalysts tile, TickerActions, transcript search, ThemeTracker, Watchlists, ScannerShell …) | `rgba(…)` tints and gold/green/red hexes | `color-mix(in srgb, var(--token) N%, transparent)` |
| `var(--gold, #…)`, `var(--warning, …)`, `var(--color-accent, …)`, `var(--border-subtle, …)`, `var(--panel, …)` | **tokens that do not exist**, so the hex fallback was the colour on every theme | the real tokens (`--ut-gold`, `--warn`, `--accent`, `--border`, `--bg-surface`) |

The COT Chart.js panes, tooltips, axes and grid were already on `useCotPalette` (an earlier
round); the dark leftovers under light were the stylesheet's white text, now fixed.

## The rails

- **`app/src/pages/terminal/themeColours.rail.test.js`** — no terminal-mounted file may gain a
  hex / rgb / named white-black colour. The ledger
  `pages/terminal/__tests__/themeColours.baseline.json` has two halves: `exceptions` (genuine
  fixed colours, each with a reason — brand marks, member-picked tag colours, link-group
  identity hues, the logo's white plate, categorical series hues the chart host nudges to
  3:1, canvas jsdom fallbacks) and `debt`. Both are shrink-only: a file that loses a literal
  must lower its count in the same commit. Sanctioned forms: a real token's fallback, a
  `lib/theme` canvas spec fallback, a translucent black (shadow/scrim), mask stops. Controls
  prove the detector, the verdict, and a literal planted in a real scoped file all fail
  (also mutation-checked by hand: `#123456` appended to `CotData.module.css` → red, restored
  by sha).
- **`app/src/pages/terminal/themeTokens.allThemes.test.js`** — every app token a
  terminal-mounted file references resolves through its `var()` chain in **all 21 themes**
  (dark, oled, light + every `APP_THEMES` entry applied as `Layout.jsx` applies it); tokens a
  canvas resolves must come out as a colour (or a size for `SIZE_INK`); and no bare `var()`
  names a token declared nowhere. It found that `--tick-up-bg`/`--tick-down-bg` exist only in
  the light block — safe today because every use carries a fallback, which the check now
  understands (a token whose every use has a fallback is "guarded").

## Left, and why

- **Owner decision — the earnings research modal is a dark theme island**
  (`EarningsResearchModal.module.css`): it pins every themed token to its dark value, so it
  stays dark on a light theme. It was a deliberate fix (its `--menu-*` shell is
  theme-invariant by the 2026-07-30 menu ruling, and its content was unreadable on light
  before the island). Under the new ruling it should follow the theme; that means changing
  the shell off `--menu-*` and deleting the island, and `styles/themeIslands.test.js`
  currently requires at least one island to exist. Recorded as debt.
- **Owner decision — Breadth treemap tiles** (`heatmapMetrics.js`, `TreemapView.jsx`) are
  opaque dark tier fills carrying their own white ink: legible on any page, but dark on a
  light one. Translucent `--heat-*` tiles with theme text would follow the theme. Debt.
- **Menus stay dark on every theme** by the 2026-07-30 owner decision (`--menu-*`,
  `utils/dividerColor.js`); TickerPopup's switch menu and TickerActions now use those tokens
  instead of private hexes. If the new ruling is meant to cover menus too, that decision has
  to be reversed explicitly.
- **/charts workspace widgets** reached through the Breadth drill board carry member-pickable
  palettes and their own `--wl-*`/`--cal-*` widget variables; theming them is the charts
  workspace sweep (debt, ratchet only).
