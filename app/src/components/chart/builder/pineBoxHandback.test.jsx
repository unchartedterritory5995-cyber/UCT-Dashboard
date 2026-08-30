// app/src/components/chart/builder/pineBoxHandback.test.jsx
//
// ─── 🔴 THE WIRE, NOT THE PARTS ──────────────────────────────────────────────
//
// `BuilderSheet` has branched on a `{source, inputs}` hand-back since W1b.9, and
// until this landed the ONLY thing in the repository that ever produced one was
// a `vi.mock('./PineBox')` inside `BuilderSheet.pineInputs.test.jsx`. Consumer
// green, producer absent — the exact shape this repo keeps rediscovering, and the
// reason a component test cannot stand in for a wire test.
//
// ⛔ SO THIS FILE MOCKS NOTHING ON THE PATH. It renders the REAL `PineBox`,
// types a REAL script into it, clicks the REAL button, and asserts on what the
// component actually handed back. If `use()` reverts to passing a bare string,
// every other test in the builder suite stays green and this one goes red.
//
// ⭐ AND IT ASSERTS THE HALF THAT IS EASY TO GET WRONG. A paste with no
// declarable input must keep handing back a STRING, byte for byte, because
// `StarterLibrary` and the older callers depend on that shape. A feature that
// "worked" by converting every hand-back into an object would pass a naive
// version of this file and change a contract nobody asked to change.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

import PineBox from './PineBox'

const type = (text) => {
  // ⛔ THE TEXTAREA BY NAME, NOT "the textbox". Once a numeric column is on
  // screen the box also renders the screen-threshold field, so a bare
  // `getByRole('textbox')` throws "found multiple" on the SECOND paste — which is
  // exactly the case a re-paste test exists to cover.
  const area = screen.getByLabelText(/^(pine script|script or formula)$/i)
  fireEvent.change(area, { target: { value: text } })
}

const clickUse = async () => {
  const btn = await screen.findByRole('button', { name: /use this formula/i })
  fireEvent.click(btn)
}

beforeEach(() => { cleanup(); vi.useRealTimers() })

const SCRIPT_WITH_KNOB = `//@version=5
indicator("t")
th = input.int(30, "RSI level")
plot(ta.rsi(close, 14) < th ? 1 : 0)
`

const SCRIPT_WINDOW_ONLY = `//@version=5
indicator("t")
len = input.int(14, "Length")
plot(ta.sma(close, len))
`

const SCRIPT_NO_INPUTS = `//@version=5
indicator("t")
plot(ta.sma(close, 20))
`

describe("the paste box hands the sheet the author's knobs", () => {
  it('⭐⭐ a declarable input produces the OBJECT form, with its row', async () => {
    const onPick = vi.fn()
    render(<PineBox onPick={onPick} />)
    type(SCRIPT_WITH_KNOB)
    await clickUse()

    expect(onPick).toHaveBeenCalledTimes(1)
    const handed = onPick.mock.calls[0][0]
    // ⛔ THE SHAPE IS THE ASSERTION. A string here is the old behaviour, and it
    // is what every other test in this directory would still accept.
    expect(typeof handed).toBe('object')
    expect(handed.source).toBe('rsi(close, 14) < th ? 1 : 0')
    expect(handed.inputs).toEqual([
      { key: 'th', type: 'int', label: 'RSI level', default: 30 },
    ])
  })

  it('⭐ …and the box SAYS the knob came across, in the member`s own words', async () => {
    render(<PineBox onPick={vi.fn()} />)
    type(SCRIPT_WITH_KNOB)
    const kept = await screen.findByTestId('pine-inputs-kept')
    expect(kept).toHaveTextContent('Inputs you can change later')
    expect(kept).toHaveTextContent('RSI level = 30')
    // ⛔ AND IT DOES NOT ALSO CLAIM THE INPUT IS FIXED. The old note printed
    // EVERY folded entry under "Inputs are fixed at their defaults" — true while
    // nothing could be declared, and a false sentence the moment one could: a
    // member would read that about a control sitting live in their own settings.
    expect(screen.queryByTestId('pine-inputs-folded')).toBeNull()
  })

  it('⭐⭐ a WINDOW input arrives as a FIELD, seeded with the author\'s number', async () => {
    // ⚰️ THIS TEST USED TO ASSERT THE OPPOSITE — that the box says *"Fixed at
    // their defaults … a length cannot be a member input in this engine, so it
    // stays as written"*. Every word of that was true of the ENGINE and it was the
    // wrong thing to say to a member, because `translatePine`'s `inputValues`
    // could already set the length before translation and nothing in the product
    // called it. Measured: 21 of the 43 corpus scripts that translate lose at
    // least one length this way. The sentence was accurate and the door was
    // missing; this is the door.
    const onPick = vi.fn()
    render(<PineBox onPick={onPick} />)
    type(SCRIPT_WINDOW_ONLY)
    const field = await screen.findByTestId('pine-length-len')
    expect(field).toHaveValue(null)
    expect(field.placeholder).toBe('14')
    // ⛔ AND THE BOX NO LONGER CALLS IT FIXED. A member reading "fixed at its
    // default" about a control sitting live on the same screen is reading a false
    // sentence about what is in front of them — the identical defect the note on
    // this paragraph already records once.
    expect(screen.queryByTestId('pine-inputs-folded')).toBeNull()
    expect(screen.queryByTestId('pine-inputs-kept')).toBeNull()

    await clickUse()
    // ⛔ UNTOUCHED, THE OLD CONTRACT HOLDS BYTE FOR BYTE. A length is not a
    // declarable input, so nothing declarable exists and the hand-back is a STRING
    // — which is what `StarterLibrary` and every older caller depend on.
    expect(typeof onPick.mock.calls[0][0]).toBe('string')
    expect(onPick.mock.calls[0][0]).toBe('sma(close, 14)')
  })

  it('⭐⭐ …and typing in it re-folds the formula the member will save', async () => {
    // ⛔⛔ THE LOAD-BEARING ASSERTION OF THE WHOLE FEATURE. Rendering a field that
    // does not reach the translator is the "built, tested, green and unreachable"
    // shape this file was written against in the first place — so this asserts the
    // FORMULA, through the real button, not that an input exists.
    const onPick = vi.fn()
    render(<PineBox onPick={onPick} />)
    type(SCRIPT_WINDOW_ONLY)
    fireEvent.change(await screen.findByTestId('pine-length-len'), { target: { value: '50' } })
    await waitFor(() => expect(screen.getByTestId('pine-formula-0')).toHaveTextContent('sma(close, 50)'))
    // ⭐ THE AUTHOR'S NUMBER STAYS VISIBLE. Without it the member cannot check
    // their own screen against the script they copied.
    expect(screen.getByTestId('pine-length-was-len')).toHaveTextContent('was 14')
    await clickUse()
    expect(onPick.mock.calls[0][0]).toBe('sma(close, 50)')
  })

  it('⛔⛔ CLEARING the field returns to the author\'s length — blank is not zero', async () => {
    // ⚰️ `Number('')` IS `0`, NOT `NaN`. A blank field forwarded as a value would
    // hand `sma(close, 0)` to the engine under the member's own title. Blank means
    // "leave the author's alone", and this is the rail on that.
    const onPick = vi.fn()
    render(<PineBox onPick={onPick} />)
    type(SCRIPT_WINDOW_ONLY)
    const field = await screen.findByTestId('pine-length-len')
    fireEvent.change(field, { target: { value: '50' } })
    await waitFor(() => expect(screen.getByTestId('pine-formula-0')).toHaveTextContent('sma(close, 50)'))
    fireEvent.change(field, { target: { value: '' } })
    await waitFor(() => expect(screen.getByTestId('pine-formula-0')).toHaveTextContent('sma(close, 14)'))
    await clickUse()
    expect(onPick.mock.calls[0][0]).toBe('sma(close, 14)')
  })

  it('⛔⛔ a length OUTSIDE the author\'s bounds REFUSES, and the field stays', async () => {
    // ⭐ THE ENGINE ALREADY REFUSES RATHER THAN CLAMPS (`pine.knob.test.js`), and
    // what this box owes is that the refusal is VISIBLE and the control that
    // caused it is still on screen to correct. Rendering the fields off the live
    // report would delete them at exactly this moment.
    render(<PineBox onPick={vi.fn()} />)
    type(`//@version=5
indicator("t")
len = input.int(14, "Length", minval=2, maxval=200)
plot(ta.sma(close, len))
`)
    fireEvent.change(await screen.findByTestId('pine-length-len'), { target: { value: '500' } })
    const refusal = await screen.findByTestId('pine-refusal')
    expect(refusal).toHaveAttribute('data-guard', 'pine:input-kind')
    expect(refusal).toHaveTextContent(/author/)
    expect(screen.getByTestId('pine-length-len')).toBeTruthy()
  })

  it('⛔ a NEW paste forgets the previous script\'s lengths', async () => {
    // ⚰️ `len` is the commonest identifier in the corpus. A stale value carried
    // across a paste would compute a length the member never chose for the script
    // now on screen, and nothing would say so.
    render(<PineBox onPick={vi.fn()} />)
    type(SCRIPT_WINDOW_ONLY)
    fireEvent.change(await screen.findByTestId('pine-length-len'), { target: { value: '50' } })
    await waitFor(() => expect(screen.getByTestId('pine-formula-0')).toHaveTextContent('sma(close, 50)'))
    type(`//@version=5
indicator("other")
len = input.int(9, "Length")
plot(ta.ema(close, len))
`)
    await waitFor(() => expect(screen.getByTestId('pine-formula-0')).toHaveTextContent('ema(close, 9)'))
    expect(await screen.findByTestId('pine-length-len')).toHaveValue(null)
  })

  it('⛔ a script with no inputs hands back a bare string and says nothing about knobs', async () => {
    const onPick = vi.fn()
    render(<PineBox onPick={onPick} />)
    type(SCRIPT_NO_INPUTS)
    await clickUse()
    expect(onPick.mock.calls[0][0]).toBe('sma(close, 20)')
    await waitFor(() => {
      expect(screen.queryByTestId('pine-inputs-kept')).toBeNull()
      expect(screen.queryByTestId('pine-inputs-folded')).toBeNull()
    })
  })
})
