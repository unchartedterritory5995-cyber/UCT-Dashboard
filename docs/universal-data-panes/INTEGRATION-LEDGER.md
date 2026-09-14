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

## STANDING FACTS

- Local branch. **Nothing pushed, nothing deployed, nothing merged.**
- `vite build` OK after every slice.
- Main Trading verified READ-ONLY (sqlite, never the browser) at every
  checkpoint: `40d361fa 5354 ea9ebaeee302`, unchanged.
