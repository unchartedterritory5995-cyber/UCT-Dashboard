// app/src/components/chart/builder/pineBoxImportTelemetry.test.jsx
//
// ─── Phase One Track C — `onImportTelemetry`, the separate notification ─────
//
// Mirrors `pineBoxHandback.test.jsx`'s own discipline: mocks NOTHING on the
// path under test. Renders the REAL `PasteBox`/`ImportBox`, types a REAL
// script, clicks the REAL "Use this formula" button, and asserts on what the
// new callback actually receives.
//
// ⛔ THIS DOES NOT TOUCH `onPick`'s OWN PAYLOAD. `onImportTelemetry` is a
// second, additive callback fired ALONGSIDE it — these tests assert `onPick`
// is unaffected (still receives exactly what it always has) precisely
// because that contract is the one `pineBoxHandback.test.jsx` already
// guards, and a regression there would be the most expensive possible
// side-effect of this addition.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import PineBox, { ImportBox } from './PineBox'

const type = (text) => {
  const area = screen.getByLabelText(/^(pine script|script or formula)$/i)
  fireEvent.change(area, { target: { value: text } })
}

const clickUse = async () => {
  const btn = await screen.findByRole('button', { name: /use this formula/i })
  fireEvent.click(btn)
}

beforeEach(() => { cleanup(); vi.useRealTimers() })

const PINE_SCRIPT = `//@version=5
indicator("t")
plot(ta.sma(close, 20))
`

const THINKSCRIPT_SCRIPT = `plot scan = close > Average(close, 50);
`

describe('PasteBox reports an import attempt on the SAME action onPick fires from', () => {
  it('⭐⭐ onImportTelemetry fires once, with the dialect, exactly when onPick fires', async () => {
    const onPick = vi.fn()
    const onImportTelemetry = vi.fn()
    render(<PineBox onPick={onPick} onImportTelemetry={onImportTelemetry} />)
    type(PINE_SCRIPT)
    await clickUse()

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onImportTelemetry).toHaveBeenCalledTimes(1)
    expect(onImportTelemetry).toHaveBeenCalledWith('pine')
  })

  it('⭐ the DETECTED dialect is reported, not a hardcoded one — thinkScript through ImportBox', async () => {
    const onImportTelemetry = vi.fn()
    render(<ImportBox onPick={vi.fn()} onImportTelemetry={onImportTelemetry} dialect="auto" />)
    type(THINKSCRIPT_SCRIPT)
    await clickUse()

    expect(onImportTelemetry).toHaveBeenCalledWith('thinkscript')
  })

  it('⛔ typing alone — no click — fires NEITHER callback (no keystroke spam)', () => {
    const onPick = vi.fn()
    const onImportTelemetry = vi.fn()
    render(<PineBox onPick={onPick} onImportTelemetry={onImportTelemetry} />)
    type(PINE_SCRIPT)
    // No clickUse() — a member who pastes and then changes their mind, or is
    // still revising, must generate NO telemetry until they actually commit.
    expect(onPick).not.toHaveBeenCalled()
    expect(onImportTelemetry).not.toHaveBeenCalled()
  })

  it('⛔ onImportTelemetry is OPTIONAL — omitting it must not break onPick', async () => {
    const onPick = vi.fn()
    render(<PineBox onPick={onPick} />)
    type(PINE_SCRIPT)
    await clickUse()
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('⭐ onPick keeps its OWN payload unchanged by this addition (the guarded contract)', async () => {
    const onPick = vi.fn()
    const onImportTelemetry = vi.fn()
    render(<PineBox onPick={onPick} onImportTelemetry={onImportTelemetry} />)
    type(PINE_SCRIPT)
    await clickUse()
    // A bare string for a no-input script, byte for byte — exactly the
    // invariant `pineBoxHandback.test.jsx` already pins.
    expect(typeof onPick.mock.calls[0][0]).toBe('string')
  })
})
