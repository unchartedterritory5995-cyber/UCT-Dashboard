// ── optsSig: a null opts key is the same widget as an absent one (v1 regression; review #775 split-out) ─────────────
//
// The board's widget fingerprint (host.js buildWidgetSource → optsSig) feeds the stale-Undo check for widgets the Agent
// created (workspace.js) and the approval binding of layout saves (layout.js). Undoing an indicator added to a chart
// whose settings were NEVER persisted writes `settings: null` back onto that chart's opts — the same chart, nothing a
// member did. Before this fix the fingerprint read that as a later edit, so the Undo of the chart's own creation was
// refused as "changed since" and the new chart stayed. Found by the planner v2 acceptance set (F01, "undo all"); this is
// the v1 path, through the REAL panel (legacy model turns, scripted envelopes; no model call).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const ONE = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } }], { 'N:c': 'NVDA' }]
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart').map(w => w.id)
const editsRef = (body, sym) => (body.context.indicatorEdits || []).find(e => String(e.chart || '').includes(sym) || e.symbol === sym)?.ref

describe('optsSig — a null opts key reads as absent', () => {
  it('v1: add a chart, add an EMA to it, undo, undo → the new chart is gone (not refused as "changed since")', async () => {
    const { say, board } = p.mount(...ONE())
    p.st.envelopes.push( (body) => p.env('apply', [{ action: 'widget.addCharts', target: body.context.workspace?.ref || 'w1', args: { symbols: ['AAPL'], timeframe: null, chart_type: null, exact: null } }]))
    await say('pop an apple panel onto my board')
    expect(charts(board)).toHaveLength(2)
    const added = charts(board).find(id => id !== 'c')
    p.st.selected = added                              // the member clicked the new chart (no which-chart question)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicator.add', target: editsRef(body, 'AAPL'), args: { defId: 'movingAverage', inputs: [{ key: 'period', value: 10 }, { key: 'maType', value: 'ema' }] } }]))
    await say('give the apple panel a ten period exponential average')
    expect(p.brief(board, added).join()).toMatch(/\b10\b/)
    await say('undo')
    expect(p.brief(board, added).join()).not.toMatch(/\b10\b/)
    await say('undo')
    expect(charts(board)).toEqual(['c'])
  }, 30000)
})
