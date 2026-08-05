import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ENGINE_MIGRATED_DEF_IDS, ENGINE_FLIPPED_DEF_IDS } from '../flipState'
import { listIndicators, listEngineIndicators } from '../../indicatorRegistry'
import { CHART_DEFAULTS, mergeChartSettings } from '../../chartDefaults'
import { uctDefaultChartSettings } from '../../../../pages/charts/ChartsWorkspace'
import * as engineRegistry from '../nativeRegistry'
import { stripComments } from './sourceScan'

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
  // ⭐ B4 ADJUDICATION A2 (2026-08-03). B3's Task 13 recorded a dispute and
  // deliberately left it: PANES is LABELLED B4, but by this file's own legend it
  // is B5. UPHELD, for two independent reasons. It is a LAYOUT table — ten
  // {key, enabled, baseH} rows handing each enabled oscillator a stacked band —
  // with nothing to do with the §6 dialog, the legend, the control doors or the
  // voice bus, and it retires when bands stop being bands: Flip C, which is B5's
  // (⚠️ NOT the fate letter `C` above — that is the Phase-C ALERT rebuild; the
  // two Cs are different things and this line is where they meet). And B4 is
  // FORBIDDEN from modifying paneMargins.js at all — "consumed, never modified"
  // is a Global Constraint of that phase AND an assertion in this file
  // (`adjudication A6` → *paneMargins.js is still CONSUMED, not owned*).
  // A site a phase may not touch cannot carry that phase's fate. The engine
  // still DEPENDS on it, through `engine/paneMarginsProjection.csForPaneMargins`.
  { file: 'app/src/components/chart/paneMargins.js', region: 'PANES — the oscillator stacking list, 9 + volume',
    anchor: 'const PANES = [', fate: 'B5' },
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
  { file: 'api/services/indicator_alert_evaluator.py', region: "INDICATOR_FUNCS — the evaluator, and after B4 the alert catalog's ONE authority",
    anchor: 'INDICATOR_FUNCS: dict[str,', fate: 'C' },
  // ⭐ THE SIXTH SITE THE JS DISCOVERY SCAN STRUCTURALLY CANNOT SEE, found by the
  // wave that fixed the voice bus and added here by this file's one writer. The
  // scan below walks `app/src/**/*.jsx?` only, so a Python enumeration is
  // invisible to it however many ids it names — which is exactly the shape that
  // turned 7 into 32. Fate `C`: it is a PHRASE map ("bollinger bands" →
  // `bb`, "parabolic sar" → `sar`), i.e. speech-recognition synonyms, and
  // nothing in a definition declares what a user might say out loud. If it ever
  // becomes derivable it is from `meta.name`/`meta.shortName` plus a synonym
  // list that still has to live somewhere.
  { file: 'api/services/voice_client_action_tools.py', region: '_INDICATOR_ALIASES — the voice add_chart_indicator phrase map',
    anchor: '_INDICATOR_ALIASES = {', fate: 'C' },

  // ── the engine ───────────────────────────────────────────────────────────
  { file: 'app/src/components/chart/engine/nativeRegistry.js', region: 'RAW_DEFS — THE ONE THAT SHOULD SURVIVE',
    anchor: 'const RAW_DEFS = [', fate: 'keep' },
  { file: 'app/src/components/chart/engine/flipState.js', region: 'ENGINE_MIGRATED_DEF_IDS',
    anchor: 'export const ENGINE_MIGRATED_DEF_IDS', fate: 'phase' },
  { file: 'app/src/components/chart/engine/flipState.js', region: 'ENGINE_FLIPPED_DEF_IDS',
    anchor: 'export const ENGINE_FLIPPED_DEF_IDS', fate: 'phase' },

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
 *  phase whose remaining work is invisible here. */
const SITE_COUNT = 8

describe('the enumeration ledger — the count is a test, not a comment', () => {
  it(`holds ${SITE_COUNT} live sites, and every one of them is still where it says it is`, () => {
    const problems = []
    for (const site of LEDGER) {
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
  it('every B4 region is retired — 1 to B5, 2 to C, 3 kept, 2 phase bookkeeping', () => {
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
    // ⛔ AND THERE IS NO `B4: 0`. `reduce` emits no key for a fate with no
    // members, so writing one would never match. **B4's bucket is EMPTY** —
    // every region B4 inherited has been retired, and the ABSENCE of the key is
    // what says so. A `B4` row reappearing here fails this line by name.
    expect(counts).toEqual({ B5: 1, C: 2, keep: 3, phase: 2 })
  })

  // ⭐ B5 A8. THE ASSERTION ABOVE IS A HISTOGRAM AND B4'S REVIEW MEASURED ITS
  // BLIND SPOT: swapping two sites' fates preserves every count and passes
  // (review M6, `.superpowers/sdd/2026-08-03-phase-b4-surfaces/task-1-review.md`).
  // B5 EMPTIES TWO OF THE FOUR BUCKETS, so the space a permutation can hide in
  // gets SMALLER and therefore easier to fall into, not harder: with `B5` and
  // `phase` gone, `{C: 2, keep: 3}` has exactly ten fate-preserving permutations
  // and every one of them is green above.
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
    ).toEqual([
      ['api/services/indicator_alert_evaluator.py::INDICATOR_FUNCS — the evaluator, and after B4 the alert catalog\'s ONE authority', 'C'],
      ['api/services/voice_client_action_tools.py::_INDICATOR_ALIASES — the voice add_chart_indicator phrase map', 'C'],
      ['app/src/components/chart/engine/flipState.js::ENGINE_FLIPPED_DEF_IDS', 'phase'],
      ['app/src/components/chart/engine/flipState.js::ENGINE_MIGRATED_DEF_IDS', 'phase'],
      ['app/src/components/chart/engine/nativeRegistry.js::RAW_DEFS — THE ONE THAT SHOULD SURVIVE', 'keep'],
      ['app/src/components/chart/keyboardShortcuts.js::INDICATOR_CHORDS — the four chord bindings, declared once', 'keep'],
      ['app/src/components/chart/paneMargins.js::PANES — the oscillator stacking list, 9 + volume', 'B5'],
      ['tools/chart_parity_cases.json::the parity case list', 'keep'],
    ])
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
    expect(SC).toContain('engineChips(engineRef.current.binder.bindings()')
    expect(read('app/src/components/chart/engine/readout.js')).toContain('export function chipsFrom(')

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
      'disappears the moment one of these nine loses it, on EITHER lane').toEqual([
      'atr::atr', 'ichimoku::kijun', 'ichimoku::tenkan', 'macd::macd', 'macd::signal',
      'rsi::rsi', 'sar::sar', 'stoch::d', 'stoch::k',
    ])
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
    const ENGINE_LANE_CHIPS = ['rsi', 'macd', 'stoch', 'atr', 'sar', 'ichimoku']
    const LEGACY_LANE_CHIPS = []
    for (const id of ENGINE_LANE_CHIPS) {
      expect(ENGINE_MIGRATED_DEF_IDS.has(id),
        `${id} carries a chip and is NOT migrated — its chip comes from the legacy lane, ` +
        'so move it back to LEGACY_LANE_CHIPS').toBe(true)
      expect(ENGINE_FLIPPED_DEF_IDS.has(id),
        `${id} is migrated but not flipped — with engineEnabled deleted that is an ` +
        'indicator drawn by NOTHING').toBe(true)
    }
    for (const id of LEGACY_LANE_CHIPS) {
      expect(ENGINE_MIGRATED_DEF_IDS.has(id),
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
      .toHaveLength(14)
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
    expect(defs.length, 'no definitions — this case proves nothing').toBe(14)
    for (const def of defs) {
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
    expect(src).toContain("isIndicatorEnabled(cs, row.id, ENGINE_FLIPPED_DEF_IDS)")
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
    const b5Walkable = [...new Set(LEDGER.filter(s => s.fate === 'B5').map(s => s.file))]
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
    expect(b5Walkable, 'no B5 walkable file on the ledger — the check below is vacuous')
      .toEqual(['app/src/components/chart/paneMargins.js'])
    expect(b5Walkable.filter(f => !found.includes(f)),
      'the discovery scan cannot see a file the LEDGER fates to B5 — a site B4 cannot have ' +
      'retired. The scan is broken (walk root, regexes, or the `.test.` skip), not the tree.',
    ).toEqual([])
  })

  // ⭐ AND THE STRIPPER ITSELF, BOTH DIRECTIONS, ON THE SCAN'S OWN PREDICATE.
  //
  // The floor above proves the scan still finds four B5 files; it cannot prove
  // WHY. These four fixtures are the actual shapes that were measured on this
  // branch — a comment that invents an enumeration, a comment that hides a call,
  // a string that IS one, and a regex whose `//` used to eat the rest of its line.
  it('⭐ the scan reads CODE, not prose — and still reads code', () => {
    const PROSE = [
      "// the legend's nine chips: stoch::k, stoch::d, atr, sar and ichimoku's two",
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
  }
  /** …and the compute its `indicatorData` branch called. */
  const COMPUTES = {
    rsi: 'computeRSI', bb: 'computeBB', macd: 'computeMACD', vwap: 'computeVWAP',
    stoch: 'computeStochastic', atr: 'computeATR', sar: 'computeParabolicSAR',
    ichimoku: 'computeIchimoku', mfi: 'computeMFI', cci: 'computeCCI',
    williamsR: 'computeWilliamsR', adx: 'computeADX', obv: 'computeOBV',
    donchian: 'computeDonchian',
  }

  it('⛔ the two tables COVER the flip set — a missing row is a silent no-op', () => {
    // The gate on the finding above. `REFS[id] || []` and `if (fn && …)` both
    // pass by DEFAULT for an id nobody listed, so without this the two cases
    // below shrink in coverage every time the flip set grows and stay green.
    const missing = [...ENGINE_FLIPPED_DEF_IDS].filter(id => !REFS[id] || !COMPUTES[id])
    expect(missing,
      'a flipped definition has no row in REFS/COMPUTES, so the two cases below assert '
      + 'NOTHING about it. Add the refs its deleted block owned and the compute its '
      + 'indicatorData branch called — both are in the commit that deleted them.')
      .toEqual([])
    // …and non-vacuous: the set really has members, and really has more than the
    // four B3 pilots this table used to stop at.
    expect(ENGINE_FLIPPED_DEF_IDS.size).toBeGreaterThan(4)
    expect(Object.values(REFS).flat().length).toBeGreaterThan(10)
    // ⭐ AND THE COVERAGE IS NOW TOTAL IN BOTH DIRECTIONS: every DEFINITION has a
    // row, not merely every flipped one, so the tables cannot shrink behind a
    // set that has stopped growing.
    expect(Object.keys(REFS).sort()).toEqual(engineRegistry.listDefinitions().map(d => d.id).sort())
    expect(Object.keys(COMPUTES).sort()).toEqual(Object.keys(REFS).sort())
  })

  it('declares no series ref and creates no series for a flipped id', () => {
    const failures = []
    for (const id of ENGINE_FLIPPED_DEF_IDS) {
      for (const ref of (REFS[id] || [])) {
        if (declaresRef(CODE, ref)) failures.push(`${id}: ${ref} is declared again`)
        if (usesRef(CODE, ref)) failures.push(`${id}: ${ref}.current is read or written again`)
      }
    }
    expect(failures).toEqual([])
  })

  it('runs no second computation for a flipped id — the engine computes it once', () => {
    const failures = []
    for (const id of ENGINE_FLIPPED_DEF_IDS) {
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
    for (const id of ENGINE_FLIPPED_DEF_IDS) {
      if (CODE.includes(`engineOwned.has('${id}')`)) failures.push(`${id}: a Flip-A guard survived its Flip B`)
    }
    expect(failures).toEqual([])
  })

  // ⚠️ NOT ASSERTED HERE, ON PURPOSE: "a migrated-but-un-flipped definition still
  // has its guard". That category is EMPTY (`ENGINE_FLIPPED_DEF_IDS` equals
  // `ENGINE_MIGRATED_DEF_IDS`), so the loop would iterate zero times and pass
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
  //      `ENGINE_MIGRATED_DEF_IDS.add('stoch')` used to create the stranded
  //      category for real while every static rail read the source and saw
  //      nothing. `flipState.js` now seals the mutators; this probe is what
  //      fails if that seal is deleted.
  //
  // ⭐⭐ B5 TASK 9 RE-READS THE PREMISE, WHICH IS WHAT THE BRIEF ASKED FOR AND IS
  // NOT WHAT THE TITLE SUGGESTS. The record is RESOLVED (Task 4 moved it — the
  // biconditional above made that mandatory in the commit that deleted the flag,
  // not optional at Task 9), so *"while the settings migration is open"* is no
  // longer a live condition, and the two set-difference clauses are BOTH SATISFIED
  // BY TWO EMPTY SETS. That is the hole: a phase that emptied `ENGINE_MIGRATED_DEF_IDS`
  // and `ENGINE_FLIPPED_DEF_IDS` together would pass every clause here while every
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
      migratedNotFlipped: [...ENGINE_MIGRATED_DEF_IDS].filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id)),
      flippedNotMigrated: [...ENGINE_FLIPPED_DEF_IDS].filter(id => !ENGINE_MIGRATED_DEF_IDS.has(id)),
      // ⭐ B5 TASK 9: COMPLETENESS. The two clauses above are set DIFFERENCES and
      // two empty sets satisfy both. After the cutover the settings blob no longer
      // carries an indicator's enable flag, so a definition outside the flip set
      // has no legacy section to fall back on and no block to draw it — it renders
      // for nobody, silently, and the equality above would still be green.
      unmigratedDefinitions: engineRegistry.listDefinitions()
        .map(d => d.id).filter(id => !ENGINE_MIGRATED_DEF_IDS.has(id)),
      unflippedDefinitions: engineRegistry.listDefinitions()
        .map(d => d.id).filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id)),
      // …and the sets are not empty, which is what stops the three `[]`s above
      // being satisfied by a registry that lists nothing either.
      flipSetSize: ENGINE_FLIPPED_DEF_IDS.size,
      mutableSets: [
        takesAWrite('ENGINE_MIGRATED_DEF_IDS', ENGINE_MIGRATED_DEF_IDS),
        takesAWrite('ENGINE_FLIPPED_DEF_IDS', ENGINE_FLIPPED_DEF_IDS),
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
      flipSetSize: 14,
      mutableSets: [],
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
    const md = read('docs/decisions/2026-08-03-engine-enabled-settings-migration.md')
      .split('\n').map(l => l.replace(/^(?:\s*>)+\s?/, '')).join('\n')
      .replace(/\s+/g, ' ')
    const cited = [...md.matchAll(/`([A-Za-z]+\.test\.jsx?)`\s*→\s*\*"([^"]+)"\*/g)]
      .map(m => ({ file: m[1], title: m[2] }))

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
    const owned = rows.filter(r => ENGINE_MIGRATED_DEF_IDS.has(r.id) || ENGINE_MIGRATED_DEF_IDS.has(r.path?.key))
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

  it('paneMargins.js is still CONSUMED, not owned — no engine key was added to it', () => {
    const src = read('app/src/components/chart/paneMargins.js')
    for (const def of engineRegistry.listDefinitions()) {
      if (def.placement.target !== 'price') continue
      expect(src.includes(`key: '${def.id}'`),
        `${def.id} is a price overlay — a band for it would reserve space for nothing`).toBe(false)
    }
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
    expect(defs.length, 'no definitions — this case proves nothing').toBe(14)
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
    [...ENGINE_MIGRATED_DEF_IDS].map(id => [id, engineRegistry.getDefinition(id).inputs.map(i => i.key)]),
  )

  it('pins exactly which declared inputs the toolbar cannot reach', () => {
    const measured = {}
    for (const id of ENGINE_MIGRATED_DEF_IDS) {
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
    for (const id of ENGINE_MIGRATED_DEF_IDS) {
      const covered = toolbarInputs(id)
      const uncovered = engineRegistry.getDefinition(id).inputs.map(i => i.key).filter(k => !covered.has(k))
      expect(uncovered,
        `${id} has declared inputs no surface can reach and no row to reach them from`,
      ).toEqual(UNREACHABLE_FROM_THE_TOOLBAR[id])
    }
  })
})
