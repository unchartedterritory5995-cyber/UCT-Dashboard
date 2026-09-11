// app/src/pages/dashboard/useCssDisplayed.test.jsx — the hook prunes what CSS hides.
import { render, cleanup, act } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import useCssDisplayed from './useCssDisplayed'

function Probe({ hidden, onRead }) {
  const ref = useRef(null)
  const shown = useCssDisplayed(ref)
  onRead(shown)
  return <div ref={ref} data-probe style={hidden ? { display: 'none' } : undefined}>{shown ? 'SHOWN' : ''}</div>
}

afterEach(cleanup)

describe('useCssDisplayed', () => {
  it('reads true for an element the stylesheet is not hiding', () => {
    const reads = []
    const { container } = render(<Probe hidden={false} onRead={(v) => reads.push(v)} />)
    expect(container.textContent).toBe('SHOWN')
    expect(reads.at(-1)).toBe(true)
  })

  it('⛔ reads false for an element resolved to display:none — measured, not guessed', () => {
    const reads = []
    const { container } = render(<Probe hidden onRead={(v) => reads.push(v)} />)
    expect(container.textContent).toBe('')
    expect(reads.at(-1)).toBe(false)
    // The first render optimistically says shown (NO BLANK, ever); the layout effect corrects it
    // before paint. Both reads must be present or the default has changed.
    expect(reads[0]).toBe(true)
  })

  it('re-measures on a resize — a branch that becomes visible gets its hero back', () => {
    const reads = []
    const { container, rerender } = render(<Probe hidden onRead={(v) => reads.push(v)} />)
    expect(reads.at(-1)).toBe(false)
    rerender(<Probe hidden={false} onRead={(v) => reads.push(v)} />)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(reads.at(-1)).toBe(true)
    expect(container.textContent).toBe('SHOWN')
  })
})
