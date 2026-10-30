// UCT Agent PHASE 3 — WORKSTREAM 1, CONVERSATIONAL INTELLIGENCE. Through the REAL panel (panelHarness: AgentPanel +
// useAgent, planner, policy, runtime, receipts, Undo, the board writer and the Indicators mutation interface). The Agent
// model is a stand-in that is never needed here: every request below is read locally (p.turns() === 0). Assertions are on
// the BOARD — symbols, timeframes, cells, indicator instances and their colours — not only on what was said.
//
// Measured before this work (baseline probe, 2026-10-30): every request in this file went to the model or stopped with a
// question, except where noted.
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

const GREEN = '#2faf68'
const YELLOW = '#facc15'
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart')
const syms = (board, h) => charts(board).map(w => h.charts.read(w.id).symbol)
const tfs = (board, h) => charts(board).map(w => h.charts.read(w.id).tf)
const emaColours = (board, id = 'c') => p.instancesOn(board, id).filter(i => i.defId === 'movingAverage' && i.inputs?.maType === 'ema')
  .map(i => [i.inputs.period, i.inputs.color])
const four = () => FOUR()                                              // SPY QQQ / NVDA TSLA, all daily

describe('A · contextual references', () => {
  it('"make the other one yellow" after "make the 9 green" is the 20 (the indicators the turn before added)', async () => {
    const { say, board } = p.mount(...ONE('BRCB'))
    await say('add the 9 and 20 ema')
    await say('make the 9 green')
    const out = await say('make the other one yellow')
    expect(out).not.toMatch(/Which one/)
    expect(emaColours(board)).toEqual([[9, GREEN], [20, YELLOW]])
    await say('undo')                                                    // one Undo per change, newest first
    expect(emaColours(board)).toEqual([[9, GREEN], [20, '#f0b90b']])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"the other one" with nothing to tell them apart still asks (a turn that touched both picks neither)', async () => {
    const { say, board } = p.mount(...ONE('BRCB'))
    await say('add the 9 and 20 ema')
    const out = await say('make the other one yellow')
    expect(out).toMatch(/Which one — EMA 9 or EMA 20/)
    expect(emaColours(board)).toEqual([[9, '#f0b90b'], [20, '#f0b90b']])
  }, 30000)

  it('"make them weekly" after a grid is the charts that grid named — not the chart that was already there', async () => {
    const { say, board, h } = p.mount(...ONE('BRCB'))
    await say('open daily charts for aapl msft nvda')
    await say('make them weekly')
    expect(syms(board, h)).toEqual(['BRCB', 'AAPL', 'MSFT', 'NVDA'])
    expect(tfs(board, h)).toEqual(['D', 'W', 'W', 'W'])
    await say('undo')
    expect(tfs(board, h)).toEqual(['D', 'D', 'D', 'D'])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"switch em to weekly" with nothing in the conversation to point at asks — no chart changes by guess', async () => {
    const { say, board, h } = p.mount(...four())
    const out = await say('switch em to weekly')
    expect(out).toMatch(/Which charts do you mean by “them”\?.*Nothing has changed/)
    expect(tfs(board, h)).toEqual(['D', 'D', 'D', 'D'])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"them" that means INDICATORS is unchanged ("hide them" after an add hides those two)', async () => {
    const { say } = p.mount(...ONE('BRCB'))
    await say('add the 9 and 20 ema')
    const out = await say('hide them')
    expect(out).toMatch(/Hid EMA 9.*Hid EMA 20/)
  }, 30000)

  it.each([
    ['change the bottom right to amd', ['SPY', 'QQQ', 'NVDA', 'AMD']],
    ['change the first chart to msft', ['MSFT', 'QQQ', 'NVDA', 'TSLA']],
    ['change the top right to AMD', ['SPY', 'AMD', 'NVDA', 'TSLA']],
  ])('"%s" — one chart, named by place or order, its ticker as typed', async (q, want) => {
    const { say, board, h } = p.mount(...four())
    await say(q)
    expect(syms(board, h)).toEqual(want)
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"change to weekly" / "change the bottom right to weekly" stay timeframes (a known word is never a ticker)', () => {
    const { board } = p.mount(...four())
    const ops = (q) => fastParse(q, { host: board.host })?.ops?.map(o => o.action)
    expect(ops('change to weekly')).toEqual(['chart.setTimeframe'])
    expect(ops('change the bottom right to weekly')).toEqual(['chart.setTimeframe'])
    expect(ops('change to candles')).toEqual(['chart.setType'])
  })
})

describe('A · corrections and changes of mind', () => {
  it('"actually, change the second chart instead": my last change is undone, then made on the chart now named', async () => {
    const { say, board, h } = p.mount(...four())
    await say('change the first chart to amd')
    expect(syms(board, h)).toEqual(['AMD', 'QQQ', 'NVDA', 'TSLA'])
    await say('actually, change the second chart instead')
    expect(syms(board, h)).toEqual(['SPY', 'AMD', 'NVDA', 'TSLA'])
    await say('undo')                                                    // the moved change is ONE change
    expect(syms(board, h)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"no, the bottom right one" moves an indicator add; "I meant the NVDA chart" moves a timeframe', async () => {
    const { say, board, h } = p.mount(...four())
    await say('add rsi to the top left chart')
    await say('no, the bottom right one')
    expect(p.instancesOn(board, 'c0').some(i => i.defId === 'rsi')).toBe(false)
    expect(p.instancesOn(board, 'c3').some(i => i.defId === 'rsi')).toBe(true)
    await say('make the top right weekly')
    await say('i meant the NVDA chart')
    expect(tfs(board, h)).toEqual(['D', 'D', 'W', 'D'])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('a correction that names more than a chart is a NEW instruction (read as before), and one that names no chart is not a move', async () => {
    const { say, board, h } = p.mount(...four())
    await say('make the top right weekly')
    await say('actually make the bottom left daily too')                  // not a move: the top right stays weekly
    expect(tfs(board, h)[1]).toBe('W')
  }, 30000)
})

describe('A · Undo of a described change', () => {
  it('"undo just the color change" undoes the newest change when it IS a colour change, and says so when it is not', async () => {
    const { say, board, h } = p.mount(...ONE('BRCB'))
    await say('add the 9 ema')
    await say('make it green')
    await say('weekly')
    let out = await say('undo just the color change')
    expect(out).toMatch(/My last change wasn't a colour change — it was: Switched timeframe to Weekly\. Nothing was undone/)
    expect(h.charts.read('c').tf).toBe('W')
    expect(emaColours(board)).toEqual([[9, GREEN]])
    out = await say('undo the timeframe change')
    expect(h.charts.read('c').tf).toBe('D')
    out = await say('undo just the colour change')
    expect(emaColours(board)).toEqual([[9, '#f0b90b']])                // never an older entry picked out of order
    expect(p.turns()).toBe(0)
  }, 30000)
})

describe('C · flexible language', () => {
  it.each([
    'fast one green slow one yellow',
    'the 9 green, the 20 yellow',
    'fast one green and the slow one yellow',
  ])('verbless colour pairs: "%s"', async (q) => {
    const { say, board } = p.mount(...ONE('BRCB'))
    await say('add the 9 and 20 ema')
    await say(q)
    expect(emaColours(board)).toEqual([[9, GREEN], [20, YELLOW]])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('"slap the 9/20 on all four" adds EMA 9 and 20 to each of the four charts', async () => {
    const { say, board } = p.mount(...four())
    await say('slap the 9/20 on all four')
    for (const id of ['c0', 'c1', 'c2', 'c3']) expect(emaColours(board, id).map(([n]) => n)).toEqual([9, 20])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('a slash is two lengths only after an add verb — a date stays a date', () => {
    const { board } = p.mount(...four())
    expect(fastParse('add the 9/20 ema', { host: board.host })?.ops?.length).toBe(2)
    const d = fastParse('go to 10/29', { host: board.host })
    expect(JSON.stringify(d || null)).not.toMatch(/"period"/)
  })

  it('"put rsi underneath" adds RSI below price — its own receipt, no "All 1 steps done."', async () => {
    const { say, board } = p.mount(...ONE('BRCB'))
    const out = await say('put rsi underneath')
    expect(p.instancesOn(board, 'c').some(i => i.defId === 'rsi')).toBe(true)
    expect(out).toMatch(/Added RSI \(14\)/)
    expect(out).not.toMatch(/All 1 steps/)
    await say('undo')
    expect(p.instancesOn(board, 'c').some(i => i.defId === 'rsi')).toBe(false)
  }, 30000)

  it('"keep the NVDA chart but replace the others with aapl msft and amzn" — the others in reading order, one change', async () => {
    const { say, board, h } = p.mount(...four())
    await say('keep the NVDA chart but replace the others with aapl msft and amzn')
    expect(syms(board, h)).toEqual(['AAPL', 'MSFT', 'NVDA', 'AMZN'])
    await say('undo')
    expect(syms(board, h)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(p.turns()).toBe(0)
  }, 30000)

  it('…and with a different number of tickers than other charts, nothing changes and it says why', async () => {
    const { say, board, h } = p.mount(...four())
    const out = await say('keep the top left but swap the rest for AMD and META')
    expect(out).toMatch(/There are 3 other charts here, and you named 2 tickers .* Nothing has changed/)
    expect(syms(board, h)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
  }, 30000)

  it.each(['make everything look like my NVDA chart', 'make the others look like the NVDA chart'])(
    '"%s" proposes copying the NVDA chart\'s look onto the three other charts (approval kept, nothing applied yet)', async (q) => {
      const { say, board } = p.mount(...four())
      const before = JSON.stringify(board.state.widgets)
      const out = await say(q)
      expect(out).toMatch(/Proposed changes/)
      for (const s of ['SPY', 'QQQ', 'TSLA']) expect(out).toMatch(new RegExp(`Chart \\(${s}\\): Copy the look of Chart \\(NVDA\\)`))
      expect(out).not.toMatch(/Chart \(NVDA\): Copy the look/)
      expect(JSON.stringify(board.state.widgets)).toBe(before)
      expect(p.turns()).toBe(0)
    }, 30000)
})
