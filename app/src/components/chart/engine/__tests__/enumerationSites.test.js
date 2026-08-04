import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ENGINE_MIGRATED_DEF_IDS, ENGINE_FLIPPED_DEF_IDS } from '../flipState'
import { listIndicators, listEngineIndicators, ENGINE_ROW_DEF_IDS } from '../../indicatorRegistry'
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
  { file: 'app/src/components/StockChart.jsx', region: 'the crosshair value reads',
    anchor: 'stochK: stochKValue, stochD: stochDValue,', fate: 'B4' },
  { file: 'app/src/components/StockChart.jsx', region: 'the hide-all ref array',
    anchor: 'const set = (ref) =>', fate: 'B5' },
  // ⛔ legChips does NOT retire at Flip B. Task 10's correction, sharpened by
  // Task 11: it is the SLOT the engine's chip lands in — `(e && e.text) || text`
  // — and it is the thing that FORMATS it. It goes with `readout.LEGACY_SLOTS`.
  { file: 'app/src/components/StockChart.jsx', region: 'the legChips legend list',
    anchor: 'const legChips = [', fate: 'B4' },

  // ── StockChart's control doors ───────────────────────────────────────────
  { file: 'app/src/components/StockChart.jsx', region: 'IND_OPTS — right-click Indicators ▸, 8 names',
    anchor: 'const IND_OPTS = [', fate: 'B4' },
  { file: 'app/src/components/StockChart.jsx', region: 'OSC_OPTS — right-click Overlay on volume ▸, 9 names',
    anchor: 'const OSC_OPTS = [', fate: 'B4' },
  { file: 'app/src/components/StockChart.jsx', region: 'the right-click Hide <label> item',
    anchor: "id: 'i-hide'", fate: 'B4' },
  { file: 'app/src/components/StockChart.jsx', region: 'handleCopyShareUrl — the share link',
    anchor: 'const handleCopyShareUrl = useCallback(', fate: 'B4' },
  // ⭐ THE LEDGER'S #13 WAS UNDER-ENUMERATED THREE WAYS. It named "Ctrl+I /
  // Ctrl+O" — two shortcuts, one file. There are FOUR indicator shortcuts
  // (Ctrl+I rsi, Ctrl+O macd, Ctrl+B bb, Alt+U vwap) across FOUR regions in TWO
  // files, and the two regions below are the ones that actually WRITE.
  { file: 'app/src/components/StockChart.jsx', region: "the toggle: switch — where Ctrl+I/O/B are consumed",
    anchor: 'switch (target) {', fate: 'B4' },
  { file: 'app/src/components/StockChart.jsx', region: 'the Alt-key block — Alt+U, the fifth control door',
    anchor: 'if (e.altKey && !e.ctrlKey && !e.metaKey) {', fate: 'B4' },

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
  { file: 'app/src/components/chart/chartRegion.js', region: 'INDICATOR_LABELS — 9',
    anchor: 'export const INDICATOR_LABELS = {', fate: 'B4' },
  { file: 'app/src/components/chart/ChartToolbar.jsx', region: 'OSC — a SECOND copy of OSC_OPTS, in another file',
    anchor: "const OSC = [['rsi', 'RSI']", fate: 'B4' },
  { file: 'app/src/components/chart/ChartToolbar.jsx', region: 'the 15 hand-written indicator rows',
    anchor: '{/* Technical Indicators */}', fate: 'B4' },

  // ── the settings tab ─────────────────────────────────────────────────────
  // ⭐ WHAT THIS TASK LEFT. `listIndicators()` no longer names an indicator at
  // all; the one remaining list is which migrated definitions still need a row
  // because the toolbar cannot express their inputs. The rail that retires it is
  // at the bottom of this file.
  { file: 'app/src/components/chart/indicatorRegistry.js', region: 'ENGINE_ROW_DEF_IDS — the rows the toolbar cannot cover',
    anchor: 'export const ENGINE_ROW_DEF_IDS', fate: 'B4' },

  // ── the keyboard ─────────────────────────────────────────────────────────
  { file: 'app/src/components/chart/keyboardShortcuts.js', region: 'the SHORTCUTS table — the help sheet',
    anchor: "command: 'toggle:rsi'", fate: 'B4' },
  { file: 'app/src/components/chart/keyboardShortcuts.js', region: "matchShortcut's Ctrl branch",
    anchor: "if (k === 'i') return 'toggle:rsi'", fate: 'B4' },

  // ── alerts ───────────────────────────────────────────────────────────────
  { file: 'app/src/components/chart/IndicatorAlertPopover.jsx', region: 'INDICATORS — the alert dropdown, 8',
    anchor: 'const INDICATORS = [', fate: 'B4' },
  { file: 'app/src/components/chart/IndicatorAlertPopover.jsx', region: 'CONDITIONS — per-indicator condition lists',
    anchor: 'const CONDITIONS = {', fate: 'B4' },
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

  // ── the engine ───────────────────────────────────────────────────────────
  { file: 'app/src/components/chart/engine/nativeRegistry.js', region: 'RAW_DEFS — THE ONE THAT SHOULD SURVIVE',
    anchor: 'const RAW_DEFS = [', fate: 'keep' },
  // ⭐ NOT ON ANY PREVIOUS LEDGER. `legChips`' twin: the bridge that lands an
  // engine chip in the same legend POSITION as the chip it replaces. It is
  // deleted with `legChips` at B4 and nowhere else.
  { file: 'app/src/components/chart/engine/readout.js', region: 'LEGACY_SLOTS — the legend slot bridge, 9',
    anchor: 'export const LEGACY_SLOTS = Object.freeze({', fate: 'B4' },
  { file: 'app/src/components/chart/engine/flipState.js', region: 'ENGINE_MIGRATED_DEF_IDS',
    anchor: 'export const ENGINE_MIGRATED_DEF_IDS', fate: 'phase' },
  { file: 'app/src/components/chart/engine/flipState.js', region: 'ENGINE_FLIPPED_DEF_IDS',
    anchor: 'export const ENGINE_FLIPPED_DEF_IDS', fate: 'phase' },

  // ── everything else that hand-lists indicators ───────────────────────────
  { file: 'app/src/utils/chartBus.js', region: "ALLOWED_INDICATORS — the voice add_indicator allow-list",
    anchor: 'const ALLOWED_INDICATORS = new Set([', fate: 'B4' },
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

/** The number the ledger holds down. Change it ONLY by walking the code. */
const SITE_COUNT = 31

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
  // DECREMENTS `B4` here; the total stays 31 until a site is deleted outright.
  it('the retirement column adds up — 18 to B4, 8 to B5, 1 to C, 2 kept, 2 phase bookkeeping', () => {
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
    expect(counts).toEqual({ B4: 18, B5: 8, C: 1, keep: 2, phase: 2 })
  })

  it('the two sites this task retired are GONE, not merely unlisted', () => {
    for (const r of RETIRED_BY_THIS_TASK) {
      expect(read(r.file).includes(r.gone), `${r.file}: ${r.region} came back`).toBe(false)
    }
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
    // …and the scan itself must not go quietly empty: it found eleven when this
    // was written, and a scan that finds none is a broken scan, not a clean tree.
    expect(found.length).toBeGreaterThanOrEqual(11)
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

    // …and the row really is built from the definition: every declared input,
    // in declaration order, no more and no fewer.
    for (const id of ENGINE_ROW_DEF_IDS) {
      const def = engineRegistry.getDefinition(id)
      const row = listEngineIndicators(mergeChartSettings(null), engineRegistry).find(r => r.id === id)
      expect(row, `${id} has no generated row`).toBeTruthy()
      expect(row.fields.map(f => f.key), id).toEqual(def.inputs.map(i => i.key))
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

  // ⭐ MEASURED AT `9f787749`. Every declared input of a migrated definition that
  // NO control surface can reach except the settings tab's generated row. This is
  // the list B4's generated dialog has to cover, and it is the reason
  // `ENGINE_ROW_DEF_IDS` is not empty.
  const UNREACHABLE_FROM_THE_TOOLBAR = {
    rsi: [],
    bb: [],
    // 🔴 MACD's two colours have NO control ANYWHERE today — not in the toolbar,
    // not in the settings tab. A pre-existing gap, not one this migration made,
    // and it is B4's to close.
    macd: ['macdColor', 'signalColor'],
    // …and these three are why VWAP keeps a row.
    vwap: ['opacity', 'lineStyle', 'lineWidth'],
  }

  it('pins exactly which declared inputs the toolbar cannot reach', () => {
    const measured = {}
    for (const id of ENGINE_MIGRATED_DEF_IDS) {
      const covered = toolbarInputs(id)
      measured[id] = engineRegistry.getDefinition(id).inputs.map(i => i.key).filter(k => !covered.has(k))
    }
    expect(measured,
      'the toolbar gained or lost a control for a migrated indicator. If it GAINED one, check ' +
      'whether the settings tab still needs its generated row.',
    ).toEqual(UNREACHABLE_FROM_THE_TOOLBAR)
  })

  // ⛔ THE RAIL THAT FAILS WHEN B4 LANDS. `ENGINE_ROW_DEF_IDS` exists only
  // because a control lives on that surface ALONE. The day B4's generated dialog
  // covers VWAP's opacity / line style / line width, this goes RED and whoever is
  // holding it is told to delete the row — instead of the row surviving as a
  // duplicate of the surface that now covers it. A comment saying "remove at B4"
  // is precisely how this file grew the problem it is retiring.
  it('every id that keeps a generated row still has a control that exists NOWHERE ELSE', () => {
    for (const id of ENGINE_ROW_DEF_IDS) {
      const covered = toolbarInputs(id)
      const only = engineRegistry.getDefinition(id).inputs.map(i => i.key).filter(k => !covered.has(k))
      expect(only.length,
        `${id}'s generated settings row no longer carries anything the toolbar cannot: B4 has ` +
        'landed for this definition. DELETE the row from ENGINE_ROW_DEF_IDS.',
      ).toBeGreaterThan(0)
    }
  })

  it('and nothing was silently dropped: a migrated id with NO row has full toolbar coverage, or is named above', () => {
    for (const id of ENGINE_MIGRATED_DEF_IDS) {
      if (ENGINE_ROW_DEF_IDS.includes(id)) continue
      const covered = toolbarInputs(id)
      const uncovered = engineRegistry.getDefinition(id).inputs.map(i => i.key).filter(k => !covered.has(k))
      expect(uncovered,
        `${id} has declared inputs no surface can reach and no row to reach them from`,
      ).toEqual(UNREACHABLE_FROM_THE_TOOLBAR[id])
    }
  })
})
