import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ENGINE_MIGRATED_DEF_IDS, ENGINE_FLIPPED_DEF_IDS } from '../flipState'
import { listIndicators, listEngineIndicators } from '../../indicatorRegistry'
import { CHART_DEFAULTS, mergeChartSettings } from '../../chartDefaults'
import * as engineRegistry from '../nativeRegistry'

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

/** Comments say things like "⛔ NO `rsiSeriesRef`", so a bare `includes` on an
 *  identifier finds the note that says it is gone. Every source probe below
 *  therefore matches a CODE SHAPE — `x.current`, `const x`, `f(` — never a bare
 *  name. Task 11 hit the same trap from the other side: six files carry comment
 *  references to constants it had just deleted. */
const usesRef = (src, ref) => new RegExp(`${ref}\\s*\\.\\s*current`).test(src)
const declaresRef = (src, ref) => new RegExp(`const\\s+${ref}\\b`).test(src)
const calls = (src, fn) => src.includes(`${fn}(`)

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
  { file: 'app/src/components/chart/chartDefaults.js', region: 'CHART_DEFAULTS.indicators — 15 keyed sections',
    anchor: 'rsi:  { enabled: false, period: 14', fate: 'B5' },
  { file: 'app/src/components/chart/chartDefaults.js', region: "mergeChartSettings' per-key allow-list — 15 lines",
    anchor: 'rsi:  { ...CHART_DEFAULTS.indicators.rsi,', fate: 'B5' },

  // ── StockChart's render lane ─────────────────────────────────────────────
  { file: 'app/src/components/StockChart.jsx', region: 'the series useRef declarations',
    anchor: 'const stochKRef     = useRef(null)', fate: 'B5' },
  { file: 'app/src/components/StockChart.jsx', region: 'the indicatorData memo — compute calls + shape mapping',
    anchor: 'const indicatorData = useMemo(', fate: 'B5' },
  { file: 'app/src/components/StockChart.jsx', region: 'the hand-written render blocks',
    anchor: 'if (indicatorData.williamsR.length) {', fate: 'B5' },
  // ⭐ RETIRED BY B4 TASK 10, TOGETHER — the nine crosshair value reads, the
  // hand-written `legChips` array and `readout.LEGACY_SLOTS` were one mechanism
  // and could only go as one. The legend renders `crosshairData.chips`, which
  // `processCrosshair` builds by handing BOTH lanes' entries to
  // `readout.chipsFrom`; six chips that no engine binding produces (stoch's two,
  // atr, sar, ichimoku's two) come from `legacyChipEntriesRef`, registered where
  // each hand-written series is created. Proven gone in `RETIRED_BY_B4_TASK10`.
  { file: 'app/src/components/StockChart.jsx', region: 'the hide-all ref array',
    anchor: 'const set = (ref) =>', fate: 'B5' },

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
  { file: 'app/src/pages/charts/ChartsWorkspace.jsx', region: 'UCT_DEFAULT_CHART_SETTINGS_JSON — a frozen capture of all 15 sections',
    anchor: 'const UCT_DEFAULT_CHART_SETTINGS_JSON', fate: 'B5' },
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
 *  moves with the CODE, and that includes a site nobody retired. */
const SITE_COUNT = 15

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
  it('every B4 region is retired — 8 to B5, 2 to C, 3 kept, 2 phase bookkeeping', () => {
    const counts = LEDGER.reduce((acc, s) => ({ ...acc, [s.fate]: (acc[s.fate] || 0) + 1 }), {})
    // ⚠️ `toEqual` on the WHOLE object, never five `toBe`s: a fate typo ('b5')
    // makes a SIXTH bucket, and five per-key assertions would all still pass
    // while the ledger silently held a site nobody's phase owns.
    //
    // ⛔ AND ITS ONE BLIND SPOT, STATED SO IT IS NOT OVER-TRUSTED: this is a
    // HISTOGRAM. Moving one site B4→B5 fails it (the total is unchanged and the
    // buckets are not) — but SWAPPING the fates of two sites preserves every
    // count and passes, demonstrated. Two sites then carry each other's phase and
    // nothing here says so; the per-site reasoning lives in the comments beside
    // each entry, and that is what a reviewer has to read. "The retirement column
    // adds up" means the column adds up, not that every row is in the right one.
    //
    // ⛔ AND THERE IS NO `B4: 0`. `reduce` emits no key for a fate with no
    // members, so writing one would never match. **B4's bucket is EMPTY** —
    // every region B4 inherited has been retired, and the ABSENCE of the key is
    // what says so. A `B4` row reappearing here fails this line by name.
    expect(counts).toEqual({ B5: 8, C: 2, keep: 3, phase: 2 })
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
    expect(SC).toContain('const registerLegacyChip = useCallback(')
    expect(SC).toContain('crosshairData.chips')
    expect(read('app/src/components/chart/engine/readout.js')).toContain('export function chipsFrom(')
    // ⛔ AND THE SIX CHIPS THAT WOULD OTHERWISE HAVE VANISHED ARE DECLARED. The
    // obvious B4 — render `engineChips()` directly — deletes `%K`, `%D`,
    // `ATR(14)`, `SAR`, `TK` and `KJ` for every user, because those four
    // definitions are NOT migrated and produce no bindings. This is the source
    // half of that claim; `legendFromDefinitions.test.jsx` is the behavioural one.
    const declared = engineRegistry.listDefinitions().flatMap(
      d => d.plots.filter(p => p.style !== 'hlines' && p.legend && p.legend.hide !== true)
        .map(p => `${d.id}::${p.key}`)).sort()
    expect(declared, 'a chip-bearing plot lost its `legend` declaration — six users\' chips ' +
      'disappear the moment one of the un-migrated four loses it').toEqual([
      'atr::atr', 'ichimoku::kijun', 'ichimoku::tenkan', 'macd::macd', 'macd::signal',
      'rsi::rsi', 'sar::sar', 'stoch::d', 'stoch::k',
    ])
    // …and B4 got there WITHOUT migrating any of them, which is the constraint
    // that made the whole design necessary.
    for (const id of ['stoch', 'atr', 'sar', 'ichimoku']) {
      expect(ENGINE_MIGRATED_DEF_IDS.has(id), `${id} was migrated — B4 ships ZERO migrations`).toBe(false)
    }
    // ⛔ AND THE PATTERNS STILL MATCH SOMETHING, so five zeroes above cannot be
    // five broken regexes.
    const PROBE = 'export const LEGACY_SLOTS = ({}) export function chipsBySlot(x) ' +
      'stochK: stochKValue, crosshairData.rsi crosshairData.macdSig != null && chip('
    for (const [, what, re] of RETIRED_BY_B4_TASK10) {
      expect([...PROBE.matchAll(re)].length, `${what}'s retirement pattern matches nothing at all`)
        .toBeGreaterThan(0)
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
  it('names every shipped module that hand-lists four or more indicators', () => {
    const IDS = Object.keys(CHART_DEFAULTS.indicators)
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
      const src = fs.readFileSync(p, 'utf8')
      const named = IDS.filter(id => (
        new RegExp(`['"]${id}['"]`).test(src) ||
        new RegExp(`(?<![A-Za-z0-9_$])${id}\\s*:`).test(src) ||
        new RegExp(`(?<![A-Za-z0-9_$])${id}\\?\\.`).test(src)
      ))
      if (named.length >= 4) found.push(path.relative(ROOT, p).split(path.sep).join('/'))
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
    expect(b5Walkable.length, 'no B5 walkable file on the ledger — the check below is vacuous')
      .toBeGreaterThanOrEqual(4)
    expect(b5Walkable.filter(f => !found.includes(f)),
      'the discovery scan cannot see a file the LEDGER fates to B5 — a site B4 cannot have ' +
      'retired. The scan is broken (walk root, regexes, or the `.test.` skip), not the tree.',
    ).toEqual([])
  })
})

describe('what B3 retired — a FLIPPED definition has no hand-written lane left', () => {
  const SRC = read('app/src/components/StockChart.jsx')

  /** defId → the series refs its legacy render block owned. */
  const REFS = {
    rsi: ['rsiSeriesRef'],
    bb: ['bbUpperRef', 'bbMiddleRef', 'bbLowerRef'],
    macd: ['macdLineRef', 'macdSignalRef', 'macdHistRef'],
    vwap: ['vwapSeriesRef'],
  }
  /** …and the compute its `indicatorData` branch called. */
  const COMPUTES = { rsi: 'computeRSI', bb: 'computeBB', macd: 'computeMACD', vwap: 'computeVWAP' }

  it('declares no series ref and creates no series for a flipped id', () => {
    const failures = []
    for (const id of ENGINE_FLIPPED_DEF_IDS) {
      for (const ref of (REFS[id] || [])) {
        if (declaresRef(SRC, ref)) failures.push(`${id}: ${ref} is declared again`)
        if (usesRef(SRC, ref)) failures.push(`${id}: ${ref}.current is read or written again`)
      }
    }
    expect(failures).toEqual([])
  })

  it('runs no second computation for a flipped id — the engine computes it once', () => {
    const failures = []
    for (const id of ENGINE_FLIPPED_DEF_IDS) {
      const fn = COMPUTES[id]
      if (fn && calls(SRC, fn)) failures.push(`${id}: StockChart calls ${fn}() again — a silent duplicate`)
    }
    expect(failures).toEqual([])
  })

  it('keeps no Flip-A guard for a flipped id — the block should be GONE, not guarded', () => {
    const failures = []
    for (const id of ENGINE_FLIPPED_DEF_IDS) {
      if (SRC.includes(`engineOwned.has('${id}')`)) failures.push(`${id}: a Flip-A guard survived its Flip B`)
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
  // ⚠️ WHAT IT IS, AND WHAT IT IS NOT. Three of its four clauses are ALSO caught
  // by `flipB.test.jsx` (both set directions) and `engineEnabledMigration.test.js`
  // (the Status line) — measured like-for-like, unfiltered, a migrate-without-flip
  // fails SIX assertions across three files and this is one of the six. It is kept
  // for its failure message, for sitting beside the ledger it constrains, and for
  // the FOURTH clause, which nothing else on this branch carries: the two sets
  // must refuse a runtime write. Record §10 says exactly this and no more.
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
  it('creates no migrated-but-un-flipped definition while the settings migration is open', () => {
    const record = read('docs/decisions/2026-08-03-engine-enabled-settings-migration.md')
    // The HEADER occurrence, not "somewhere in the file". `engineEnabledMigration.test.js`
    // takes the first such line; this additionally refuses a second one, because a
    // second one is how the first stops being the record's answer.
    const statusLines = record.split('\n').filter(l => l.startsWith('**Status:**'))

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
      stillOpen: statusLines.length === 1 && /\bOPEN\b/.test(statusLines[0]),
      migratedNotFlipped: [...ENGINE_MIGRATED_DEF_IDS].filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id)),
      flippedNotMigrated: [...ENGINE_FLIPPED_DEF_IDS].filter(id => !ENGINE_MIGRATED_DEF_IDS.has(id)),
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
    'this rail is reading a sentence instead of the decision. Do NOT weaken any of these to a ' +
    'subset check.',
    ).toEqual({
      statusLines: 1,
      stillOpen: true,
      migratedNotFlipped: [],
      flippedNotMigrated: [],
      mutableSets: [],
    })
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

  it('every definition has a settings section — nothing can be migrated from a blob it has no key in', () => {
    const keys = Object.keys(CHART_DEFAULTS.indicators)
    expect(engineRegistry.listDefinitions().map(d => d.id).filter(id => !keys.includes(id))).toEqual([])
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
