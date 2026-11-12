// Drawing Boards execution (C1-167 switch, C1-168 create, C1-169 rename, C1-170 delete).
// CI trigger 11-12: the master re-merge (dcfe73fbfc, barStore only) and the ChartToolbar fix touched no Agent path, so this line starts the agent ci push run.
// The Agent writes through the Boards panel's own store writers (host.drawingBoards → drawingsStore), reads the result
// back, and waits for the server's tracings_doc. Delete is always a confirmation card that names the board and its
// drawings and has no Undo. An unnamed or ambiguous board is asked about, never picked, and a board request aimed at
// one chart is answered, never run (boards are shared by every chart).
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability, getTargetKind, buildContext } from './capabilities'
import { planOps, collectTargets } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { buildDrawingBoardSource } from './host'
import { ONE_CHART_SAY } from './capabilities/drawingBoards'
import * as store from '../components/chart/drawingsStore'
import TracingsPanel from '../components/chart/TracingsPanel'

registerBuiltins()
const CTX = { surface: 'charts' }

// the server's copy: what useTracingsSync pushed (exportTracings()), or a stale one
let serverStale = false
let staleDoc = null
const fetchFn = async () => new Response(JSON.stringify({ tracings_doc: JSON.stringify({ updatedAt: 1, doc: serverStale ? staleDoc : store.exportTracings() }) }), { status: 200 })
const makeHost = () => ({ drawingBoards: buildDrawingBoardSource(store, { fetchFn, timeoutMs: 40, everyMs: 5 }) })

const ids = {}
beforeEach(() => {
  localStorage.clear()
  store._reset()
  serverStale = false
  // three boards: "Swing" (active, 1 drawing), "Earnings" (2 drawings on 2 symbols), and an unnamed one ("Board 3")
  ids.swing = store.getActiveTracingId()
  store.renameTracing(ids.swing, 'Swing')
  store.addDrawing('AAPL', { type: 'horizontal', points: [{ price: 10 }], color: '#fff', lineWidth: 1 })
  ids.earnings = store.createTracing({ name: 'Earnings' })
  store.setActiveTracing(ids.earnings)
  store.addDrawing('NVDA', { type: 'horizontal', points: [{ price: 20 }], color: '#fff', lineWidth: 1 })
  store.addDrawing('MSFT', { type: 'horizontal', points: [{ price: 30 }], color: '#fff', lineWidth: 1 })
  ids.third = store.createTracing()
  store.setActiveTracing(ids.swing)
  staleDoc = store.exportTracings()
})

const opsOf = (host, text) => {
  const f = fastParse(text, { host })
  return f && f.kind === 'ops' ? f.ops.map(o => ({ ...o, target: 'drawingBoards' })) : f
}
const plan = (host, ops) => planOps(collectTargets(host, ['drawingBoards']), ops, {}, CTX)
const addTo = (id, sym) => {
  const back = store.getActiveTracingId()
  store.setActiveTracing(id)
  store.addDrawing(sym, { type: 'horizontal', points: [{ price: 40 }], color: '#fff', lineWidth: 1 })
  store.setActiveTracing(back)
}
const names = () => store.listTracings().map(t => store.tracingLabel(t))

describe('Drawing Boards: switch, create, rename (applied, read back, exact Undo)', () => {
  it('C1-167 "switch to my Earnings board": the panel\'s own switch, every chart; the panel shows it; Undo switches back', async () => {
    const host = makeHost()
    const ops = opsOf(host, 'switch to my Earnings board')
    expect(ops).toEqual([{ action: 'drawing.setActiveBoard', target: 'drawingBoards', args: { board: 'Earnings' } }])
    const p = plan(host, ops)
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('apply')
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(store.getActiveTracingId()).toBe(ids.earnings)
    expect(store.peekDrawings('NVDA')).toHaveLength(1)                 // the Earnings drawings are the live ones now
    expect(res.lines.join(' ')).toMatch(/“Swing” → “Earnings”\. Every chart now shows and draws on “Earnings”\.$/)
    // the member's own panel reads the same store: the Earnings row is the pressed one
    render(<TracingsPanel currentSym="NVDA" />)
    expect(screen.getByText('Earnings').closest('button').getAttribute('aria-pressed')).toBe('true')
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(true)
    expect(store.getActiveTracingId()).toBe(ids.swing)
  })

  it('C1-168 "create a new drawing board called Breakouts": New board, then switched to it; Undo removes it while empty', async () => {
    const host = makeHost()
    const ops = opsOf(host, 'Create a new drawing board called Breakouts')
    expect(ops[0]).toMatchObject({ action: 'drawing.createBoard', args: { name: 'Breakouts' } })
    const p = plan(host, ops)
    expect(decideMode('apply', p)).toBe('apply')
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3', 'Breakouts'])
    expect(store.tracingLabel(store.listTracings().find(t => t.id === store.getActiveTracingId()))).toBe('Breakouts')
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(true)
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3'])
    expect(store.getActiveTracingId()).toBe(ids.swing)
  })

  it('C1-169 "rename Board 3 to Gaps": the row\'s rename; a name another board has is refused; Undo names it back', async () => {
    const host = makeHost()
    const ops = opsOf(host, 'rename Board 3 to Gaps')
    expect(ops[0]).toMatchObject({ action: 'drawing.renameBoard', args: { board: 'Board 3', to: 'Gaps' } })
    const res = await commitPlan(host, plan(host, ops))
    expect(res.ok).toBe(true)
    expect(names()).toEqual(['Swing', 'Earnings', 'Gaps'])
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3'])
    const clash = plan(host, [{ action: 'drawing.renameBoard', target: 'drawingBoards', args: { board: 'Board 3', to: 'swing' } }])
    expect(clash.ok).toBe(false)
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3'])
  })

  it('a receipt claims the account save only when the server\'s copy holds it', async () => {
    serverStale = true
    const host = makeHost()
    const res = await commitPlan(host, plan(host, opsOf(host, 'switch to my Earnings board')))
    expect(res.ok).toBe(true)
    expect(res.lines.join(' ')).toMatch(/saving it to your account was not confirmed yet/)
  })
})

describe('Drawing Boards: delete (a card that names the board, no Undo)', () => {
  it('C1-170 "delete the Earnings board": a card naming it and its drawings; nothing goes before Apply; no Undo', async () => {
    const host = makeHost()
    const ops = opsOf(host, 'delete the Earnings board')
    expect(ops).toEqual([{ action: 'drawing.deleteBoard', target: 'drawingBoards', args: { board: 'Earnings' } }])
    const p = plan(host, ops)
    expect(p.ok).toBe(true)
    // the model's "apply" and the fast path's both come out as a card
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines.join(' ')).toBe('Delete the drawing board “Earnings” (2 drawings on 2 symbols). This can\'t be undone.')
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3'])             // planning deleted nothing
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(names()).toEqual(['Swing', 'Board 2'])                     // the unnamed board is numbered by its place, as in the panel
    expect(res.undo).toBeNull()
    expect(res.lines.join(' ')).not.toMatch(/undo it|Undo/)          // the receipt offers no Undo
    expect(res.lines.join(' ')).toMatch(/Deleted the drawing board “Earnings” and its 2 drawings\. This can't be undone\./)
  })

  it('"delete my board" / "delete this board" with several boards ASKS with the real names; nothing is deleted', () => {
    const host = makeHost()
    for (const t of ['delete my board', 'Delete this board', 'delete the current drawing board', 'remove the active board']) {
      const f = fastParse(t, { host })
      expect(f.kind).toBe('say')
      expect(f.text).toMatch(/^Which drawing board should I delete\? Your boards: “Swing”, “Earnings”, “Board 3”\./)
    }
    // a model op without a real board name is refused with the names too, never resolved to one
    const p = plan(host, [{ action: 'drawing.deleteBoard', target: 'drawingBoards', args: { board: 'my board' } }])
    expect(p.ok).toBe(false)
    expect(JSON.stringify(p)).toMatch(/Your boards: “Swing”, “Earnings”, “Board 3”/)
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3'])
  })

  it('two boards with one name: asked, never picked', () => {
    store.renameTracing(ids.third, 'Earnings')
    const host = makeHost()
    expect(fastParse('delete the Earnings board', { host })?.ops?.[0]?.action).not.toBe('drawing.deleteBoard')
    const p = plan(host, [{ action: 'drawing.deleteBoard', target: 'drawingBoards', args: { board: 'Earnings' } }])
    expect(p.ok).toBe(false)
    expect(JSON.stringify(p)).toMatch(/2 boards named “Earnings”/)
    expect(store.listTracings()).toHaveLength(3)
  })

  it('the board you draw on goes only by its name, as the panel allows, and the card says what you draw on next', async () => {
    const host = makeHost()
    const p = plan(host, opsOf(host, 'delete the Swing board'))
    expect(p.lines.join(' ')).toBe('Delete the drawing board “Swing” (1 drawing on 1 symbol). This can\'t be undone. It\'s the board you draw on now; afterwards you\'ll draw on “Earnings”.')
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(store.getActiveTracingId()).toBe(ids.earnings)               // the panel's own fallback: the first board left
  })

  it('a board that changed after the card was shown is not deleted', async () => {
    const host = makeHost()
    const p = plan(host, opsOf(host, 'delete the Earnings board'))
    store.setActiveTracing(ids.earnings)
    store.addDrawing('TSLA', { type: 'horizontal', points: [{ price: 40 }], color: '#fff', lineWidth: 1 })
    store.setActiveTracing(ids.swing)
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res.failed)).toMatch(/changed/)
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3'])
    expect(store.tracingStats(ids.earnings).drawings).toBe(3)
  })

  it('the delete writer itself re-checks the board against the card (the last guard before deleteTracing)', async () => {
    const host = makeHost()
    const kind = getTargetKind('drawingBoards')
    const p = plan(host, opsOf(host, 'delete the Earnings board'))
    const patch = p.plans[0].patch
    expect(patch.remove).toMatchObject({ id: ids.earnings, label: 'Earnings', drawings: 2, wasActive: false })
    addTo(ids.earnings, 'TSLA')
    await expect(kind.commit(host, 'drawingBoards', patch)).rejects.toThrow(/“Earnings” changed since you saw the card, so nothing was deleted/)
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3'])
    // the same board, unchanged: the writer deletes it
    const fresh = plan(host, opsOf(host, 'delete the Earnings board')).plans[0].patch
    await kind.commit(host, 'drawingBoards', fresh)
    expect(names()).toEqual(['Swing', 'Board 2'])
  })

  it('the Apply-time re-check also holds for a rename or a switch of active board after the card', async () => {
    for (const change of [() => store.renameTracing(ids.earnings, 'Earnings 2'), () => store.setActiveTracing(ids.earnings)]) {
      store._reset(); localStorage.clear()
      ids.swing = store.getActiveTracingId(); store.renameTracing(ids.swing, 'Swing')
      ids.earnings = store.createTracing({ name: 'Earnings' })
      const host = makeHost()
      const p = plan(host, opsOf(host, 'delete the Earnings board'))
      change()
      const res = await commitPlan(host, p)
      expect(res.ok).toBe(false)
      expect(store.listTracings()).toHaveLength(2)
    }
  })

  it('save not seen after a delete: the receipt says it was not confirmed, never "deleted", and still no Undo', async () => {
    serverStale = true
    const host = makeHost()
    const res = await commitPlan(host, plan(host, opsOf(host, 'delete the Earnings board')))
    expect(res.ok).toBe(true)
    expect(names()).toEqual(['Swing', 'Board 2'])
    const said = res.lines.join(' ')
    expect(said).toMatch(/^“Earnings” is gone from Drawing Boards on this device, but I couldn't confirm the change reached your account yet/)
    expect(said).not.toMatch(/delet/i)
    expect(said).toMatch(/This can't be undone./)
    expect(res.undo).toBeNull()
  })

  it('no Undo exists for a delete: the capability says none, and the kind gives no undo patch', () => {
    const c = getCapability('drawing.deleteBoard')
    expect(c.undo).toBe('none')
    expect(getTargetKind('drawingBoards').undoPatch({ patch: { remove: { id: 'x', label: 'X', drawings: 0, wasActive: false } } })).toBeNull()
  })

  it('the last board is never deleted', () => {
    store.deleteTracing(ids.earnings); store.deleteTracing(ids.third)
    const host = makeHost()
    expect(fastParse('delete my board', { host }).text).toMatch(/always keep at least one/)
    expect(plan(host, [{ action: 'drawing.deleteBoard', target: 'drawingBoards', args: { board: 'Swing' } }]).ok).toBe(false)
    expect(names()).toEqual(['Swing'])
  })

  it('🔴 rail for the card: deleteBoard is confirm-risk, irreversible, and has no Undo', () => {
    const c = getCapability('drawing.deleteBoard')
    expect(c.risk).toBe('confirm')
    expect(c.reversible).toBe(false)
  })
})

describe('Drawing Boards: targeting', () => {
  it('⛔ wrong target: a board request aimed at ONE chart (a named chart, a position) is answered, never run', () => {
    const host = makeHost()
    for (const t of ['switch to my Earnings board on the NVDA chart', 'switch to the Earnings board on the left chart', 'switch to my Earnings board only on this chart', 'delete the Earnings board for the AAPL chart']) {
      const f = fastParse(t, { host })
      expect(f).toEqual({ kind: 'say', text: ONE_CHART_SAY })
    }
    expect(store.getActiveTracingId()).toBe(ids.swing)
    expect(names()).toEqual(['Swing', 'Earnings', 'Board 3'])
  })

  it('only real board names are claimed; a question is left to the guide; the context lists the boards, not their ids', () => {
    const host = makeHost()
    expect(fastParse('switch to my Momentum board', { host })?.ops?.[0]?.action).not.toBe('drawing.setActiveBoard')
    for (const q of ['how do I create a board', 'how do I switch drawing board', 'how do I delete a board']) {
      const f = fastParse(q, { host })
      expect(f?.ops?.some(o => o.action.startsWith('drawing.'))).toBeFalsy()
    }
    const { context } = buildContext(host, CTX)
    expect(context.drawingBoards[0].boards).toEqual([{ name: 'Swing', active: true, drawings: 1 }, { name: 'Earnings', drawings: 2 }, { name: 'Board 3', drawings: 0 }])
    expect(JSON.stringify(context.drawingBoards)).not.toMatch(new RegExp(ids.earnings))
  })
})
