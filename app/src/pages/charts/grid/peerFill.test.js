// app/src/pages/charts/grid/peerFill.test.js
import { describe, it, expect, vi } from 'vitest'
import { makePeerFiller } from './peerFill'

describe('makePeerFiller', () => {
  it('discards a stale (out-of-order) peer response', async () => {
    let resolveAAPL, resolveMSFT
    const fetchPeers = vi.fn((sym) => {
      if (sym === 'AAPL') return new Promise(r => { resolveAAPL = () => r({ seed: 'AAPL', group_id: 'a', group_name: 'A', peers: ['A1', 'A2'], source: 'taxonomy' }) })
      return new Promise(r => { resolveMSFT = () => r({ seed: 'MSFT', group_id: 'b', group_name: 'B', peers: ['M1', 'M2'], source: 'taxonomy' }) })
    })
    const fillCells = vi.fn()
    const updateCellAt = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, updateCellAt, onUndoAvailable: () => {} })

    const p1 = filler.run('AAPL', { n: 3, cellIndex: 0, cellNext: { id: 'c0', sym: 'AAPL', tf: 'D' }, snapshot: {} })
    const p2 = filler.run('MSFT', { n: 3, cellIndex: 1, cellNext: { id: 'c1', sym: 'MSFT', tf: 'D' }, snapshot: {} })
    resolveMSFT()      // newer request resolves first
    await p2
    resolveAAPL()      // older request resolves late -> MUST be ignored
    await p1

    // Optimistic seeds land in their OWN cells only (never a board wipe):
    expect(updateCellAt).toHaveBeenNthCalledWith(1, 0, { id: 'c0', sym: 'AAPL', tf: 'D' })
    expect(updateCellAt).toHaveBeenNthCalledWith(2, 1, { id: 'c1', sym: 'MSFT', tf: 'D' })
    // Only the MSFT (newest) peer fill lands; AAPL's stale response is discarded.
    expect(fillCells).toHaveBeenCalledTimes(1)
    expect(fillCells).toHaveBeenCalledWith(['MSFT', 'M1', 'M2'],
      { id: 'b', name: 'B', by: 'today', n: 3, seed: 'MSFT', alsoIn: [] })
  })

  it('never wipes the board on a groupless seed: seed stays in its cell, group clears, notice fires', async () => {
    const fetchPeers = vi.fn(async () => ({ seed: 'ZZZQ', peers: [], source: 'none' }))
    const fillCells = vi.fn()
    const updateCellAt = vi.fn()
    const clearGroup = vi.fn()
    const onNotice = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, updateCellAt, clearGroup, onNotice, onUndoAvailable: () => {} })
    await filler.run('ZZZQ', { n: 3, cellIndex: 2, cellNext: { id: 'c2', sym: 'ZZZQ', tf: '65' }, snapshot: {} })
    expect(updateCellAt).toHaveBeenCalledWith(2, { id: 'c2', sym: 'ZZZQ', tf: '65' })
    expect(fillCells).not.toHaveBeenCalled()          // the rest of the board is UNTOUCHED
    expect(clearGroup).toHaveBeenCalled()             // stale header/chips dropped
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('ZZZQ'))
  })

  it('AI peers fill without a group (and clear the previous group)', async () => {
    const fetchPeers = vi.fn(async () => ({ seed: 'ORFN', peers: ['P1', 'P2'], source: 'ai', group_id: null }))
    const fillCells = vi.fn()
    const clearGroup = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, clearGroup, onUndoAvailable: () => {} })
    await filler.run('ORFN', { n: 3, snapshot: {} })
    expect(fillCells).toHaveBeenCalledWith(['ORFN', 'P1', 'P2'], null)
    expect(clearGroup).toHaveBeenCalled()
  })

  it('taxonomy fill carries group name + alsoIn for the switcher', async () => {
    const fetchPeers = vi.fn(async () => ({
      seed: 'NVDA', group_id: 'ai_gpu_chips', group_name: 'AI / GPU Chips',
      also_in: [{ id: 'semiconductors', name: 'Semiconductors' }],
      peers: ['AMD', 'AVGO'], source: 'taxonomy',
    }))
    const fillCells = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, onUndoAvailable: () => {} })
    await filler.run('NVDA', { n: 3, snapshot: {} })
    expect(fillCells).toHaveBeenCalledWith(['NVDA', 'AMD', 'AVGO'], {
      id: 'ai_gpu_chips', name: 'AI / GPU Chips', by: 'today', n: 3, seed: 'NVDA',
      alsoIn: [{ id: 'semiconductors', name: 'Semiconductors' }],
    })
  })

  it('a fetch failure keeps the board and notifies instead of throwing', async () => {
    const fetchPeers = vi.fn(async () => { throw new Error('network') })
    const fillCells = vi.fn()
    const clearGroup = vi.fn()
    const onNotice = vi.fn()
    const filler = makePeerFiller({ fetchPeers, fillCells, clearGroup, onNotice, onUndoAvailable: () => {} })
    await filler.run('AAPL', { n: 3, snapshot: {} })
    expect(fillCells).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalled()
  })

  it('shares an external fill sequence so another fill source supersedes it', async () => {
    let resolveFetch
    const fetchPeers = vi.fn(() => new Promise(r => { resolveFetch = () => r({ seed: 'AAPL', group_id: 'a', peers: ['A1'], source: 'taxonomy' }) }))
    const fillCells = vi.fn()
    const seq = { n: 0 }
    const filler = makePeerFiller({ fetchPeers, fillCells, seq, onUndoAvailable: () => {} })
    const p = filler.run('AAPL', { n: 2, snapshot: {} })
    seq.n += 1              // an external fill (the also-in switcher) took over
    resolveFetch()
    await p
    expect(fillCells).not.toHaveBeenCalled()   // stale typed fill discarded
  })
})
