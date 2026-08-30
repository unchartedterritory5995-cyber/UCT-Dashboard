import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RotationView from './RotationView'
import { PALETTES } from './breadthViewShared'

// jsdom serialises an inline colour as rgb(); derive the expectation from the
// palette rather than typing a literal that would outlive it.
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const BULL = rgb(PALETTES.classic.bull)
const BEAR = rgb(PALETTES.classic.bear)

// Newest-first: rsp/spy rising over the window = broadening.
const rows = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  rsp_spy_ratio: 0.70 - i * 0.002,
  iwm_qqq_ratio: 0.50 + i * 0.002,
  vix: 16, vxn: 21,
}))

describe('RotationView', () => {
  it('calls a rising equal-weight ratio broadening', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-verdict-rsp_spy_ratio').textContent).toMatch(/broadening/i)
  })

  it('calls a falling ratio narrowing', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-verdict-iwm_qqq_ratio').textContent).toMatch(/narrowing/i)
  })

  it('marks a series absent rather than drawing it as zero', () => {
    const noVxn = rows.map(r => ({ ...r, vxn: null }))
    const { getByTestId } = render(<RotationView rows={noVxn} rowIdx={0} currentRow={noVxn[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-verdict-vol_spread').textContent).toMatch(/not reported/i)
  })

  // 🔴 THE COLOUR MUST NOT CONTRADICT THE SENTENCE UNDER IT. `vol_spread`
  // inverts: a RISING VXN−VIX is "Narrowing — tech vol bid over the broad
  // market", so the uniform `delta >= 0 ? bull : bear` drew a green number and
  // a green sparkline directly above the word *Narrowing*.
  it('does NOT draw a rising vol spread bullish', () => {
    // Newest-first, so a spread that shrinks as i grows is RISING today.
    const widening = rows.map((r, i) => ({ ...r, vix: 16, vxn: 26 - i * 0.2 }))
    const { getByTestId, container } = render(<RotationView rows={widening} rowIdx={0}
      currentRow={widening[0]} onDrill={() => {}} options={{ lookback: 20, palette: 'classic' }} />)
    expect(getByTestId('rotation-delta-vol_spread').textContent).toMatch(/^\+/)      // it rose
    expect(getByTestId('rotation-verdict-vol_spread').textContent).toMatch(/narrowing/i)
    expect(getByTestId('rotation-delta-vol_spread').style.color).toBe(BEAR)
    expect(container.querySelector('[data-testid="rotation-spark-vol_spread"]').getAttribute('stroke'))
      .toBe(PALETTES.classic.bear)
  })

  it('still draws a rising equal-weight ratio bullish — the flag is per panel', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20, palette: 'classic' }} />)
    expect(getByTestId('rotation-verdict-rsp_spy_ratio').textContent).toMatch(/broadening/i)
    expect(getByTestId('rotation-delta-rsp_spy_ratio').style.color).toBe(BULL)
  })

  // 🔴 "/60d" OVER 12 SESSIONS IS A CLAIM ABOUT HISTORY THE LENS NEVER READ.
  it('states the span it actually measured, never the span it was asked for', () => {
    const short = rows.slice(0, 12)
    const { getByTestId } = render(<RotationView rows={short} rowIdx={0} currentRow={short[0]}
      onDrill={() => {}} options={{ lookback: 60 }} />)
    expect(getByTestId('rotation-delta-rsp_spy_ratio').textContent).toMatch(/\/ 11d$/)
    expect(getByTestId('rotation-delta-rsp_spy_ratio').textContent).not.toMatch(/60d/)
    expect(getByTestId('rotation-basis').textContent)
      .toMatch(/12 sessions · since 2026-08-29 · shorter than the 60-day setting/)
  })

  /**
   * ⭐ THE PANEL NOW DRAWS THE REFERENCE IT MEASURES FROM.
   *
   * A sparkline plus a delta asks the reader to take the delta on trust. The
   * dashed line sits at the reading `measured` sessions back and the panel names
   * that reading in words, so the number beside the trace is checkable off the
   * trace — the same "show the basis" discipline every other lens follows.
   *
   * ⛔ AND THE THREE NUMBERS MUST CLOSE. Reading / reference / delta are three
   * renderings of one subtraction; a rail that only checked they exist would
   * stay green while the reference named a different session than the delta was
   * taken from — which is exactly the drift the `measured` ruling exists for.
   */
  it('draws and names the reference the delta is measured from, and the three close', () => {
    const { getByTestId, container } = render(<RotationView rows={rows} rowIdx={0}
      currentRow={rows[0]} onDrill={() => {}} options={{ lookback: 20 }} />)

    // rows are newest-first with dates 2026-08-40 … 2026-08-01, so 20 sessions
    // back from the newest is 2026-08-20.
    const ref = getByTestId('rotation-reference-rsp_spy_ratio').textContent
    expect(ref).toMatch(/on 2026-08-20$/)
    expect(container.querySelector('[data-testid="rotation-baseline-rsp_spy_ratio"]')).toBeTruthy()

    const num = (s) => Number(String(s).match(/-?\d+\.\d+/)[0])
    const value = num(getByTestId('rotation-value-rsp_spy_ratio').textContent)
    const reference = num(ref)
    const delta = num(getByTestId('rotation-delta-rsp_spy_ratio').textContent)
    expect(value - reference).toBeCloseTo(delta, 3)
    expect(reference).not.toBeCloseTo(value, 3)   // the fixture actually moved
  })

  it('gives the trace a scale the reading can be placed on', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    const bounds = [...getByTestId('rotation-range-rsp_spy_ratio').querySelectorAll('span')]
      .map(s => Number(s.textContent))
    expect(bounds).toHaveLength(2)
    const value = Number(getByTestId('rotation-value-rsp_spy_ratio').textContent)
    const [max, min] = bounds
    expect(max).toBeGreaterThan(min)              // a real range, not a repeat
    expect(value).toBeLessThanOrEqual(max)
    expect(value).toBeGreaterThanOrEqual(min)
  })

  it('carries the basis line every sibling lens carries', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-basis').textContent)
      .toMatch(/40 sessions · since 2026-08-01 · changes measured over 20 sessions/)
  })
})
