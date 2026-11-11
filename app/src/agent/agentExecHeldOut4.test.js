// EXECUTION FAMILIES, ROUND 4 — HELD-OUT phrasings (pl-exec, exec-gen-1). Written and committed BEFORE any round 4 change and never
// used to change it; the tune phrasings live in agentExecRound4.test.jsx. Evidence class: SIMULATED (scripted model).

// ── The board's own arrangement, through the real panel: move, resize, link, widget tabs, save the layout, open a list ──
export const BOARD_HELD_OUT = [
  { row: 'C3-002', text: 'shove the news panel over to the right side', action: 'widget.move' },
  { row: 'C3-003', text: 'make the news widget twice as tall', action: 'widget.resize' },
  { row: 'C3-006', text: 'put the news on the green link group', action: 'widget.setLink' },
  { row: 'C3-016', text: 'stack a calendar as a tab on the news widget', action: 'widget.addTab' },
  { row: 'C3-017', text: 'flip the news widget to its calendar tab', action: 'widget.selectTab' },
  { row: 'C3-019', text: 'get rid of the calendar tab on the news widget', action: 'widget.closeTab' },
  { row: 'C3-030', text: 'keep this arrangement in my current layout', action: 'layout.saveCurrent' },
  { row: 'C3-063', text: 'load my Swing list into the watchlist widget', action: 'widget.showList' },
]

// ── Chart P0s through the real panel ──
export const CHART_HELD_OUT = [
  { row: 'C1-019', text: 'show the premarket and after hours on this 5 minute chart', action: 'chart.setSession' },
  { row: 'C1-022', text: 'percentage scale on this chart please', action: 'chart.setScale' },
]

// ── A widget's own item named by its own name, no widget named ("rename my Mine theme set") ──
export const ITEM_HELD_OUT = [
  { text: 'rename my Mine theme set to Growth' },
  { text: 'delete the Mine preset' },
]

import { describe, it, expect } from 'vitest'
describe('round 4 held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...BOARD_HELD_OUT, ...CHART_HELD_OUT, ...ITEM_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
