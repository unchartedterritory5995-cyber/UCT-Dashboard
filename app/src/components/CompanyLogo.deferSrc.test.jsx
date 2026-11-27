// ⚡ (2026-11-26, the board switch) A LOGO OFF SCREEN ASKS FOR ITS IMAGE AFTER PAINT. A board switch mounts ~40 watchlist
// rows at once, and setting `src` on every row image was 6.9 ms of the switch's click task. The rows a virtualized list
// mounts OFF screen (its overscan) now pass `deferSrc`: their image is asked for one animation frame later. Nothing on
// screen changes (every new row shows its monogram until its image loads; an off-screen row shows nothing).
//   D1 (red first) deferSrc: no src on mount, the logo URL one animation frame later
//   D2 without it: the src on mount, as before;  D3 the row coming on screen before the frame asks at once
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import CompanyLogo from './CompanyLogo'

const imgOf = (c) => c.querySelector('img')
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('CompanyLogo deferSrc', () => {
  it('D1 (red first) a deferred logo has no src on mount and the logo URL one animation frame later', () => {
    const { container } = render(<CompanyLogo sym="nvda" deferSrc />)
    expect(imgOf(container).getAttribute('src'), 'the off-screen logo asked for its image inside the commit').toBeNull()
    act(() => { vi.advanceTimersByTime(40) })
    expect(imgOf(container).getAttribute('src')).toMatch(/^\/api\/ticker-logo\/NVDA\?v=/)
  })

  it('D2 a logo on screen (no deferSrc) has its src on mount, as before', () => {
    const { container } = render(<CompanyLogo sym="nvda" />)
    expect(imgOf(container).getAttribute('src')).toMatch(/^\/api\/ticker-logo\/NVDA\?v=/)
  })

  it('D3 a deferred row that comes on screen before the frame asks at once', () => {
    const { container, rerender } = render(<CompanyLogo sym="nvda" deferSrc />)
    expect(imgOf(container).getAttribute('src')).toBeNull()
    rerender(<CompanyLogo sym="nvda" deferSrc={false} />)
    expect(imgOf(container).getAttribute('src')).toMatch(/^\/api\/ticker-logo\/NVDA\?v=/)
  })

  // (review of #2847) the ask is never taken back: a row that came on screen and slid back into the overscan keeps its src
  it('D4 (red first) once asked, never taken back: deferSrc true -> false -> true keeps the src', () => {
    const { container, rerender } = render(<CompanyLogo sym="nvda" deferSrc />)
    rerender(<CompanyLogo sym="nvda" deferSrc={false} />)
    const src = imgOf(container).getAttribute('src')
    expect(src).toMatch(/^\/api\/ticker-logo\/NVDA\?v=/)
    rerender(<CompanyLogo sym="nvda" deferSrc />)
    expect(imgOf(container).getAttribute('src'), 'the src was taken back from an image already asked for').toBe(src)
  })
})
