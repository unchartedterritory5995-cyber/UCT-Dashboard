// DRAWING MANAGEMENT ACROSS CHARTS — HELD-OUT phrasings (pl-exec round 8, family 5; branch agent/pl/r8-drawings). Written and
// committed BEFORE the family's tests, never used to tune them. Board QUAD (tl SPY, tr QQQ, bl NVDA, br TSLA); each case first
// draws a horizontal line at 200 on `on`'s symbol (and one at 150 on SPY, the decoy), then says `text`.
// `op`: hide | show | lock | unlock | hideAll | showAll; `on`: the chart meant ('sel' = the clicked one).
export const DRAW_HELD_OUT = [
  { id: 'd1', click: 'bl', on: 'sel', text: 'hide that line on this chart for now', op: 'hide' },
  { id: 'd2', click: null, on: 'tr', text: 'lock the line on the QQQ chart so I can\'t move it', op: 'lock' },
  { id: 'd3', click: 'br', on: 'sel', text: 'hide every drawing on this one', op: 'hideAll' },
  { id: 'd4', click: null, on: 'bl', text: 'put all the drawings on the bottom left chart back', op: 'showAll' },
  { id: 'd5', click: 'tr', on: 'sel', text: 'unlock my line here', op: 'unlock' },
  { id: 'd6', click: null, on: 'br', text: 'show the hidden line on TSLA again', op: 'show' },
]

import { describe, it, expect } from 'vitest'
describe('drawing management held-out set is frozen data', () => {
  it('ids are unique', () => { expect(new Set(DRAW_HELD_OUT.map(c => c.id)).size).toBe(DRAW_HELD_OUT.length) })
})
