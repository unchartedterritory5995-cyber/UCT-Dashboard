// app/src/components/chart/builder/BuilderSheet.siblingInputUnion.test.jsx
//
// ─── ⭐⭐ C0R MECHANISM B, THE RECEIVING HALF ────────────────────────────────
//
// `PineBox` now hands every carried output the inputs its own formula names
// (`pineBoxSiblingInputs.test.jsx` pins that side). This is the other half: the
// sheet must DECLARE the union, or a sibling row's formula still reaches Save
// naming a symbol the document does not carry — which is the C0 SAVE_BLOCKED
// state, moved one module along rather than fixed.
//
// ⛔ THE UNION IS OVER THE ROWS THE SHEET ACTUALLY CARRIES. An output past
// `CARRY_MAX` is not in the document, so declaring its inputs would hand the
// member a knob that moves nothing — the same "half-applied control" this
// builder already refuses in the other direction.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'

// Two plots. The SELECTED column names `alpha`; the sibling names `bandMult` and
// nothing else does. Before C0R, `bandMult` reached the sheet as a formula with no
// input behind it.
//
// ⚠️ THE SIBLING'S KEY IS `bandMult` AND NOT THE OBVIOUS `beta`. `beta` is a REAL
// scalar this engine computes, so the sheet refuses it as a member-input key —
// correctly, and with its own sentence — and the row lands red for a reason that
// has nothing to do with what this file tests. A fixture name that trips a
// different guard measures that guard, not this one.
const HANDBACK = {
  source: 'close * alpha',
  inputs: [{ key: 'alpha', type: 'float', label: 'Alpha', default: 2 }],
  outputs: [
    { source: 'close * alpha', title: 'Primary', presentation: {},
      inputs: [{ key: 'alpha', type: 'float', label: 'Alpha', default: 2 }] },
    { source: 'close * bandMult', title: 'Sibling', presentation: {},
      inputs: [{ key: 'bandMult', type: 'float', label: 'Band mult', default: 3 }] },
  ],
}

vi.mock('./PineBox', () => {
  const Fake = ({ onPick }) => (
    <button type="button" data-testid="fake-pine-use" onClick={() => onPick(HANDBACK)}>use</button>
  )
  return {
    __esModule: true,
    PINE_DEBOUNCE_MS: 250,
    ImportBox: (props) => <Fake {...props} />,
    default: Fake,
  }
})

const H = vi.hoisted(() => ({ requests: [] }))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_bbbbbbbbbbbb', version: 1, rev: 1 }) }
  })
})
afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks() })

async function mount() {
  render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  await act(async () => { await Promise.resolve() })
  fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
}

// ⛔ TWO CYCLES, AND THE SECOND IS NOT PADDING. The import writes the member
// inputs, which changes `inputScope`; every plot row's `FormulaField` only
// re-evaluates against that new scope on its NEXT debounce. One cycle leaves the
// sibling row holding a verdict computed before `bandMult` was declared — which
// reads exactly like the bug this file exists to catch.
const settle = async () => {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
  }
}

const inputNames = () => [...document.querySelectorAll('input')]
  .filter((i) => /^Input \d+ name$/.test(i.getAttribute('aria-label') || ''))
  .map((i) => i.value)

describe('the sheet declares the inputs of EVERY carried plot row', () => {
  it('⭐⭐ a sibling row\'s input becomes a declared member input', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-use')) })
    await settle()
    const names = inputNames()
    expect(names).toContain('alpha')
    // ⛔ THE ONE THAT USED TO BE MISSING.
    expect(names).toContain('bandMult')
  })

  it('⭐⭐ the sibling row\'s formula RESOLVES — the read-back is the proof, not the form', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-use')) })
    await settle()
    // A plot row read-back exists only when every name in that row's formula
    // resolves. `plot-readback-2` is the sibling.
    const rb = screen.queryByTestId('plot-readback-2')
    expect(rb, 'the sibling plot row should have a read-back').toBeTruthy()
    expect(rb.textContent).toMatch(/bandMult/)
    expect(screen.queryByTestId('plot-problem-2')).toBeNull()
  })

  it('⭐ and both reach the SAVED DOCUMENT', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-use')) })
    await settle()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Union' } })
    })
    await settle()
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save.disabled).toBe(false)
    await act(async () => { fireEvent.click(save) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const post = H.requests.find((r) => r.method === 'POST')
    expect(post, 'a definition should have been POSTed').toBeTruthy()
    const doc = JSON.parse(post.body).definition
    const keys = (doc.inputs || []).map((i) => i.key)
    expect(keys).toContain('alpha')
    expect(keys).toContain('bandMult')
  })
})
