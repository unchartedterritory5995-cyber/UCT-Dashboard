// W1-B (Wave 1, BOARD B-07) — the OPERATOR half of the owner's flagship scenario, deterministically, through the REAL
// panel (panelHarness: AgentPanel + useAgent, planner, policy, runtime, receipts, Undo; the fixture board's real placement
// and board writer; the real Indicators mutation interface) with the SCRIPTED model (no paid call):
//   1. one plan: open two charts in the bottom row (NVDA, AMD) and put the 9 and 20 EMA on both — existing
//      capabilities (widget.add + chart.setSymbol + indicator.add); applied at once (local + reversible): receipts, no card
//   2. save the layout as "Momentum Review" (layout.saveAs — `exclusive`, so it is its own plan): exactly ONE approval card
//   3. Undo takes the operator steps back exactly (the board as it was) — before the save: once a layout is saved and
//      opened, an Undo of the build would reach across the layout switch, which the Agent never does
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// the member's board: ONE chart across the top half; the bottom half is empty — where two charts go
const TOP = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 10, color: 'N', opts: { settings: bareSettings() } }], { 'N:c': 'SPY' }]
const shape = (board) => JSON.stringify(board.state.widgets.map(w => [w.id, w.type, w.x, w.y, w.w, w.h, w.color, JSON.stringify(w.opts ?? null)]).sort())
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const cards = () => screen.queryAllByTestId('agent-proposal').length
const ema = (n) => ({ defId: 'movingAverage', inputs: [{ key: 'period', value: n }, { key: 'maType', value: 'ema' }] })

const BUILD = [
  { action: 'widget.add', target: 'workspace', args: { type: 'chart', as: 'n0' } },
  { action: 'widget.add', target: 'workspace', args: { type: 'chart', as: 'n1' } },
  { action: 'chart.setSymbol', target: 'n0', args: { symbol: 'NVDA' } },
  { action: 'chart.setSymbol', target: 'n1', args: { symbol: 'AMD' } },
  { action: 'indicator.add', target: 'n0', args: ema(9) }, { action: 'indicator.add', target: 'n0', args: ema(20) },
  { action: 'indicator.add', target: 'n1', args: ema(9) }, { action: 'indicator.add', target: 'n1', args: ema(20) },
]

describe('flagship (operator half): two charts in the bottom row + 9/20 EMA on both + save as "Momentum Review"', () => {
  it('one scripted plan builds it with receipts and no card; the save is the ONE approval card; Undo restores the board exactly', async () => {
    const [widgets, syms] = TOP()
    const { say, click, board, h } = p.mount(widgets, syms, { layouts: { entries: [{ id: 1, name: 'Main' }], active: 1, boards: { 1: widgets } } })
    // this member's NEW charts start bare (the classic EMA 9/20 + SMA 50/200 removed, as the harness's other boards are) — so
    // "the 9 and 20 ema on both" is an add, not a duplicate of what a default chart already draws (handleAddWidget's own init opts)
    const addWidget = board.widgetOps.add
    board.widgetOps.add = (type, slot, init) => addWidget(type, slot, type === 'chart' ? { ...(init || {}), opts: { ...(init?.tf ? { tf: init.tf } : {}), settings: bareSettings() } } : init)
    const before = shape(board)

    // ── 1. the build: one plan, applied at once (every action local + reversible) ──
    p.st.envelopes.push(p.env('apply', BUILD))
    const built = await say('open NVDA and AMD charts in the bottom row with the 9 and 20 ema on both')
    expect(built).not.toMatch(/didn't change anything|not on the workspace|Which charts/i)
    expect(cards()).toBe(0)
    const cs = charts(board)
    expect(cs).toHaveLength(3)
    expect(cs[0].id).toBe('c')                                                 // the member's chart stays where it was
    const added = cs.slice(1)
    expect(added.map(w => h.charts.read(w.id).symbol).sort()).toEqual(['AMD', 'NVDA'])
    for (const w of added) {
      expect(w.y).toBeGreaterThanOrEqual(10)                                    // the bottom row: in the empty space, nothing moved
      expect(p.brief(board, w.id)).toEqual(['movingAverage(9 ema)', 'movingAverage(20 ema)'])
    }
    expect(p.brief(board, 'c')).toEqual([])                                     // the top chart untouched
    expect(board.state.widgets.find(w => w.id === 'c')).toMatchObject({ x: 0, y: 0, w: 24, h: 10 })
    // receipts for what landed
    expect(transcript()).toMatch(/Added (an |a )?(EMA|Moving Average|movingAverage)/i)
    expect(transcript()).toMatch(/NVDA/)
    expect(transcript()).toMatch(/AMD/)
    expect(p.turns()).toBe(1)

    // ── 2. Undo: the operator steps, newest first — the board exactly as it was (every step reversible, by its own kind) ──
    for (let i = 0; i < 12 && shape(board) !== before; i++) await say('undo')
    expect(shape(board)).toBe(before)
    expect(h.charts.read('c').symbol).toBe('SPY')
    expect(p.turns()).toBe(1)
    // …and the same plan builds it again (the second time through the same path: receipts, no card)
    p.st.envelopes.push(p.env('apply', BUILD))
    await say('open NVDA and AMD charts in the bottom row with the 9 and 20 ema on both')
    expect(charts(board)).toHaveLength(3)
    for (const w of charts(board).slice(1)) expect(p.brief(board, w.id)).toEqual(['movingAverage(9 ema)', 'movingAverage(20 ema)'])
    expect(cards()).toBe(0)

    // ── 3. the save: layout.saveAs is `exclusive` (its own plan) and risk confirm → exactly one card ──
    p.st.envelopes.push(p.env('propose', [{ action: 'layout.saveAs', target: 'layouts', args: { name: 'Momentum Review' } }]))
    const proposed = await say('save this layout as Momentum Review')
    expect(cards()).toBe(1)
    expect(proposed).toMatch(/Momentum Review/)
    expect(board.state.layouts.entries.map(e => e.name)).toEqual(['Main'])     // proposed: nothing saved yet
    await click('Apply')                                                      // (the approved card stays in the transcript, resolved)
    expect(board.state.layouts.entries.map(e => e.name)).toEqual(['Main', 'Momentum Review'])
    expect(board.state.layouts.calls).toContainEqual(['saveAs', 'Momentum Review'])
    const saved = board.state.layouts.entries.find(e => e.name === 'Momentum Review')
    expect(board.state.layouts.boards[saved.id].filter(w => w.type === 'chart')).toHaveLength(3)
    expect(transcript()).toMatch(/Momentum Review/)
    expect(p.turns()).toBeLessThanOrEqual(3)
    // the saved layout holds the built board; the open layout is now "Momentum Review" — an Undo of the build would reach
    // across that switch, which the Agent never does (its earlier changes belong to the board they were made on)
    expect(board.state.layouts.activeId).toBe(saved.id)
    expect(charts(board)).toHaveLength(3)
  }, 120000)
})
