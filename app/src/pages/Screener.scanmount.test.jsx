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
// member does the only thing a member can do: open the scan surface. Cut the
// door, the manager, or the `<ScanResults/>` element inside it, and only this
// file reds.
//
// ─── Wave 4 Task 7: My Formulas retires — the door moved, the wire did not ──
//
// The chain a member reaches used to be `/screener` → the "My Formulas" tab →
// `SavedScreensPanel` → `ScanResults` → `CoverageLine`. That tab is gone.
// `ScreensManager` (mounted inside `ScannerShell`, which is the Scanner Hub's
// DEFAULT and now only screen) absorbed the definition detail: a member opens
// the `Screens ▾` menu and clicks the My-scans row bearing the formula they
// saved. The chain is now `/screener` → `ScannerShell` → `ScreensManager` →
// `ScanResults` → `CoverageLine`, and every assertion below still measures the
// SAME four-outcome receipt reaching the SAME real DOM — only the door changed.
//
// ⛔ NOTHING ON THE PATH UNDER TEST IS MOCKED. `ScreensManager`, `ScanResults`,
// `CoverageLine`, `useUserDefinitions` and the page itself are all the shipped
// modules. The stubs are the network (`fetch`), `ScannerShell`'s own three data
// hooks (`useScreenerMeta` / `useScreenerScan`, which own three polls and an
// append-on-identity hazard `screenSharing.mount.test.jsx` documents; and
// `useRealtimePrices`, which would otherwise open a live SSE connection) and
// the chart shell (`ChartPane`) — none of which can make a `coverage-line`
// element appear, because none of them renders one.

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
import { SCAN_TF, scannableScreens } from '../components/screener/scanSession'

// ── ScannerShell's OWN data lane: three hooks, none of them on the chain this
// file measures. Frozen module constants, per the hazard
// `screenSharing.mount.test.jsx` documents: a fresh object literal per call
// gives `result` a new identity every render and re-fires the accumulate
// effect forever.
const { META, SCAN } = vi.hoisted(() => ({
  META: { meta: { categories: [], filters: [], views: [{ key: 'overview', label: 'Overview', columns: ['ticker'] }] } },
  SCAN: { result: { total: 0, page: 1, view: 'overview', view_columns: ['ticker'], rows: [], snapshot_date: '2026-08-08' }, isLoading: false },
}))
vi.mock('./screener/hooks/useScreenerMeta', () => ({ default: () => META }))
vi.mock('./screener/hooks/useScreenerScan', () => ({ default: () => SCAN }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))

// `META`/`SCAN` are `const` bindings (the `vi.mock` closures above capture
// them by reference, so they can never be REASSIGNED) — a case that needs the
// scan lane's shape (the chip-wire pin below) mutates their contents in place
// and this restores the byte-identical baseline before every test, so one
// case's mutation can never leak into the next.
function resetScanLane() {
  META.meta = { categories: [], filters: [],
    views: [{ key: 'overview', label: 'Overview', columns: ['ticker'] }] }
  SCAN.result = { total: 0, page: 1, view: 'overview', view_columns: ['ticker'],
    rows: [], snapshot_date: '2026-08-08' }
  SCAN.isLoading = false
}
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
  resetScanLane()
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
    // The candidate board (`/api/candidates`), the saved-screens store
    // (`/api/screener/saved-screens`, ScreensManager's OTHER section, unrelated
    // to this chain) and anything else the shell reaches: a well-formed empty
    // answer, so nothing on the page throws.
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

/** Open the manager. ⛔ Located by ROLE and the control's own label, never by a
 *  testid — a member finds this control by reading it, and a rail that keyed
 *  on a private attribute would stay green through a menu that renders
 *  invisible. */
async function openScreensMenu(user) {
  await user.click(await screen.findByRole('button', { name: 'Screens ▾' }))
}

/** Do the only things a member can do to reach the scan surface: open the
 *  manager, then open the My-scans row bearing the screen they saved (K6 — the
 *  door is now `Screens ▾` → the My-scans row, not a "My Formulas" tab). */
async function openTheScanSurface(user) {
  await openScreensMenu(user)
  await user.click(await screen.findByRole('button', { name: SCREEN_NAME }))
}

// ─── the scan-chip wire: ScannerShell threads scan_joins to the chip ────────
//
// Controller fix-round 1 (2026-08-22): the E-4 unification plan's controller
// addition (Task 4's chip, pinned end-to-end through the real shell) was
// claimed in the T7 report but never written. This is that case.
//
// ⛔ THE COUNTS ARE NOT THE WIRE. `ScanFilterChip.scanChipText`'s ONE authority
// for evaluated/answered/dropped is the META entry's `latest` — a case that
// only asserted the swept text would pass even if `ScannerShell` never passed
// `scanJoins` to `FilterChips` at all (META alone renders it). The PER-REQUEST
// truth in `scan_joins` is visible ONLY through the `applied: false` DOWNGRADE
// to "first sweep tonight" — so that is the primary, discriminating assertion:
// it is IMPOSSIBLE to produce from META alone, and can only come from
// `ScannerShell` actually reading `result?.scan_joins` and handing it down.
describe('🔴 the scan chip: the downgrade only the shell\'s scanJoins threading can produce', () => {
  it('a scan filter applied via the manager renders scanJoins\' downgrade, and clears through onReplace', async () => {
    // Override the hoisted mocks for THIS test only (resetScanLane restores
    // the baseline in the next test's beforeEach): the meta rail carries a
    // `my_scans` category + a `scan` filter entry naming the fixture's own
    // hash, with a `latest` that WOULD render swept counts on its own —
    // and the scan response's `scan_joins` marks that same hash `applied:
    // false`, which must win.
    META.meta = {
      categories: [{ key: 'my_scans', label: 'My Scans' }],
      filters: [{
        key: 'scan', label: 'My Scans', category: 'my_scans', type: 'enum',
        allow_custom: false, unit: null,
        presets: [{ label: 'Any' }, { label: SCREEN_NAME, op: 'in', value: DEF_HASH }],
        scans: [{ def_hash: DEF_HASH, name: SCREEN_NAME, latest: {
          as_of: 20260820, evaluated: 10, answered: 8, dropped: 1,
          not_computable: 1, freshness: 'fresh',
        } }],
      }],
      views: [{ key: 'overview', label: 'Overview', columns: ['ticker'] }],
    }
    SCAN.result = {
      total: 0, page: 1, view: 'overview', view_columns: ['ticker'], rows: [],
      snapshot_date: '2026-08-08',
      // The per-request receipt: THIS hash's join did not apply this time
      // (withheld/never-swept are indistinguishable at the store, by design —
      // spec §4c) even though META still remembers a `latest` from a prior sweep.
      scan_joins: [{ def_hash: DEF_HASH, as_of: 20260820, applied: false }],
    }

    const user = userEvent.setup()
    renderScreenerPage()

    // DOOR: Screens ▾ → the My-scans row's own "Use as filter" action — the
    // real UI path a member drives (not a URL-seeded spec): `useScreenSpec`
    // is the REAL hook in this file (only ScannerShell's three data hooks are
    // mocked), so `s.filters`/`s.setFilter` are live state, and ScannerShell's
    // `onUseScan` (unmocked, production code) is what turns the click into
    // `s.setFilter('scan', {op:'in', value: DEF_HASH, label: SCREEN_NAME})`.
    await openScreensMenu(user)
    await user.click(await screen.findByRole('button', { name: `Use ${SCREEN_NAME} as filter` }))

    // 🔴 THE DISCRIMINATING ASSERTION. "first sweep tonight" from a hash whose
    // META entry carries a `latest` is reachable ONLY if ScannerShell actually
    // passed `scanJoins={result?.scan_joins}` through to `FilterChips` — cut
    // that prop (or stop reading `result?.scan_joins`) and this hash would
    // render the swept text instead, because META alone says it was swept.
    const chip = await screen.findByTestId(`scan-chip-${DEF_HASH.slice(7, 15)}`)
    expect(chip,
      'the scan chip never reached the DOM — the manager\'s "Use as filter" '
      + 'action did not thread into an active scan filter the shell renders a '
      + 'chip for').toBeInTheDocument()
    expect(chip,
      'the chip rendered the SWEPT text off META\'s latest alone — ScannerShell '
      + 'is not threading `scan_joins` from the scan response into FilterChips, '
      + 'so the per-request applied:false downgrade never reaches the chip')
      .toHaveTextContent(`${SCREEN_NAME} — first sweep tonight`)
    expect(chip).not.toHaveTextContent(/answered/)

    // Cheap second pin, same case: the chip's ✕ round-trips through
    // `onReplace` (ScannerShell → `s.setFilter('scan', null)`) back to REAL
    // `useScreenSpec` state. If `onReplace` were dropped, this click would
    // either throw or leave the chip on screen.
    await user.click(screen.getByRole('button', { name: 'Remove scan filter' }))
    await waitFor(() => expect(
      screen.queryByTestId(`scan-chip-${DEF_HASH.slice(7, 15)}`)).toBeNull())
  })
})

describe('🔴 the scan receipt reaches a member from the route they navigate to', () => {
  it('/screener mounts the scan surface, and CoverageLine renders all four counts', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheScanSurface(user)

    // 🔴 THE WIRE-CUT ASSERTION. `coverage-line` is markup ONLY `CoverageLine`
    // writes. It is on screen here iff every link of
    // `Screener → ScannerShell → ScreensManager → ScanResults → CoverageLine`
    // is intact.
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
    await openTheScanSurface(user)
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
    await openScreensMenu(user)
    // Derived from the document, so a manager that invented its own label reds.
    // ⛔ A plain button, not a tab: `ScreensManager`'s My-scans rows are the
    // detail's own toggle, not a page-level tablist.
    expect(await screen.findByRole('button', { name: DEFINITION.meta.name })).toBeInTheDocument()
  })

  it('and the hits are on screen, so the receipt is describing a real answer', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheScanSurface(user)
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
    await openTheScanSurface(user)

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
    await openTheScanSurface(user)

    const note = await screen.findByTestId('coverage-nodata', {}, { timeout: 6000 })
    expect(note).toHaveTextContent(/not a quiet market/i)
    expect(note).toHaveTextContent(/2,615/)
  })

  it('and an UNRUN session says so, rather than rendering as zero matches', async () => {
    H.results = { def_hash: DEF_HASH, tf: SCAN_TF, as_of: AS_OF, status: 'not-run',
      coverage: null, tickers: [], truncated: false }
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheScanSurface(user)

    expect(await screen.findByTestId('scan-results-not-run', {}, { timeout: 6000 }))
      .toBeInTheDocument()
    // ⛔ "Nobody looked" is not "we looked and found none" (E6-A2). A receipt of
    // zeroes for a session that was never swept is an invented measurement.
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })
})

describe('the scan surface is a real destination, not a rail-satisfying stub', () => {
  it('the "Screens ▾" door is offered on the page App.jsx routes to', async () => {
    renderScreenerPage()
    expect(screen.getByRole('heading', { name: /scanner hub/i })).toBeInTheDocument()
    // The control a member clicks — findable by its label, like every other one.
    expect(await screen.findByRole('button', { name: 'Screens ▾' })).toBeInTheDocument()
  })

  it('and it is NOT gated on the candidate board, which is a different feed', async () => {
    // ⛔ `Screener.jsx` guards its non-`scanner` tabs on `/api/candidates`
    // (`error ? … : !data ? <SkeletonTable/> : …`), but `ScannerShell` — and the
    // manager mounted inside it — renders in the FIRST arm of that ternary,
    // ahead of the chain entirely (see `ScannerShell.jsx`'s own header note).
    // Mounted below that line instead, this surface would go blank on every
    // morning the 7 AM pre-market scan failed — a mount reachable only when an
    // unrelated job succeeded.
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
    await openTheScanSurface(user)
    expect(await screen.findByTestId('coverage-line', {}, { timeout: 6000 })).toBeInTheDocument()
  })

  it('a member with no saved formulas is told so — never shown a blank panel', async () => {
    H.defs = { definitions: [] }
    const user = userEvent.setup()
    renderScreenerPage()
    await openScreensMenu(user)
    // ⛔ `ScreensManager` has no `saved-screens-empty` testid of its own (that
    // was `SavedScreensPanel`'s) — the honest-absence message is the manager's
    // own "My scans" section copy, found the way a member reads it.
    expect(await screen.findByText(/no scannable formulas yet/i)).toBeInTheDocument()
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
    await openScreensMenu(user)
    await waitFor(() => expect(screen.getByTestId('screens-manager-error--scans')).toBeInTheDocument())
    expect(screen.queryByText(/no scannable formulas yet/i)).toBeNull()
  })
})

// ─── the non-vacuity controls ───────────────────────────────────────────────
//
// ⛔ A RAIL NOBODY HAS SEEN FAIL IS INDISTINGUISHABLE FROM A RAIL THAT CANNOT.
// The cut itself is proven by the mutation harness (the mount element is deleted
// from `ScreensManager.jsx` and this file goes red naming what became
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
    // `ScanResults`, `CoverageLine`, `ScreensManager`, `scanSession` or
    // `useUserDefinitions` would let the page pass while the real chain is
    // severed.
    const src = read('app/src/pages/Screener.scanmount.test.jsx')
    const mocked = [...src.matchAll(/vi\.mock\(\s*'([^']+)'/g)].map((m) => m[1])
    expect(mocked.length, 'the mock scan found nothing — this control is vacuous')
      .toBeGreaterThan(0)
    for (const spec of mocked) {
      expect(/ScanResults|CoverageLine|ScreensManager|scanSession|useUserDefinitions/.test(spec),
        `${spec} is mocked, and it is ON the chain this file claims to measure — `
        + 'every assertion above would then pass with the wire cut').toBe(false)
    }
  })

  it('the four counts are markup only CoverageLine writes', () => {
    // If any other module on the page emitted `coverage-line`, the headline
    // assertion could pass without `CoverageLine` ever being reached.
    const owners = ['app/src/components/screener/CoverageLine.jsx',
      'app/src/components/screener/ScanResults.jsx',
      'app/src/pages/screener/ScreensManager.jsx',
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
