# Mobile Charts — iOS-grade redesign (Phase 1: the chart screen)

**Date:** 2026-08-30 · **Branch:** `claude/mobile-ui-ios-redesign-1ky91n`
**Goal:** `/charts` on a phone should feel like TradingView's iOS app — a full-bleed
chart with thumb-reachable controls — instead of the desktop widget chrome crammed
into 375px. Owner's rating of the shipped experience: 3/100. This phase is the
foundation the rest of the mobile initiative builds on.

## What was wrong (measured against the shipped `MobileWorkspace`)

1. **The chart rendered with full desktop chrome.** `MobileWorkspace` mounted
   `WidgetHost → ChartWidget → ChartPane(density="full")`: identity row (company
   name + session toggles + market clock), timeframe bar with meta strip, settings
   gear — all at ~24px touch targets, all at the TOP of the screen where thumbs
   aren't. The actual candles got what was left.
2. **Every picker was a desktop control.** Timeframes: a hover-tuned dropdown.
   Symbol search: a 280px desktop portal dropdown. No bottom sheets, no 44px rows.
3. **Widget tabs consumed a row to say "Chart · Watchlist · Themes"** — navigation
   chrome a phone user pays for on every screen.
4. **Zero iOS affordances**: no safe-area awareness inside the page, no
   tap-highlight suppression, no haptics, no thumb-zone layout.

## The new shape (TradingView-mobile parity)

```
┌────────────────────────────────────┐
│ MobileNav (existing app bar, 48px) │
├────────────────────────────────────┤
│ ◉ AAPL ⌄  Apple Inc.       212.44 │  ← symbol strip: tap ANYWHERE → full-screen
│                            +1.24%  │    symbol search. Live price via SSE pool.
├────────────────────────────────────┤
│                                    │
│          FULL-BLEED CHART          │  ← ChartPane density="mini" showTfBar={false}
│        (pinch / pan native)        │    = zero pane chrome, candles only
│                                    │
├────────────────────────────────────┤
│ [ D ]  [type] [ ƒx ] [ ⋯ ]         │  ← bottom toolbar, 44px+ targets, thumb zone
├────────────────────────────────────┤
│ MobileTabBar (existing, 58px)      │
└────────────────────────────────────┘
```

Every picker is a **bottom sheet** (`components/mobile/Sheet`), every commit fires
`haptics.tap()`:

- **Symbol** (tap the strip) → full-screen sheet: auto-focused search (16px font so
  iOS never zooms), Recents (localStorage `uct.charts.mobileRecents`, cap 12),
  Popular, live `/api/ticker-search` results at 52px rows with logos, "Go to X"
  fallback row.
- **Timeframe** → bottom sheet grid: the 8 native TFs + the user's custom TFs from
  chart settings. Active = gold.
- **Chart type** → bottom sheet: Candles / Hollow / Bars / Line / Area with drawn
  SVG glyphs (writes `cs.chartType`, `preset:'custom'`, same sink as desktop).
- **Indicators (ƒx)** → bottom sheet: the 4 MA overlay slots as toggles (reads/writes
  `cs.overlays` positionally — the schema is positional, see chartDefaults), plus
  **"Browse indicator library…"** which opens the SAME `IndicatorLibraryDialog` the
  desktop toolbar owns (see `toolbarApiRef` below) — the criteria-builder door stays
  open on phone — plus "All chart settings…" (`paneRef.openSettings()`).
- **More (⋯)** → bottom sheet: Flag/unflag current symbol · Chart settings · the
  layout's OTHER widgets (watchlist / scanner / themes …) each opening as a
  full-screen page over the chart with a "‹ Chart" back bar · Add widget
  (`MOBILE_MENU_TYPES`).

## Architecture decisions

- **The phone view is a VIEW over the same saved layout.** `MobileChartsApp` binds
  the **first `type:'chart'` widget** in `layout.widgets` (derived every render —
  the hydration-ordering rule from the 2026-08-09 landing fix, ported forward:
  never a `useState` initializer). Its `opts.tf` / `opts.settings` are read and
  written through the same `onOptsChange` the desktop grid uses, so a phone edit
  is a desktop edit; `chartId = widget.id` matches WidgetHost's main-tab `groupId`,
  so alert scoping agrees across devices. Ticker changes go through
  `setGroupSym(widget.color)` — color-group linking with the other widgets is
  preserved.
- **Compose `ChartPane` directly, never `ChartWidget`** — the same precedent as
  `GridChartCell` ("composed on StockChart directly … NEVER ChartWidget itself").
  ChartWidget is workspace chrome (tabs, right-click menu, crosshair bus); the pane
  is the chart. `density="mini"` + `showTfBar={false}` renders candles only and
  gates off the fundamentals/quote/meta fetches (`infoGate` in ChartPane).
- **The drawing toolbar stays mounted** (StockChart default `showDrawingTools`).
  It is the mount point of `IndicatorLibraryDialog` → `BuilderSheet` (the
  builder-door wire, `builderDoor.wire.test.jsx`), it has its own collapse chevron,
  and it keeps drawing possible on phone. Restyling it for touch is Phase 2.
- **`toolbarApiRef`** — one additive StockChart prop: a host-supplied ref that
  StockChart fills with the mounted ChartToolbar's imperative API
  (`openIndicatorLibrary` / `openAlerts`), null when no toolbar is mounted. This is
  how the bottom toolbar's ƒx sheet opens the real library instead of mounting a
  second one (the "ONE POPOVER, NOT A SECOND MOUNT" rule already in StockChart).
- **Widget pages render OVER the chart** (absolute overlay), not instead of it —
  the chart never unmounts, so returning from the watchlist is instant and free
  (no refetch/reframe). `WidgetHost` renders the page body unchanged, so widget
  behaviors (tabs, color linking, remove) are byte-identical to the tab-strip era.
- **Sizing:** the shell root keeps the `.mobileWorkspace` class —
  `mobileShellHeight.test.js`'s token-subtraction contract (top bar + tab bar
  declared once in tokens.css) holds untouched.
- **Grid mode on phone** (stacked Multi-Chart cells) is untouched this phase.

## iOS polish checklist (applied in `MobileCharts.module.css`)

- 44px minimum targets (`var(--tap-min)`) on every control; the toolbar buttons
  are flex-grown so the whole bar is a thumb strip.
- `-webkit-tap-highlight-color: transparent` + `touch-action: manipulation`
  (kills the 300ms/double-tap-zoom class) + `user-select: none` on chrome.
- Frosted-glass toolbar (`backdrop-filter: blur/saturate`) with solid fallback.
- Search input ≥16px font (prevents iOS focus-zoom), `autocapitalize=characters`,
  `autocorrect/spellcheck off`, `enterkeyhint=go`.
- Sheets already carry safe-area padding + drag-to-dismiss (Sheet primitive).
- Haptics on selection commits only (`components/mobile/haptics`), never on scroll.
- Momentum scrolling + `overscroll-behavior: contain` in sheet lists.

## What replaced what

| Was | Now |
|---|---|
| `widgets/MobileWorkspace.jsx` (tab strip + full desktop widget) | 🗑️ deleted — `mobile/MobileChartsApp.jsx` (chart-first shell). Its hydration-ordering rule and cold/warm tests are PORTED, not dropped (`MobileChartsApp.landing.test.jsx`). |
| `MobileWorkspace.landing.test.jsx` | `mobile/MobileChartsApp.landing.test.jsx` (same cold-prefs discipline) |
| phone assertion in `builderDoor.wire.test.jsx` (`tablist "Chart widgets"`) | the shell's toolbar (`data-testid="mobile-chart-toolbar"`); the builder walk itself is unchanged and unmocked |
| `ChartsWorkspace.test.jsx` mobile-branch mock | same test, new mock path/testid |

## Phase 2 — competitor parity (shipped same branch, 2026-08-30)

Grounded in a research pass on TradingView mobile (bottom interval/indicators/
draw controls, rotate-to-fullscreen — our layout matched the pattern) and
Deepvue (whose signature is the watchlist scan→tap→chart loop with mini
charts):

- **Landscape immersive** — a coarse-pointer landscape short viewport
  (`max-height: 500px`) now lands in `MobileChartsApp` too (it previously fell
  into the desktop RGL branch at 700–930px width). While the shell is mounted
  (`html[data-mobile-chart-shell]`) that media state hides MobileNav,
  MobileTabBar and both FABs, zeroes Layout's bar reservations, and the shell
  takes `100dvh` with slimmed strip/toolbar + notch-safe side padding
  (`viewport-fit=cover` is already set). Rotate = fullscreen chart; every
  other route is untouched.
- **★ Watchlist in the toolbar** — one tap opens the layout's watchlist widget
  full-screen over the chart (color-group linked, so tapping a row retargets
  the chart); with none saved, one is added and opened when it hydrates
  (render-time state adjustment, not an effect).
- **Price alerts from the chart** — More → "Set price alert…" →
  `MobileAlertSheet`: 20px decimal input seeded from the live price, "Alert
  above" / "Alert below" as the commit buttons, riding the same `createAlert`
  (bell + email + Discord delivery) the desktop right-click uses.

## Phase 3 — the loop, closed (same branch, 2026-08-30)

- **Tap-to-chart** — a full-screen page that RETARGETS the chart (a watchlist
  row tap publishing into the chart's color group) hands the member straight
  back to the chart showing the pick, TradingView-watchlist style. Implemented
  as a render-time comparison of the chart symbol against the symbol captured
  at page-open (`screen.symAtOpen`); a page on a different color group can
  never move the chart's symbol, so it stays open — correct by construction,
  no widget-type allowlist to maintain.
- **Chromeless widget pages** — the phone page now mounts `WidgetHost` with
  its existing `merged` contract (no desktop drag/close bar; a multi-tab slot
  keeps its tab strip), and removal moves to a trash button in the page
  header. The accidental-remove ✕ is off the phone.

## Phase 4 — Deepvue sparklines, herd-free (same branch, 2026-08-30)

Phone watchlist rows carry a mini price path beside the ticker
(`components/mobile/RowSpark.jsx`, mounted in the shared WatchRow `sym` cell).
⛔ **Zero network by construction** — rows can number in the hundreds
(thousands in scan mode) and this repo has been burned by per-row fetch herds,
so the spark reads ONLY the local bars store (`idbGet(sym,'D')`, seeded by the
Universe Bars Pack and every chart view) and renders nothing for a symbol the
store doesn't hold; there is no `/api/bars` fallback. Desktop mounts read
nothing at all (useIsPhone gates the read; the CSS module hides the node
above 640px as the layout guarantee). Results memo in a module Map so
virtualized scan scrolling re-serves from memory. Rail:
`RowSpark.test.jsx` — pins the no-fetch-fallback and desktop-reads-nothing
directions plus the pure `sparkPath` geometry.

## Phase 5 — touch drawing works (same branch, 2026-08-30)

Verified end-to-end with REAL touch input (CDP `Input.dispatchTouchEvent` →
Chromium's genuine `pointerType:'touch'` path) against a seeded chart:

- **The phone toolbar overlap bug** — at 393px the ACTIONS cluster (7 coarse
  40px buttons + the labelled Indicators button) is wider than the toolbar; as
  `flex: 0 0 auto` it overflowed the flex line and painted OVER the zero-width
  tools rail, so every drawing tool was untappable (the Trendline tap landed
  on the Magnet button — found by the automated walk, invisible to a
  screenshot). Fixed in the ≤640px block: `.toolbar` wraps, `.actions` takes
  its own line(s), `.tools` gets basis 0 so the collapse chevron shares line 1.
  Rail: `ChartToolbar.phonewrap.test.js` (mobileShellHeight idiom — the three
  declarations are the artifact under test).
- **Placement on touch is TAP-TAP** (each pointerdown adds an anchor; the
  second commits) — the overlay's existing model, which matches TradingView
  mobile. Verified: arm Trendline → two taps → drawing rendered AND persisted
  to `uct-chart-drawings` (per-symbol). Long-press on a drawing opens its
  context menu; a second finger aborts placement in favor of pinch-zoom —
  both already built into the overlay.

## Phase 6 — touch reshape + the tap-tap hint (2026-08-31)

- **Finger-visible handles**: the reshape hit zone was already coarse-aware
  (`HIT_THRESHOLD` 15px on touch) but the painted dot stayed 4px — invisible
  affordance. On coarse pointers the dot grows (`HANDLE_R` 7px) and gets a
  soft gold halo sized to the REAL grab zone, so a finger sees exactly how
  close is close enough.
- **One-time "Tap 2 points to place" chip** for multi-point tools on touch
  (bottom-center, thumb-adjacent; text flips to "Now tap the next point"
  after the first anchor). Retired forever by the first completed placement
  or its ✕ (`uct.drawings.tapHintSeen` — the voice.dictation.hintSeen idiom;
  a storage-read failure counts as seen, never nag in private mode).
- **The rig now gates the whole finger lifecycle**: `tools/iphone_walk.py`
  asserts hint shown → placement → hint retired → line SELECTED by body tap →
  anchor DRAGGED by touch → reshaped points persisted. Exit 1 on any break.

## Phase 7 — iPad two-pane (2026-08-31)

A COARSE-pointer 641–1024px viewport (min-height 501px so a rotated phone
stays immersive) now renders `MobileChartsApp` in **tablet mode** instead of
the desktop RGL grid — whose drag/resize is mouse-only and unusable on touch.
A narrow fine-pointer desktop window keeps RGL unchanged.

- **Two panes**: the phone shell's chart column (symbol strip · chart · thumb
  toolbar) plus a DOCKED companion panel (`clamp(300px, 36vw, 400px)`) where
  the phone shows a full-screen page. Same state, same handlers — `.chartCol`
  is `display:contents` on phone so the phone layout stays byte-identical.
- **The tap-to-chart rule inverts by construction**: a docked panel never
  covers the chart, so a watchlist row tap retargets the chart BESIDE it and
  the panel stays open (the phone bounce is `!tablet`-gated).
- **Auto-dock once**: the first watchlist widget docks itself when the layout
  hydrates (render-time adjustment); closing it sticks; ★ or the Tools sheet
  reopens/re-points the panel.
- **Sparklines follow**: RowSpark's gate widened from phone-only to
  `(pointer: coarse) and (max-width: 1024px)` — the docked panel is exactly
  Deepvue's iPad watchlist surface. Fine-pointer windows still read nothing.
- FAB raises under `html[data-mobile-chart-shell]` widened to ≤1024px so the
  orb/"?" clear the toolbar on tablets too.
- Rig: `iphone_walk.py` adds an iPad context (820×1180) asserting the
  two-pane docks; landing suite grows to 22 (auto-dock, stay-open on
  same-group publish, close-sticks + ★ reopen).

## Deliberately deferred (Phase 8+)

- **On-device iOS Safari pass** — Phase 6 closed the reshape/hint polish; the
  remaining verification (WebKit quirks, safe-areas, scroll feel) is real
  glass's to give, or `tools/iphone_walk.py --engine webkit` on a Mac.
- **Price + interval in the top app bar** (reclaim MobileNav's title row on
  /charts), long-press crosshair inspect card, per-widget mobile headers.
- **Tablet fine-pointer widths** keep the RGL workspace (deliberate — mouse
  users get the desktop grid; Phase 7 moved only coarse-pointer tablets).

## Phase 8 — the feel layer (shipped)

The "little things TradingView/Deepvue have that are hard to name." Seven
micro-interactions, all additive:

- **Back-to-live chip** — pan into history and a » button (40px round,
  `UIcon skipForward`) floats left of the price axis; one tap
  `scrollToRealTime()` (KEEPS pinch zoom — TV-mobile behavior). StockChart
  prop `showGoLive` (default false — ONLY the mobile shell passes it,
  desktop byte-identical). ⚠️ CONVERGED at the master merge: master's
  `dd2e2d731` shipped its own desktop "Scroll to present" button
  (`toPresentBtn`, 26px, `doResetView()`) off a `lastBarOff` state the
  label-suppression effect maintains. ONE authority: the pill now renders
  off that SAME `lastBarOff` (its own range subscription was deleted), and
  the two render sites are mutually exclusive on `showGoLive` — a surface
  gets exactly one back-to-now affordance. Rig step `golive_walk`:
  touch-pan → pill appears → tap → retires; a FAIL gate like place/reshape
  (it caught the orb-cluster tap-interception at bottom: 42px AND the
  edge-swipe history-back at start x=70).
- **Long-press crosshair already sticks** — LWC's `trackingMode.exitMode`
  DEFAULTS to `OnNextTap` (verified in the installed typings), so the
  TradingView press-hold-drag-release-inspect loop needed zero config. What
  Phase 8 adds: `-webkit-touch-callout/user-select: none` on `.chartArea` +
  `.symStrip` (coarse only) so iOS's text loupe never hijacks the press.
- **Press states** — coarse-only `:active` compression (scale .94, 90ms) on
  every toolbar button/grid cell, bg-tint on sheet rows. The visual "thunk";
  iOS Safari gives web apps no vibration API (haptics.js already documents
  the no-op).
- **Tick flash** — the strip's price takes the tick's direction color and
  eases back. Direction = comparison vs the PREVIOUS quote (not the day's
  sign), render-time state adjustment (no set-state-in-effect), pure CSS
  keyframes with the `to` frame omitted (browser fills the base color), a
  per-tick React key restarts consecutive same-direction flashes. A symbol
  switch never flashes. `MobileSymbolStrip.flash.test.jsx` (5).
- **ƒx count badge** — gold chip on the Indicators button = enabled overlay
  slots. VISUAL-ONLY: the accessible name stays the stable "Indicators"
  (`builderDoor.wire.test` queries it by exact name — a dynamic aria-label
  broke it in development; the rail won).
- **Share chart image** — More-sheet row (camera icon): StockChart's
  toolbarApi grew `getSnapshotBlob()` (the same `takeScreenshot()` recipe
  the desktop Save-to-Notebook path uses) → `navigator.share({files})` =
  the native iOS share sheet, download fallback elsewhere. AbortError
  (user cancels) swallowed.
- **Already-there discoveries, recorded so nobody re-ships them**: the
  search sheet had logos/`autocapitalize=characters`/`enterKeyHint=go`
  since Phase 1; `Sheet` has had a drag grip bar (`styles.grip`) all along.

Landing suite grows to 25 (goLive wire pinned through the ChartPane mock's
`data-golive`, badge count, share row) + 5 flash tests.

## Phase 9 — little spots (shipped)

Four gaps found by using the thing, not by any list:

- **Full-height chart** — the app top bar burned a row saying "Charts" under
  a tab already saying it. On the phone shell (portrait ≤640, the same
  `html[data-mobile-chart-shell]` attribute) MobileNav's `.topBar` hides,
  Layout releases ONLY the top reservation (tab bar stays), the workspace
  override re-derives height from the tab-bar token alone, and the symbol
  strip absorbs the notch via `max(4px, env(safe-area-inset-top))`. Same
  three-file mechanism as landscape-immersive; `mobileShellHeight.test.js`
  grew a describe pinning all three declarations together.
- **Alert sheet manages state** — it now lists the symbol's active alerts
  (`getAlertsForSym`) with ▲/▼ + price + per-row delete, so nobody stacks
  blind duplicates. Same hook, same SWR caches.
- **Add-widget opens what you added** — the Tools-sheet add closes the sheet
  and, when the new widget hydrates into the layout, opens it as a page
  (pendingWatchlistOpen generalized to {type, countAtTap}; `chart` exempt —
  the shell already binds the first chart).
- **Long-press row actions** — watchlist rows only had `onContextMenu`,
  which iOS never fires: phones had NO row actions (Notes / alert / remove).
  The sym cell now binds `useLongPress` (one binding: touch long-press +
  desktop right-click), and the RELEASE-CLICK SWALLOW moved INTO the hook
  (`onClickCapture` keyed on its own firedRef — all seven consumers get the
  fix; without it the release selects the row and the tap-to-chart rule
  yanks the page out from under the just-opened sheet). Flagged rows keep
  no menu BY DESIGN (the star is their remove) — same as desktop.

Rig: two new FAIL gates (top bar hidden with the tab bar as the control;
long-press → the AAPL row sheet in an owner list the walk provisions via
the API — RigList, idempotent). ⚠️ The long-press press itself is a
JS-dispatched `pointerdown`, NOT a CDP touch: headless Chromium parks a
motionless `dispatchTouchEvent` press in tap-vs-scroll disambiguation and
flushes pointerdown only at release, so a held CDP press can never reach
450ms (a 2px nudge stays inside browser slop; more cancels by tolerance).
Real browsers deliver immediately; the hook's timing + swallow are
unit-tested (`useLongPress.test.jsx`, 3 new cases).

## Phase 10 — the clean canvas (shipped)

Owner verdict after using production: "still very much behind TradingView's
ease of use." Diagnosis: the CHROME became iOS-grade in Phases 1–9, but the
CANVAS still wore desktop clothes — an 8-row always-on legend, the TC2000
range bar, the $-Vol strip, the A/L/% scale chips, the voice orb + "?" FABs
on the volume pane, and a three-row drawing-toolbar wall. TV mobile shows
NONE of that. This phase takes it all off the phone shell:

- **Legend = crosshair inspection tool.** ChartPane force-enables
  `verticalLegend` + `alwaysShowLegend` + `showRangeSelector` for the
  desktop workspace; the shell overrides all three through
  `stockChartProps` (spread after them — pinned by the landing rail's
  `data-cleancanvas`). Idle canvas shows candles + the strip's live price;
  long-press summons OHLC/MA values, horizontal row.
- **`.volLegend` + `.scaleToggle` hidden** under the shell attribute
  (settings sheet still owns log/percent).
- **FABs off the chart page** (portrait now, matching landscape) — the orb
  cluster sat ON the volume pane and once tap-blocked the go-live chip.
  One tab away everywhere else.
- **Actions wall slimmed by title selector** (zero logic): Share
  (More-sheet owns it on phone), Keyboard shortcuts, Replay, Compare,
  bar-close clock — hidden at ≤640. The indicator-alerts bell STAYS (only
  door to that feature).
- **Ghost chevron**: the collapsed-toolbar expander drops to opacity .4 on
  transparent — an affordance, not furniture.

Full rig PASS unchanged (all five gates). Every change is scoped to
`html[data-mobile-chart-shell]` + phone width or to `stockChartProps` —
desktop, grid, and iPad byte-identical.

## Phase 11 — the 500-user discovery sweep (wave 1)

`tools/mobile_discovery.py`: 12 user JOURNEYS (SE 375×667 · Pro Max 430×932 ·
landscape sheets · rotation mid-sheet · dotted/garbage/edge symbols ·
bars-API-dead · search-API-dead · settings dialog · indicator library +
sub-pane add · persistence reload · two-chart layout · iPad dialogs), each an
isolated context capturing screenshots + console/pageerrors into
mobile_audit_out/discovery/report.md. Discovery REPORTS (exit 0 always); the
walk GATES.

**Wave-1 findings → fixes (all verified by journey rerun + full walk PASS):**
- 🐛 **Rotation wiped the shell.** `isMobile` OR-ed three separate
  useMediaQuery MQLs; their change events fire one at a time, so a rotation
  produced one render with all three false — the desktop branch mounted for a
  frame and REMOUNTED MobileChartsApp (open sheet gone, open page gone).
  Fixed: ONE comma-list media query = one MQL, no gap. Journey now shows the
  TF sheet surviving rotation and still committing.
- 🧹 **Landscape kept desktop chips.** The clean-canvas hide was
  portrait-width-only; rotated phones got A/L/% + $-Vol back. Media extended
  with the landscape clause.
- 🧹 **"● LIVE" is furniture too** (invisible in seeded rig runs — no live
  feed; real phones always show it). Hidden on the shell; STALE/RECONNECTING
  (`.staleIndicator`) still render — quiet when healthy, loud when broken.
- 🐛 **Focus ring stuck on the ƒx button** after sheet close (Sheet restores
  focus to its opener; the app's heavy gold focus-visible ring reads as a
  stuck state on touch). Quiet inset ring for keyboard; none otherwise.
- 🧹 **Settings modal on phone**: templates row clipped "UCT Chart Themes"
  mid-word (now one-row momentum scroll, tabs too) and wore a 🎨 emoji
  (→ UIcon sun; the no-emoji rule's last holdout on this surface).
- ✅ Confirmed GOOD by journeys: SE + Pro Max layouts, both sheets in
  landscape, dotted-ticker + garbage + search-API-dead degradation ("Go to X"
  fallback everywhere), bars-error Retry state, indicator LIBRARY on phone
  (real sheet, plain-English rows), persistence across reload (tf survives
  server-side), two-chart layouts, iPad dialogs.

**Rig hardening the sweep forced** (the sandbox's Chromium image swap changed
CDP touch semantics — streams flush at release, tap pointerups get swallowed):
gestures are now JS-dispatched (`js_pointer_drag` / `js_touch_drag` /
balanced tap pairs) — deterministic across browser builds; walk + discovery
both self-heal the account's server-persisted symbol/timeframe (discovery
journeys pick BRK.B/1h and the seed covers SPY-family DAILY only — the
"regression" that cost two hours was the rig's own leftover state opening an
honest no-data error chart).

Unexplored crevices queued for wave 2: widget pages (scanner/news/themes) at
phone quality bar, sub-pane indicator visual verify (needs a seeded sym kept
clean), alert-sheet visual pass, synthetic $IDX symbols, VoiceOver semantics.

## Phase 11 — wave 2: the action-point crawl

`tools/mobile_crawl.py`: the mechanical stand-in for hundreds of testers. It
enumerates EVERY tappable control in every reachable charts-tab state (chart,
each sheet, settings tabs, library, drawing bar, each widget page — phone /
SE / iPad viewports), taps each on a disposable admin account, classifies the
outcome (changed / noop / error / neterr / left-route / overflow / crash /
skipped-destructive), self-recovers between actions, and writes
ledger.tsv + report.md + a screenshot per state. ~720 ledger rows this wave
across three runs.

**Verdict of the crawl:** ZERO real JS errors, zero route escapes, zero
overflow introductions across every tapped control — the shell's logic is
sound. The yield was ergonomic: a 57-item sub-44px tap-target sweep, fixed
in this wave (each verified by re-crawl):
- AI Search page: suggestion chips 28px → 44, settings gear 17px → 44.
- Watchlists chrome: MY LISTS/PREBUILT/COMMUNITY rail 21px → 44, "New
  watchlist" 21px → 44, header action buttons 19px → 40, list rows 31 → 44.
- Theme Tracker period pills 27px → 44.
- Settings modal: tabs 37 → 44, ✕ 29 → 44, template buttons ~25 → 40.
- ƒx sheet MA switches: visual iOS 46×28 kept; hit area grown to standard
  via an invisible pseudo-element.
All coarse-pointer scoped; desktop metrics byte-identical.

**Also learned:** `FREE_PAGES` is now `['/morning-wire']` — the owner
tightened the paywall since CLAUDE.md's "free tier includes Charts" note; a
free account correctly bounces to the Wire with a two-tab bar (crawler runs
as admin). Deferred: VoiceInputButton (36×31) is inline-styled shared J2
code — its bump belongs to a J2 pass, not this branch.

Crawler lessons baked in: one login shared via storage_state (12 rapid
logins trip the auth 429), widget PAGES survive Escape and must be closed by
their back button between states, sheet-state enumeration scopes to the
sheet root, and resource-load failures (the rig's own aborted bars) class as
`neterr`, never `error`.

## Phase 11 — wave 3 (post-ship polish)

Shipped Phases 9–11w2 to production (master `67c8157d9`), then kept crawling:
- **iPad crawl completed clean**: 193 action points, zero findings of any
  class — the two-pane shell holds.
- **Sub-pane indicators verified GOOD on phone** (RSI/MACD probe shot:
  readable ~100px oscillator bands, clean grid) — no fix needed; recorded so
  nobody "fixes" it blind.
- **ƒx badge now counts library indicators too** — it counted only MA slots,
  so a chart running RSI+MACD sub-panes undercounted. An engine instance's
  EXISTENCE is what "enabled" means (chartDefaults instance model), so the
  count is `indicatorInstances.length` + enabled MA slots. Landing rail
  pinned (with a settingsVersion-2 fixture — an unstamped blob runs the v1
  fold and drops raw instances, which the test's first draft rediscovered).
- Queued still: $IDX synthetic-symbol e2e needs real theme data (sandbox has
  none — verify on production once), VoiceOver semantics audit, and the
  VoiceInputButton bump (J2-owned).
