// ⭐⭐ NEIGHBOR FRAMES — a chart that does NOT read the bar store (`BARSTORE` off: the legacy bars source) never
// creates or touches one for its neighbours, whatever the switch and the list say.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

const getBarStore = vi.fn(() => { throw new Error('the bar store was asked for') })
vi.mock('../../data/barStore/index', () => ({ getBarStore }))
vi.mock('./barStoreSwitch', () => ({ BARSTORE: false }))

const { useNeighborFrames, prepareRow } = await import('./useNeighborFrames')
const nf = await import('./neighborFrames')

const recipes = { plain: true, session: { p: {}, sig: '' }, ohlc: {}, close: {}, vol: { on: false }, volMa: { on: false } }
function Chart() {
  useNeighborFrames({ on: true, sym: 'AAA', tf: 'D', showExtended: false, engineRef: { current: null }, recipes })
  return null
}

afterEach(() => { cleanup(); nf.__setNeighborFramesForTests(null); vi.unstubAllGlobals() })

describe('BARSTORE off', () => {
  it('the hook schedules nothing and never asks for the bar store, even with the switch on and a list published', async () => {
    nf.__setNeighborFramesForTests(true)
    vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10 }), 1))
    vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
    render(<Chart />)
    await act(async () => { nf.publishScanNeighbors('AAA', ['BBB'], ['ZZZ']) })
    await act(() => new Promise((r) => setTimeout(r, 60)))
    expect(nf.__idleQueueLength()).toBe(0)
    expect(getBarStore).not.toHaveBeenCalled()
  })

  it('a row handed to prepareRow anyway prepares nothing and asks for no store', () => {
    const g = prepareRow('BBB', 0, { recipes: () => recipes, view: () => ({ tf: 'D', showExtended: false }), engineRef: { current: null } })
    expect(g.next().done).toBe(true)
    expect(getBarStore).not.toHaveBeenCalled()
  })
})
