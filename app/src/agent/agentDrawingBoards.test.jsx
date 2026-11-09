// DRAWING BOARDS (pl-exec round 8; C1-167 switch, C1-168 create, C1-169 rename, C1-170 delete) through the REAL panel and the
// product's own board store (drawingsStore: setActiveTracing / createTracing / renameTracing / deleteTracing), read back from the
// store the Drawing Boards panel draws from. Switch / create / rename undo exactly; delete is shown first and has no Undo.
// Held-out: agentDrawingBoardsHeldOut (committed first). Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL /
// SIMULATED (scripted plans).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import * as store from '../components/chart/drawingsStore'
import { BOARD_HELD_OUT } from './agentDrawingBoardsHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => {
  p = setupPanel()
  localStorage.clear()
})
afterEach(() => { vi.restoreAllMocks(); cleanup(); localStorage.clear() })

// the member's two boards: "Swing" (active, the default board renamed) and "Earnings"
function boards() {
  store.renameTracing(store.getActiveTracingId(), 'Swing')
  store.createTracing({ name: 'Earnings' })
}
const names = () => store.listTracings().map(t => store.tracingLabel(t))
const active = () => store.tracingLabel(store.listTracings().find(t => t.id === store.getActiveTracingId()))
const plan = (c) => (body) => p.env(c.op === 'delete' ? 'propose' : 'apply', [{ action: 'drawingBoard.set', target: body.context.drawingBoards[0].ref, args: { op: c.op, board: c.board, name: c.name } }])
async function say(text, c) {
  const [w, s] = ONE('SPY')
  const m = p.mount(w, s)
  boards()
  p.st.envelopes.push(plan(c))
  const out = await m.say(text)
  return { m, out }
}
const holds = (want) => (!want.active || active() === want.active) && (!want.has || names().includes(want.has)) && (!want.not || !names().includes(want.not))

describe('Drawing Boards through the panel', () => {
  it.each(BOARD_HELD_OUT.filter(c => c.op !== 'delete').map(c => [c.id, c.text, c]))('%s "%s": the board panel reads it; Undo puts it back', async (_id, _t, c) => {
    const { m, out } = await say(c.text, c)
    expect(holds(c.want), `${JSON.stringify({ names: names(), active: active() })} | ${out}`).toBe(true)
    const before = { names: ['Swing', 'Earnings'], active: 'Swing' }
    await m.say('undo')
    expect({ names: names(), active: active() }).toEqual(before)
  }, 40000)
  it.each(BOARD_HELD_OUT.filter(c => c.op === 'delete').map(c => [c.id, c.text, c]))('%s "%s": shown first; nothing deleted before Apply; on Apply it is gone; no Undo', async (_id, _t, c) => {
    const { m, out } = await say(c.text, c)
    expect(out).toMatch(/Apply|card|first/i)
    expect(names()).toContain('Earnings')
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1))
    await p.idle()
    expect(holds(c.want), JSON.stringify(names())).toBe(true)
    const u = await m.say('undo')
    expect(names()).not.toContain('Earnings')
    expect(u).not.toMatch(/did not change/)
  }, 40000)
  // ⛔ AUDIT R8-D1 (BLOCKER, data loss): the Undo of a create deletes the board only while it is EMPTY. Created, switched to,
  // drawn on, then "undo" twice: the first takes back the switch (the drawings stay on the board, archived); the second would
  // delete the board, so it is refused with the reason and nothing is deleted.
  it('R8-D1 create a board, switch to it, draw on it, then undo twice: the board and its drawing are kept; Undo says why', async () => {
    const [w, s] = ONE('SPY')
    const m = p.mount(w, s)
    boards()
    const run = async (c, text) => { p.st.envelopes.length = 0; p.st.envelopes.push(plan(c)); return m.say(text) }
    await run({ op: 'create', board: null, name: 'Scratch' }, 'make a new drawing board called Scratch')
    await run({ op: 'switch', board: 'Scratch', name: null }, 'switch to the Scratch drawing board')
    expect(active()).toBe('Scratch')
    const scratch = store.listTracings().find(t => store.tracingLabel(t) === 'Scratch').id
    store.addDrawing('SPY', { type: 'horizontal', points: [{ price: 123 }] })          // the member draws on the new board
    expect(store.tracingStats(scratch).drawings).toBe(1)
    await m.say('undo')                                                               // takes back the switch only
    expect(active()).toBe('Swing')
    expect(store.tracingStats(scratch).drawings).toBe(1)
    const WHY = 'The drawing board “Scratch” has drawings on it now'
    expect(document.body.textContent).not.toContain(WHY)
    await m.say('undo')                                                               // would delete Scratch and its drawing
    // (read from the whole transcript: say() cuts at the last "undo", and the refusal itself says "undone")
    expect(document.body.textContent).toContain('The drawing board “Scratch” has drawings on it now, so Undo won\'t delete it (that would delete those drawings too). Nothing was undone. Delete the board yourself if you mean to.')
    expect(names()).toEqual(['Swing', 'Earnings', 'Scratch'])
    expect(store.tracingStats(scratch).drawings).toBe(1)
    expect(store.peekTracingDrawings(scratch, 'SPY').map(d => d.points?.[0]?.price)).toEqual([123])
  }, 40000)
  it('R8-D1 an EMPTY new board is still taken back by Undo (the guard refuses only when it would lose drawings)', async () => {
    const [w, s] = ONE('SPY')
    const m = p.mount(w, s)
    boards()
    p.st.envelopes.push(plan({ op: 'create', board: null, name: 'Scratch' }))
    await m.say('make a new drawing board called Scratch')
    expect(names()).toEqual(['Swing', 'Earnings', 'Scratch'])
    await m.say('undo')
    expect(names()).toEqual(['Swing', 'Earnings'])
  }, 40000)
  it('NEGATIVE: a board that does not exist, an ambiguous part of a name, a taken name, the last board — refused, nothing changes', async () => {
    const [w, s] = ONE('SPY')
    const m = p.mount(w, s)
    boards()
    const cases = [
      [{ op: 'switch', board: 'Crypto', name: null }, /no drawing board “Crypto”.*Swing.*Earnings/],
      [{ op: 'rename', board: 'Swing', name: 'Earnings' }, /already have a drawing board named “Earnings”/],
      [{ op: 'create', board: null, name: 'swing' }, /already have a drawing board named “swing”/],
    ]
    for (const [c, why] of cases) {
      p.st.envelopes.length = 0
      p.st.envelopes.push(plan(c))
      expect(await m.say('change the drawing board please')).toMatch(why)
    }
    store.deleteTracing(store.listTracings().find(t => store.tracingLabel(t) === 'Earnings').id)
    p.st.envelopes.length = 0
    p.st.envelopes.push(plan({ op: 'delete', board: 'Swing', name: null }))
    expect(await m.say('remove that drawing board please')).toMatch(/only drawing board/)
    expect(names()).toEqual(['Swing'])
  }, 40000)
})
