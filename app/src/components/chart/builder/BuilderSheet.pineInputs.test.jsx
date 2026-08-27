// 🔴 THE SHEET'S HALF OF THE PINE-INPUTS CONTRACT (W1b.9).
//
// `inputsFromFolded` decides WHICH of a pasted script's inputs can become member
// inputs (`builderInputs.test.js` drives that door, both directions). This file
// drives the other half: the sheet accepting them, landing them as real rows
// BEFORE the source, and carrying them into the saved document.
//
// ⚠️ THIS FILE MOCKS `PineBox` ON PURPOSE, AND SAYS SO. The "Keep as inputs"
// toggle that would call `inputsFromFolded` and hand the sheet `{source, inputs}`
// is a W3 hand-back that does not exist yet — so the wire under test is the
// SHEET'S handling of that shape, not the box's. `BuilderSheet.pine.test.jsx`
// keeps driving the REAL box for the string form, so the un-mocked path never
// loses its rail; the two files fail for different reasons and both are needed.
//
// ⛔ AND THE FORMULA HERE IS ONE THIS ENGINE CAN ACTUALLY EVALUATE WITH THOSE
// INPUTS DECLARED. `sma(close, len)` cannot be — `interpret.js::windowLiteral`
// refuses a window that is not a whole-number literal — so a test written around
// a declared LENGTH would be asserting a product that cannot ship. The inputs
// below are a THRESHOLD and a MULTIPLIER, the two positions this engine takes a
// number from an input in, and both are real: `input.int(60, "Over Bought Level
// 1")` from `pine_community/02-wavetrend-oscillator-lazybear.pine` and
// `input.float(2, "Bollinger Band Standard Devaition Up")` from
// `pine_community/03-cm-williams-vix-fix.pine`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'

const PICKED = {
  source: 'rsi(close, 14) > overbought && close > sma(close, 20) + stdev(close, 20) * mult',
  inputs: [
    { key: 'overbought', type: 'int', label: 'Over Bought', default: 60, min: 1 },
    { key: 'mult', type: 'float', label: 'Mult', default: 2.5 },
  ],
}

vi.mock('./PineBox', () => {
  const Fake = ({ onPick }) => (
    <button
      type="button"
      data-testid="fake-pine-use"
      onClick={() => onPick({
        source: 'rsi(close, 14) > overbought && close > sma(close, 20) + stdev(close, 20) * mult',
        inputs: [
          { key: 'overbought', type: 'int', label: 'Over Bought', default: 60, min: 1 },
          { key: 'mult', type: 'float', label: 'Mult', default: 2.5 },
        ],
      })}
    >use</button>
  )
  const Plain = ({ onPick }) => (
    <button type="button" data-testid="fake-pine-plain" onClick={() => onPick('close * 2')}>plain</button>
  )
  return {
    __esModule: true,
    PINE_DEBOUNCE_MS: 250,
    ImportBox: (props) => (
      <div>
        <Fake {...props} />
        <Plain {...props} />
      </div>
    ),
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
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
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

const settle = async () => {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('the sheet takes a pasted script\'s declared inputs', () => {
  it('🔴 "Use this formula" with inputs declares the rows INTO THE SCOPE, so the read-back resolves them', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-use')) })
    await settle()

    expect(screen.getByLabelText('Formula').value).toBe(PICKED.source)
    expect(screen.getByLabelText('Input 1 name').value).toBe('overbought')
    expect(screen.getByLabelText('Input 2 name').value).toBe('mult')
    // ⭐ THE WIRE, MEASURED WHERE IT CAN BE SEEN. A read-back exists ONLY when
    // every name in the formula resolves, so this is the assertion that proves
    // the rows reached the SCOPE and not merely the form. ⚠️ It does NOT pin the
    // ORDER of the two writes: swapping them moves nothing (`differing=0`,
    // mutation M11) because React batches both into one commit — the sheet says
    // so at the call site rather than letting this read as a rail on ordering.
    expect(screen.getByTestId('readback').textContent).toMatch(/overbought/)
    expect(screen.getByTestId('readback').textContent).toMatch(/mult/)
    // ⛔ AND NO ROW IS INVALID — an input the sheet's own `inputKeyProblem`
    // refuses would block Save while looking perfectly landed.
    expect(screen.queryByTestId('member-input-problem-0')).toBeNull()
    expect(screen.queryByTestId('member-input-problem-1')).toBeNull()
  })

  it('🔴 the declared rows reach the SAVED DOCUMENT, defaults and labels intact', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-use')) })
    await settle()
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Pine inputs' } })
    })
    await settle()
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save.disabled, 'a document with pasted inputs must be saveable').toBe(false)
    await act(async () => { fireEvent.click(save) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const post = H.requests.find((r) => r.method === 'POST')
    expect(post, 'nothing was written').toBeTruthy()
    const sent = JSON.parse(post.body).definition
    expect(sent.inputs.map((i) => i.key)).toEqual(['color', 'lineWidth', 'overbought', 'mult'])
    expect(sent.inputs.find((i) => i.key === 'overbought'))
      .toEqual({ key: 'overbought', type: 'int', label: 'Over Bought', default: 60, min: 1 })
    expect(sent.inputs.find((i) => i.key === 'mult'))
      .toEqual({ key: 'mult', type: 'float', label: 'Mult', default: 2.5 })
  })

  it('⛔ the STRING form is byte-for-byte what it was — this widened the door, it did not move it', async () => {
    // ⭐ THE OTHER DIRECTION OF THE SAME WIRE. `onPick` now takes two shapes;
    // a change that handled only the object would leave every shipped caller
    // (`StarterLibrary` sends a string too) writing `[object Object]` into the
    // formula box, and nothing else in this file would notice.
    await mount()
    await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-plain')) })
    await settle()
    expect(screen.getByLabelText('Formula').value).toBe('close * 2')
    expect(screen.getByTestId('no-inputs'), 'a string pick declares nothing').toBeTruthy()
  })

  it('⛔ a second pick REPLACES a same-keyed row rather than declaring it twice', async () => {
    // `defSchema.validateInput` refuses a duplicate key outright, so appending
    // blindly would make the second paste of the same script unsaveable.
    await mount()
    await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-use')) })
    await settle()
    // ⭐ THE PICK LANDS THE MEMBER ON THE FORMULA TAB, so a second paste means
    // walking back through the Import tab — the same gesture a member makes.
    fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
    await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-use')) })
    await settle()
    expect(screen.getAllByLabelText(/^Input \d+ name$/).map((el) => el.value))
      .toEqual(['overbought', 'mult'])
  })
})
