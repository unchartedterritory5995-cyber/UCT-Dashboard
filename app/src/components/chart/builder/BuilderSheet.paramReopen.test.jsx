// app/src/components/chart/builder/BuilderSheet.paramReopen.test.jsx
//
// ─── 🔴 THE WIRE-CUT FILE FOR REOPENING A SAVED PARAMETERIZED DEFINITION ────
//
// Owner's Track F follow-up (2026-09-05): "a member who imported a Pine
// indicator, saved it, later reopens that saved definition, and wants to
// continue tuning its supported parameters should see the same ParamControls
// and be able to change them through the already-proven save/validation
// path." This file drives that claim end to end, through the REAL product
// UI, exactly the way `BuilderSheet.pine.test.jsx` already drives the
// paste-and-save half — same "wire, not the parts" discipline: nothing on
// the path under test is mocked except `fetch` itself.
//
// ⭐⭐ THE DOOR THIS FILE PROVES EXISTS: "Your formulas" (BuilderSheet.jsx's
// own `rows.map(...)`, fed by the real `useUserDefinitions()` hook), a
// pencil-icon `Edit <name>` button that calls the sheet's own `openForEdit`.
// This door was ALREADY WIRED (`openForEdit` already restores `compute.
// paramManifest` into state, from the same commit that first wired
// ParamControls into the create flow) -- what was missing was proof it
// actually works, and a permanent regression protecting it. Found by
// grepping this file's own `openForEdit`/`rows` wiring after a live browser
// search of the Indicators dialog, the per-instance IndicatorSettingsDialog,
// the legend right-click menu, and the Screener's "My Scans" list all failed
// to locate the door -- it was one scroll further down the SAME "New
// formula" dialog the whole time, past the Save/Cancel buttons.
//
// ⛔ A STATEFUL FETCH MOCK, NOT THE TRIVIAL ALWAYS-EMPTY ONE
// `BuilderSheet.pine.test.jsx` uses. Proving "reopen shows the persisted
// value" requires a POST to actually be visible to a LATER GET -- an
// in-memory row store standing in for `api/services/user_definitions.py`,
// echoing back what the client submitted (this file tests the FRONTEND'S
// wiring; the 21 tests in `tests/test_param_manifest.py` already prove the
// server's own canonicalize-from-`prev`/reject-not-clamp enforcement, and
// this file does not re-derive that logic).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { reconcileParams } from './paramEdit'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { AuthContext } from '../../../context/AuthContext'

// ─── the real RSI fixture, verbatim -- the SAME script the golden journey
// and the original Core Golden Journey #1 both use, never retyped by hand
// from a paraphrase. ───────────────────────────────────────────────────────
const RSI_FIXTURE = `//@version=3
study(title="Relative Strength Index", shorttitle="RSI")

length = input(title="Length", type=integer, defval=14)
rsi = rsi(close, length)
plot(rsi, title="RSI", linewidth=2)
`

const H = vi.hoisted(() => ({ requests: [], store: new Map(), counter: 0 }))

/** A stateful stand-in for `api/routers/user_definitions.py`. POST mints a
 *  row and stores it; PUT updates the stored row by def_id; GET returns
 *  every stored row -- so a save genuinely becomes visible to the NEXT
 *  mount's own `useUserDefinitions()` fetch, the same way a real reload
 *  would see the real database. `paramState` is computed via the SAME
 *  `reconcileParams` `ParamControls` itself reads (not re-derived by hand),
 *  mirroring what the real server computes at save time. */
function stubStatefulFetch() {
  H.requests = []
  H.store = new Map()
  H.counter = 0
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const u = String(url)
    H.requests.push({ url: u, method, body: init.body ?? null })

    if (method === 'GET' && u.startsWith('/api/user-definitions')) {
      return { ok: true, status: 200, json: async () => ({ definitions: [...H.store.values()] }) }
    }
    if (method === 'POST' && u === '/api/user-definitions') {
      const { definition } = JSON.parse(init.body)
      H.counter += 1
      const defId = `u_${String(H.counter).padStart(12, '0')}`
      const compute = { ...definition.compute }
      if (compute.paramManifest) compute.paramState = reconcileParams({ compute })
      const row = {
        def_id: defId, version: 1, rev: 1, ast_hash: compute.fn,
        definition: { ...definition, id: defId, compute }, created_at: Date.now(),
      }
      H.store.set(defId, row)
      return { ok: true, status: 200, json: async () => row }
    }
    if (method === 'PUT' && u.startsWith('/api/user-definitions/')) {
      const defId = decodeURIComponent(u.slice('/api/user-definitions/'.length))
      const prior = H.store.get(defId)
      const { definition } = JSON.parse(init.body)
      const compute = { ...definition.compute }
      if (compute.paramManifest) compute.paramState = reconcileParams({ compute })
      const row = {
        def_id: defId, version: (prior?.version || 1) + 1, rev: 1, ast_hash: compute.fn,
        definition: { ...definition, id: defId, compute }, created_at: prior?.created_at || Date.now(),
      }
      H.store.set(defId, row)
      return { ok: true, status: 200, json: async () => row }
    }
    // META_KEY and anything else this path touches but does not depend on.
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

// ⛔ `getByText`/`getByRole`, NEVER `findByText`/`findByRole` — this file runs
// under fake timers to drive both debounces (`BuilderSheet.pine.test.jsx`'s
// own rule, restated here because this file needs it for a THIRD reason:
// `findBy*`'s internal `waitFor` polls on a REAL timer, which fake timers
// freeze forever). `flushSwr` advances fake time too, in case SWR's own
// revalidation scheduling uses a timer internally, THEN flushes microtasks —
// so a synchronous `getByText` after it sees the settled DOM either way.
const flushSwr = async () => {
  await act(async () => { vi.advanceTimersByTime(1000) })
  await flush()
}

const noop = () => {}

/** A FRESH render with a FRESH SWR cache each time -- simulating a real
 *  close-and-reopen (or a page reload), never a cache the previous mount's
 *  save already warmed in place. */
function mountFresh() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const formulaField = () => screen.getByLabelText('Formula')
const pineField = () => screen.getByTestId('pine-box').querySelector('textarea')
const tab = (name) => screen.getByRole('tab', { name })

async function settlePine() {
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

async function settleFormula() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

async function paste(script) {
  fireEvent.click(tab(/^import$/i))
  fireEvent.change(pineField(), { target: { value: script } })
  await settlePine()
}

beforeEach(() => {
  vi.useFakeTimers()
  stubStatefulFetch()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reopening a saved Pine-parameterized definition through the real "Your formulas" door', () => {
  it('⭐⭐⭐ import -> save -> close -> reopen -> parameter present at the saved value -> change -> save -> reload -> persisted', async () => {
    // ── 1. Import the real RSI fixture and save it ──────────────────────
    mountFresh()
    await flush()
    await paste(RSI_FIXTURE)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()

    // The formula is exactly what Core Golden Journey #1 and the Track F
    // golden-journey rerun both observed.
    expect(formulaField().value).toBe('rsi(close, 14)')

    // ⭐⭐ TRACK F's OWN CONTROL IS ALREADY LIVE IN THE CREATE FLOW, before
    // any save -- this is the create-time half already proven in
    // TRACK_F_V1_IMPLEMENTATION_COMPLETION_REPORT.md §6; asserted again here
    // only as the starting condition the rest of this test depends on.
    expect(screen.getByText('Adjustable parameters')).toBeTruthy()
    expect(screen.getByTestId('param-input-__uct_param_1')).toHaveValue(14)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'RSI Reopen Test' } })
    await settleFormula()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await flush()

    const firstPost = H.requests.find((r) => r.method === 'POST' && r.url === '/api/user-definitions')
    expect(firstPost, 'the create POST never fired').toBeTruthy()
    expect(H.store.size).toBe(1)
    const [defId, firstRow] = [...H.store.entries()][0]
    expect(firstRow.definition.compute.source).toBe('rsi(close, 14)')
    expect(firstRow.definition.compute.paramManifest.__uct_param_1).toMatchObject({ default: 14, sourceName: 'length' })
    expect(firstRow.definition.compute.paramState.__uct_param_1).toEqual({ state: 'attached', value: 14, reason: null })

    // ── 2. Leave the builder -- a genuine unmount, not a hidden dialog ──
    cleanup()

    // ── 3. Reopen through the real product UI: a fresh mount (fresh SWR
    //        cache, exactly like a real reload) fetches "Your formulas" from
    //        the (now populated) store and the member clicks the real Edit
    //        pencil -- `BuilderSheet.jsx`'s own `openForEdit`. ────────────
    mountFresh()
    await flushSwr()
    const savedRow = screen.getByText('RSI Reopen Test')
    const listRow = savedRow.closest('li')
    expect(listRow, '"Your formulas" did not render the saved row').toBeTruthy()
    fireEvent.click(within(listRow).getByRole('button', { name: /^Edit RSI Reopen Test$/i }))
    await settleFormula()

    // The reopened formula is the persisted one, and the parameter panel
    // shows the SAVED value, restored from `compute.paramManifest`/
    // `paramState` -- not re-derived from a Pine re-translation (none
    // happens; no Pine text was ever persisted).
    expect(formulaField().value).toBe('rsi(close, 14)')
    expect(screen.getByText('Adjustable parameters')).toBeTruthy()
    expect(screen.getByTestId('param-input-__uct_param_1')).toHaveValue(14)
    // ⛔ NO RAW BINDING ID IS SHOWN TO THE MEMBER (owner requirement #9) --
    // the control is titled by the manifest's own `title`, never by its
    // `__uct_param_<n>` key.
    expect(screen.queryByText(/__uct_param/)).toBeNull()
    expect(screen.getByText('Length')).toBeTruthy()

    // ── 4. Change the parameter again, through ParamControls, then Save.
    fireEvent.change(screen.getByTestId('param-input-__uct_param_1'), { target: { value: '30' } })
    fireEvent.blur(screen.getByTestId('param-input-__uct_param_1'))
    await settleFormula()
    expect(formulaField().value).toBe('rsi(close, 30)')

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await flush()

    const putReq = H.requests.find((r) => r.method === 'PUT')
    expect(putReq, 'the edit PUT never fired').toBeTruthy()
    expect(putReq.url).toBe(`/api/user-definitions/${defId}`)
    const putBody = JSON.parse(putReq.body).definition
    expect(putBody.compute.source).toBe('rsi(close, 30)')
    expect(putBody.compute.paramManifest.__uct_param_1.default).toBe(14) // immutable, unchanged
    expect(H.store.get(defId).definition.compute.paramState.__uct_param_1.value).toBe(30)

    // ── 5. Reload again -- a second fresh mount -- and confirm the SECOND
    //        edit persisted, not just the first. ───────────────────────
    cleanup()
    mountFresh()
    await flushSwr()
    const savedRow2 = screen.getByText('RSI Reopen Test')
    fireEvent.click(within(savedRow2.closest('li')).getByRole('button', { name: /^Edit RSI Reopen Test$/i }))
    await settleFormula()
    expect(formulaField().value).toBe('rsi(close, 30)')
    expect(screen.getByTestId('param-input-__uct_param_1')).toHaveValue(30)
  })
})
