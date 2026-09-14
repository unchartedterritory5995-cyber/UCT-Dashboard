# Universal Data — INTEGRATION LEDGER

Companion to `OVERNIGHT-LEDGER.md` (which lives on
`feat/overnight-universal-data-ux`). That one records how the work was BUILT.
This one records how it is being brought onto master, slice by slice, and —
more usefully — **where it stops and why**.

---

## WHY THERE IS A PORT AT ALL, RATHER THAN A MERGE

`feat/overnight-universal-data-ux` @ `96177d7fa` is **69 ahead / 716 behind**
master. Merge base `0ee7176c9`. Its overlap with master is almost entirely
security work that has since landed on master under different SHAs (Phase 1.5
edge entitlement), so a merge would reopen decided questions and drag a stale
copy of deployed security code behind it. The Universal Data engine, by
contrast, is **new files only** — it can be moved forward cleanly.

So: a fresh branch off current master, and slices that each stand on their own.

**Branch:** `feat/universal-data-integration`, cut from master `025be081e`.
**Reference (read-only):** `feat/overnight-universal-data-ux` @ `96177d7fa`.

---

## BASELINE — MEASURED FIRST, ON PRISTINE MASTER

`vitest run src/components/chart/engine` on master `025be081e`:

    2 failed | 3906 passed | 4 skipped

The two are pre-existing ratchet rails, red on master itself and unrelated to
this work: `engine/ast/manifestProse.test.js` and
`engine/ast/pine.blindCorpus.test.js`. **Every later number in this file is
quoted against that baseline**, because "2 failed" is only meaningful next to
the 2 that were already there.

---

## SLICE A — `9d1481c67` · canonical source identity + scalar projection

| | |
|---|---|
| New files | `engine/sourceRef.js`, `engine/symbolProjection.js` |
| New rails | `engine/symbolProjection.test.js`, `engine/symbolSource.test.js` (**47**) |
| Master files modified | **none** |
| Engine suite | 2 failed / **3953** passed (+47, zero regressions) |

⛔ **The distinction this slice exists to preserve.** A canonical bar bundle is
projected to a **scalar** for formula semantics; candles are a **presentation**
capability of a genuine OHLC-capable series. `sym:QQQ:close` is not redefined as
OHLC and no `sym:QQQ:ohlc` is introduced. Keeping those two languages apart is
what stops "it has o/h/l/c fields" from silently becoming "it means an auction".

---

## SLICE B — `5268dab3e` · secondary-bar lane + the discovery facade

| | |
|---|---|
| New files | `engine/secondaryBars.js`, `discoveryCatalog.js` |
| New rails | `engine/__tests__/secondaryDenied.test.js` (**9**) |
| Master files modified | `engine/__tests__/controlDoorCensus.test.js` — one ledger row, **at the rail's own instruction** |
| Engine suite | 2 failed / **3962** passed (+9, zero regressions) |

Both modules have **zero imports of their own**, which is what made them
portable at all.

⚠️ **`discoveryCatalog` is INERT on this branch today.** `createDirectSeries`
composes `addInstance` + `setInstanceInput` against the registry definition
`dataSeries`, which master does not have. Measured, not assumed: the branch's
`discoveryCatalog.test.js` was run here and returned **24 failed / 16 passed**,
every failure tracing to `registry.getDefinition('dataSeries') === null`. The
**refusal** path is covered and green; the **creation** path lands with the
registry slice below.

⭐ **The census caught its own new caller.** `controlDoorCensus` enumerates the
callers of door eight (the per-INSTANCE writers) and went red the moment
`discoveryCatalog.js` appeared. Its failure message says *"UPDATE this census
with the surface and its reason, do not delete the case"* — so the branch's
ledger row was ported verbatim, and the census's positive control still passes,
so the rail can still fail.

---

## ⛔ THE GATE — WHY THE PORT STOPS HERE

Everything downstream of slice B converges on **one** missing thing: the
registry definition `dataSeries` (and its sibling `movingAverage`). Not a family
of unrelated blockers — one.

`engine/presentation.js` and `engine/ohlcCapability.js` were ported and their
rails run, purely to find out. Result: **29 failed / 40 passed**, and the
capability failures all reduce to `registry.getDefinition('dataSeries')` being
`null`. Both modules were then **removed again**: landing them would mean
landing untested dead code, and their rails go green the day the definition
exists. They belong to the registry slice, not to this phase.

### What the registry slice actually costs — measured, not estimated

The branch's `engine/nativeRegistry.js` + `engine/registrySizes.js` were dropped
in and the suite run, then reverted (never committed):

    50 failed | 3943 passed          <- vs. baseline 2 failed
    -> 48 NEW failures across 20 distinct rail files

    10  nativeRegistry.test.js              2  paneLayout.test.js
     7  everyIndicatorParameterSweep        2  settingsBlobMigration
     7  enumerationSites                    2  engineEnabledMigration
     6  stockChartWiring                    1x readout, placement, lint,
                                               eventColumns, perInstanceDoor,
                                               legendFromDefinitions,
                                               generatedSettingsRows, flipB,
                                               flipBStoredBlobs, flipCGeometry,
                                               2 flip-parity suites

`registrySizes.js` is a manifest **ten files read**. Two new definitions move
all of them at once. Those rails are themselves modified on the branch, for
legitimate reasons, so the slice is *"registry + its twenty rails, reviewed
together"* — **not** a small additive edit, and calling it one is exactly how a
low-conflict port stops being low-conflict.

---

## DEFERRED INTEGRATION POINTS (the next phase's checklist)

1. **Registry** — `dataSeries` + `movingAverage` definitions, their
   `NATIVE_COMPUTE` entries, the `computeFor` change, `registrySizes.js`, and
   the 20 rail files above. **This unblocks everything else.**
2. **`engine/instanceControls.js`** — master lacks `setInstancePlotStyle`,
   `setInstanceDisplayTarget`, `setInstancePanePosition`.
3. **`engine/readout.js`** — master lacks `disambiguateLabels`
   (`engine/displayTarget.js` imports it).
4. **`app/src/hooks/useBreadthSymbols.js`** — master lacks `symbolFamily`, the
   classifier OHLC capability refuses breadth with.
5. **`engine/presentation.js`, `engine/ohlcCapability.js`, `engine/displayTarget.js`,
   `engine/useSecondarySources.js`, `useSymbolDiscovery.js`** — ported after 1-4.
6. **`StockChart.jsx`** — untouched by design, its own reviewed slice.
7. **The overnight row-summary UX** (`ChartSettingsIndicators.jsx` +
   `ChartSettingsModal.rowSummary.test.jsx`) — ⛔ **carries a known defect, do
   not land as-is**: `.actName { flex: 0 1 auto }` in
   `ChartSettingsModal.module.css` is a **global** override, but only the
   Indicators tab has an `.actMeta` sibling to take the freed space.
   `ChartSettingsConditions` and `ChartSettingsInfoFields` share `.actName` and
   would be left with nothing growing. jsdom cannot see this — no layout.

## NOT PORTED, DELIBERATELY

The remaining branch-only modules are **conditions/alerts and info-fields**
work — a different initiative that happens to share the branch. And no security
code: `bars_auth`, `bars.py`, `bars_api_main`, `ticker_search`, `worker_main`,
the prewarm/auth changes and their tests are the **stale duplicates**. Master's
deployed Phase 1.5 state stands.

---

# PHASE 2 — REGISTRY AUDIT + THE INSTANCE WRITERS

Starting HEAD `663e621ce`; ending HEAD `d6f9c8861`. One commit created.
Baseline re-verified before any edit: **2 failed / 3962 passed / 4 skipped**,
build clean, tree clean, fingerprint `ea9ebaeee302`.

## ⛔ THE HEADLINE: THE REGISTRY SLICE WAS BUILT, MEASURED, AND REVERTED

It was not skipped. `dataSeries` was added to master's registry and its rails
taken green, and then removed again for three reasons that only appeared once it
existed. **The work is written down here precisely so Phase 3 does not repeat the
audit.**

### The minimal delta — FOUR edits, not the branch's 259 lines

The branch's `nativeRegistry.js` diff carries `movingAverage`, its
`smaOfSeries`/`emaOfSeries` helpers and a comment rewrite, none of which
`dataSeries` needs. The irreducible change is:

1. `nativeRegistry.js` — the `dataSeries` entry appended to `RAW_DEFS`:
   `nativeDef('dataSeries','dataSeries', {name:'Data Series', shortName:'Series',
   category:'Data', tags:[…], labelFrom:'source'}, autoPane(0.15),
   [{key:'source',type:'source',default:'close'}, colorInput('color',…)],
   [{key:'value',label:'Value',style:'line',…}])` plus
   `domainBehavior:'inherit'` and `passthrough:true`.
2. `nativeRegistry.js` — the `dataSeries` NATIVE_COMPUTE entry: copies
   `ctx.source` value-by-value, `Number.isFinite` gated, empty column when the
   source has not resolved (a gap, never a zero).
3. `nativeRegistry.js` — `computeFor` hands the ctx to the native lane:
   `fn(series, resolveInputs(def, inputs), ctx)`. **Provably inert for the 16
   shipped natives**, which declare `(bars, p)`; the server and AST lanes were
   already given it.
4. `registrySizes.js` — `'dataSeries'` in `SHIPPED_DEF_IDS.native`. Every count
   derives, so the manifest moves exactly one line.

### What master already had — the pleasant half

`autoPane`, `colorInput`, `onPrice` and `nativeDef` all exist, and `nativeDef`
spreads `...meta` so `labelFrom` rides along. `domainBehavior:'inherit'` is
already read by slice A's `sourceRef.js`. And **`type: 'source'` is already
master's vocabulary**: `defSchema` validates it explicitly, and
`indicatorRegistry.fieldFromInput` deliberately returns `null` for it.

### The measurement

The minimal delta moves **31 rails across 16 files** — not the 48/20 Phase 1
measured for the blanket copy, because the parameter-sweep and flip-parity breaks
were branch drift rather than `dataSeries`. All 31 were worked through. The
registry's own rails were taken fully green (`nativeRegistry.test.js` **170/170**)
by porting the branch's honest fixes: a `ctxFor(def)` harness that supplies a
synthetic series to any definition DECLARING a `source` input (derived from the
declaration, never a list of ids), `WARMUP.dataSeries = 0` (an identity transform
has no window), and `NOT_A_MIGRATION` gaining the id (no July section exists for
it). **That result is itself the proof the compute path is correct**: the
per-definition sweep computed `dataSeries` and got finite values.

And `discoveryCatalog.test.js` went from **24 failed / 16 passed** to
**8 failed / 32 passed**. The creation path is a pure settings mutation and needs
no binder, so the registry alone unblocks it. Of the residual 8: two need
`setInstanceDisplayTarget` (**landed below**), five need legend labelling through
`readout`, one needs `movingAverage`.

### ⛔⛔ THE THREE REASONS IT WAS REVERTED

1. **It would render for nobody.** Master's binder builds its ctx as
   `{sym, tf}` — **nothing populates `ctx.source`**. Measured, not inferred:
   *"the engine bound nothing for dataSeries"*. The branch's resolution block is
   only ~40 lines, but it needs instance DEPENDENCY ORDERING (a source that is
   another instance's output must compute first) and a `secondary` bar map that
   **StockChart supplies** — and the branch's `binder.js` is a whole-file rewrite
   (1758+/852−, one hunk) that imports `conditions` and `infoFields`, the separate
   initiative. Master's `binder.js` is byte-identical to the merge base, so the
   divergence is entirely branch-side and the rewrite is not portable.
2. **Its source input would have no control.** `enumerationSites` asserts *every*
   declared input of *every* definition is reachable from the generated dialog,
   and `fieldFromInput` returns `null` for `type: 'source'`. Closing it means a
   source control — and `ChartSettingsIndicators.jsx` renders only
   `color | toggle | number | select`, so teaching `fieldFromInput` the case
   would make the rail PASS while the member still had no control. **That is the
   exact lie the rail exists to catch**, and that file is off-limits this phase.
3. **It would surface a dead row to members.** `catalogRows()` derives from
   `listDefinitions()` and `IndicatorLibraryDialog` unions it **unfiltered** —
   `LIBRARY_HIDDEN_IDS` exists in ported code but nothing reads it yet. A "Data
   Series" row would appear in the library and draw nothing.

⚠️ **One rail states the design question outright** and it is the owner's, not
mine: *"the native lane is exactly the set of definitions that have [a legacy
toggle]. A third-lane definition would break it, correctly — somebody has to
decide what a legacy toggle means."* `dataSeries` is native and has no legacy
toggle. On the branch this never surfaced because its binder made the definition
draw. Landing it here means deciding that question, in `stockChartWiring`'s
`seen === REGISTRY_SIZES.native` equality.

## SLICE — `d6f9c8861` · the presentation and placement writers

| | |
|---|---|
| New files | `engine/presentation.js`, `engine/displayTarget.js` |
| Modified | `engine/instanceControls.js` (+5 writers), `engine/readout.js` (+`disambiguateLabels`; `siblingSuffixes` gains an OPTIONAL arg) |
| New rails | `displayTarget.test.js` (15, ported) + `instanceWriters.test.js` (**22, written here**) |
| Engine suite | 2 failed / **3999** passed (+37, zero regressions) |

Writers added: `setInstancePlotStyle`, `setInstanceDisplayTarget`,
`setInstancePanePosition`, `setInstanceDotSize`, `setInstanceCandleColor`. Each
goes through `withInstances`, mutates ONE instance by id, returns a new object,
and **refuses by IDENTITY** (`next === cs`) so a caller can test a rejected write
— a fresh equal copy would pass `toEqual` and mark the settings dirty on every
rejected keystroke. No persistence boundary touched; no workspace blob written
directly.

⛔ **Additive only.** The branch also rewrites `removeInstance`,
`setInstanceHidden`, a legacy-volume helper and `readout.chipsFrom`; those are
existing master behaviour with their own rails and were left behind. The single
change to an existing function is `siblingSuffixes(inputsList, ignoreKeys)` —
absent means an empty skip set and a byte-identical result.

⚠️ **The 22 new rails were bite-checked**, one mutation at a time, each reverted:
removing the self-guest guard, the pane-position validation, the style vocabulary
check and the unknown-instance guard each turned EXACTLY the named case red. The
branch's own writer rails could not be used whole: they are welded to binder
cases master cannot run (`lastValueHorizontal` is a style its binder does not
know — measured at 8 writer cases passing, 6 binder cases failing), and editing
a ported test to drop the failing half is how a rail stops meaning anything.

## NEXT BLOCKER, AND WHAT IT GATES

**Binder source resolution** — `ctx.source`. It gates, in order: the registry
definition rendering at all, then `ohlcCapability.js`, then candles, then the
row-summary UX. It cannot be done without touching `StockChart.jsx` (the
`secondary` bar map) and without a decision on instance dependency ordering.
**StockChart is now the true gate**, which it was not at the end of Phase 1.

`presentation.js` and `displayTarget.js` are now IN. `ohlcCapability.js` remains
out: its census asserts exactly one definition may wear candles, which needs
`dataSeries` to exist, and its family classifier needs `symbolFamily` from
`useBreadthSymbols`.

## RECOMMENDED PHASE 3 SCOPE

One decision first, then one slice. The decision is question 2 above: **where
does a source control live?** Until a member can change a source, `dataSeries`
cannot honestly ship. The slice is then binder source resolution + the registry
+ the library filter, together — because each of the three is what makes the
other two honest, and any one of them alone is a definition that lies.

---

# PHASE 3 — THE HONEST DIRECT-SERIES VERTICAL SLICE

Starting HEAD `05698e2c1`; ending HEAD `ba8247286`. Four commits.
Baseline re-verified before any edit: engine 2 failed / 3999 passed / 4 skipped,
build clean, tree clean, fingerprint `ea9ebaeee302`.

**The slice is closed end to end**: a member picks a source → the registry
understands `dataSeries` → settings hold the canonical source string → StockChart
supplies the canonical secondary bars → the binder resolves `ctx.source` → the
native compute passes the scalar through → presentation and placement draw it in
its own pane. Verified in a browser, not only in tests.

## ⛔ FIRST, A CORRECTION TO PHASES 1–2

Their "vs master" diffs used the **stale local `master` ref** (`00227bc0e`),
which is behind `origin/master` (`025be081e`, the actual branch base). That ref's
merge base with the feature branches is `00227bc0e`; the true one is `0ee7176c9`.
Every branch-vs-master file list in those phases was therefore INFLATED with
master's own commits in between.

Re-derived against `0ee7176c9`, the conclusions that mattered survive: the
branch's `binder.js` really is a whole-file rewrite (1758+/852−) and master's
really is byte-identical to the merge base. What changed is the StockChart
audit — see below, and note that `app/src/components/chart/StockChart.jsx` does
not exist; the real file is **`app/src/components/StockChart.jsx`**.

## PART A — THE STOCKCHART AUDIT

Branch delta: **35 hunks, +636/−38** on a 17,297-line file, with master
independently at +222/−3 since the merge base.

**Ported (4 edits, +38/−1):** the `useSecondarySources` import; the hook call
after `barCount`; `secondary: secondarySources` in the binder sync ctx; and
`secondarySources` in `updateChart`'s dependency array. Plus one earlier line:
`LIBRARY_HIDDEN_IDS` subtracted from the right-click Indicators submenu.

**Rejected, explicitly:** the Conditions pipeline (candle colour, background
shading, markers, `normaliseConditions`, `conditionActions`,
`conditionShadingPrimitive`); InfoFields and `infoBusKey`; formula-builder
intent; six pane-coordinate defect fixes ("the candles' own pane, not pane 0");
`viewLock` band clamping; the drawing-toolbar `--uct-top-pane-h` offset; and the
P2.0c legend/right-click pane-identity rework.

## PARTS F/G/H — THE RUNTIME SEAM (`92e7c20ad`)

`computeFor` hands the ctx to the native lane — the server and AST lanes already
had it. Inert for the shipped natives, which declare `(bars, p)`; asserted over
the whole registry rather than assumed.

The binder resolves a source into a numeric series: a **bar field** off the
chart's own bars, an **instance output** via `bindingKey`, or a **symbol**
projected from the canonical secondary bundle with exact-t alignment and no
forward fill. An unsupplied symbol is `null` — never the chart's own bars, which
is the one failure here that looks exactly like success.

**Dependency order, not array order.** The compute loop now walks
`sourceRef.orderByDependency` (Kahn's algorithm, ported in slice A). A cycle is
reported and refused whole. ⭐ Part H asked whether ordering was needed at all
for V1: it is needed the moment a source is another instance's output, and the
canonical helper already existed, so nothing was invented.

The memo key gains the source by **object identity** (`__srcId`, non-enumerable,
so it can never reach a settings blob).

## PARTS B/C/D/E/J/K/O — DEFINITION AND CONTROL (`91f4c0f05`)

`dataSeries`: `labelFrom: 'source'`, `autoPane(0.15)`, `domainBehavior:
'inherit'`, `passthrough: true`, one `source` input, one `value` plot. Id is
`dataSeries` and not `series` because `'series'` is an AST node type and
`ast/lint.test.js` asserts no literal in `lint.js` equals a shipped definition id.

**The source control is real.** `fieldFromInput` returns a descriptor for
`type: 'source'` AND `SourceField.jsx` renders it: one compact `<select>` of
grouped options (price fields, other instances' outputs, the current symbol) plus
a "Search symbol…" row opening an inline search over the existing discovery
endpoint. `symbolSource()` is the one writer of `sym:<TICKER>:<field>`.

⛔ **A descriptor without a renderer would have passed the census** —
`enumerationSites` reads the descriptor, not the DOM. Both halves landed
together, and a bite check later proved this was not hypothetical (below).

**Library visibility:** `LIBRARY_HIDDEN_IDS` is subtracted at the CONSUMER (the
dialog and the right-click submenu), never omitted from `catalogRows()`, which is
the shipped manifest two consumers assert id-for-id. Both halves railed, and the
constant itself is pinned so it cannot quietly grow.

**PART K — the legacy-toggle invariant is refined, not deleted.** "native
definition" and "had a legacy toggle" were the same set only while every
definition was a migrated block. `dataSeries` joins `NEVER_MIGRATED` beside
`avwap`/`atrBands`/`rsLine` — a table this repo already had for this distinction
— with `REFS: []` and `COMPUTES: null`. The gated cases still fail BY NAME for
any definition that genuinely had a block and lost its refs or compute.

**Seventeen census rails across fifteen files** moved, each narrowly, each with a
reason. None weakened: no equality became a subset check, no exclusion a
wildcard.

⚰️ **The hash rail was investigated, not regenerated.** `perInstanceDoor`'s corpus
walks `listDefinitions()`, so an eighteenth definition moves it by construction.
Proof it moved for that reason ONLY: the corpus rebuilt with `dataSeries` skipped
digests to `a737b2eb1ac8ae684fe2b6279eaafbadf60a242b6f54c86eb472524b110e6f1b` —
the previous pin, byte for byte.

⚠️ **A badge was judged:** `dataSeries` is `non-repainting` in the strongest
sense — an identity transform with no window, seed or forward reference. The
claim is about the TRANSFORM: pointed at a repainting output, THAT output carries
the verdict.

## PARTS I/R — STOCKCHART SUPPLIES THE BARS (`7605c0010`)

It reuses `instFetcher`, the fetch lane the component already owned, with its
in-flight registry and switch-abort. `secondaryBars` dedupes by
`(symbol, tf, bars)`. It reads `cs.indicatorInstances`, NOT `engineInstancesRef`,
because that ref is filled by an effect declared BELOW it — the first-render
defect only a real-component test can see. The map is a dependency, not a ref.

`secondarySourceLive.test.jsx` (22) is the branch's real-component harness,
re-pointed from `movingAverage` to `dataSeries`. Two expectations were RE-DERIVED
and both got sharper: the pane (own pane, since `dataSeries` declares `autoPane`;
scale still `right`) and the gap count (an identity transform loses EXACTLY one
value, so `drawn === full - 1` replaces a loose bound).

## PART P — THE BROWSER, AND WHAT IT FOUND (`ba8247286`)

Run on `pane-harness.html` at `localhost:5203` (my own port; :5173, :5188, :5199
and the :8000 backend were left alone). **/charts was never opened.**

| Scenario | Result |
|---|---|
| Add QQQ | ✅ drew in its own pane, legend `QQQ 714.88` |
| Renders as a direct secondary series | ✅ `src=sym:QQQ:close`, own scale 680–760 |
| Duplicate QQQ | ✅ allowed; **third add issued ZERO new `/api/bars/` requests** |
| Add SPY | ✅ second pane, independent |
| Source control shows the instrument | ✅ `sym:QQQ:close`, plus the other instance's output and the search door |
| Change source via search | ✅ → `sym:NVDA:close`, **exactly one** new request |
| Own pane / main chart | ✅ own pane verified; price target available via Display-in |
| Preference writes | ✅ **refused: 0** across every scenario |
| Main Trading | ✅ untouched, `ea9ebaeee302` before and after |

⚰️ **THE DEFECT IT FOUND, which every unit rail missed:** four settings rows all
reading **"Data Series"** while the legend beside them correctly read `QQQ`. The
chip surface had been fixed and the ROW surface had not — the same
two-naming-surfaces trap, mirrored. Fixed narrowly (`listEngineIndicators` names
an instance row through `instanceLabel`, gated on `meta.labelFrom`), railed, and
re-verified live: rows now read `QQQ` and `SPY`.

## ⚠️ AN OPEN PRODUCT QUESTION — THE TOP PHASE 4 ITEM

**A re-pointed series keeps the name it was added under.** Measured: after
changing a QQQ series' source to NVDA, the legend read **`QQQ 218.29`** — 218.29
is NVDA's price. The data is right and the NAME is stale.

This is by DESIGN, not a bug I introduced: `instanceLabel` prefers the stored
`display.name` (written by `createDirectSeries` at add time) over the derived
source stem, and `chipLabel` follows the same precedence. Deciding what should
win when the source changes — keep the added name, clear it on a source write, or
always derive — is a product/architecture decision, so it is recorded here rather
than changed unilaterally.

## BITE CHECKS (PART S)

| Mutation | Result |
|---|---|
| native ctx pass-through removed | 7 of 11 red |
| binder symbol resolution removed | 3 red |
| binder falls back to the chart's own bars | 1 red |
| dependency ordering → array order | 1 red |
| source descriptor removed | 4 red |
| **source RENDERER removed, descriptor kept** | **GREEN — a real gap** |
| library hiding removed | 4 red |
| right-click submenu hiding removed | 1 red |
| `dataSeries` out of `NEVER_MIGRATED` | 1 red |
| secondary cache/dedupe bypassed | suite UNRUNNABLE (runaway fetch kills the worker) |

⚰️ The sixth is why `SourceField.test.jsx` gained two cases that render the REAL
modal, open the row and operate the control; it now goes red for that mutation.
The tenth is reported as it happened: the guard is load-bearing to the point that
removing it hangs the app, but no named rail reports it cleanly — that is
evidence of a kind, and weaker than a failing assertion.

## RESULTS

| | |
|---|---|
| Engine | 2 failed / 4011 passed (the two pre-existing ratchets) |
| `src/components` | **4 failed / 10243 passed** vs Phase 2's 4 / 10175 — **+68, zero regressions** |
| Build | ✅ `app/dist` has index.html + q1-probe.html; **no pane-harness** |
| eslint StockChart.jsx | 134 problems before, 134 after; **zero `no-undef`** |
| discoveryCatalog | **39/40** (was 24 failed / 16 passed before the registry) |

The one residual discoveryCatalog failure needs `movingAverage` — a separate
definition Part E says not to port. That file is a measuring instrument here and
is deliberately NOT committed.

## OHLC / CANDLES — EXPLICITLY DEFERRED (PART M)

Not landed. `ohlcCapability.js` needs `symbolFamily` from `useBreadthSymbols` and
the binder's `ohlcFamilyOf` oracle, plus the `SERIES_CTOR` table entry in
StockChart. Line-only direct series is complete and honest, which Part M names as
acceptable. `presentation.PLOT_STYLES` already RECOGNISES `candles` so a stored
value resolves rather than silently reading as `line`; `availableStyles` refuses
to OFFER it until a caller proves the source can mean one.

## RECOMMENDED PHASE 4

1. **Decide the naming question above** — it is one sentence of product intent
   and it blocks nothing else, but it is member-visible today.
2. **OHLC/candles**: `symbolFamily` + `ohlcCapability.js` + `ohlcFamilyOf` on the
   binder ctx + `SERIES_CTOR`. Self-contained now that the vertical exists.
3. **`movingAverage`**, which closes discoveryCatalog to 40/40 and is the second
   definition proving the source model is general rather than fitted to one case.
4. Only then the overnight row-summary UX — still carrying the known global
   `.actName` defect recorded in the Phase 1 section.

---

# PHASE 4 — NAMING, CANDLES, AND AN AVERAGE OF ANY SERIES

Starting HEAD `ee1d93172`; ending HEAD `b37202c32` (+ this ledger). Four commits.
Baseline re-verified before any edit: 4 failed / 10243 passed, build clean,
fingerprint `ea9ebaeee302`.

Universal Data is no longer "plot another ticker". Both shapes are green:

    direct source → presentation               (QQQ line, QQQ candles)
    direct source → derived → presentation      (MA over a QQQ series)

## PART A — AN AUTOMATIC NAME FOLLOWS ITS SOURCE (`7041c5c98`)

⚰️ The Phase 3 browser finding: a QQQ series re-pointed at NVDA kept its label —
the legend read `QQQ 218.29`, and 218.29 is NVDA's price.

**The root cause was PROVENANCE, not precedence.** `instanceLabel` preferring a
stored `display.name` is RIGHT — it is what makes a real choice like "Invesco QQQ
Trust" stick. The defect was upstream in the WRITE: `createFromResult` stamped the
catalogue's short name unconditionally, so a series whose source already derives
`QQQ` got `display.name = 'QQQ'` — an automatic name wearing the shape of a chosen
one. By the time it was stored, nothing downstream could tell them apart.

**The contract, now enforced at the write:**

| | |
|---|---|
| automatic name | a function of the CURRENT source, recomputed every read |
| explicit name | stored, preserved, and still beats the derived one |

`sourceRef.derivedSourceName` is exported so the write side can ask that question
with the same derivation the read side uses. ⛔ It is not a second naming system:
`instanceLabel` remains the one answer every surface reads. No custom-name
feature was built (none existed to preserve); the precedence is asserted so a
future naming control inherits it.

⛔ **Identity never moves.** `instanceId` and `inputs.source` are untouched by a
label change, and a label is never encoded into a source string — two display
names would otherwise be two different sources and every binding would break on a
rename.

**Duplicate disambiguation runs after the derived name**, through the machinery
that already existed: `QQQ #1 / QQQ #2`; re-point one to NVDA and BOTH read
plainly because the collision ended; re-point it into an existing NVDA and the two
NVDA series are told apart instead.

## PARTS B/C/D — CANDLES (`616024da3`)

⭐⭐ **A candle is a STYLE.** No candle instance type, no second source, no
separate pane architecture, no extra registry definition. `sym:QQQ:close` still
means the close and no `sym:QQQ:ohlc` exists.

⛔⛔ **Eligibility is two claims and both are required:**
1. the SOURCE is a canonical symbol whose provider FAMILY means o/h/l/c describe
   one auction period, and
2. the DEFINITION is a passthrough — its output IS that instrument.

Either alone admits something false. (1) alone gives `MA(QQQ)` candles of QQQ's
own bars in the average's pane. (2) alone gives a passthrough over a breadth
measure candles of a number that never traded.

⛔ **Not gated on the payload.** Breadth bars carry o/h/l/c, so "has four fields"
would admit them. `symbolFamily` answers `'unknown'` until the registry lands and
the gate REFUSES `'unknown'` — not-classified-yet is never "ordinary security".

⭐ **One capability answer per instance, shared by three readers** — the plan (a
`candles` style decides the SERIES TYPE), the style resolution (the clamp), and
the payload production — so they cannot disagree about whether a stored style is
honoured.

⛔ **The payload is tagged** (`{kind:'ohlc', bars}`), never duck-typed, **and
compute never sees one**: it is produced only for a binding whose PRESENTATION
asked for candles, so a source reference still resolves through the scalar
projection. `MA(QQQ)` reads `sym:QQQ:close` exactly as before.

**Timestamp contract unchanged (Part D):** `clippedBarsFor` drops every bar
outside the chart's domain, so each survivor is a real bar at ITS OWN `t`. No
forward fill, no synthetic bar, no axis union. Railed: one hole in the secondary
costs exactly one candle.

**Candle colours default to the chart's own palette** via
`resolveCandleColors(inst, plot, cs.candles)` — no new palette, appearance work
not started.

## PART E — `movingAverage` (`b37202c32`)

`MA(Close)`, `MA(Volume)` and `MA(QQQ)` are ONE definition pointed at different
sources — the same `type: 'source'` input, so the **same `SourceField`** edits it
(Part H). No second source format, no MA-only picker, no second dependency graph.

⛔ **Additive beside the legacy overlays, not a migration of them.** `cs.overlays`
still holds the shipped SMA/EMA-on-close overlays, computed in StockChart exactly
as before. An old chart gains nothing and loses nothing.

⚰️ **A requirement this exposed, and the binder now meets.** Master skipped EVERY
hidden instance before computing — sound, until something READS one: hiding a QQQ
series silently took `MA(QQQ)` down with it. **Visibility is ink, not existence**,
so a hidden instance is skipped only when nothing depends on it.

⛔ **No silent fallback.** An explicit source that is missing draws NOTHING rather
than averaging the bars in hand, which would answer confidently about the wrong
instrument and look perfectly plausible.

## PART G — DISCOVERY CATALOG: **40 / 40**

On the branch's measuring suite, **byte-identical to the original** (sha256
compared, not eyeballed): 24 failed / 16 passed before the registry → 39/40 at the
end of Phase 3 → **40/40**. The measurement was not edited to reach the target.

## PART O — THE STOCKCHART DELTA THIS PHASE

**+13 / −2**, all in the candles commit; the naming and movingAverage commits
touched it not at all.

| hunk | why |
|---|---|
| `CandlestickSeries` into `engineLwc()` | the engine can only build what that object carries; a pool key whose constructor is missing resolves to `undefined` and the plot silently does not exist |
| `ohlcFamilyOf: symbolFamily` on the binder ctx | the semantic half of the capability gate, read synchronously because the binder has no hooks |
| one `useEffect` calling `loadBreadthSymbols()` | the oracle needs its registry and this chart must not assume a sibling mounted it — `ChartPane` does, the pane harness does not, and the gate fails closed to "no candles" without it |

**Rejected again, explicitly:** the Conditions pipeline, InfoFields/`infoBusKey`,
formula-builder intent, the six pane-coordinate defect fixes, viewLock band
clamping, the drawing-toolbar offset, and the P2.0c legend rework.

## BROWSER PROOF (PART L) — all 18 scenarios, on `pane-harness.html`

Chrome had exited after Phase 3 and was restarted; the harness ran on my own port
(:5203). **/charts was never opened.**

| # | scenario | result |
|---|---|---|
| 1-2 | add QQQ, label correct | ✅ `QQQ`, one `/api/bars/QQQ` |
| 3-5 | change source → NVDA | ✅ row AND legend read **NVDA 211.34** (NVDA's price), `src=sym:NVDA:close`, exactly one new fetch |
| 6-7 | duplicates | ✅ **QQQ #1 / QQQ #2**, NVDA unsuffixed; **zero** fetches for both adds |
| 8 | style control | ✅ present; `candles` offered for QQQ |
| 8-10 | Line→Candles→Line→Candles | ✅ **zero** new fetches on every transition; same 3 instances |
| — | candles really render | ✅ A/B zoom: red/green bodies as candles, a single blue line as line |
| 11-12 | add MA(QQQ) | ✅ `inst:movingAverage:1`, `src=sym:QQQ:close`, **zero** fetches (reused cache) |
| 13 | MA cannot choose candles | ✅ `Moving Average (Source)`: line/histogram/dots/area/lastValueHorizontal — **no candles** |
| 14 | MA + QQQ same pane | ✅ display-in offers `QQQ #1/#2/#3`, `NVDA`, `MA (5)` |
| 15 | UCTA50 cannot choose candles | ✅ **no candles** |
| 16 | delete / re-add | ✅ 6→5→6, zero fetches |
| 17 | runaway | ✅ **zero** fetches across a 10-second idle |
| 18 | preference writes | ✅ **refused: 0** throughout |

⭐ The negative census's sharpest evidence is that the SAME source behaved
differently by definition: QQQ offered candles to the passthrough and refused
them to the average over it.

## BITE CHECKS

| mutation | result |
|---|---|
| catalogue stamps the derived name again | 5 red (incl. the exact Phase 3 defect) |
| disambiguation groups without the label | the MIXED-GROUP case red |
| semantic family gate removed | breadth admitted, 2 red |
| passthrough requirement removed | 3 red |
| the clamp trusts the stored value | 4 red |
| candlestick ctor out of `SERIES_CTOR` | the positive case red |
| MA compute falls back to the chart's closes | 3 red |
| dependency ordering → array order | 1 red |
| a hidden source skipped even when read | 1 red |
| `movingAverage` out of the shipped manifest | 7 red |

⚠️ **Two did not bite and are reported as such.** Deleting the `FAMILY_UNKNOWN`
guard changed nothing — an unknown family is ALSO refused by the family-membership
test below it (redundant defence, not a hole). And a two-series duplicate case
could not bite the grouping at all, because the pre-existing "all labels distinct"
guard skips it either way; the file gained a THREE-series mixed case, which does.

## RESULTS

| | |
|---|---|
| Engine | 2 failed / 4124 passed (the two pre-existing ratchets) |
| `src/components` | **4 failed / 10386 passed** vs Phase 3's 4 / 10243 — **+143, zero regressions** |
| Build | ✅ |
| eslint StockChart.jsx | 134 problems, unchanged from master; zero `no-undef` |
| discoveryCatalog | **40/40** |

## REMAINING BLOCKERS

None for this scope. Known deferrals, unchanged: the overnight row-summary UX
still carries the global `.actName` defect recorded in the Phase 1 section, and
the secondary-series colour palette is not started.

## RECOMMENDED PHASE 5

1. **The row-summary UX**, finally — it is the last Universal Data UX piece and
   the naming, placement and style seams it reads are all now in place. Fix the
   `.actName` defect with a scoped modifier as part of landing it.
2. **Per-instance candle colours**, if the owner wants a secondary instrument to
   differ from the chart's own palette — `setInstanceCandleColor` already exists
   from Phase 2 and `resolveCandleColors` already reads per-instance overrides;
   only the control is missing.
3. **`MA(MA(x))` depth**, if wanted: the topological sort already handles it, so
   this is a test-and-confirm rather than a build.

---

# PHASE 5 — THE COLLAPSED ROW SAYS WHERE IT DRAWS AND HOW

Starting HEAD `48ae4070e`; ending HEAD `284f8ff34` (+ this ledger). Two commits.
Baseline re-verified before any edit: 4 failed / 10386 passed, build clean,
fingerprint `ea9ebaeee302`.

## BEHAVIOUR

A collapsed row now answers *what is this, how is it drawn, where does it draw,
and what does it read* — in one faint line beside the name:

| row | summary |
|---|---|
| `QQQ` | `Line · Own pane` |
| `QQQ` | `Candles · Own pane` |
| `SPY` | `Line · QQQ` |
| `SPY` | `Line · Pane unavailable` |
| `Moving Average (Source)` | `Line · Own pane · Source: QQQ` |
| `EMA 9`, `SMA 200`, `Volume`, `BB` | *(nothing)* |

## HELPERS REUSED — NO SECOND OPINION ANYWHERE

`resolveDisplayTarget`, `displayTargetOptions` (which already carries the
`Pane unavailable` option flagged `missing`, and human pane-host labels),
`resolvePlotStyle` + `PLOT_STYLE_CHOICES`, `sourceInputsOf` + `parseSource`, and
`disambiguateLabels`. The OHLC capability answer was an IIFE inside the style
control; it is now ONE module-level helper with two readers, because two copies
are exactly how "Candles offered here and denied there" happens.

⛔ **The silence is derived too.** `displayTargetOptions` returning EMPTY means a
definition with one place to draw and one shape to draw in — nothing to orient
anybody about. Not a list of ids to keep in step.

⭐ **Duplicate rows now disambiguate** through the same authority the legend chips
and the Display-in menu already use. This list was the ONE surface where two QQQ
series both read `QQQ` — which is exactly the row a member opens to find out
which is which. `QQQ #1` / `QQQ #2`, browser-confirmed.

## ACCESSIBILITY

The summary lives BESIDE the expander, never inside it. Nested in, it joins the
button's accessible name — a screen reader announces "QQQ Line · Own pane" as the
CONTROL's name and the row stops being addressable as `QQQ`. Railed twice: DOM
containment, and an accessible-name check that also refuses an `aria-labelledby`
back door. The expander's name stays the instance.

## ⛔ CSS SCOPE (PART P) — EVERY SELECTOR TOUCHED

| selector | owner | shared? | new? | can Conditions/InfoFields match it? |
|---|---|---|---|---|
| `.actMeta` | ChartSettingsIndicators | no — nothing else renders it | NEW | **no** |
| `.actBlockOff .actMeta` | ChartSettingsIndicators | `.actBlockOff` is shared, `.actMeta` is not | NEW | **no** |
| `.actHeadMeta .actName` | ChartSettingsIndicators | `.actName` is shared; `.actHeadMeta` is not | NEW | **no** |

**Nothing else was modified.** `.actName`, `.actHead`, `.actLabel` and
`.actBlock` stand exactly as they were — verified by diff and pinned by a rail
that reads the stylesheet and asserts the shared `.actName` still carries
`flex: 1 1 auto`, and that every rule shrinking it is scoped by `.actHeadMeta`.

**Why the old bug cannot recur.** The overnight version wrote
`.actName { flex: 0 1 auto }` GLOBALLY. The override is now reachable only
through a modifier that `ChartSettingsIndicators` applies to a row that HAS a
summary — so a component that renders no summary cannot match it, by class
ownership rather than by `:has()` or a global selector. The rail fails if anyone
globalises it again (bitten).

## ⚠️ A CORRECTION TO THE BRIEF'S PREMISE

**`ChartSettingsConditions.jsx` and `ChartSettingsInfoFields.jsx` do not exist on
this branch.** They belong to the conditions/info-fields initiative that Phase 1
deliberately did not port. On the originating branch each renders `styles.actName`
once — which is where the shared-class claim comes from.

So the `.actName` leak was **latent here, not active**: the global rule would have
broken nothing today and everything the moment that initiative lands. The scoped
fix is still exactly right; what changes is the evidence available for it.

Browser-verified in its place:
* the modal's tabs are Price Style · Canvas · Indicators · Header · Markers —
  **no Conditions tab, no Info Fields tab**;
* the **Header tab (which holds the Info Row)** contains **zero** elements using
  any `act*` class — it is built from `hdrRowCtl` / `infoRowHead` / `modeRow`, so
  the Indicators CSS cannot reach it at all.

## ⚰️ THE DEFECT THE BROWSER FOUND, AND JSDOM COULD NOT

With `.actName` scoped to `flex: 0 1 auto` and `.actMeta` also `0 1 auto`,
**nothing in the row grew** — so every summarised row's trailing controls packed
LEFT: measured 148 / 162 / 173px short of the right edge, while fixture rows sat
flush. That is the known defect RELOCATED rather than fixed.

Growing and shrinking are not opposites here: `.actMeta` must be `flex: 1 1 auto`
so it absorbs the free space, with `min-width: 0` so it still ellipses when there
is none.

**Proven at three widths** — natural, 420px and 340px: every row, with a summary
and without, is flush right (gap 0) and 39px tall; at the narrow ones the
METADATA ellipses, longest first, and nothing wraps.

## BROWSER PROOF (PART O) — on `pane-harness.html`, /charts never opened

| # | scenario | result |
|---|---|---|
| 1 | QQQ · Line · Own pane | ✅ fixtures silent, modifier only on summarised rows |
| 2-3 | switch to Candles | ✅ `Candles · Own pane`, live, no reopen |
| 4-5 | SPY into QQQ's pane | ✅ `Line · QQQ` — the human label, never an id |
| 6-7 | delete the host | ✅ `Line · Pane unavailable`, in place, no fallback to Own pane |
| 8-9 | add MA(QQQ) | ✅ `Line · Own pane · Source: QQQ` |
| 10-11 | hide QQQ | ✅ MA still reads `Source: QQQ` — visibility is ink |
| 12-13 | repoint QQQ → NVDA | ✅ row becomes `NVDA`; the MA's own source is untouched |
| 14 | duplicates | ✅ `QQQ #1` / `QQQ #2` |
| 15 | Conditions tab | ⚠️ **does not exist on this branch** — see above |
| 16 | Info Row (Header tab) | ✅ zero `act*` elements; no leakage possible |
| 17 | preference writes | ✅ **refused: 0** throughout |

## BITE CHECKS — six, each reverted

| mutation | result |
|---|---|
| style dropped from the summary | 6 red |
| pane dropped | 6 red |
| source dropped | 2 red |
| summary nested inside the expander | the 2 accessibility cases red |
| scoped modifier removed | the modifier case red |
| fixture-silence guard removed | the engine-row case red |
| the GLOBAL `.actName` override restored | the stylesheet rail red |

⚰️ **One came back green and is why there are 17 rails and not 16.** The obvious
fixture case — EMA 9, SMA 200, Volume — passes for a DIFFERENT reason than it
looks: those are LEGACY overlay rows, not engine-owned, so the summary refuses
them on its first line and the `options.length` guard is never reached. Deleting
that guard left the suite green. The added case uses `bb`, an engine definition
with one place to draw, which is the guard's actual subject.

## RESULTS

| | |
|---|---|
| `src/components` | **4 failed / 10403 passed** vs Phase 4's 4 / 10386 — **+17, zero regressions** |
| Build | ✅ |
| StockChart | **untouched** (Part R) |

## PART S — CANDLE-COLOUR CONTROL: DEFERRED, WITH THE REASON

The writer (`setInstanceCandleColor`) and the resolver (`resolveCandleColors`,
which already reads per-instance overrides) both exist from Phase 2. What does
NOT exist is a route: the modal's `colorSwatch` addresses a target string
`ind:<rowId>:<field>` which `splitIndTarget` resolves into an INPUT write. Candle
colours are not inputs — they live in `instance.presentation`. Adding the control
needs a new target namespace, a new branch in the modal's colour-apply path, and
a UX decision about where two swatches sit and whether they are per-output. That
is new plumbing plus new UX decisions, which Part S says to defer.

## REMAINING UNIVERSAL DATA POLISH

* per-instance candle colours (above)
* a **Display in** control in the Indicators tab — the summary reports the pane,
  and today that is changed from the legend/pane menu rather than this tab. Both
  seams (`displayTargetOptions`, `setInstanceDisplayTarget`) are already in use
  here, so it is roughly the size of the style control.
* engine row labels still use the catalogue noun (`Moving Average (Source)`);
  `instanceLabel` would give `MA (5)`. Phase 3 deliberately took only the
  `labelFrom` half of that change.

## RECOMMENDED PHASE 6

1. **The Display-in control**, which closes the loop: every fact the summary
   states would then be editable in the row that states it.
2. Then per-instance candle colours, as the first deliberate step into the
   secondary-series palette — with the target-namespace decision made explicitly
   rather than in passing.

## STANDING FACTS

- Local branch. **Nothing pushed, nothing deployed, nothing merged.**
- `vite build` OK after every slice.
- Main Trading verified READ-ONLY (sqlite, never the browser) at every
  checkpoint: `40d361fa 5354 ea9ebaeee302`, unchanged.
