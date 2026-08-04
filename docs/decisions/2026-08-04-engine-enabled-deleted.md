# Decision: `engineEnabled` is DELETED — the flag that decides nothing stops existing

**Decision id:** `ENGINE_ENABLED_DELETED`
**Status:** ✅ **APPLIED — B5 Task 4, 2026-08-04. Seven sites, 0 changed pixels.**
**Resolves:** `ENGINE_ENABLED_MIGRATION` (`docs/decisions/2026-08-03-engine-enabled-settings-migration.md`) — see its §12.
**Owner of the read that was:** `app/src/components/chart/chartDefaults.js` → `mergeChartSettings`.
**Pinned by:** `app/src/components/chart/engine/__tests__/engineEnabledMigration.test.js`
(the July-blob table, the door-seven payloads, and a comment-stripped source scan of
all of `app/src`) and `enumerationSites.test.js` (the record ⟺ code biconditional).

> **This is not the versioned read-time migration.** §6 R1a of the open record is
> still Task 9's, and it arrives for the DATA — `settingsVersion` 1→2, the fold of
> `cs.indicators.<id>` into `indicatorInstances` below version 2. What this record
> carries is the FLAG, deleted, and the reason deletion is the answer rather than a
> migration: **there was nothing to migrate.**

---

## 1. What deletion means, and why it is not "default it true"

`mergeChartSettings` computed `engineEnabled: parsed.engineEnabled === true`. That
is a read of the STORED BLOB. `CHART_DEFAULTS.engineEnabled` was never consulted
for the key, so:

* an absent key and an explicit `false` were **the same answer**;
* every `chart_settings` row in production predates the engine;
* therefore the flag was `false` for **every user alive**, and **no action a user
  could take made it `true`** — the one write in shipped source was a URL param on
  the headless parity route;
* therefore **flipping the default healed nobody.** It looked like the fix, changed
  nothing for any existing user, and would have moved the branch from "the flag
  decides nothing" to "the flag decides nothing *and* the tests say it does."

Deletion is different in kind, and it works for the same reason the flip did not:
`mergeChartSettings`' return is a **hard allow-list**, so with the line gone the
key is not emitted at all — and a stored `engineEnabled`, whatever it says, is
destroyed on the next read exactly like any other key nobody declared. The open
record's §1 table has one row now, not four.

**And the flag's only remaining job was empty.** §4.1 of that record: it
distinguished a MIGRATED-but-UN-FLIPPED definition from a FLIPPED one. That state
exists only *inside* a migration, for the length of one phase, and no user has an
opinion about it. B5 migrates and flips in the same commit for all ten remaining
natives (adjudication A1), so the state is never created. A key that describes a
condition that cannot occur is not a preference; it is a leftover.

## 2. The seven sites — and the seventh is the one no scope named

The open record's §11.2 says the flag "came to be read by six sites that nobody had
chosen." **It was seven.** The count is recorded here because the extra one is
exactly what an "all six sites" scope would have left behind.

| # | site | what went, and what it cost |
|---|---|---|
| 1 | `chart/chartDefaults.js` — `CHART_DEFAULTS.engineEnabled: false` | the declaration §1 proves nothing consulted. Its comment claimed "THE ENGINE LANDS DARK"; it never did that job |
| 2 | `chart/chartDefaults.js` — `mergeChartSettings` | **the read — the flag itself.** Every other site was downstream of this line |
| 3 | `chart/engine/flipState.js` — `engineDrawnInputs` | the `cs.engineEnabled !== true` guard. **The only deletion here a user could have SEEN:** it returned EMPTY on a flag-off chart, so `ChartToolbar` fell back to the legacy MIRROR — and the flag was off for everyone, so the fallback was the shipped path, not the edge case. Now unconditional |
| 4 | `components/StockChart.jsx` | `engineOn`; `engineActive`'s disjunct; the instance filter's second gate; `engineNeeded`'s disjunct; the share-link **encode** and **decode**; the visibility effect's dependency |
| 5 | `pages/ChartRender.jsx` | **the only write of `true` anywhere in shipped source** — `?instances=` on the headless `/r/chart` route |
| 6 | `pages/charts/ChartsWorkspace.jsx` | `uctDefaultChartSettings()`'s stamp over the frozen July capture |
| 7 | `chart/engine/binder.js` | `sync`'s `ctx.cs && ctx.cs.engineEnabled` fallback. **Named by no brief, no ledger and no scope.** Left in place it would have been a live read of a key that no longer exists, resolving to `undefined` — i.e. permanently OFF — for any caller that omitted `enabled`. `StockChart` always passes it, so this is behaviour-identical; what changes is that "the caller forgot" is no longer silently the same as "the caller said no" |

### 2.1 Two sites that needed no edit, which is the property §6 R2 asks for

`pages/Settings.jsx` (`applyPreset` ×4, `resetToDefaults`) and
`chart/ChartSettingsModal.jsx` (its own Reset) are two of door seven's three
whole-blob writers, and **neither is in the table above**. They spread or clone
`CHART_DEFAULTS`, so they followed the deletion without being touched. That is the
whole reason §6 R2 insists presets must inherit rather than hand-write, and it is
asserted rather than assumed — `engineEnabledMigration.test.js` → *"the three
door-seven writers no longer stamp a key that does not exist"* checks six PAYLOADS
(four presets, `CHART_DEFAULTS`, and the modal's `JSON.parse(JSON.stringify(…))`
clone), while `controlDoorCensus.test.js` keeps the SITE count at three.

### 2.2 ⚠️ `ChartsWorkspace` had to be deleted as a LINE, not assigned `undefined`

`uctDefaultChartSettings()` builds a JSON **string**. Leaving
`parsed.engineEnabled = CHART_DEFAULTS.engineEnabled` in place with the default
gone assigns `undefined` — and **`JSON.stringify` drops an `undefined` value**, so
the emitted string is byte-identical either way. Every test that reads the OUTPUT
passes on the half-deletion. Only a source scan can tell the two apart, which is
why `engineEnabledMigration.test.js` runs one over all of `app/src`, comment-
stripped, and asserts it empty.

## 3. `engineOwned` went with it — a chain producing a value nothing read

Found by B5 Task 1 reading the code rather than the ledgers, recorded in the open
record's §11.4, and deleted here.

Measured on `StockChart.jsx`, comments stripped: **`engineOwned` occurred exactly
once — its own declaration.** `engineOwnedDefIds` twice (the import and that call);
`EMPTY_OWNED` twice (its declaration and that line's `else` arm). The whole chain
existed to produce a value with no reader.

It was the Flip-A arbiter: a legacy block guarded on `!engineOwned.has('X')`. **Flip
B deleted the blocks rather than guarding them**, so the last consumer went with
`macd` and `vwap` at `400005ee`. And `enumerationSites.test.js` → *"keeps no Flip-A
guard for a flipped id — the block should be GONE, not guarded"* asserts that no
such guard may exist while `FLIPPED === MIGRATED` — **so that rail demands the
emptiness it produced, and the leftover is invisible to it by construction.**

**Five comment paragraphs went on calling it "the arbiter"** (`:5660-5663`,
`:5703-5709`, `:5780-5783`, `:5910-5914`, `:6293-6295`), in the present tense,
describing a guard shape the same suite asserts cannot exist. They are **rewritten
in the past tense, not deleted** — "why is there no arbiter?" is a question the next
reader would otherwise ask of an empty space.

⚠️ `engineOwnedDefIds` **itself is not dead**: it is `paneMarginsProjection.js`'s
stated model and keeps its own suite. Only StockChart's call was.

## 4. What a stored July blob does — MEASURED, not argued

Driven from a JSON **string** through the real `mergeChartSettings`, the way
`flipBStoredBlobs.test.jsx` drives its twenty-five, because a fixture built as an
object skips the parse — and the parse is the step at which "absent" and "explicitly
false" became the same answer (§6 R3).

**The user does nothing.** No reset, no re-tick, no re-login.

| | before (669542f9) | after |
|---|---|---|
| `cs.engineEnabled` | `false` | **the key does not exist** |
| `cs.indicatorInstances` | `[]` | `[]` |
| RSI `enabled` / `period` / `color` | `true` / 9 / `#ff00aa` | unchanged |
| BB `period` / `stdDev` / `color` | 34 / 3 / `rgba(1,2,3,0.5)` | unchanged |
| MACD fast/slow/signal + both colours | 8 / 21 / 5 | unchanged |
| VWAP `color` / `opacity` / `lineStyle` / `lineWidth` | `#abcdef` / 40 / `dashed` / 3 | unchanged |
| Stochastic `kPeriod` / `dPeriod` / both colours | 21 / 5 | unchanged |
| ATR `period` / `color` | 21 / `#555555` | unchanged |
| Volume Profile `enabled` / `bins` | `true` / 48 | unchanged |
| RSI / BB / MACD / VWAP drawn by | the engine, from instances projected off the mirror | the same |
| the ten un-migrated indicators | their legacy blocks | the same |
| the reserved bands | `csForPaneMargins` | the same |

Every stored key is compared field-by-field, and the loop's non-vacuity is asserted
(seven sections, and three values named explicitly) — because "the loop found
nothing" and "the loop ran zero times" read identically in a green suite.

**And all 25 of `flipBStoredBlobs.test.jsx`'s blobs render unchanged.** §9 of the
open record predicted this file would move, on the reasoning that "a blob that now
merges engine-on takes a different branch through `engineInstances`". **No blob
changed branch**: nothing merges engine-on, because nothing merges the key at all.

## 5. Parity — 0 changed pixels, both build identities

`mergeChartSettings` is on every chart's path on every surface. This is the **last
commit in B5** at which a change to it can be measured against an unmoved geometry;
after the ten migrations begin, a zero here would be indistinguishable from a zero
there.

**24 live cases · 0 changed pixels · 5/5 runs · `worst=0 tol=0` on every case ·
`rc=0`.**

| side | build identity | bundle |
|---|---|---|
| A — `669542f9`, all sixteen changed `app/src` files reverted IN PLACE | **`25762d202a33`** | `index-pLajgdOG.js` |
| B — `669542f9` + this task | **`c599863eea07`** | `index-CuxJ4Wat.js` |

`same_build: false`; **served == disk on both sides** (`.parity-dist-a` pid 2356,
`.parity-dist-b` pid 92000, 7 files each). Side A was staged by reverting every
file `git diff --name-only 669542f9 -- app/src` named — including the co-located
`*.test.js*`, which an earlier task's mis-scoping omitted — and asserting that diff
EMPTY before building; restored afterwards by sha256 in both directions.

**Fail-proofs on this same pair, all `rc=1`:**

| perturbation | case | changed |
|---|---|---|
| `indicators.vwap.opacity` 100 → 40 | `vwap_only` | **2,601 px** |
| `candles.upColor` → `#1ae51b` | `bb_only` | **2,307 px** |
| `candles.upColor` → `#1ae51b` | `rsi_only` | **1,894 px**, regions `{price_top: 1894, rsi_band: 0, volume_and_axis: 0, rest: 0}` |

The third is the runbook's own measured number for that perturbation, and its
region split is the proof the gate can still say WHERE — not just how much.

⚠️ The case file holds 35 cases — **24 live and 11 `status:placeholder`** — and 24
run by default. Naming all 24 explicitly on the command line exits 1, because
`--cases` resolves placeholders too. The plan's "44-case zero" does not exist.

## 6. The pane manifest's one line

Task 3 exposed `window.__paneManifest` on `pages/ChartRender.jsx` as a configurable
getter over a one-slot registry in `engine/paneLayout.js`, and left the hand-off
open: **`StockChart` exposes its `IChartApi` through no prop, no ref and no
callback**, so the chart has to announce itself, and `StockChart.jsx` is this task's
file. The line is in the `createChart` branch — the only place a chart's identity
changes — and its unregister is released beside `chart.remove()` in the unmount
cleanup.

It reads `null` before this commit, which is Task 2's contracted pass
(`manifest_diff(None, None) == []`). Contract compliance:

* **JSON-serialisable** — `paneManifest` emits numbers, strings and `null` only.
* **`id` stable, from the pool key** — each series carries the binder binding's
  `key`, derived from the instance id, **never object identity and never a shifting
  index**. The bindings are passed as a **thunk**, not a value: this line runs once
  per chart while the binder is rebuilt whenever the instance list moves, so a
  captured array would name series that are no longer on the chart.
* **panes sorted by index** — `chart.panes()` order, with each pane's own
  `paneIndex()`.
* **series in INSERTION ORDER** — `pane.getSeries()`, unsorted, deliberately:
  **order IS z-order and SHOULD diff.**
* ⛔ `series.priceScale().priceScaleId?.()` **does not exist in LWC 5.2.0**. The
  scale id comes from `series.options().priceScaleId`.
* The thunk returns `[]`, never `null`, when no binder exists — `paneManifest`
  treats a non-array as "no bindings" and would report every `key` as `null`, which
  reads identically to a chart whose engine drew nothing.

**Measured, on side B of the parity pair, case `bb_only`** — the manifest side A
cannot publish because it predates this line:

```json
{"chartHeight": 532, "separatorPx": 1, "panes": [
  {"index": 0, "height": 414, "stretchFactor": 78, "series": [
     {"type": "Candlestick", "scaleId": null,    "key": null},
     {"type": "Line",        "scaleId": "right", "key": "legacy:bb::upper"},
     {"type": "Line",        "scaleId": "right", "key": "legacy:bb::middle"},
     {"type": "Line",        "scaleId": "right", "key": "legacy:bb::lower"}]},
  {"index": 1, "height": 117, "stretchFactor": 22, "series": [
     {"type": "Histogram", "scaleId": "right", "key": null},
     {"type": "Line",      "scaleId": "right", "key": null}]}]}
```

The three BB lines carry their POOL KEYS in insertion order; the candle and the two
volume series are legacy and carry none, which is the honest answer rather than a
guess. ⚠️ The candle's `scaleId` is `null` because the legacy candle series names no
`priceScaleId` at all and lets LWC resolve the single visible scale — the same fact
the runbook records about the engine naming it where legacy did not.

⚠️ **Every case in the main run therefore reports `manifest_diff = 1 line`:**
`manifest missing on A`. That is the asymmetry this task creates on purpose, and the
harness reports it without failing — `manifest_verdict` only raises "the manifest
changed but 0 pixels did" when BOTH sides are comparable. Task 2 designed that
asymmetry rule; this is the first commit to exercise it.

## 7. Control rot corrected in this commit

Four, all of them present-tense prose about mechanisms that had already gone:

1. **`StockChart.jsx` ×5** — the "arbiter" paragraphs, §3 above.
2. **`flipState.js`** — *"`ChartToolbar`'s `engineInert` is now identically false.
   The predicate and its 34 row bindings STAY (they are what a B4 migration
   reactivates)"*. **B4 Task 8 deleted all of it** — `engineInert`, `inertTitle`,
   `shownInput` and the bindings — when spec §6 replaced the fifteen per-indicator
   rows with one launcher, and retargeted `ChartToolbar.engineInert.test.jsx` to
   assert they stay gone. ⚠️ The Task-4 brief's Step 3 still instructed *"delete
   `engineInert` and `inertTitle`"*; there was nothing left to delete.
3. **`flipState.js`** — the `ENGINE_MIGRATED_DEF_IDS` header defining the set as
   *"exactly those whose legacy block carries `&& !engineOwned.has('<id>')`"*, a
   guard shape `enumerationSites.test.js` asserts cannot exist for any member.
4. **`ChartRender.jsx`** — the `?instances=` paragraph explaining that the param
   "also sets `engineEnabled: true`", and a sub-note reasoning about arming the flag
   through `?indicators=`.

## 8. What is NOT resolved here

The **mirror**. `CHART_DEFAULTS.indicators`' fifteen keyed sections and
`mergeChartSettings`' fifteen-line allow-list are both fated B5, and §11.1 of the
open record splits them into **Task 9**: `settingsVersion` 1→2, a read-time fold of
`cs.indicators.<id>` into `indicatorInstances` **only below version 2** so a deleted
indicator never returns, `CHART_DEFAULTS.indicators` shrunk to `volumeProfile`, the
allow-list to one line — asserted **by what it destroys**. That is §6 R1a, arriving
for the data rather than for the flag.

⚠️ And `PRESETS[*].settings.settingsVersion` must be the NEW version when it lands,
or a theme click writes a blob the migrator re-migrates forever (§6 R2).
