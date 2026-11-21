# The React-free imperative switch: design

Status: DESIGN, nothing built. Branch `docs/imperative-switch-design`, on origin/master 1fe40a6f2c (after
#2268, #2276 and #2278; #2307 is open). Author: the render-cuts / leak agent, 2026-11-20.

## 1. Goal, and the gate it ships on

A symbol switch paints both charts of a linked group **without StockChartBody rendering**. A per-chart
controller writes the new symbol's frame straight into the chart: series `setData` through the render-window
facade, `binder.sync`, the framing, and the per-symbol layers cleared. The React render of StockChartBody and
its ~100 switch-keyed effects still run, but **after the paint**.

Ship gate for every stage that changes behaviour. This is the owner's rule from 2026-11-20, relayed by the
coordinator:

- **pixels_both** (presentation time, the canary's stamp) is equal or faster than production.
- The core grid shows no cell worse than the production baseline.
- The 150-switch heap soak stays flat (`srh-heavy1.json` is the reference, about 400 MB).
- The strict closure-chain rail stays green.

Every PR carries its before/after.

Non-goals:

- Removing the React path. It stays as the fallback and as the post-paint catch-up.
- Changing what a switch shows. Same frame, same data, same framing.
- Timeframe switches. A later stage could take them.

## 2. The switch today (origin/master 1fe40a6f2c)

1. The group's symbol changes (`WorkspaceContext` store, #2235). ChartWidget re-renders with the new request,
   and `useSymbolHandoff` decides when its chart is ready.
2. The linked-group round (`useSymbolHandoff.js`, `groupJoin` / `groupReady` / `_flushRound`, GROUP_SYNC_MS
   150) calls every ready member's `show()` in one task. `show` is `setDisplayedSym(requested)`.
3. React renders each member: ChartWidget, then ChartPane, then StockChart (the shell), then StockChartBody.
   That is StockChartBody's whole body: 82 useState, 310 useRef, 86 useMemo, 82 useCallback and the derive
   chain (bars → session → filtered → display → ohlc / close / vol / overlays).
4. The layout effect at StockChart.jsx:15223 runs `updateChart()` before paint. updateChart covers:
   - the series `setData` (through `windowedChart.js`'s facade and its wrappers: bar colours, the volume
     dimmer, price-series colouring);
   - `binder.sync` for the indicators;
   - the markers, price lines and watermark;
   - the framing.
   The readout is refreshed in the same commit.
5. Paint. Then about 100 passive effects keyed on the switch run: fetches, subscriptions, resets, the layers
   that are rebuilt per symbol.

**What is not known yet:** how much of step 3, plus React's own work and the layout reads inside the commit,
sits between the key and the pixels on today's master. The review's 15-25 ms is an ESTIMATE from 8 flips on a
build before #2276, #2279, #2283 and #2278 (the reviewer's message, 2026-11-20). Stage 0 measures it, and
the project stops there if the movable part is small.

## 3. The design

### 3.1 One apply function, two callers

The data-layer half of `updateChart` is extracted into `applyFrame(ctx, frame)`, a module-level function:

- `ctx` holds the chart's refs: chart, the candle / volume / overlay series, the binder, the facade, the
  framing refs.
- `frame` is everything the half needs: candles, volume, closes, overlays, HVC set, indicator inputs, the
  framing plan, the watermark text.

`updateChart` calls it (the React path), and so does the controller. There are never two copies of the series
logic. This addresses the review's divergence risk.

### 3.2 The frame is built by the functions the memos already use

`buildFrame(snapshot, view, recipes)` is pure. It calls the shared derive functions that StockChart's memos and
the neighbour-frames preparer already share: `deriveSession`, `deriveDisplay`, `deriveOhlcBase`,
`deriveClose`, `deriveVol`, `deriveVolMa` and `deriveHvc` in `useNeighborFrames.js`, plus `binder.prepare`'s
filed columns.

Prepared answers are filed under the IDENTITY of the bars array. So for a prepared neighbour the frame is
mostly lookups: no copy, no recompute, the same arrays the React path would reach.

For a cold symbol the same functions compute synchronously, which is the cost the memos pay today, minus React.

### 3.3 The controller

One per chart. It is made by a module-level factory at chart creation and holds refs only (closure-chain rule:
it captures no render).

It exposes:

- `apply(sym, tf)`, which does the following in order:
  1. reads the store snapshot;
  2. builds the frame;
  3. aborts the old symbol's fetches (today's effect 4899);
  4. tells the server-compute lane the new symbol (9268);
  5. runs `applyFrame`;
  6. clears the per-symbol layers;
  7. re-points the developing-bar channel;
  8. sets the refs the crosshair and readout read (`symRef`, `resolvedTfRef`, overlay data: today's 15209);
  9. publishes the applied key.
- `appliedKey` and `subscribeApplied(cb)`. The header, legend and readout islands (#2278) read these, so
  their text changes in the same frame.

### 3.4 The linked-group one-frame rule

The rule is unchanged: every chart of a linked group shows the new symbol in the same frame. It is kept by
construction:

- For a member in imperative mode, the round's `show` IS `controller.apply`.
- `_flushRound` already calls every ready member's `show` in one task, so all members' `setData` calls land
  before the same frame.
- The React commit (`setDisplayedSym`) is then scheduled after the paint, as a low-priority update, so a
  newer switch supersedes it.

A member that cannot take the imperative path (section 3.6) joins the round as today. Its React `show` runs in
the same task, so mixed groups still paint together.

**The trigger is shared with the sync-switch work** (`app/src/hooks/handoffGroups.js`, the other agent's design 3,
approved for /charts). The coordinator made its one decision the switch trigger for both designs:

- The board's `setGroupSym` calls `decideGroupShow(scope, group, sym)` in the key handler. The scope is the board's
  `groupSymsStore`. A chart without a scope (the drill, the terminal) never registers and takes the round only. The
  decision is `{sym, seq, tfs, applied}`, and the round calls `show({sym, tf})` with the tf checked at ready.
- It asks every member's `canShowNow`. For an imperative member, that means the frame builds whole, sources included.
- If every member says yes, it calls each `showDecided(sym, decision, token)` in the same task. An imperative member
  runs `controller.apply` there and returns `'applied'`.
- Any other answer, or a throw, adopts the symbol in render 1, which is still before paint.
- If any member says no, today's path runs (prepare, poll, the 150 ms round), and the round's `show` is
  `controller.apply` for an imperative member.

The stale-render guard keys on the controller's own apply counter (`pendingCommit`), because the round has no
decision `seq`. The deferred commit checks `decisionFor(group)` so that a newer decision supersedes it.

### 3.5 The stale-render guard

Between `apply` and the deferred commit, any React render of StockChartBody (a tick, a hover island, a
settings write) still carries the OLD `sym`. Without a guard, the switch applier (15223) would repaint the old
symbol. So:

- The layout applier and the passive pass skip when `controller.appliedKey` is newer than the render's key.
- The readout islands read the controller's key, not the prop.

A rail pins this (Stage 3c).

### 3.6 Scope: the plain path first

The imperative path covers the case neighbour frames already call `plain`: no replay, override, custom
timeframe, exact date range, session candle or ECON id. Every other case falls back to today's React path. A
census rail lists the fallbacks, so adding a feature to the plain path is a conscious edit.

### 3.7 Per-symbol indicator sources: one paint

These are the sources that belong to the chart's own symbol, so they change on a switch. Module caches already hold
each one per symbol:

- the own daily rows (`ownDailyNeeded`, through `secondaryBars.ensureSecondaryBars(sym, 'D', ...)`);
- the lower-timeframe rows (`useLowerTfSources`, the same cache at the lower tf);
- historical fundamentals (`fundamentalSeries.ensureAllFundamentals`);
- the Market Cap authority;
- the server-lane envelopes (RS line / rating / phases / exit, `serverCompute`).

Today `binder.prepare` hands a neighbour row the CURRENT chart's secondary and lower-tf maps, and a server column only
when its envelope has already landed (`landedEnvelopeFor`). So a near switch can still draw these a frame or more
after the candles. The plan:

1. **`prepareRow` asks the row's own sources** in idle time, ranks ±1 only, one request per source per row, through
   the same `ensure*` entry points the hooks call. The URLs, backoff and in-flight maps stay as they are.
2. **`binder.prepare` gets the ROW's source maps**, built from those caches by the same builders the hooks use.
   It never files a column computed over a pending source, so no empty frame is ever filed.
3. **The controller builds the new symbol's source maps synchronously** from the caches, so `binder.sync` in the
   switch frame draws them.
4. **A switch whose frame is missing a source** (cold, or a source still in flight) holds the old symbol's frame
   until the source lands. It does not paint candles first, so it is still one paint, just later. The wait is capped, as GROUP_SYNC_MS
   caps the group round; Stage 4 measures the wait on a cold switch and sets the cap from that measurement.
5. **Cold supply.** The own daily and lower-tf rows can come from the bar store / device store (the device daily
   frames, #2291) instead of their own URL. Fundamentals and the server envelopes have no device copy, so a cold
   switch of a layout that carries them waits for one request. Measured in Stage 4.

The owner's real layouts are not in the canary harness: it writes its own board (`--set=base` is the four averages;
`--set=mixed` adds bb, vwap, rsi, macd, relative volume and the rs* server set). Which of these sources his layouts
carry is therefore not known from the harness. Stage 0's mixed run measures how late the rs* set draws today on a
near switch.

### 3.8 Leaks

The controller keeps exactly the current frame (the applied arrays), released on the next apply. It is built
outside any render. The strict closure-chain rail (#2307) and the 150-switch soak are the checks at every stage.

## 4. Inventory: what a switch sets off today

Made with an acorn pass over StockChartBody. Every body-level effect's dependency array was followed through
the body's own declarations back to `sym` / `tf`, and each effect body was read for chart writes, framing,
fetches, subscriptions, timers, state setters and ref writes. The full table is Appendix A.

- **148 effects; 106 fire on a switch** (3 of them on every render).
- **36 hook calls are handed a switch-keyed value.**

| class | meaning | effects | hooks |
|---|---|---|---|
| **F** | in the switch frame: done by the controller (`applyFrame` and its pre/post steps) | 16 | 1 |
| **C** | per-symbol layer: CLEARED by the controller in the frame, rebuilt by its React effect after paint | 20 | 11 |
| **I** | chrome: an island reads the controller's applied key, or the effect stays as is | 7 | 0 |
| **P** | after paint, unchanged: fetches / depth, click subscriptions, popup and replay resets, diagnostics, warms | 61 | 24 |
| **X** | every render (no deps) | 2 | 0 |

The F set:

- the two updateChart passes (15061, 15223);
- the framing effects (11639 anchor, 15634 exact range, 15896 focus, 18534 right edge, margins and price lock);
- what runs right after `setData` (15524 layering, 15567 / 15582 recolours, 15602 focus range);
- price-scale mode (16036) and indicator visibility (17136);
- the lane notice (9268), the ref mirror (15209), the fetch abort (4899) and the last price (9501).

The C set covers:

- markers: events, my-trades, desk, journal;
- price lines: alerts, position, desk call, archive reference;
- session tags, comparisons, the index pane and the volume profile;
- the dark-pool bars, the watermark logo and the earnings future-whitespace;
- drawings: the overlay must not show the old symbol's drawings in the new frame.

The indicator-input hooks (secondary / lower-tf / fundamental / market-cap / economic sources, calc frames)
are **P**:

- The owner's rule is ONE paint (coordinator, 2026-11-20). So an indicator whose per-symbol source lands after the
  candles is a second visible paint. That is not allowed on the imperative path, and it is already a defect of
  today's path whenever the source is not cached.
- Stage 4 therefore prepares those sources with the row (section 3.7). The controller draws only when every source
  the frame needs is held.
- The developing-bar channel (useBarSnapshotBars' store subscription) is the one live path that must move in
  the frame. Otherwise the old symbol's ticks could paint onto the new chart.

## 5. Rollback switch (default OFF)

- **Per browser:** `localStorage['uct.imperativeSwitch']`. `'1'` turns it on, `'0'` turns it off, unset
  follows the server.
- **Server:** `CHART_IMPERATIVE_SWITCH` on web, read per request. It is mirrored to the browser by a
  server-written cookie beside the auth payload: the mechanism `lib/chartSpeed.js` already uses for
  `CHART_SPEED_ENABLED`, which never touches the Notebook's first open. It can name a cohort for the
  rollout steps.
- **Kill:** `chartSpeedKilled()` turns it off over everything, like the other chart speed switches.
- **Read once per page load,** so one load never mixes the two paths. Off means exactly today's path: the
  controller is not created.

## 6. Staged plan: one PR per stage, one rail (or more) per stage

| stage | what | rail(s) | ships when |
|---|---|---|---|
| **0** | Measure on master: pixels_both and a CPU profile of a two-chart near and cold switch, split into React render, effects, LWC and layout | none (a measurement) | the movable part (React + effects before paint) is ≥ 10 ms per two-chart switch; otherwise stop |
| **1** | Extract `applyFrame` from updateChart. No behaviour change | a CALL-LOG parity test: every series setData / applyOptions / binder.sync on a switch is identical before/after (D, 60, custom tf, replay, Heikin-Ashi, comparison); the existing StockChart suites + dailyFirstPaintAcceptance | log identical; ship gate |
| **2** | `buildFrame` | for fixtures (prepared and cold), every array of the frame is the memo's array (identity when prepared, deep-equal when cold) | rail green |
| **3** | The controller behind the flag (plain path only, default off) | (a) 0 StockChartBody renders before paint, ≥ 1 after, and the final series log equals the React path's; (b) linked group: every member's setData in one task; (c) a render between apply and commit never repaints the old symbol; (d) every C layer of the old symbol is gone in the frame (series / DOM asserts); (e) neighbour-frame identity hits (no copies); (f) the dev channel ticks only the new key; (g) framing: VISIBLE_RANGE_DRIFT 0, ZOOM_CHANGED 0; (h) strict closure-chain rail + 150-switch soak | flag-on runs pass the ship gate on the canary |
| **4** | Widen: the cold path builds synchronously; per-symbol sources prepared with the row (3.7); census of fallbacks | ONE-PAINT rail: for a near switch with the mixed set plus a lower-tf and a `fund:` fixture, every indicator's first drawn frame is the candles' frame (harness: 0 frames of indicator lag); `binder.prepare` never files a column over a pending source; fallback census rail; the same rails as 3 for cold | ship gate, cold and near; mixed-set lag 0 frames near |
| **5** | Rollout: owner's browser, then a server cohort, then default on | the ship gate on production at each step; 0 page errors in the canary | each step |

## 7. Risks and open questions

- **Two paths.** Mitigated by one `applyFrame` and the stale-render guard. The Stage 1 parity rail is the
  backbone.
- **Order dependence.** Effects that today rely on running after updateChart in the same commit (the
  recolours, layering, focus) move into the controller in the same order.
- **Islands.** They must take their symbol from the controller in the imperative path: header, legend, readout
  (#2278) and the drawings overlay.
- **Per-symbol sources** (section 3.7): one paint means a frame that lacks one waits. Preparing sources costs one
  request per source per neighbour row. That is bounded to ranks ±1, but it is new traffic, and Stage 4 reports it
  beside the ship gate.
- **A held arrow key** can make deferred commits pile up. They are low priority and superseded, but Stage 3
  measures a 30-flip held key as well.
- **Open:** whether to defer the React commit with a transition or a post-paint task. Stage 3 picks by
  measurement.

## Appendix A: every effect and hook a switch sets off (StockChartBody, master 1fe40a6f2c)

Class: **F** in the frame (controller) · **C** cleared in the frame, rebuilt after · **I** island / chrome ·
**P** after paint, unchanged · **X** every render. "Fires on" names one dependency and the root it reaches.

"Fires on" is static: a dependency whose declaration chain reaches `sym` / `tf`. It over-approximates: a value memoised on settings (`cs`, `themeColors`, `rightPadBars`) reaches `sym` through the settings override but keeps its identity across a plain switch, so those effects (interactive toggles, drag tools, axis-label hiding) are **P** and in practice do not run at switch time. Stage 0 records which effects actually run on a measured switch.

| line | hook | fires on | what it does (facts) | class | note |
|---|---|---|---|---|---|
| 4611 | useLayoutEffect | canvasSample<-sym | setState(1) | **I** | legend ink colours |
| 4652 | useEffect | storedScale<-sym | setState(1), refs(1) | **P** | above exists for surfaces whose settings write is MASKED (stored scale never changes there, so this never fire |
| 4715 | useEffect | dpSettingEnabled<-sym, sym<-sym, resolvedTf<-sym | fetch/warm, setState(1) | **C** | dark-pool bars (fetch) |
| 4823 | useEffect | darkPoolBarsLayout<-sym | timer | **C** | dark-pool bar labels |
| 4899 | useEffect | sym<-sym, resolvedTf<-sym |  | **F** | aborts the old symbol's in-flight fetches |
| 4964 | useLayoutEffect | (every render) |  | **X** | every render (desk/news marker layer) |
| 4971 | useEffect | sym<-sym | setState(1) | **P** | so a toggle reaches the feed in the same commit; the feed's answers come back through `_onMetaLanded`. The tra |
| 4972 | useEffect | deskEnabled<-sym | chart-write, refs(1) | **C** | desk call price lines |
| 5152 | useEffect | sym<-sym | setState(1) | **C** | archive reference lines |
| 5538 | useEffect | cs<-sym |  | **P** | noop noop Apply the watermark's placement (position + alignment + hard-centering) to the primitive the INSTANT |
| 5573 | useEffect | sym<-sym, wmLogoEnabled<-sym | refs(1) | **C** | watermark logo for the symbol |
| 5602 | useEffect | wmLogoEnabled<-sym |  | **C** | watermark logo re-apply |
| 6210 | useEffect | sym<-sym, _econId<-sym |  | **P** | Keyed on `sym` — NOT a mount-only effect and NOT a timer. The seed runs during the FIRST render for a newly ty |
| 6226 | useEffect | showExtended<-sym | setState(1) | **P** | handleToggleExtended (the toolbar EXT/RTH button) is defined just below, after handleUpdateChartSettings, and  |
| 6406 | useEffect | legendMode<-sym | setState(1) | **I** | legend hold state |
| 6423 | useEffect | legendMode<-sym | subscribe, setState(1) | **P** | clears and one that sticks on forever after one sloppy drag.   NO `preventDefault`, NO POINTER CAPTURE, NO `st |
| 6449 | useEffect | crosshairMode<-sym | setState(1) | **I** | crosshair hold state |
| 6452 | useEffect | crosshairMode<-sym | subscribe, setState(1) | **P** | (a separate boolean + its own listeners) so the two features are independent — a user can run the legend on 'a |
| 6500 | useEffect | crosshairVisible<-sym, buildCrosshairOpts<-sym | chart-write | **P** | Interactive toggle: apply the crosshair visibility whenever it changes WITHOUT re-running the whole updateChar |
| 7032 | useEffect | cs<-sym | setState(1) | **P** | 2. worse, because the effect re-ran on every theme change, switching theme SILENTLY DISCARDED a colour the use |
| 7271 | useEffect | sym<-sym, resolvedTf<-sym | setState(1) | **P** | The click param a pick consumed: the badge handlers on the same click see the SAME object (the library hands o |
| 7285 | useEffect | rsPickArmed<-sym | subscribe | **P** | The one write, for the pick and for the reset row. A refused value (a date the input's pattern rejects, an ins |
| 7318 | useEffect | sym<-sym, resolvedTf<-sym | timer, setState(5) | **P** | The toolbar API's door onto the same handler (`indicatorFirstAdd`), read at call time: Chart Settings → Indica |
| 7377 | useEffect | storedInstances<-sym | subscribe | **P** | VA2 — `rs_on` / `rs_off_within_60s` / `rs_benchmark` (plan §13), OBSERVED from the stored instance list rather |
| 8401 | useEffect | persistedShowPatterns<-sym | setState(1) | **P** | ── Pattern overlay state (Phase 5 Tasks 1, 3, 4) ── Toggle persists via chart_settings (usePreferences). Local |
| 8413 | useEffect | persistedShowChartIq<-sym | setState(1) | **P** | ── Chart IQ (pattern recognition drawn on the chart; api/routers/chart_iq.py) ── the toolbar switch persists i |
| 8870 | useEffect | cs<-sym | chart-write, refs(1) | **C** | position-tool price lines |
| 9214 | useEffect | (every render) |  | **X** | every render (held-span ladder) |
| 9268 | useLayoutEffect | sym<-sym, resolvedTf<-sym |  | **F** | tells the server-compute lane which symbol/tf the chart is on |
| 9339 | useEffect | _warmingRaw<-sym, sym<-sym, resolvedTf<-sym | timer, setState(2) | **P** | A "warming" answer that never resolves is a symbol nothing carries (a typo, a made-up ticker): the server kick |
| 9355 | useEffect | loading<-sym, _tfSwitchHold<-sym | timer, setState(2) | **P** | Delay the loading skeleton: a fast cache hit (pack / IDB / mem — ~tens of ms) swaps chart→chart before this fi |
| 9367 | useEffect | _idbBasisMismatch<-sym, sym<-sym, resolvedTf<-sym | refs(1) | **P** | Basis-mismatch purge: once a re-based (wrong-basis) IDB entry is detected, the render already falls back to th |
| 9383 | useEffect | loading<-sym | refs(2) | **P** | render where loading settles false — renderable bars OR fatal error both count, so a dead ticker never starves |
| 9455 | useEffect | bars<-sym, barsSettled<-sym |  | **P** | LIVE is the COMPLETE user-facing truth only when BOTH hold: the feed is live AND the rendered bars satisfy the |
| 9501 | useEffect | livePrices<-sym, sym<-sym |  | **F** | last price/change for the price line and header |
| 9757 | useEffect | sessionCandleActive<-sym, sessionFreezeActive<-sym, sessionView<-sym | refs(2) | **P** | gets the price-scale references, sourced straight from the live feed. (sessionPreviewLastBar — the muted-white |
| 9862 | useEffect | filteredBars<-sym, sym<-sym, symbolMeta<-sym | refs(1) | **I** | custom header stats |
| 9898 | useEffect | filteredBars<-sym | refs(2) | **I** | RTH close for PNG export (refs) |
| 9985 | useEffect | earningsEvents<-sym, resolvedTf<-sym, filteredBars<-sym |  | **C** | earnings future-whitespace (extends the time axis) |
| 10124 | useEffect | cs<-sym, sessionBars<-sym, handleUpdateChartSettings<-sym | subscribe, timer, setState(6), refs(1) | **P** | tick a box over a chart that disagreed (B3 Task 11).  A1 (D3): the chord's direction is VISIBILITY — a shown s |
| 10376 | useEffect | cs<-sym | chart-write | **P** | `toggleIndicatorById` is memoised on `[cs, handleUpdateChartSettings]`, both of which are already deps here —  |
| 10496 | useEffect | sessionBars<-sym | timer, setState(3) | **P** | ── Replay auto-advance interval ── |
| 10510 | useEffect | sym<-sym, resolvedTf<-sym | setState(3) | **P** | ── Reset replay when sym/tf changes ── |
| 10580 | useEffect | cs<-sym | chart-write, subscribe, timer, setState(1), refs(2) | **P** | first N indices are the series' own, so the alignment above still holds. ── Hide price-axis labels when the la |
| 10625 | useEffect | filteredBars<-sym |  | **P** | candle-tag effect restores the price tag  eslint-disable-next-line react-hooks/exhaustive-deps Re-evaluate on  |
| 10881 | useEffect | ohlcData<-sym |  | **P** | Publish the DRAWN candle count (see the `onDrawnBarCount` prop). Reported on every change rather than latched  |
| 11114 | useEffect | overlayData<-sym | chart-write | **C** | MA tail opacity (crossfade) |
| 11279 | useEffect | comparisonsKey<-sym, comparisonsData<-sym, filteredBars<-sym | chart-write, subscribe, timer, setState(1), refs(1) | **P** | (switch render cuts, 2026-11-20) EMPTY IS ONE FROZEN ARRAY, and "no comparisons" writes it only when the list  |
| 11514 | useEffect | isIntraday<-sym | subscribe | **P** | Revalidate the closed-bar poll when the tab/window becomes visible or refocuses. The bars SWR uses refreshWhen |
| 11639 | useEffect | anchorIdx<-sym, filteredBars<-sym, resolvedTf<-sym | framing, refs(2) | **F** | anchor-date framing |
| 15061 | useEffect | updateChart<-sym | chart-write | **F** | the passive updateChart pass (skipped when the layout pass ran) |
| 15155 | useEffect | priceFormat<-sym | refs(1) | **P** | A priceFormat can arrive AFTER the price series exists: ChartRender decides a breadth count's whole-number for |
| 15169 | useEffect | rightPadBars<-sym | chart-write, refs(1) | **P** | older LWC Chart Settings → Canvas → Margins → Right margin, live. `rightOffset` is a creation-only option on p |
| 15209 | useLayoutEffect | (every render) | refs(8) | **F** | mirrors symRef/resolvedTfRef/overlay data for the crosshair (must describe the applied frame) |
| 15223 | useLayoutEffect | sym<-sym, resolvedTf<-sym, updateChart<-sym | chart-write, refs(2) | **F** | THE switch applier: updateChart before paint + the off-cursor readout |
| 15306 | useEffect | activeSessionTags<-sym, cs<-sym, sessionTagsIntraday<-sym |  | **C** | session tags (Pre/Post chip, RTH close) |
| 15342 | useEffect | sessionTagsIntraday<-sym, showExtended<-sym | chart-write, subscribe | **C** | session tag live mirror |
| 15380 | useEffect | sessionExtChipOn<-sym, sessionExtTagIdx<-sym, cs<-sym | subscribe, refs(1) | **C** | extended-session chip |
| 15491 | useEffect | sessionTagsActive<-sym, intradayExtTagActive<-sym, cs<-sym | chart-write | **C** | native last-value tag suppression |
| 15524 | useEffect | updateChart<-sym, resolvedOverlays<-sym |  | **F** | candle-above-overlay layering after setData |
| 15567 | useEffect | fadedOhlc<-sym, goldOhlc<-sym, ohlcData<-sym | chart-write, refs(1) | **F** | gold setup-day recolour after setData |
| 15582 | useEffect | fadedVolData<-sym, updateChart<-sym | chart-write | **F** | volume crossfade re-tint after setData |
| 15602 | useEffect | ohlcData<-sym | chart-write, refs(1) | **F** | focus price-range provider |
| 15634 | useEffect | filteredBars<-sym, sym<-sym, resolvedTf<-sym | chart-write, framing, timer, setState(2), refs(10) | **F** | exact-range framing / slice |
| 15886 | useEffect | sym<-sym, resolvedTf<-sym | refs(1) | **P** | Each stock starts at the year view with setup text hidden; the first focus zoom then eases it in. Without this |
| 15896 | useEffect | filteredBars<-sym, sym<-sym, resolvedTf<-sym | chart-write, refs(5) | **F** | focus zoom framing |
| 16036 | useEffect | effectiveScale<-sym, compareForcesPct<-sym, indexPaneSeries<-sym | chart-write | **F** | price-scale mode (normal/log/%) |
| 16058 | useEffect | comparisonSeries<-sym, comparisonsData<-sym, filteredBars<-sym | chart-write, framing, timer | **C** | comparison overlays add/remove |
| 16165 | useEffect | hideBase<-sym, ohlcData<-sym, overlayData<-sym | setState(2) | **C** | group-only base visibility |
| 16194 | useEffect | indexPaneSeries<-sym, indexPaneMaSeries<-sym, indexMaColor<-sym | chart-write, refs(3) | **C** | index comparison pane |
| 16360 | useEffect | indexPaneSeries<-sym, showVolume<-sym | subscribe, timer, setState(2) | **P** | Track the price pane's on-screen box so the annotation/callout overlays align to it when the index pane shifts |
| 16398 | useEffect | indexPaneSeries<-sym, showVolume<-sym | subscribe, timer, setState(2) | **P** | Track the INDEX pane's on-screen box (same approach as the price-pane overlayBounds above, but measuring the i |
| 16445 | useEffect | enabledComparisons<-sym, comparisonsData<-sym | chart-write, subscribe | **C** | comparison live ticks |
| 16722 | useEffect | ohlcData<-sym, overlayData<-sym, cs<-sym |  | **I** | off-cursor legend refresh |
| 16757 | useEffect | sym<-sym | timer, setState(2) | **I** | live legend ticking |
| 16793 | useEffect | liveUpdates<-sym, sym<-sym | timer, setState(1) | **P** | "Pre" tag / volume pane show; it's safe to call from an effect.  Gated hard so we never poison the store with  |
| 17136 | useEffect | cs<-sym, resolvedOverlays<-sym, resolvedTf<-sym | chart-write, setState(1) | **F** | indicator series visibility |
| 17195 | useEffect | themeColors<-sym | chart-write, subscribe, setState(1), refs(2) | **P** | not ready Press-drag A→B: dashed line on a transient canvas + a cursor-following % / bars / time readout. Free |
| 17281 | useEffect | themeColors<-sym | chart-write, subscribe, setState(2), refs(1) | **P** | ── Custom-Period Sort: drag to highlight a time period ─────────────────────── Plain left-drag while `periodSe |
| 17470 | useEffect | cs<-sym | chart-write, subscribe, timer, refs(2) | **P** | Mirrors the Shift+drag measure: listens on the chart container so it works over empty chart space (the drawing |
| 18291 | useEffect | showVolLegend<-sym, pinPaneLegend<-sym | subscribe, setState(4), refs(1) | **P** |  |
| 18534 | useEffect | bars<-sym, sym<-sym, resolvedTf<-sym | chart-write, framing, subscribe, timer, setState(1), refs(9) | **F** | right-edge framing, margins, manual price lock on new bars |
| 18830 | useEffect | rsPickArmed<-sym | subscribe, setState(1), refs(2) | **P** | gone ── UCT RS 3-09: the armed pick's click (a mouse click or a touch tap) ── Subscribed only while a pick is  |
| 18853 | useEffect | showNews<-sym, resolvedTf<-sym | subscribe | **P** | gone subscribe to all clicks and match the clicked time against news markers with a tolerance of half a bar. O |
| 18906 | useEffect | deskEnabled<-sym, resolvedTf<-sym | subscribe, setState(1) | **P** | NAVIGATION: StockChart has NO router context — it renders inside popups and the Model Book, and its own suites |
| 18936 | useEffect | earningsEvents<-sym | setState(1) | **P** | ── Earnings marker click → themed earnings popover ── Same time-match approach as news markers (LWC has no mar |
| 18937 | useEffect | cs<-sym | subscribe, setState(1) | **P** | ── Earnings marker click → themed earnings popover ── Same time-match approach as news markers (LWC has no mar |
| 18972 | useEffect | alertLineOpts<-sym |  | **C** | price-alert lines |
| 18979 | useEffect | myTrades<-sym, mergedMarkers<-sym | chart-write, refs(2) | **C** | my-trades + event markers |
| 18990 | useEffect | _myTradesOn<-sym | subscribe | **P** | series gone Chart Settings → My trades: hovering one of its markers shows "Bought 100 @ 12.34 · <date time>" ( |
| 19013 | useEffect | _nextEarnOn<-sym | subscribe | **P** | chart gone Chart Settings → Next earnings date: hovering the chip shows "Next earnings · <date>" as the chart' |
| 19035 | useEffect | sym<-sym, resolvedTf<-sym | setState(1) | **P** | chart gone Close the earnings popover when the symbol or timeframe changes out from under it. |
| 19041 | useEffect | ipoEvent<-sym | setState(1) | **P** | Close the earnings popover when the symbol or timeframe changes out from under it. ── IPO badge click → "First |
| 19042 | useEffect | cs<-sym | subscribe, setState(1) | **P** | Close the earnings popover when the symbol or timeframe changes out from under it. ── IPO badge click → "First |
| 19069 | useEffect | sym<-sym, resolvedTf<-sym | setState(1) | **P** | just to the right of the badge above the badge (tag ~28px + gap) |
| 19097 | useEffect | highlightTimeMap<-sym, resolvedTf<-sym | framing, subscribe, timer, setState(1) | **P** | ── Highlighted setup/catalyst candle click → onHighlightClick (Model Book) ── Clicking a painted setup/catalys |
| 19147 | useEffect | cs<-sym, filteredBars<-sym | subscribe | **C** | volume-profile canvas |
| 19193 | useEffect | sym<-sym, resolvedTf<-sym, _overlayActive<-sym | timer, setState(1) | **P** | Viewport-first backfill (Phase 2): while at the shallow first-paint depth, bump to the full target when the us |
| 19238 | useEffect | sym<-sym, resolvedTf<-sym | subscribe, timer | **P** | 2026-11-13 — THE VIEW CAME NEAR THE START OF THE INDICATOR WINDOW: DRAW EVERY ROW. (`chart/engine/plotWindow.j |
| 19276 | useEffect | _histPrependOn<-sym, sym<-sym, resolvedTf<-sym | timer | **P** | Native intraday scroll-back: load the next LEFT window while the visible left edge is still LOOKAHEAD_SCREENS  |
| 19314 | useEffect | sym<-sym, resolvedTf<-sym, _overlayActive<-sym | timer, setState(2) | **P** | history is already there. Server SQLite caches it once for everyone.  ALL timeframes warm (intraday included)  |
| 19347 | useEffect | _wantsListingDeepen<-sym, sym<-sym, resolvedTf<-sym | setState(1), refs(2) | **P** |  |
| 19359 | useEffect | loading<-sym, bars<-sym | refs(1) | **P** | a shallow answer SHORTER than it asked for is already the whole history |
| 19458 | useEffect | sym<-sym, resolvedTf<-sym | setState(2) | **P** | ── Clear drawing selection on symbol/tf change ── |
| 19597 | useEffect | filteredBars<-sym, isValidating<-sym, barCount<-sym | setState(1), refs(2) | **P** | Finish a pending nav: wait for the full history to actually LAND — not just for the requested depth flag to fl |
| 19936 | useEffect | barCount<-sym, isValidating<-sym |  | **P** | noop |

| line | hook handed a switch-keyed value | class | note |
|---|---|---|---|
| 4216 | useEconomicPrimary | **P** | ECON ids: React path only (fallback) |
| 4932 | usePriceAlertRows | **C** | alert lines: cleared in frame, redrawn after |
| 4943 | useMyTradeFills | **C** | trade markers |
| 4952 | useSymbolResource | **C** | markers / news / desk feeds |
| 4953 | useSymbolResource | **C** | markers / news / desk feeds |
| 4954 | useSymbolResource | **C** | markers / news / desk feeds |
| 5059 | useJ2ChartMarkers | **C** | journal markers |
| 5098 | useSignatureIndicators | **P** | signature overlays |
| 8420 | useChartIq | **C** | Chart IQ overlay |
| 8455 | usePatternDetections | **C** | pattern overlay |
| 8473 | useChartSetups | **C** | UCT Intel setups |
| 8713 | useChartDrawings | **C** | drawings: the overlay must not show the old symbol's drawings in the new frame |
| 8748 | useBoundDrawingAlerts | **C** | drawing alerts |
| 9222 | useSecondarySources | **P** | indicator inputs (other symbols / held span): binder syncs with what is held; the rest lands after paint |
| 9227 | useOtherSymbolExchanges | **P** | indicator inputs |
| 9231 | useLowerTfSources | **P** | indicator inputs |
| 9241 | useFundamentalSources | **P** | indicator inputs |
| 9244 | useMarketCapAuthority | **P** | indicator inputs |
| 9249 | useEconomicSources | **P** | indicator inputs |
| 9306 | useChartBars | **F** | the bar source: the controller reads the same store snapshot |
| 9416 | useChartRealtimePrices | **P** | quiet live prices (#2276) |
| 9472 | useLegacyGapWatchdog | **P** | legacy watchdog |
| 9764 | useSessionExtBars | **P** | session candle (React path only: fallback) |
| 9890 | useCalcFrames | **P** | indicator inputs |
| 10079 | useStrategyHistoryWindow | **P** | strategy window |
| 11101 | useNeighborFrames | **P** | prepares the next rows after paint; the controller CONSUMES what it filed |
| 11212 | useSWR | **P** | comparison / misc fetches |
| 11356 | useSWR | **P** | comparison / misc fetches |
| 11381 | useSWR | **P** | comparison / misc fetches |
| 11489 | useLegacyLiveReset | **P** | legacy writer, inert under BARSTORE |
| 11490 | useLegacyWriterA | **P** | legacy writer, inert under BARSTORE |
| 11500 | useLegacyPushWriterB | **P** | legacy writer, inert under BARSTORE |
| 15145 | useLegacyHeldPushFold | **P** | legacy writer, inert under BARSTORE |
| 15482 | useLegacyCustomTfF | **P** | legacy writer, inert under BARSTORE |
| 16752 | useLegacyDailyTickE | **P** | legacy writer, inert under BARSTORE |
| 19464 | useLegacyRegistryWriterC | **P** | legacy writer, inert under BARSTORE |
