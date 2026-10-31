// UCT Agent PHASE 3 — WORKSTREAM 4, UNDO, RECEIPTS & RELIABILITY (the Agent-owned part). Through the REAL panel
// (panelHarness: AgentPanel + useAgent, planner, policy, runtime, receipts, Undo and the Indicators mutation interface).
//
//   undo all of that   every change the LAST request committed, newest first, each through the same Undo; the first
//                      one that can't be undone stops it, and the member hears exactly how many were taken back
//   receipts           one chart's change on a board of several names the chart
//   (4A — the Indicators Undo of an add leaves residue in stored settings: Indicators-owned; handed off in
//    docs/agent/PHASE3-INDICATORS-HANDOFF.md, fixed by Indicators in draft PR #517 — no Agent workaround here.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, FOUR } from './testing/panelHarness'
import { fastParse } from './fastPath'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const emas = (board, id) => p.instancesOn(board, id).filter(i => i.defId === 'movingAverage' && i.inputs?.maType === 'ema').map(i => i.inputs.period)
const shape = (board) => JSON.stringify(board.state.widgets.map(w => [w.id, w.x, w.y, w.w, w.h]))

describe('"undo all of that" — the whole last request, never a silent partial', () => {
  it.each(['undo all of that', 'undo everything you just did', 'take it all back', 'take everything back', 'undo that whole request', 'revert all of it'])('"%s" is the whole-request Undo', (q) => {
    expect(fastParse(q)).toEqual({ kind: 'undo', all: true })
  })
  it('"undo" alone stays the newest change only', () => {
    for (const t of ['undo', 'take that back', 'undo that']) expect(fastParse(t)).toEqual({ kind: 'undo' })
  })

  it('"slap the 9/20 on all four" then "undo all of that": all eight adds taken back in one request', async () => {
    const { say, board } = p.mount(...FOUR())
    await say('slap the 9/20 on all four')
    for (const id of ['c0', 'c1', 'c2', 'c3']) expect(emas(board, id)).toEqual([9, 20])
    const out = await say('undo all of that')
    for (const id of ['c0', 'c1', 'c2', 'c3']) expect(emas(board, id)).toEqual([])
    expect(out).toMatch(/Took back all 8 changes from your last request\./)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('a multi-step workspace request: the grid, its watchlist and every RSI — the board exactly as it was', async () => {
    const { say, board, h } = p.mount(...ONE('BRCB'))
    const before = shape(board)
    await say('Make me a workspace with four daily charts for NVDA, AMD, AVGO and MU, a watchlist, and RSI beneath each chart.')
    expect(board.state.widgets).toHaveLength(5)
    const out = await say('undo everything you just did')
    expect(shape(board)).toBe(before)
    expect(h.charts.read('c').symbol).toBe('BRCB')
    expect(out).toMatch(/Took back all 5 changes from your last request\./)
  }, 60000)

  it('a change edited in between is NOT undone: it stops there and says how many were taken back and how many remain', async () => {
    const { say, board } = p.mount(...FOUR())
    await say('slap the 9/20 on all four')
    // the member edits QQQ's EMA 9 by hand (its colour) — that add can no longer be taken back exactly
    const w = board.state.widgets.find(x => x.id === 'c1')
    const inst = w.opts.settings.indicatorInstances.find(i => !i.deleted && i.inputs?.period === 9)
    inst.inputs = { ...inst.inputs, color: '#000000' }
    const out = await say('undo all of that')
    expect(emas(board, 'c3')).toEqual([])                                        // newest first: TSLA, NVDA …
    expect(emas(board, 'c2')).toEqual([])
    expect(emas(board, 'c1')).toEqual([9])                                       // … QQQ's EMA 20, then the edited 9 stops it
    expect(emas(board, 'c0')).toEqual([9, 20])                                   // never reached
    expect(out).toMatch(/Took back 5 of the 8 changes from your last request, then stopped \(above\) — the other 3 are still in place\./)
  }, 40000)

  it('with a single change, it is the ordinary Undo', async () => {
    const { say, h } = p.mount(...ONE('BRCB'))
    await say('weekly')
    const out = await say('undo all of that')
    expect(h.charts.read('c').tf).toBe('D')
    expect(out).toMatch(/Undid: Switched timeframe to Weekly/)
    expect(out).not.toMatch(/Took back/)
  }, 30000)
})

describe('receipts name the chart when the board has several', () => {
  it('one chart changed on a board of four: the receipt says which chart', async () => {
    const { say } = p.mount(...FOUR())
    expect(await say('make the top left weekly')).toMatch(/Chart \(SPY\): Switched timeframe to Weekly/)
    expect(await say('switch the bottom right chart to AMD')).toMatch(/Chart \(TSLA\): Changed symbol to AMD/)
  }, 30000)
  it('a one-chart board needs no name', async () => {
    const { say } = p.mount(...ONE('BRCB'))
    const out = await say('weekly')
    expect(out).toMatch(/Switched timeframe to Weekly/)
    expect(out).not.toMatch(/Chart \(BRCB\): Switched/)
  }, 30000)
})
