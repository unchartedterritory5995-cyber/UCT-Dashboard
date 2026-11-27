// One board's view of the groups' symbols (2026-11-27, the board keep-alive's layer mode; groupSymsStore.js
// `createBoardGroupSymsView`). A hidden layer board stays mounted: a symbol switch on the board in front must not reach
// its linked charts until the show.
//   V1 (red first) while the board is hidden the view holds the symbols as of the hide and tells nobody of a change
//   V2 the show reads the source again and tells its readers once, only when the symbols moved meanwhile
//   V3 a visible board's view is the source, change for change; writes go to the source
import { describe, it, expect, vi } from 'vitest'
import { createGroupSymsStore, createBoardGroupSymsView } from './groupSymsStore'
import { createBoardVisibility } from '../../components/chart/boardVisibility'

describe('a board view of the group symbols', () => {
  it('V1 (red first) a hidden board holds the symbols as of the hide', () => {
    const source = createGroupSymsStore({ A: 'AAPL', B: 'MSFT' })
    const vis = createBoardVisibility({ layer: true })
    const view = createBoardGroupSymsView(source, vis)
    const reader = vi.fn()
    view.subscribe(reader)
    vis.set('hidden')
    source.set((s) => ({ ...s, A: 'NVDA' }))
    expect(view.get().A, 'the hidden board read the switch made on the board in front').toBe('AAPL')
    expect(reader, 'a hidden board was told of a switch').not.toHaveBeenCalled()
  })

  it('V2 the show applies what moved meanwhile, once; nothing moved tells nobody', () => {
    const source = createGroupSymsStore({ A: 'AAPL', B: 'MSFT' })
    const vis = createBoardVisibility({ layer: true })
    const view = createBoardGroupSymsView(source, vis)
    const reader = vi.fn()
    view.subscribe(reader)
    vis.set('hidden')
    vis.set('visible')
    expect(reader, 'a show with nothing moved re-rendered a reader').not.toHaveBeenCalled()
    vis.set('hidden')
    source.set((s) => ({ ...s, A: 'NVDA' }))
    source.set((s) => ({ ...s, B: 'AMD' }))
    vis.set('visible')
    expect(reader).toHaveBeenCalledTimes(1)
    expect(view.get()).toEqual({ A: 'NVDA', B: 'AMD' })
  })

  it('V3 a visible board reads the source change for change; writes go to the source', () => {
    const source = createGroupSymsStore({ A: 'AAPL' })
    const vis = createBoardVisibility({ layer: true })
    const view = createBoardGroupSymsView(source, vis)
    const reader = vi.fn()
    const off = view.subscribe(reader)
    source.set({ A: 'TSLA' })
    expect(reader).toHaveBeenCalledTimes(1)
    expect(view.get()).toBe(source.get())
    view.set({ A: 'META' })
    expect(source.get()).toEqual({ A: 'META' })
    off()
    source.set({ A: 'AMZN' })
    expect(reader).toHaveBeenCalledTimes(2)   // the write above, not the one after the unsubscribe
  })
})
