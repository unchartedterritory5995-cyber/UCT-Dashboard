// ⚡ (2026-11-26, the board switch; owner: "never a lone chart") useStaggeredMount's two switch lanes.
//   L1 (red first) `admitNowFor`: the new ids it answers true for are mounted in the SAME render that brings them in,
//      together, past the limit and the pacing
//   L2 they stay mounted when the next render has no `admitNowFor` (before and after the effect records them)
//   L3 (red first) `nextFrameFor`: a new id is admitted one animation frame later, not after the paced interval
//   L4 control: with neither lane, new ids keep the paced admission (one per interval)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import useStaggeredMount from './useStaggeredMount'

let frames
beforeEach(() => {
  frames = []
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (f) => { frames.push(f); return frames.length })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const flushFrame = () => { const run = frames.splice(0); run.forEach((f) => f()) }

// records what every render returned
function Probe({ ids, opts, log }) {
  const { mountedIds } = useStaggeredMount(ids, opts)
  log.push({ ids: ids.join(','), mounted: [...mountedIds].filter((id) => ids.includes(id)).sort() })   // the ids on the board now
  return null
}
const BASE = { limit: 3, minAdmitIntervalMs: 300, slotTimeoutMs: 0 }

describe('useStaggeredMount switch lanes', () => {
  it('L1 (red first) admitNowFor: the warm ids are mounted in the same render that brings them in, together', () => {
    const log = []
    const { rerender } = render(<Probe ids={['x']} opts={BASE} log={log} />)
    const warm = new Set(['a', 'b', 'c', 'd'])
    rerender(<Probe ids={['a', 'b', 'c', 'd', 'w']} opts={{ ...BASE, admitNowFor: (id) => warm.has(id) }} log={log} />)
    const first = log.find((r) => r.ids === 'a,b,c,d,w')
    expect(first.mounted, 'the switch render did not mount the warm charts').toEqual(['a', 'b', 'c', 'd'])
  })

  it('L2 the ids admitted at once stay mounted in later renders without admitNowFor', () => {
    const log = []
    const { rerender } = render(<Probe ids={['x']} opts={BASE} log={log} />)
    rerender(<Probe ids={['a', 'b']} opts={{ ...BASE, admitNowFor: () => true }} log={log} />)
    rerender(<Probe ids={['a', 'b']} opts={BASE} log={log} />)
    act(() => { vi.advanceTimersByTime(1) })
    rerender(<Probe ids={['a', 'b']} opts={BASE} log={log} />)
    const after = log.filter((r) => r.ids === 'a,b')
    expect(after.every((r) => r.mounted.includes('a') && r.mounted.includes('b')), JSON.stringify(after)).toBe(true)
  })

  it('L3 (red first) nextFrameFor: a new id is admitted one frame later, not after the paced interval', () => {
    const log = []
    const { rerender } = render(<Probe ids={['x']} opts={BASE} log={log} />)
    act(() => { vi.advanceTimersByTime(1) })
    rerender(<Probe ids={['c1', 'list']} opts={{ ...BASE, admitNowFor: (id) => id === 'c1', nextFrameFor: (id) => id === 'list' }} log={log} />)
    act(() => { flushFrame() })
    const last = log[log.length - 1]
    expect(last.mounted, 'the list waited for its paced turn').toEqual(['c1', 'list'])
  })

  it('L4 control: with neither lane, new ids are admitted no faster than the interval', () => {
    const log = []
    const { rerender } = render(<Probe ids={['x']} opts={BASE} log={log} />)
    act(() => { vi.advanceTimersByTime(400) })
    rerender(<Probe ids={['a', 'b', 'c']} opts={BASE} log={log} />)
    act(() => { flushFrame() })
    expect(log[log.length - 1].mounted.length, 'more than one new id admitted at once').toBe(1)
    act(() => { vi.advanceTimersByTime(300) })
    expect(log[log.length - 1].mounted.length).toBe(2)
  })
})
