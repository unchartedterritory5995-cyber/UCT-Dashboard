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
