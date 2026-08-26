// app/src/pages/Screener.door.test.jsx
//
// ─── 🔴 THE WIRE-CUT for W4a.5: the door, the sheet, the save — on the REAL PAGE
//
// `ScreensManager.door.test.jsx` mocks the sheet and asserts the props the
// manager hands it. That file stays green through a lazy chunk that never
// resolves, a `Suspense` that never renders, and a sheet that opens on the wrong
// tab — because a mock cannot disagree with the thing it replaced. This one
// renders `<Screener/>` under the app's real providers and mocks NOTHING on the
// chain under test:
//
//   ScreensManager → BuilderSheet (lazy, REAL) → saveUserDefinition (REAL)
//                  → POST /api/user-definitions → the new scan's own detail
//
// The stubs are the network (`fetch`), `ScannerShell`'s own three data hooks and
// `ChartPane` — the same set `Screener.scanmount.test.jsx` stubs, and none of
// them can open a builder, because none of them renders one.
import fs from 'node:fs'
import path from 'node:path'
import { SWRConfig, mutate } from 'swr'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

import { AuthProvider } from '../context/AuthContext'
import { VoiceProvider } from '../context/VoiceContext'
import { parseFormula, astHash } from '../components/chart/engine/ast/parse'
import { lintRepaint } from '../components/chart/engine/ast/lint'
import { freshnessFor } from '../components/chart/engine/ast/freshness'
import { SCHEMA_VERSION } from '../components/chart/engine/defSchema'
import { AST_LANE_TIER, clearUserDefinitions } from '../components/chart/engine/nativeRegistry'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../components/chart/builder/builderInputs'
import { STARTERS, STARTER_LIST } from '../components/chart/builder/StarterLibrary'
import { USER_DEFINITIONS_KEY } from '../hooks/useUserDefinitions'
import { RESULTS_ENDPOINT } from '../components/screener/ScanResults'
import { SPY_WINDOW } from './screener/ScreensManager'

const { META, SCAN } = vi.hoisted(() => ({
  META: { meta: { categories: [], filters: [], views: [{ key: 'overview', label: 'Overview', columns: ['ticker'] }] } },
  SCAN: { result: { total: 0, page: 1, view: 'overview', view_columns: ['ticker'], rows: [], snapshot_date: '2026-08-21' }, isLoading: false },
}))
vi.mock('./screener/hooks/useScreenerMeta', () => ({ default: () => META, META_KEY: '/api/screener/meta' }))
vi.mock('./screener/hooks/useScreenerScan', () => ({ default: () => SCAN }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../components/chart/pane/ChartPane', () => ({
  default: ({ sym, tf }) => <div data-testid={`pane-inner-${sym}-${tf}`}>pane</div>,
}))

const Screener = (await import('./Screener')).default

// ─── one saved scan already in the store ────────────────────────────────────
//
// ⛔ EVERY MACHINE-ASSIGNED FIELD IS MEASURED, NOT TYPED (the scanmount
// fixture's rule): `compute.fn` is `astHash(compute.ast)`, `repaint` is
// `lintRepaint(...).mode`. A fixture that typed one would be asserting about a
// document the product refuses to save.
const SCAN_SOURCE = 'close > sma(close, 50)'
const PARSED = parseFormula(SCAN_SOURCE)
if (!PARSED.ok) throw new Error(`the door fixture does not parse: ${PARSED.error}`)
const AST = PARSED.ast
const DEF_HASH = astHash(AST)
const DEF_ID = 'u_5c4a17e3b0d9'
const SCREEN_NAME = 'Above the 50'
const NEW_DEF_ID = 'u_aaaaaaaaaaaa'

const DEFINITION = Object.freeze({
  schemaVersion: SCHEMA_VERSION, id: DEF_ID, version: 1,
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
const DEF_ROW = Object.freeze({
  def_id: DEF_ID, version: 1, rev: 1, ast_hash: DEF_HASH, definition: DEFINITION,
  repaint: DEFINITION.meta.repaint, created_at: '2026-08-21T04:00:00Z',
})

/** ⭐ A SCANNABLE ROW STORED WITHOUT ITS SOURCE TEXT — the one shape in which
 *  the sheet's opening mode is decided by NOTHING BUT the seed and the reset.
 *  `openForEdit` refuses a row with no `compute.source` and returns BEFORE its
 *  own `setBuildMode`, so if `openingMode` did not know about `editRow` the tab
 *  would be wrong at first paint AND still wrong at settle. See the case. */
const NO_SOURCE_ID = 'u_9d1f0c4a7b22'
const NO_SOURCE_NAME = 'Stored without its text'
const NO_SOURCE_ROW = Object.freeze({
  def_id: NO_SOURCE_ID, version: 1, rev: 1, ast_hash: DEF_HASH,
  definition: {
    ...DEFINITION,
    id: NO_SOURCE_ID,
    meta: { ...DEFINITION.meta, name: NO_SOURCE_NAME },
    compute: { kind: 'ast', fn: DEF_HASH, rev: 1, ast: AST },
  },
  repaint: DEFINITION.meta.repaint, created_at: '2026-08-21T04:00:00Z',
})

/** A receipt whose arithmetic CLOSES — `CoverageLine` refuses one that does not. */
const receipt = ({ answered, dropped, not_computable: nc, ...rest }) => ({
  evaluated: answered + dropped + nc, answered, dropped, not_computable: nc,
  dropped_symbols: [], ...rest,
})
const AS_OF = 20260821
const nightly = () => ({
  def_hash: DEF_HASH, tf: 'D', as_of: AS_OF, status: 'evaluated',
  coverage: receipt({ answered: 3699, dropped: 2, not_computable: 41 }),
  tickers: ['NVDA'], truncated: false,
})
/** 400 daily bars in the `/api/bars` shape. */
const spyBars = () => Array.from({ length: 400 }, (_, i) => ({
  t: `2025-0${1 + (i % 9)}-0${1 + (i % 9)}`, o: 500 + i, h: 501 + i, l: 499 + i, c: 500 + i, v: 1000,
}))

// `deleteRefusal`, when set, is the sentence the STORE answers a DELETE with —
// the only place any such string exists in this file, which is what makes the
// refusal case below a measurement of the hop rather than of a fixture.
const H = { defs: null, requests: [], deleteRefusal: null }
const json = (body, status = 200) => Promise.resolve({
  ok: status < 400, status, json: () => Promise.resolve(body),
})

beforeEach(async () => {
  // ⛔ THE DEFAULT SWR CACHE, CLEARED — NOT A PRIVATE `provider`. This chain
  // ends in `saveUserDefinition`, which revalidates through the MODULE-LEVEL
  // `mutate` (`import { mutate } from 'swr'`), and that one only ever writes
  // to the default cache. Handing the tree its own provider silently makes
  // that revalidation a no-op — the save would succeed and the new scan would
  // never appear, which is a property of the test harness and not of the
  // product. Isolation comes from emptying the real cache instead.
  await mutate(() => true, undefined, { revalidate: false })
  H.defs = { definitions: [DEF_ROW, NO_SOURCE_ROW] }
  H.requests = []
  H.deleteRefusal = null
  clearUserDefinitions()
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const u = String(url)
    const method = init.method || 'GET'
    let body = null
    try { body = init.body ? JSON.parse(init.body) : null } catch { body = init.body }
    H.requests.push({ url: u, method, body })
    if (u.startsWith('/api/auth/me')) {
      return json({ user: { id: 7, email: 'member@uct.test', role: 'user' }, plan: 'premium' })
    }
    if (u === USER_DEFINITIONS_KEY && method === 'POST') {
      // The STORE mints the id and answers with the row; the next list read
      // carries it, exactly as the shipped route does.
      const row = {
        def_id: NEW_DEF_ID, version: 1, rev: 1, ast_hash: body.definition.compute.fn,
        definition: { ...body.definition, id: NEW_DEF_ID },
        repaint: body.definition.meta.repaint, created_at: '2026-08-21T05:00:00Z',
      }
      H.defs = { definitions: [DEF_ROW, NO_SOURCE_ROW, row] }
      return json(row)
    }
    if (u.startsWith(`${USER_DEFINITIONS_KEY}/`) && method === 'DELETE') {
      // ⛔ THE STORE IS THE ONE THAT STOPS LISTING IT — the shipped route
      // appends a tombstone and the next GET no longer carries the row. Doing
      // it HERE, inside the stub, is what makes "the row leaves" a claim about
      // the product rather than about when the test happened to edit a fixture.
      if (H.deleteRefusal) return json({ detail: H.deleteRefusal }, 404)
      const id = decodeURIComponent(u.slice(USER_DEFINITIONS_KEY.length + 1))
      H.defs = { definitions: H.defs.definitions.filter((r) => r.def_id !== id) }
      return json({ ok: true, def_id: id })
    }
    if (u.startsWith(USER_DEFINITIONS_KEY)) return json(H.defs)
    if (u.startsWith(RESULTS_ENDPOINT)) return json(nightly())
    if (u === SPY_WINDOW) return json({ ticker: 'SPY', tf: 'D', bars: spyBars() })
    return json({})
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearUserDefinitions() })

function renderScreenerPage() {
  return render(
    <MemoryRouter initialEntries={['/screener']}>
      <AuthProvider>
        <VoiceProvider>
          <SWRConfig value={{ dedupingInterval: 0 }}>
            <Screener />
          </SWRConfig>
        </VoiceProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}
const openMenu = async (user) => user.click(await screen.findByRole('button', { name: 'Screens ▾' }))
const writes = () => H.requests.filter((r) => r.method !== 'GET')

describe('🔴 the authoring door on the route a member navigates to', () => {
  it('New scan → the REAL sheet opens on Conditions → a starter → Save → ONE POST through saveUserDefinition → the new scan\'s results', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openMenu(user)
    await user.click(await screen.findByRole('button', { name: 'New scan' }))

    // ⭐ THE LAZY CHUNK RESOLVED AND THE SHEET IS ON SCREEN. Nothing in this
    // file renders a dialog; only `Sheet` (through the real `BuilderSheet`) does.
    const dialog = await screen.findByRole('dialog', {}, { timeout: 8000 })
    expect(dialog).toBeInTheDocument()
    // The door's whole promise: it opened on CONDITIONS, not the Library.
    expect(screen.getByRole('tab', { name: /conditions/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /library/i })).toHaveAttribute('aria-selected', 'false')
    // …and the concierge got a window, from the screener's own default.
    await waitFor(() => expect(H.requests.some((r) => r.url === SPY_WINDOW)).toBe(true))
    // ⭐ AND IT IS STILL ON CONDITIONS ONCE EVERY EFFECT HAS RUN. The check above
    // reads the FIRST PAINT; this one reads the settled sheet, and they are
    // different questions. Measured: with the open-reset writing a literal
    // `'library'` the first assertion passed and the member was bounced to the
    // Library a frame later, with nothing red.
    expect(screen.getByRole('tab', { name: /conditions/i })).toHaveAttribute('aria-selected', 'true')

    // A savable formula the way a member gets one without typing: the library.
    await user.click(screen.getByRole('tab', { name: /library/i }))
    // ⛔ THE STARTER IS TAKEN OFF THE SHIPPED LIST, never named here — the
    // catalogue REFUSES an entry whose frozen tree disagrees with the parser,
    // so a hand-typed name could be one this build does not ship.
    const starter = STARTER_LIST[0]
    expect(STARTERS[starter.setup]).toBe(starter)
    const cards = await screen.findAllByTestId('starter-card')
    const card = cards.find((b) => b.dataset.setup === starter.setup)
    expect(card, `no card for the shipped starter ${starter.setup}`).toBeTruthy()
    await user.click(card)
    await user.type(screen.getByLabelText('Name'), 'From the screener')
    const save = screen.getByRole('button', { name: 'Save' })
    await waitFor(() => expect(save).toBeEnabled(), { timeout: 6000 })
    await user.click(save)

    // 🔴 ONE WRITE, to the STORE's own door, carrying the tree's own hash.
    await waitFor(() => expect(writes()).toHaveLength(1), { timeout: 6000 })
    const [write] = writes()
    expect(write.url).toBe(USER_DEFINITIONS_KEY)
    expect(write.method).toBe('POST')
    expect(write.body.definition.compute.source).toBe(starter.source)
    expect(write.body.definition.compute.fn)
      .toBe(astHash(parseFormula(starter.source).ast))

    // …the sheet closed, and the NEW scan's own detail is open below.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 6000 })
    expect(await screen.findByTestId(`scan-detail-${NEW_DEF_ID}`, {}, { timeout: 8000 }))
      .toBeInTheDocument()
  }, 30000)

  it('Edit opens the SAME sheet on the row — its own source, in the box, on the Formula tab', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openMenu(user)
    await user.click(await screen.findByRole('button', { name: `Edit ${SCREEN_NAME}` }))

    await screen.findByRole('dialog', {}, { timeout: 8000 })
    // ⛔ THE SHEET'S OWN RULE WINS: an edit opens on the FORMULA, and the
    // screener does not override that with `NEW_SCAN_MODE`.
    //
    // ⛔ THE SETTLED STATE, which is what this case can honestly measure. A
    // first-paint read HERE is ORDER-DEPENDENT and I shipped one for a round:
    // measured, it reds when this file runs alone (the lazy chunk is cold, so
    // `findByRole` resolves between commit and passive-effect flush) and passes
    // when the New-scan case above has already warmed the chunk (the whole
    // mount then lands inside one `act`). A rail that is only sometimes able to
    // see the defect is the defect this file exists to prevent. The first-paint
    // claim lives in the case BELOW, where nothing can repair the mode.
    await waitFor(() => expect(screen.getByRole('tab', { name: /formula/i }))
      .toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('tab', { name: /library/i })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /conditions/i })).toHaveAttribute('aria-selected', 'false')
    // The row's OWN source is what came back — `compute.source`, not a tree
    // re-printed into text.
    expect(await screen.findByDisplayValue(SCAN_SOURCE)).toBeInTheDocument()
    // And an edit writes nothing until the member says so.
    expect(writes()).toHaveLength(0)
  }, 30000)

  // ─── ⭐ THE SEED, MEASURED WHERE NO EFFECT CAN REPAIR IT ──────────────────
  //
  // ⛔ THE EDIT DOOR IS DECIDED TWICE, AND ONLY ONE OF THE TWO IS EASY TO SEE.
  // `openForEdit` moves the sheet to the Formula, so a seed that knew nothing
  // about `editRow` still SETTLED on the right tab — it merely painted the
  // firm's starter gallery first. Every ordinary case is blind to that.
  //
  // ⭐ A ROW STORED WITHOUT ITS SOURCE TEXT IS THE DISCRIMINATOR. `openForEdit`
  // refuses it and returns BEFORE its own `setBuildMode`, so the opening mode is
  // whatever `openingMode` decided at mount and NOTHING repairs it. Measured:
  // dropping `editRow` from that rule reds this case whether the file runs alone
  // or after the case above, which is exactly what the first-paint read could
  // not promise.
  it('⭐ a row stored WITHOUT its source still opens on the Formula — the seed knew, and nothing else could have', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openMenu(user)
    await user.click(await screen.findByRole('button', { name: `Edit ${NO_SOURCE_NAME}` }))

    await screen.findByRole('dialog', {}, { timeout: 8000 })
    // the sheet's own refusal, verbatim — proof `openForEdit` took the early
    // return and therefore never touched the mode
    expect(await screen.findByText(
      'This formula was stored without its source text, so it cannot be edited here.',
    )).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /formula/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /library/i })).toHaveAttribute('aria-selected', 'false')
  }, 30000)
})

// ─── 🔴 THE ROUND TRIP: EDIT AND DELETE, ON THE REAL PAGE (W4a.6) ───────────
//
// `ScreensManager.test.jsx` drives both against a MOCKED store door, so it
// proves the manager's decision and nothing about the hop. These three render
// the real page over the real hook and a stubbed network, so what they measure
// is the wire: an edit reaching the SAME id as a new version rather than a
// second scan, a confirmed delete reaching the store's own URL exactly once,
// and — the one no mock can prove — a refusal arriving in the SERVER'S OWN
// WORDS, a string that exists nowhere on the client.
describe('🔴 Edit and Delete from the screener go through the ONE store door', () => {
  it('Edit → Save changes PUTs to the SAME id — an edit is a new VERSION, never a second scan', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openMenu(user)
    await user.click(await screen.findByRole('button', { name: `Edit ${SCREEN_NAME}` }))

    const dialog = await screen.findByRole('dialog', {}, { timeout: 8000 })
    expect(dialog).toHaveTextContent('Edit formula')
    // The row's own stored text and name came back — not a re-print of the tree.
    expect(screen.getByLabelText('Formula')).toHaveValue(SCAN_SOURCE)
    expect(screen.getByLabelText('Name')).toHaveValue(SCREEN_NAME)

    const save = screen.getByRole('button', { name: /^Save changes/ })
    await waitFor(() => expect(save).toBeEnabled(), { timeout: 6000 })
    await user.click(save)

    // 🔴 ONE WRITE, and it names the id the member opened. A POST here would
    // leave the member with two scans called the same thing and only one of
    // them edited — the failure an append-only store makes invisible.
    await waitFor(() => expect(writes()).toHaveLength(1), { timeout: 6000 })
    expect(writes()[0]).toMatchObject({ url: `${USER_DEFINITIONS_KEY}/${DEF_ID}`, method: 'PUT' })
  }, 30000)

  it('Delete asks first; Confirm issues ONE DELETE to the store and the row leaves My scans', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openMenu(user)
    await user.click(await screen.findByRole('button', { name: `Delete ${SCREEN_NAME}` }))

    // ⛔ ASKING IS NOT DELETING — nothing has left the browser.
    expect(writes()).toHaveLength(0)
    // ⛔ …and the member can tell WHAT they are about to lose.
    expect(await screen.findByTestId(`delete-ask-${DEF_ID}`))
      .toHaveTextContent(`Delete “${SCREEN_NAME}”?`)

    await user.click(screen.getByRole('button', { name: `Confirm delete ${SCREEN_NAME}` }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ url: `${USER_DEFINITIONS_KEY}/${DEF_ID}`, method: 'DELETE' })

    // ⭐ AND THE ROW LEAVES BECAUSE THE STORE'S NEXT ANSWER NO LONGER CARRIES IT
    // — the stub drops it on the DELETE, exactly as the shipped route's
    // tombstone does, and `deleteUserDefinition`'s revalidation is what brings
    // that answer back. Nothing in the client removed anything.
    await waitFor(() => expect(screen.queryByRole('button', { name: SCREEN_NAME })).toBeNull())
    // the member's OTHER scan is untouched
    expect(screen.getByRole('button', { name: NO_SOURCE_NAME })).toBeInTheDocument()
  }, 30000)

  it("⭐ a REFUSED delete reaches the member in the SERVER'S OWN WORDS, and the row stays", async () => {
    // ⛔ THIS IS THE CASE A MOCKED STORE DOOR CANNOT WRITE. `STORE_REFUSAL` is
    // put into the HTTP body and nowhere else: no component, hook or fixture
    // composes it, so the only way it can reach the DOM is by travelling the
    // whole hop — router body → `deleteUserDefinition` → the manager's alert.
    // The exact-equality assertion below then forbids anything being wrapped
    // around it on the way.
    const STORE_REFUSAL = 'Not found'
    H.deleteRefusal = STORE_REFUSAL
    const user = userEvent.setup()
    renderScreenerPage()
    await openMenu(user)
    await user.click(await screen.findByRole('button', { name: `Delete ${SCREEN_NAME}` }))
    await user.click(screen.getByRole('button', { name: `Confirm delete ${SCREEN_NAME}` }))

    const alert = await screen.findByTestId('screens-manager-error--delete')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert.textContent.trim()).toBe(STORE_REFUSAL)
    // ⛔ ONE VOICE, ONE PLACE.
    expect(screen.getAllByTestId('screens-manager-error--delete')).toHaveLength(1)
    // ⛔ AND THE MEMBER IS NOT LEFT BELIEVING IT WORKED: the scan is still there,
    // still armed, one click from a retry.
    expect(screen.getByRole('button', { name: SCREEN_NAME })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Confirm delete ${SCREEN_NAME}` })).toBeEnabled()
  }, 30000)
})

// ─── ⭐ THE ONE-WRITE-DOOR RAILS ────────────────────────────────────────────
describe('⭐ ONE builder, ONE write door', () => {
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
      const up = path.dirname(dir); if (up === dir) break; dir = up
    }
    throw new Error(`Screener.door.test: no repo root from ${process.cwd()}`)
  })()
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const walk = (n, visit) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach((x) => walk(x, visit)); return }
    if (typeof n.type === 'string') visit(n)
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, visit)
  }

  /** The module a file resolves `BuilderSheet` from — a static import OR a
   *  `lazy(() => import(...))`. */
  function builderSource(rel) {
    const tree = parse(read(rel))
    const out = []
    walk(tree, (n) => {
      if (n.type === 'ImportDeclaration'
          && n.specifiers.some((s) => s.local && s.local.name === 'BuilderSheet')) {
        out.push(n.source.value)
      }
      if (n.type === 'ImportExpression' && n.source && n.source.type === 'Literal') {
        out.push(n.source.value)
      }
    })
    const hits = out.filter((s) => /builder\/BuilderSheet$/.test(String(s)))
    expect(hits, `${rel} resolves BuilderSheet ${hits.length} times`).toHaveLength(1)
    return path.resolve(path.dirname(path.join(ROOT, rel)), `${hits[0]}.jsx`)
  }

  it('ScreensManager and ChartToolbar mount the SAME module', () => {
    expect(builderSource('app/src/pages/screener/ScreensManager.jsx'))
      .toBe(builderSource('app/src/components/chart/ChartToolbar.jsx'))
  })

  /** Every `method: '<VERB>'` a file writes into a request init. */
  function requestVerbs(rel) {
    const verbs = new Set()
    walk(parse(read(rel)), (n) => {
      if (n.type === 'Property' && n.key
          && (n.key.name === 'method' || n.key.value === 'method')
          && n.value.type === 'Literal' && typeof n.value.value === 'string') {
        verbs.add(n.value.value)
      }
    })
    return verbs
  }

  it('⭐ the DELETE goes through the store\'s own module — this file issues no verb of its own', () => {
    const tree = parse(read('app/src/pages/screener/ScreensManager.jsx'))
    const imported = {}
    walk(tree, (n) => {
      if (n.type === 'ImportDeclaration') {
        for (const sp of n.specifiers) imported[sp.local.name] = n.source.value
      }
    })
    // ⛔ ONE DOOR ONTO ONE OBJECT — the same module `BuilderSheet` deletes
    // through. Two callers with two doors end up disagreeing about what exists.
    expect(imported.deleteUserDefinition).toBe('../../hooks/useUserDefinitions')

    // ⛔ AND NOTHING DESTRUCTIVE IS SPELLED HERE. The only `fetch` in this file
    // is the concierge's bars window, a bare GET.
    expect([...requestVerbs('app/src/pages/screener/ScreensManager.jsx')]).toEqual([])
    // …non-vacuity: the SAME walk over the store's own module does find verbs,
    // so an empty set above is a fact about this file and not about the walk.
    expect([...requestVerbs('app/src/hooks/useUserDefinitions.js')]).toContain('DELETE')
  })

  it('ScreensManager imports NO save function and spells NO user-definitions URL', () => {
    const tree = parse(read('app/src/pages/screener/ScreensManager.jsx'))
    const imported = {}
    const strings = new Set()
    walk(tree, (n) => {
      if (n.type === 'ImportDeclaration') {
        for (const s of n.specifiers) imported[s.local.name] = n.source.value
      }
      if (n.type === 'Literal' && typeof n.value === 'string') strings.add(n.value)
      if (n.type === 'TemplateLiteral') n.quasis.forEach((q) => strings.add(q.value.cooked))
    })
    // ⛔ THE SHEET OWNS THE WRITE. A second save door onto one object is how two
    // callers end up disagreeing about what a definition is.
    expect(imported.saveUserDefinition).toBeUndefined()
    expect([...strings].filter((s) => s.includes('/api/user-definitions'))).toEqual([])
    expect(strings.size, 'the walk found no strings — this rail would pass on anything')
      .toBeGreaterThan(5)
  })
})
