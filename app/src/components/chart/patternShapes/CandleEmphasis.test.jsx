import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import CandleEmphasis from './CandleEmphasis'

describe('CandleEmphasis', () => {
  it('draws an unfilled white outline sized to the real open/close y-extent', () => {
    const { container } = render(
      <svg><CandleEmphasis xCenter={100} yOpen={80} yClose={40} halfWidthPx={5} /></svg>,
    )
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    expect(rect.getAttribute('fill')).toBe('none')
    expect(rect.getAttribute('stroke')).toBe('#ffffff')
    expect(Number(rect.getAttribute('y'))).toBe(40) // top = min(yOpen, yClose)
    expect(Number(rect.getAttribute('height'))).toBe(40) // |80-40|
    expect(Number(rect.getAttribute('x'))).toBe(95) // xCenter - halfWidthPx
    expect(Number(rect.getAttribute('width'))).toBe(10)
  })

  it('floors the height so an open==close (doji-like) candle is still visible', () => {
    const { container } = render(
      <svg><CandleEmphasis xCenter={100} yOpen={50} yClose={50} halfWidthPx={5} /></svg>,
    )
    expect(Number(container.querySelector('rect').getAttribute('height'))).toBeGreaterThanOrEqual(2)
  })

  it('renders nothing when any required coordinate is null (fails safe, never a stray rect)', () => {
    const { container } = render(
      <svg><CandleEmphasis xCenter={null} yOpen={80} yClose={40} halfWidthPx={5} /></svg>,
    )
    expect(container.querySelector('rect')).toBeNull()
  })
})
