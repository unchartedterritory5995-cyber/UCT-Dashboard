// app/src/pages/charts/grid/peerFill.test.js
import { describe, it, expect, vi } from 'vitest'
import { makePeerFiller } from './peerFill'

describe('makePeerFiller', () => {
  it('discards a stale (out-of-order) peer response', async () => {
    let resolveAAPL, resolveMSFT
    const fetchPeers = vi.fn((sym) => {
      if (sym === 'AAPL') return new Promise(r => { resolveAAPL = () => r({ seed: 'AAPL', peers: ['A1', 'A2'], source: 'taxonomy' }) })
      return new Promise(r => { resolveMSFT = () => r({ seed: 'MSFT', peers: ['M1', 'M2'], source: 'taxonomy' }) })
    })
    const fillCells = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })

    const p1 = filler.run('AAPL', { n: 3, group: { id: 'a' }, snapshot: {} })
    const p2 = filler.run('MSFT', { n: 3, group: { id: 'b' }, snapshot: {} })
    resolveMSFT()      // newer request resolves first
    await p2
    resolveAAPL()      // older request resolves late -> MUST be ignored
    await p1

    expect(fillCells).toHaveBeenCalledTimes(1)
    expect(fillCells).toHaveBeenCalledWith(['MSFT', 'M1', 'M2'], { id: 'b' })
  })

  it('keeps the seed solo when the taxonomy has no group', async () => {
    const fetchPeers = vi.fn(async () => ({ seed: 'SNDK', peers: [], source: 'none' }))
    const fillCells = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })
    await filler.run('SNDK', { n: 3, group: null, snapshot: {} })
    expect(fillCells).toHaveBeenCalledWith(['SNDK'], null)
  })
})
