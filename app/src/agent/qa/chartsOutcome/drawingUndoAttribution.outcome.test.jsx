// C1-162 (owner 2026-11-10): the Agent's Undo takes back ONLY what the Agent changed. A member's own drawing edit made between an
// Agent change and "undo" is never undone, and when the Agent cannot tell that a drawing is still the one it made (moved, restyled
// or replaced by hand), Undo REFUSES rather than deleting. Over the REAL drawings store. Built from the family: Agent changes (add
// a line, move it, restyle it) × member edits in between (move, restyle, delete-and-redraw, a new line of their own). Evidence: LOCAL
// native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { open, outcomeSuite, afterEachOutcome, chart, drawingsOf, waitFor, screen } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => store.clearAll('NVDA'))

const peek = () => store.peekDrawings('NVDA') || []
const priceOf = (d) => d?.points?.[0]?.price
const LINE = (c, price) => ({ action: 'drawing.addLevel', target: drawingsOf(c, 'NVDA').ref, args: { price, color: null, style: null } })
const MOVE = (c, price) => ({ action: 'drawing.setLevel', target: drawingsOf(c, 'NVDA').ref, args: { drawing: (drawingsOf(c, 'NVDA').drawings || [])[0]?.id, price } })
const board = () => open([chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { extra: { drawings: true } })
// read from the whole transcript: say() cuts at the last "undo", and a refusal itself says "undone"
const said = () => screen.getByTestId('agent-transcript').textContent
const REFUSED = /changed since I made that change|no longer|isn't there|can't undo|Nothing was undone/i

// the member's own edits, through the store's own writers (what the chart's drawing tools call)
const EDITS = {
  'moves the Agent line': (id) => store.updateDrawing('NVDA', id, { points: [{ ...(peek()[0].points[0]), price: 222 }] }),
  'recolours the Agent line': (id) => store.updateDrawing('NVDA', id, { color: '#00ff00' }),
  'deletes it and draws their own at the same price': (id) => { store.removeDrawing('NVDA', id); store.addDrawing('NVDA', { type: 'horizontal', points: [{ price: 200 }] }) },
}

describe('C1-162: Undo never touches a member edit made after the Agent change', () => {
  it.each(Object.keys(EDITS))('the Agent adds a line at 200; the member %s; "undo" refuses and the member\'s drawing stays exactly as they left it', async (edit) => {
    const m = board()
    await m.say('draw a line at 200', (ctx) => [LINE(ctx, 200)])
    await waitFor(() => expect(peek()).toHaveLength(1))
    EDITS[edit](peek()[0].id)
    const after = JSON.stringify(peek())
    const out = await m.say('undo')
    expect(JSON.stringify(peek()), out).toBe(after)
    expect(said().slice(-400), out).toMatch(REFUSED)
  }, 60000)
  it('the Agent moves its line to 210; the member then moves it to 222; "undo" refuses and it stays at 222', async () => {
    const m = board()
    await m.say('draw a line at 200', (ctx) => [LINE(ctx, 200)])
    await waitFor(() => expect(peek()).toHaveLength(1))
    await m.say('move it to 210', (ctx) => [MOVE(ctx, 210)])
    await waitFor(() => expect(priceOf(peek()[0])).toBe(210))
    store.updateDrawing('NVDA', peek()[0].id, { points: [{ ...(peek()[0].points[0]), price: 222 }] })
    const out = await m.say('undo')
    expect(priceOf(peek()[0]), out).toBe(222)
    expect(said().slice(-400), out).toMatch(REFUSED)
  }, 60000)
  it('a line the member drew themselves between the Agent\'s add and "undo" survives; only the Agent\'s line goes', async () => {
    const m = board()
    await m.say('draw a line at 200', (ctx) => [LINE(ctx, 200)])
    await waitFor(() => expect(peek()).toHaveLength(1))
    store.addDrawing('NVDA', { type: 'horizontal', points: [{ price: 150 }] })
    await m.say('undo')
    await waitFor(() => expect(peek().map(priceOf)).toEqual([150]))
  }, 60000)
  it('control: with no member edit in between, "undo" takes the Agent\'s line back', async () => {
    const m = board()
    await m.say('draw a line at 200', (ctx) => [LINE(ctx, 200)])
    await waitFor(() => expect(peek()).toHaveLength(1))
    await m.say('undo')
    await waitFor(() => expect(peek()).toHaveLength(0))
  }, 60000)
})
