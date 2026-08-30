// app/src/pages/screener/ScreensManager.door.test.jsx
//
// ─── THE AUTHORING DOOR, ASSERTED AT THE PROP BOUNDARY (W4a.5) ──────────────
//
// "New scan" opens the ONE `BuilderSheet` on the Conditions picker; "Edit"
// opens the SAME sheet on the row and does NOT force a mode. Both are measured
// through a mocked sheet, because what this file owns is the DECISION the
// manager makes, not the sheet's behaviour once it has it.
//
// ⛔ THE REAL SHEET + THE REAL SAVE ARE `Screener.door.test.jsx`'s job — a
// mocked sheet here would stay green through a lazy chunk that never resolves,
// which is precisely the "built, tested, green and unreachable" defect the
// page-level wire-cut exists for.
import fs from 'node:fs'
import path from 'node:path'
import { SWRConfig } from 'swr'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const create = vi.fn(); const update = vi.fn(); const remove = vi.fn()
vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({ saved: [], starters: [], error: null, create, update, remove }),
}))

const META = vi.hoisted(() => ({ meta: { filters: [] }, isLoading: false }))
vi.mock('./hooks/useScreenerMeta', () => ({
  default: () => META, META_KEY: '/api/screener/meta',
}))

// ⛔ `scannable` is stamped by the LIST route per row
// (`routers/user_definitions.py::_stamped`) and `scannableScreens` reads it
// rather than deciding for itself — see X88. A fixture without it is a
// response no server sends.
const ROW = Object.freeze({
  def_id: 'u_breakout', version: 2, rev: 1, ast_hash: 'sha256:aaa',
  scannable: true, scan_refusal: null,
  definition: {
    compute: { kind: 'ast', fn: 'sha256:aaa', ast: { type: 'op' }, source: 'close > open' },
    meta: { name: 'Breakout base' },
  },
})
const refresh = vi.fn()
const defsState = { rows: [ROW], error: null, isLoading: false, refresh }
// `deleteUserDefinition` is stubbed rather than omitted even though no case
// here clicks Delete: a mock that is missing an export the component imports is
// a mock that disagrees with the module, and the day one of these cases does
// reach the delete door it would fail for the mock's reason, not the product's.
const deleteDefinition = vi.fn(async () => ({ ok: true }))
vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => defsState,
  deleteUserDefinition: (...a) => deleteDefinition(...a),
}))

// The sheet is mocked so the PROPS are the assertion. It renders a marker, not
// a dialog — a dialog here would be this file inventing the very thing the
// page-level wire-cut exists to prove actually arrives.
const SheetSpy = vi.fn()
vi.mock('../../components/chart/builder/BuilderSheet', () => ({
  default: (props) => { SheetSpy(props); return <div data-testid="builder-sheet-mock" /> },
}))
vi.mock('../../components/screener/ScanResults', () => ({
  default: (props) => <div data-testid="scan-results-mock" data-payload={props.payload ? 'given' : 'none'} />,
}))

import { DEFAULT_BUDGET } from '../../components/chart/engine/ast/budget'
import ScreensManager, { SPY_WINDOW, SPY_WINDOW_BARS, NEW_SCAN_MODE } from './ScreensManager'

beforeEach(() => {
  SheetSpy.mockClear(); refresh.mockClear()
  defsState.rows = [ROW]; defsState.error = null
})
afterEach(() => { vi.unstubAllGlobals() })

const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ScreensManager currentSpec={{}} onApply={vi.fn()} onUseScan={vi.fn()} />
  </SWRConfig>,
)
const openMenu = () => fireEvent.click(screen.getByText('Screens ▾'))
/** The props of the LAST render of the mocked sheet. */
const sheetProps = () => SheetSpy.mock.calls.at(-1)[0]

describe('the authoring door', () => {
  it('"New scan" mounts the builder on the Conditions picker with nothing to edit', async () => {
    mount(); openMenu()
    expect(screen.queryByTestId('builder-sheet-mock')).toBeNull()      // control: closed until asked
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }))
    // ⛔ AN EXPLICIT TIMEOUT, AND IT IS MEASURED RATHER THAN GUESSED. This is
    // the FIRST mount in the file, so it pays module init plus the first jsdom
    // render: 451ms on an idle machine, against testing-library's 1000ms
    // default. Every later test in this file runs in 11-62ms because the
    // modules are warm. 2.2x headroom is too thin for a cold first mount, and
    // it is why this one test — never any of its siblings — went red twice
    // under concurrent CPU load and passed on five consecutive idle runs.
    // Raising it does not paper over a hang: a genuinely broken door still
    // fails, it just fails after 5s instead of 1s.
    expect(await screen.findByTestId('builder-sheet-mock', {}, { timeout: 5000 }))
      .toBeInTheDocument()
    const props = sheetProps()
    expect(props.open).toBe(true)
    expect(props.initialMode).toBe(NEW_SCAN_MODE)
    expect(props.editRow).toBeNull()
    expect(typeof props.onSaved).toBe('function')
    expect(typeof props.onClose).toBe('function')
  })

  it('⭐ the door opens on CONDITIONS because what it authors is a SCREEN', () => {
    // Spelled as its own case so the mode is not merely "whatever the manager
    // happens to pass". A door onto the Library would put the firm's starters
    // above a member who came here to build a screen. `NEW_SCAN_MODE` is the one
    // place that choice is made; the derived rail below proves the sheet knows it.
    expect(NEW_SCAN_MODE).toBe('picker')
  })

  it('closing the sheet leaves nothing mounted', async () => {
    mount(); openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }))
    await screen.findByTestId('builder-sheet-mock')
    sheetProps().onClose()
    await waitFor(() => expect(screen.queryByTestId('builder-sheet-mock')).toBeNull())
  })

  it('onSaved closes the sheet and opens the NEW scan\'s detail', async () => {
    mount(); openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }))
    await screen.findByTestId('builder-sheet-mock')
    sheetProps().onSaved({ def_id: 'u_breakout', version: 3, rev: 1 })
    await waitFor(() => expect(screen.queryByTestId('builder-sheet-mock')).toBeNull())
    expect(await screen.findByTestId('scan-detail-u_breakout')).toBeInTheDocument()
    // The store is the authority on what exists; the manager only decides what
    // is on screen next.
    expect(refresh).toHaveBeenCalled()
  })

  it('a save that names no row still closes the sheet and opens nothing', async () => {
    mount(); openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }))
    await screen.findByTestId('builder-sheet-mock')
    sheetProps().onSaved(null)
    await waitFor(() => expect(screen.queryByTestId('builder-sheet-mock')).toBeNull())
    expect(screen.queryByTestId('scan-detail-u_breakout')).toBeNull()
  })

  it('Edit opens the SAME builder on the row, and the picker is not forced', async () => {
    mount(); openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Breakout base' }))
    await screen.findByTestId('builder-sheet-mock')
    const props = sheetProps()
    expect(props.editRow).toEqual(ROW)
    // ⛔ NOT `NEW_SCAN_MODE`. An edit opens on the FORMULA — the sheet's own
    // `openForEdit` rule — and a mode forced from here would override it.
    expect(props.initialMode).toBeNull()
  })

  it('the menu closes when the sheet opens — the sheet portals outside the menu\'s outside-click wrap', async () => {
    mount(); openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

describe('the concierge gets a bars window — the screener has no chart to take one from', () => {
  it('fetches SPY_WINDOW only once the sheet is open, and hands the bars down', async () => {
    const bars = [{ t: '2026-08-21', o: 1, h: 2, l: 0, c: 1, v: 10 }]
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url))
      return { ok: true, status: 200, json: async () => ({ ticker: 'SPY', tf: 'D', bars }) }
    }))
    mount(); openMenu()
    // control: a closed sheet asks for nothing
    expect(calls.filter((u) => u === SPY_WINDOW)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }))
    await screen.findByTestId('builder-sheet-mock')
    await waitFor(() => expect(calls.filter((u) => u === SPY_WINDOW).length).toBeGreaterThan(0))
    await waitFor(() => expect(sheetProps().bars).toEqual(bars))
  })

  // ⚰️ THIS CASE ONCE CARRIED A FALSE REASON (review round 1): that `[]` would
  // reach the concierge as "computed and found nothing". It cannot —
  // `ConciergeBox` sends `bars || []` and the server gates on `if bars`, so `[]`
  // and `None` are the same thing there. What it really proves is this module's
  // own contract: a failed read hands down NOTHING (falsy), so no fabricated
  // empty window is put in front of the sheet or into SWR's cache — and the door
  // still opens, which is the part a member would notice.
  it('a refused bars read hands down no window at all, and the door still opens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    mount(); openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }))
    expect(await screen.findByTestId('builder-sheet-mock')).toBeInTheDocument()
    // ⛔ `toBeFalsy()` IS THE WHOLE ASSERTION, AND IT IS THE ONE THAT FIRES.
    // An empty array is TRUTHY, so a fetcher that fabricated `[]` fails HERE —
    // measured: mutating `barsFetcher` to return `[]` fails at this line, and a
    // follow-on `Array.isArray(...) === false` stood here for one round crediting
    // itself with the catch. It was unreachable: no array can get past `toBeFalsy`
    // in the first place, so the clause could never run and never fail. Deleted
    // rather than demoted — a comment that credits the wrong line is how the next
    // engineer deletes the one that matters.
    await waitFor(() => expect(sheetProps().bars).toBeFalsy())
  })
})

// ─── ⭐ THE DERIVED RAIL: the mode this file hands over is one the sheet KNOWS ─
//
// ⛔ A TYPED LIST OF MODES IS THE DEFECT, NOT THE RAIL. The brief this task was
// written from spelled the sheet's modes as `library | picker | formula`; the
// sheet has had a FOURTH (`pine`) since Phase F. A guard built on that list
// would have silently ignored a mode the sheet does know, and nothing would
// have failed. So the set is read out of `BuilderSheet.jsx` itself.
describe('⭐ `initialMode` names a mode BuilderSheet actually has', () => {
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
      const up = path.dirname(dir); if (up === dir) break; dir = up
    }
    throw new Error(`ScreensManager.door.test: no repo root from ${process.cwd()}`)
  })()
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const walk = (n, visit) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach((x) => walk(x, visit)); return }
    if (typeof n.type === 'string') visit(n)
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, visit)
  }

  /** TWO INDEPENDENT DERIVATIONS OF ONE SET, off `BuilderSheet.jsx`'s AST:
   *   `set` — every string handed to `setBuildMode(...)`  (what can be ENTERED)
   *   `cmp` — every string compared to `buildMode` with `===` (what is RENDERED)
   *
   *  ⭐ THEY MUST BE EQUAL, and requiring that is what makes this rail hard to
   *  fool. A single walk can be loosened until it matches almost anything and
   *  a containment check still passes (measured: mutating the callee-name test
   *  to `true` survived a containment-only version of this rail). Two walks that
   *  have to AGREE cannot both be loosened by one edit — and the equality is
   *  also the product claim worth having: a mode you can enter and have no tab
   *  for, or a tab for a mode nothing enters, is a dead door either way. */
  function sheetModeSets() {
    const tree = parse(read('app/src/components/chart/builder/BuilderSheet.jsx'))
    // ⛔ NAMED CONSTANTS ARE RESOLVED, NOT IGNORED (review round 1). The sheet's
    // edit rule moved behind `EDIT_MODE`, and a walk that only recognised string
    // LITERALS would have quietly stopped seeing a real writer — the rail would
    // still have passed, on a smaller set, which is the failure mode this whole
    // describe exists to make impossible.
    const consts = new Map()
    walk(tree, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier'
          && n.init && n.init.type === 'Literal' && typeof n.init.value === 'string') {
        consts.set(n.id.name, n.init.value)
      }
    })
    // ⚠️ AND THIS RESOLVER IS A DECLARED EQUIVALENT MUTANT TODAY (fix round 1,
    // N11 — measured, survived, not papered over). Every mode reachable through
    // a named constant is ALSO passed as a bare literal by its own tab's
    // `onClick`, so removing the resolution changes neither set and no case can
    // fail for it. It is kept because the day a mode is entered ONLY through a
    // constant — which is the direction this file is already moving — a
    // literal-only walk reports a SMALLER set and the equality above passes on
    // it. I did not manufacture a rail for it: the only discriminating test
    // would assert about a sheet that does not exist yet.
    const str = (node) => {
      if (!node) return null
      if (node.type === 'Literal' && typeof node.value === 'string') return node.value
      if (node.type === 'Identifier' && consts.has(node.name)) return consts.get(node.name)
      return null
    }
    const set = new Set()
    const cmp = new Set()
    walk(tree, (n) => {
      if (n.type === 'CallExpression' && n.callee && n.callee.type === 'Identifier'
          && n.callee.name === 'setBuildMode' && n.arguments.length === 1) {
        const v = str(n.arguments[0])
        if (v !== null) set.add(v)
      }
      if (n.type === 'BinaryExpression' && n.operator === '==='
          && n.left.type === 'Identifier' && n.left.name === 'buildMode') {
        const v = str(n.right)
        if (v !== null) cmp.add(v)
      }
    })
    // Every `*_MODE` the sheet declares — the rule constants the seed, the reset
    // and `openForEdit` read instead of retyping a mode name.
    const declared = new Map([...consts].filter(([k]) => /_MODE$/.test(k)))
    return { set, cmp, declared }
  }
  const sheetModes = () => sheetModeSets().set

  it('the walk sees a real mode set (not vacuous)', () => {
    const modes = sheetModes()
    expect(modes.size, 'no `setBuildMode(<literal>)` found — this rail would pass on anything')
      .toBeGreaterThanOrEqual(3)
    // The measured fourth door. If Pine is ever removed, this line is what says
    // so — rather than a guard quietly narrowing without anybody noticing.
    expect(modes.has('pine')).toBe(true)
  })

  it('⭐ what can be ENTERED and what is RENDERED are the same set', () => {
    const { set, cmp } = sheetModeSets()
    expect([...set].sort()).toEqual([...cmp].sort())
  })

  it('⭐ and every `*_MODE` rule constant the sheet declares is one of them', () => {
    // The sheet decides the opening door through named constants now, and a
    // constant naming a mode with no tab is a door that opens onto nothing —
    // invisible to the two set walks above, because nothing would ever have
    // rendered it.
    const { cmp, declared } = sheetModeSets()
    expect(declared.size, 'no `*_MODE` constants found — this rail would pass on anything')
      .toBeGreaterThanOrEqual(2)
    expect([...declared].filter(([, v]) => !cmp.has(v))).toEqual([])
  })

  it('NEW_SCAN_MODE is one of them', () => {
    expect([...sheetModes()]).toContain(NEW_SCAN_MODE)
  })

  it('and the rail is discriminating — a mode the sheet has no tab for is caught', () => {
    expect(sheetModes().has('conditions')).toBe(false)
  })
})

// ─── ⭐ THE WINDOW IS THE BUDGET'S CEILING, NOT A NUMBER THIS FILE CHOSE ─────
//
// ⛔ A DOOR-DEPENDENT REFUSAL IS THE DEFECT THIS PINS SHUT. The concierge's
// compute stage only fires `if bars`, and a tree with lookback L produces its
// first value at bar L — so a window under `maxLookback + 1` makes THIS door
// refuse `compute:empty` on a formula the budget permits and the chart's door
// would accept. The window must therefore move when the ceiling moves, and
// nothing but this pin can notice that it has not.
//
// ⚰️ The number was `400`, described in-file as "the budget's own `_MIN_BARS`
// floor". `_MIN_BARS` is `scan_evaluator.py`'s — the SWEEP's base window — and
// the budget's ceiling is 960, so the door was 560 bars short under a comment
// naming the wrong module.
describe('⭐ the concierge window is DERIVED from the budget', () => {
  const barsParam = () => Number(new URL(SPY_WINDOW, 'https://x').searchParams.get('bars'))

  it('the URL actually carries a bar count (not vacuous)', () => {
    expect(Number.isInteger(barsParam())).toBe(true)
    expect(barsParam()).toBe(SPY_WINDOW_BARS)
  })

  it('is at least the deepest warmup the budget PERMITS, plus the bar that yields a value', () => {
    expect(DEFAULT_BUDGET.maxLookback).toBeGreaterThan(0)
    expect(barsParam()).toBeGreaterThanOrEqual(DEFAULT_BUDGET.maxLookback + 1)
  })
})
