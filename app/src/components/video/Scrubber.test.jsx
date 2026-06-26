import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Scrubber from './Scrubber'

describe('Scrubber', () => {
  it('fills proportional to current/duration', () => {
    const { getByRole } = render(<Scrubber current={30} duration={60} onSeek={() => {}} />)
    const fill = getByRole('slider').firstChild
    expect(fill.style.width).toBe('50%')
  })

  it('calls onSeek with a 0..1 fraction on pointer down', () => {
    const onSeek = vi.fn()
    const { getByRole } = render(<Scrubber current={0} duration={60} onSeek={onSeek} />)
    const track = getByRole('slider')
    track.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 14 })
    fireEvent.pointerDown(track, { clientX: 50 })
    expect(onSeek).toHaveBeenCalled()
    const frac = onSeek.mock.calls[0][0]
    expect(frac).toBeCloseTo(0.25, 5)
  })

  it('does not seek when duration is unknown', () => {
    const onSeek = vi.fn()
    const { getByRole } = render(<Scrubber current={0} duration={0} onSeek={onSeek} />)
    fireEvent.pointerDown(getByRole('slider'), { clientX: 50 })
    expect(onSeek).not.toHaveBeenCalled()
  })
})
