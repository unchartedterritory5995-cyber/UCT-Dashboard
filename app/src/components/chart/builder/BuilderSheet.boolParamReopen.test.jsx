// app/src/components/chart/builder/BuilderSheet.boolParamReopen.test.jsx
//
// ─── 🎯 TRACK F v1.1 (2026-09-06) — `input.bool` THROUGH THE REAL PRODUCT UI ─
//
// The int/float half of this exact claim is already proven end to end by
// `BuilderSheet.paramReopen.test.jsx`, using `length = input(…)` inside
// `rsi(close, length)` — a window-bound length, the ONE shape Track F's own
// non-`declareInputs` translation pass can ever attach a locator through
// (see `pine.paramManifest.test.js`'s own header on why an ORDINARILY-used
// boolean gate, declared via `builderInputs.js`'s SEPARATE mechanism
// instead, never reaches ParamControls at all — that is not a gap, it is
// two different mechanisms solving two different problems).
//
// ⛔⛔ A STRUCTURAL FACT DISCOVERED WHILE BUILDING THIS FIXTURE, NOT ASSUMED:
// `interpret.js::windowLiteral` refuses ANY window/length argument, of ANY
// function, below `1` — universally, at every one of its 6 call sites in
// `interpret.js`. A boolean's fold is ALWAYS exactly `0` or `1`. So a
// boolean feeding a window slot DIRECTLY (the only shape that attaches a
// Track F locator at all — arithmetic-wrapping it, e.g. `10 + useLong`,
// verified separately to LOSE the tag, because `foldWindow` evaluates the
// whole window expression down to one fresh literal) can NEVER have both of
// its two states be a valid formula: `true` folds to a real window (`1`,
// admittedly a degenerate one-bar average, but a legal one); `false` folds
// to `0`, which `windowLiteral` refuses outright. This is not a Track F
// defect — it is the SAME safety net ("conflicts... disable editing rather
// than silently applying the wrong parameter") this whole tranche's own
// instructions asked to be verified, just tripped by a DOWNSTREAM engine
// constraint rather than a manifest-level one. Proven below, honestly, as
// TWO separate claims: the happy path (an edit that stays valid persists
// correctly) and the safety net (one that doesn't is refused, not
// corrupted) — rather than forcing a single "toggle round-trips" narrative
// a real script of this exact shape cannot support.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { reconcileParams } from './paramEdit'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { AuthContext } from '../../../context/AuthContext'

// A minimal, first-party reduction — NOT realistic Pine (a boolean is not a
// meaningful moving-average length), deliberately: this fixture exists to
// exercise Track F's OWN mechanism in isolation, exactly as the instructions
// authorizing this tranche called for. Real-world public-script evidence for
// the underlying eligibility decision (an ORDINARY boolean toggle) is
// `18-minervini-trend-template.pine`/`27-support-resistance-channels.pine`,
// proven separately in `pineBoxDownstreamScope.test.jsx` and
// `COMPATIBILITY_REMEDIATION_TRANCHE_1.md`.
const BOOL_FIXTURE = `//@version=5
indicator("Use Long SMA")
useLong = input.bool(true, "Use Long Length")
plot(sma(close, useLong))
`

const H = vi.hoisted(() => ({ requests: [], store: new Map(), counter: 0 }))

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
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const flushSwr = async () => {
  await act(async () => { vi.advanceTimersByTime(1000) })
  await flush()
}

const noop = () => {}

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

describe('a window-bound input.bool through the real "Your formulas" reopen door', () => {
  it('⭐⭐⭐ import -> default ON -> save -> close -> reopen -> attached checkbox at the saved value, restored from compute.paramManifest/paramState', async () => {
    // ── 1. Import, save ──────────────────────────────────────────────────
    mountFresh()
    await flush()
    await paste(BOOL_FIXTURE)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()

    expect(formulaField().value).toBe('sma(close, 1)')
    expect(screen.getByText('Adjustable parameters')).toBeTruthy()
    const checkbox = () => screen.getByTestId('param-input-__uct_param_1')
    expect(checkbox().checked).toBe(true)
    expect(screen.getByText('default On')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bool Reopen Test' } })
    await settleFormula()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await flush()

    const firstPost = H.requests.find((r) => r.method === 'POST' && r.url === '/api/user-definitions')
    expect(firstPost, 'the create POST never fired').toBeTruthy()
    expect(H.store.size).toBe(1)
    const [, firstRow] = [...H.store.entries()][0]
    expect(firstRow.definition.compute.source).toBe('sma(close, 1)')
    expect(firstRow.definition.compute.paramManifest.__uct_param_1).toMatchObject({
      type: 'bool', default: 1, sourceName: 'useLong',
    })
    expect(firstRow.definition.compute.paramState.__uct_param_1).toEqual({ state: 'attached', value: 1, reason: null })

    // ── 2. Genuine unmount ───────────────────────────────────────────────
    cleanup()

    // ── 3. Reopen through the real "Your formulas" door ─────────────────
    mountFresh()
    await flushSwr()
    const savedRow = screen.getByText('Bool Reopen Test')
    const listRow = savedRow.closest('li')
    expect(listRow, '"Your formulas" did not render the saved row').toBeTruthy()
    fireEvent.click(within(listRow).getByRole('button', { name: /^Edit Bool Reopen Test$/i }))
    await settleFormula()

    expect(formulaField().value).toBe('sma(close, 1)')
    expect(screen.getByText('Adjustable parameters')).toBeTruthy()
    expect(checkbox().checked).toBe(true)
    // ⛔ NO RAW BINDING ID SHOWN — the control is titled by the manifest's
    // own `title`, never its `__uct_param_<n>` key (same requirement the
    // int/float golden journey already pins).
    expect(screen.queryByText(/__uct_param/)).toBeNull()
    expect(screen.getByText('Use Long Length')).toBeTruthy()
  })

  it('⭐⭐ toggling the checkbox updates the formula live; a structurally-invalid result correctly DISABLES Save rather than corrupting anything', async () => {
    // ⚰️ THIS TEST'S OWN FIRST DRAFT expected a click → Save → PUT → reopen
    // → persisted round trip, mirroring the int/float golden journey
    // exactly. Running it found the structural fact this file's header now
    // records: `useLong`'s FALSE state folds to `sma(close, 0)`, and
    // `windowLiteral` refuses ANY window argument below 1, universally.
    // The corrected claim, proven here instead, is the one this whole
    // tranche's own instructions actually asked for: a conflicting/invalid
    // edit disables editing rather than silently applying the wrong thing —
    // this is that same safety property, tripped by a downstream engine
    // constraint instead of a manifest-level one, and it is the CORRECT
    // outcome, not a Track F gap.
    mountFresh()
    await flush()
    await paste(BOOL_FIXTURE)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bool Toggle Test' } })
    await settleFormula()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await flush()
    expect(H.store.size).toBe(1)

    // ⛔ REOPENED THROUGH THE REAL DOOR before touching the checkbox — a
    // fresh create-only session's `editing` state stays null (a second
    // "Save" click there would POST a SECOND definition, not PUT the first
    // one — pre-existing, unrelated BuilderSheet behaviour, not something
    // this tranche touches or needs to change). Reopening is what makes the
    // REST of this test's "Save changes" actually update the same row,
    // exactly as `BuilderSheet.paramReopen.test.jsx`'s own int/float journey
    // already requires for the identical reason.
    cleanup()
    mountFresh()
    await flushSwr()
    const row = screen.getByText('Bool Toggle Test').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: /^Edit Bool Toggle Test$/i }))
    await settleFormula()

    const checkbox = () => screen.getByTestId('param-input-__uct_param_1')
    expect(checkbox().checked).toBe(true)

    // ⭐ THE WIRING WORKS: the click reaches applyParamEdit, which reaches
    // printFormula, which reaches FormulaField's own debounced re-evaluate —
    // the formula text genuinely changes.
    fireEvent.click(checkbox())
    await settleFormula()
    expect(formulaField().value).toBe('sma(close, 0)')

    // ⛔⛔ AND SAVE IS CORRECTLY SHUT — no silent corruption, no partial
    // write, exactly `canSaveFormula`'s existing, unrelated gate (this
    // tranche changes nothing about it) already guarantees for any other
    // engine-invalid formula.
    expect(screen.getByRole('button', { name: /^save/i }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    await flush()
    expect(H.requests.find((r) => r.method === 'PUT'), 'no PUT may fire for an invalid formula').toBeUndefined()

    // ⭐ AND IT SELF-CORRECTS: toggling back restores validity and Save.
    fireEvent.click(checkbox())
    await settleFormula()
    expect(formulaField().value).toBe('sma(close, 1)')
    expect(screen.getByRole('button', { name: /^save/i }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    await flush()
    const putReq = H.requests.find((r) => r.method === 'PUT')
    expect(putReq, 'the correcting PUT never fired').toBeTruthy()
    expect(JSON.parse(putReq.body).definition.compute.source).toBe('sma(close, 1)')
  })

  it('⭐ "Reset to Default" works for a bool exactly as it does for int/float — not a special code path', async () => {
    mountFresh()
    await flush()
    await paste(BOOL_FIXTURE)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    // The default IS the current value here (fresh import), so no Reset
    // button is offered yet — matching `ParamControls.jsx`'s own "at the
    // default value, no reset button" rule, already pinned for int/float.
    expect(screen.queryByTestId('param-reset-__uct_param_1')).toBeNull()
  })
})
