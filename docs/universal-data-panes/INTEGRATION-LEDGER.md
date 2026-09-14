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

## STANDING FACTS

- Local branch. **Nothing pushed, nothing deployed, nothing merged.**
- `vite build` OK after every slice.
- Main Trading verified READ-ONLY (sqlite, never the browser) at every
  checkpoint: `40d361fa 5354 ea9ebaeee302`, unchanged.
