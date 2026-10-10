// app/src/lib/presentation/dataGrid/dataGridSeed.rail.test.js
//
// ─── TERM-065 — THE RAIL: A NEW SORTABLE GRID USES THE DATAGRID SEED ─────────
//
//     cd app && npx vitest run src/lib/presentation/dataGrid/dataGridSeed.rail.test.js
//
// FB-S10-01's own "known it worked": *"a rail counts grid implementations in
// `app/src` and fails on a sixth."* Measured on this tree the day it was written,
// there were never five — EIGHTEEN modules hand-rolled a column sort. So the rail
// is a RATCHET over names, the same shape as `panelContract.rail.test.js`:
//   • a hand-rolled grid NOT in `BASELINE` fails BY NAME, with the line and the
//     signal (the thing being prevented: grid number nineteen);
//   • a `BASELINE` entry that no longer hand-rolls fails ("drop it") — so the
//     list can only shrink, and a migration has to say so here;
//   • a `BASELINE` entry whose file is gone fails;
//   • every `MIGRATED` grid must import the seed and hand-roll nothing.
// The baseline stores NAMES with a reason each, never a count; every number
// this file prints is derived.
//
// ── WHAT COUNTS AS "HAND-ROLLING A SORTABLE GRID" ───────────────────────────
//
// ⛔ AN AST, NEVER A GREP — comments are not code, and this repo's comments talk
// about sorting constantly (CalendarDayTable's header even explains why it does
// NOT use `aria-sort`). Four signals, each a thing a grid does when it owns its
// own sort rather than asking the seed for it:
//
//   FLIP   a sort-direction toggle: `d === 'asc' ? 'desc' : 'asc'` (or `!==`,
//          or the ascending/descending spellings). A CLAMP such as
//          `d === 'asc' ? 'asc' : 'desc'` is normalisation, not a toggle, and
//          an aria mapping `d === 'asc' ? 'ascending' : 'descending'` is a
//          clamp too — neither counts.
//   NEGATE a numeric direction flip: `-s.dir`, `-dir`, `-sortDir`.
//   STATE  a direction state pair: `const [sortDir, setSortDir] = …`.
//   ARIA   an `aria-sort` attribute in a module that does NOT import the seed.
//          (A migrated grid still renders the attribute; it just asks the seed
//          what the value is.)
//
// The direction words are ASSEMBLED below, never written whole in a pattern,
// so this file's own text can never be read as a match; and the controls prove
// the detector can see each signal and cannot see one inside a comment.
//
// ── WHAT IT DOES NOT CATCH, STATED ──────────────────────────────────────────
//
// A grid whose direction is a boolean (`asc: !asc`), or one that sorts by a
// select box rather than a header, is not a column-sort and is not counted
// (`ScanResults`' `sortByValue`, `Floor2`'s `'hot'`, `NotebookTab`'s mode).
// The unit is the MODULE: `DarkPool.jsx` holds three grids and counts once.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`dataGridSeed.rail: could not find the repo root from ${process.cwd()}`)
})()

const SRC = path.join(ROOT, 'app', 'src')
/** The seed's own directory — its modules ARE the sort machinery, so they are the one place it may live. */
const SEED_DIR = 'app/src/lib/presentation/dataGrid/'

const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const key = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

const parse = (src) => Parser.extend(jsx()).parse(src, {
  ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, locations: true,
})

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}

function* sourceFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      yield* sourceFiles(p)
    } else if (/\.jsx?$/.test(e.name) && !/\.(test|spec)\.jsx?$/.test(e.name)) {
      yield p
    }
  }
}

function treeSources() {
  const out = new Map()
  for (const f of sourceFiles(SRC)) out.set(key(f), read(f))
  return out
}

// ⛔ ASSEMBLED, never written whole.
const ASC = ['as', 'c'].join('')
const DESC = ['de', 'sc'].join('')
const DIR_WORDS = new Set([ASC, DESC, `${ASC}ending`, `${DESC}ending`])
const ARIA_SORT = ['aria', 'sort'].join('-')
const STATE_NAME = new RegExp(`^sort${'Dir'}(ection)?$`)
const DIR_REF = /^(dir|sortDir|sortDirection|direction)$/i

const isDirWord = (n) => n?.type === 'Literal' && DIR_WORDS.has(n.value)
const norm = (v) => (v.startsWith(ASC) ? ASC : DESC)

function isFlip(n) {
  const t = n.test
  if (t?.type !== 'BinaryExpression' || !/^[!=]==?$/.test(t.operator)) return false
  const lit = isDirWord(t.left) ? t.left : isDirWord(t.right) ? t.right : null
  if (!lit || !isDirWord(n.consequent) || !isDirWord(n.alternate)) return false
  const c = norm(n.consequent.value)
  const a = norm(n.alternate.value)
  const l = norm(lit.value)
  if (c === a) return false
  // `x === 'asc' ? 'desc' : …` flips; `x !== 'asc' ? 'asc' : …` flips.
  return t.operator.startsWith('=') ? c !== l : c === l
}

const isDirRef = (n) =>
  (n?.type === 'MemberExpression' && !n.computed && DIR_REF.test(n.property?.name ?? ''))
  || (n?.type === 'Identifier' && DIR_REF.test(n.name))

/** Does a relative import specifier from `fromKey` land inside the seed? */
function importsSeed(fromKey, spec) {
  if (!spec.startsWith('.')) return false
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromKey), spec))
  return `${target}/`.startsWith(SEED_DIR) || target.startsWith(SEED_DIR)
}

/**
 * Every hand-rolled-sort signal in one module, as `{line, signal}`.
 * Exported so the controls below can run it on a planted source.
 */
export function gridSignals(fileKey, source) {
  const tree = parse(source)
  let usesSeed = false
  const out = []
  walk(tree, (n) => {
    if (n.type === 'ImportDeclaration' && importsSeed(fileKey, n.source.value)) usesSeed = true
  })
  walk(tree, (n) => {
    if (n.type === 'ConditionalExpression' && isFlip(n)) out.push({ line: n.loc.start.line, signal: 'FLIP' })
    if (n.type === 'UnaryExpression' && n.operator === '-' && isDirRef(n.argument)) {
      out.push({ line: n.loc.start.line, signal: 'NEGATE' })
    }
    if (n.type === 'ArrayPattern') {
      for (const el of n.elements) {
        if (el?.type === 'Identifier' && STATE_NAME.test(el.name)) out.push({ line: n.loc.start.line, signal: 'STATE' })
      }
    }
    if (!usesSeed && n.type === 'JSXAttribute' && n.name?.name === ARIA_SORT) {
      out.push({ line: n.loc.start.line, signal: 'ARIA' })
    }
  })
  return { usesSeed, signals: out }
}

/** The census: every module outside the seed that hand-rolls a column sort. */
export function handRolledGrids(tree = treeSources()) {
  const out = new Map()
  for (const [k, src] of tree) {
    if (k.startsWith(SEED_DIR)) continue
    const { signals } = gridSignals(k, src)
    if (signals.length) out.set(k, signals)
  }
  return out
}

// ── THE BASELINE — names, each with why it is still here ────────────────────
//
// ⛔ It may only SHRINK. Migrating a grid onto the seed removes its line here in
// the same commit (the "drop it" test below enforces that); adding a line to
// admit a new grid is exactly what this rail exists to refuse.
//   2026-10-10 (lane f-l7): 9 -> 3. CalendarDayTable, Shelf, HoldingsList,
//   LiveFlowMassive, ThemeTrackerPage and Watchlists moved onto the seed (MIGRATED
//   below; parity in pageGrids2.seedParity.test.js). What remains is partner-owned.
//   2026-10-10 (lane P2, owner ruling "proceed fully"): 3 -> 1. DarkPool's three panels
//   and OptionsFlow's four header toggles now call pages/optionsFlow/flowGridSort.js
//   (one line per site, the rebase-safe hook), which asks the seed's nextSort; their
//   comparators are untouched. Parity, every hand-rolled toggle copied verbatim:
//   pages/optionsFlow/flowGridSort.seedParity.test.js.
export const BASELINE = new Map([
  ['app/src/pages/OptionsFlow_admin.jsx', 'a hook cannot carry it: the file is a self-contained Claude-artifact copy of OptionsFlow that imports only react and recharts BY DESIGN (its own header says the artifact cannot import local files; it stubs TickerPopup and StockChart for that reason), and it has zero importers in app/src (reachable.test.js allowlist). An import of flowGridSort or the seed would break the one way it is used. Leaves when the partner retires the artifact copy or migrates it onto the real modules.'],
])

/** Grids already moved onto the seed. They must import it and hand-roll nothing. */
export const MIGRATED = [
  'app/src/pages/journal-2-0/components/TradesTable.jsx',
  'app/src/pages/journal-2-0/components/PositionsTable.jsx',
  // 2026-09-30, FB-S10-01's named first consumer; parity in screenerGrid.seedParity.test.jsx
  'app/src/pages/screener/shell/VirtualResults.jsx',
  'app/src/pages/screener/shell/liveSort.js',
  // 2026-10-03, header decisions (nextSort / ariaSortFor / sortCaretFor) onto the
  // seed, comparators kept; parity in pageGrids.seedParity.test.js
  'app/src/components/tiles/CatalystTable.jsx',
  'app/src/pages/charts/widgets/CalendarWidget.jsx',
  'app/src/pages/LiveFlow.jsx',
  'app/src/pages/ModelBook.jsx',
  'app/src/pages/UCT20.jsx',
  // 2026-10-10 (lane f-l7), header decisions onto the seed, comparators kept (the
  // Shelf's Newest/Oldest order runs on sortRows); parity in pageGrids2.seedParity.test.js
  'app/src/pages/calendar/CalendarDayTable.jsx',
  'app/src/pages/desk/Shelf.jsx',
  'app/src/pages/journal-2-0/components/HoldingsList.jsx',
  'app/src/pages/LiveFlowMassive.jsx',
  'app/src/pages/ThemeTrackerPage.jsx',
  'app/src/pages/Watchlists.jsx',
  // 2026-10-10 (lane P2): the shared header decisions for DarkPool + OptionsFlow; parity in
  // pages/optionsFlow/flowGridSort.seedParity.test.js
  'app/src/pages/optionsFlow/flowGridSort.js',
]

const fmt = (sigs) => sigs.map((s) => `${s.signal}@${s.line}`).join(', ')

describe('TERM-065 — a new sortable grid uses the DataGrid seed', () => {
  const tree = treeSources()
  const census = handRolledGrids(tree)

  it('the walk saw the tree (control: hundreds of modules, and the seed among them)', () => {
    expect(tree.size).toBeGreaterThan(500)
    expect([...tree.keys()].some((k) => k.startsWith(SEED_DIR))).toBe(true)
  })

  it('no hand-rolled grid outside the baseline — each one named', () => {
    const unlisted = [...census].filter(([k]) => !BASELINE.has(k))
      .map(([k, sigs]) => `${k} (${fmt(sigs)}) — build it on lib/presentation/dataGrid instead`)
    expect(unlisted).toEqual([])
  })

  it('every baseline entry still hand-rolls a sort (a migrated one must be dropped)', () => {
    const stale = [...BASELINE.keys()].filter((k) => tree.has(k) && !census.has(k))
      .map((k) => `${k} no longer hand-rolls a sort — drop it from BASELINE`)
    expect(stale).toEqual([])
  })

  it('every baseline entry still exists', () => {
    const gone = [...BASELINE.keys()].filter((k) => !tree.has(k)).map((k) => `${k} is deleted — drop it from BASELINE`)
    expect(gone).toEqual([])
  })

  it('every migrated grid imports the seed and hand-rolls nothing', () => {
    for (const k of MIGRATED) {
      expect(tree.has(k), `${k} exists`).toBe(true)
      const { usesSeed, signals } = gridSignals(k, tree.get(k))
      expect({ k, usesSeed, signals: fmt(signals) }).toEqual({ k, usesSeed: true, signals: '' })
      expect(BASELINE.has(k), `${k} is migrated, so it is not in BASELINE`).toBe(false)
    }
  })

  it('prints the census (derived)', () => {
    // Not an assertion about a number — a record of one, for the reader.
    const lines = [...census].map(([k, sigs]) => `${k}: ${fmt(sigs)}`)
    expect(lines.length).toBe(census.size)
    // eslint-disable-next-line no-console
    console.info(`[TERM-065] hand-rolled grids: ${census.size}; migrated onto the seed: ${MIGRATED.length}\n  ${lines.join('\n  ')}`)
  })
})

// ── CONTROLS — the detector can see each signal, and cannot see a comment ────

describe('the detector (controls)', () => {
  const at = 'app/src/pages/fixture/Planted.jsx'
  const q = (w) => `'${w}'`

  it('sees a FLIP, a NEGATE, a STATE and an ARIA', () => {
    const src = [
      "import { useState } from 'react'",
      'export default function G() {',
      `  const [${'sort'}Dir, setSortDir] = useState(${q(DESC)})`,
      `  const flip = (d) => (d === ${q(ASC)} ? ${q(DESC)} : ${q(ASC)})`,
      '  const s = { dir: 1 }',
      '  const n = -s.dir',
      `  return <table><thead><tr><th ${ARIA_SORT}="none">x</th></tr></thead></table>`,
      '}',
    ].join('\n')
    const sigs = gridSignals(at, src).signals.map((s) => s.signal).sort()
    expect(sigs).toEqual(['ARIA', 'FLIP', 'NEGATE', 'STATE'])
  })

  it('does NOT see the same words inside comments', () => {
    const src = [
      'export default function G() {',
      `  // d === ${q(ASC)} ? ${q(DESC)} : ${q(ASC)}  and  -s.dir`,
      `  /* const [sortDir, setSortDir] = useState() */`,
      `  return <table>{/* <th ${ARIA_SORT}="none"> */}</table>`,
      '}',
    ].join('\n')
    expect(gridSignals(at, src).signals).toEqual([])
  })

  it('does NOT count a clamp or an aria mapping as a flip', () => {
    const src = [
      `export const clamp = (d) => (d === ${q(ASC)} ? ${q(ASC)} : ${q(DESC)})`,
      `export const aria = (d) => (d === ${q(ASC)} ? ${q(ASC + 'ending')} : ${q(DESC + 'ending')})`,
    ].join('\n')
    expect(gridSignals(at, src).signals).toEqual([])
  })

  it('an aria-sort attribute is allowed once the module imports the seed — and only then', () => {
    const body = `export default () => <th ${ARIA_SORT}={x}>x</th>`
    const withSeed = `import { useGridSort } from '../lib/presentation/dataGrid'\n${body}`
    const withOther = `import x from '../../lib/presentation/presentationPrimitives'\n${body}`
    expect(gridSignals('app/src/pages/Planted.jsx', withSeed)).toEqual({ usesSeed: true, signals: [] })
    expect(gridSignals('app/src/pages/Planted.jsx', withOther).signals.map((s) => s.signal)).toEqual(['ARIA'])
  })

  it('importing the seed does NOT excuse a hand-rolled toggle', () => {
    const src = `import { useGridSort } from '../lib/presentation/dataGrid'\n`
      + `export const t = (d) => (d === ${q(DESC)} ? ${q(ASC)} : ${q(DESC)})`
    expect(gridSignals('app/src/pages/Planted.jsx', src).signals.map((s) => s.signal)).toEqual(['FLIP'])
  })

  it('a planted new grid fails the census BY NAME', () => {
    const tree = treeSources()
    const planted = 'app/src/pages/PlantedNewGrid.jsx'
    tree.set(planted, `export const t = (d) => (d === ${q(ASC)} ? ${q(DESC)} : ${q(ASC)})`)
    const unlisted = [...handRolledGrids(tree).keys()].filter((k) => !BASELINE.has(k))
    expect(unlisted).toContain(planted)
  })
})
