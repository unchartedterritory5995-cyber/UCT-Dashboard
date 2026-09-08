# 06 — UCT CURRENT MOBILE CHARTING BASELINE (ARCHITECTURE MAP)

> ## ⚠️ CORRECTED DOWNSTREAM — read these before acting on anything below
> - **P9 / workspace persistence:** statements in this file that UCT mobile has no named-layout
>   concept, or that the durable phone state is `localStorage['charts_mobile_sym']`, are
>   **FALSE**. The phone shell writes the symbol to the **server-backed**
>   `charts_workspace_groups` via `useWorkspace().setGroupSym`
>   (`MobileChartsApp.jsx:54,104,155`), named layouts already exist server-side
>   (`/api/charts/layouts`, carrying layout **and** symbols), and the only thing missing is a
>   **phone door**. Authoritative: **`60-p9-workspace-architecture.md`** and
>   `lanes/uct-p9-workspace.jsonl`.
> - **Crosshair / `$ Vol` / price-scale tap targets:** `.volLegend` and `.scaleToggle` are
>   `display:none` on the phone chart shell (`StockChart.module.css:778-797`). Any claim here
>   that UCT shows `$ Vol`/`Avg 50D` on a phone, or that three 17×11px scale controls are a
>   phone defect, is withdrawn. Authoritative: **`90-independent-validation.md`**.
> - **Object → alert, bare-chart price actions, drawing-tool counts:** superseded by the
>   addendum in `40-p1-p2-verdicts.md` and by `70-task-flow-comparisons.md`.


**Established:** 2026-09-07, by direct inspection of `origin/master` @ `eceb65844`.
**Method:** source read from `git show origin/master:<path>` — never the shared working
tree at `C:\Users\Patrick\uct-dashboard`, which is parked on `feat/catalyst-coverage-precision`
and dirty with another session's work.
**Status of runtime verification:** BLOCKED on auth (see §7). Everything below is
CODE-VERIFIED. Nothing here is a claim about observed runtime behaviour.

---

## 1. Route ownership

| Route | Component | LOC |
|---|---|---|
| `/charts` | `app/src/pages/charts/ChartsWorkspace.jsx` | 2,623 |
| `/watchlists` | `pages/charts/LegacyRedirect.jsx` (redirect) | — |
| `/research/:sym` | `pages/research/ResearchPage` | — |
| `/screener` | `pages/Screener` | — |

`/charts` is the single owner of the charting experience. There is no separate mobile route —
the phone experience is a **branch inside `ChartsWorkspace`**, not a distinct URL.

## 2. The mobile branch condition — VERBATIM from ChartsWorkspace.jsx:633-658

```js
isPhonePortrait = useMediaQuery('(max-width: 640px)')
isPhoneLandscape = useMediaQuery('(pointer: coarse) and (orientation: landscape) and (max-height: 500px)')
isTabletTouch    = useMediaQuery('(pointer: coarse) and (min-width: 641px) and (max-width: 1024px) and (min-height: 501px)')
isMobile         = isPhonePortrait || isPhoneLandscape || isTabletTouch
shellTablet      = isTabletTouch && !isPhonePortrait && !isPhoneLandscape
```

**Consequences that matter for this program:**

1. **Phone portrait is width-only** (`max-width: 640px`, no pointer clause) — so it IS
   reachable from a desktop browser at a narrow viewport. This is what makes the iframe rig work.
2. **Phone landscape and tablet BOTH require `pointer: coarse`.** They are therefore
   **unreachable from any desktop browser at any window size**. Only a real touch device
   enters those branches. This is a hard limit on what can be verified without a device,
   and it directly answers §27 of the brief: *portrait and landscape are not merely
   different CSS on UCT — they are different code paths behind a device-capability gate.*
3. A narrow **desktop** window (700px, `pointer: fine`) gets the **desktop RGL grid** at 700px.
   That is the `pointer: fine` inverse of [[lesson_pointer_fine_does_not_mean_desktop]].

Canonical breakpoints (`styles/breakpoints.js`): phone ≤640, tablet 641–1024, desktop ≥1025.
The repo's canonical TOUCH tier is ≤1024. Note the chart shell's phone tier (640) is
NARROWER than the repo's touch tier (1024) — the 641–1024 band only gets the chart shell
if the pointer is coarse.

## 3. Component tree of the phone chart shell

```
ChartsWorkspace (2,623 LOC)
└── MobileChartsApp (431 LOC)          pages/charts/mobile/MobileChartsApp.jsx
    ├── MobileSymbolStrip (119)        ticker header → opens symbol sheet
    ├── ChartPane                      components/chart/pane/ChartPane
    │   └── StockChart (15,938 LOC)    the engine wrapper
    │       └── lightweight-charts 5.2.0   ← TradingView's own OSS library
    ├── MobileChartToolbar (50)        the 5-door thumb strip
    └── sheets (all via components/mobile/Sheet):
        ├── MobileSymbolSheet (149)    fullscreen search → /api/ticker-search
        ├── MobileTfSheet (34)         timeframe grid
        ├── MobileChartTypeSheet (98)  5 chart types
        ├── MobileIndicatorSheet (436) studies + inline editing
        ├── MobileAlertSheet (115)     price alert
        └── MobileMoreSheet (100)      tools + widgets + add-widget
```

`MobileChartsApp` stamps `data-mobile-chart-shell` on `documentElement`, which other
surfaces key off (MobileNav, FeedbackWidget, voice FloatingOrb all reposition around
the bottom toolbar).

## 4. What the phone shell ALREADY has (the reuse-before-rewrite inventory, §37)

This is the single most important finding of the baseline: **UCT is not missing a mobile
chart shell. It has a TradingView-shaped one.**

| Capability | Where | Notes |
|---|---|---|
| Chart-first phone layout | `MobileChartsApp` | chart occupies the canvas; controls in a thumb strip |
| 5-door bottom toolbar | `MobileChartToolbar` | timeframe (gold pill) · chart type · indicators (+count badge) · watchlist · more. 44px+ targets, `role="toolbar"` |
| Bottom-sheet primitive | `components/mobile/Sheet` (206) | `variant="bottom-sheet"` and `"fullscreen"`; unmounts children on close (state resets by construction) |
| Haptics | `components/mobile/haptics` | `tap()` / `success()` wired into tf, type, symbol, alert, flag |
| Focus trap | `components/mobile/useFocusTrap` | used by Sheet |
| Symbol search | `MobileSymbolSheet` | debounced 150ms + AbortController, recents + popular, "Go to X" fallback, 16px input (no iOS zoom), `enterKeyHint="go"`, `autoCapitalize="characters"` |
| Recents | `mobileRecents.js` | `pushRecent` on every symbol pick |
| Timeframes | `MobileTfSheet` | 8 native + user custom intervals from `cs.header.customTimeframes`; one tap commits+closes |
| Chart types | `MobileChartTypeSheet` | candles · hollow · bars · line · area, each an inline SVG glyph |
| Indicators | `MobileIndicatorSheet` | toggle switches, inline `StepRow`/`ChipRow`/`SwatchRow` editing, library door |
| Price alerts | `MobileAlertSheet` | seeded from live price; **"Alert above"/"Alert below" ARE the commit buttons** — no separate direction picker |
| Drawing tools | `MobileDrawBar` (122) | **18 tools**, labeled tiles, horizontal scroll, pinned Done + undo/redo + eraser + magnet |
| Undo / redo | `MobileDrawBar` props | `onUndo`/`onRedo`/`canUndo`/`canRedo` — presented, owned by StockChart |
| Magnet | `MobileDrawBar` props | `magnet`/`setMagnet` |
| Share chart image | `MobileMoreSheet` | `onShareSnapshot` → native share sheet |
| Widget pages | `MobileChartsApp` | non-chart widgets open as full-screen overlays that NEVER unmount (instant return) |
| Tablet two-pane | `MobileChartsApp` `tablet` prop | widget DOCKS beside the chart, iPad-style |
| Multi-chart escape | `ChartsWorkspace:2060` | explicit "Exit Multi Chart" button, added because phone users were TRAPPED in grid mode |

**Drawing roster (`MobileDrawBar.DRAW_TOOLS`, 18):** trendline, horizontal, hray, rect, fib,
fibext, channel, pitchfork, avwap, advance, vertical, extended, arrow, circle, text, measure,
position, cup — plus `eraser` as a pinned tile outside the array.
A roster test (`MobileDrawBar.roster.test.js`) pins set-equality with the desktop
`DRAW_TOOL_LIST`, because on this shell the desktop toolbar is `display:none` and there is
no keyboard — **a tool missing from this array is UNREACHABLE, not merely demoted.** The
source comment records that `advance` and `cup` shipped that way for two waves.

## 5. State & persistence (code-verified)

Observed `localStorage` keys on a live authenticated session:

- `charts_mobile_sym` — the phone shell's current symbol
- `uct.charts.viewLock.<widgetId>[:<seriesKey>]` — per-widget view lock
- `uct-chart-drawings`, `uct-chart-tracings`, `uct-chart-extended`
- `uct.chart.toolbar.collapsed`
- `uct.watchlist.cols.<list>` — per-list column config

Server-side: `api/routers/charts_layouts.py` + `api/services/charts_layout_service.py`.
Per memory, the real chart settings authority is
`charts_workspace_layout → widgets[].opts.settings`; `chart_settings` is only a SEED.

## 6. Widget registry coupling

`app/src/widgets/registry.js` is metadata-only (deliberately no component imports) and
carries a **`menus.mobile`** membership flag — "the types that are usable at 375px;
MobileChartsApp's More sheet". So the mobile surface is already a first-class consumer of
the registry rather than a hardcoded subset.

## 7. What is NOT yet verified — and why

Runtime verification is **blocked on authentication**, not on tooling. The rig is built and
proven:

- Local backend running at `127.0.0.1:8078` from this research worktree
  (`app/dist` built; `WORKER_ENABLED=0 CATALYST_ENGINE_ENABLED=0 BARS_PREWARM_DISABLED=1
  TICKER_NAMES_PREWARM_DISABLED=1`). The vendor-socket guard correctly REFUSED to open the
  live finnhub socket, so there is no production coupling.
- True-viewport iframe rig proven working (measured `innerWidth` 387 / 427 / 373 in three
  same-origin iframes). `resize_window` is NOT usable — Chrome on Windows floors window
  width near 500px, and the memory note that it "left innerWidth at 1920" is consistent.
- `/charts` on the local instance 302s to `/login`. This is precisely the trap in
  [[lesson_mobile_audit_passes_vacuously_three_ways]] — without auth the rig would audit the
  login page and report it clean.

⚠️ **Production testing has been STOPPED.** An earlier three-iframe rig against
`uctintelligence.com` coincided with a pod restart (`/api/health` `uptime_seconds: 53`,
`/api/ready` 503 pending `rs_rankings`, rss 1003 MB). Three concurrent SPA boots is the
documented OOM shape from 2026-08-28. All further runtime work goes to localhost.

## 8. Open questions for the runtime pass (write answers here, do not guess)

1. Do all 5 toolbar doors meet 44px at 390px, measured with `getBoundingClientRect`?
2. Does `MobileDrawBar` actually mount, and are its 18 tiles reachable by horizontal scroll?
3. Is `onDrawOnChart` non-null in production config (the More-sheet row is conditional)?
4. Is `onShareSnapshot` non-null (same conditionality)?
5. What is the crosshair/inspection gesture on touch — is `crosshairMode` `'hold'` by default?
6. Does the chart preserve zoom/position across a timeframe change?
7. What happens at `pointer: coarse` landscape (unreachable in desktop Chrome)?
8. Sub-44px control count and off-viewport control count at 390 / 430 / 375.
9. Does the indicator sheet's inline editing work without leaving the chart?
10. Is there any object-tree equivalent for managing placed drawings?
