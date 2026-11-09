// ── DRAWING BOARDS (pl-exec round 8; rows C1-167..170): switch, create, rename, delete a Drawing Board ─────────────────────
//
// Through the product's own board store (components/chart/drawingsStore.js — the Drawing Boards panel's writers
// setActiveTracing / createTracing / renameTracing / deleteTracing; the feature's internal name is "tracing"), never a second
// store. ONE capability, `drawingBoard.set`, with an `op`, so the manifest grows by one small entry.
//   switch   the panel's row click: that board becomes the one every chart draws on. Undo switches back.
//   create   its "+ New board": an empty board (named, if a name is said). Undo deletes that new, still-empty board.
//   rename   its rename field. Undo puts the old name back.
//   delete   its delete: the board AND its drawings go. Always shown first; NO Undo (the drawings are gone). The last board
//            is never deleted (the store keeps one).
// A board is named by its name (or "Board N", the panel's own label), exact or a unique part of it; two that fit → refused
// with both, never a guess.
import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { listTracings, getActiveTracingId, setActiveTracing, createTracing, renameTracing, deleteTracing, tracingLabel } from '../../components/chart/drawingsStore'

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
    else if (p.op === 'delete') deleteTracing(p.id)
    else return false
    return true
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
  // switch → switch back; create → delete the new (still empty) board; rename → the old name; delete → none (drawings gone)
  undoPatch(item) {
    const p = item.patch || {}
    if (p.op === 'switch') return p.was ? { op: 'switch', id: p.was, was: p.id } : null
    if (p.op === 'create') return p.created ? { op: 'delete', id: p.created } : null
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
    summary: 'Drawing Boards (the panel of separate drawing sheets): switch to one, create one, rename one, or delete one (shown first; its drawings go, no Undo).',
    hints: 'target = the drawingBoards entry. op = switch | create | rename | delete; board = the board by its name (null for create); name = the new name (create / rename), else null.',
    args: { type: 'object', properties: { op: { type: 'string', enum: ['switch', 'create', 'rename', 'delete'] }, board: { type: ['string', 'null'] }, name: { type: ['string', 'null'] } }, required: ['op', 'board', 'name'], additionalProperties: false },
    confirmIf: (_st, { op } = {}) => op === 'delete',
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
      if (op === 'delete' && st.boards.length <= 1) return 'That is your only drawing board, and one always stays.'
      return null
    },
    apply(st, { op, board, name }) {
      if (op === 'create') return { ...st, op: { op: 'create', name: String(name || '').trim() || null } }
      const b = pickBoard(st.boards, board).board
      if (!b) return st
      if (op === 'switch') return b.id === st.activeId ? st : { ...st, op: { op: 'switch', id: b.id, was: st.activeId, label: b.name } }
      if (op === 'rename') { const nm = String(name || '').trim(); return norm(nm) === norm(b.name) ? st : { ...st, op: { op: 'rename', id: b.id, name: nm, was: b.name } } }
      if (op === 'delete') return { ...st, op: { op: 'delete', id: b.id, label: b.name } }
      return st
    },
    describe(b, a) {
      const o = a.op
      if (!o) return null
      if (o.op === 'switch') return `Switched to the drawing board “${o.label}” — every chart now draws on it`
      if (o.op === 'create') return `Created a new drawing board${o.name ? ` “${o.name}”` : ''}`
      if (o.op === 'rename') return `Renamed the drawing board “${o.was}” to “${o.name}”`
      if (o.op === 'delete') return `Deleted the drawing board “${o.label}” and its drawings (there is no Undo)`
      return null
    },
    noop: (_b, _a, { op } = {}) => (op === 'switch' ? 'That drawing board is already the one in use' : 'Nothing to change'),
  })
}
