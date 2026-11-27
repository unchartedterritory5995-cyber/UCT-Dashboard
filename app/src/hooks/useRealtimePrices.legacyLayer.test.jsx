// The LEGACY price stream (the `uct.ssePool.disabled` kill switch: one EventSource per hook) on a hidden LAYER board
// (2026-11-27, the board keep-alive's layer mode; boardVisibility.js). A kept board stays mounted; without the board's
// pause every hidden chart would hold its own stream open.
//   LS1 (red first) a hidden layer board closes its stream; after the show's first paint (never in its own task) it
//       opens it again
//   LS2 the <Activity> mode's handle changes nothing
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const es = vi.hoisted(() => ({ open: new Set() }))
vi.mock('./livePriceStore', () => {
  const snap = { AAPL: { price: 1 } }
  return { registerTickers: () => () => {}, subscribe: () => () => {}, getSnapshot: () => snap, pollNow: () => {} }
})
class FakeEventSource {
  constructor(url) { this.url = url; es.open.add(this) }
  addEventListener() {}
  close() { es.open.delete(this) }
}
vi.stubGlobal('EventSource', FakeEventSource)
// the kill switch is read once, when the module loads
localStorage.setItem('uct.ssePool.disabled', '1')
const { default: useRealtimePrices } = await import('./useRealtimePrices')
const { BoardVisibilityContext, createBoardVisibility } = await import('../components/chart/boardVisibility')

beforeEach(() => { es.open.clear() })
const mount = (vis) => renderHook(() => useRealtimePrices(['AAPL']), {
  wrapper: ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>,
})
const afterPaint = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })

describe('the legacy price stream on a hidden layer board', () => {
  it('LS1 (red first) a hidden layer board closes its stream; the show opens it after its first paint', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = mount(vis)
    expect(es.open.size, 'NON-VACUITY: the kill-switch path opens its own stream').toBe(1)
    act(() => { vis.set('hidden') })
    expect(es.open.size, 'a hidden board kept its stream open').toBe(0)
    act(() => { vis.set('visible') })
    expect(es.open.size, 'the show opened the stream in its own task').toBe(0)
    await afterPaint()
    expect(es.open.size).toBe(1)
    view.unmount()
    expect(es.open.size).toBe(0)
  })

  it('LS2 the <Activity> handle changes nothing', () => {
    const vis = createBoardVisibility()
    const view = mount(vis)
    act(() => { vis.set('hidden') })
    expect(es.open.size).toBe(1)
    view.unmount()
  })
})
