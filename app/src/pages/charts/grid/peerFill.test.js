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

    // Each run fills its seed immediately (not latch-gated); only the MSFT peer fill lands (AAPL's is discarded).
    expect(fillCells).toHaveBeenCalledTimes(3)
    expect(fillCells).toHaveBeenNthCalledWith(1, ['AAPL'], { id: 'a' })   // AAPL seed immediate
    expect(fillCells).toHaveBeenNthCalledWith(2, ['MSFT'], { id: 'b' })   // MSFT seed immediate
    expect(fillCells).toHaveBeenNthCalledWith(3, ['MSFT', 'M1', 'M2'], { id: 'b' })  // MSFT peer fill
  })

  it('keeps the seed solo when the taxonomy has no group', async () => {
    const fetchPeers = vi.fn(async () => ({ seed: 'SNDK', peers: [], source: 'none' }))
    const fillCells = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })
    await filler.run('SNDK', { n: 3, group: null, snapshot: {} })
    expect(fillCells).toHaveBeenCalledWith(['SNDK'], null)
  })

  it('fills the seed immediately, then the full set when peers resolve', async () => {
    let resolve
    const fetchPeers = vi.fn(() => new Promise(r => { resolve = () => r({ seed: 'SNDK', peers: ['WDC', 'STX'], source: 'ai' }) }))
    const fillCells = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })
    const p = filler.run('SNDK', { n: 3, group: null, snapshot: {} })
    // Seed-solo fill happens synchronously, before the fetch resolves:
    expect(fillCells).toHaveBeenNthCalledWith(1, ['SNDK'], null)
    resolve()
    await p
    expect(fillCells).toHaveBeenNthCalledWith(2, ['SNDK', 'WDC', 'STX'], null)
  })

  it('a superseded run does not fill the seed either', async () => {
    const fetchPeers = vi.fn(() => new Promise(() => {}))   // never resolves
    const fillCells = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })
    filler.run('AAPL', { n: 3, group: null, snapshot: {} })   // gen 1: fills [AAPL]
    filler.run('MSFT', { n: 3, group: null, snapshot: {} })   // gen 2: fills [MSFT]
    // Each run fills its own seed immediately; both are the latest at their moment.
    expect(fillCells).toHaveBeenNthCalledWith(1, ['AAPL'], null)
    expect(fillCells).toHaveBeenNthCalledWith(2, ['MSFT'], null)
    expect(fillCells).toHaveBeenCalledTimes(2)   // neither fetch resolved → no peer fills
  })
})
