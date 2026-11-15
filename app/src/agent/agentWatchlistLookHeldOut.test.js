// WATCHLIST EXECUTION, group C (look) and B (Flagged's name) — pl-widget, agent/pl/exec-widget-actions. HELD-OUT phrasings,
// written as FAMILIES before the change and never used to tune it:
//   C3-103 the list's appearance (logos, tick-flash tint, canvas / text / gain / loss colours) through the ⚙ panel's own writer
//   C3-104 save the current look under a name, apply a saved look, delete one (the ⚙ panel's Templates menu)
//   C3-074 rename the Flagged list (its title menu's Rename), only while the widget shows Flagged
// args = what a correct plan carries (widget.setOption { key, value }); want = what the widget then reads back.
export const APPEARANCE_HELD_OUT = [
  { row: 'C3-103', text: 'hide the logos in my watchlist', args: { key: 'showLogos', value: false }, want: { showLogos: false } },
  { row: 'C3-103', text: 'turn off the tick flash on the watchlist widget', args: { key: 'tint', value: 'off' }, want: { tint: false } },
  { row: 'C3-103', text: 'make the watchlist background navy', args: { key: 'canvasColor', value: '#000080' }, want: { canvasColor: '#000080' } },
  { row: 'C3-103', text: 'watchlist text in white please', args: { key: 'textColor', value: '#fff' }, want: { textColor: '#ffffff' } },
  { row: 'C3-103', text: 'color the gainers on my watchlist teal', args: { key: 'gainColor', value: '#008080' }, want: { gainColor: '#008080' } },
  { row: 'C3-103', text: 'make losers orange in the watchlist widget', args: { key: 'lossColor', value: '#FFA500' }, want: { lossColor: '#ffa500' } },
]
export const LOOK_HELD_OUT = [
  { row: 'C3-104', text: 'save this watchlist look as Night Desk', args: { key: 'looks', value: 'create:Night Desk' }, saves: 'Night Desk' },
  { row: 'C3-104', text: 'store my watchlist style as a template called Clean', args: { key: 'looks', value: 'create:Clean' }, saves: 'Clean' },
  { row: 'C3-104', text: 'apply my Paper look to the watchlist', args: { key: 'look', value: 'Paper' }, applies: 'Paper' },
  { row: 'C3-104', text: 'switch the watchlist to the paper template', args: { key: 'look', value: 'paper' }, applies: 'Paper' },
  { row: 'C3-104', text: 'delete the Paper watchlist look', args: { key: 'looks', value: 'delete:Paper' }, deletes: 'Paper' },
]
export const FLAGGED_NAME_HELD_OUT = [
  { row: 'C3-074', text: 'rename my flagged list to Hot Hands', args: { key: 'flaggedName', value: 'Hot Hands' }, want: 'Hot Hands' },
  { row: 'C3-074', text: 'call the flagged watchlist A-List', args: { key: 'flaggedName', value: 'A-List' }, want: 'A-List' },
]
export const LOOK_REFUSE_HELD_OUT = [
  { row: 'C3-103', text: 'make the watchlist background sort of bluish', args: { key: 'canvasColor', value: 'bluish' }, refuse: /#rrggbb/ },
  { row: 'C3-104', text: 'apply my Neon look to the watchlist', args: { key: 'look', value: 'Neon' }, refuse: /Paper/ },
  { row: 'C3-104', text: 'save this watchlist look', args: { key: 'looks', value: 'create' }, refuse: /name/ },
  // the Flagged Rename is on the widget only while it shows Flagged
  { row: 'C3-074', text: 'rename flagged to Movers', args: { key: 'flaggedName', value: 'Movers' }, refuse: /Flagged first/, notFlagged: true },
]

import { describe, it, expect } from 'vitest'
describe('watchlist group C / B held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...APPEARANCE_HELD_OUT, ...LOOK_HELD_OUT, ...FLAGGED_NAME_HELD_OUT, ...LOOK_REFUSE_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
