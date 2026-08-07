import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ENGINE_OWNED } from '../flipState'
import { listIndicators, listEngineIndicators } from '../../indicatorRegistry'
import { CHART_DEFAULTS, mergeChartSettings } from '../../chartDefaults'
import { uctDefaultChartSettings } from '../../../../pages/charts/ChartsWorkspace'
import * as engineRegistry from '../nativeRegistry'
import { REGISTRY_SIZES } from '../registrySizes'
import { stripComments, stripPyComments } from './sourceScan'

// ─── THE ENUMERATION LEDGER ─────────────────────────────────────────────────
//
// "The indicator list is currently enumerated in SEVEN places" is the sentence
// `indicatorRegistry.js` opened with in July 2026, and the whole indicator
// platform exists to end it. The B3 plan counted SIXTEEN. Task 2's review walked
// all sixteen and found five more; its re-review found a twenty-second, in a
// PAGE component no chart-module walk had opened. Task 12 walked it again and
// counted THIRTY-TWO.
//
//     7 → 16 → 20 → 21 → 22 → 32.
//
// Six counts, five of them wrong, and every correction came from someone reading
// the code instead of the previous number. Nothing ever FAILED as it grew,
// because a comment cannot hold a number down. This can.
//
// ⚠️ THE COUNTING CONVENTION IS PART OF THE NUMBER. One entry per
// (file, contiguous REGION) that a new indicator — or a migrating one — has to
// be edited into. The plan's 22 used a looser convention that collapsed two
// regions in one file into one row (site #13's two keyboard regions) and did not
// count the regions those commands are CONSUMED in. Most of 22 → 32 is that
// convention plus five genuinely new finds, not five new hazards; the delta is
// itemised in `.superpowers/sdd/2026-08-02-phase-b3-migration/task-12-report.md`.
//
// ⚠️ SOURCE-TEXT ASSERTIONS ARE BRITTLE BY NATURE. That is ACCEPTED here,
// because the failure they catch is A DELETION SOMEBODY FORGOT, which no
// behavioural test can see — the code simply is not reached. Every anchor below
// must appear EXACTLY ONCE, so a marker that moves, is renamed, or is duplicated
// says so by name instead of passing vacuously. That is the difference between
// this and a `grep` in a comment.

/** The repo root, found by walking up from wherever vitest was invoked.
 *  `import.meta.url` is an http: URL under this environment's vite transform
 *  (see `flipB.test.jsx`), so it cannot be used, and `process.cwd()` is `app/`
 *  for the documented runner and the repo root for some editors — walking finds
 *  both and THROWS BY NAME if neither. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`enumeration ledger: could not find the repo root from ${process.cwd()}`)
})()

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** A deterministic ramp long enough for every native's longest lookback
 *  (ichimoku's senkouB is 52; adx needs 2x its period). Local rather than
 *  imported so this file stays dependency-free on the engine's test fixtures. */
const PROBE_BARS = Array.from({ length: 300 }, (_, i) => {
  const base = 100 + Math.sin(i / 7) * 8 + i * 0.05
  return { t: 1_700_000_000 + i * 86_400, o: base, h: base + 1.5, l: base - 1.5,
    c: base + Math.cos(i / 5) * 0.8, v: 1_000_000 + (i % 17) * 5_000 }
})

/** Comments say things like "⛔ NO `rsiSeriesRef`", so a bare `includes` on an
 *  identifier finds the note that says it is gone. Every source probe below
 *  therefore matches a CODE SHAPE — `x.current`, `const x`, `f(` — never a bare
 *  name. Task 11 hit the same trap from the other side: six files carry comment
 *  references to constants it had just deleted. */
const usesRef = (src, ref) => new RegExp(`${ref}\\s*\\.\\s*current`).test(src)
const declaresRef = (src, ref) => new RegExp(`const\\s+${ref}\\b`).test(src)
const calls = (src, fn) => src.includes(`${fn}(`)

/** Every `compute*` name a source text imports from `chart/indicators`.
 *
 *  ⭐ THE ONE GUARD IN THIS FILE THAT IS BEHAVIOURAL RATHER THAN FORMAT-EXACT.
 *  `RETIRED_BY_B5_TASK8`'s four patterns describe SHAPES that must not come
 *  back; this describes a PROPERTY that must hold — StockChart computes nothing
 *  — and a re-added import with no caller satisfies every one of those four
 *  patterns while breaking this. `toHeikinAshi` is deliberately NOT matched: it
 *  is a candle transform, not an indicator, and it is the only thing the import
 *  is allowed to carry.
 *
 *  ⚠️ MULTIPLE import statements are walked, not just the first — re-adding a
 *  SECOND `import { … } from './chart/indicators'` line is the easiest way to
 *  bring one back without touching the line that is already there. */
const computeNamesIn = (src) => [
  ...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/chart\/indicators'/g),
].flatMap(m => m[1].split(',').map(x => x.trim()).filter(x => /^compute[A-Z]/.test(x)))

/** …and the SAME extractor over a historical revision of the same file, so the
 *  `[]` above is measured against a known non-empty answer rather than trusted.
 *
 *  ⛔ THROWS BY NAME rather than returning `[]` when git cannot produce the
 *  file. A non-vacuity control that answers `[]` on failure asserts the same
 *  thing as the case it is guarding, which is the shape B4 measured a
 *  "throws by name" guarantee failing to have. */
const computeNamesAt = (sha) => {
  let src
  try {
    src = execFileSync('git', ['show', `${sha}:app/src/components/StockChart.jsx`],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    throw new Error(
      `computeNamesAt: git could not read StockChart.jsx at ${sha} (${e && e.message}). `
      + 'This is the NON-VACUITY control for "imports no compute function"; returning an '
      + 'empty list here would make that case assert nothing.')
  }
  return computeNamesIn(src)
}

/** Which indicator ids a source text hand-names, by the discovery scan's own
 *  three shapes: a quoted id, an object key, an optional-chained read.
 *
 *  ⚠️ HOISTED SO THE SCAN AND ITS CONTROL SHARE ONE PREDICATE. A control that
 *  re-types the regexes proves that the re-typed regexes work, which is not the
 *  claim — and this branch has already shipped one control that measured a
 *  hand-copy against a hand-copy. */
/** ⭐⭐ B5 TASK 9 — DERIVED FROM THE REGISTRY, NOT FROM THE BLOB, AND THIS IS THE
 *  CONTROL THAT ROTTED HARDEST. It read `Object.keys(CHART_DEFAULTS.indicators)`,
 *  which Task 9 shrank to ONE key — so `namesIndicators` could return at most 1,
 *  the four-or-more floor became unreachable, and THE WHOLE DISCOVERY SCAN would
 *  have gone permanently, silently green. A scan that finds nothing is a broken
 *  scan, not a clean tree, and this is the line that decides which it is.
 *
 *  The definitions plus the carved-out sections are the same fifteen ids the blob
 *  used to carry, and they are now where an indicator's identity actually lives. */
const INDICATOR_IDS = [
  ...engineRegistry.listDefinitions().map(d => d.id),
  ...Object.keys(CHART_DEFAULTS.indicators),
]
const namesIndicators = (src) => INDICATOR_IDS.filter(id => (
  new RegExp(`['"]${id}['"]`).test(src) ||
  new RegExp(`(?<![A-Za-z0-9_$])${id}\\s*:`).test(src) ||
  new RegExp(`(?<![A-Za-z0-9_$])${id}\\?\\.`).test(src)
))

// ─── THE SITES ──────────────────────────────────────────────────────────────
//
// `fate` is who retires it, and it is the column B4 inherits:
//   'B3'    retired by this phase (kept in the table with the retirement asserted)
//   'B4'    the §6 settings-dialog rework + the legend rewrite
//   'B5'    the cutover — the legacy `cs.indicators` section itself, and the
//           layout that stacks it: Flip C, when bands become real LWC panes
//   'C'     the Phase-C alert-engine rebuild (spec §8): closed-bar evaluation,
//           `prev` derived from the computed series, `last_value` demoted to
//           delivery-dedup. A dict of Python closures cannot be derived from a
//           JS definition, and porting six more computes into a lane C is about
//           to replace is what spec §9.5 ("no eager 15-indicator port") forbids.
//           B4 collapses its FRONTEND twin into it; retiring the list is C's.
//   'keep'  a data file or the surviving registry: it legitimately lists things
//   'phase' the migration's own bookkeeping; it is deleted when the migration is

const LEDGER = [
  // ── the settings blob ────────────────────────────────────────────────────
  // ⭐⭐ RETIRED BY B5 TASK 9, BOTH OF THEM, TOGETHER — `CHART_DEFAULTS.indicators`'
  // fifteen keyed sections and `mergeChartSettings`' fifteen-line per-key
  // allow-list. They were ONE mechanism: the table declared the sections and the
  // allow-list is what let them survive a read, and neither meant anything
  // without the other. Both are down to `volumeProfile`, the one key with no
  // definition and no flip.
  //
  // ⛔ PROVEN GONE BEHAVIOURALLY, NOT BY ANCHOR TEXT, in `RETIRED_BY_B5_TASK9`
  // below — because a hard allow-list is a thing that DESTROYS, and destruction
  // is what a source-text guard cannot see: it cannot tell a deleted line from a
  // renamed one, and B4 measured a demand-zero guard staying green against a
  // reintroduction with only the spaces around `=` removed.

  // ── StockChart's render lane ─────────────────────────────────────────────
  // ⭐⭐ RETIRED BY B5 TASK 8, ALL FOUR OF THEM, TOGETHER — the series `useRef`
  // declarations, the `indicatorData` memo, the hand-written render blocks and
  // the hide-all ref array. They were ONE mechanism: refs held the series the
  // blocks created, the memo computed what the blocks drew, and the array hid
  // what the refs held. `adx`, `obv` and `donchian` were the last three
  // definitions any of them served, so all four empty in the same commit and
  // there is not one hand-written indicator render block left in the file.
  //
  // ⚠️ THE `useRef` ROW'S ANCHOR HAD MOVED THREE TIMES WITHOUT THE SITE MOVING
  // — `stochKRef` (B5 Task 5) → `sarSeriesRef` (Task 6) → `mfiSeriesRef` (Task
  // 7) → `adxSeriesRef` — and the render-block row's twice. Every one of those
  // went RED BY NAME rather than passing on a region that had emptied, which is
  // the whole reason an anchor is an exact string and not a regex. This time
  // there is no successor to move to, so they RETIRE: proven gone in
  // `RETIRED_BY_B5_TASK8`, which re-runs all four anchors as `\s+`-tolerant
  // patterns and demands ZERO matches — plus one BEHAVIOURAL guard a
  // format-exact pattern cannot make (StockChart imports zero `compute*`
  // functions), because B4 measured that reintroducing a literal with only the
  // spaces around `=` removed left a demand-zero guard green.
  // ⭐ RETIRED BY B4 TASK 10, TOGETHER — the nine crosshair value reads, the
  // hand-written `legChips` array and `readout.LEGACY_SLOTS` were one mechanism
  // and could only go as one. Proven gone in `RETIRED_BY_B4_TASK10`.
  //
  // ⭐ AND THE SECOND LANE B4 BUILT IN THEIR PLACE IS ITSELF RETIRED, BY B5 TASK
  // 6. `legacyChipEntriesRef` / `registerLegacyChip` / `csIndicatorsRef` /
  // `LEGACY_CHIP_ORDER` existed because six of the nine chips belonged to
  // definitions with no bindings; Task 5 moved three onto the engine and Task 6
  // moved the last three (sar, ichimoku ×2), leaving zero registrations. Proven
  // gone in `RETIRED_BY_B5_TASK6` — as IDENTIFIERS, comment-stripped, because a
  // dead registrar with no callers reads exactly like a live one.

  // ── StockChart's control doors ───────────────────────────────────────────
  // ⭐ RETIRED BY B4 TASK 5. `handleCopyShareUrl` hand-listed exactly the four B3
  // pilots, so "Copy chart link" SILENTLY DROPPED every other indicator — a link
  // shared from a chart with Stochastic and ATR on arrived with neither, and
  // nothing said so. The callback still exists (it is the share door, not a list),
  // but it enumerates nothing: `catalogRows()` supplies the keys and
  // `isIndicatorEnabled` supplies each answer. Like `i-hide` at Task 3, it stops
  // being a region a new indicator has to be edited into, which is what this
  // ledger counts. Proven gone in `RETIRED_BY_B4_TASK5`.
  // ⭐ THE LEDGER'S #13 WAS UNDER-ENUMERATED THREE WAYS, AND B4 TASK 4 RETIRED
  // ALL FOUR OF ITS REGIONS. It named "Ctrl+I / Ctrl+O" — two shortcuts, one
  // file. There are FOUR indicator chords (Ctrl+I rsi, Ctrl+O macd, Ctrl+B bb,
  // Alt+U vwap) across FOUR regions in TWO files: `SHORTCUTS` and
  // `matchShortcut`'s Ctrl branch DECLARED them, StockChart's `toggle:` switch
  // and its Alt block CONSUMED them. All four are gone — see
  // `RETIRED_BY_B4_TASK4` below, and `INDICATOR_CHORDS` two entries down, which
  // is what replaced them.

  // ── layout, labels, the toolbar ──────────────────────────────────────────
  // ⛔⭐ RETIRED AT B5 TASK 12 (Flip C, 2026-08-05). `paneMargins.PANES` — ten
  // {key, enabled, baseH} rows handing each enabled oscillator a stacked band —
  // stood here as the LAST `B5`-fated row, and B4's adjudication A2 upheld that
  // fate on the grounds that "it retires when bands stop being bands". They did.
  // The file is DELETED, and its three facts are three different things now: the
  // nine `baseH` values are `placement.pane.height` on the definitions, the stack
  // ORDER is `instances.SHIPPED_STACK_ORDER` (which the v1→v2 fold seeds into
  // every user's instance list), and the volume row is
  // `paneLayout.VOLUME_PANE_HEIGHT`, one constant. `paneMarginsProjection.js`,
  // which existed only to keep that table's second input honest, retires with it
  // — there is ONE copy of the band arithmetic now (`computePaneLayout`), so
  // there is nothing left to project.
  //
  // ⛔ THE ROW IS GONE, NOT RE-FATED. A retired site LEAVES the ledger; a site
  // whose fate letter changes is a site somebody still has to edit. The
  // file-existence and no-importer rails live in
  // `__tests__/flipCGeometry.test.jsx`; `paneLayout.test.js` holds the
  // "the facts arrived" half.
  // ⭐ RETIRED BY B4 TASK 8. The fifteen hand-written indicator rows are one
  // "Manage indicators →" launcher (spec §6). Every control they carried is on
  // the generated dialog, which reaches inputs this surface never could —
  // `sar.maxStep`, six of `ichimoku`'s eight, MACD's two colours, VWAP's opacity
  // / line style / line width. Proven gone in `RETIRED_BY_B4_TASK8`.

  // ── the settings tab ─────────────────────────────────────────────────────
  // ⭐ RETIRED BY B4 TASK 6. `ENGINE_ROW_DEF_IDS` — "which migrated definitions
  // still need a row because the toolbar cannot express their inputs" — is
  // DELETED, and the rail at the bottom of this file that demanded its deletion
  // fired exactly as written. `listEngineIndicators` walks
  // `registry.listDefinitions()`, so there is no list of which ids get a row and
  // nothing for a new indicator to be edited into. Proven gone in
  // `RETIRED_BY_B4_TASK6`, and its successor rail — *every declared input of
  // every definition is reachable from the generated dialog* — is at the bottom
  // of this file where the retired one used to be.

  // ── the keyboard ─────────────────────────────────────────────────────────
  // ⭐ FOUR REGIONS BECAME ONE, AND THE ONE IS A `keep`. B4 Task 4 generated the
  // help sheet's four indicator rows and `matchShortcut`'s Ctrl map from this
  // table, and collapsed the two consumers into one `toggleIndicatorById`.
  //
  // It IS on the ledger — it names four indicator ids, so the discovery scan
  // below flags the file and must find it here — but its fate is `keep`, for the
  // same reason `RAW_DEFS` is: a key binding is irreducibly a (key, indicator)
  // pair and no definition can declare "Ctrl+I". What it is NOT is a region a
  // NEW indicator has to be edited into, which is what the four it replaced were:
  // an indicator without a chord simply has no chord, and adding one is now a
  // deliberate edit in ONE place instead of four across two files.
  { file: 'app/src/components/chart/keyboardShortcuts.js', region: 'INDICATOR_CHORDS — the four chord bindings, declared once',
    anchor: 'export const INDICATOR_CHORDS', fate: 'keep' },

  // ── alerts ───────────────────────────────────────────────────────────────
  // ⭐ RETIRED BY B4 (`0d0d4c93`, the alert-catalog task). `INDICATORS` and
  // `CONDITIONS` — a five-part frontend twin of `INDICATOR_FUNCS` that already
  // DISAGREED with it — are gone; the popover fetches
  // `GET /api/indicator-alerts/catalog`, derived from the evaluator, so the
  // dropdown can no longer offer an alert that cannot fire. Proven gone in
  // `RETIRED_BY_B4_ALERTS`. ⚠️ Recorded HERE, by Wave A, because this file has
  // exactly ONE writer this phase — a ledger with two writers is how a
  // retirement lands with nobody's count moving.
  // ⭐ B4 ADJUDICATION A4 (2026-08-03). DEFERRED to Phase C, not retired by B4.
  // Eight Python closures cannot be derived from a JS definition, and spec §8
  // REBUILDS this evaluator in C. Deriving it in B4 would mean porting compute
  // for six more indicators into a lane C is about to replace — spec §9.5's
  // "no eager 15-indicator port", verbatim. What B4 does instead is stop it
  // being a TWIN: `IndicatorAlertPopover`'s INDICATORS + CONDITIONS are served
  // from the module that owns the evaluation, so the dropdown cannot offer an
  // alert that cannot fire, and this becomes the ONE naming authority.
  // ⭐⭐⭐ PHASE C TASK 10 — `INDICATOR_FUNCS` RETIRED, AND THE ROW DID NOT LEAVE.
  //
  // The 28-row hand-written dict of value closures is GONE: it is DERIVED from
  // `alert_series.SERIES_FUNCS` now (a value is the last non-None element of a
  // column, which is the definition rather than a coincidence), and the
  // retirement is proven BY IDENTITY in `RETIRED_BY_C_TASK10` — the old anchor,
  // `INDICATOR_FUNCS: dict[str,`, re-run under the same regex that used to
  // demand exactly one and now demands ZERO.
  //
  // ⚠️ BUT THE FILE STILL HAND-LISTS ADDRESSES, AND THAT WAS MEASURED, NOT
  // ASSUMED. Task 10's brief predicted the Python discovery scan would either
  // stop finding this file (row gone, `SITE_COUNT` 8 → 7) or keep finding it.
  // It KEEPS finding it, on `ALERT_CONDITIONS` / `ALERT_LABELS` /
  // `ALERT_BASE_LABELS`, which quote `"rsi"`, `"macd"`, `"bb"`, `"vwap"`,
  // `"stoch"`, `"mfi"`, `"cci"`, `"atr"`, `"adx"`, `"obv"`, `"donchian"` and
  // `"sar"` as code. So the row is RE-POINTED at the enumeration that actually
  // survives instead of being deleted — a deleted row here plus a file the scan
  // still names is exactly the "unledgered site" failure two tests down.
  //
  // ⛔ FATE `keep`, AND IT IS AN ARGUMENT RATHER THAN A DEMOTION. WHICH
  // CONDITIONS an address offers is a product decision nothing can derive: does
  // `macd` offer `cross_zero`? does `bb` offer `touch_upper` instead of a
  // threshold? does `obv` get a zero line? Those answers are not in any chart
  // definition and never will be — the registry describes how a plot is DRAWN.
  // Same shape as `_INDICATOR_ALIASES` two rows down, which was already `keep`
  // for the same reason.
  { file: 'api/services/indicator_alert_evaluator.py', region: 'ALERT_CONDITIONS — which conditions each address offers, a product decision nothing derives',
    anchor: 'ALERT_CONDITIONS: dict[str, list[dict]] = {', fate: 'keep' },
  // ⭐⭐ PHASE C TASK 5 — THE PYTHON SCAN CAUGHT THIS ROW BEFORE A HUMAN DID, AND
  // IT CAUGHT IT ON THE COMMIT THAT CREATED IT. `alert_series.SERIES_FUNCS` is
  // the closed-bar lane's `address → FULL aligned column` table: the same 30
  // addresses as `INDICATOR_FUNCS` + `EVENT_FUNCS`, differing only in returning
  // the whole column instead of `_last_non_none(...)` of it. That contract change
  // is what makes `prev` the PREVIOUS BAR rather than the previous 60-second
  // poll, i.e. it is the mechanism Phase C exists for — but it is unarguably a
  // SECOND hand-listing of the same enumeration, so it belongs here.
  //
  // Fate `C`, THE SAME AS ITS TWIN, because the two retire together or not at
  // all: both are hand-written Python closures that cannot be derived from a JS
  // definition (B4 adjudication A4, verbatim), and the day the Python alert lane
  // reads the engine registry instead, it stops hand-listing addresses in BOTH
  // places in one edit.
  //
  // ⚠️ AND THAT FATE IS NOW A PREDICTION AT RISK, SAID OUT LOUD RATHER THAN LEFT
  // TO ROT. `C` means "Phase C retires it". Phase C's evaluator rebuild is THIS
  // TASK, and it did not retire `INDICATOR_FUNCS` — it added a twin beside it,
  // deliberately (the eight legacy closures and the delivery wrappers are pinned
  // by 5,040 recorded rows, and re-deriving them is a change to what an armed
  // alert computes, which is exactly what this task is forbidden to do). So both
  // `C` rows now describe a retirement no remaining Phase C task has claimed. A
  // fate nobody owns is the shape this ledger exists to catch; it is recorded
  // here and handed forward rather than quietly re-fated to `keep`, which would
  // ALSO disarm the Python scan's non-vacuity floor two rows down.
  // ⭐⭐ PHASE C TASK 10 CLAIMED THIS FATE, AND THE ANSWER IS `keep`. The row
  // above predicted *"the two retire together or not at all"*. Half of that was
  // right and half was wrong, and the half that was wrong is the interesting
  // one: they did not retire together — one retired INTO the other. A column
  // determines its last value; a last value determines nothing about a column,
  // so there was never a choice about which twin could survive.
  //
  // ⛔ AND WHAT SURVIVED IS NOT DERIVABLE, WHICH IS WHAT MAKES `keep` HONEST
  // RATHER THAN CONVENIENT. Each row names a PYTHON compute function, a COLUMN
  // INDEX into its tuple output, an input SHAPE (`on_closes`) and a set of
  // DEFAULTS. A chart definition carries none of those: it names a JS `compute.fn`
  // and describes how a plot is drawn. And two of the addresses have no
  // definition to derive from AT ALL — `price_vs_ma` is a spread this lane
  // synthesises (there is no such chart indicator) and `close` is the bar's own
  // price. B4 adjudication A4 said "a dict of Python closures cannot be derived
  // from a JS definition"; that sentence is still true, and it is the reason
  // this row stops being a promise and becomes a fact.
  //
  // ⚠️ THE `C` BUCKET WENT 3 → 1 HERE, AND THE ONE THAT IS LEFT IS HANDED ON,
  // not quietly re-fated — see `_INDICATOR_ALIASES` below.
  { file: 'api/services/alert_series.py',
    region: 'SERIES_FUNCS — address → the full aligned column, and since Task 10 the ONE value table',
    anchor: 'SERIES_FUNCS: dict[str,', fate: 'keep' },
  // ⭐ THE SIXTH SITE THE JS DISCOVERY SCAN STRUCTURALLY CANNOT SEE, found by the
  // wave that fixed the voice bus and added here by this file's one writer. The
  // JS scan walks `app/src/**/*.jsx?` only, so a Python enumeration was invisible
  // to it however many ids it names — which is exactly the shape that turned 7
  // into 32. ⭐⭐ PHASE C TASK 1 CLOSED THAT: the Python scan below sees this file,
  // and this row is now DISCOVERABLE rather than hand-maintained.
  //
  // Fate `C`: it is a PHRASE map, i.e. speech-recognition synonyms, and nothing
  // in a definition declares what a user might say out loud. If it ever becomes
  // derivable it is from `meta.name`/`meta.shortName` plus a synonym list that
  // still has to live somewhere.
  //
  // 🔴 THIS COMMENT USED TO SAY THE MAP CONTAINS `"parabolic sar" → sar`. IT
  // DOES NOT, AND NEVER DID. Measured 2026-08-06: ELEVEN phrases resolving to
  // SEVEN targets — `vwap`, `avwap`, `ma50`, `ma200`, `bb`, `macd`, `rsi`. Two of
  // those seven (`avwap`, `ma50`/`ma200`) are not registry ids at all, and `sar`
  // — the one the comment invented — is the single id the evaluator DELIBERATELY
  // refuses to offer (`_SAR_IS_NOT_OFFERED`), so the invented example pointed at
  // the one place in this codebase where naming `sar` is a decision somebody
  // wrote a paragraph about. A ledger whose whole job is stopping a comment from
  // outliving its subject cannot carry a fabricated example of its own.
  // ⭐⭐⭐ PHASE C TASK 15 ADJUDICATED IT, AND THE ANSWER IS `keep` — SO THE `C`
  // BUCKET IS NOW EMPTY AND THE PHASE ENDS WITH NO FATE IT DID NOT ANSWER.
  //
  // Task 10 handed this forward with a recorded recommendation and no test.
  // Task 15's brief put the case for the other side: Task 14 ships an `avwap`
  // DEFINITION, so at least one entry "becomes derivable" and the derivable half
  // should retire. ⛔ **THAT PREMISE IS FALSE, AND IT IS FALSE BY MEASUREMENT
  // RATHER THAN BY ARGUMENT.** Derivable means "some mechanism produces the id
  // from the phrase", and this tool has exactly one: `_INDICATOR_ALIASES.get(raw,
  // raw.replace(" ", ""))`. Under that fallback `"anchored vwap"` resolves to
  // `anchoredvwap`, which is not a definition — so deleting the row Task 14 is
  // supposed to have made redundant BREAKS the phrase. What Task 14 actually
  // changed is one door further out (`'avwap'` left `NON_DEFINITION_ALIASES` in
  // `chartBusIndicators.js`, so the CLIENT now honours an action it used to
  // refuse); the phrase map is untouched by that and is exactly as irreducible as
  // it was.
  //
  // ⛔ AND "IRREDUCIBLE" IS NOW A NUMBER, NOT AN ADJECTIVE. The case at the
  // bottom of this file DELETES the map and re-resolves all eleven phrases
  // through the shipped fallback: **nine of the eleven change answer.** The two
  // that do not are `"macd"` and `"rsi"`, which are identity rows. The nine are a
  // MISHEARING (`"v-wap"`), two TRUNCATIONS (`"anchored"`, `"bollinger"`), four
  // colloquial MA phrases whose targets (`ma50`, `ma200`) are **not registry ids
  // at all**, and two multi-word names the fallback de-spaces into something else.
  // Nothing in a definition declares what a user says out loud, and two of the
  // seven targets are not definitions — which is the same argument `INDICATOR_CHORDS`
  // makes about a (key, indicator) pair, made in a second vocabulary.
  //
  // ⚠️ THE ROW MOVES BECAUSE A FATE WHOSE CONDITION HAS ARRIVED IS A CONTROL THAT
  // ROTS GREEN. `C` means "Phase C retires it"; Phase C ends at this task. B5
  // Task 13 DELETED two `phase` rows for exactly this reason. This one is not
  // deleted — the file is still an enumeration the discovery scan finds — it is
  // re-fated, with the claim under it turned into an assertion so the next reader
  // gets a measurement instead of a recommendation.
  { file: 'api/services/voice_client_action_tools.py', region: '_INDICATOR_ALIASES — the voice add_chart_indicator phrase map',
    anchor: '_INDICATOR_ALIASES = {', fate: 'keep' },
  // ⭐⭐ PHASE C TASK 1 — THE ROW THE PYTHON SCAN FOUND ON ITS FIRST RUN.
  // `_CASE_COLUMNS` maps a golden-fixture KIND to its COLUMN NAMES, and the two
  // vocabularies are not the same one: `williams_r` here is `williamsR` in the
  // registry, and `vwap_series` exists precisely so `compute_case` cannot answer
  // for the two vwap fixtures whose `expected` is null. A (kind, columns) pair is
  // irreducible, exactly like `INDICATOR_CHORDS`' (key, indicator) pair — so this
  // is `keep`, not a twin to retire.
  //
  // ⛔ AND IT IS THE PYTHON SCAN'S ONLY HONEST FLOOR. The two `C` rows above both
  // retire in Phase C; this one does not. A non-vacuity floor derived from them
  // collapses to `[]` the day they go, and `[].filter(...)` is `[]` — which
  // satisfies the unledgered-site assertion while checking nothing at all.
  { file: 'api/services/indicator_compute.py',
    region: '_CASE_COLUMNS — the golden-fixture kind→columns dispatch',
    anchor: '_CASE_COLUMNS: Dict[str, Tuple[str, ...]] = {', fate: 'keep' },

  // ── the engine ───────────────────────────────────────────────────────────
  // ⭐⭐⭐ PHASE D TASK 1 — THE CLOSED TABLE. Fate `keep`, and the reason is the
  // same one `_CASE_COLUMNS` carries: a (name, arity, semantics) triple is
  // irreducible. No definition can declare the vocabulary that definitions are
  // WRITTEN IN, so this list is not a catalogue a new indicator gets edited into
  // — it is the grammar, and it grows only when the language does.
  //
  // ⛔ AND IT IS THE ONE FILE IN THIS PHASE THAT MUST HAVE EXACTLY ONE WRITER.
  // Two lanes READ it (`interpret.js` and `ast_interpret.py`); a hand-copy in
  // either is a second grammar, and a second grammar drifts silently — which is
  // this ledger's entire subject matter, arriving in a new vocabulary.
  //
  // ⛔⭐ `pending` — THE FILE DOES NOT EXIST YET, AND THAT IS DECLARED RATHER
  // THAN TOLERATED. Task 3 creates it. Until then the anchor `"functions"`
  // cannot match, and there are exactly three things this row could have been:
  //
  //   1. absent — and then Task 3 lands a manifest with nobody's count moving,
  //      which is the *unledgered site* failure this file exists to produce;
  //   2. present with no marker — and then the anchor case is RED for every
  //      task between here and Task 3, which is worse than absent: a rail that
  //      is always red is a rail everybody learns to scroll past, and a REAL
  //      anchor break would arrive as one more line in a failure nobody reads;
  //   3. present and DECLARED PENDING — green today, and it converts itself
  //      into a hard red at the exact moment its subject appears.
  //
  // The third is what is here, and the conversion is not a promise: the anchor
  // case below asserts that a `pending` row's file does **NOT** exist. The day
  // Task 3 writes `closedTable.json`, that assertion fails BY NAME and the only
  // way to green it is to drop `pending` — at which point `"functions"` must
  // appear exactly once, in the shape a manifest actually has. **Task 3 owes
  // the first match.** The anchor is armed; it has simply never fired.
  //
  // ⭐⭐⭐ 2026-08-07 — IT FIRED, AND IT FIRED BY NAME. Task 3 wrote the
  // manifest and this case went red with the row's own sentence in the failure:
  // *"the row is marked pending:'D3' but the FILE NOW EXISTS."* Not a stack
  // trace, not a missing-module error somewhere downstream — the ledger row
  // told the task what it owed. The marker is dropped here and `"functions"`
  // now matches exactly once (measured: `series` 5, `operators` 15, and the
  // functions section 11 = the 31 names the AST corpus already uses, which is
  // why `tools/ast_conformance.py --coverage` went from exit 3 to exit 0 on its
  // first run against a real manifest). **The first match is paid.**
  { file: 'app/src/components/chart/engine/ast/closedTable.json',
    region: 'the closed table — every name a user formula may call',
    anchor: '"functions"', fate: 'keep' },
  { file: 'app/src/components/chart/engine/nativeRegistry.js', region: 'RAW_DEFS — THE ONE THAT SHOULD SURVIVE',
    anchor: 'const RAW_DEFS = [', fate: 'keep' },
  // ⛔⭐⭐ ADDED BY PHASE D TASK 8, AND THE DISCOVERY SCAN FOUND IT BEFORE THE
  // TASK DID. `registrySizes.js` is the one place a registry COUNT lives, and
  // the reason it holds a hand-written list of every definition id — rather than
  // deriving one from `listDefinitions()` — is that a derived manifest is true by
  // construction and can never fail. That is the same argument
  // `CARVED_OUT_INDICATOR_KEYS` already makes one file over, and it has the same
  // consequence: a real, deliberate, sixteen-id enumeration in shipped source.
  //
  // ⚠️ SO THIS IS A GENUINE NEW SITE, NOT AN OVER-MATCH. The task's brief said
  // *"adding a lane adds no enumeration by itself, but verify that by running the
  // scans, not by assuming it"* — the scan was run, it flagged this file by name
  // on the first attempt, and `SITE_COUNT` goes 9 → 10. A task that had reported
  // "no ledger delta" here would have been asserting from memory.
  //
  // ⚠️ AND ITS FATE IS `keep`, WHICH IS A CLAIM ABOUT WHAT IT IS FOR. This list
  // is not a catalogue anything reads to DO work — nothing in the product
  // imports this module — it is the assertion target that the registry has to
  // prove it matches. A future phase that "removes the duplication" by deriving
  // it has removed the rail, not the duplication.
  { file: 'app/src/components/chart/engine/registrySizes.js',
    region: 'SHIPPED_DEF_IDS — the hand-written manifest the registry must equal',
    anchor: 'export const SHIPPED_DEF_IDS', fate: 'keep' },
  // ⛔⭐⭐ ADDED BY B5 TASK 12, AND ADDING IT IS THE HONEST HALF OF A RETIREMENT.
  // Flip C deleted `paneMargins.PANES`, whose three facts went three ways — but
  // one of them, the STACK ORDER, is a list of ids and a list of ids has to be
  // written down somewhere. It used to be DERIVED (the migrator called
  // `computePaneMargins` and read its key order back), so it was invisible to the
  // discovery scan; inlining it made the scan flag `instances.js` IMMEDIATELY,
  // which is the scan doing exactly its job. Recording the new site is what stops
  // "8 → 7" being a number that hides a swap.
  //
  // ⚠️ SO THE LEDGER DID NOT SHRINK AT FLIP C. It went 8 → 7 → 8: one row retired
  // and one row was created, and the second is `keep` because this list is a
  // HISTORICAL RECORD rather than a catalogue. A sixteenth indicator does NOT get
  // edited into it — `computeShippedStackOrder` appends any registered id the
  // frozen array does not name — and the fourteen entries must never change,
  // because they are the order every existing user's panes are in.
  { file: 'app/src/components/chart/engine/instances.js',
    region: 'FROZEN_SHIPPED_STACK_ORDER — the retired PANES stacking order, 9 + 5 overlays',
    anchor: 'const FROZEN_SHIPPED_STACK_ORDER = [', fate: 'keep' },
  // ⛔⭐⭐ RETIRED AT B5 TASK 13 — `ENGINE_MIGRATED_DEF_IDS` and
  // `ENGINE_FLIPPED_DEF_IDS`, the last two `phase`-fated rows. Their fate meant
  // *"they describe a state that ends when the migration does"*, and the
  // migration ended: by B5 Task 8 the two literals were EQUAL to each other and
  // to `listDefinitions().map(d => d.id)`, so both were a third copy of the
  // registry. **A `phase` row whose phase has ARRIVED is a control that rots
  // green** — it goes on passing while the thing it described stops existing —
  // which is why they are DELETED rather than re-fated to `keep`.
  //
  // What replaced them is one registry lookup, `flipState.engineOwnsDefId`, and
  // the `ENGINE_OWNED` facade over it: `has`, `size` and iteration all answered
  // by `listDefinitions()` at the moment they are asked. It hand-lists nothing,
  // so it is not a site; and `volumeProfile` — which was absent from both
  // literals because nobody typed it — is now absent because it HAS NO
  // DEFINITION. The two look identical from outside and only one of them
  // survives a fifteenth indicator.
  //
  // ⚠️ THE GUARANTEE THEY CARRIED IS NAMED IN `RETIRED_BY_THIS_TASK` BELOW, not
  // dropped: "migrated but not flipped" meant an indicator drawn by NOBODY, and
  // the successor is structural — `StockChart.jsx` imports zero `compute*`
  // functions and holds no hand-written render block, asserted behaviourally in
  // this file.

  // ── everything else that hand-lists indicators ───────────────────────────
  // ⭐ RETIRED BY B4 (`e427a09b`, the voice-bus task, landed by a parallel wave).
  // `ALLOWED_INDICATORS` was a hand-written Set that had never been proven dead —
  // and `subscribeAll` had NO CALL SITE in `app/src`, so `addIndicator()` emitted
  // an event nobody heard while the voice tool reported success. The list derives
  // from `catalogRows()` now and the missing subscriber exists. Proven gone in
  // `RETIRED_BY_B4_VOICEBUS`. Recorded here, by Wave A, for the same reason the
  // alert-catalog rows are: this file has exactly ONE writer this phase.
  // ⭐⭐ RETIRED BY B5 TASK 9. `UCT_DEFAULT_CHART_SETTINGS_JSON` was a frozen
  // capture of all fifteen indicator sections — a third copy of rows 1 and 2, in
  // a PAGE component, and the site no chart-module walk had opened. All fourteen
  // legacy sections are deleted from the literal; `volumeProfile` survives
  // because it is the one key `mergeChartSettings` still emits. Measured
  // behaviour-neutral before the deletion: every one of the fourteen said
  // `"enabled":false`, so the fold produced zero instances from them either way.
  // Proven gone in `RETIRED_BY_B5_TASK9`, and in `ChartsWorkspace.test.jsx`,
  // which reads the shipped literal.
  { file: 'tools/chart_parity_cases.json', region: 'the parity case list',
    anchor: '"cases"', fate: 'keep' },
]

/** What Task 12 RETIRED OUTRIGHT — kept in the file because a retired site that
 *  is merely deleted from a list is indistinguishable from one nobody noticed. */
const RETIRED_BY_THIS_TASK = [
  {
    file: 'app/src/components/chart/ChartSettingsModal.jsx',
    region: 'the hardcoded three-group section list in the Indicators tab',
    // A row in a group nobody had listed rendered NOTHING, silently.
    gone: "'Moving averages', 'Volume'",
  },
  {
    file: 'app/src/components/chart/indicatorRegistry.js',
    region: "VWAP_FIELDS — a verbatim second copy of the definition's four inputs",
    // ⚠️ CODE SHAPE, not the bare name: the header of that file EXPLAINS that
    // VWAP_FIELDS is gone, and a bare `includes` would find the explanation and
    // report the deletion as a regression. Task 11 hit this from the other side —
    // six files carried comment references to constants it had just deleted.
    gone: 'export const VWAP_FIELDS',
  },
]

/** What B4 TASK 4 RETIRED, and PROVEN retired rather than merely unlisted.
 *
 *  ⚠️ TWO OF THE FOUR ARE REGIONS INSIDE A SURVIVING BLOCK, so their old ledger
 *  anchors (`switch (target) {`, `if (e.altKey && …) {`) still appear — the
 *  switch still serves `log`/`theme`/`countdown`/`ma`/`volume` and the Alt block
 *  still serves the watermark, the invert, the settings modal and six more. What
 *  retired is the per-indicator ENUMERATION inside each, so the marker asserted
 *  gone is the enumeration, not the block. */
const RETIRED_BY_B4_TASK4 = [
  {
    file: 'app/src/components/chart/keyboardShortcuts.js',
    region: 'the SHORTCUTS table — four hand-written indicator rows',
    // The rows are `...INDICATOR_CHORDS.map(…)` now. `indicatorCatalog.test.js`
    // re-runs the LABEL parser over this file and demands zero indicator rows;
    // this is the command half of the same retirement.
    gone: "command: 'toggle:rsi'",
  },
  {
    file: 'app/src/components/chart/keyboardShortcuts.js',
    region: "matchShortcut's Ctrl branch — five hand-written if-returns",
    gone: "if (k === 'i') return 'toggle:rsi'",
  },
  {
    file: 'app/src/components/StockChart.jsx',
    region: "the toggle: switch — case 'rsi' / 'macd' / 'bb' and the raw-writing helper they called",
    // ⚠️ CODE SHAPE, not a bare name. `updateIndicator` is DELETED rather than
    // left guarded (an inert helper reads as live logic), and the comment above
    // the pre-switch lookup explains what it used to do — a bare `includes` on
    // the identifier would find the explanation and report a regression.
    gone: "case 'rsi': updateIndicator(",
  },
  {
    file: 'app/src/components/StockChart.jsx',
    region: 'the Alt-key block — the hand-written KeyU branch',
    // The lookup is `INDICATOR_CHORDS.find(c => c.modifier === 'alt' && …)`, so
    // the physical key lives in the chord table and NOT in this file.
    gone: "'KeyU'",
  },
]

/** What B4 TASK 6 RETIRED. `ENGINE_ROW_DEF_IDS` is a CODE SHAPE, not a bare
 *  name: `indicatorRegistry.js`'s header now EXPLAINS that the constant is gone,
 *  and a bare `includes` would find the explanation and report the deletion as a
 *  regression — the trap Task 11 hit from the other side. */
const RETIRED_BY_B4_TASK6 = [
  {
    file: 'app/src/components/chart/indicatorRegistry.js',
    region: 'ENGINE_ROW_DEF_IDS — the hand-written list of which definitions get a generated row',
    gone: 'export const ENGINE_ROW_DEF_IDS',
  },
]

/** What B4 TASK 8 RETIRED: the toolbar's fifteen indicator rows and the three
 *  helpers that existed to keep them honest.
 *
 *  ⚠️ CODE SHAPES AND A CLASS NAME, never bare identifiers — `ChartToolbar.jsx`
 *  and this file both EXPLAIN that these are gone, and a bare `includes` finds
 *  the explanation and reports the deletion as a regression (the trap Task 11 hit
 *  from the other side). `styles.sIndicatorLabel` is the row's own label span:
 *  fifteen rows cannot come back without it, whatever the writer is called. */
const RETIRED_BY_B4_TASK8 = [
  ['the row label span — no per-indicator row can render without it', /styles\.sIndicatorLabel/g],
  ['updateIndicator — the raw per-indicator writer', /const\s+updateIndicator\s*=/g],
  ['engineInert', /const\s+engineInert\s*=/g],
  ['inertTitle', /const\s+inertTitle\s*=/g],
  ['shownInput', /const\s+shownInput\s*=/g],
  ['an inline indicators[key] write', /indicators\s*:\s*\{[^}]*\[\s*key\s*\]/g],
]

/** What B4 TASK 5 RETIRED: the share link's four hand-written pilot rows.
 *
 *  ⚠️ A REGEX SHAPE, NOT A LITERAL, AND THE REVIEWER'S FINDING IS WHY. Task 3's
 *  `RETIRED_BY_B4` demanded a literal string be absent, and reintroducing the
 *  eight-entry list with ONLY THE SPACES AROUND `=` REMOVED left it green. These
 *  tolerate arbitrary whitespace, and the shape they match — `<id>: { enabled:` —
 *  is the one a hand-written per-indicator row in a state object has to wear
 *  whatever it is called.
 *
 *  ⛔ AND THE STRONGER GUARD IS BEHAVIOURAL, NOT HERE. `stockChartWiring.test.jsx`
 *  asserts the ENCODED key set equals `catalogRows()`' id set, which no
 *  reintroduction can satisfy while dropping a section. This one catches the
 *  other half — a hand-written list of ALL fifteen, which would encode the right
 *  keys and still be a second source of truth. */
const RETIRED_BY_B4_TASK5 = [
  ['rsi', /\brsi\s*:\s*\{\s*enabled\s*:/g],
  ['macd', /\bmacd\s*:\s*\{\s*enabled\s*:/g],
  ['bb', /\bbb\s*:\s*\{\s*enabled\s*:/g],
  ['vwap', /\bvwap\s*:\s*\{\s*enabled\s*:/g],
]

/** What B4 TASK 10 RETIRED: the legend's three-part indicator enumeration.
 *
 *  ⚠️ REGEX SHAPES AGAIN, for the reason Task 5's block states: a literal-string
 *  guard was measured GREEN against a reintroduction with only the spaces around
 *  `=` removed. Each of these is the SHAPE the thing has to wear, whatever it is
 *  called and however it is spaced. */
/** B5 Task 6's deletions, as IDENTIFIERS rather than call shapes.
 *
 *  ⛔ THE PROBE MUST READ COMMENT-STRIPPED SOURCE, and this suite's own *"the
 *  scan reads CODE, not prose"* case is the reason: `StockChart.jsx` names all
 *  four of these in the tombstone paragraphs where they used to live, on purpose,
 *  so a raw `includes` reports every one of them alive forever. */
const RETIRED_BY_B5_TASK6 = [
  ['app/src/components/StockChart.jsx',
    'registerLegacyChip -- the legacy chip registrar', /\bregisterLegacyChip\b/g],
  ['app/src/components/StockChart.jsx',
    'legacyChipEntriesRef -- the legacy lane entry map', /\blegacyChipEntriesRef\b/g],
  ['app/src/components/StockChart.jsx',
    'csIndicatorsRef -- the legacy lane inputs mirror', /\bcsIndicatorsRef\b/g],
  ['app/src/components/StockChart.jsx',
    'LEGACY_CHIP_ORDER -- the legacy lane ordering constant', /\bLEGACY_CHIP_ORDER\b/g],
]

/** ⭐⭐ WHAT B5 TASK 8 RETIRED — the four StockChart regions that were ONE
 *  mechanism, held to zero as SHAPES rather than as literal strings.
 *
 *  ⚠️ A FORMAT-EXACT "demand zero" IS BRITTLE AND B4 MEASURED IT: reintroducing
 *  a full eight-entry literal with only the spaces around `=` removed left the
 *  guard green AND the discovery scan green — a second source of truth back
 *  beside the derivation with nothing red. Every pattern below therefore uses
 *  `\s+` rather than literal spaces (the `useRef` anchor in particular was
 *  column-aligned with SEVEN spaces before its `=`).
 *
 *  ⛔ AND PATTERNS ALONE ARE NOT ENOUGH, WHICH IS WHY THE CASE BELOW CARRIES A
 *  BEHAVIOURAL GUARD BESIDE THEM: `StockChart.jsx` imports ZERO `compute*`
 *  functions from `chart/indicators.js`. A re-added `import { computeATR }` with
 *  no caller matches none of these four shapes and would sail through — and it
 *  is the exact shape a partial revert leaves behind.
 *
 *  ⛔ COMMENT-STRIPPED, for the reason Task 6's block states: `StockChart.jsx`
 *  names `indicatorData`, `adxSeriesRef` and `set` in the tombstone paragraphs
 *  where they used to live, so a raw read reports them alive forever. */
const RETIRED_BY_B5_TASK8 = [
  ['app/src/components/StockChart.jsx',
    'the series useRef declarations', /const\s+adxSeriesRef\s+=\s+useRef\(/g],
  ['app/src/components/StockChart.jsx',
    'the indicatorData memo', /const\s+indicatorData\s*=\s*useMemo\(/g],
  ['app/src/components/StockChart.jsx',
    'the hand-written render blocks', /if\s*\(adxD\.adx\.length\)/g],
  ['app/src/components/StockChart.jsx',
    'the hide-all ref array', /const\s+set\s*=\s*\(ref\)\s*=>/g],
]

/** ⭐⭐ WHAT B5 TASK 9 RETIRED — the three regions that were the settings blob's
 *  indicator enumeration, held to zero as SHAPES.
 *
 *  ⛔ AND THE SHAPES ARE THE WEAKER HALF, WHICH IS WHY THE CASE THAT RUNS THEM
 *  CARRIES BEHAVIOURAL GUARDS BESIDE THEM. A hard allow-list is a thing that
 *  DESTROYS: "the line is gone" is a claim about text, and "the key is destroyed
 *  on every read" is the claim that matters. A renamed constant, a reformatted
 *  literal, or a fifteen-line list rebuilt from a loop all satisfy a demand-zero
 *  pattern — B4 measured exactly that, against a reintroduction with only the
 *  spaces around `=` removed. So: patterns, then the behaviour. */
const RETIRED_BY_B5_TASK9 = [
  ['app/src/components/chart/chartDefaults.js',
    'CHART_DEFAULTS.indicators — the fifteen keyed sections',
    /rsi\s*:\s*\{\s*enabled\s*:\s*false\s*,\s*period\s*:\s*14/g],
  ['app/src/components/chart/chartDefaults.js',
    "mergeChartSettings' per-key allow-list — the fifteen lines",
    /rsi\s*:\s*\{\s*\.\.\.CHART_DEFAULTS\.indicators\.rsi/g],
  ['app/src/pages/charts/ChartsWorkspace.jsx',
    "the frozen capture's fifteen indicator sections",
    /"rsi"\s*:\s*\{\s*"enabled"/g],
]

/** ⭐⭐⭐ WHAT PHASE C TASK 10 RETIRED — and it is the FIRST retirement of a
 *  PYTHON site this ledger has recorded.
 *
 *  `indicator_alert_evaluator.INDICATOR_FUNCS` was 28 rows of
 *  `_plot_of("compute_adx", 1, period=14)`, sitting beside 28 rows of
 *  `alert_series._column("compute_adx", 1, period=14)` that named the same
 *  compute, the same column index, the same input shape and the same defaults,
 *  and differed only by a `_last_non_none` at the end. B4 adjudication A4 fated
 *  it `C`; Phase C Task 5 built the twin instead of retiring it, deliberately,
 *  and recorded the debt on the row. This is the payment.
 *
 *  ⛔ THE ANCHOR IS RE-RUN, NOT DROPPED, AND THAT IS THE WHOLE METHOD. The
 *  ledger row's anchor demanded EXACTLY ONE match for years; the retirement is
 *  only real if the same pattern now matches ZERO. A control that stops looking
 *  is a control that rots, so the pattern outlives the row it policed.
 *
 *  ⚠️ WHAT IS DELIBERATELY *NOT* CLAIMED HERE: that the NAME is gone.
 *  `tools/alert_replay.py` generates the frozen 691,195-fire grid by iterating
 *  `ev.INDICATOR_FUNCS`, `alert_shadow_log` bounds a diff declaration with it,
 *  and `alert_soak_matrix` arms from the catalog behind it. All three read a
 *  MAPPING and none reads a literal. What retired is the second place a person
 *  had to edit, which is what an enumeration SITE is. The Python-side rail
 *  (`test_the_hand_written_dispatch_literal_is_GONE_by_identity`) asserts both
 *  halves — the literal absent AND the mapping present — because either one
 *  alone describes a different change. */
const RETIRED_BY_C_TASK10 = [
  ['api/services/indicator_alert_evaluator.py',
    'INDICATOR_FUNCS — the hand-written 28-closure dispatch literal',
    /INDICATOR_FUNCS:\s*dict\[str,/g],
  ['api/services/indicator_alert_evaluator.py',
    '_plot_of — the second column builder, now `alert_series._column` alone',
    /def\s+_plot_of\s*\(/g],
  ['api/services/indicator_alert_evaluator.py',
    'the eight hand-written per-indicator value functions',
    /def\s+_value_(?:rsi|macd|stoch|williams_r|cci|mfi|price_vs_ma|bb)\s*\(/g],
]

const RETIRED_BY_B4_TASK10 = [
  ['app/src/components/chart/engine/readout.js',
    'LEGACY_SLOTS — the legend slot bridge', /export\s+const\s+LEGACY_SLOTS\s*=/g],
  ['app/src/components/chart/engine/readout.js',
    'chipsBySlot — the bridge\'s reader', /export\s+function\s+chipsBySlot\b/g],
  ['app/src/components/StockChart.jsx',
    'the crosshair value reads — nine numeric crosshairData fields',
    /stochK\s*:\s*stochKValue/g],
  ['app/src/components/StockChart.jsx',
    'a crosshairData read for a named indicator — the legend\'s old row shape',
    /crosshairData\.(?:rsi|macdSig|stochK|stochD|ichimokuTenkan|ichimokuKijun)\b/g],
  ['app/src/components/StockChart.jsx',
    'the per-indicator legend row — `crosshairData.<x> != null && chip(`',
    /crosshairData\.\w+\s*!=\s*null\s*&&\s*chip\(/g],
]

/** What the B4 ALERT-CATALOG task retired (`0d0d4c93`), proven retired rather
 *  than merely unlisted. Two of the five names it deleted are the ledger's own
 *  anchors; the other three (`OSCILLATOR_CONDITIONS`, `THRESHOLD_CONDITIONS`,
 *  the popover's `INDICATOR_LABELS`) were part of the same twin and are held to
 *  the same zero so the region cannot come back one constant at a time. */
const RETIRED_BY_B4_ALERTS = [
  ['INDICATORS — the alert dropdown', /const\s+INDICATORS\s*=\s*\[/g],
  ['CONDITIONS — per-indicator condition lists', /const\s+CONDITIONS\s*=\s*\{/g],
  ['OSCILLATOR_CONDITIONS', /const\s+OSCILLATOR_CONDITIONS\s*=/g],
  ['THRESHOLD_CONDITIONS', /const\s+THRESHOLD_CONDITIONS\s*=/g],
  ['INDICATOR_LABELS (the popover\'s own copy)', /const\s+INDICATOR_LABELS\s*=/g],
]

/** The number the ledger holds down. Change it ONLY by walking the code.
 *  31 → 26 at B4 Task 3: `IND_OPTS`, `OSC_OPTS`, the right-click `Hide <label>`,
 *  `chartRegion.INDICATOR_LABELS` and `ChartToolbar.OSC` all read
 *  `indicatorCatalog.js` now. Four of the five are DELETED outright (proven by
 *  `indicatorCatalog.test.js` → *the four regions Task 3 retired are GONE*); the
 *  fifth, `i-hide`, still exists as a menu item but enumerates nothing — its
 *  label comes from `labelFor(key)`, so it is no longer a site a new indicator
 *  has to be edited into, which is what this ledger counts.
 *
 *  26 → 23 at B4 Task 4, and the arithmetic is 26 − 4 + 1, NOT 26 − 4. The four
 *  keyboard regions retire into `INDICATOR_CHORDS`, which is itself a new ledger
 *  entry — fate `keep` — because it hand-names four indicator ids and the
 *  discovery scan below therefore flags its file. Deleting four and adding one is
 *  the honest count; "22" would have been a site the scan can see and the ledger
 *  cannot.
 *
 *  23 → 22 at B4 Task 6: `indicatorRegistry.ENGINE_ROW_DEF_IDS`, deleted
 *  outright. Nothing replaces it — every definition gets a row, so there is no
 *  list of which ones do. ⚠️ The brief for that task said the count was 21 → 20
 *  and `B4: 8 → 7`; both were stale by two tasks. The measured numbers are the
 *  ones asserted, here and in the partition below.
 *
 *  22 → 20 in the same commit, for the ALERT-CATALOG task's two sites
 *  (`0d0d4c93`, landed by a parallel wave). ⚠️ A ledger is only worth its count
 *  if the count MOVES WITH THE CODE, and a retirement landing in one wave while
 *  the ledger is edited in another is precisely how a site retires with nobody's
 *  number changing — so this phase gives the file ONE writer and the writer
 *  records every landed retirement, not only its own.
 *
 *  20 → 19 at B4 Task 8: `ChartToolbar`'s fifteen hand-written indicator rows,
 *  replaced by a launcher onto the library. Nothing is added — the launcher
 *  names no indicator, and its count derives from `catalogRows()`. */
/** …and 19 → 18 for the voice bus (`e427a09b`), landed by the same parallel
 *  wave. Two retirements in this commit are not this wave's own work; both are
 *  recorded because the ledger's number is only worth something if it moves with
 *  the CODE, whoever wrote it.
 *
 *  18 → 17 at B4 Task 5: `handleCopyShareUrl`'s four hand-written pilot rows.
 *  Nothing is added — the callback survives and enumerates nothing.
 *
 *  17 → 14 at B4 Task 10: the crosshair value reads, `legChips` and
 *  `readout.LEGACY_SLOTS`, which were one mechanism and could only go together.
 *  **B4's bucket is now EMPTY** — see the partition assertion, which must carry
 *  NO `B4` key at all (`reduce` emits no key for a fate with no members, so
 *  `B4: 0` would never match).
 *
 *  14 → 15, and it is an ADDITION rather than a retirement: a SIXTH site the JS
 *  discovery scan structurally cannot see — `voice_client_action_tools.py`'s
 *  `_INDICATOR_ALIASES`, the voice phrase map — found by the wave that fixed the
 *  voice bus. Fate `C`. ⚠️ The ledger's number is only worth something if it
 *  moves with the CODE, and that includes a site nobody retired.
 *
 *  ⭐⭐ 15 → 11 at B5 TASK 8, THE BIGGEST SINGLE MOVE THIS LEDGER HAS RECORDED,
 *  and it is FOUR ROWS IN ONE COMMIT because they were one mechanism: the
 *  series `useRef` declarations, the `indicatorData` memo, the hand-written
 *  render blocks and the hide-all ref array. `adx`, `obv` and `donchian` were
 *  the last three definitions any of the four served. Nothing is ADDED: the
 *  engine's binding map replaces all four and it enumerates nothing.
 *
 *  ⚠️ AND `B5`'S BUCKET DOES NOT EMPTY. Three B5 rows survive this task —
 *  `chartDefaults`' two 15-key regions and `ChartsWorkspace`'s frozen capture,
 *  which Task 10 takes, plus `paneMargins.PANES`, which Task 12 does. A phase
 *  whose bucket empties one task early is a phase whose remaining work is
 *  invisible here, so the histogram below still carried a `B5` key.
 *
 *  ⭐⭐ 11 → 8 at B5 TASK 9, and it is THREE ROWS IN ONE COMMIT because they were
 *  one mechanism wearing three faces: `CHART_DEFAULTS.indicators`' fifteen keyed
 *  sections, `mergeChartSettings`' fifteen-line allow-list that let them survive
 *  a read, and `ChartsWorkspace`'s frozen capture that wrote them verbatim. The
 *  settings blob stops enumerating indicators, so all three empty together.
 *  Nothing is ADDED: the fourteen sections become `indicatorInstances` entries,
 *  which is a LIST of what a chart has rather than a TABLE of what exists.
 *
 *  ⛔ AND `B5` DOES NOT EMPTY. One row survives — `paneMargins.PANES`, which
 *  Task 12 takes at Flip C. A phase whose bucket empties three tasks early is a
 *  phase whose remaining work is invisible here.
 *
 *  ⭐⭐ 8 → 7 → 8 at B5 TASK 12, AND `B5` FINALLY EMPTIES. Flip C deletes
 *  `paneMargins.js`, so the last B5-fated row leaves the ledger and the histogram
 *  below carries NO `B5` KEY AT ALL — `reduce` emits nothing for a bucket with no
 *  members, exactly as B4's bucket emptied at Task 8. Writing `B5: 0` would never
 *  match; the ABSENCE of the key is the assertion.
 *
 *  ⛔ AND THE TOTAL DID NOT FALL, WHICH IS THE PART A "8 → 7" WOULD HAVE HIDDEN.
 *  `PANES` carried three facts and one of them — the STACK ORDER — is a list of
 *  ids, so it had to be written down somewhere. It was DERIVED before (the
 *  migrator called `computePaneMargins` and read its key order back), which is why
 *  no ledger row named it; inlining it as `instances.FROZEN_SHIPPED_STACK_ORDER`
 *  made the discovery scan flag `instances.js` on the very first run. It is a
 *  `keep`: a historical record of the order every existing user's panes are in,
 *  never a catalogue a new indicator is edited into. So the ledger reads
 *  `{C: 2, keep: 4, phase: 2}` — one row out, one row in, and nothing this phase
 *  still owes.
 *
 *  ⭐⭐ B5 TASK 13 CLOSES IT AT `{C: 2, keep: 4}`, SIX ROWS, AND THERE IS NO
 *  `phase` KEY AT ALL. The two flip sets are deleted (see the tombstone in
 *  `LEDGER` where they stood), so every row that is left is either Phase C's
 *  (two, both of them PYTHON, and the JS discovery scan below structurally
 *  cannot see either) or a `keep` — a place where hand-listing indicator ids is
 *  the right answer and always will be.
 *
 *  ⚠️ THE HAND-OFF BRIEF SAID `{C: 2, keep: 3}`. It is FOUR, and the arithmetic
 *  is the tell: 8 − 2 = 6 = 2 + 4. The brief carried `keep: 3` forward from
 *  Task 12's brief, which predicted the ledger would SHRINK to seven at Flip C;
 *  Task 12 measured that it did not (inlining the stack order created
 *  `FROZEN_SHIPPED_STACK_ORDER`, a `keep`), and that correction never reached
 *  the next brief. Reported rather than reconciled by deleting a row nobody
 *  argued for.
 *
 *  ⭐⭐ 6 → 7 AT PHASE C TASK 1, AND IT IS AN ADDITION WITH NO RETIREMENT — the
 *  ONLY move of that shape this ledger has recorded twice (the other was
 *  `_INDICATOR_ALIASES` at B4). `{C: 2, keep: 5}`.
 *
 *  ⛔ AND THE ROW WAS NOT WALKED UP TO BY A HUMAN: it was FOUND, by teaching the
 *  discovery scan to read Python. Two of the six rows this task inherited are
 *  Python and the JS scan — which walks `app/src/**` and reads only `.js`/`.jsx`
 *  — structurally could not see either, so both had been hand-maintained since
 *  B4. That is the precise shape that turned seven sites into thirty-two: an
 *  enumeration nobody's scan can reach. The Python half's FIRST run, over 787
 *  `.py` files under `api/`, found THREE files at four-or-more ids and one of
 *  them was unledgered — `indicator_compute.py`'s `_CASE_COLUMNS`.
 *
 *  ⚠️ THE PREDICTION AND THE MEASUREMENT AGREED, WHICH IS NOT WHY THE NUMBER IS
 *  7. The plan predicted `SITE_COUNT` 6→7 and `{C: 2, keep: 5}`; the scan was run
 *  first and the assertion written from what it FOUND. Had it named a fourth
 *  file, the fourth file would be on this list and this number would be 8.
 *
 *  ⭐⭐ 7 → 8 AT PHASE C TASK 5, AND AGAIN IT IS AN ADDITION WITH NO RETIREMENT.
 *  `{C: 3, keep: 5}`. The new row is `alert_series.SERIES_FUNCS` — the closed-bar
 *  lane's address→column table — and it did not arrive by somebody remembering
 *  to write it down: the Python discovery scan Task 1 built flagged the file on
 *  the FIRST full-suite run after it was created, naming it in the failure
 *  message, which is precisely the job the scan was added to do. The rule the
 *  ledger keeps proving: an enumeration nobody's scan can reach is how seven
 *  sites became thirty-two.
 *
 *  ⚠️ AND THE `C` BUCKET IS NOW THREE ROWS THAT NO REMAINING PHASE C TASK HAS
 *  CLAIMED — see the comment on the new row. The number went up, the fates did
 *  not move, and the prediction underneath them is older than it looks.
 *
 *  ⭐⭐⭐ 8 → 8 AT PHASE C TASK 10, AND FOR ONCE THE INTERESTING NUMBER IS NOT THE
 *  TOTAL. `{C: 3, keep: 5}` → `{C: 1, keep: 7}`: the first RETIREMENT of a Python
 *  site this ledger has recorded (`INDICATOR_FUNCS`, proven gone in
 *  `RETIRED_BY_C_TASK10`) and, beside it, a fate CLAIMED AND ANSWERED
 *  (`SERIES_FUNCS` is `keep` — it is the table the other one retired into, and
 *  it is not derivable from anything).
 *
 *  ⛔ THE TOTAL DID NOT FALL AND THAT WAS MEASURED, NOT ASSUMED. Task 10's brief
 *  predicted `SITE_COUNT` 8 → 7 on the theory that the Python discovery scan
 *  would stop finding `indicator_alert_evaluator.py` once its dict was gone. It
 *  does NOT stop finding it: `ALERT_CONDITIONS` / `ALERT_LABELS` /
 *  `ALERT_BASE_LABELS` still quote a dozen ids as code. So the row was
 *  RE-POINTED at the enumeration that survives rather than deleted — deleting it
 *  while the scan still names the file is the "unledgered site" failure this
 *  ledger exists to produce. The prediction was a hypothesis; the scan was the
 *  measurement.
 *
 *  ⭐⭐⭐ 8 → 9 AT PHASE D TASK 1, AND IT IS AN ADDITION FOR A SITE THAT DOES NOT
 *  EXIST YET — the first row this ledger has ever carried ahead of its subject.
 *  `{keep: 9}`. The new row is `engine/ast/closedTable.json`, the manifest that
 *  declares every name a user-authored formula may call, and it is written down
 *  NOW for one reason: Phase D's whole safety claim is *"the table is closed"*,
 *  and a table that arrives unledgered is a table nobody's count noticed
 *  arriving. Neither discovery scan can help here — the JS scan walks `.js`/
 *  `.jsx` under `app/src` and the Python scan walks `.py` under `api`, so a
 *  `.json` manifest is invisible to BOTH, exactly as `voice_client_action_tools.py`
 *  was invisible to the JS scan for two phases.
 *
 *  ⚠️ AND THE ROW IS `pending`, WHICH IS A NEW COLUMN AND THEREFORE A DECISION.
 *  See the comment on the row itself for the three options and why this is the
 *  one. The short version: the anchor is ARMED AND UNMATCHED, the anchor case
 *  asserts a pending row's file is ABSENT, and Task 3 creating it is what turns
 *  this from green to red. A `pending` row that is never converted is a control
 *  that rots green, so the pending SET is asserted by name and must hold exactly
 *  one member.
 *
 *  ⭐⭐⭐ **THE COUNT DID NOT MOVE AT PHASE D TASK 3, AND THAT IS THE WHOLE POINT
 *  OF HAVING WRITTEN THE ROW A DAY EARLY.** `closedTable.json` arrived, the fuse
 *  fired by name, the marker came off, and `SITE_COUNT` stayed 9 — because the
 *  site was counted when it was DECIDED rather than when it was typed. Had the
 *  row not been here, the manifest would have landed with nobody's count moving,
 *  which is the "unledgered site" failure this file exists to produce, and
 *  neither discovery scan could have caught it (`.json` is invisible to both).
 *  The `pending` COLUMN survives with zero users: it is a fuse anyone may arm
 *  again, and the empty set below is what stops a second one being armed quietly.
 *
 *  ⛔ NEITHER DISCOVERY SCAN'S FOUND-SET MOVES ON THIS TASK, and both are
 *  asserted as whole-set literals below rather than left to a subset check. This
 *  task adds a ledger ROW; it changes nothing either scan can see. (Re-measured
 *  at Task 3: `engine/ast/parse.js` names no indicator id, so the JS scan's
 *  three-file set is unchanged by the new directory.)
 *
 *  ⭐⭐⭐ 9 → 10 AT PHASE D TASK 8, AND THE SCAN FOUND THE SITE BEFORE THE TASK
 *  DID. `{keep: 10}`. The new row is `engine/registrySizes.js`, which holds the
 *  hand-written manifest of every shipped definition id — the thing thirty-three
 *  scattered count assertions collapsed INTO. Its brief predicted no ledger
 *  delta ("adding a lane adds no enumeration by itself") and instructed the task
 *  to run the scans rather than assume; the JS discovery scan flagged the file by
 *  name on its first run, so the prediction was wrong and the instruction was
 *  right. This is the FIRST time on this branch that the JS scan's found-set has
 *  moved, and it moves for a file that genuinely hand-lists sixteen ids on
 *  purpose — a derived manifest could never fail, which is exactly why this one
 *  is typed out.
 *
 *  ⚠️ THE PYTHON SCAN'S FOUND-SET DID NOT MOVE. Task 8 touches one `api/` file
 *  and only its `SCHEMA_VERSION` cross-assert; it names no indicator. Both
 *  whole-set literals below are re-measured, not assumed. */
const SITE_COUNT = 10

describe('the enumeration ledger — the count is a test, not a comment', () => {
  it(`holds ${SITE_COUNT} live sites, and every one of them is still where it says it is`, () => {
    const problems = []
    for (const site of LEDGER) {
      // ⭐⭐⭐ PHASE D TASK 1 — A ROW MAY BE DECLARED `pending`, AND A PENDING ROW
      // IS ASSERTED IN THE OPPOSITE DIRECTION. Its subject has not been built
      // yet, so demanding the anchor match would make this case red for every
      // task until it is — and a rail that is always red is a rail nobody
      // reads. What is asserted instead is that the file is still ABSENT, which
      // is a claim that goes FALSE, loudly, on the commit that creates it. That
      // is the whole point: `pending` is a fuse, not an exemption.
      if (site.pending) {
        if (fs.existsSync(path.join(ROOT, site.file))) {
          problems.push(
            `${site.file} :: ${site.region} — the row is marked pending:'${site.pending}' but the ` +
            'FILE NOW EXISTS. That is this fuse firing, and it is the good outcome: drop `pending` ' +
            `from the row and make the anchor ${JSON.stringify(site.anchor)} appear exactly once. ` +
            'Do NOT delete the row, and do NOT leave the marker on — a pending row whose subject ' +
            'has arrived is a control that rots green.',
          )
        }
        continue
      }
      let src
      try { src = read(site.file) } catch { problems.push(`${site.file}: FILE IS GONE (${site.region})`); continue }
      const n = src.split(site.anchor).length - 1
      if (n !== 1) {
        problems.push(
          `${site.file} :: ${site.region} — anchor ${JSON.stringify(site.anchor)} appears ${n} times, expected 1. ` +
          'The ledger is stale: fix the anchor, or retire the site and drop the count.',
        )
      }
    }
    expect(problems, 'a stale ledger says so instead of going quietly green').toEqual([])
    expect(LEDGER.length,
      'the site count moved. That is allowed — it has moved five times — but it is a DECISION, ' +
      'not a diff: update SITE_COUNT, the header, and the spec §5 pointer together.',
    ).toBe(SITE_COUNT)
  })

  // ⛔⭐⭐ THE PENDING SET IS A LITERAL, BY NAME, NOT A COUNT AND NOT A TOLERANCE
  // — AND IT IS ITS OWN CASE ON PURPOSE. `pending` is an exemption from the
  // anchor check, and an exemption nobody enumerates is how a second one arrives
  // quietly and a third one after that. Exactly one row may carry it; adding a
  // second is a DECISION that fails here first.
  //
  // ⚠️ SEPARATE FROM THE COUNT CASE BECAUSE A SHARED CASE HIDES WHICH THING
  // BROKE. Inside the count case this assertion sat AFTER the length check, so a
  // wrong `SITE_COUNT` aborted the case before the exemption set was ever read —
  // two different defects, one red line, and no way to tell them apart from the
  // failure. Split, they are: deleting the row fails HERE and nowhere else that
  // a re-fate or a miscount does.
  // ⭐⭐⭐ THE SET IS NOW EMPTY, AND EMPTY IS STRICTLY STRONGER THAN ONE.
  // Phase D Task 3 created `closedTable.json`, the fuse fired by name, and the
  // marker came off — so the only row that ever carried an exemption no longer
  // needs one and its anchor is checked like every other row's. The literal
  // stays a NAMED SET rather than becoming a count, because `[]` is what makes
  // a SECOND pending row fail here first: `.toHaveLength(0)` and
  // `.toEqual([])` read the same today and diverge the moment somebody adds one
  // with a plausible-looking justification.
  it('exempts NO row from the anchor check — the one fuse has fired', () => {
    expect(LEDGER.filter(s => s.pending).map(s => `${s.file}::${s.pending}`),
      'a row is exempted from the anchor check. A `pending` row is a site whose subject does ' +
      'not exist yet — it is the ONLY reason a ledger row may skip its anchor, it is a FUSE ' +
      'rather than an exemption, and every one of them has to be named here. The last one ' +
      '(closedTable.json::D3) fired on 2026-08-07 and was converted, not renewed.',
    ).toEqual([])
  })

  // ⭐ WHO RETIRES WHAT, AS A NUMBER. The B3 plan said "~4 sites hand off to
  // B4". The measured answer was TWENTY, and "approximately four" is exactly the
  // kind of estimate this file exists to replace. B4 doing its work moves these
  // counts, which is a red test and a deliberate update rather than a silent
  // drift back toward "seven".
  //
  // ⭐ AND IT HAS ALREADY MOVED ONCE WITHOUT ANY WORK BEING DONE. B4's plan
  // adjudicated two of the twenty — A2 sent `paneMargins.PANES` to B5 (a layout
  // table B4 may not modify), A4 sent `INDICATOR_FUNCS` to the new fate `C`
  // (spec §8 rebuilds the evaluator). **B4 retires EIGHTEEN, not twenty**, and
  // that correction is worth more than the arithmetic: twenty summed only while
  // a layout table sat in the settings-dialog group. Every later B4 task
  // DECREMENTS `B4` here; the total moves only when a site is deleted outright,
  // which Tasks 3 and 4 have now both done (31 → 26 → 23).
  //
  // ⚠️ A RETIREMENT CAN ADD A ROW. Task 4 deleted four `B4` regions and added
  // ONE `keep` (`INDICATOR_CHORDS`), so `B4` fell by four while the total fell by
  // three. "Retired" means "no longer a region a new indicator must be edited
  // into", not "no line of code names an indicator anywhere" — and the one that
  // still does has to be ON this ledger, because the discovery scan below can see
  // it whether or not anybody wrote it down.
  it('every B4 region is retired — 2 to C, 5 kept, and NO B4, B5 or phase key', () => {
    const counts = LEDGER.reduce((acc, s) => ({ ...acc, [s.fate]: (acc[s.fate] || 0) + 1 }), {})
    // ⚠️ `toEqual` on the WHOLE object, never five `toBe`s: a fate typo ('b5')
    // makes a SIXTH bucket, and five per-key assertions would all still pass
    // while the ledger silently held a site nobody's phase owns.
    //
    // ⛔ AND ITS ONE BLIND SPOT, STATED SO IT IS NOT OVER-TRUSTED: this is a
    // HISTOGRAM. Moving one site B4→B5 fails it (the total is unchanged and the
    // buckets are not) — but SWAPPING the fates of two sites preserves every
    // count and passes, demonstrated. "The retirement column adds up" means the
    // column adds up, not that every row is in the right one.
    //
    // ⭐ THAT BLIND SPOT IS CLOSED BY THE TEST BELOW, AND THIS COMMENT USED TO SAY
    // OTHERWISE. It read *"the per-site reasoning lives in the comments beside
    // each entry, and that is what a reviewer has to read"* — true when a human
    // was the only thing standing between a permutation and a green suite, and
    // FALSE the moment `LEDGER_FATES` started asserting each row BY NAME. A
    // comment that describes a gap somebody has since filled is the same rot this
    // file exists to catch, so it is corrected rather than left.
    //
    // ⛔ AND THERE IS NO `B4: 0` — NOR, AFTER B5 TASK 12, A `B5: 0`. `reduce`
    // emits no key for a fate with no members, so writing one would never match.
    // **Both buckets are EMPTY**: every region B4 inherited has been retired, and
    // Flip C took the last one B5 owed. The ABSENCE of each key is what says so;
    // a `B4` or `B5` row reappearing here fails this line by name.
    //
    // ⭐⭐ B5 TASK 13 REMOVED THE `phase` BUCKET, AND THAT IS THE PHASE ENDING.
    // The two flip sets were the only rows carrying it, and `phase` meant "this
    // row describes a state that ends when the migration does". The migration is
    // over — `ENGINE_FLIPPED_DEF_IDS` had become equal to `ENGINE_MIGRATED_DEF_IDS`
    // AND to the registry — so a row still sitting in that bucket would be a
    // control that goes on passing about something that stopped existing. Three
    // empty buckets now say three different things by their ABSENCE: no `B4`
    // (B4 retired everything it inherited), no `B5` (Flip C took the last one),
    // no `phase` (the flip sets are deleted, not re-fated).
    //
    // ⭐⭐ `keep` 4 → 5 AT PHASE C TASK 1, AND THE `C` BUCKET DID NOT MOVE. The
    // added row is `indicator_compute.py`'s `_CASE_COLUMNS`, found by the Python
    // discovery scan's first run. Its fate is LOAD-BEARING, not cosmetic: both
    // `C` rows retire in this phase, so the Python scan's non-vacuity floor —
    // which is derived from `keep` for exactly the reason the JS floor was
    // re-derived at B5 Task 12 — would collapse to `[]` and rot GREEN if this
    // row were fated `C` instead. Re-fating it is a two-character edit that
    // silently disarms a scan, which is why the test below asserts it BY NAME.
    //
    // ⭐⭐ `C` 2 → 3 AT PHASE C TASK 5, AND `keep` DID NOT MOVE — WHICH IS THE
    // HALF THAT MATTERS. The added row is `alert_series.py`'s `SERIES_FUNCS`,
    // the closed-bar lane's twin of `INDICATOR_FUNCS`, fated `C` with it. The
    // floor above is derived from `keep`, so a third `C` row cannot disarm the
    // Python scan — but it does mean the `C` bucket now holds THREE retirements
    // this phase has not scheduled. Named on the row itself.
    //
    // ⭐⭐⭐ `{C: 3, keep: 5}` → `{C: 1, keep: 7}` AT PHASE C TASK 10, AND THIS IS
    // THE FIRST TIME THIS PHASE THE `C` BUCKET HAS FALLEN. Two rows moved and
    // they moved for two DIFFERENT reasons, which is why they are not one edit:
    // `INDICATOR_FUNCS` was RETIRED (the literal is gone, proven by identity in
    // `RETIRED_BY_C_TASK10`) and its file re-pointed at the enumeration that
    // survives; `SERIES_FUNCS` was RE-FATED after the claim on it was tested and
    // found false — it is the table the other one retired INTO, and it is not
    // derivable from anything. The third `C` row is deliberately still `C`.
    //
    // ⛔ AND THE PYTHON FLOOR GOT STRONGER, NOT WEAKER, WHICH IS THE THING TO
    // CHECK ON ANY EDIT THAT MOVES A ROW OUT OF `C`. That floor is derived from
    // `keep`; it had exactly ONE Python subject and now has THREE, so the scan
    // it protects is measured against more, not less.
    // ⭐⭐⭐ `{keep: 8}` → `{keep: 9}` AT PHASE D TASK 1, AND THE HISTOGRAM'S
    // BLIND SPOT IS NOW TOTAL — SAID OUT LOUD RATHER THAN LEFT TO BE DISCOVERED.
    // B4's review measured that SWAPPING two sites' fates preserves every count
    // and passes here, and B5 counted the ten permutations that hid in
    // `{C: 2, keep: 3}`. Every row is `keep` now, so a fate SWAP is the IDENTITY
    // — there is no permutation left for the sorted-pair mapping below to catch
    // that this line does not already catch. That is not the mapping becoming
    // redundant; it is the mapping's subject temporarily emptying, and the two
    // assertions still fail on different things (a fate TYPO makes a sixth
    // bucket, which only this whole-object `toEqual` refuses; a re-fate to a NEW
    // letter fails both, and only the mapping names WHICH ROW moved).
    // ⭐⭐⭐ `{keep: 9}` → `{keep: 10}` AT PHASE D TASK 8. `registrySizes.js`
    // joins as a `keep`, and the blind spot above is unchanged: with every row
    // `keep`, a fate swap is still the identity.
    expect(counts).toEqual({ keep: 10 })
    // …and by NAME, because a histogram cannot tell an absent bucket from a
    // bucket somebody renamed.
    expect(LEDGER.filter(s2 => s2.fate === 'phase'),
      're-opening a `phase` fate means a migration is running again — say which').toEqual([])
    expect(LEDGER.filter(s2 => s2.fate === 'B5' || s2.fate === 'B4'), 'B4/B5 re-opened').toEqual([])
    // ⛔⭐⭐ AND NO `C` — THE FOURTH EMPTY BUCKET, AND THE ONE THAT ENDS THE PHASE.
    // `C` meant "Phase C retires it". Phase C answered all three rows that ever
    // carried it: `INDICATOR_FUNCS` was RETIRED (Task 10, proven by identity in
    // `RETIRED_BY_C_TASK10`), `SERIES_FUNCS` was RE-FATED after its claim was
    // tested and found false (Task 10), and `_INDICATOR_ALIASES` was ADJUDICATED
    // `keep` on a measurement (Task 15). A row still sitting in this bucket after
    // the phase it names has ended would be a control that goes on passing about a
    // retirement nobody is going to do — the exact shape B5 Task 13 deleted the
    // two `phase` rows to avoid. Its absence is asserted, not assumed.
    expect(LEDGER.filter(s2 => s2.fate === 'C'),
      'a `C` fate is open again after Phase C shipped. `C` means "Phase C retires it" and '
      + 'Phase C is over, so this row is a promise nobody can keep: give it a real fate '
      + '(and a reason) or open a new letter for the phase that will actually do it.').toEqual([])
  })

  // ⭐ B5 A8. THE ASSERTION ABOVE IS A HISTOGRAM AND B4'S REVIEW MEASURED ITS
  // BLIND SPOT: swapping two sites' fates preserves every count and passes
  // (review M6, `.superpowers/sdd/2026-08-03-phase-b4-surfaces/task-1-review.md`).
  // B5 EMPTIES TWO OF THE FOUR BUCKETS, so the space a permutation can hide in
  // gets SMALLER and therefore easier to fall into, not harder: with `B5` and
  // `phase` gone, `{C: 2, keep: 3}` has exactly ten fate-preserving permutations
  // and every one of them is green above.
  //
  // ⚠️ THAT COUNT IS DATED, AND PHASE C TASK 1 MOVED IT — recorded rather than
  // rewritten, because the sentence is B5's argument and the argument is still
  // right. The ledger is `{C: 2, keep: 5}` over SEVEN rows now, so there are
  // C(7,2) = 21 ways to choose which two rows carry `C` and TWENTY of them are
  // wrong — twice the space B5 measured. Adding a row made the blind spot
  // BIGGER, which is the direction nobody expects and the reason this mapping
  // is regenerated on every ledger edit rather than reviewed by eye.
  //
  // ⛔ BESIDE IT, NOT INSTEAD OF IT, AND THE REASON IS NOT SYMMETRY. The
  // histogram catches a fate TYPO — `'b5'` makes a SIXTH bucket, which `toEqual`
  // on the whole object refuses — and a mapping would accept `['…', 'b5']`
  // happily, because a mapping only asks whether each row says what it said
  // yesterday. Two different failures, two assertions.
  //
  // ⚠️ THE LITERAL BELOW IS DERIVED, NOT TYPED — generated from `LEDGER` itself
  // and pasted. A hand-copy is the exact defect this branch has shipped twice
  // (B4 Task 2's `SHIPPED` block; the plan-supplied `CHIPS` table).
  it('every site names its own fate, so a permutation cannot pass', () => {
    const pairs = LEDGER.map(s => [`${s.file}::${s.region}`, s.fate])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

    // ⚠️ SORTED BY SITE KEY ALONE, NOT BY THE PAIR. `[k, fate].sort()` would key
    // on the joined string, so a swapped fate REORDERS the rows and the diff
    // reads as "everything moved" instead of naming the two rows that changed.
    //
    // ⛔ AND BOTH GUARDS BELOW ARE BELTS, NOT THE ASSERTION — said plainly so
    // nobody re-derives a coverage claim from them. `toEqual` against a
    // fifteen-row literal already refuses an emptied or truncated `LEDGER`; what
    // these two buy is a NAMED failure instead of a fifteen-vs-three array dump,
    // and one thing `toEqual` genuinely cannot see: two rows with the SAME
    // (file, region), which would make the ledger count a site twice.
    expect(pairs, 'the mapping and SITE_COUNT disagree').toHaveLength(SITE_COUNT)
    expect(new Set(pairs.map(p => p[0])).size,
      'two ledger rows share one (file, region) key — the count is double-counting a site',
    ).toBe(SITE_COUNT)

    expect(pairs,
      'a site is fated to a phase it did not have. This is the claim the histogram two tests up ' +
      'CANNOT make: swapping two sites\' fates leaves every count identical and passes there. ' +
      'If a fate really moved, regenerate this literal from LEDGER rather than editing a row by ' +
      'hand, and move the histogram in the same commit.',
    // ⭐⭐⭐ REGENERATED AT PHASE D TASK 1, NOT EDITED. The rows below are the
    // verbatim stdout of a throwaway case that ran `LEDGER.map(...).sort(...)`
    // inside this module and printed it — the same two lines the assertion above
    // computes, so the literal cannot disagree with the generator by a character
    // it was typed with. Recorded in the task report; the printer was deleted in
    // the same commit, because a case whose whole body is a `console.log` is a
    // case that will one day be read as a gate.
    //
    // ⭐⭐⭐ REGENERATED AGAIN AT PHASE D TASK 8, BY THE SAME METHOD AND FOR THE
    // SAME REASON — nine rows became ten (`registrySizes.js`), and the tenth was
    // pasted from that printer's stdout rather than typed into sorted position by
    // eye. The mechanical tell survives: every pair is `["…","keep"]` with NO
    // space after the comma, which is `JSON.stringify`'s format and not the
    // surrounding file's style.
    ).toEqual([
      ["api/services/alert_series.py::SERIES_FUNCS — address → the full aligned column, and since Task 10 the ONE value table","keep"],
      ["api/services/indicator_alert_evaluator.py::ALERT_CONDITIONS — which conditions each address offers, a product decision nothing derives","keep"],
      ["api/services/indicator_compute.py::_CASE_COLUMNS — the golden-fixture kind→columns dispatch","keep"],
      ["api/services/voice_client_action_tools.py::_INDICATOR_ALIASES — the voice add_chart_indicator phrase map","keep"],
      ["app/src/components/chart/engine/ast/closedTable.json::the closed table — every name a user formula may call","keep"],
      ["app/src/components/chart/engine/instances.js::FROZEN_SHIPPED_STACK_ORDER — the retired PANES stacking order, 9 + 5 overlays","keep"],
      ["app/src/components/chart/engine/nativeRegistry.js::RAW_DEFS — THE ONE THAT SHOULD SURVIVE","keep"],
      ["app/src/components/chart/engine/registrySizes.js::SHIPPED_DEF_IDS — the hand-written manifest the registry must equal","keep"],
      ["app/src/components/chart/keyboardShortcuts.js::INDICATOR_CHORDS — the four chord bindings, declared once","keep"],
      ["tools/chart_parity_cases.json::the parity case list","keep"],
    ])
  })

  // ⭐⭐⭐ PHASE D TASK 1 — THE CLOSED TABLE, TWO RAILS, AND ONLY ONE OF THEM CAN
  // BE VACUOUS.
  //
  // The manifest does not exist yet (Task 3 builds it), so the natural rail —
  // *"the closed table is on the ledger"* — has to `return` when its subject is
  // absent, and a rail that returns when its subject is absent asserts NOTHING
  // until the day it does. That is not a reason to skip it: it is a reason to
  // pair it. The first arms itself the moment the file appears; the second
  // cannot be vacuous at any point, because its subject is `LEDGER` and `LEDGER`
  // exists right now.
  it('the closed-table manifest is on the ledger the moment it exists', () => {
    const MANIFEST = 'app/src/components/chart/engine/ast/closedTable.json'
    if (!fs.existsSync(path.join(ROOT, MANIFEST))) return   // Task 3 creates it; this rail arms itself then
    const known = new Set(LEDGER.map(s => s.file))
    expect(known.has(MANIFEST),
      'the closed table is the single declaration of what a user formula may call. ' +
      'It is an enumeration by definition and it must be on the ledger.',
    ).toBe(true)
  })

  it('the ledger names the file that will hold the closed table, and says why', () => {
    const row = LEDGER.find(s => /ast\/closedTable\.json$/.test(s.file))
    expect(row, 'the closed-table row is missing from the ledger').toBeTruthy()
    expect(row.fate).toBe('keep')
  })

  it('⭐⭐ the Python dispatch literal PHASE C TASK 10 retired is GONE, by identity', () => {
    const back = RETIRED_BY_C_TASK10
      .filter(([file, , re]) => [...read(file).matchAll(re)].length !== 0)
      .map(([file, what]) => `${file} :: ${what}`)
    expect(back,
      'the hand-written alert dispatch table is back. It is DERIVED from '
      + '`alert_series.SERIES_FUNCS` — a value is the last non-None element of a column — '
      + 'and a second table of the same 28 closures is the twin Phase C spent its budget '
      + 'retiring.',
    ).toEqual([])
    // ⛔ AND THE PATTERNS CAN STILL SEE WHAT THEY FORBID. Task 1 measured this
    // exact trap for real: a negative fixture that the raw scan structurally
    // could not match reported a mutation as a SURVIVOR. A demand-zero pattern
    // that has quietly stopped matching reports every file as clean.
    const planted = [
      'INDICATOR_FUNCS: dict[str, Callable] = {',
      'def _plot_of(compute_name):',
      'def _value_rsi(bars, params):',
    ].join('\n')
    expect(RETIRED_BY_C_TASK10.map(([, , re]) => [...planted.matchAll(re)].length))
      .toEqual([1, 1, 1])
    // ⭐ AND THE SUCCESSOR IS REALLY THERE, or "the literal is gone" is
    // satisfied by an alert lane that lost its address table altogether.
    const EV = read('api/services/indicator_alert_evaluator.py')
    expect(EV).toContain('INDICATOR_FUNCS')
    expect(EV).toContain('alert_series.SERIES_FUNCS')
  })

  it('the two sites this task retired are GONE, not merely unlisted', () => {
    for (const r of RETIRED_BY_THIS_TASK) {
      expect(read(r.file).includes(r.gone), `${r.file}: ${r.region} came back`).toBe(false)
    }
  })

  it('⭐ and the settings-row list B4 Task 6 retired is GONE too', () => {
    const back = RETIRED_BY_B4_TASK6
      .filter(r => read(r.file).includes(r.gone))
      .map(r => `${r.file} :: ${r.region}`)
    expect(back,
      'the hand-written list of which definitions get a generated row is back. Every ' +
      'definition gets one now; a list beside the derivation is a second source of truth.',
    ).toEqual([])
    // …and the scan is not vacuous: the derivation that replaced it is really
    // there, walking the registry rather than a list of ids.
    expect(read('app/src/components/chart/indicatorRegistry.js'))
      .toContain('registry.listDefinitions()')
  })

  it('⭐ and the toolbar\'s fifteen indicator rows — and the three helpers that kept them honest — are GONE', () => {
    const src = read('app/src/components/chart/ChartToolbar.jsx')
    const back = RETIRED_BY_B4_TASK8
      .filter(([, re]) => [...src.matchAll(re)].length !== 0)
      .map(([what]) => what)
    expect(back,
      'a per-indicator control is back on the toolbar. Every control those rows carried is on ' +
      'the generated dialog, which reaches inputs this surface never could; a row here is a ' +
      'duplicate of a surface that already covers it, and its writer is control door seven.',
    ).toEqual([])
    // …and the replacement is really there, reading through the ONE reader.
    expect(src).toContain('Manage indicators')
    expect(src).toContain('catalogRows().filter((r) => isOn(r.id)).length')
    // ⛔ AND WHAT SURVIVED ON PURPOSE: the volume-overlay strip is not an
    // indicator control — it moves an ALREADY-ENABLED oscillator between panes —
    // so its derivation must still be here. A zero above with this missing means
    // the whole group was deleted, not just the rows.
    expect(src).toContain('oscillatorIds().filter')
  })

  it('⭐ and the voice bus no longer hand-lists indicators', () => {
    const src = read('app/src/utils/chartBus.js')
    expect([...src.matchAll(/const\s+ALLOWED_INDICATORS\s*=/g)].length,
      'the voice add-indicator allow-list is hand-written again. It derives from the catalog now; ' +
      'a literal beside the derivation is a second source of truth, and this one silently refused ' +
      'every indicator the list forgot.').toBe(0)
    // …and the file is the real one, so the zero above is a retirement rather
    // than a path that stopped resolving.
    expect(src).toContain('export function subscribeAll')
    // ⛔ THE OTHER HALF IS NOT ASSERTED HERE, ON PURPOSE. `subscribeAll` had NO
    // CALL SITE in `app/src` — `addIndicator()` emitted an event nobody heard
    // while the voice tool reported success — and where the derivation and the
    // subscriber now LIVE is that task's own shape, still moving as this is
    // written. `app/src/utils/chartBus.test.jsx` owns both claims; duplicating
    // them here would be a second control over someone else's moving file, which
    // is the rot this ledger exists to catch, not to commit.
  })

  it('⭐ and the alert dropdown\'s five-part twin of INDICATOR_FUNCS is GONE', () => {
    const src = read('app/src/components/chart/IndicatorAlertPopover.jsx')
    const back = RETIRED_BY_B4_ALERTS
      .filter(([, re]) => [...src.matchAll(re)].length !== 0)
      .map(([what]) => what)
    expect(back,
      'the alert dropdown is enumerating indicators again. It is served from ' +
      '`GET /api/indicator-alerts/catalog`, derived from the evaluator, so the dropdown ' +
      'cannot offer an alert that cannot fire. A local list restores that possibility — and ' +
      'a FALLBACK list is the worst version, because it only shows when the fetch fails.',
    ).toEqual([])
    // …and the replacement is really there: the popover FETCHES the catalog, and
    // the backend site that now owns the naming is still on the ledger, fate C.
    expect(src).toContain('useIndicatorAlertCatalog')
    expect(read('api/services/indicator_alert_evaluator.py')).toContain('INDICATOR_FUNCS')
  })

  it('⭐ and the legend\'s three-part indicator enumeration is GONE — all of it', () => {
    const back = RETIRED_BY_B4_TASK10
      .filter(([file, , re]) => [...read(file).matchAll(re)].length !== 0)
      .map(([file, what]) => `${file} :: ${what}`)
    expect(back,
      'the legend is enumerating indicators again. It renders `crosshairData.chips`, which ' +
      '`processCrosshair` builds from BOTH lanes through `readout.chipsFrom` — a hand-written ' +
      'row here is the thing that FORMATS an engine-drawn chip, so a second copy silently ' +
      'decides what the user reads.',
    ).toEqual([])
    // …and the replacements are really there, on all three sides.
    const SC = read('app/src/components/StockChart.jsx')
    expect(SC).toContain('crosshairData.chips')
    // ⚠️ `legendChips`, NOT `engineChips` — chart-UX-walls Task 3 moved the call
    // site one function out. `engineChips` walks BINDINGS and `planBindings`
    // drops a hidden instance, so the chip a user has to click to UN-hide was
    // never emitted; `legendChips` walks the INSTANCE list and calls
    // `engineChips` for the valued half, so this is still ONE pipeline and the
    // control below still names its bottom.
    expect(SC).toContain('legendChips(engineRef.current.binder.bindings()')
    expect(read('app/src/components/chart/engine/readout.js')).toContain('export function chipsFrom(')
    expect(read('app/src/components/chart/engine/readout.js')).toContain('export function legendChips(')

    // ⭐ AND B5 TASK 6 RETIRED THE SECOND LANE ITSELF. Four identifiers, read off
    // COMMENT-STRIPPED source: `StockChart.jsx` names every one of them in the
    // tombstone paragraphs where they used to live, so a raw read reports them
    // alive forever — the exact defect this suite's own *"the scan reads CODE,
    // not prose"* case exists for.
    const stripped = stripComments(SC)
    const lingering = RETIRED_BY_B5_TASK6
      .filter(([, , re]) => [...stripped.matchAll(re)].length !== 0)
      .map(([file, what]) => `${file} :: ${what}`)
    expect(lingering,
      'the legacy chip lane is back. With sar and ichimoku flipped it has no producer, '
      + 'so a registrar here is dead code that reads as a mechanism — and a registration '
      + 'left beside a live binding draws that chip TWICE, invisibly.',
    ).toEqual([])
    // ⛔ THE TWO CONTROLS THIS PROBE CANNOT DO WITHOUT: the patterns match
    // something, and the STRIPPER is what makes them come back empty. A raw read
    // of the same file still finds all four — in the tombstones.
    const PROBE_B5T6 = 'registerLegacyChip( legacyChipEntriesRef.current '
      + 'csIndicatorsRef.current LEGACY_CHIP_ORDER.map'
    for (const [, what, re] of RETIRED_BY_B5_TASK6) {
      expect([...PROBE_B5T6.matchAll(re)].length, `${what}: retirement pattern matches nothing`)
        .toBeGreaterThan(0)
    }
    expect(RETIRED_BY_B5_TASK6.filter(([, , re]) => [...SC.matchAll(re)].length !== 0).length,
      'the RAW source no longer names them anywhere — this probe would then pass without '
      + 'the stripper, and would be blind to a comment hiding a live call')
      .toBe(RETIRED_BY_B5_TASK6.length)
    // ⛔ AND ALL NINE CHIPS ARE DECLARED ON THEIR DEFINITIONS. The obvious B4 —
    // render `engineChips()` directly — deleted `%K`, `%D`, `ATR(14)`, `SAR`,
    // `TK` and `KJ` for every user, because those four definitions produced no
    // bindings. This is the source half of that claim;
    // `legendFromDefinitions.test.jsx` is the behavioural one, and it is where
    // the LANE each chip comes from is asserted.
    const declared = engineRegistry.listDefinitions().flatMap(
      d => d.plots.filter(p => p.style !== 'hlines' && p.legend && p.legend.hide !== true)
        .map(p => `${d.id}::${p.key}`)).sort()
    expect(declared, 'a chip-bearing plot lost its `legend` declaration — a user\'s chip ' +
      'disappears the moment one of these twenty loses it, on EITHER lane').toEqual([
      // ⭐⭐ TWENTY AT TASK 2 (`43efeff6`), AND IT IS STILL AN EQUALITY. The ten
      // below the divider are the ten definitions that declared NO chip at all:
      // a user who switched on MFI or OBV got a line with no label at any time,
      // hovering or not. Widening this literal is the ONLY honest way to keep the
      // equality — a tolerance ("the nine plus anything") would stop seeing the
      // regression this row exists for, which is a chip DISAPPEARING.
      'adx::adx',
      'atr::atr',
      'atrBands::middle',
      'avwap::avwap',
      'bb::middle',
      'cci::cci',
      'donchian::middle',
      'ichimoku::kijun', 'ichimoku::tenkan',
      'macd::macd', 'macd::signal',
      'mfi::mfi',
      'obv::obv',
      // TEN AT PHASE C TASK 13. `rsLine` takes its own PANE, and a pane whose
      // crosshair prints nothing is a value you cannot read. Kept an EQUALITY, so a
      // DROP among the others still fails.
      'rsLine::rsLine', 'rsi::rsi', 'sar::sar', 'stoch::d', 'stoch::k',
      'vwap::vwap',
      'williamsR::williams_r',
    ])
    // ⛔ AND ONE PER DEFINITION IS ITSELF THE CLAIM, because the risk Task 2
    // creates is the OPPOSITE of a lost chip: the engine lane emits a chip for
    // every plot that declares one, so a `legend: {}` added in passing to BB's
    // edges or ADX's directional lines puts extra chips in the box. Sixteen of
    // the seventeen definitions carry exactly ONE chip; `macd` and `stoch` and
    // `ichimoku` carry the two they shipped with.
    const perDef = {}
    for (const k of declared) perDef[k.split('::')[0]] = (perDef[k.split('::')[0]] || 0) + 1
    expect(Object.entries(perDef).filter(([, n]) => n > 1).sort(),
      'a definition grew a SECOND chip — three numbers for one indicator is the '
      + 'readout regression MACD\'s histogram and BB\'s edges are hidden for')
      .toEqual([['ichimoku', 2], ['macd', 2], ['stoch', 2]])
    // ⭐ AND THE SPLIT BETWEEN THE TWO LANES, WHICH IS WHAT B5 MOVES. This loop
    // used to read *"for `stoch`, `atr`, `sar`, `ichimoku`: NOT migrated — B4
    // ships ZERO migrations"* and it went RED at B5 Task 5, which is the correct
    // way for it to notice. It is INVERTED rather than deleted, and it is failable
    // in BOTH directions: a definition on the wrong side of this partition is
    // either a chip drawn twice (migrated while its legacy registration lives) or
    // a chip drawn by nobody (flipped with no binding). The lists move once per
    // B5 migration task and are the ledger of which chips have changed lane.
    // ⭐ B5 TASK 6 EMPTIED THE LEGACY HALF. The partition survives as a partition
    // — the union assertion below still refuses a silent shrink on either side —
    // and the empty list is now itself a claim: it is what licensed deleting the
    // registrar, and re-populating it without also re-adding a producer is a chip
    // drawn by nobody.
    // ⭐ SEVENTEEN AT TASK 2. The partition is unchanged in KIND — the legacy
    // half is still empty and still asserted empty — but the engine half is now
    // every definition there is, because every definition declares a chip.
    const ENGINE_LANE_CHIPS = ['rsi', 'macd', 'stoch', 'atr', 'sar', 'ichimoku', 'rsLine',
      'bb', 'vwap', 'mfi', 'cci', 'williamsR', 'adx', 'obv', 'donchian', 'avwap', 'atrBands']
    const LEGACY_LANE_CHIPS = []
    for (const id of ENGINE_LANE_CHIPS) {
      expect(ENGINE_OWNED.has(id),
        `${id} carries a chip and is NOT migrated — its chip comes from the legacy lane, ` +
        'so move it back to LEGACY_LANE_CHIPS').toBe(true)
      expect(ENGINE_OWNED.has(id),
        `${id} is migrated but not flipped — with engineEnabled deleted that is an ` +
        'indicator drawn by NOTHING').toBe(true)
    }
    for (const id of LEGACY_LANE_CHIPS) {
      expect(ENGINE_OWNED.has(id),
        `${id} was migrated — its chip now comes from the ENGINE lane, so move it to `
        + 'ENGINE_LANE_CHIPS (and retire its registerLegacyChip calls in the same commit)').toBe(false)
    }
    // ⛔ AN EMPTY LOOP PROVES NOTHING, AND THIS IS WHAT REPLACES IT. The legacy
    // lane is empty BECAUSE its registrar is gone; the two facts move together or
    // the legend loses a chip (registrar gone, id still listed here) or draws one
    // twice (id moved to the engine lane, registrar left behind).
    expect(LEGACY_LANE_CHIPS, 'a chip is back on the legacy lane — see RETIRED_BY_B5_TASK6, '
      + 'which asserts that lane has no registrar left to produce it').toEqual([])
    // …and the two lists really do partition the six chip-bearing definitions, so
    // neither can silently shrink.
    expect([...ENGINE_LANE_CHIPS, ...LEGACY_LANE_CHIPS].sort(),
      'the two lanes stopped covering every chip-bearing definition')
      .toEqual([...new Set(declared.map(k => k.split('::')[0]))].sort())
    // ⛔ AND THE PATTERNS STILL MATCH SOMETHING, so five zeroes above cannot be
    // five broken regexes.
    const PROBE = 'export const LEGACY_SLOTS = ({}) export function chipsBySlot(x) ' +
      'stochK: stochKValue, crosshairData.rsi crosshairData.macdSig != null && chip('
    for (const [, what, re] of RETIRED_BY_B4_TASK10) {
      expect([...PROBE.matchAll(re)].length, `${what}'s retirement pattern matches nothing at all`)
        .toBeGreaterThan(0)
    }
  })

  // ⭐⭐ B5 TASK 9 — THE THREE REGIONS THAT WERE THE BLOB'S OWN ENUMERATION.
  it('⛔ the three regions RETIRED_BY_B5_TASK9 took are GONE, and the allow-list DESTROYS', () => {
    const lingering = RETIRED_BY_B5_TASK9
      .filter(([file, , re]) => [...stripComments(read(file)).matchAll(re)].length !== 0)
      .map(([file, what]) => `${file} :: ${what}`)
    expect(lingering,
      'the settings blob is enumerating indicators again. Fourteen of the fifteen sections are '
      + 'DEFINITIONS now and what a chart has one of is an INSTANCE; a section here is a second '
      + 'source of truth for an indicator that already has one, and the allow-list beside it is '
      + 'what would make it survive a read.',
    ).toEqual([])

    // ⛔ THE PATTERNS STILL MATCH SOMETHING — three zeroes are the EXPECTED
    // answer, which makes a broken regex indistinguishable from a retired region.
    // Spaced DIFFERENTLY from the source they replaced, which is the
    // reintroduction B4 measured slipping past a literal-string guard.
    const PROBE_B5T9 = 'rsi:{enabled:false,period:14,color:x} '
      + 'rsi : { ...CHART_DEFAULTS.indicators.rsi, y } {"rsi":{"enabled":false}}'
    for (const [, what, re] of RETIRED_BY_B5_TASK9) {
      expect([...PROBE_B5T9.matchAll(re)].length, `${what}: retirement pattern matches nothing`)
        .toBeGreaterThan(0)
    }

    // ⭐ AND THE BEHAVIOURAL HALF, WHICH IS THE ONE A PATTERN CANNOT MAKE.
    // One key, not fifteen — so there is no fifteen-section list to edit.
    expect(Object.keys(CHART_DEFAULTS.indicators)).toEqual(['volumeProfile'])
    // …and the allow-list has one indicator line, proven by what it DESTROYS: a
    // v2 blob carrying `indicators.rsi` loses it. That is the behaviour, and it
    // is what a renamed or reformatted line cannot satisfy.
    const cs = mergeChartSettings(JSON.parse('{"settingsVersion":2,"indicators":{"rsi":{"enabled":true}}}'))
    expect(cs.indicators.rsi).toBeUndefined()
    expect(Object.keys(cs.indicators)).toEqual(['volumeProfile'])
    // …and the destruction is TOTAL, not just of the one key named above.
    const all = Object.fromEntries(engineRegistry.listDefinitions().map(d => [d.id, { enabled: true }]))
    const wide = mergeChartSettings(JSON.parse(JSON.stringify({ settingsVersion: 2, indicators: all })))
    expect(Object.keys(wide.indicators)).toEqual(['volumeProfile'])
    expect(Object.keys(all), 'the fixture named nothing — the destruction above is vacuous')
      .toHaveLength(REGISTRY_SIZES.total)
    // …and the frozen capture writes the same one key, through the wrapper.
    const frozen = JSON.parse(uctDefaultChartSettings())
    expect(Object.keys(frozen.indicators)).toEqual(['volumeProfile'])
    expect(frozen.settingsVersion, 'the template writes a pre-v2 blob').toBe(2)
  })

  // ⭐⭐ B5 TASK 8 — THE FOUR REGIONS THAT WERE ONE MECHANISM, PROVEN GONE.
  //
  // Patterns AND behaviour, deliberately, because neither is sufficient alone.
  // B4 measured that a format-exact "demand zero" stayed green against a
  // reintroduction with only the spaces around `=` removed, so the patterns are
  // `\s+`-tolerant SHAPES; and a shape cannot see an `import { computeATR }` with
  // no caller, which is exactly what a partial revert of this task leaves behind.
  it('⛔ the four regions RETIRED_BY_B5_TASK8 took are GONE, not merely unlisted', () => {
    const SC = read('app/src/components/StockChart.jsx')
    const CODE = stripComments(SC)
    const lingering = RETIRED_BY_B5_TASK8
      .filter(([, , re]) => [...CODE.matchAll(re)].length !== 0)
      .map(([file, what]) => `${file} :: ${what}`)
    expect(lingering,
      'the hand-written indicator lane is back. All fourteen series-expressible definitions '
      + 'are FLIPPED, so a ref / memo branch / render block / hide-all entry here has no '
      + 'subject: it is dead code that reads as a mechanism, and a block left beside a live '
      + 'binding draws that indicator TWICE, invisibly.',
    ).toEqual([])

    // ⛔ THE TWO CONTROLS THIS PROBE CANNOT DO WITHOUT: the patterns match
    // something, and the STRIPPER is what makes them come back empty. The probe
    // below is deliberately spaced DIFFERENTLY from the shipped source it
    // replaces — one space where the `useRef` row had seven, none around the
    // memo's `=` — which is the reintroduction B4 measured slipping past a
    // literal-string guard.
    const PROBE_B5T8 = 'const adxSeriesRef = useRef(null) const indicatorData=useMemo(() => ({})) '
      + 'if (adxD.adx.length) { const set=(ref) => ref.current'
    for (const [, what, re] of RETIRED_BY_B5_TASK8) {
      expect([...PROBE_B5T8.matchAll(re)].length, `${what}: retirement pattern matches nothing`)
        .toBeGreaterThan(0)
    }
    // …and the RAW source still names three of the four, in the tombstones, so a
    // probe without the stripper would report them alive forever.
    // ⛔ …AND THE RAW SOURCE STILL MATCHES ONE OF THE FOUR, WHICH IS WHAT MAKES
    // THE STRIPPER LOAD-BEARING RATHER THAN DECORATIVE. The hide-all tombstone
    // quotes the shape it replaced verbatim (`const set = (ref) => …`), so a
    // probe reading RAW source reports that region alive. MEASURED, not assumed —
    // if this ever drops to zero the stripper has stopped being tested here and
    // the control needs a new subject, exactly as Task 7's `computeIchimoku`
    // control does.
    const rawHits = RETIRED_BY_B5_TASK8.filter(([, , re]) => [...SC.matchAll(re)].length !== 0)
      .map(([, what]) => what)
    expect(rawHits,
      'no tombstone reproduces a retired shape any more — a probe reading RAW source would '
      + 'now pass WITHOUT the stripper, so this file has stopped measuring that it is needed')
      .toEqual(['the hide-all ref array'])
  })

  // ⛔⭐ THE BEHAVIOURAL HALF, AND IT IS THE ONE A FORMAT-EXACT PATTERN CANNOT
  // MAKE. A re-added `import { computeATR } from './chart/indicators'` with no
  // caller matches none of the four shapes above and would sail through — and it
  // is precisely what a partial revert leaves behind, because the import is the
  // first thing you re-add and the last thing you notice.
  it('⛔ StockChart imports no compute function at all — the lane is the ENGINE lane', () => {
    const names = computeNamesIn(stripComments(read('app/src/components/StockChart.jsx')))
    expect(names,
      'StockChart is importing a compute function again. Every one of the fourteen '
      + 'series-expressible definitions is FLIPPED, so its columns are computed ONCE, by the '
      + 'definition that declares it, at bind time — a second call here is a silent duplicate '
      + 'whose only observable effect is CPU.').toEqual([])
    // ⛔ NON-VACUITY, MEASURED AGAINST THE REAL PRE-MIGRATION FILE RATHER THAN A
    // SYNTHETIC STRING: the SAME extractor over `StockChart.jsx` at `084eeded`
    // (B4's head, before B5 flipped anything) finds TEN names. A `[]` from the
    // line above is only worth something if this line is not also `[]`.
    expect(computeNamesAt('084eeded').sort()).toEqual([
      'computeADX', 'computeATR', 'computeCCI', 'computeDonchian', 'computeIchimoku',
      'computeMFI', 'computeOBV', 'computeParabolicSAR', 'computeStochastic', 'computeWilliamsR',
    ])
    // …and `toHeikinAshi` is NOT a compute function and is still imported — the
    // control that the extractor is selecting rather than emptying the list.
    expect(read('app/src/components/StockChart.jsx'))
      .toContain("import { toHeikinAshi } from './chart/indicators'")
  })

  // ⛔⭐ AND THE TEN `compute*` EXPORTS THEMSELVES MUST NOT BE DELETED, WHICH IS
  // THE OPPOSITE CLAIM TO THE ONE ABOVE AND IS EASY TO GET BACKWARDS. StockChart
  // importing none of them does NOT make them dead: `nativeRegistry`'s
  // `NATIVE_COMPUTE` adapters call every one, the golden fixtures assert them
  // against the Python lane at 1e-9, and deleting one would take an indicator off
  // every chart while leaving this file's `[]` above perfectly green.
  it('⛔ …and every definition still resolves a compute — the exports are NOT dead', () => {
    const defs = engineRegistry.listDefinitions()
    expect(defs.length, 'no definitions — this case proves nothing').toBe(REGISTRY_SIZES.total)
    // THE SERVER LANE IS SKIPPED HERE AND ONLY HERE. This case is about the
    // `compute*` EXPORTS not being dead; a `compute.kind: 'server'` definition has
    // no export to be dead, its columns are FETCHED, and `computeFor` correctly
    // returns {} with no ctx. Derived from the kind and then CHECKED, so a native
    // re-declared `server` to dodge this rail is itself a failure.
    const serverLane = defs.filter(d => d.compute.kind === 'server').map(d => d.id)
    expect(serverLane, 'the exclusion selects nothing — it is inert').toEqual(['rsLine'])
    for (const def of defs.filter(d => d.compute.kind !== 'server')) {
      expect(def.compute && def.compute.kind, def.id).toBe('native')
      expect(typeof def.compute.fn, `${def.id}: compute.fn is not a name`).toBe('string')
      const cols = engineRegistry.computeFor(def, PROBE_BARS, {})
      expect(Object.keys(cols).sort(), `${def.id}: columns`)
        .toEqual([...engineRegistry.columnKeys(def)].sort())
      for (const [key, col] of Object.entries(cols)) {
        expect(engineRegistry.hasAnyFinite(col),
          `${def.id}.${key} computed NOTHING — its compute* export is gone or renamed, and `
          + 'the indicator is off every chart').toBe(true)
      }
    }
  })

  it('⭐ and the share link no longer hand-lists the four pilots', () => {
    const src = read('app/src/components/StockChart.jsx')
    const back = RETIRED_BY_B4_TASK5
      .filter(([, re]) => [...src.matchAll(re)].length !== 0)
      .map(([what]) => what)
    expect(back,
      'the share link is enumerating indicators again. It derives from `catalogRows()` and ' +
      'answers through `isIndicatorEnabled`; a hand-list here means a recipient silently loses ' +
      'every indicator the list forgot — which is exactly what it did for Stochastic and ATR.',
    ).toEqual([])
    // …and the replacement is really there, reading through the ONE list and the
    // ONE reader.
    expect(src).toContain('indicators: Object.fromEntries(catalogRows().map((row) => [')
    expect(src).toContain("isIndicatorEnabled(cs, row.id, ENGINE_OWNED)")
    // ⛔ AND THE PATTERNS STILL MATCH SOMETHING. Four zeroes above are the
    // EXPECTED answer, which makes a broken regex indistinguishable from a
    // retired region — so each one is run against the shape it is supposed to
    // find, including the whitespace-stripped variant that defeated Task 3's
    // literal-string guard.
    const PROBE = "{ rsi: { enabled: true }, macd:{enabled:false}, bb : { enabled : x }, vwap:\t{\tenabled: y } }"
    for (const [what, re] of RETIRED_BY_B4_TASK5) {
      expect([...PROBE.matchAll(re)].length, `${what}'s retirement pattern matches nothing at all`).toBe(1)
    }
  })

  it('⭐ and the four keyboard regions B4 Task 4 retired are GONE too', () => {
    const back = RETIRED_BY_B4_TASK4
      .filter(r => read(r.file).includes(r.gone))
      .map(r => `${r.file} :: ${r.region}`)
    expect(back,
      'a retired keyboard region is back in the shipped source. All four are derived from ' +
      '`INDICATOR_CHORDS` now; a literal beside the derivation is a second source of truth, ' +
      'which is how Alt+U ended up declared in one file and handled in another.',
    ).toEqual([])
    // …and the scan is not vacuous: the derivations that replaced them are really
    // there, in both files, on both dispatch paths.
    // ⚠️ NEWLINE-AGNOSTIC. This worktree stores `keyboardShortcuts.js` with CRLF
    // and `StockChart.jsx` too, so a multi-line `toContain` built with `\n`
    // matches NOTHING here and reads as "the derivation is missing".
    const KS = read('app/src/components/chart/keyboardShortcuts.js')
    expect(KS).toContain('...INDICATOR_CHORDS.map(')
    expect(KS).toMatch(/INDICATOR_CHORDS\s*\.filter\(c => c\.modifier === 'ctrl'\)/)
    const SC = read('app/src/components/StockChart.jsx')
    expect(SC).toContain("INDICATOR_CHORDS.find(c => c.modifier === 'alt' && c.code === e.code)")
    expect(SC).toContain('INDICATOR_CHORDS.find(c => c.defId === target)')
  })

  // ⭐ THE DISCOVERY HALF. The anchored table above catches a site that MOVES.
  // It cannot catch a site that is BORN — a new hand-written indicator list in a
  // file nobody thought to add here, which is exactly how 7 became 32. This
  // scans every shipped module for a file that names four or more indicator ids
  // and refuses one the ledger does not know about.
  //
  // 🔴 IT USED TO READ COMMENTS AS CODE, AND B4 TASK 10 MEASURED IT. Writing
  // `stoch::k` in PROSE in `readout.js` pushed that file over the four-id floor
  // and this scan flagged it as an unledgered enumeration site. The prose was
  // reworded — a symptom fix that left the scan answering a different question
  // than the one it is asked, and left the file one explanatory sentence away
  // from a false alarm at any time. It reads `stripComments(src)` now.
  //
  // ⚠️ SAME CLASS, OPPOSITE DIRECTION, ALSO MEASURED ON THIS BRANCH: Wave B's
  // mount rail matched `useChartIndicatorBus()` in RAW source, so a mutation
  // that COMMENTED THE CALL OUT survived. One stripper, two failure modes.
  //
  // ⛔ STRINGS ARE NOT STRIPPED, ON PURPOSE. `ChartsWorkspace`'s
  // `UCT_DEFAULT_CHART_SETTINGS_JSON` names all fifteen sections inside a JSON
  // STRING and is a real ledger site; a stripper that also dropped string
  // contents would lose it, which is the false negative that makes a scan
  // worthless. Measured on this tree: the found SET is identical before and
  // after stripping (seven files), so nothing this scan saw yesterday went
  // invisible today — only the prose stopped counting.
  it('names every shipped module that hand-lists four or more indicators', () => {
    const SRC_DIR = path.join(ROOT, 'app', 'src')

    const walk = (dir, out = []) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(p, out); continue }
        if (!/\.jsx?$/.test(entry.name)) continue
        // Tests enumerate indicators on purpose — that is what a fixture IS.
        if (entry.name.includes('.test.') || p.includes(`${path.sep}__tests__${path.sep}`)) continue
        out.push(p)
      }
      return out
    }

    const found = []
    for (const p of walk(SRC_DIR)) {
      const src = stripComments(fs.readFileSync(p, 'utf8'))
      if (namesIndicators(src).length >= 4) found.push(path.relative(ROOT, p).split(path.sep).join('/'))
    }
    // ⭐⭐ PHASE C TASK 1 — THE NON-MEASUREMENT, ASSERTED. Task 1 ADDS a Python
    // scan; it must not change what THIS one sees. The two assertions below are
    // a subset check in each direction (`found ⊆ ledger`, `keep ⊆ found`) and
    // together they still permit the set to GROW by a file that happens to be
    // ledgered — so the whole set is pinned here, once, and this literal is the
    // record that nothing moved on 2026-08-06.
    //
    // ⚠️ IT IS A DECISION, NOT A DIFF, exactly like `SITE_COUNT`. A new shipped
    // module that hand-lists four ids fails BOTH this and the unledgered filter;
    // ledgering it silences the filter and leaves this one red, which is the
    // point — the ledger has one writer per phase and this is how the writer
    // finds out.
    expect([...found].sort(),
      'the JS discovery scan sees a different set of files than it saw at the start of ' +
      'Phase C. If a module was added to or removed from the four-id set deliberately, ' +
      'move this literal and say which; if not, the scan itself changed.',
    // ⭐⭐⭐ AND IT MOVED, FOR THE FIRST TIME ON THIS BRANCH, AT PHASE D TASK 8.
    // `engine/registrySizes.js` joins the set: it hand-lists all sixteen native
    // ids on purpose, because a manifest derived from `listDefinitions()` would
    // be true by construction and could never disagree with the registry. That
    // is a real enumeration site, it is ledgered as one, and `SITE_COUNT` went
    // 9 → 10 in the same commit. The task's brief predicted no delta here; the
    // scan disagreed on its first run, which is what running it is for.
    ).toEqual([
      'app/src/components/chart/engine/instances.js',
      'app/src/components/chart/engine/nativeRegistry.js',
      'app/src/components/chart/engine/registrySizes.js',
      'app/src/components/chart/keyboardShortcuts.js',
    ])

    const known = new Set(LEDGER.map(s => s.file))
    expect(found.filter(f => !known.has(f)),
      'a module hand-lists four or more indicators and is not on the ledger. ' +
      'Either it is a NEW enumeration site (add it, and raise SITE_COUNT), or it ' +
      'reads the registry and the scan is over-matching (say which, in the ledger).',
    ).toEqual([])
    // …and the scan itself must not go quietly empty: a scan that finds none is
    // a broken scan, not a clean tree.
    //
    // ⛔ THIS BOUND USED TO BE `toBeGreaterThanOrEqual(11)` WITH THE COMMENT
    // "it found eleven when this was written", AND TASK 3 ROTTED IT — retiring
    // `chartRegion.INDICATOR_LABELS` took `chartRegion.js` off the scan's list
    // and the floor with it. Replacing 11 with 10 reschedules the same failure
    // for Task 4, so the bound is DERIVED from the one part of the ledger B4 may
    // not touch: its **B5-fated** files. A B5 site retires at the cutover, so
    // every later B4 task leaves this set alone, and a scan that stops seeing one
    // of them fails BY NAME — which a count above eleven never could.
    //
    // ⚠️ NOT "every walkable ledger file": measured, `indicatorRegistry.js` is a
    // ledger site the scan legitimately does not flag — `ENGINE_ROW_DEF_IDS` is
    // under four ids. The scan's criterion (four or more hand-listed ids) and the
    // ledger's (one per file/region a new indicator must be edited into) are
    // different measures, and pretending otherwise is how a bound becomes a false
    // alarm nobody trusts.
    //
    // ⛔ THIS NOTE USED TO NAME `keyboardShortcuts.js` HERE TOO, AND B4 TASK 4
    // FALSIFIED THAT WITHOUT ANY TEST GOING RED. The reason given was that the
    // help sheet spelled its ids `'toggle:bb'`, which is not a quoted id — true
    // then, dead now: `INDICATOR_CHORDS` writes `defId: 'rsi'` and three more, so
    // the scan DOES flag the file. It is on the ledger as a `keep`, which is what
    // keeps the scan green — and the note is corrected rather than deleted,
    // because a premise that quietly stops being true is the thing this file is
    // for.
    // ⛔⭐⭐ B5 TASK 12 — THE FLOOR IS RE-DERIVED FROM `keep`, BECAUSE `B5` HAS
    // NO MEMBERS LEFT. This control was derived from the B5-FATED walkable files
    // precisely so it could not rot on an edit: the set shrank 4 → 3 → 1 as the
    // phase retired its sites. Flip C retires the last one, so the old derivation
    // would have collapsed to an EMPTY set — and `[].filter(...)` is `[]`, which
    // satisfies the assertion below while checking nothing at all. **A control
    // that stops looking is a control that rots**, and it rots GREEN.
    //
    // So it is re-derived from the fate that by definition never empties: `keep`
    // — the regions this ledger says are supposed to survive. They are the files
    // the discovery scan MUST be able to see forever, which is a stronger anchor
    // than a phase's own backlog was.
    const keepWalkable = [...new Set(LEDGER.filter(s => s.fate === 'keep').map(s => s.file))]
      .filter(f => /^app\/src\/.*\.jsx?$/.test(f)).sort()
    // ⚠️ THE FLOOR MOVED 4 → 3 AT B5 TASK 8, AND THAT IS A RETIREMENT AND NOT A
    // WEAKENING. `StockChart.jsx` carried FOUR B5-fated rows and now carries
    // none: the four regions were one mechanism and they retired together, so
    // the file drops off the ledger entirely and out of this DEDUPED file set.
    // The three that remain — `chartDefaults.js` (twice), `paneMargins.js`,
    // `ChartsWorkspace.jsx` — are Tasks 10 and 12's, so this floor moves exactly
    // twice more and both times by a deletion nobody can do quietly.
    // ⛔ ⭐⭐ THE FLOOR MOVED 3 → 1 AT B5 TASK 9, AND THAT IS THE RETIREMENT.
    // `chartDefaults.js` carried TWO B5-fated rows and `ChartsWorkspace.jsx` one;
    // all three retired together, so both files drop off the ledger entirely and
    // out of this deduped set. `paneMargins.js` is the last one, and it is Task
    // 12's — so this floor moves exactly once more, by a deletion nobody can do
    // quietly.
    //
    // ⛔ A ONE-ELEMENT FLOOR IS WEAKER THAN A THREE-ELEMENT ONE, WHICH IS WHY THE
    // `INDICATOR_IDS` DERIVATION MATTERS MORE NOW: it comes from the REGISTRY
    // rather than from the settings blob, because a blob-derived id list would
    // have collapsed to ONE id at this task and made the whole scan unable to
    // flag anything at all, silently.
    // ⭐ AND IT MOVED 3 → 4 AT PHASE D TASK 8, WHICH IS THE FIRST TIME THIS FLOOR
    // HAS GONE UP. `registrySizes.js` is a `keep` row under `app/src` with a
    // `.js` extension, so it joins the set the discovery scan MUST be able to see
    // forever — and that is the honest direction for it to move: the paragraph
    // above worried that a one-element floor was weak, and this is a fourth
    // independent file the scan has to keep finding.
    //
    // BY NAME and NON-ZERO, both. A count alone would go green the day the last
    // `keep` row is renamed; the names are what make the collapse loud.
    expect(keepWalkable, 'no `keep` walkable file on the ledger — the check below is vacuous')
      .toEqual(['app/src/components/chart/engine/instances.js',
        'app/src/components/chart/engine/nativeRegistry.js',
        'app/src/components/chart/engine/registrySizes.js',
        'app/src/components/chart/keyboardShortcuts.js'])
    expect(keepWalkable.length).toBeGreaterThan(0)
    expect(keepWalkable.filter(f => !found.includes(f)),
      'the discovery scan cannot see a file the LEDGER fates to `keep` — a region that is ' +
      'supposed to survive forever. The scan is broken (walk root, regexes, or the `.test.` ' +
      'skip), not the tree.',
    ).toEqual([])
    // ⛔ AND THE B5 BUCKET REALLY IS EMPTY, SAID HERE TOO. If a B5 row ever comes
    // back, this line names it rather than letting the floor above quietly stop
    // describing the phase it was written for.
    expect(LEDGER.filter(s => s.fate === 'B5'), 'B5 retired at Task 12 — nothing may re-open it')
      .toEqual([])
  })

  // ⭐⭐ THE PYTHON HALF OF THE DISCOVERY SCAN — PHASE C TASK 1.
  //
  // The scan above walks `app/src/**` and reads `.js`/`.jsx`. TWO of this
  // ledger's rows are PYTHON and it can see NEITHER, so both have been
  // maintained BY HAND since B4 — and a hand-maintained enumeration invisible to
  // the scan is precisely the shape that turned seven sites into thirty-two. The
  // JS half's own header says so ("a Python enumeration is invisible to it
  // however many ids it names"); it had simply never been closed.
  //
  // ⛔ IT FOUND AN UNLEDGERED SITE ON ITS FIRST RUN: `indicator_compute.py`'s
  // `_CASE_COLUMNS`. That is not a bonus — it is the measurement. A scan whose
  // first run finds nothing has not been demonstrated to work.
  //
  // ⛔ THE FOUND SET, PRINTED AND RECORDED (2026-08-06, three files):
  //     api/services/indicator_alert_evaluator.py     ledgered, fate C
  //     api/services/indicator_compute.py             ← the find, now fate keep
  //     api/services/voice_client_action_tools.py     ledgered, fate C
  //   Every other `.py` under `api/` names three or fewer ids after stripping.
  //
  // ⛔ AND IT READS `stripPyComments`, FOR THE REASON THE JS HALF READS
  // `stripComments`: `indicator_alert_evaluator.py` writes long prose about plot
  // addresses in `#` blocks and docstrings, and prose that NAMES a thing makes a
  // scan see an enumeration that is not there. STRINGS survive — a Python
  // enumeration IS a dict of string keys, so stripping them would lose all three
  // files and the scan would be worthless in the other direction.
  it('names every shipped Python module that hand-lists four or more indicators', () => {
    const API_DIR = path.join(ROOT, 'api')

    const walk = (dir, out = []) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__pycache__') continue
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(p, out); continue }
        if (!/\.py$/.test(entry.name)) continue
        out.push(p)
      }
      return out
    }

    const found = []
    for (const p of walk(API_DIR)) {
      const src = stripPyComments(fs.readFileSync(p, 'utf8'))
      if (namesIndicators(src).length >= 4) {
        found.push(path.relative(ROOT, p).split(path.sep).join('/'))
      }
    }
    found.sort()

    const known = new Set(LEDGER.map(s => s.file))
    expect(found.filter(f => !known.has(f)),
      'a PYTHON module hand-lists four or more indicators and is not on the ledger. ' +
      'Either it is a new enumeration site (add it, and raise SITE_COUNT), or it reads ' +
      'the registry and the scan is over-matching (say which, in the ledger).',
    ).toEqual([])

    // …and the scan must not go quietly empty. ⛔ THE FLOOR IS DERIVED FROM
    // `keep`, NEVER FROM THE `C` ROWS: BOTH Python `C` rows retire in this
    // phase, so a floor built on them collapses to an empty set, and
    // `[].filter(...)` is `[]` — which SATISFIES the assertion above while
    // checking nothing at all. A control that stops looking is a control that
    // rots, and it rots GREEN. This is the same lesson the JS floor above
    // learned at B5 Task 12, applied BEFORE the collapse instead of after it.
    //
    // BY NAME and NON-EMPTY, both: a count alone goes green the day the last
    // `keep` Python row is renamed.
    //
    // ONE SUBJECT -> THREE AT PHASE C TASK 10, AND THE FLOOR GOT STRONGER, WHICH
    // IS THE THING TO CHECK ON ANY EDIT THAT MOVES A ROW OUT OF `C`. Retiring
    // `INDICATOR_FUNCS` did NOT take its file off this scan (`ALERT_CONDITIONS`
    // still quotes a dozen ids as code), and `alert_series.SERIES_FUNCS` was
    // re-fated `keep` because it is the table the other one retired INTO. So the
    // two files this task worked on became FLOOR rather than ceiling: a scan
    // that stopped seeing either of them now fails BY NAME.
    //
    // ⭐ THREE -> FOUR AT PHASE C TASK 15, AND IT ARRIVED THE SAME WAY. Re-fating
    // `_INDICATOR_ALIASES` from `C` to `keep` did not just tidy a bucket: it moved
    // `voice_client_action_tools.py` from a row that was ABOUT to disappear into
    // the floor this scan is measured against. That is the whole reason the floor
    // is derived from `keep` and never from `C` — every row that leaves `C`
    // either leaves the ledger entirely or STRENGTHENS this list, and this test
    // failing on the re-fate (rather than passing quietly at three) is what said
    // so. The `C` bucket is empty now, so the floor can no longer collapse at all.
    const keepPython = [...new Set(LEDGER.filter(s => s.fate === 'keep').map(s => s.file))]
      .filter(f => /^api\/.*\.py$/.test(f)).sort()
    expect(keepPython,
      'the Python scan has no surviving subject to be measured against',
    ).toEqual([
      'api/services/alert_series.py',
      'api/services/indicator_alert_evaluator.py',
      'api/services/indicator_compute.py',
      'api/services/voice_client_action_tools.py',
    ])
    for (const f of keepPython) {
      expect(found, `the Python scan stopped seeing ${f}`).toContain(f)
    }

    // ⛔ AND THE SCAN REALLY DID READ THE WHOLE TREE, not an empty directory: a
    // walk root that stopped resolving would make `found` empty and every line
    // above vacuous except the `toContain`, which is why the file COUNT is
    // asserted too. The tree holds hundreds of `.py` files under `api/`.
    expect(walk(API_DIR).length,
      'the Python walk found almost no files — the walk root is wrong, not the tree')
      .toBeGreaterThan(100)
  })

  // ⭐⭐ THE TWO PYTHON `C` ROWS, SIZED — BECAUSE BOTH HAD PROSE THAT OUTLIVED
  // THEIR SUBJECT, AND THIS LEDGER'S WHOLE JOB IS STOPPING EXACTLY THAT.
  //
  // 🔴 CORRECTION 1 — "25 addresses in 14 groups". The B5 SDD ledger
  // (`progress.md` §ADDRESSING) and its `alerts-gap-report.md` both say 25.
  // MEASURED 2026-08-06: `len(INDICATOR_FUNCS) == 28`, 14 groups — 8 legacy + 6
  // same-base + 14 new-base. The Phase C plan would have shipped an assertion
  // failing on its first run FOR THE WRONG REASON had it carried 25 forward.
  //
  // ⚠️ AND THE THIRD SITE THE PHASE-C PLAN NAMED FOR THIS CORRECTION DOES NOT
  // EXIST: it says "the evaluator's own B5 comment block" also says 25. It does
  // not — `indicator_alert_evaluator.py` carries NO address count in prose at
  // all (its only `25` is ADX's conventional guide level, `_DEFAULT_THRESHOLDS`).
  // Recorded here rather than silently dropped, because "a correction that was
  // applied to a site that never had the defect" is indistinguishable from "a
  // correction that was skipped" once the note is gone.
  //
  // 🔴 CORRECTION 2 — the alias map's contents; see the tombstone on that
  // ledger row. This case is what makes the corrected sentence FAILABLE.
  //
  // ⛔ BOTH READ THE PYTHON SOURCE THROUGH `stripPyComments`, so neither can be
  // satisfied by a comment that happens to name the right things.
  it('⭐ the two Python address tables are the size the ledger says — 28 addresses, and NO `sar` alias', () => {
    // ── THE ADDRESS TABLE: its own keys, not a prose count ──
    //
    // ⭐⭐ MOVED DOWN A LEVEL AT PHASE C TASK 10, WHICH IS WHY IT STILL EXISTS.
    // It used to slice `INDICATOR_FUNCS`' hand-written literal out of the
    // evaluator. That literal is RETIRED (it derives from
    // `alert_series.SERIES_FUNCS` now), so this case lost its subject and the
    // tempting move was to delete it. Instead it reads the table that
    // SURVIVED and measures the same claim: 28 levels in 14 groups. What it
    // GAINS is the two partitions the derivation introduced, so the 28 can no
    // longer be preserved by quietly moving an address into one of them.
    const SERIES = stripPyComments(read('api/services/alert_series.py'))
    const open = SERIES.indexOf('SERIES_FUNCS: dict[str,')
    expect(open, 'the column table moved, so this whole case is measuring nothing')
      .toBeGreaterThan(-1)
    const brace = SERIES.indexOf('{', open)
    const close = brace + SERIES.slice(brace).search(/\r?\n\}/)
    const body = SERIES.slice(brace, close)
    expect(body.length, 'the dict body came back empty: the delimiter search failed')
      .toBeGreaterThan(200)
    const all = [...body.matchAll(/"([a-z_][\w.]*)"\s*:/g)].map(m => m[1])
    expect(all.length, 'the column table is not 31 = 28 levels + 2 events + 1 price')
      .toBe(31)

    // The three partitions, read from the evaluator AS CODE. The two small ones
    // are closed exclusion tuples; everything else is a LEVEL, which is the same
    // rule the module itself applies, so a new address lands in the level count
    // BY DEFAULT and moves the 28 below. That is the failure that is wanted.
    const EV = stripPyComments(read('api/services/indicator_alert_evaluator.py'))
    const tupleOf = (name) => {
      const m = EV.match(new RegExp(name + ': tuple\\[str, \\.\\.\\.\\] = \\(([^)]*)\\)'))
      expect(m, name + ' is not declared as a closed tuple any more').toBeTruthy()
      return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1])
    }
    const events = tupleOf('EVENT_ADDRESSES')
    const prices = tupleOf('PRICE_ADDRESSES')
    expect(events).toEqual(['sar.priceCrossedSar', 'sar.trendFlipped'])
    expect(prices).toEqual(['close'])
    const addresses = all.filter(a => !events.includes(a) && !prices.includes(a))

    expect(addresses.length,
      'the evaluator address count moved. It is 28, in 14 groups — NOT the 25 the B5 SDD '
      + 'ledger and its alerts-gap report both carried. If a Phase C task genuinely added or '
      + 'removed an address, move this number and say which address, in the same commit.')
      .toBe(28)
    expect(new Set(addresses).size, 'a duplicate key — the dict silently holds fewer than it lists')
      .toBe(28)
    expect(new Set(addresses.map(a => a.split('.')[0])).size,
      'the catalog GROUP count moved — `alert_catalog` groups on the part before the dot')
      .toBe(14)
    // …and non-vacuous: the extractor is selecting real addresses, one from each
    // of the three B5 waves, not matching some other quoted-key shape.
    expect(addresses).toContain('rsi')          // pre-B5
    expect(addresses).toContain('macd.signal')  // B5, same base
    expect(addresses).toContain('ichimoku.chikou')  // B5, new base
    // ⛔ …AND `sar` IS ABSENT ON PURPOSE. `_SAR_IS_NOT_OFFERED` is a paragraph
    // about why; `test_sar_is_deliberately_not_offered_and_says_why` is its
    // Python-side rail. This is the count's half of the same claim: 28 with
    // `sar` in it would be a different 28.
    expect(addresses).not.toContain('sar')

    // ── _INDICATOR_ALIASES: eleven phrases, seven targets, and no `sar` ──
    const VC = stripPyComments(read('api/services/voice_client_action_tools.py'))
    const aOpen = VC.indexOf('_INDICATOR_ALIASES = {')
    const aClose = aOpen + VC.slice(aOpen).search(/\r?\n\}/)
    const aBody = VC.slice(aOpen, aClose)
    const alias = [...aBody.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map(m => [m[1], m[2]])

    expect(alias.length,
      'the voice phrase map changed size. That is allowed — it is a `keep`-shaped list of '
      + 'synonyms nothing can derive — but it is a DECISION: update the tombstone beside the '
      + 'ledger row in the same commit, or the comment starts outliving its subject again.')
      .toBe(11)
    expect([...new Set(alias.map(p => p[1]))].sort(),
      'the alias map resolves to a different set of targets than the ledger row records')
      .toEqual(['avwap', 'bb', 'ma200', 'ma50', 'macd', 'rsi', 'vwap'])
    // 🔴 THE SENTENCE THE LEDGER USED TO CARRY, AS AN ASSERTION. The comment
    // claimed `"parabolic sar" → sar`. Neither side of that pair is in the map,
    // and `sar` is the one id the evaluator refuses by name — so the invented
    // example pointed at the single place where naming `sar` is a written
    // decision. This fails the day somebody adds it, which is the right day for
    // the ledger's prose to move.
    expect(alias.map(p => p[0]), 'the alias map now has a `parabolic sar` phrase — the '
      + 'ledger row tombstone says it does not; correct the tombstone, do not delete it')
      .not.toContain('parabolic sar')
    expect(alias.map(p => p[1]), 'the voice map resolves a phrase to `sar` while the '
      + 'evaluator refuses `sar` by name (`_SAR_IS_NOT_OFFERED`) — say which one moved')
      .not.toContain('sar')
    // …and the extractor really parsed pairs rather than emptying.
    expect(Object.fromEntries(alias)['bollinger bands']).toBe('bb')

    // ⭐⭐ PHASE C TASK 15 — "IRREDUCIBLE" TURNED INTO A NUMBER, WHICH IS WHAT
    // MOVED THIS ROW OFF `C`. Task 10 handed the fate forward with a written
    // RECOMMENDATION and no test; a recommendation is exactly the two-character
    // edit the ledger's own header warns about. So the claim is measured instead:
    // DELETE the map and re-resolve every phrase through the fallback the tool
    // actually applies, and count how many answers change.
    //
    // ⛔ THE FALLBACK IS READ OFF THE SOURCE, NOT RETYPED. If `add_chart_indicator`
    // ever grows a real derivation (a `meta.name` normaliser, say), this line goes
    // red and the measurement below has to be re-taken — which is the day this row
    // genuinely becomes derivable, and the day somebody should look at it again.
    expect(VC, 'the resolver `add_chart_indicator` applies when the phrase map MISSES has '
      + 'changed. The count below measures the map against exactly that fallback, so it is '
      + 'no longer measuring what ships — re-take it.')
      .toContain('_INDICATOR_ALIASES.get(raw, raw.replace(" ", ""))')
    const fallback = phrase => phrase.split(' ').join('')
    const redundant = alias.filter(([phrase, id]) => fallback(phrase) === id).map(p => p[0])
    const loadBearing = alias.filter(([phrase, id]) => fallback(phrase) !== id).map(p => p[0])

    expect(redundant.sort(),
      'the set of alias rows the fallback would answer identically moved. These are the only '
      + 'rows that could be DELETED without changing what the voice tool understands.')
      .toEqual(['macd', 'rsi'])
    expect(loadBearing.length,
      'the number of alias rows that are load-bearing moved. This is the whole argument '
      + 'this ledger row makes for `keep`: without the map these phrases resolve to something '
      + 'that is not an indicator at all (`anchored vwap` -> `anchoredvwap`), so shipping an '
      + '`avwap` DEFINITION makes them derivable.')
      .toBe(9)

    // ⛔ AND TWO OF THE SEVEN TARGETS ARE NOT DEFINITIONS AT ALL, which is the
    // half no registry change can ever reach: `ma50`/`ma200` are moving-average
    // SLOTS on the chart settings blob, not registered indicators.
    const defIds = new Set(engineRegistry.listDefinitions().map(d => d.id))
    expect([...new Set(alias.map(p => p[1]))].filter(id => !defIds.has(id)).sort(),
      'the alias targets that are not registry definitions moved — if `ma50`/`ma200` ever '
      + 'become definitions, half of the argument above expires and this row should be re-read')
      .toEqual(['ma200', 'ma50'])
    // …and the control: `avwap` IS one, so the filter above is discriminating
    // rather than reporting every target it was handed.
    expect(defIds.has('avwap'),
      'Phase C Task 14 registered `avwap`; if it is gone the measurement above is being '
      + 'taken against a registry that no longer contains the definition it argues about')
      .toBe(true)
  })

  // ⭐ AND THE STRIPPER ITSELF, BOTH DIRECTIONS, ON THE SCAN'S OWN PREDICATE.
  //
  // The floor above proves the scan still finds four B5 files; it cannot prove
  // WHY. These four fixtures are the actual shapes that were measured on this
  // branch — a comment that invents an enumeration, a comment that hides a call,
  // a string that IS one, and a regex whose `//` used to eat the rest of its line.
  it('⭐ the scan reads CODE, not prose — and still reads code', () => {
    const PROSE = [
      // ⚠️ "twenty", not "nine": Task 2 (`43efeff6`) gave the ten silent
      // definitions a chip. The fixture's JOB is only to name ≥4 indicator ids
      // inside a comment, but a fixture that states a stale fact reads as one.
      "// the legend's twenty chips: stoch::k, stoch::d, atr, sar, adx, obv and ichimoku's two",
      '/* rsi: 14, macd: 26, bb: 20, vwap: session — the shape this used to be */',
    ].join('\n')
    const CODE = "const LIST = { rsi: 1, macd: 2, bb: 3, vwap: 4, stoch: 5 }"

    // ⛔ THE NEGATIVE HALF, AND ITS OWN CONTROL. The fixture must genuinely trip
    // the RAW scan, or "zero after stripping" is a fixture that was never a
    // problem — this is the exact `readout.js` shape B4 Task 10 hit.
    expect(namesIndicators(PROSE).length,
      'the prose fixture names fewer than four ids raw — it could never have flagged a file, ' +
      'so the zero below proves nothing').toBeGreaterThanOrEqual(4)
    expect(namesIndicators(stripComments(PROSE)),
      'a comment still reads as an enumeration').toEqual([])

    // ⭐ THE POSITIVE HALF: real code still counts, and counts the SAME.
    expect(namesIndicators(stripComments(CODE)),
      'the stripper ate real code — a scan that finds nothing is a broken scan, not a clean tree')
      .toEqual(namesIndicators(CODE))
    expect(namesIndicators(stripComments(CODE)).length).toBeGreaterThanOrEqual(5)
    // …and the two together, in one file, the way they actually appear.
    expect(namesIndicators(stripComments(`${PROSE}\n${CODE}\n`)))
      .toEqual(namesIndicators(CODE))

    // ⛔ STRINGS SURVIVE. `ChartsWorkspace`'s frozen capture names all fifteen
    // sections inside a JSON string and is a REAL ledger site (fate B5). A
    // stripper that dropped string contents would lose it silently.
    const JSON_CAPTURE = 'const S = \'{"indicators":{"rsi":{},"macd":{},"bb":{},"vwap":{}}}\''
    expect(namesIndicators(stripComments(JSON_CAPTURE)).length,
      'the frozen settings capture stopped being visible — that is the false negative that ' +
      'makes a discovery scan worthless').toBeGreaterThanOrEqual(4)

    // ⛔ A REGEX CONTAINING `//` DOES NOT OPEN A COMMENT. Without the regex state
    // the rest of that line — including the four ids on it — would vanish.
    const WITH_REGEX = "const re = /https:\\/\\//g; const M = { rsi: 1, macd: 2, bb: 3, vwap: 4 }"
    expect(namesIndicators(stripComments(WITH_REGEX)).length,
      'a regex literal swallowed the rest of its line').toBeGreaterThanOrEqual(4)

    // ⛔ THE OTHER DIRECTION — WAVE B'S TRAP. A commented-out call must read as
    // ABSENT, or a mutation that comments a mount out survives its own rail.
    const LIVE = 'export default function L() { useChartIndicatorBus() }'
    const COMMENTED = 'export default function L() { /* useChartIndicatorBus() */ }'
    expect(calls(stripComments(LIVE), 'useChartIndicatorBus'), 'control: a live call reads live')
      .toBe(true)
    expect(calls(COMMENTED, 'useChartIndicatorBus'),
      'control: the RAW probe is the one that was defeated — if this is false the fixture is wrong')
      .toBe(true)
    expect(calls(stripComments(COMMENTED), 'useChartIndicatorBus'),
      'a commented-out call still reads as a live one').toBe(false)
  })

  // ⭐⭐ AND THE SAME, FOR PYTHON — `stripPyComments`, on the scan's own
  // predicate. PHASE C TASK 1.
  //
  // ⛔ WRITTEN BECAUSE THE MUTATION FIXTURE FOR IT FAILED FIRST, AND THAT IS THE
  // WHOLE VALUE OF THIS CASE. The gauntlet's M2b was "prepend a four-id `#`
  // comment to a Python module and watch the identity stripper make the scan
  // flag it". It SURVIVED — not because the stripper is unnecessary, but because
  // the fixture was `# … rsi macd bb vwap …`, and `namesIndicators` matches a
  // QUOTED id, an `id:` key or an `id?.` read, never a bare word. So the fixture
  // named ZERO ids raw and proved nothing in either direction. That is the exact
  // shape of "a mutation that survived for the wrong reason", caught only because
  // the harness demanded the fixture trip the RAW scan first — which is why each
  // negative below carries its own raw-side control.
  it('⭐ the PYTHON scan reads CODE, not prose — and still reads code', () => {
    // A `#` comment and a docstring, both in the shape that actually counts.
    const PY_PROSE = [
      '# the eight legacy addresses: rsi: 14, macd: 26, bb: 20, vwap: session',
      'def f():',
      '    """stoch: 14, atr: 14, cci: 20, mfi: 14 — the shape this used to be."""',
      '    return None',
    ].join('\n')
    const PY_CODE = '_M = {"rsi": 1, "macd": 2, "bb": 3, "vwap": 4, "stoch": 5}'

    // ⛔ THE NEGATIVE HALF'S OWN CONTROL — the fixture must genuinely trip the
    // RAW scan, or "zero after stripping" is a fixture that was never a problem.
    // This is the assertion the M2b mutation fixture did not have.
    expect(namesIndicators(PY_PROSE).length,
      'the Python prose fixture names fewer than four ids RAW — it could never have flagged '
      + 'a file, so the zero below proves nothing').toBeGreaterThanOrEqual(4)
    expect(namesIndicators(stripPyComments(PY_PROSE)),
      'a `#` comment or a docstring still reads as an enumeration').toEqual([])

    // ⭐ THE POSITIVE HALF: real code still counts, and counts the SAME.
    expect(namesIndicators(stripPyComments(PY_CODE)),
      'the stripper ate real code — a scan that finds nothing is a broken scan, not a clean tree')
      .toEqual(namesIndicators(PY_CODE))
    expect(namesIndicators(stripPyComments(PY_CODE)).length).toBeGreaterThanOrEqual(5)
    // …and the two together, in one file, the way they actually appear.
    expect(namesIndicators(stripPyComments(`${PY_PROSE}\n${PY_CODE}\n`)))
      .toEqual(namesIndicators(PY_CODE))

    // ⛔ STRINGS SURVIVE, AND FOR PYTHON THIS IS THE WHOLE GAME: every one of the
    // three real sites is a dict whose KEYS ARE STRINGS. A stripper that dropped
    // string contents would find zero files and report a clean tree.
    expect(namesIndicators(stripPyComments(PY_CODE)).length).toBeGreaterThanOrEqual(5)

    // ⛔ A `#` INSIDE A STRING IS NOT A COMMENT. Without the string state the
    // rest of that line — including its four ids — vanishes, which is the Python
    // twin of the regex-literal trap on the JS side.
    const HASH_IN_STRING = '_U = "# rsi: 1, macd: 2, bb: 3, vwap: 4"'
    expect(namesIndicators(stripPyComments(HASH_IN_STRING)).length,
      'a `#` inside a string opened a phantom comment and ate the rest of the line')
      .toBeGreaterThanOrEqual(4)

    // ⛔ AND A QUOTE INSIDE A `#` COMMENT DOES NOT OPEN A STRING. Getting this
    // backwards leaves the stripper in string mode for the rest of the file and
    // every later comment survives — a false-positive machine that only shows up
    // on files nobody looks at.
    const QUOTE_IN_COMMENT = ['# don\'t read this: rsi: 1, macd: 2, bb: 3, vwap: 4',
      '_V = {"stoch": 1, "atr": 2, "cci": 3, "mfi": 4}'].join('\n')
    expect(namesIndicators(stripPyComments(QUOTE_IN_COMMENT)).sort(),
      'an apostrophe in a `#` comment put the stripper into string mode')
      .toEqual(['atr', 'cci', 'mfi', 'stoch'])

    // ⛔ NEWLINES SURVIVE A DOCSTRING, so line numbers do. `\r` too — this
    // worktree stores several files CRLF and collapsing one fuses two lines.
    const DOC = 'a = 1\r\n"""\r\nprose\r\n"""\r\nb = 2\r\n'
    expect((stripPyComments(DOC).match(/\r\n/g) || []).length,
      'the docstring stripper ate CRLF line structure').toBe(5)
  })
})

describe('what B3 retired — a FLIPPED definition has no hand-written lane left', () => {
  const SRC = read('app/src/components/StockChart.jsx')
  // ⚠️ COMMENT-STRIPPED, AND B5 TASK 7 IS WHY. These probes used to read the RAW
  // source, which is safe only while every deleted identifier is written WITHOUT
  // its call parentheses in the tombstone that replaced it. It is not: Task 6's
  // flip note says *"`computeIchimoku(filteredBars)` was called here with NO
  // arguments"* — TWICE — so `calls(SRC, ...)` reports a live call from a comment
  // about a deleted one, and the moment `ichimoku` joined the tables below the
  // rail would have gone red on prose. `sourceScan.stripComments` is the same
  // stripper the chip probes use, and the control below proves it is load-bearing
  // here rather than decorative.
  const CODE = stripComments(SRC)

  /** defId → the series refs its legacy render block owned.
   *
   * ⭐ B5 TASK 7 COMPLETED THIS TABLE, AND FINDING IT INCOMPLETE IS THE POINT.
   * It held the FOUR B3 pilots only, so `REFS[id] || []` made the loop below a
   * NO-OP for every definition B5 flipped — the rail got quietly weaker at Task
   * 5 and again at Task 6 and nothing said so, because a loop that iterates an
   * empty list is indistinguishable from a loop that found nothing wrong. The
   * names are recovered from the commits that deleted them (`1ee1bab3` for
   * stoch/atr, `cb8b8136` for sar/ichimoku, this task's own parent for the
   * three below), and the TOTALITY case underneath makes the next migration
   * fill it in rather than inherit the same silence. */
  const REFS = {
    rsi: ['rsiSeriesRef'],
    bb: ['bbUpperRef', 'bbMiddleRef', 'bbLowerRef'],
    macd: ['macdLineRef', 'macdSignalRef', 'macdHistRef'],
    vwap: ['vwapSeriesRef'],
    stoch: ['stochKRef', 'stochDRef'],
    atr: ['atrSeriesRef'],
    sar: ['sarSeriesRef'],
    ichimoku: ['ichimokuTenkanRef', 'ichimokuKijunRef', 'ichimokuSpanARef',
      'ichimokuSpanBRef', 'ichimokuChikouRef'],
    mfi: ['mfiSeriesRef'],
    cci: ['cciSeriesRef'],
    williamsR: ['williamsRSeriesRef'],
    // ⭐⭐ B5 TASK 8 — THE LAST SEVEN REFS, AND WITH THEM THIS TABLE COVERS THE
    // WHOLE FLIP SET FOR THE FIRST TIME BY CONSTRUCTION RATHER THAN BY LUCK: the
    // totality case below cannot be satisfied by omission any more, because
    // there is no fifteenth definition to omit.
    adx: ['adxSeriesRef', 'adxPlusDIRef', 'adxMinusDIRef'],
    obv: ['obvSeriesRef'],
    donchian: ['donchianUpperRef', 'donchianMiddleRef', 'donchianLowerRef'],
    // ⭐⭐ PHASE C TASK 14 — THE FIRST ROWS THAT ARE DELIBERATELY EMPTY, AND THE
    // EMPTINESS IS A DECLARATION RATHER THAN AN OMISSION. `avwap` and `atrBands`
    // were never a hand-written `StockChart.jsx` block, so there are no refs to
    // record and no `indicatorData` branch to name. The coverage check below was
    // changed from "has a TRUTHY row" to "has a row AT ALL" precisely so this
    // still has to be written down: a definition added without a row is a silent
    // no-op, and a definition added with an EMPTY row is a claim — measured by
    // `neverHadABlock` beneath it, which is STRICTER than the per-ref check the
    // fourteen get (it forbids the id appearing in that file in ANY form).
    avwap: [],
    atrBands: [],
    rsLine: [],
  }
  /** The definitions that never had a hand-written block to retire. */
  const NEVER_MIGRATED = ['avwap', 'atrBands', 'rsLine']
  /** …and the compute its `indicatorData` branch called. */
  const COMPUTES = {
    rsi: 'computeRSI', bb: 'computeBB', macd: 'computeMACD', vwap: 'computeVWAP',
    stoch: 'computeStochastic', atr: 'computeATR', sar: 'computeParabolicSAR',
    ichimoku: 'computeIchimoku', mfi: 'computeMFI', cci: 'computeCCI',
    williamsR: 'computeWilliamsR', adx: 'computeADX', obv: 'computeOBV',
    donchian: 'computeDonchian',
    // …and `null` where there never was one. See NEVER_MIGRATED above.
    avwap: null, atrBands: null, rsLine: null,
  }

  it('⛔ the two tables COVER the flip set — a missing row is a silent no-op', () => {
    // The gate on the finding above. `REFS[id] || []` and `if (fn && …)` both
    // pass by DEFAULT for an id nobody listed, so without this the two cases
    // below shrink in coverage every time the flip set grows and stay green.
    const missing = [...ENGINE_OWNED].filter(id => !(id in REFS) || !(id in COMPUTES))
    expect(missing,
      'a flipped definition has no row in REFS/COMPUTES, so the two cases below assert '
      + 'NOTHING about it. Add the refs its deleted block owned and the compute its '
      + 'indicatorData branch called — both are in the commit that deleted them.')
      .toEqual([])
    // …and non-vacuous: the set really has members, and really has more than the
    // four B3 pilots this table used to stop at.
    expect(ENGINE_OWNED.size).toBeGreaterThan(4)
    expect(Object.values(REFS).flat().length).toBeGreaterThan(10)
    // ⭐ AND THE COVERAGE IS NOW TOTAL IN BOTH DIRECTIONS: every DEFINITION has a
    // row, not merely every flipped one, so the tables cannot shrink behind a
    // set that has stopped growing.
    expect(Object.keys(REFS).sort()).toEqual(engineRegistry.listDefinitions().map(d => d.id).sort())
    expect(Object.keys(COMPUTES).sort()).toEqual(Object.keys(REFS).sort())
    // ⛔ AND AN EMPTY ROW IS ONLY LEGAL FOR A DEFINITION THAT NEVER HAD A BLOCK,
    // where it buys a STRONGER claim than the per-ref one: the id may not appear
    // in `StockChart.jsx` in any form at all. A migrated definition with an
    // emptied row would fail here, which is what stops the escape hatch becoming
    // a way to opt out of the two cases below.
    const emptyRows = Object.keys(REFS).filter(id => !REFS[id].length || !COMPUTES[id])
    expect(emptyRows.sort()).toEqual([...NEVER_MIGRATED].sort())
    const chart = stripComments(read('app/src/components/StockChart.jsx'))
    for (const id of NEVER_MIGRATED) {
      expect(chart.toLowerCase().includes(id.toLowerCase()),
        `${id} never had a hand-written block, so StockChart.jsx must not name it at all`)
        .toBe(false)
    }
    // …and the probe can see a name that IS there, or the loop above is vacuous.
    expect(chart.toLowerCase().includes('vwap')).toBe(true)
  })

  it('declares no series ref and creates no series for a flipped id', () => {
    const failures = []
    for (const id of ENGINE_OWNED) {
      for (const ref of (REFS[id] || [])) {
        if (declaresRef(CODE, ref)) failures.push(`${id}: ${ref} is declared again`)
        if (usesRef(CODE, ref)) failures.push(`${id}: ${ref}.current is read or written again`)
      }
    }
    expect(failures).toEqual([])
  })

  it('runs no second computation for a flipped id — the engine computes it once', () => {
    const failures = []
    for (const id of ENGINE_OWNED) {
      const fn = COMPUTES[id]
      if (fn && calls(CODE, fn)) failures.push(`${id}: StockChart calls ${fn}() again — a silent duplicate`)
    }
    expect(failures).toEqual([])
  })

  it('⛔ and the STRIPPER is load-bearing, not decorative — measured on ichimoku', () => {
    // The control for the `CODE` switch above. `computeIchimoku(` appears in the
    // RAW file, in the flip note that describes the call Task 6 DELETED, so a
    // raw-source probe reports a live second computation that does not exist —
    // and reports it for a definition whose row was only added at Task 7, which
    // is why nothing caught it earlier.
    expect(calls(SRC, 'computeIchimoku'), 'the tombstone stopped naming the call it '
      + 'replaced — this control has lost its subject, pick another deleted compute')
      .toBe(true)
    expect(calls(CODE, 'computeIchimoku'), 'the stripper let a commented call through')
      .toBe(false)
  })

  it('keeps no Flip-A guard for a flipped id — the block should be GONE, not guarded', () => {
    const failures = []
    for (const id of ENGINE_OWNED) {
      if (CODE.includes(`engineOwned.has('${id}')`)) failures.push(`${id}: a Flip-A guard survived its Flip B`)
    }
    expect(failures).toEqual([])
  })

  // ⚠️ NOT ASSERTED HERE, ON PURPOSE: "a migrated-but-un-flipped definition still
  // has its guard". That category is EMPTY (`ENGINE_OWNED` equals
  // `ENGINE_OWNED`), so the loop would iterate zero times and pass
  // whatever it claimed. `flipB.test.jsx` owns the live claim — it asserts the
  // two sets are EQUAL, naming the three deletions that rest on it, so B4 gets a
  // red test rather than a double-drawn indicator. What IS asserted here, below,
  // is the OTHER half: not "the guard survived" but "the category may not be
  // created at all while the decision that makes it safe is still open."

  // ⛔⭐ THE RAIL THAT STOPS B4 STRANDING USERS.
  // `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` §4.1: a
  // MIGRATED-but-UN-FLIPPED definition needs `cs.engineEnabled`, NO existing user
  // has it, and flipping the default cannot give it to them — so that definition
  // is engine-drawn for NOBODY. The category is empty today, and B4's
  // adjudication A1 is that it stays empty.
  //
  // ⚠️ WHAT IT IS, AND WHAT IT IS NOT. Three of its clauses are ALSO caught by
  // `flipB.test.jsx` (both set directions) and `engineEnabledMigration.test.js`
  // (the Status line) — measured like-for-like, unfiltered, a migrate-without-flip
  // fails SIX assertions across three files and this is one of the six. It is kept
  // for its failure message, for sitting beside the ledger it constrains, and for
  // two clauses nothing else on this branch carries: the two sets must refuse a
  // runtime write, and the record must AGREE WITH THE CODE. Record §10 and §11.
  //
  // ⭐⭐ B5 RE-READS THE STATUS CLAUSE, BECAUSE B5 IS THE PHASE THAT MOVES IT.
  //
  // As shipped by B4 this rail asserted `stillOpen: true` — the record says OPEN,
  // full stop. That is a TRUE sentence about a branch where nobody was allowed to
  // resolve it, and it becomes a LIE the moment somebody is: B5 Task 4 DELETES
  // `engineEnabled` and B5 Task 9 flips this record to RESOLVED. A rail whose
  // whole content is "the sentence still says OPEN" has exactly one response to
  // that day — somebody edits `true` to `false`, the suite goes green, and the
  // clause now asserts *nothing at all*, because "the record does not say OPEN"
  // constrains no code. That is not a rail retiring; it is a rail INVERTING
  // SILENTLY, which is this branch's most-repeated defect wearing a new coat.
  //
  // So the clause is re-read as a BICONDITIONAL between the record and the code:
  //
  //     the record says OPEN  ⟺  `mergeChartSettings` still reads the flag
  //
  //   BEFORE (B4, and B5 Tasks 1-3):  status `OPEN`,     flagLives `true`
  //   ⭐ NOW   (B5 Task 4 onward):      status `RESOLVED`, flagLives `false`
  //
  // ⭐⭐ THE TRANSITION HAPPENED, AND THIS IS THE COMMIT IT HAPPENED IN. B5 Task 4
  // deleted `engineEnabled` at all seven sites, so `flagLives` reads `false`; the
  // biconditional then made resolving the record MANDATORY in the same commit
  // rather than optional at Task 9, because a `RESOLVED`-less tree with no flag is
  // exactly the second red below. §11 of the record said "B5 Task 9 resolves this";
  // the rail said otherwise and the rail was right — record §12.1 carries that.
  //
  // ⚠️ The expected object below is the ONLY place either value is written down,
  // and both were changed together, once. If you are reading this while adding a
  // THIRD state, the answer is not a third literal: it is that this clause has
  // stopped being a biconditional.
  //
  // and `recordAgreesWithTheCode` is `true` in BOTH worlds. The transition is one
  // deliberate two-field edit that CANNOT be made halfway:
  //
  //   * resolve the record while the flag still exists → red (the decision claims
  //     to be answered while the thing it decides is still deciding);
  //   * delete the flag while the record still says OPEN → red (the code answered
  //     a question the written decision still calls open — which is exactly how
  //     `engineEnabled` became something six sites read and nobody had chosen).
  //
  // Both directions are mutation-proven, and the second one is the one B4's
  // `stillOpen: true` could not have caught at all.
  //
  // ⚠️ AND THE STATUS TOKEN COMES FROM A CLOSED SET. `OPEN` / `RESOLVED` and
  // nothing else: a header that says neither, or both, reads `UNREADABLE` and
  // fails. `!/OPEN/` would have quietly accepted a typo as "resolved".
  //
  // ⚠️ THREE FIXES ARE LOAD-BEARING HERE, each closing a state that passed before:
  //
  //   1. THE STATUS LINE IS ISOLATED AND COUNTED. `/\*\*Status:\*\*…\bOPEN\b/.test(md)`
  //      scans the WHOLE document, so flipping the header to RESOLVED and
  //      appending any second `**Status:** … OPEN` line below turned this green
  //      while the decision it guards had been resolved. It also broke this
  //      file's own "every anchor appears EXACTLY ONCE" convention — and §10,
  //      added by the same task, already opens `**Status is UNCHANGED: OPEN.**`,
  //      one character from tripping it. So: split, count, and read the ONE line.
  //   2. THE PAIR IS AN EQUALITY, IN BOTH DIRECTIONS. `migrated \ flipped === []`
  //      IS `migrated ⊆ flipped` — it was the subset check its own message
  //      forbade. The Global Constraint is `FLIPPED === MIGRATED`, and the other
  //      direction is the worse half: flipped-but-not-migrated means the legacy
  //      block is DELETED and nothing is authorised to replace it, so the
  //      indicator vanishes for everyone, not just for the flag-less.
  //   3. THE SETS ARE PROBED FOR MUTABILITY, not assumed immutable.
  //      `Object.freeze(new Set())` does not stop `.add()`, so a module-scope
  //      `ENGINE_OWNED.add('stoch')` used to create the stranded
  //      category for real while every static rail read the source and saw
  //      nothing. `flipState.js` now seals the mutators; this probe is what
  //      fails if that seal is deleted.
  //
  // ⭐⭐ B5 TASK 9 RE-READS THE PREMISE, WHICH IS WHAT THE BRIEF ASKED FOR AND IS
  // NOT WHAT THE TITLE SUGGESTS. The record is RESOLVED (Task 4 moved it — the
  // biconditional above made that mandatory in the commit that deleted the flag,
  // not optional at Task 9), so *"while the settings migration is open"* is no
  // longer a live condition, and the two set-difference clauses are BOTH SATISFIED
  // BY TWO EMPTY SETS. That is the hole: a phase that emptied `ENGINE_OWNED`
  // and `ENGINE_OWNED` together would pass every clause here while every
  // indicator on every chart stopped being drawn by anything.
  //
  // ⛔ SO THE RAIL GAINS COMPLETENESS RATHER THAN LOSING ANYTHING: the two sets
  // must be EQUAL *and* must cover the whole registry. It is not deleted — a rail
  // dropped at the moment its premise changes is how this branch loses a
  // guarantee — and every existing clause still fails in its own direction.
  it('creates no migrated-but-un-flipped definition while the settings migration is open', () => {
    const record = read('docs/decisions/2026-08-03-engine-enabled-settings-migration.md')
    // The HEADER occurrence, not "somewhere in the file". `engineEnabledMigration.test.js`
    // takes the first such line; this additionally refuses a second one, because a
    // second one is how the first stops being the record's answer.
    const statusLines = record.split('\n').filter(l => l.startsWith('**Status:**'))

    /** The header's answer as a token from a CLOSED set. Anything that is neither
     *  — or both — is `UNREADABLE`, so a typo cannot read as "not OPEN". */
    const STATUS_TOKENS = ['OPEN', 'RESOLVED']
    const status = statusLines.length !== 1 ? 'UNREADABLE'
      : (STATUS_TOKENS.filter(t => new RegExp(`\\b${t}\\b`).test(statusLines[0])).join('+') || 'UNREADABLE')

    /** ⭐ THE OTHER HALF OF THE BICONDITIONAL: does the flag this record is ABOUT
     *  still decide anything? The probe is the READ — §1 of the record quotes this
     *  exact line as "the fact" — and not the `CHART_DEFAULTS` declaration, because
     *  a default nobody consults is precisely what §1 proves the declaration to be.
     *
     *  ⛔ COMMENT-STRIPPED, AND THAT IS NOT DECORATION. Every retirement on this
     *  branch leaves an explanatory comment naming what it deleted (Task 11 hit it
     *  from one side, Wave B's mount rail from the other). Task 4 deleting the flag
     *  and writing `// engineEnabled: parsed.engineEnabled === true — GONE` above
     *  the hole would keep a RAW probe green forever. */
    const FLAG_READ = /engineEnabled\s*:\s*parsed\s*\.\s*engineEnabled\s*===\s*true/

    // ⛔ THE PROBE'S OWN CONTROLS RUN FIRST, BOTH DIRECTIONS. If the pattern rots,
    // `flagLives` reads false and the object below fails — with a message pointing
    // at the flag instead of at the pattern. Ordering these ahead of it is the
    // difference between "the flag was deleted" and "the probe stopped working".
    expect(FLAG_READ.test('  engineEnabled: parsed.engineEnabled === true,'),
      'control: the flag probe matches nothing at all — it rotted, and `flagLives` below is a ' +
      'broken regex rather than a deleted flag').toBe(true)
    expect(FLAG_READ.test(stripComments('// engineEnabled: parsed.engineEnabled === true')),
      'control: a COMMENTED-OUT flag read still counts as a live one. The retirement that ' +
      'deletes this flag will leave a comment saying so, and a raw probe would read it as the ' +
      'flag.').toBe(false)

    const flagLives = FLAG_READ.test(stripComments(read('app/src/components/chart/chartDefaults.js')))

    /** Does this set actually take a write? Restores itself, and THROWS rather
     *  than leaking a probe id into every case that runs after this one. */
    const takesAWrite = (name, set) => {
      const before = [...set].join(',')
      try { set.add('__seal_probe__') } catch { return null }
      try { set.delete('__seal_probe__') } catch { /* reported below */ }
      if ([...set].join(',') !== before) {
        throw new Error(`${name} accepted a write this probe could not undo — restore it by hand`)
      }
      return name
    }

    expect({
      statusLines: statusLines.length,
      status,
      flagLives,
      recordAgreesWithTheCode: (status === 'OPEN') === flagLives,
      migratedNotFlipped: [...ENGINE_OWNED].filter(id => !ENGINE_OWNED.has(id)),
      flippedNotMigrated: [...ENGINE_OWNED].filter(id => !ENGINE_OWNED.has(id)),
      // ⭐ B5 TASK 9: COMPLETENESS. The two clauses above are set DIFFERENCES and
      // two empty sets satisfy both. After the cutover the settings blob no longer
      // carries an indicator's enable flag, so a definition outside the flip set
      // has no legacy section to fall back on and no block to draw it — it renders
      // for nobody, silently, and the equality above would still be green.
      unmigratedDefinitions: engineRegistry.listDefinitions()
        .map(d => d.id).filter(id => !ENGINE_OWNED.has(id)),
      unflippedDefinitions: engineRegistry.listDefinitions()
        .map(d => d.id).filter(id => !ENGINE_OWNED.has(id)),
      // …and the sets are not empty, which is what stops the three `[]`s above
      // being satisfied by a registry that lists nothing either.
      flipSetSize: ENGINE_OWNED.size,
      mutableSets: [
        takesAWrite('ENGINE_OWNED', ENGINE_OWNED),
        takesAWrite('ENGINE_OWNED', ENGINE_OWNED),
      ].filter(Boolean),
    },
    'FLIPPED === MIGRATED is a Global Constraint and this asserts the EQUALITY, both ways. ' +
    'migratedNotFlipped: the definition is engine-drawn ONLY on a chart with ' +
    'cs.engineEnabled === true and NO stored blob has that — flip it in this same change, or ' +
    'ship the versioned read-time migration FIRST (record §6 R1a, its own commit, gated from a ' +
    'JSON string) and re-run all 24 parity cases. flippedNotMigrated: the legacy block is gone ' +
    'and nothing is authorised to replace it — the indicator renders for NOBODY. mutableSets: ' +
    'a flip set accepted .add() at runtime, which no static rail in this tree can see; restore ' +
    "flipState.js's seal. statusLines: the record must carry exactly ONE **Status:** line, or " +
    'this rail is reading a sentence instead of the decision. status/flagLives/' +
    'recordAgreesWithTheCode: the record and the code have to answer the SAME question the same ' +
    'way — OPEN means `mergeChartSettings` still reads `parsed.engineEnabled === true`, ' +
    'RESOLVED means it does not. B5 Task 4 DID BOTH, in one commit, which is the only shape ' +
    'this clause admits: flagLives went false the moment the read was deleted, so leaving the ' +
    'header at OPEN would have been red, and flipping the header back now — with no flag to ' +
    'read — is red from the other side. Re-adding the flag is red too, and that is the ' +
    'direction the old `stillOpen: true` could not see at all. Do NOT weaken any of these to a ' +
    'subset check. unmigratedDefinitions/unflippedDefinitions/flipSetSize: B5 Task 9 added ' +
    'COMPLETENESS, because with the settings blob no longer carrying an enable flag a ' +
    'definition outside the flip set is drawn by NOTHING — and two EMPTY sets satisfy every ' +
    'set-difference clause above while every chart goes blank.',
    ).toEqual({
      statusLines: 1,
      status: 'RESOLVED',
      flagLives: false,
      recordAgreesWithTheCode: true,
      migratedNotFlipped: [],
      flippedNotMigrated: [],
      unmigratedDefinitions: [],
      unflippedDefinitions: [],
      flipSetSize: 17,
      mutableSets: [],
    })
  })

  // ⭐⭐⭐ PHASE D TASK 1 — THE REPAINT BADGE IS A SHARED DEFAULT, AND THE RECORD
  // THAT SAYS SO IS HELD DOWN THE SAME WAY THE `engineEnabled` ONE IS.
  //
  // Spec §3 annotates `meta.repaint` as *"Phase A/B: audited metadata
  // (UCT-authored only)"*. Measured, that is FALSE: `nativeRegistry.nativeDef`
  // writes `repaint: 'non-repainting'` in ONE shared helper and every native
  // inherits it, so nothing audited anything. And it is not merely un-audited,
  // it is contradicted — `compute_ichimoku_raw` writes bar `i`'s close to index
  // `i - kijun_period`, so a point at a HISTORICAL index moves while the newest
  // bar forms, which is spec §4's own definition of `repaints`.
  //
  // ⛔ SO WHY IS THERE A TEST HERE AT ALL, WHEN NO BADGE IS CHANGING? Because a
  // record whose only content is a sentence is a control that INVERTS SILENTLY,
  // and this file already carries the proof: B4 shipped `stillOpen: true` for
  // the `engineEnabled` record, and the day somebody was allowed to resolve it
  // the one available response was to edit `true` to `false` — after which the
  // clause asserted nothing at all, because "the record does not say OPEN"
  // constrains no code. Task 7's rail will read this same header. If the header
  // can be flipped to ACCEPTED with nothing else moving, then the artefact Task
  // 7 reads is a sentence somebody typed, and the `engine-enabled` trap — which
  // fired FOUR times on this branch — fires a fifth.
  //
  // The clause is therefore a BICONDITIONAL between the record and the code:
  //
  //     the record says OPEN  ⟺  the badge is still an unaudited shared default
  //
  //   * resolve the record while every definition still wears the helper's
  //     answer → red (the decision claims to be answered while nothing it
  //     decides has moved);
  //   * re-badge a definition, or give a PLOT its own badge, while this header
  //     still says OPEN → red (the code answered a question the written
  //     decision still calls open — exactly how `engineEnabled` became something
  //     six sites read and nobody had chosen).
  //
  // ⚠️ AND THE STATUS TOKEN COMES FROM A CLOSED SET — `OPEN` / `RESOLVED` and
  // nothing else. `!/OPEN/` would quietly accept a typo, or the word ACCEPTED,
  // as "resolved". Anything that is neither, or both, reads `UNREADABLE`.
  //
  // ⚠️ THE OWNER'S RULING IS PER-PLOT (record §4), so `plotsWithOwnBadge` is a
  // clause and not decoration: the day a plot carries its own badge, the badge
  // has stopped being a per-definition default and this record must resolve. A
  // biconditional written only against `meta.repaint` would have missed the
  // shape the ruling actually takes.
  it('⭐ the repaint badge is a shared DEFAULT, and this record says so — the biconditional', () => {
    const RECORD = 'docs/decisions/2026-08-06-machine-repaint-linter.md'
    const md = read(RECORD)
    // The HEADER occurrence, not "somewhere in the file": a second `**Status:**`
    // line is how the first stops being the record's answer.
    const statusLines = md.split('\n').filter(l => l.startsWith('**Status:**'))
    const STATUS_TOKENS = ['OPEN', 'RESOLVED']
    const status = statusLines.length !== 1 ? 'UNREADABLE'
      : (STATUS_TOKENS.filter(t => new RegExp(`\\b${t}\\b`).test(statusLines[0])).join('+') || 'UNREADABLE')

    /** The shared default, as a SHAPE rather than a literal. B4 measured a
     *  demand-zero literal guard staying green against a reintroduction with
     *  only the spaces around `=` removed, so every probe in this file tolerates
     *  arbitrary whitespace. The `...meta` spread is part of the shape on
     *  purpose: it is what makes this a DEFAULT (a per-definition `repaint` in
     *  `meta` would override it) rather than a hardcoded answer. */
    const SHARED_DEFAULT = /repaint\s*:\s*'non-repainting'\s*,\s*\.\.\.meta/

    // ⛔ THE PROBE'S OWN CONTROLS RUN FIRST, BOTH DIRECTIONS — the idiom the
    // `engineEnabled` rail above established. If the pattern rots,
    // `sharedDefaultLives` reads false and the object below fails with a message
    // pointing at the badge instead of at the regex.
    expect(SHARED_DEFAULT.test("  meta: { tier: 'free', repaint: 'non-repainting', ...meta },"),
      'control: the shared-default probe matches nothing at all — it rotted, and `sharedDefaultLives` ' +
      'below is a broken regex rather than a deleted default').toBe(true)
    expect(SHARED_DEFAULT.test(stripComments("// meta: { tier: 'free', repaint: 'non-repainting', ...meta },")),
      'control: a COMMENTED-OUT default still counts as a live one. Every retirement on this branch ' +
      'leaves a comment naming what it deleted, and a raw probe would read the tombstone as the thing.',
    ).toBe(false)

    const REG = stripComments(read('app/src/components/chart/engine/nativeRegistry.js'))

    /** Every place the registry SOURCE declares the field. Two today — the
     *  helper's, and `rsLine`'s, which does not pass through the helper at all
     *  and therefore retypes the same sentence rather than judging independently.
     *  Counted from source rather than from the shipped objects because after the
     *  `...meta` spread EVERY definition carries the key, so the built catalogue
     *  cannot tell a declaration from an inheritance. */
    const declarationsInSource = [...REG.matchAll(/\brepaint\s*:/g)].length

    const defs = engineRegistry.listDefinitions()

    expect({
      statusLines: statusLines.length,
      status,
      sharedDefaultLives: SHARED_DEFAULT.test(REG),
      declarationsInSource,
      // the distinct answers the whole catalogue gives — a UNIFORM column is
      // indistinguishable from an unset one, and today it is an unset one.
      badgeValues: [...new Set(defs.map(d => d.meta.repaint))].sort(),
      definitionsBadgedRepaints: defs.filter(d => d.meta.repaint !== 'non-repainting').map(d => d.id),
      // the owner's ruling is PER PLOT (record §4). No plot carries one yet.
      plotsWithOwnBadge: defs.flatMap(d => (d.plots || [])
        .filter(p => p && Object.prototype.hasOwnProperty.call(p, 'repaint'))
        .map(p => `${d.id}.${p.key}`)),
      // ⛔⭐⭐ THE FLOOR UNDER THE PER-PLOT CLAUSE, AND IT WAS ADDED ON A
      // MEASUREMENT RATHER THAN A HUNCH. A default-to-empty read of the plots
      // field answers empty for a definition shape that renamed it — so a RENAME
      // makes `plotsWithOwnBadge` `[]` and the third clause of
      // `recordAgreesWithTheCode` `true`, and the entire per-plot half of this
      // biconditional passes while asserting NOTHING. Proven by mutation, not
      // argued: renaming `plots` → `plotsRENAMED` in both reads left this case
      // GREEN. Since the owner's ruling is per PLOT, that is the one clause
      // guaranteed to matter at Task 7, and it was the one with no floor.
      //
      // ⚠️ A LIST, NOT A COUNT, ON PURPOSE. An exact plot total would go red
      // every time anybody adds a plot to any definition — churn that teaches
      // people to bump the number without reading it. This asks the structural
      // question instead: *is there a definition the plot walk cannot see?* On a
      // rename EVERY id lands in this list and the failure names them all.
      defsWithNoPlots: defs.filter(d => !(d.plots || []).length).map(d => d.id),
      // …and the catalogue is not empty, which is what stops the three `[]`s
      // above being satisfied by a registry that lists nothing.
      definitionCount: defs.length > 0,
      recordAgreesWithTheCode:
        (status === 'OPEN') === (SHARED_DEFAULT.test(REG)
          && defs.every(d => d.meta.repaint === 'non-repainting')
          && defs.every(d => (d.plots || []).every(p => !Object.prototype.hasOwnProperty.call(p, 'repaint')))),
    },
    'statusLines: the record must carry exactly ONE **Status:** line, or this rail is reading a ' +
    'sentence instead of the decision. status: the token comes from a CLOSED set — a header that ' +
    'says ACCEPTED, or says nothing, or says both, reads UNREADABLE and fails, because `!/OPEN/` ' +
    'would have accepted a typo as "resolved". sharedDefaultLives/declarationsInSource/badgeValues/' +
    'definitionsBadgedRepaints/plotsWithOwnBadge: this is the CODE half of the biconditional — ' +
    'OPEN means the badge is still a shared default that no definition overrides and no plot ' +
    'carries. recordAgreesWithTheCode: the record and the code must answer the SAME question the ' +
    'same way, in BOTH directions. Resolving the record with no badge moved is red; moving a badge ' +
    '(or adding a per-plot one) with the header still OPEN is red, and that second direction is ' +
    'the one a bare `stillOpen: true` could not see at all. ⛔ AND THE BADGE VALUES ARE TASK 7\'s, ' +
    'ON A MEASUREMENT — a disagreement between the linter and a shipped badge is a FINDING FOR THE ' +
    'OWNER, never a badge edit, so a task arriving here to make this green by editing ' +
    '`nativeRegistry.js` has misread the record it is guarding.',
    ).toEqual({
      statusLines: 1,
      status: 'OPEN',
      sharedDefaultLives: true,
      declarationsInSource: 2,
      badgeValues: ['non-repainting'],
      definitionsBadgedRepaints: [],
      plotsWithOwnBadge: [],
      defsWithNoPlots: [],
      definitionCount: true,
      recordAgreesWithTheCode: true,
    })
  })

  // ⭐ AND THE RECORD MAY NOT QUOTE A TEST TITLE THAT DOES NOT EXIST.
  //
  // 🔴 THIS IS NOT HYPOTHETICAL — IT WAS ROTTEN AT HEAD, AND FIXING IT IS WHAT
  // ADDED THIS TEST. §10's closing paragraph sent the reader to
  // *"`enumerationSites.test.js` → the retirement column adds up"* for the
  // ledger partition. B4 Task 4 RENAMED that test (it is *"every B4 region is
  // retired…"* now), so the record's one pointer at the assertion it deliberately
  // refuses to restate pointed at nothing, and nothing went red. A doc quoting a
  // test's title is the same control-rot shape as a comment quoting its expected
  // literal — it stays green while its premise goes false.
  //
  // ⛔ BOUNDED ON PURPOSE, AND THE BOUND IS STATED. Only the arrow-and-quote form
  // (`` `<file>` → *"<title>"* ``) is checked, because that is the form that
  // promises a verbatim title; the §9 table's italicised PARAPHRASES
  // (*flipping the default does not heal a stored blob* — lowercased, no quotes)
  // are prose about a test, not a citation of one, and holding prose to a
  // byte-match would make this a rail nobody trusts. Whitespace is normalised
  // first because markdown wraps a citation across lines.
  //
  // 🔴 AND THE OBVIOUS SPELLING IS WRONG, MEASURED WHILE WRITING THIS. The first
  // draft asked `read(file).includes(title)`, which went RED on a title that is
  // perfectly live — because this very comment quotes the STALE one, and the
  // paragraph above quotes it too. A file that EXPLAINS a rename contains the old
  // name; `includes` cannot tell a citation from an explanation, so it would have
  // called a renamed test "still there" for as long as one comment remembered it.
  // The probe extracts the file's actual `it(…)` / `describe(…)` titles instead,
  // comments stripped — the same lesson `sourceScan.js` exists for, arriving from
  // a third direction.
  it('⭐ every test title the decision record cites verbatim is a title that exists', () => {
    const HERE = 'app/src/components/chart/engine/__tests__/'

    /** The titles a suite actually declares — not "text that appears in it". */
    const titlesIn = (src) => [...stripComments(src)
      .matchAll(/\b(?:it|describe)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)]
      .map(m => m[2].replace(/\\(['"\\])/g, '$1'))

    // ⛔ THE EXTRACTOR'S OWN CONTROL, BOTH DIRECTIONS, ON A FIXTURE. A declared
    // title counts; the same words in a comment do not — which is the exact
    // confusion that made the first draft of this test red.
    const FIXTURE = "// it('a title that lives only in a comment')\n" +
      "it('a declared title')\ndescribe('a declared suite', () => {})"
    expect(titlesIn(FIXTURE).sort(),
      'the title extractor reads prose as a declaration, or cannot read a declaration',
    ).toEqual(['a declared suite', 'a declared title'])

    // ⚠️ BLOCKQUOTE MARKERS COME OFF BEFORE THE WHITESPACE COLLAPSE, and that is
    // not tidiness — measured here. A citation inside a `>` block wraps as
    // `…title the\n> decision record…`, and collapsing whitespace first turns the
    // continuation marker into a WORD: the extracted title reads
    // `every test title the > decision record cites…` and a live citation is
    // reported missing. Strip `>` prefixes per line, then join.
    //
    // ⭐⭐ PHASE D TASK 1 — THIS SCANS A LIST OF RECORDS NOW, NOT ONE FILE. The
    // repaint record cites five titles in the same arrow-and-quote form, and a
    // second record left unscanned is the same rot arriving in a second
    // document. Adding a record to this list costs one line; leaving it off
    // costs the guarantee, silently.
    const RECORDS = [
      'docs/decisions/2026-08-03-engine-enabled-settings-migration.md',
      'docs/decisions/2026-08-06-machine-repaint-linter.md',
    ]
    const CITATION = /`([A-Za-z]+\.test\.jsx?)`\s*→\s*\*"([^"]+)"\*/g
    const perRecord = RECORDS.map(r => ({
      record: r,
      cites: [...read(r)
        .split('\n').map(l => l.replace(/^(?:\s*>)+\s?/, '')).join('\n')
        .replace(/\s+/g, ' ')
        .matchAll(CITATION)].map(m => ({ file: m[1], title: m[2] })),
    }))
    const cited = perRecord.flatMap(x => x.cites)

    // ⛔⭐⭐ THE FLOOR IS PER RECORD, AND THAT WAS A DEFECT FOUND BY MUTATION.
    // A single `cited.length >= 3` over the CONCATENATION of both records is
    // satisfied by EITHER of them alone — measured: stripping all four
    // citations out of the repaint record left this case GREEN, because the
    // engine-enabled record still carried three. The moment a second record
    // joined this list, the aggregate floor stopped being a floor for either
    // one. Asked per record, and BY NAME, a record whose citations all vanish
    // says which record it was.
    expect(perRecord.filter(x => x.cites.length === 0).map(x => x.record),
      'a decision record on this list cites no test title at all. Either its citations were ' +
      'removed (and the record now points at nothing — worse than no pointer, because prose ' +
      'still reads as evidence), or the citation form changed and this scan is stale.',
    ).toEqual([])

    expect(cited.length,
      'the record cites no test title at all — either the citation form changed and this scan ' +
      'is stale, or the whitespace normalisation broke').toBeGreaterThanOrEqual(3)

    const missing = cited.filter(c => !titlesIn(read(`${HERE}${c.file}`)).includes(c.title))
      .map(c => `${c.file} :: ${JSON.stringify(c.title)}`)
    expect(missing,
      'the decision record quotes a test title that no longer exists. Whoever renamed the test ' +
      'left the record pointing at nothing, and a pointer at nothing is worse than no pointer: ' +
      'it reads as evidence. Rename the citation in the same commit as the test.',
    ).toEqual([])

    // …and the scan can really FAIL against the REAL file: the renamed title is
    // gone from this suite's declarations even though the prose above still names
    // it, and the live one is found. Three green citations otherwise prove only
    // that `includes` returns true sometimes.
    const own = titlesIn(read(`${HERE}enumerationSites.test.js`))
    expect(own.includes('the retirement column adds up'),
      'control: the OLD, renamed title is a declared title again — the check above proves nothing',
    ).toBe(false)
    expect(own.includes('creates no migrated-but-un-flipped definition while the settings migration is open'),
      'control: the live cited title is not found in its own file — the extractor is broken',
    ).toBe(true)
  })
})

describe('adjudication A6 — the settings tab lists nothing the engine owns', () => {
  it('listIndicators() contains no migrated definition, by id or by settings path', () => {
    const rows = listIndicators(mergeChartSettings(null))
    const owned = rows.filter(r => ENGINE_OWNED.has(r.id) || ENGINE_OWNED.has(r.path?.key))
    expect(owned.map(r => r.id),
      'a hand-written settings row and an engine definition are two sources of truth for one indicator',
    ).toEqual([])
  })

  it('and the engine-owned rows hand-write no field — they are derived', () => {
    const src = read('app/src/components/chart/indicatorRegistry.js')
    const fieldTables = [...src.matchAll(/export const (\w*_FIELDS)\b/g)].map(m => m[1])
    expect(fieldTables,
      'a per-indicator field table came back. `engine/defSchema.js` IS that layer; ' +
      'a second one is a second source of truth per indicator.',
    ).toEqual(['MA_FIELDS', 'VOLUME_FIELDS'])

    // …and every row really is built from its definition: every declared input,
    // in declaration order, no more and no fewer. ⚠️ This used to loop over
    // `ENGINE_ROW_DEF_IDS` (one id). B4 Task 6 deleted that list, so it loops
    // over the REGISTRY — which is the point of the deletion.
    const rows = listEngineIndicators(mergeChartSettings(null), engineRegistry)
    expect(rows.length, 'no generated rows at all — the loop below is vacuous').toBeGreaterThan(0)
    for (const def of engineRegistry.listDefinitions()) {
      const row = rows.find(r => r.id === def.id)
      expect(row, `${def.id} has no generated row`).toBeTruthy()
      expect(row.fields.map(f => f.key), def.id).toEqual(def.inputs.map(i => i.key))
    }
  })

  // ⭐⭐ B5 TASK 12 — ADJUDICATION A6 RE-POINTED, BECAUSE ITS FILE IS DELETED.
  //
  // It read `paneMargins.js` off disk and asserted no price overlay had gained a
  // `key:` row there. That file is gone, so the assertion would have passed over
  // NOTHING — the classic shape this ledger exists to catch. The CLAIM survives
  // intact and is now made where the fact lives: a price overlay must declare no
  // `placement.pane`, because a declared pane height is exactly what would
  // reserve vertical space for something that draws inside the candles' pane.
  //
  // ⛔ AND IT IS FAILABLE, PROVED IN THE SAME CASE rather than asserted: a
  // CONSTRUCTED price-overlay definition that DOES declare a pane height is run
  // through the same predicate and must be caught. Task 3's `defSchema` twin
  // checks the shape; this checks the POLICY, on the shipped catalogue.
  it('a price overlay reserves no vertical space — adjudication A6, at its new address', () => {
    const reserves = (def) => !!(def && def.placement && def.placement.pane
      && typeof def.placement.pane.height === 'number')
    let checked = 0
    for (const def of engineRegistry.listDefinitions()) {
      if (def.placement.target !== 'price') continue
      checked++
      expect(reserves(def),
        `${def.id} is a price overlay — a pane height for it would reserve space for nothing`)
        .toBe(false)
    }
    // Non-vacuity: every price overlay really was visited, by name. SEVEN since
    // Phase C Task 14 — `avwap` and `atrBands` draw inside the candles' pane too,
    // so A6 covers them and this count is what says so.
    expect(checked).toBe(7)
    expect(engineRegistry.listDefinitions().filter(d => d.placement.target === 'price').map(d => d.id))
      .toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian', 'avwap', 'atrBands'])
    // …and the predicate catches the thing it is for.
    expect(reserves({ placement: { target: 'price', pane: { height: 0.15 } } })).toBe(true)
    // …and the file it used to read really is gone, so nobody re-points it back.
    expect(fs.existsSync(path.join(ROOT, 'app/src/components/chart/paneMargins.js'))).toBe(false)
  })
})

describe('the surviving enumeration is the registry, and it has to stay complete', () => {
  // ⚠️ `volumeProfile` is a settings section with NO definition — a canvas
  // overlay drawn by hand, not a series. It is EXEMPTED BY NAME rather than by a
  // loose assertion, so a SIXTEENTH section added without a definition fails here
  // instead of joining a silent exemption.
  const NO_DEFINITION = ['volumeProfile']

  it('every settings section has an engine definition, or is a named exemption', () => {
    const defined = new Set(engineRegistry.listDefinitions().map(d => d.id))
    const orphans = Object.keys(CHART_DEFAULTS.indicators).filter(k => !defined.has(k) && !NO_DEFINITION.includes(k))
    expect(orphans,
      'an indicator was added to the settings blob without an engine definition. That is the ' +
      'old way: it now needs a render block, a ref, a crosshair read, a pane row, a label, a ' +
      'toolbar row and a keyboard case. Declare it in nativeRegistry instead.',
    ).toEqual([])
    // The exemption list must not rot either: an exempted key that GAINS a
    // definition should leave the list.
    expect(NO_DEFINITION.filter(k => defined.has(k)), 'a named exemption gained a definition').toEqual([])
  })

  // ⭐⭐ B5 TASK 9 INVERTED THIS ONE, AND THE INVERSION IS THE TASK.
  //
  // It read *"every definition has a settings section — nothing can be migrated
  // from a blob it has no key in"*, and it was the right rail while the BLOB was
  // the authority: a definition with no section could never be reached by the
  // migrator. The blob is not the authority any more. `CHART_DEFAULTS.indicators`
  // is `{volumeProfile}`, and what the fold reads is the STORED section of a v1
  // blob — which every existing user has and no default table is needed for.
  //
  // ⛔ SO THE CLAIM MOVES DOWN A LEVEL RATHER THAN BEING DELETED: what has to be
  // true is that a definition is still REACHABLE from a v1 blob that names it.
  // That is what the old rail was protecting, it is what an existing user's data
  // depends on, and it is asserted end to end — from a JSON STRING, through the
  // real merge — for every definition there is.
  it('every definition is REACHABLE from a v1 blob that names it', () => {
    const defs = engineRegistry.listDefinitions()
    expect(defs.length, 'no definitions — this case proves nothing').toBe(REGISTRY_SIZES.total)
    const unreachable = []
    for (const def of defs) {
      const blob = JSON.stringify({ indicators: { [def.id]: { enabled: true } } })
      const cs = mergeChartSettings(JSON.parse(blob))
      if (!cs.indicatorInstances.some(i => i.defId === def.id)) unreachable.push(def.id)
    }
    expect(unreachable,
      'a definition cannot be reached from a stored v1 blob that turns it on. Every user who '
      + 'has it enabled loses it silently on the next read, and there is no default table left '
      + 'to fall back to.').toEqual([])
    // ⛔ AND THE OTHER DIRECTION, which is what stops this passing on a fold that
    // seeds an instance for anything at all: a key naming no definition seeds
    // nothing, and the blob's one surviving section is the carve-out.
    const junk = mergeChartSettings(JSON.parse('{"indicators":{"notADefinition":{"enabled":true}}}'))
    expect(junk.indicatorInstances).toEqual([])
    expect(Object.keys(CHART_DEFAULTS.indicators)).toEqual(NO_DEFINITION)
  })
})

describe('what B4 inherits — measured, per definition, not approximated', () => {
  const TOOLBAR = read('app/src/components/chart/ChartToolbar.jsx')

  /** Which inputs the toolbar's own row can reach, per definition. The rows call
   *  exactly one writer, `updateIndicator('<defId>', '<inputKey>', …)`. */
  const toolbarInputs = (defId) => new Set(
    [...TOOLBAR.matchAll(/updateIndicator\('([A-Za-z]+)',\s*'([A-Za-z]+)'/g)]
      .filter(m => m[1] === defId).map(m => m[2]),
  )

  // ⭐ RE-MEASURED AT B4 TASK 8, AND IT IS NOW **EVERYTHING, BY DESIGN**.
  //
  // Measured at `9f787749` this was "every declared input of a migrated
  // definition that NO control surface can reach except the settings tab's
  // generated row" — `macd`'s two colours (a gap no surface closed) and `vwap`'s
  // opacity / line style / line width (the reason VWAP kept a row). Task 8
  // deleted the toolbar's fifteen rows, so `toolbarInputs()` matches nothing and
  // the toolbar reaches NO declared input of ANY definition.
  //
  // ⛔ THAT IS ONLY SAFE BECAUSE TASK 6 LANDED FIRST. The successor rail above —
  // *every declared input of every definition is reachable from the generated
  // dialog* — is what stops this from meaning "these inputs are unreachable".
  // It is asserted from the DEFINITIONS rather than typed, because a hand-typed
  // "everything" is a table that rots the moment an input is declared.
  //
  // ⚠️ THE HELPER IS KEPT, NOT DELETED. "The toolbar grew a control back" is
  // still worth failing on, and a helper that stops looking is a control that
  // rots — the same reason `RETIRED_BY_B4` re-runs its patterns demanding zero.
  const UNREACHABLE_FROM_THE_TOOLBAR = Object.fromEntries(
    [...ENGINE_OWNED].map(id => [id, engineRegistry.getDefinition(id).inputs.map(i => i.key)]),
  )

  it('pins exactly which declared inputs the toolbar cannot reach', () => {
    const measured = {}
    for (const id of ENGINE_OWNED) {
      const covered = toolbarInputs(id)
      measured[id] = engineRegistry.getDefinition(id).inputs.map(i => i.key).filter(k => !covered.has(k))
    }
    expect(measured,
      'the toolbar gained a control for a migrated indicator. B4 Task 8 retired all fifteen of ' +
      'its indicator rows for a launcher; a control here is a duplicate of the generated dialog, ' +
      'which reaches strictly more.',
    ).toEqual(UNREACHABLE_FROM_THE_TOOLBAR)
    // ⛔ AND THE HELPER STILL WORKS. `toolbarInputs` matching nothing is the
    // EXPECTED answer now, which makes a BROKEN regex indistinguishable from a
    // clean toolbar — so it is run against a string that must match.
    expect([...'updateIndicator(\'rsi\', \'period\', x)'.matchAll(
      /updateIndicator\('([A-Za-z]+)',\s*'([A-Za-z]+)'/g)].length,
      'the toolbarInputs pattern matches nothing at all — it rotted, and its zero above is a ' +
      'broken regex rather than a retired surface').toBe(1)
  })

  // ⛔ THE SUCCESSOR RAIL, AND THE RAIL IT SUCCEEDS FIRED AS DESIGNED.
  //
  // What used to be here was *"every id that keeps a generated row still has a
  // control that exists NOWHERE ELSE"*, iterating `ENGINE_ROW_DEF_IDS`. That
  // constant existed only while SOME definitions had a generated row and others
  // did not; B4 Task 6 gave every definition one and deleted it, which is
  // exactly the deletion that rail was written to demand. It is REPLACED, not
  // removed — a rail that retires without a successor is how this file grew the
  // problem it is retiring.
  //
  // The question changed with the answer: not "which ids keep a row" but "is
  // there a declared input NO surface can reach". `UNREACHABLE_FROM_THE_TOOLBAR`
  // above is on its way to being EVERYTHING (Task 8 deletes the toolbar's
  // fifteen rows), and this is what makes that safe.
  it('every declared input of every definition is reachable from the generated dialog', () => {
    const rows = listEngineIndicators(mergeChartSettings(null), engineRegistry)
    const gaps = []
    for (const def of engineRegistry.listDefinitions()) {
      const row = rows.find(r => r.id === def.id)
      const reachable = new Set((row ? row.fields : []).map(f => f.key))
      for (const i of def.inputs) if (!reachable.has(i.key)) gaps.push(`${def.id}.${i.key}`)
    }
    expect(gaps,
      'a declared input has no control anywhere. That is the state MACD\'s macdColor / ' +
      'signalColor were in for the whole of B3 — measured, pinned, and B4\'s to close.',
    ).toEqual([])
    // …and it is not vacuous: the definitions really do declare inputs.
    expect(engineRegistry.listDefinitions().flatMap(d => d.inputs).length,
      'no definition declares an input — the loop above proves nothing').toBeGreaterThan(20)
  })

  it('MACD\'s two colours have a control now — the gap B3 measured and could not close', () => {
    const row = listEngineIndicators(mergeChartSettings(null), engineRegistry).find(r => r.id === 'macd')
    const colors = row.fields.filter(f => f.type === 'color').map(f => f.key)
    expect(colors).toEqual(['macdColor', 'signalColor'])
    expect(row.fields.find(f => f.key === 'macdColor').disabled).toBeUndefined()
    // …and the pin above still records that the TOOLBAR cannot reach them, so
    // this closure is visible as a closure rather than as a table edit. ⚠️ It
    // used to name exactly those two, because the toolbar reached MACD's three
    // periods; Task 8 deleted the rows, so the pin is now every declared input
    // and the two colours are asserted to be AMONG them rather than to BE them.
    expect(UNREACHABLE_FROM_THE_TOOLBAR.macd).toEqual(expect.arrayContaining(['macdColor', 'signalColor']))
  })

  it('and nothing was silently dropped: every migrated id\'s toolbar gap is named above', () => {
    for (const id of ENGINE_OWNED) {
      const covered = toolbarInputs(id)
      const uncovered = engineRegistry.getDefinition(id).inputs.map(i => i.key).filter(k => !covered.has(k))
      expect(uncovered,
        `${id} has declared inputs no surface can reach and no row to reach them from`,
      ).toEqual(UNREACHABLE_FROM_THE_TOOLBAR[id])
    }
  })
})
