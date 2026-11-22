// CHARTS OUTCOME — Drawing Boards (C1-167..170): the state in the REAL drawings store (its tracings layer, the one the
// Drawing Boards panel reads and writes), through the real AgentPanel. Only the model is scripted, from the request's context.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import * as store from '../../../components/chart/drawingsStore'
import { buildDrawingBoardSource } from '../../host'
import { ONE_CHART_SAY } from '../../capabilities/drawingBoards'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, must, waitFor, proposalsNow, receiptsNow } from './outcomeHarness'

// the mic: a button that "hears" what the test put in micSays (the real panel's transcript path: agent.send(text, { voice: true }))
const mic = vi.hoisted(() => ({ says: '' }))
vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({
  default: ({ onTranscript }) => <button type="button" data-testid="mic" onClick={() => onTranscript(mic.says)}>mic</button>,
}))
await outcomeSuite()
afterEach(afterEachOutcome)

// the server's copy is what useTracingsSync pushes (exportTracings())
// `server.stale`: the server still holds the copy from before the change (the save was not seen)
const server = { stale: false, doc: null }
const fetchFn = async () => new Response(JSON.stringify({ tracings_doc: JSON.stringify({ updatedAt: 1, doc: server.stale ? server.doc : store.exportTracings() }) }), { status: 200 })
const ids = {}
function seed() {
  localStorage.removeItem('uct-chart-tracings')
  for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL']) store.clearAll(s)
  store._reset()
  ids.swing = store.getActiveTracingId()
  store.renameTracing(ids.swing, 'Swing')
  ids.earnings = store.createTracing({ name: 'Earnings' })
  store.setActiveTracing(ids.earnings)
  store.addDrawing('NVDA', { type: 'horizontal', points: [{ price: 20 }], color: '#fff', lineWidth: 1 })
  store.setActiveTracing(ids.swing)
  server.stale = false
  server.doc = store.exportTracings()
}
const names = () => store.listTracings().map(t => store.tracingLabel(t))
const activeName = () => store.tracingLabel(store.listTracings().find(t => t.id === store.getActiveTracingId()))
const boardsRef = (ctx) => must(ctx.drawingBoards?.[0]?.ref, 'drawing boards entry')
const addTo = (id, sym) => {
  const back = store.getActiveTracingId()
  store.setActiveTracing(id)
  store.addDrawing(sym, { type: 'horizontal', points: [{ price: 40 }], color: '#fff', lineWidth: 1 })
  store.setActiveTracing(back)
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const quad = () => {
  const m = open(QUAD(), QUAD_SYMS, { selected: 'bl' })
  seed()                                   // after the mount: mounting a case starts from an empty localStorage
  m.h.drawingBoards = buildDrawingBoardSource(store, { fetchFn, timeoutMs: 200, everyMs: 5 })
  return m
}

describe('Drawing Boards through the panel', () => {
  it('C1-167 "switch to my Earnings board": every chart draws on it; the receipt says so; "undo" switches back', async () => {
    const m = quad()
    await m.say('switch to my Earnings board')
    await waitFor(() => expect(activeName()).toBe('Earnings'))
    expect(store.peekDrawings('NVDA')).toHaveLength(1)
    expect(m.lastReceipt().textContent).toMatch(/Every chart now shows and draws on “Earnings”/)
    await m.say('undo')
    await waitFor(() => expect(activeName()).toBe('Swing'))
  })

  it('C1-168 a planned "make a new board called Breakouts": created and switched to, as New board does', async () => {
    const m = quad()
    await m.say('make me a new board for breakouts called Breakouts', (c) => [{ action: 'drawing.createBoard', target: boardsRef(c), args: { name: 'Breakouts' } }])
    await waitFor(() => expect(names()).toEqual(['Swing', 'Earnings', 'Breakouts']))
    expect(activeName()).toBe('Breakouts')
    expect(m.lastReceipt().textContent).toMatch(/new drawing board “Breakouts” and switched to it/)
  })

  it('C1-169 "rename my Earnings board to Gaps"', async () => {
    const m = quad()
    await m.say('rename my Earnings board to Gaps')
    await waitFor(() => expect(names()).toEqual(['Swing', 'Gaps']))
    expect(m.lastReceipt().textContent).toMatch(/Renamed the drawing board “Earnings” to “Gaps”/)
  })

  it('C1-170 "delete the Earnings board": a card naming it, its drawings and no Undo; Dismiss keeps it; Apply deletes it', async () => {
    const m = quad()
    await m.say('delete the Earnings board')
    await waitFor(() => expect(m.pending()).toBe(1))
    expect(proposalsNow().at(-1).textContent).toMatch(/Delete the drawing board “Earnings” \(1 drawing on 1 symbol\)\. This can't be undone\./)
    expect(names()).toEqual(['Swing', 'Earnings'])
    await m.dismiss()
    expect(names()).toEqual(['Swing', 'Earnings'])
    await m.say('delete the Earnings board')
    await waitFor(() => expect(m.pending()).toBe(1))
    await m.apply()
    await waitFor(() => expect(names()).toEqual(['Swing']))
    expect(m.lastReceipt().textContent).toMatch(/Deleted the drawing board “Earnings” and its 1 drawing\. This can't be undone\./)
  })

  it('"delete my board" asks with the real names; nothing is deleted and no card is shown', async () => {
    const m = quad()
    const out = await m.say('delete my board')
    expect(out).toMatch(/Which drawing board should I delete\? Your boards: “Swing”, “Earnings”/)
    expect(m.pending()).toBe(0)
    expect(names()).toEqual(['Swing', 'Earnings'])
  })

  it('⛔ wrong target: "switch to my Earnings board on the NVDA chart" changes nothing and says boards are shared', async () => {
    const m = quad()
    const out = await m.say('switch to my Earnings board on the NVDA chart')
    expect(out).toContain(ONE_CHART_SAY)
    expect(activeName()).toBe('Swing')
    expect(m.pending()).toBe(0)
  })
})

// AUDIT T2 conditions for delete (C1-170): the card is re-checked at Apply, only an approval deletes, no Undo is offered or
// claimed, an unconfirmed save never says "deleted", and a spoken request gets the same card.
describe('Drawing Boards: delete, held to the card', () => {
  it('(a) the board gained a drawing after the card: Apply deletes nothing and shows a fresh card with the new count', async () => {
    const m = quad()
    await m.say('delete the Earnings board')
    await waitFor(() => expect(m.pending()).toBe(1))
    expect(proposalsNow().at(-1).textContent).toMatch(/“Earnings” \(1 drawing on 1 symbol\)/)
    addTo(ids.earnings, 'TSLA')                                    // drawn on in the panel while the card was open
    await m.apply()
    expect(names()).toEqual(['Swing', 'Earnings'])
    expect(store.tracingStats(ids.earnings).drawings).toBe(2)
    expect(transcript()).toMatch(/can’t run as you approved it[^]*nothing was changed/)
    await waitFor(() => expect(m.pending()).toBe(1))
    expect(proposalsNow().at(-1).textContent).toMatch(/Delete the drawing board “Earnings” \(2 drawings on 2 symbols\)\. This can't be undone\./)
    await m.apply()                                                // the fresh card, approved as it is now
    await waitFor(() => expect(names()).toEqual(['Swing']))
  })

  it('(b) a model plan that says apply with drawing.deleteBoard is a card, never a deletion', async () => {
    const m = quad()
    await m.say('get rid of earnings please', (c) => [{ action: 'drawing.deleteBoard', target: boardsRef(c), args: { board: 'Earnings' } }])
    await waitFor(() => expect(m.pending()).toBe(1))
    expect(names()).toEqual(['Swing', 'Earnings'])
    expect(receiptsNow().some(r => /Deleted/.test(r.textContent))).toBe(false)
    await m.dismiss()
    expect(names()).toEqual(['Swing', 'Earnings'])
  })

  it('(c) after a delete nothing offers or claims an Undo: no undoable receipt, and "undo" restores nothing', async () => {
    const m = quad()
    await m.say('switch to my Earnings board')                       // an undoable change BEFORE the delete
    await waitFor(() => expect(activeName()).toBe('Earnings'))
    await m.say('delete the Swing board')
    await waitFor(() => expect(m.pending()).toBe(1))
    await m.apply()
    await waitFor(() => expect(names()).toEqual(['Earnings']))
    const r = m.lastReceipt()
    expect(r.textContent).toMatch(/This can't be undone\./)
    expect(r.getAttribute('data-undoable')).not.toBe('true')
    expect(r.querySelector('button') && [...r.querySelectorAll('button')].some(b => /undo/i.test(b.textContent + (b.getAttribute('aria-label') || '')))).toBeFalsy()
    const before = receiptsNow().length
    const out = await m.say('undo')
    expect(names()).toEqual(['Earnings'])                             // the deleted board is not back
    expect(String(out)).not.toMatch(/restored|brought back|undid the delet|“Swing” is back/i)
    expect(receiptsNow().slice(before).some(x => /Swing/.test(x.textContent))).toBe(false)
  })

  it('(d) the server never shows the delete: the reply says it was not confirmed and never says "deleted"', async () => {
    const m = quad()
    server.stale = true
    await m.say('delete the Earnings board')
    await waitFor(() => expect(m.pending()).toBe(1))
    await m.apply()
    await waitFor(() => expect(names()).toEqual(['Swing']))
    await waitFor(() => expect(m.lastReceipt()?.textContent || '').toMatch(/couldn't confirm the change reached your account/))
    expect(m.lastReceipt().textContent).not.toMatch(/delet/i)
    expect(receiptsNow().some(x => /delet/i.test(x.textContent))).toBe(false)
  })

  it('(e) spoken: "delete the Earnings board" gets the card; "delete the board" asks; nothing is deleted', async () => {
    const m = quad()
    mic.says = 'delete the Earnings board'
    fireEvent.click(screen.getByTestId('mic'))
    await m.p.idle()
    await waitFor(() => expect(m.pending()).toBe(1))
    expect(proposalsNow().at(-1).textContent).toMatch(/Delete the drawing board “Earnings” \(1 drawing on 1 symbol\)/)
    expect(names()).toEqual(['Swing', 'Earnings'])
    await m.dismiss()
    mic.says = 'delete the board'
    fireEvent.click(screen.getByTestId('mic'))
    await m.p.idle()
    await waitFor(() => expect(transcript()).toMatch(/Which drawing board should I delete\?/))
    expect(m.pending()).toBe(0)
    expect(names()).toEqual(['Swing', 'Earnings'])
  })
})
