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
  const area = screen.getByRole('textbox')
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

  it('⛔ a WINDOW input is reported as fixed, with the reason, and hands back a STRING', async () => {
    const onPick = vi.fn()
    render(<PineBox onPick={onPick} />)
    type(SCRIPT_WINDOW_ONLY)
    const folded = await screen.findByTestId('pine-inputs-folded')
    expect(folded).toHaveTextContent('Fixed at their defaults')
    expect(folded).toHaveTextContent('Length = 14')
    // The member is told WHY, not merely that it happened.
    expect(folded).toHaveTextContent('a length cannot be a member input')
    expect(screen.queryByTestId('pine-inputs-kept')).toBeNull()

    await clickUse()
    // ⛔ NOTHING DECLARABLE ⇒ THE OLD CONTRACT, UNCHANGED.
    expect(typeof onPick.mock.calls[0][0]).toBe('string')
    expect(onPick.mock.calls[0][0]).toBe('sma(close, 14)')
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
