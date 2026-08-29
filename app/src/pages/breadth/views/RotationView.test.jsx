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
    expect(getByTestId('verdict-rsp_spy_ratio').textContent).toMatch(/broadening/i)
  })

  it('calls a falling ratio narrowing', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('verdict-iwm_qqq_ratio').textContent).toMatch(/narrowing/i)
  })

  it('marks a series absent rather than drawing it as zero', () => {
    const noVxn = rows.map(r => ({ ...r, vxn: null }))
    const { getByTestId } = render(<RotationView rows={noVxn} rowIdx={0} currentRow={noVxn[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('verdict-vol_spread').textContent).toMatch(/not reported/i)
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
    expect(getByTestId('delta-vol_spread').textContent).toMatch(/^\+/)      // it rose
    expect(getByTestId('verdict-vol_spread').textContent).toMatch(/narrowing/i)
    expect(getByTestId('delta-vol_spread').style.color).toBe(BEAR)
    expect(container.querySelector('[data-testid="spark-vol_spread"]').getAttribute('stroke'))
      .toBe(PALETTES.classic.bear)
  })

  it('still draws a rising equal-weight ratio bullish — the flag is per panel', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20, palette: 'classic' }} />)
    expect(getByTestId('verdict-rsp_spy_ratio').textContent).toMatch(/broadening/i)
    expect(getByTestId('delta-rsp_spy_ratio').style.color).toBe(BULL)
  })

  // 🔴 "/60d" OVER 12 SESSIONS IS A CLAIM ABOUT HISTORY THE LENS NEVER READ.
  it('states the span it actually measured, never the span it was asked for', () => {
    const short = rows.slice(0, 12)
    const { getByTestId } = render(<RotationView rows={short} rowIdx={0} currentRow={short[0]}
      onDrill={() => {}} options={{ lookback: 60 }} />)
    expect(getByTestId('delta-rsp_spy_ratio').textContent).toMatch(/\/ 11d$/)
    expect(getByTestId('delta-rsp_spy_ratio').textContent).not.toMatch(/60d/)
    expect(getByTestId('rotation-basis').textContent)
      .toMatch(/12 sessions · since 2026-08-29 · shorter than the 60-day setting/)
  })

  it('carries the basis line every sibling lens carries', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('rotation-basis').textContent)
      .toMatch(/40 sessions · since 2026-08-01 · changes measured over 20 sessions/)
  })
})
