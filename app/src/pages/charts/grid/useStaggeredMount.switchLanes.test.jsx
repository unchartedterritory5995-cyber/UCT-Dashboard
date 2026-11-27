// ⚡ (2026-11-26, the board switch; owner: "never a lone chart") useStaggeredMount's two switch lanes.
//   L1 (red first) `admitNowFor`: the new ids it answers true for are mounted in the SAME render that brings them in,
//      together, past the limit and the pacing
//   L2 they stay mounted when the next render has no `admitNowFor` (before and after the effect records them)
//   L3 (red first) `nextFrameFor`: a new id is admitted one animation frame later, not after the paced interval
//   L4 control: with neither lane, new ids keep the paced admission (one per interval)
//   L5 (review: finding 1) a warm id reports ready in its own mount effect, before the board's: it holds no slot, so a
//      board with `limit` warm charts still admits its cold chart at the normal pace, not after the 5 s timer
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect } from 'react'
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

// a mounted body that reports ready in its own mount effect (a child's effects run before its parent's), as a warm
// chart does through StockChart's [loading] latch
function Body({ id, release, warm }) {
  useEffect(() => { if (warm) release(id) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
function Board({ ids, opts, warm, log }) {
  const { mountedIds, release } = useStaggeredMount(ids, opts)
  log.push([...mountedIds].filter((id) => ids.includes(id)).sort())
  return ids.filter((id) => mountedIds.has(id)).map((id) => <Body key={id} id={id} release={release} warm={warm.has(id)} />)
}

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

  it('L5 (red first) warm ids hold no slot: the cold chart of a board with `limit` warm ones is admitted at the normal pace', () => {
    const log = []
    const warm = new Set(['w1', 'w2', 'w3'])
    const opts = { limit: 3, minAdmitIntervalMs: 300, slotTimeoutMs: 5000 }
    const { rerender } = render(<Board ids={['x']} opts={opts} warm={new Set()} log={log} />)
    act(() => { vi.advanceTimersByTime(400) })
    rerender(<Board ids={['w1', 'w2', 'w3', 'cold']} opts={{ ...opts, admitNowFor: (id) => warm.has(id) }} warm={warm} log={log} />)
    act(() => { vi.advanceTimersByTime(400) })
    expect(log[log.length - 1], 'the cold chart waited for the 5 s slot timers of the warm charts').toContain('cold')
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
