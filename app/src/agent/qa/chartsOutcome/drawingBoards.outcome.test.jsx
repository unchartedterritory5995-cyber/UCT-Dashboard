// CHARTS OUTCOME — Drawing Boards (C1-167..170): the state in the REAL drawings store (its tracings layer, the one the
// Drawing Boards panel reads and writes), through the real AgentPanel. Only the model is scripted, from the request's context.
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { buildDrawingBoardSource } from '../../host'
import { ONE_CHART_SAY } from '../../capabilities/drawingBoards'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, must, waitFor, proposalsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)

// the server's copy is what useTracingsSync pushes (exportTracings())
const fetchFn = async () => new Response(JSON.stringify({ tracings_doc: JSON.stringify({ updatedAt: 1, doc: store.exportTracings() }) }), { status: 200 })
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
}
const names = () => store.listTracings().map(t => store.tracingLabel(t))
const activeName = () => store.tracingLabel(store.listTracings().find(t => t.id === store.getActiveTracingId()))
const boardsRef = (ctx) => must(ctx.drawingBoards?.[0]?.ref, 'drawing boards entry')
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
