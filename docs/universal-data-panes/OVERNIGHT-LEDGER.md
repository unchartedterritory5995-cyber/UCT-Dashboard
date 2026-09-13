# Universal Data Panes — overnight engineering ledger

Engineering state only. No secrets, no credentials, no member data, no database
contents. Dev-only document; nothing here is loaded at runtime.

**Recovery drill:** `git status` → read this file → `git show <LAST KNOWN GOOD>` →
continue at NEXT AUTHORIZED ACTION. Never reconstruct from chat history.

Worktree: `C:\w\p2`. Run tests and builds from `C:\w\p2\app`.

### Procedures a fresh session needs

**Tests / build** (from `C:\w\p2\app`): `npx vitest run <path>` for focused,
`npx vitest run` for the full suite, `npx vite build`.

**Safe browser proof.** Start `npx vite --port 5173 --strictPort` from
`C:\w\p2\app`, open `http://localhost:5173/pane-harness.html`. It mounts the real
`StockChart`, the real `IndicatorLibraryDialog` and real bars off `:8000`, and it
severs `/api/auth/preferences` both ways so it cannot reach a stored preference.
⛔ Never use Main Trading, and never open `/charts` for this — opening it RESTORES
and rewrites the preference.

**Main Trading fingerprint — READ-ONLY, never via the browser:**

```bash
python3 - <<'PY'
import sqlite3, hashlib
con = sqlite3.connect('file:C:/data/auth.db?mode=ro', uri=True, timeout=3)
for uid, v in con.execute(
        "select user_id, pref_value from user_preferences where pref_key='chart_settings'"):
    b = v.encode('utf-8') if isinstance(v, str) else v
    if str(uid).startswith('40d361fa'):
        print(str(uid)[:8], len(b), hashlib.sha256(b).hexdigest()[:12])
con.close()
PY
```

Expected, unchanged: `40d361fa 5354 ea9ebaeee302`.

**Baseline comparison.** To prove a failure pre-exists, add a throwaway detached
worktree at the base commit and junction `node_modules` into it rather than
reinstalling:

```bash
git worktree add --detach C:/w/p2b 735704fd7
cmd /c mklink /J "C:\w\p2b\app\node_modules" "C:\w\p2\app\node_modules"
# …run the suspect files there, then:
git worktree remove --force C:/w/p2b
```

---

## OVERNIGHT SESSION — 2026-09-12 / 13

### CURRENT PHASE
Overnight slice 2 — Universal Data Panes completion pass (the trader workflow,
end to end, in the browser).

### CURRENT STATUS
Slice 2 (completion pass) substantially complete and checkpointed. Three defects
found by walking the workflow, all fixed and railed.

### BRANCH
`feat/universal-data-series`

### HEAD
`152042d5f`

### LAST KNOWN GOOD COMMIT
`152042d5f` — fix(chart): a pane move invalidates the heights applied after it.
(Base of the whole branch: `735704fd7`.)

Checkpoints, newest first:
- `152042d5f` pane order/height convergence after a single move
- `4e1680780` direct series reads as itself; duplicate rows told apart
- `76d98c035` ledger
- `7fa4d70f9` slice 1 — Rulings A and B, plus direct-series naming and the
  source-control fix
- `ca8c7a80f` / `692ed9c83` this ledger
- `d1d66c7a8` P2.0c → P2.3 and the multi-pane scale fix

### WORKING TREE STATUS
Clean at the time of writing.

---

### COMPLETED (this checkpoint)
- P2.0c instance-hosted pane identity — a pane is keyed by its HOST INSTANCE, so
  two RSIs on Own Pane are two panes. Pane keys derived every paint, never
  persisted; no migration.
- P2.1 catalogue facade (`discoveryCatalog.js`) + generic `dataSeries` definition
  whose compute is the identity and whose source family is invisible to it.
- P2.2 Add to Chart — symbols and breadth as rows in the existing
  `IndicatorLibraryDialog`. One shell, one search, one persistence path.
- Multi-pane price-scale fix — `MAIN_TOP` headroom is a fraction of pane 0's own
  height, not of the whole chart budget. Fixed a −400…2,400 price axis at four
  panes.
- P2.3 multi-series pane composition — the existing Display In control offers the
  panes other instances host.
- P2.3 defect: `validateInstance` rejected a stored `@<hostInstanceId>` target,
  which DROPPED the instance and let legacy derivation recreate a different
  indicator against the wrong instrument. Validator widened; renderer-level rail
  added.

**Slice 1 (`7fa4d70f9`) — Rulings A and B**
- Ruling A: a guest whose host was deleted keeps its placement, draws nothing,
  and the settings control STATES it — a disabled "Pane unavailable" entry plus
  one line of explanation. Nothing is written during render.
- Ruling B: ordinals are scoped to the colliding LABEL, so `QQQ #1` / `QQQ #2` /
  `SPY` — never `SPY #3`.
- `disambiguateLabels` extracted in `readout.js`; the legend, the Display In menu
  and the settings rows all call it over the same population, so the three
  surfaces cannot word an instance differently.
- A direct series' settings row is named after its instrument, not "Data Series",
  and its category badge is suppressed. Gated on `meta.labelFrom`, not on an id.
- The Source control passed three arguments to `sourceOptions` and so could not
  represent its own value: every direct series read "Source unavailable" over a
  valid `sym:…` source. Fixed; a severed source still reads unavailable.

**Slice 2 — completion pass (`4e1680780`, `152042d5f`)**
- Walked the member workflow end to end in the harness: add QQQ/SPY/UCTA50/RSI
  through the real Add-to-Chart dialog, compose, separate, duplicate, hide/show,
  restyle, move above/below, delete, re-add, reconstruct.
- Defect 1 — the Source picker read `QQQ → Series`. The passthrough's plot label
  is now `Value`; `meta.shortName` stays `Series` for a series over an instance
  source.
- Defect 2 — two RSIs produced two settings rows both reading "Relative Strength
  Index" while their chips read `#1` / `#2`. Row labels now run through
  `disambiguateLabels` too.
- Defect 3 (the significant one) — sending a pane ABOVE Price and back BELOW left
  the oscillator in the tall pane and the candles crushed to ~30 px.
  `reconcilePaneOrder` reported "more moves owed" rather than "a move happened",
  so the pass that issued the LAST move sized the stack in the same frame, before
  `moveTo` had landed. Now `owed > 0`.
- Verified: request dedup (two QQQ instances → exactly one `/api/bars/QQQ`),
  pane order after hide/show, delete leaves no zombie pane, re-add mints a NEW
  instance rather than resurrecting a tombstone, round-trip through the migrator
  is identical, six panes plus price all on independent correct scales.

### IMPORTANT DECISIONS
- Pane sharing persists as `placement.target = "@<hostInstanceId>"` on the GUEST.
  No pane ids are minted or persisted, ever.
- SOURCE ("what data is this?") and PRESENTATION ("where do I draw it?") stay
  absolutely separate. Deleting a visual host never touches a canonical symbol
  source.
- Definitions remain restricted to the three static placement targets
  (`price|pane|volume`); only INSTANCES may carry `@host`.
- A missing pane target is shown WITHOUT a name, because the tombstone carries
  none. Naming it would require widening `instanceTombstone`, which is a
  persistence decision and contradicts that helper's stated design. STOPPED —
  see PRODUCT QUESTIONS.
- P2.0c→P2.3 committed as ONE checkpoint: the phases share files and only the
  combined state was ever tested end to end. A per-phase split would have been
  history that was never verified.

### TEST EVIDENCE (at `152042d5f`)
- Focused: `paneComposition.test.js` 22 pass; `readout.test.js` 34 pass;
  `ChartSettingsModal.indicators.test.jsx` 39 pass; `stockChartWiring.test.jsx`
  218 pass (includes the 3 renderer-level P2.3 rails).
- Bite-checks: reverting Ruling B's grouping → 7 red; removing the missing-target
  entry → 2 red; removing the self-target guard → 1 red; narrowing the instance
  validator → 2 red.
- Broader: full frontend suite **19,559 pass / 16 fail / 9 skipped**.
- Build: `vite build` clean; dev harness absent from `dist`.
- Browser: harness at `/pane-harness.html` — QQQ+MA(QQQ) one pane (715.44 /
  714.88), QQQ+SPY one pane, SPY back to Own Pane, UCTA50+MA(UCTA50), duplicate
  QQQ independently targetable (`QQQ #1` / `QQQ #2`), RSI hosting QQQ, host
  deletion, save→unmount→reconstruct round-trip.

### KNOWN PRE-EXISTING FAILURES (16 — proven identical at base `735704fd7` in a
throwaway detached worktree)
- `ast/pine.blindCorpus` accepted-floor ratchet
- `ast/manifestProse` `_session` key
- `ChartToolbar.flipB` generated dialog (7)
- `pollingSites.rail` census (floor2, useFilingWatch, useWatchlistIntelligence,
  useBoundDrawingAlerts)
- `styles/tapFloor` (journal-2.0 CaptureDialog CSS)
- `utils/modalOpen` (`ConditionAlertPopover.jsx`)
- `ChartDrawingOverlay.surfaces` source-proximity rail
- `ThemeTrackerPage.chartmount` (2)
- `__tests__/sourcesAreText` — 8 control bytes in `binder.js`, byte-identical to
  base, merely shifted

Also pre-existing: one eslint `no-unused-vars` on `legendTextOf` in
`stockChartWiring.test.jsx` (reproduces at base).

### NEW REGRESSIONS
None.

### MAIN TRADING
Never opened. Verified READ-ONLY from `C:/data/auth.db` (`mode=ro`), preference
`chart_settings` for user `40d361fa…`: **5,354 bytes, sha256 `ea9ebaeee302`** —
the frozen fingerprint, unchanged.

### BACKEND
`:8000` is the main repo's `uvicorn api.main:app --reload` (APScheduler). Healthy,
untouched, must not be closed or restarted. `:5188` belongs to worktree `C:\w\wm`
— foreign, untouched. `:5173` is mine; started and stopped as needed.

### DEFERRED / BLOCKED
- Secondary-symbol OHLC/candles — NOT tonight. The binding model is one plot → one
  column; candles need coordinated OHLC fields. Next-architecture work.
- Historical fundamentals — blocked on PIT-safe history.
- `/api/bars` entitlement question — RELEASE BLOCKER, recorded, not solved. No new
  exposure created by this work.
- Legend chip for a stale breadth symbol shows no value when its last canonical
  bar predates the chart's last bar (UCTA50 to 2026-08-24 vs AAPL to 09-11). This
  is exact-`t` alignment with no forward fill, working as designed.

### PRODUCT QUESTIONS FOR BLAKE
1. **Naming a missing pane host.** Ruling A asked for `QQQ (missing)`. The host's
   name is genuinely unrecoverable: `instanceTombstone` is `{instanceId,
   deleted: true}` and its own comment says a delete must not keep the user's old
   settings in the blob. Shipped the truthful nameless form, "Pane unavailable".
   To get the name back, the tombstone would have to carry a display label — a
   persistence change, deliberately not taken.

### OBSERVATIONS, NOT FIXED (deliberate)
- `/api/ticker-search` returns `type: "stock"` for QQQ and SPY, so the library row
  badge reads STOCK for an ETF. That is the backend's own answer; inventing a
  security-type source would be fabricating. Recorded, not patched.
- Adding a second overlay moving average yields two settings rows both reading
  "SMA 50". Overlays are positional fixtures, not engine instances, so tonight's
  disambiguator does not reach them; the collision self-resolves the moment the
  member changes either period. Left alone.
- The engine MA's catalogue name is "Moving Average (Source)". Renaming a shipped
  indicator is a product decision, not an implementation one.

### NEXT AUTHORIZED ACTION
Optional continued LOW/NORMAL-RISK polish of already-built chart systems
(indicators UX, conditions UX, formula-builder UX presentation), or stop. The
Universal Data Panes workflow itself is verified end to end.

### STOP CONDITIONS
None active.

---

## CHART UX CONSOLIDATION PASS — 2026-09-13

### CURRENT PHASE
Indicators / Conditions / Formula Builder UX consolidation.

### CURRENT STATUS
Complete and checkpointed.

### BRANCH / HEAD / LAST KNOWN GOOD
`feat/universal-data-series` @ `3f870e51a` — polish(chart): one naming language
across indicators, conditions and the builder. Previous good: `74387148e`.

### WORKING TREE STATUS
Clean at the time of writing.

### COMPLETED
- **Indicators.** An ACTIVE row is now named the way the chart names it, so the
  list reads `EMA 9`, `SMA 50`, `RSI (14)`, `RSI (7)`, `MA (5)`, `QQQ` — one
  language with the legend, the Display In menu and the source picker. Gated on
  the definition already parameterising itself (`legendParams` / `labelFrom`), so
  `Session VWAP` keeps the name that distinguishes it from the anchored one, and
  the BROWSE catalogue is untouched.
- **Conditions.** A collapsed row names what it draws (`Candle colour · Marker`)
  instead of counting actions; zero actions reads `No action yet`. The starter
  "＋ Add" chips no longer wrap — measured before at 25/37/25 px tall, now
  identical.
- **Formula Builder.** The Name example follows the consumer: `20-bar average`
  for an indicator, `Trend up` for a condition, `Distance to 20-day` for an info
  value.
- Two test files added where there were none: the Conditions tab had no component
  test at all, and the builder had no case holding its copy to its consumer.

### DELIBERATELY NOT CHANGED
- Validation messages are already member-readable ("Expected expression after >
  at character 7", with Copy diagnostic). §11 needed nothing.
- Display In is exactly as P2.3 left it.
- No parser, AST, evaluator, truth, first-match, action meaning, alert durability
  or persistence was touched.

### TEST EVIDENCE (at `3f870e51a`)
- Focused: `ChartSettingsModal.conditions.test.jsx` 6 pass (new);
  `BuilderSheet.consumerCopy.test.jsx` 4 pass (new);
  `ChartSettingsModal.indicators.test.jsx` 41 pass; `builder/` 1,613 pass.
- Bite-checks: reverting the action summary → 5 red; reverting the Name example →
  2 red.
- Broader: full frontend suite **19,569 pass / 16 fail / 9 skipped** — the same
  16 baseline failures, unchanged in name and count.
- Build: `vite build` clean.
- Browser: the harness now also mounts the real `BuilderSheet` for all three
  consumer kinds (dev-only; the product's single `/charts` mount in
  `ChartToolbar` is what `BuilderSheet.test.jsx` parses, and is untouched).

### MAIN TRADING
Never opened. `40d361fa…` → 5,354 bytes, sha256 `ea9ebaeee302`, unchanged.

### BACKEND
`:8000` untouched and healthy. `:5188` is worktree `C:\w\wm` — foreign, untouched.
A `stash@{0}` from `feat/app-themes` exists and belongs to another session — not
mine, not touched.

### PRODUCT QUESTIONS FOR BLAKE
1. **The plain-English box asks the wrong question for a condition.** The sheet
   titled "New condition" is headed *"Describe the indicator in plain English"*,
   because `ConciergeBox`'s `kind` is chosen by BUILD MODE
   (`buildMode === 'picker' ? 'scan' : 'indicator'`), not by `consumerKind`. The
   copy and the server request are one decision: fixing the words alone would
   make them disagree, and changing the request changes what the server is asked
   for. Left as-is and reported rather than guessed.
2. Carried forward, unchanged: naming a missing pane host would need tombstone
   metadata; `/api/ticker-search` reports `type: "stock"` for ETFs; two overlay
   moving averages can both read `SMA 50` (positional fixtures, outside the
   instance disambiguator, self-resolving on any period edit).

### NEXT AUTHORIZED ACTION
Blake's call. Not started: OHLC/candles for secondary symbols (deliberately —
one plot → one column vs coordinated OHLC fields is an architecture review).

### STOP CONDITIONS
None active.

---

## CONCIERGE CONSUMER CONTRACT — 2026-09-13

### STATUS
Complete and checkpointed. `feat/universal-data-series` @ `719b94d22`
(previous good `dbf762445`). Tree clean.

### WHAT `indicator` AND `scan` ACTUALLY MEAN
Traced through `ConciergeBox` → `POST /api/user-definitions/propose` →
`api/routers/user_definitions.py` → `api/services/definition_concierge.py`:

- `KINDS = ("indicator", "scan")`. An unrecognised kind refuses at `kind:unknown`.
- `_KIND_BRIEF[INDICATOR_KIND]`: "an INDICATOR: a column of numbers drawn on a
  chart" — the numeric/series contract.
- `_KIND_BRIEF[SCAN_KIND]`: "the tree must be a yes-or-no CONDITION… An
  expression that produces a price or an average is an indicator, not a screen".
  ⭐ This is GATED, not hinted: `_validate` raises `scan:not-a-condition` unless
  `scan_definition.is_boolean_tree(tree)` agrees.
- The success payload is byte-identical in shape for both kinds
  (`ok/ast/source/sentence/repaint/freshness/cadence/kind/concepts/terms/…`).
  Nothing in it is screener-specific; `freshness` and `cadence` are derived facts
  about the tree.
- `_validate` runs `interpret(tree, bars)` for BOTH kinds and refuses
  `compute:empty`, so every proposal is already computed over the chart's bars.

### MAPPING (proven, then implemented)
| consumer | request kind | why |
|---|---|---|
| `indicator` | `indicator` | numeric column; unchanged |
| `condition` | `scan` | the boolean contract, gated by `is_boolean_tree` |
| `infoValue` | `indicator` | wants a number; a boolean is refused downstream |

No third server kind was invented. The criteria picker still sends `scan`
regardless of consumer, which is what the screener's own mount relies on.

### CHART-EVALUABILITY
Already protected, in two places, both pre-existing:
1. Server — `_validate` interprets every proposal over the bars it was sent.
2. Client — `consumerAdapters.validateFor` runs `chartEvaluability(ast)` for
   `condition` and `infoValue`. Its own comment names this case: a screener
   scalar is NaN on every bar, "the picker hides those columns; this is the gate
   that means a formula arriving by any OTHER door cannot slip past". The
   concierge is one of those doors. No second validator was added.

### IMPLEMENTATION
`ConciergeBox` gains `copyKind` — vocabulary only, never sent — and `KIND_COPY`
gains `condition` and `infoValue` entries. `BuilderSheet` derives both from one
place: `conciergeRequest` (contract) and `conciergeCopy` (words). The screener
path is byte-unchanged: default consumer + picker mode still asks for `scan` and
still reads "Describe the screen in plain English".

### EVIDENCE
- Focused: `BuilderSheet.consumerCopy.test.jsx` 12 pass — copy AND request for
  all three consumers, plus the downstream `validateFor` refusals including a
  screener scalar. Bite-checked: reverting the request mapping → 1 red.
- `src/components/chart/builder` 1,617 pass.
- Full frontend suite **19,577 pass / 16 fail / 9 skipped** — the same 16.
  ⚠️ One run showed 17: `journal-2-0/.../CaptureHost.test.jsx` "closing returns
  the dialog to nothing" (an Escape-key race). It passes alone and did not recur;
  unrelated to this work. Worth knowing it is flaky under load.
- Build clean.
- Browser: all three consumers checked in the harness — title, concierge label,
  placeholder, Name example, `data-kind` vs `data-copy-kind`, and the OUTGOING
  REQUEST BODY captured via a local fetch intercept (no model call, no spend):
  `indicator`, `scan`, `indicator`. No "screen" wording anywhere on a chart
  consumer. Console clean.

### MAIN TRADING
Never opened; `40d361fa…` → 5,354 bytes, `ea9ebaeee302`, unchanged.

### REMAINING ARCHITECTURAL QUESTION
None from this investigation. The existing contracts already expressed the
correct semantics, which is why nothing new was created.

### NEXT AUTHORIZED ACTION
Blake's call. Still not started, deliberately: OHLC/candles for secondary
symbols.

---

## SECONDARY OHLC — PHASE A — 2026-09-13

### STATUS
Complete and checkpointed. `feat/universal-data-series` @ `8da12905e`
(previous good `1abb4f450`). Tree clean. Engine capability only — no
member-facing Candles, no persisted field, no product row.

### THE PAYLOAD CONTRACT
`columns` stays `Map<bindingKey, …>`; the VALUE is now a `Float64Array` **or**
`{ kind: 'ohlc', bars }`. Tagged, never sniffed. New/changed seams:
- `engine/ohlcCapability.js` (new) — structural + semantic capability, pure,
  injected family oracle, fails closed.
- `engine/symbolProjection.js` — `clipBarsToDomain` / `clippedBarsFor`: the
  secondary's OWN bars intersected with the chart's time domain, memoised in the
  same WeakMap shape as `projectionFor`.
- `engine/binder.js` — `ohlcPayload` / `isOhlcPayload` / `toOhlcPoints`,
  `pointsFor` dispatch, `hasData` second shape, `lastPointValue` → close,
  `SERIES_CTOR.candlestick`, one capability answer per instance shared by the
  plan, the style clamp and the payload.
- `engine/pool.js` — `poolKey('candles') → 'candlestick'`, candle options branch,
  `planBindings(..., { ohlcCapable })`.
- `engine/presentation.js` — `candles` recognised and mapped, NOT in
  `PLOT_STYLE_CHOICES`; `availableStyles` requires `ctx.ohlcCapable`;
  `resolvePlotStyle(instance, plot, ctx)` clamps for the renderer too.
- `hooks/useBreadthSymbols.js` — `symbolFamily` / `breadthRegistryReady` /
  `loadBreadthSymbols`, synchronous and fail-closed.
- `StockChart.jsx` — passes `ohlcFamilyOf: symbolFamily`, and `engineLwc()` now
  carries `CandlestickSeries`.

### WHAT PHASE B MUST NOT REDO
- No `sym:QQQ:ohlc`; no public `open`/`high`/`low` formula refs.
- Compute never receives an OHLC payload.
- Breadth is not candle-capable; the gate is the provider family, not fields.
- Intersection, not union, for timestamps.

### EVIDENCE (at `8da12905e`)
- Focused: `__tests__/ohlcBinding.test.js` 18 pass; `binder.test.js` 73 pass
  (4 new renderer cases); `perOutputPresentation` 34 pass.
- Bite-checks: removing the semantic family gate → 2 red (breadth admitted);
  union instead of intersection → 2 red.
- Broader: full frontend suite **19,600 pass / 16 fail / 9 skipped** — the same
  16 baseline failures. Build clean.
- Browser (harness, dev-only style toggle): QQQ candles in Own Pane with real
  bodies/wicks on a 680–760 ladder; `MA(QQQ)` on the same ladder; ZERO extra
  `/api/bars` calls; above → below → back with the price pane intact; console
  clean.

### DEFECT FOUND AND FIXED
`engineLwc()` did not carry `CandlestickSeries`, so `addSeries(undefined, …)`
threw and `attempt` swallowed it — capability yes, payload 400 bars, nothing
drawn. Worth remembering: that object is the whole list of series types the
binder can build.

### MAIN TRADING
Never opened; `40d361fa…` → 5,354 bytes, `ea9ebaeee302`, unchanged.

### NEXT AUTHORIZED ACTION
Phase B — member-facing Candles: offer the style where
`ohlcCapabilityOf(...).ok`, wire `availableStyles`’ `ohlcCapable` from the
settings row, and add up/down/wick/border colour inputs. Persistence already
works (`presentation.plots[key].style`), so Phase B adds no schema.

### OPEN QUESTION (unchanged)
Axis domain for non-US-session secondaries: intersect (today) vs union. Needs a
decision before any 24-hour or foreign-calendar instrument is admitted.

## SECONDARY OHLC / CANDLES — PHASE B (member-facing style + candle colours)

### WHAT SHIPPED
Candles became a style a member can CHOOSE, on the sources that can honestly
wear it, with the two colours that matter. No new widget, no new source type, no
new pane type, no new modal, no new persisted field.

- `presentation.js` — `PLOT_STYLE_CHOICES` gains `{ candles, 'Candles' }`,
  APPENDED; `CANDLE_COLOR_KEYS`; `resolveCandleColors(instance, plot, fallback)`
  walking the same per-output → instance → chart chain as the style and the dot
  size; `DEFAULT_CANDLE_UP` / `DEFAULT_CANDLE_DOWN` as the last resort only.
- `instanceControls.js` — `setInstanceCandleColor`, the `setInstanceDotSize`
  shape exactly: `presentation.plots[plotKey]` when named, instance level when
  not, and DELETE when the colour equals the chart's own.
- `pool.js` — the candlestick branch spends `c.candleColors` on body, border and
  wick together; absent, LWC's defaults, which is what every pre-Phase-B caller
  means.
- `binder.js` — resolves `candleColors` ONLY for a candlestick binding, with
  `ctx.cs.candles` as the fallback, so a secondary instrument wears the member's
  own candle colours until they say otherwise.
- `secondaryBars.js` — `anyCachedBars(symbol)`: the window-agnostic read a
  settings row needs, because a modal knows the instrument and never the chart's
  timeframe. It never fetches.
- `ChartSettingsIndicators.jsx` — one capability answer per row from
  `sourceInputsOf` → `parseSource` → `anyCachedBars` → `symbolFamily` →
  `ohlcCapabilityOf`, passed as `styleCtx` to BOTH `availableStyles` and
  `resolvePlotStyle`; Up/Down colour inputs rendered only while the style is
  candles, writing `single ? undefined : plot.key`.

### THE ONE RULE WORTH RE-READING
**Capability is the gate, not the choice list.** `PLOT_STYLE_CHOICES` now
contains candles for everyone; `availableStyles` decides who is offered it and
`resolvePlotStyle` clamps it for the renderer. A saved chart naming `candles` on
a source that cannot wear them draws a line rather than a lie.

### EVIDENCE
- `ChartSettingsModal.candles.test.jsx` (new) 13 pass; `ohlcBinding` 18 pass;
  `perOutputPresentation` 34 pass. Bite-check: bypassing the capability gate → 2
  red.
- Full frontend suite **19,610 pass / 16 fail / 12 skipped** — the same 16
  baseline failures, same nine files. `vite build` clean, exit 0.
- Browser (harness, real ChartSettingsModal): QQQ offered Candles and drawing
  real bodies and wicks in its own pane; Up candle set to `#00e5ff` measured as
  **4,193 cyan px in the QQQ pane canvas and 0 in the price pane**, while SPY's
  candles in the next pane stayed 3,750 green / 4,436 red — the override is per
  instance. `MA(QQQ)` joined the QQQ candle pane (one legend
  `MA(5) 715.44 · QQQ 714.88`, cyan candles and a yellow line in ONE canvas).
  Below → above → below round-tripped with the price pane intact. UCTA50 was
  offered `[line, histogram, dots, area, lastValueHorizontal]` — no candles.
  A duplicate QQQ became `QQQ #1` (candles, cyan) and `QQQ #2` (line), one
  source and two presentations. Save blob → reconstruct returned style
  `candles` and `#00e5ff`. **One `/api/bars/` request per secondary symbol**
  across all of it. Console: no errors.

### THE MEASUREMENT TRAP THAT COST AN HOUR — WORTH REMEMBERING
Two false alarms, one cause each, and neither was product code.

1. **The pixel scan read the wrong canvas.** Each pane is its OWN canvas. A scan
   of `document.querySelector('canvas')` reads the PRICE pane and reports zero
   cyan while the secondary pane is full of it. Enumerate every canvas and
   report per-canvas counts, or the measurement answers a different question.

2. **A BACKGROUNDED TAB HAS NO ANIMATION FRAMES, and lightweight-charts syncs
   its DOM inside one.** `chart.panes()` reads the MODEL
   (`_internal_model()._internal_panes()`); the `<tr>` per pane is created in
   `_private__syncGuiWithModel`, which runs from the rAF draw loop. On a hidden
   tab the model gains a pane, `addSeries` returns a real series, stretch
   factors are accepted — and NOTHING renders, with no error anywhere. It
   presents exactly like a pane-creation regression, and reverting the branch
   does not fix it because there is nothing to fix. Check
   `document.visibilityState` FIRST; a CDP screenshot forces frames and is a
   usable workaround if the window cannot be raised.

### KNOWN, PRE-EXISTING, NOT PHASE B
`paneLayout: the chart has N panes, expected at least N+1` warns on the frame
between the model gaining a pane and the widget syncing. On the hidden tab that
frame lasted until the next forced capture, so the one re-apply "did not take"
and the warning printed. Final geometry was correct every time
(310 + 96 + 95 + 95 + 90 + 28 = 714). The message and mechanism predate Phase B.

### MAIN TRADING
Never opened; `40d361fa…` → 5,354 bytes, `ea9ebaeee302`, unchanged.

### NEXT AUTHORIZED ACTION
None. Phase B is complete and awaiting review.

### OPEN QUESTIONS (unchanged)
- Axis domain for non-US-session secondaries: intersect (today) vs union.
- Splitting wick/border from the body is appearance work, deliberately deferred;
  it would not move the seam `pool.seriesOptionsForPlot` already owns.

## SECONDARY OHLC / CANDLES — PHASE C (hardening + closure)

### THE DEFECT THE WALKTHROUGH FOUND
**A moving average of QQQ was offered Candles, and drawing them replaced the
average with QQQ's own bars.** Measured in a browser: the row's legend read
`MA(5) 714.88` beside `QQQ 714.88` — the same number, to the cent, because the
five-bar mean was gone and the instrument was drawn in its place.

**Root cause — one question, asked wrong in two places.** Both the settings gate
(`ChartSettingsIndicators`) and the payload producer (`binder.ohlcBarsForPlot`)
asked *"is this instance's SOURCE a candle-capable symbol?"*. `MA(sym:QQQ:close)`
declares the SAME source string a direct QQQ series does, so the answer was yes.
The honest question is *"is this OUTPUT the instrument, or a calculation over
it?"*

**Why the existing rails missed it.** The one case that looked like this —
`ChartSettingsModal.candles.test.jsx`, "nor a moving average" — sourced the MA
from `@legacy:rsi::rsi`, an INSTANCE reference the gate already refused for being
the wrong KIND of source. The dangerous shape, an MA over a real symbol, was
never written down. ⚠️ A negative case proves nothing until it is the negative
case that could actually happen.

### THE FIX — A THIRD CAPABILITY DIMENSION, DECLARED
`ohlcCapability` now answers IDENTITY before anything else, and the definition
makes the claim:
- `nativeRegistry` — `dataSeries` declares `passthrough: true`. ⛔ NOT the same
  as its `domainBehavior: 'inherit'`, which is a claim about RANGE that
  `movingAverage` makes too. `passthrough` is the stronger, rarer claim that the
  output IS the source: no window, no smoothing, no arithmetic.
- `ohlcCapability` — `outputIsSource(def)`, `OHLC_REFUSAL.NOT_PASSTHROUGH`, and
  `ohlcCapabilityOf(def, parsed, entry, familyOf)`. The definition is the FIRST
  and REQUIRED argument, so a call site that has not been taught about identity
  passes `undefined` and is refused rather than inheriting the old answer.
- `binder` (both seams) and `ChartSettingsIndicators` pass the definition they
  already hold. Still ONE capability answer, shared — the Phase A shape.

⛔ NO defId LIST, NO NAME TEST, matching the family gate's posture in the same
file. A future identity transform declares it; a difference or a ratio cannot
acquire it by being named like one.

### RAILS ADDED (all bite-checked by reverting the fix)
- `ohlcBinding` — a calculation over a candle-capable symbol is refused;
  the claim is declared, so an untaught caller is refused; and a CENSUS over
  `registry.listDefinitions()` asserting **exactly one** definition may wear
  candles. ⭐ The census is enumeration-free on purpose: a definition added next
  quarter is refused on the day it appears.
- `candleLifecycle.test.js` (new, 15 cases) — the whole trader lifecycle against
  the REAL binder and the recording renderer double: Line↔Candles↔Line with the
  old series removed; breadth persisted as `candles` binds a LINE and is fed
  SCALARS; a capable source is fed four fields from its OWN bars; MA(QQQ) stored
  as `candles` draws the AVERAGE; colours default/override/cleanup reaching
  `addSeries` options; duplicates with independent presentation; composition,
  hide, delete, re-add; one fetch for the whole lifecycle.
- `ChartSettingsModal.candles.test.jsx` — the member-facing half of the defect.

Bite-checks, each reverting one thing: breadth admitted → 1 red; candle colours
ignored → 4 red; payload never compound → 2 red; identity dimension removed →
3 red across two files.

### ⚠️ A FIXTURE TRAP WORTH REMEMBERING
`computePaneLayout` needs `includeKeys: paneOwnKeys(instances, cs)`. A definition
whose STATIC target is the price pane — `movingAverage` — is not in
`paneTargetIds()`, so an MA a member sent to its own pane gets no pane, binds
nothing, and a case written without it "proves" the renderer refused something it
never saw. `StockChart.jsx:10548` passes it; the test ctx must too.

### BROWSER PROOF (harness, real ChartSettingsModal, AAPL primary)
Built QQQ + SPY + UCTA50 + RSI + MA(QQQ) through the member-facing paths.
- Offered Candles: QQQ, SPY only. **Refused: RSI, MA(5), UCTA50** — and MA(5)
  was the defect, now refused live.
- Line→Candles→Line→Candles: same instance, same source, same legend, no refetch.
- Colours per instance, measured PER PANE CANVAS: QQQ up `#00e5ff` / down
  `#ffcc00` gave **2,480 cyan px in QQQ's own pane canvas and 0 in the price
  pane**, while SPY's candles in the next pane stayed chart-default (2,374 green
  / 2,812 red) and the price pane stayed 25,779 / 17,868. ⚠️ The amber count in
  QQQ's pane (3,760) conflates the down-candle override with the MA's own yellow
  line sharing that canvas; the CYAN count is the clean per-instance proof.
- Composition: `MA(5) 715.44 · QQQ 714.88`, one pane, one scale, one canvas.
- Hide/show either instance independently, including hiding the pane HOST.
- Below → Above → Below: the guest travelled with its host; final geometry
  converged EXACTLY — 483 + 1 + 103 + 1 + 102 + 28 = 718 = container.
- Duplicates: `QQQ #1` (candles) / `QQQ #2` (line); **SPY stayed `SPY`**.
- Save → reconstruct: style, both colours, placement, source, duplicate identity,
  pane composition and the MA's source all recovered exactly; SPY's *absence* of
  an override survived too (the delete-on-default rule).
- Delete: instance gone, legend gone, no stale pane; the surviving QQQ dropped
  its ordinal back to `QQQ`; the orphaned MA showed **"Pane unavailable"** with
  its intent preserved — ruling A intact under a candle host.
- Re-add: a FRESH identity (`inst:dataSeries:5`), arriving as a line with no
  colours — no tombstone resurrection — and Candles offered again normally.
- **One `/api/bars/` request per secondary symbol per mounted lifecycle**, across
  style switches, a duplicate, hide/show, pane moves, reconstruct, delete and
  re-add. The only repeats are across a page RELOAD, which is cache disposal, not
  a duplicate.
- Console: no errors.

### OBSERVED, NOT PHASE C, CARRIED FORWARD
With SIX own-pane instances in a 718px chart the renderer settled at FIVE panes,
SPY and UCTA50 sharing the last one with two scales. The layout asked for six and
said so (`paneLayout: the chart has 5 panes, expected at least 6`). It is
**candles-independent** — byte-identical pane geometry with zero candles on the
chart — and predates all OHLC work. On a backgrounded tab the single re-apply
cannot land, so this session could not separate "needs another frame" from a
height-budget outcome. Not a candles defect; worth a look when pane capacity is
next opened.

### THE HIDDEN-TAB CONDITION, AGAIN
`document.visibilityState === 'hidden'` for the whole pass. Frames advance only
when a CDP capture forces one, which is why pane counts read stale between
actions and why the two `paneLayout` one-frame warnings printed. Final geometry
was correct every time. Per the Phase C brief this is not a regression and no
production code was changed for it.

### MAIN TRADING
Never opened; `40d361fa…` → 5,354 bytes, `ea9ebaeee302`, unchanged.

### STATUS
**SECONDARY-SYMBOL OHLC / CANDLES — COMPLETE FOR V1.** No Phase D.

Carried forward, unstarted:
- non-US / cross-session axis-union question (intersect is v1)
- formula-visible `open`/`high`/`low`
- richer candle appearance (wick/border width, hollow, Heikin Ashi) only if asked
- `/api/bars` entitlement / release review
- the six-pane capacity observation above

## BARS DATA ACCESS SECURITY — IMPLEMENTATION (2026-09-13)

### THE POLICY (owner-decided)
Charts are paid functionality, so chart DATA is paid. Anonymous → 401. Signed in
without entitlement → 403. Paid / premium / lifetime / comped / active trial /
admin → allowed. **No securities-vs-breadth split** — one rule for every class.

### THE TWO PUBLIC DOORS
Railway publishes the dedicated tier at `bars-api-production-1052.up.railway.app`
as well as on private networking. It runs the SAME `serve_bars` core over the
same bars.db, so a gate on the web pod alone would have closed one of two.

- **Web pod** — `require_bars_access`: a paid member (via `meets_plan_gate`) OR
  `Bearer PUSH_SECRET`. It has `auth.db`; its callers are browsers.
- **Bars tier** — `require_bars_service`: the service token ONLY. It has no
  `auth.db`, and no browser ever calls it (no absolute bars host anywhere in
  `app/src`; the web pod proxies server-to-server, forwarding query params and no
  cookies; a cookie could not reach that domain anyway).

⭐ THIS IS THE REPO'S OWN SHAPE, NOT A NEW IDEA. `flow_admin_auth.py` solved the
identical problem for flow-worker — "auth.db lives ONLY on web". The HMAC
user-vouch half is deliberately NOT copied: the tier needs to know whether the
caller is trusted, never which member is asking, because a bar series is not
user-scoped.

### ROUTES CLOSED

| route | gate |
|---|---|
| `GET /api/bars/{ticker}` | bars |
| `GET /api/bars-history/{ticker}` | bars |
| `POST /api/bars/warm` | bars (was session-only — a free member could drive provider warms) |
| `GET /api/barspack/{manifest,delta,hot,shard}` | bars (×4) |
| `GET /api/stream/bars` | bars |
| `GET /api/breadth-symbols` | bars (the enumeration half) |
| `GET /api/bars/_debug_source/{ticker}` | **admin** |
| bars-api app: `/api/bars`, `/api/bars-history`, `/api/coverage` | service token |
| bars-api app: `/api/health`, `/internal/health`, `/api/ready` | open, deliberately |

`/api/ticker-search` was NOT paywalled — see below.

### WHY `meets_plan_gate` AND 403, NOT `require_paid` AND 402
The two shipped paid families measurably DISAGREE about `comped`
(`test_the_two_paid_gate_families_DISAGREE_about_comped`): `require_paid` refuses
it 402; `require_plan` / `meets_plan_gate` admits it. The owner's policy names
comped and trial as ALLOWED, so this surface takes the `meets_plan_gate` family
and answers 403 the way that family does. That is a choice made by the policy,
not a side taken in the escalated disagreement.

### TICKER SEARCH — THE SURGICAL HALF
`/api/ticker-search` has FOURTEEN frontend consumers (CommandPalette, TickerPopup,
calendar, community ticker mentions, journal, ModelBook, charts) plus an
in-process Discord caller. Paywalling it would break ordinary symbol lookup on
surfaces entitled to it. What leaked is the proprietary half — 44 UCT breadth
measures, enumerable by anyone, step one of "enumerate, then fetch the history".
So the gate sits on the breadth AUGMENTATION only; anonymous and free callers get
the ordinary search they came for and simply do not see UCT's indicators.

⚠️ AND IT READS THE COOKIE ITSELF RATHER THAN VIA `get_current_user_optional`.
That dependency's docstring says "Never raises", but `validate_session` opens
auth.db — measured raising an OperationalError the first time this gate was wired
through it, which would have turned a database blip into a 500 on fourteen
surfaces. `_bars_entitled` swallows and degrades to "not entitled".

### TRUSTED CALLERS PRESERVED
The audit assumed the in-process callers were all direct Python. Two were NOT:

- `cot_prewarm` reaches `/api/bars` over **loopback HTTP** — it would have started
  401-ing silently into its own `status >= 400` branch.
- `history_prewarm` sweeps `/api/bars-history` through the edge.

Both now send `bars_service_headers()`. `discord_interactions` and the rest call
`serve_bars` directly and are untouched — the gate is at the HTTP boundary, and
the shared data function is exactly where it was.

### CACHE / AUTHORIZATION ORDER
`/api/bars-history` went from `public, max-age=3600, stale-while-revalidate=86400`
(and `public, max-age=31536000, immutable` on a sealed-date match) to **`private`**
on both arms. `public` invited Cloudflare to store one member's answer and hand it
to the next caller — making the CDN the authorization layer, and one that always
says yes. `private` keeps the BROWSER cache (the whole speed win) and gives up only
the shared copy. `/api/bars` was already `no-store`.

A refused caller never reaches `serve_bars` — asserted with a spy, because that
function is the door to the memory cache, bars.db, the provider and the background
cold-fetch queue.

### FRONTEND — `DENIED` IS TERMINAL
`SOURCE_STATUS.DENIED` added. 401/403 are **cached** so the next paint is a
synchronous read; every other failure keeps the existing delete-and-retry.
⚰️ Before this, every failure deleted its entry so "the next paint asks again" —
right for a 503, and for a permanent 403 an unbounded request storm from a live
chart against an endpoint that can only refuse. `knownCapabilityOf` reports
"sign in to chart this symbol" (401) or "chart data requires a paid plan" (403)
rather than a lie about the symbol.

### THE SYSTEMIC BLIND SPOT, CLOSED
Three mechanisms existed to answer "is this route gated?" and all three missed
this surface: `auth_surface_check` inspects MUTATING methods only (a GET data API
is invisible to it) and does not audit `/api/bars`; `test_exposed_routes_gated` is
an allow-list nobody added these rows to; the flow rails cover flow. The chart-data
family now has its own rung (`"bars"`, admit-set MEASURED beside the others) and
ten rows in `GATED`, so the anonymous-refusal and paid-not-refused sweeps cover it
permanently. `/api/stream/bars` is in `NEVER_PROBED` with its reason: a PAID probe
SUCCEEDS, and success means an open SSE stream the sweep would hang on.

### BITE-CHECKS (each reverting one thing)
- tier gate removed, web pod left protected → **5 red** (the central bypass rail)
- web-pod gate removed from `/api/bars` + `/api/bars-history` → **24 red**
- `private` → `public` on the immutable arm → **1 red**

⚠️ AND THE THIRD ONE TOOK THREE TRIES, WHICH IS THE LESSON. Version 1 drove the
route over HTTP and asserted on whatever came back — green with `public` restored,
because a request without `d` takes the short arm and never reaches the immutable
branch. Version 2 derived `d` from the response and guarded it `if sealed:` —
worse: on a store with no sealed history the assertion silently skipped and still
reported a pass. A conditional rail reports on its own luck. The policy is now
tested where it is decided, by calling `serve_bars_history` directly.

### 🔴 REQUIRED DEPLOYMENT ACTION — THE BLOCKER IS NOT FULLY CLOSED IN INFRASTRUCTURE
Code prevents NEW unauthorized responses. It cannot reach what is already cached,
and it cannot overrule the edge. Owner actions, none committable here — the same
shape `flow_router.py` and `darkpool_router.py` already write up:

1. **PURGE** `/api/bars-history*` (and `/api/barspack/*` if any pack objects were
   edge-cached) from Cloudflare. Objects stored while the header said `public`
   survive the header change — up to a YEAR under the immutable arm.
2. **VERIFY NO CACHE RULE OVERRIDES `private`.** Measured in THIS deployment:
   "prod was rewriting the browser TTL to max-age=14400" (`flow_router.py`). A
   Cache Rule matching `/api/*` would keep caching regardless of the origin
   header, so `private` must be confirmed at the edge rather than assumed.
3. Confirm `PUSH_SECRET` is set on the `bars-api` service, or the tier refuses
   everything — harmless (the web pod falls back to local serve) but it silently
   costs the serving tier.
4. Optional defence in depth, AFTER the above: remove Public Networking from the
   `bars-api` service. Not a substitute for the gate — the gate is what makes the
   service safe while the domain exists.

### DEFERRED (recorded, not done)
Rate limiting (authentication closes the highest-risk exposure first; IP-keyed
limiting is a poor fit — Universal Data issues several concurrent symbol requests
and shared NATs collide; key on user now that there is one). Invalid `tf` still
answers `503 warming` with `Retry-After` instead of 400. A 2000-char ticker is
still echoed. `Server-Timing` still names cache tiers. `/api/compare/*` remains
open — public taxonomy, not bar data, but it carries the same stale "charts are a
free page" comment and deserves its own look.
