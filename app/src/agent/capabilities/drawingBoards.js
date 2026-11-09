// ── DRAWING BOARDS (pl-exec round 8; rows C1-167..170): switch, create, rename, delete a Drawing Board ─────────────────────
//
// Through the product's own board store (components/chart/drawingsStore.js — the Drawing Boards panel's writers
// setActiveTracing / createTracing / renameTracing / deleteTracing; the feature's internal name is "tracing"), never a second
// store. `drawingBoard.set` with an `op` (switch / create / rename), and `drawingBoard.delete` on its own (AUDIT (a): risk
// confirm, not reversible, so the server's approval boundary backstops the card).
//   switch   the panel's row click: that board becomes the one every chart draws on. Undo switches back.
//   create   its "+ New board": an empty board (named, if a name is said). Undo deletes that new, still-empty board.
//   rename   its rename field. Undo puts the old name back.
//   delete   its delete: the board AND its drawings go. Always shown first; NO Undo (the drawings are gone). The last board
//            is never deleted (the store keeps one).
// A board is named by its name (or "Board N", the panel's own label), exact or a unique part of it; two that fit → refused
// with both, never a guess.
import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { listTracings, getActiveTracingId, setActiveTracing, createTracing, renameTracing, deleteTracing, tracingLabel, tracingStats } from '../../components/chart/drawingsStore'

const REF = 'drawingBoards'
const BOARD_WORDS = /\bboards?\b/i                   // the one default board stays out of every request until boards are mentioned
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const snapshot = () => {
  let boards = []
  try { boards = listTracings().map(t => ({ id: t.id, name: tracingLabel(t) })) } catch { boards = [] }
  let activeId = null
  try { activeId = getActiveTracingId() } catch { activeId = null }
  return { ref: REF, boards, activeId }
}
// the store's own count of a board's drawings (the active board's live slot, any other board's archive)
const boardHasDrawings = (id) => { try { return tracingStats(id).drawings > 0 } catch { return true } }
const notEmptyWhy = (p) => `The drawing board${p.label ? ` “${p.label}”` : ''} has drawings on it now, so Undo won't delete it (that would delete those drawings too). Nothing was undone. Delete the board yourself if you mean to.`
function pickBoard(boards, raw) {
  const w = norm(raw)
  if (!w) return { why: 'Say which board.' }
  const exact = boards.filter(b => norm(b.name) === w || b.id === raw)
  const near = exact.length ? exact : boards.filter(b => norm(b.name).includes(w.replace(/\s*(?:drawing\s+)?board$/, '')))
  if (near.length === 1) return { board: near[0] }
  const list = boards.map(b => `“${b.name}”`).join(', ')
  return { why: near.length ? `“${raw}” could be ${near.map(b => `“${b.name}”`).join(' or ')} — which one?` : `There's no drawing board “${raw}”. Your boards: ${list}.` }
}

export const drawingBoardKind = {
  name: 'drawingBoards',
  boardScoped: false,                         // Drawing Boards belong to the account, not the open layout
  list: () => [snapshot()],
  read: (_host, ref) => (ref === REF ? snapshot() : null),
  stateOf: (snap) => ({ boards: snap.boards, activeId: snap.activeId, op: null }),
  patch: (before, after) => (after.op ? { ...after.op, was: after.op.was ?? null } : null),
  async commit(_host, _ref, p) {
    if (p.op === 'switch') setActiveTracing(p.id)
    else if (p.op === 'create') p.created = createTracing(p.name ? { name: p.name } : {})
    else if (p.op === 'rename') renameTracing(p.id, p.name)
    else if (p.op === 'delete') {
      // AUDIT R8-D1: the Undo of a create deletes the board only while the store holds no drawings for it (deleteTracing drops
      // its archive): checked again at the write, after undoBlocked, so a drawing made in between is never lost
      if (p.ifEmpty && boardHasDrawings(p.id)) { const e = new Error(notEmptyWhy(p)); e.complete = true; throw e }
      deleteTracing(p.id)
    } else return false
    return true
  },
  // runtime.undoEntry asks this BEFORE anything of the entry is restored: a reason here refuses the whole Undo
  undoBlocked(_host, item) {
    const p = drawingBoardKind.undoPatch(item)
    return p && p.op === 'delete' && p.ifEmpty && boardHasDrawings(p.id) ? notEmptyWhy(p) : null
  },
  landed(snap, p) {
    if (!snap) return false
    const b = (id) => snap.boards.find(x => x.id === id)
    if (p.op === 'switch') return snap.activeId === p.id
    if (p.op === 'create') return !!(p.created && b(p.created))
    if (p.op === 'rename') return !!b(p.id) && norm(b(p.id).name) === norm(p.name || '') || (!p.name && !!b(p.id))
    if (p.op === 'delete') return !b(p.id)
    return false
  },
  // switch → switch back; create → delete the new board ONLY while it is still empty; rename → the old name; delete → none
  undoPatch(item) {
    const p = item.patch || {}
    if (p.op === 'switch') return p.was ? { op: 'switch', id: p.was, was: p.id } : null
    if (p.op === 'create') return p.created ? { op: 'delete', id: p.created, ifEmpty: true, label: p.name || null } : null
    if (p.op === 'rename') return { op: 'rename', id: p.id, name: p.was ?? '', was: p.name }
    return null
  },
  fingerprint: (snap) => JSON.stringify(snap ? [snap.boards, snap.activeId] : null),
}

let registered = false
export function registerDrawingBoardCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(drawingBoardKind)
  registerContextProvider({
    key: 'drawingBoards',
    // only once the member has more than the one default board, or is asking about boards: the panel's own list
    build: (_host, refFor, { message = '', nl1 = false } = {}) => {
      const s = snapshot()
      const asked = nl1 || s.boards.length > 1 || s.boards.some(b => !/^Board \d+$/.test(b.name)) || BOARD_WORDS.test(String(message))
      return s.boards.length && asked ? [{ ref: refFor('drawingBoards', REF), active: s.boards.find(b => b.id === s.activeId)?.name || null, boards: s.boards.map(b => b.name) }] : undefined
    },
  })
  registerCapability({
    name: 'drawingBoard.set',
    surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
    target: 'drawingBoards',
    risk: 'local',
    reversible: true,
    summary: 'Drawing Boards (the panel of separate drawing sheets): switch to one, create one, or rename one.',
    hints: 'target = the drawingBoards entry. op = switch | create | rename; board = the board by its name (null for create); name = the new name (create / rename), else null.',
    args: { type: 'object', properties: { op: { type: 'string', enum: ['switch', 'create', 'rename'] }, board: { type: ['string', 'null'] }, name: { type: ['string', 'null'] } }, required: ['op', 'board', 'name'], additionalProperties: false },
    check(st, { op, board, name }) {
      if (op === 'create') return name && st.boards.some(b => norm(b.name) === norm(name)) ? `You already have a drawing board named “${name.trim()}”.` : null
      const p = pickBoard(st.boards, board)
      if (p.why) return p.why
      if (op === 'rename') {
        const nm = String(name || '').trim()
        if (!nm) return `Say the new name for “${p.board.name}”.`
        if (st.boards.some(b => b.id !== p.board.id && norm(b.name) === norm(nm))) return `You already have a drawing board named “${nm}”.`
        return null
      }
      return op === 'switch' ? null : `op is switch, create or rename${op === 'delete' ? ' (deleting a board is drawingBoard.delete)' : ''}.`
    },
    apply(st, { op, board, name }) {
      if (op === 'create') return { ...st, op: { op: 'create', name: String(name || '').trim() || null } }
      const b = pickBoard(st.boards, board).board
      if (!b) return st
      if (op === 'switch') return b.id === st.activeId ? st : { ...st, op: { op: 'switch', id: b.id, was: st.activeId, label: b.name } }
      if (op === 'rename') { const nm = String(name || '').trim(); return norm(nm) === norm(b.name) ? st : { ...st, op: { op: 'rename', id: b.id, name: nm, was: b.name } } }
      return st
    },
    describe(b, a) {
      const o = a.op
      if (!o) return null
      if (o.op === 'switch') return `Switched to the drawing board “${o.label}” — every chart now draws on it`
      if (o.op === 'create') return `Created a new drawing board${o.name ? ` “${o.name}”` : ''}`
      if (o.op === 'rename') return `Renamed the drawing board “${o.was}” to “${o.name}”`
      return null
    },
    noop: (_b, _a, { op } = {}) => (op === 'switch' ? 'That drawing board is already the one in use' : 'Nothing to change'),
  })
  // AUDIT (a): DELETE is its own action, risk confirm and NOT reversible, so the server's enforce_approval turns any `apply` of
  // it into a proposal (the browser's card is no longer the only guard). The board AND its drawings go; no Undo; never the last.
  registerCapability({
    name: 'drawingBoard.delete',
    surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
    target: 'drawingBoards',
    risk: 'confirm',
    reversible: false,
    summary: 'Delete one Drawing Board and every drawing on it (permanent; always shown first).',
    hints: 'target = the drawingBoards entry; board = the board by its name.',
    args: { type: 'object', properties: { board: { type: 'string' } }, required: ['board'], additionalProperties: false },
    check(st, { board }) {
      const p = pickBoard(st.boards, board)
      if (p.why) return p.why
      return st.boards.length <= 1 ? 'That is your only drawing board, and one always stays.' : null
    },
    apply(st, { board }) {
      const b = pickBoard(st.boards, board).board
      return b ? { ...st, op: { op: 'delete', id: b.id, label: b.name } } : st
    },
    describe(_b, a) { return a.op?.op === 'delete' ? `Deleted the drawing board “${a.op.label}” and its drawings (there is no Undo)` : null },
  })
}
