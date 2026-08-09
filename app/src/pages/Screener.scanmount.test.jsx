// app/src/pages/Screener.scanmount.test.jsx
//
// ─── 🔴 THE WIRE-CUT. THE ONLY THING IN THIS REPO THAT COULD HAVE CAUGHT IT ──
//
// `ScanResults.jsx` shipped built, tested and GREEN, imported by **nothing**;
// `CoverageLine.jsx` was imported only by `ScanResults`, so spec §6.3's
// four-outcome receipt could not be reached from any route a member can
// navigate to. E-4's own report named the debt (concern 4): *"when it is
// mounted, the mounting task owes a wire-cut test, not another component
// test."* This is that test, and the twelfth measured instance of this
// codebase's signature defect is what it exists to prevent recurring.
//
// ⛔ WHY THE COMPONENT TESTS COULD NOT SEE IT, MEASURED IN THIS REPO.
// `CoverageLine.test.jsx` (10 green), `ScanResultRow.test.jsx` (4 green) and
// `ScanToChart.wire.test.jsx` (13 green) ALL render their subject DIRECTLY —
// the last one even carries "wire" in its name, and it is a wire between two
// components inside one file. Every one of them stays green for the entire time
// the surface is unreachable, because both halves of a severed wire remain
// individually correct. The demonstration on record: unmount `ConciergeBox`,
// run its own test file, still GREEN. 4 auditors, 25 findings, 9 HIGH, 6 of the
// 9 unreachability.
//
// ⭐ SO THIS FILE RENDERS THE PAGE, NOT THE COMPONENT. `<Screener/>` is what
// `App.jsx` mounts at `/screener` — the route `NavBar` labels "Screener". The
// assertion is that `CoverageLine`'s OWN output (`data-testid="coverage-line"`,
// which no file here writes and no file here mocks) reaches the DOM after a
// member does the only thing a member can do: open the tab. Cut the tab, the
// panel, or the `<ScanResults/>` element inside it, and only this file reds.
//
// ⛔ NOTHING ON THE PATH UNDER TEST IS MOCKED. `SavedScreensPanel`,
// `ScanResults`, `CoverageLine`, `useUserDefinitions` and the page itself are
// all the shipped modules; the only stubs are the network (`fetch`), the
// default tab's own unrelated data surface (`ScannerPro`) and the chart shell
// (`ChartPane`) — none of which can make a `coverage-line` element appear,
// because none of them renders one.

import fs from 'node:fs'
import path from 'node:path'
import { SWRConfig } from 'swr'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { AuthProvider } from '../context/AuthContext'
import { VoiceProvider } from '../context/VoiceContext'
import { parseFormula, astHash } from '../components/chart/engine/ast/parse'
import { lintRepaint } from '../components/chart/engine/ast/lint'
import { freshnessFor } from '../components/chart/engine/ast/freshness'
import { SCHEMA_VERSION } from '../components/chart/engine/defSchema'
import { AST_LANE_TIER, clearUserDefinitions } from '../components/chart/engine/nativeRegistry'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../components/chart/builder/builderInputs'
import { USER_DEFINITIONS_KEY } from '../hooks/useUserDefinitions'
import { RESULTS_ENDPOINT } from '../components/screener/ScanResults'
import { SCAN_TF, scannableScreens } from '../components/screener/SavedScreensPanel'

// The Scanner Hub's DEFAULT tab, which owns three data hooks of its own and is
// not what this file is about. `Screener.test.jsx` stubs it for the same reason.
vi.mock('./screener/ScannerPro', () => ({ default: () => <div>scanner pro</div> }))
// The chart shell. ⛔ Stubbing it CANNOT make this file pass: every assertion
// below is on markup `CoverageLine` writes, and `ChartPane` is only reached
// after a chart click this file never makes.
vi.mock('../components/chart/pane/ChartPane', () => ({
  default: ({ sym, tf }) => <div data-testid={`pane-inner-${sym}-${tf}`}>pane</div>,
}))

const Screener = (await import('./Screener')).default

// ─── the fixture, built the way the builder builds one ──────────────────────
//
// ⛔ EVERY MACHINE-ASSIGNED FIELD IS MEASURED, NOT TYPED. `compute.fn` is
// `astHash(compute.ast)`, `repaint` is `lintRepaint(ast).mode`, `freshness` is
// `freshnessFor(ast).mode` — a fixture that typed any of them would be
// asserting about a document the product refuses to save.

const SCAN_SOURCE = 'close > sma(close, 50)'
const PARSED = parseFormula(SCAN_SOURCE)
if (!PARSED.ok) throw new Error(`the scan-mount fixture does not parse: ${PARSED.error}`)
const AST = PARSED.ast
const DEF_HASH = astHash(AST)
const DEF_ID = 'u_5c4a17e3b0d9'
const SCREEN_NAME = 'Above the 50'

const DEFINITION = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  id: DEF_ID,
  version: 1,
  meta: {
    name: SCREEN_NAME, shortName: 'A50', category: 'Custom', tier: AST_LANE_TIER,
    repaint: lintRepaint(AST, { inputs: BUILDER_INPUT_SCOPE }).mode,
    freshness: freshnessFor(AST).mode,
  },
  compute: { kind: 'ast', fn: DEF_HASH, rev: 1, ast: AST, source: SCAN_SOURCE },
  placement: { target: 'pane', pane: { height: 0.15 } },
  inputs: BUILDER_INPUTS,
  plots: [{ key: 'value', label: 'A50', style: 'line', color: '$color', width: 1, role: 'primary' }],
})

/** The row shape `/api/user-definitions` answers with. */
const DEF_ROW = Object.freeze({
  def_id: DEF_ID, version: 1, rev: 1, ast_hash: DEF_HASH, definition: DEFINITION,
  repaint: DEFINITION.meta.repaint, created_at: '2026-08-07T04:00:00Z',
})

/** A receipt whose arithmetic CLOSES. ⛔ Derived, never four literals —
 *  `CoverageLine` refuses to present a receipt that does not close, and a
 *  fixture that tripped that refusal would be measuring the wrong thing. */
function receipt({ answered, dropped, not_computable: nc, ...rest }) {
  return {
    evaluated: answered + dropped + nc,
    answered,
    dropped,
    not_computable: nc,
    dropped_symbols: [],
    ...rest,
  }
}

const AS_OF = 20260807
const H = { defs: null, results: null, calls: [] }

/** The SHIPPED route's payload — `api/routers/scan_results.py` answers
 *  `{def_hash, tf, as_of, status, coverage, tickers, truncated}`. */
const evaluatedPayload = (over = {}) => ({
  def_hash: DEF_HASH,
  tf: SCAN_TF,
  as_of: AS_OF,
  status: 'evaluated',
  coverage: receipt({ answered: 3699, dropped: 2, not_computable: 41 }),
  tickers: ['NVDA'],
  truncated: false,
  ...over,
})

const json = (body) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body),
})

beforeEach(() => {
  H.defs = { definitions: [DEF_ROW] }
  H.results = evaluatedPayload()
  H.calls = []
  clearUserDefinitions()
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    H.calls.push(u)
    if (u.startsWith('/api/auth/me')) {
      return json({ user: { id: 7, email: 'member@uct.test', role: 'user' }, plan: 'premium' })
    }
    if (u.startsWith(USER_DEFINITIONS_KEY)) return json(H.defs)
    if (u.startsWith(RESULTS_ENDPOINT)) return json(H.results)
    // The candidate board (`/api/candidates`) and anything else the shell
    // reaches: a well-formed empty answer, so nothing on the page throws.
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearUserDefinitions()
})

/** The page a member reaches at `/screener`, with the app's real providers.
 *  ⛔ A FRESH SWR CACHE PER RENDER — `useUserDefinitions` dedupes for 10s, and a
 *  shared cache would let one case's definitions answer the next case's read. */
function renderScreenerPage() {
  return render(
    <MemoryRouter initialEntries={['/screener']}>
      <AuthProvider>
        <VoiceProvider>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
            <Screener />
          </SWRConfig>
        </VoiceProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

/** Do the one thing a member can do to get here: open the tab. ⛔ Located by
 *  ROLE and the tab's own label, never by a testid — a member finds this
 *  control by reading it, and a rail that keyed on a private attribute would
 *  stay green through a tab that renders invisible. */
async function openTheFormulasTab(user) {
  await user.click(screen.getByRole('button', { name: /my formulas/i }))
}

describe('🔴 the scan receipt reaches a member from the route they navigate to', () => {
  it('/screener mounts the scan surface, and CoverageLine renders all four counts', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)

    // 🔴 THE WIRE-CUT ASSERTION. `coverage-line` is markup ONLY `CoverageLine`
    // writes. It is on screen here iff every link of
    // `Screener → SavedScreensPanel → ScanResults → CoverageLine` is intact.
    const line = await screen.findByTestId('coverage-line', {}, { timeout: 6000 })
    expect(line,
      'CoverageLine never reached the page. `/screener` rendered without a scan '
      + 'surface, so the four-outcome coverage receipt (spec §6.3) is unreachable '
      + 'from every route a member can navigate to — the "built, tested, green and '
      + 'connected to nothing" defect, twelfth measured instance.').toBeInTheDocument()

    // The four, each named — ⛔ never collapsed. "We could not compute it" and
    // "something broke" are different facts to a trader.
    expect(line).toHaveTextContent(/3,742 evaluated/)
    expect(line).toHaveTextContent(/3,699 answered/)
    expect(line).toHaveTextContent(/2 dropped/)
    expect(line).toHaveTextContent(/41 not computable/)
    // 43 dropped would tell a trader the screen is broken.
    expect(line).not.toHaveTextContent(/43/)
  })

  it('and the read it drives carries the DEFINITION the member picked, by hash', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)
    await screen.findByTestId('coverage-line', {}, { timeout: 6000 })

    // ⛔ A MOUNT THAT RENDERS AND ASKS FOR NOTHING IS STILL A DEAD SURFACE. The
    // hash is DERIVED from the fixture's tree, never typed: `compute.fn` IS
    // `astHash(compute.ast)` IS the `def_hash` the sweep filed the receipt under.
    const asked = H.calls.filter((u) => u.startsWith(RESULTS_ENDPOINT))
    expect(asked.length,
      `the page mounted a scan surface that never read ${RESULTS_ENDPOINT} — the `
      + 'receipt on screen would be describing nothing').toBeGreaterThan(0)
    expect(asked[asked.length - 1]).toContain(`def_hash=${encodeURIComponent(DEF_HASH)}`)
    expect(asked[asked.length - 1]).toContain(`tf=${encodeURIComponent(SCAN_TF)}`)
  })

  it('the member sees the screen they saved, by the name THEY gave it', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)
    // Derived from the document, so a panel that invented its own label reds.
    expect(await screen.findByRole('tab', { name: DEFINITION.meta.name })).toBeInTheDocument()
  })

  it('and the hits are on screen, so the receipt is describing a real answer', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)
    expect(await screen.findByTestId(`scan-hit-${H.results.tickers[0]}`, {}, { timeout: 6000 }))
      .toBeInTheDocument()
  })
})

describe('🔴 withheld renders as BREADTH, never folded into "no matches"', () => {
  it('a capped screen says what it did not look at, BESIDE the four counts', async () => {
    const withheld = 2_800
    H.results = evaluatedPayload({
      coverage: {
        ...receipt({ answered: 40, dropped: 1, not_computable: 901 }),
        withheld,
        withheld_reason: 'symbols:plan',
      },
    })
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)

    const note = await screen.findByTestId('coverage-withheld', {}, { timeout: 6000 })
    expect(note,
      'a capped scan reached the member with no mention of the symbols their plan '
      + 'did not look at — "5 evaluated" and silence about the other 3,737 is the '
      + 'lie of omission §6.3 forbids').toHaveTextContent(/2,800/)

    // ⛔ BESIDE, NEVER INSIDE. `evaluated` describes what the sweep looked at for
    // everybody; folding a read-time cap into it would claim work nobody did and
    // the closing identity would stop closing.
    const line = screen.getByTestId('coverage-line')
    expect(line).toHaveTextContent(/942 evaluated/)
    expect(line).not.toHaveTextContent(/2,800/)
    expect(screen.queryByTestId('coverage-broken'),
      'the receipt on screen does not close its own arithmetic').toBeNull()
  })

  it('a screen that answered NOTHING says it is a data gap, not a quiet market', async () => {
    // ⚠️ THE SNAPSHOT ON THIS BOX IS A MONTH STALE, so a scalar-bearing scan
    // legitimately answers `answered=0, not_computable=2615`. ⛔ That is not a
    // thing to "fix" at the mount — it is the exact receipt §6.3 exists for, and
    // the mount's job is to let the member READ it.
    H.results = evaluatedPayload({
      coverage: receipt({ answered: 0, dropped: 0, not_computable: 2615 }),
      tickers: [],
    })
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)

    const note = await screen.findByTestId('coverage-nodata', {}, { timeout: 6000 })
    expect(note).toHaveTextContent(/not a quiet market/i)
    expect(note).toHaveTextContent(/2,615/)
  })

  it('and an UNRUN session says so, rather than rendering as zero matches', async () => {
    H.results = { def_hash: DEF_HASH, tf: SCAN_TF, as_of: AS_OF, status: 'not-run',
      coverage: null, tickers: [], truncated: false }
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)

    expect(await screen.findByTestId('scan-results-not-run', {}, { timeout: 6000 }))
      .toBeInTheDocument()
    // ⛔ "Nobody looked" is not "we looked and found none" (E6-A2). A receipt of
    // zeroes for a session that was never swept is an invented measurement.
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })
})

describe('the tab is a real destination, not a rail-satisfying stub', () => {
  it('it is offered beside the hub\'s other tabs, on the page App.jsx routes to', async () => {
    renderScreenerPage()
    expect(screen.getByRole('heading', { name: /scanner hub/i })).toBeInTheDocument()
    // The control a member clicks — findable by its label, like the other three.
    expect(screen.getByRole('button', { name: /my formulas/i })).toBeInTheDocument()
  })

  it('and it is NOT gated on the candidate board, which is a different feed', async () => {
    // ⛔ `Screener.jsx` guards its other non-default tabs on `/api/candidates`
    // (`error ? … : !data ? <SkeletonTable/> : …`). Mounted below that line, this
    // surface would go blank on every morning the 7 AM pre-market scan failed —
    // a mount reachable only when an unrelated job succeeded.
    vi.stubGlobal('fetch', vi.fn((url) => {
      const u = String(url)
      H.calls.push(u)
      if (u.startsWith('/api/auth/me')) {
        return json({ user: { id: 7, email: 'member@uct.test', role: 'user' }, plan: 'premium' })
      }
      if (u.startsWith(USER_DEFINITIONS_KEY)) return json(H.defs)
      if (u.startsWith(RESULTS_ENDPOINT)) return json(H.results)
      // The candidate board is DOWN.
      return Promise.reject(new Error('candidates unavailable'))
    }))
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)
    expect(await screen.findByTestId('coverage-line', {}, { timeout: 6000 })).toBeInTheDocument()
  })

  it('a member with no saved formulas is told so — never shown a blank panel', async () => {
    H.defs = { definitions: [] }
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)
    expect(await screen.findByTestId('saved-screens-empty', {}, { timeout: 6000 }))
      .toBeInTheDocument()
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })

  it('and a REFUSED read is reported, never rendered as "you have none"', async () => {
    // A swallowed 402 and an empty account are the same picture, and the
    // difference decides whether the member should be looking at a paywall.
    vi.stubGlobal('fetch', vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/auth/me')) {
        return json({ user: { id: 7, email: 'member@uct.test', role: 'user' }, plan: 'free' })
      }
      if (u.startsWith(USER_DEFINITIONS_KEY)) {
        return Promise.resolve({ ok: false, status: 402, json: () => Promise.resolve({}) })
      }
      return json({})
    }))
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheFormulasTab(user)
    await waitFor(() => expect(screen.getByTestId('saved-screens-error')).toBeInTheDocument())
    expect(screen.queryByTestId('saved-screens-empty')).toBeNull()
  })
})

// ─── the non-vacuity controls ───────────────────────────────────────────────
//
// ⛔ A RAIL NOBODY HAS SEEN FAIL IS INDISTINGUISHABLE FROM A RAIL THAT CANNOT.
// The cut itself is proven by the mutation harness (the mount element is deleted
// from `SavedScreensPanel.jsx` and this file goes red naming what became
// unreachable, while `CoverageLine.test.jsx`, `ScanResultRow.test.jsx` and
// `ScanToChart.wire.test.jsx` all stay green). What lives HERE is the pair of
// structural facts that harness depends on being true.

describe('the controls that keep the rail honest', () => {
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i += 1) {
      if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    throw new Error(`Screener.scanmount.test: could not find the repo root from ${process.cwd()}`)
  })()
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

  it('this file mocks NOTHING on the path it measures', () => {
    // ⛔ The failure mode that would make every case above vacuous: a stub for
    // `ScanResults`, `CoverageLine`, `SavedScreensPanel` or `useUserDefinitions`
    // would let the page pass while the real chain is severed.
    const src = read('app/src/pages/Screener.scanmount.test.jsx')
    const mocked = [...src.matchAll(/vi\.mock\(\s*'([^']+)'/g)].map((m) => m[1])
    expect(mocked.length, 'the mock scan found nothing — this control is vacuous')
      .toBeGreaterThan(0)
    for (const spec of mocked) {
      expect(/ScanResults|CoverageLine|SavedScreensPanel|useUserDefinitions/.test(spec),
        `${spec} is mocked, and it is ON the chain this file claims to measure — `
        + 'every assertion above would then pass with the wire cut').toBe(false)
    }
  })

  it('the four counts are markup only CoverageLine writes', () => {
    // If any other module on the page emitted `coverage-line`, the headline
    // assertion could pass without `CoverageLine` ever being reached.
    const owners = ['app/src/components/screener/CoverageLine.jsx',
      'app/src/components/screener/ScanResults.jsx',
      'app/src/components/screener/SavedScreensPanel.jsx',
      'app/src/pages/Screener.jsx']
      .filter((rel) => read(rel).includes('data-testid="coverage-line"'))
    expect(owners, 'exactly one module may emit the coverage line')
      .toEqual(['app/src/components/screener/CoverageLine.jsx'])
  })

  it('the panel offers only screens the scan route can be ASKED about', () => {
    // The filter, asserted directly rather than inferred from what rendered: a
    // definition with no tree has no `def_hash`, so a row for it would be a
    // control that can only ever produce silence.
    const noTree = { def_id: 'u_notree', definition: { compute: { kind: 'native', fn: 'rsi' } } }
    expect(scannableScreens([DEF_ROW, noTree]).map((r) => r.def_id)).toEqual([DEF_ID])
    expect(scannableScreens(null)).toEqual([])
  })
})
