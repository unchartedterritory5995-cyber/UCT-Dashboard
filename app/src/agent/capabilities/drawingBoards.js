// ── DRAWING BOARDS: the member's named drawing sheets (C1-167..170) ─────────────
//
// A Drawing Board is a sheet of drawings that every chart and every symbol share. The member
// picks the ACTIVE board (the one they draw on) in the chart toolbar's Drawing Boards panel
// (components/chart/TracingsPanel.jsx). The Agent reads and writes through the same store
// writers that panel uses (host.drawingBoards, agent/host.js buildDrawingBoardSource) and nothing else.
//
//   drawing.setActiveBoard   switch the board you draw on (a click on a board row). Undo switches back.
//   drawing.createBoard      "New board" (create, then switch to it), with a name when one is given.
//                            Undo removes it again only while it is still empty, then switches back.
//   drawing.renameBoard      the row's pencil. Undo renames it back.
//   drawing.deleteBoard      the row's bin and its ✓. It is ALWAYS a confirmation card that names the
//                            board and how many drawings it holds, and it cannot be undone (the
//                            store keeps no copy of a deleted board). It is never the last board,
//                            the same rule as the panel. It is never an unnamed "this/my board": the
//                            member says the board's name. Deleting the board you draw on is allowed
//                            only by name, as in the panel. The card says that the panel's fallback
//                            (the first board left) becomes the one you draw on.
//
// Targets are BOARD NAMES as the panel shows them (a name, or "Board N" for an unnamed board).
// The match ignores case and quotes and takes an optional "my/the" and "(drawing) board". If no
// board matches, or more than one, the Agent asks with the real names and never picks one.
// Boards apply to every chart, so a request aimed at ONE chart ("on the left chart") is answered,
// not run: nothing changes, and the reply says what a board switch really does.
// Each receipt waits for the server's copy (tracings_doc). When that is not seen, it says so.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'

const MAX_NAME = 60
const quote = (n) => `“${n}”`
const norm = (s) => String(s || '').toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/\s+/g, ' ').trim()
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const listNames = (boards) => boards.map(b => quote(b.label)).join(', ')

function snapOf(host) {
  const src = host?.drawingBoards
  if (!src) return null
  return { ref: 'drawingBoards', label: 'Drawing boards', ...src.snapshot() }
}

/** The boards these words name: an exact label, with or without "my/the" and "(drawing) board". */
export function boardsNamed(boards, phrase) {
  const p = norm(phrase).replace(/^(?:my|the|our) /, '')
  if (!p) return []
  const tries = [p, p.replace(/ (?:drawing )?board$/, ''), p.replace(/^(?:drawing )?board (?:called |named )?/, '')].filter(Boolean)
  for (const t of [...new Set(tries)]) {
    const hits = boards.filter(b => norm(b.label) === t)
    if (hits.length) return hits
  }
  return []
}

/** One board for these words, or the sentence that asks which one (never a guess). */
function resolveOne(st, phrase) {
  const hits = boardsNamed(st.boards, phrase)
  if (hits.length === 1) return { board: hits[0] }
  if (hits.length > 1) return { ask: `You have ${hits.length} boards named ${quote(hits[0].label)}, so I can't tell which one you mean. Rename one in Drawing Boards first. Nothing was changed.` }
  return { ask: `There's no drawing board called ${quote(String(phrase || '').trim())}. Your boards: ${listNames(st.boards)}. Which one did you mean?` }
}

const nameProblem = (st, name, exceptId = null) => {
  const n = String(name ?? '').trim()
  if (!n) return 'Say the name for the board.'
  if (n.length > MAX_NAME) return `Board names can be up to ${MAX_NAME} characters.`
  const clash = st.boards.find(b => b.id !== exceptId && norm(b.label) === norm(n))
  return clash ? `You already have a board called ${quote(clash.label)}. Pick another name.` : null
}

// ── the receipts, one sentence each, from the patch (commit reports the same line, plus the save) ──
function lineOf(p) {
  if (p.switch) return `Switched your drawing board: ${quote(p.switch.fromLabel)} → ${quote(p.switch.toLabel)}. Every chart now shows and draws on ${quote(p.switch.toLabel)}.`
  if (p.create) return `Made a new drawing board ${quote(p.create.label)} and switched to it. New drawings go on it; ${quote(p.create.fromLabel)} keeps its drawings.`
  if (p.rename) return `Renamed the drawing board ${quote(p.rename.fromLabel)} to ${quote(p.rename.toLabel || p.rename.to)}.`
  if (p.remove) {
    const r = p.remove
    return `Deleted the drawing board ${quote(r.label)} and its ${plural(r.drawings, 'drawing')}. This can't be undone.${r.wasActive ? ` You now draw on ${quote(r.fallbackLabel)}.` : ''}`
  }
  if (p.undoSwitch) return `Switched your drawing board back to ${quote(p.undoSwitch.toLabel)}.`
  if (p.undoCreate) return `Removed the new, empty drawing board ${quote(p.undoCreate.label)} and switched back to ${quote(p.undoCreate.backLabel)}.`
  return null
}
const NOT_SYNCED = ' It is on this device, but saving it to your account was not confirmed yet. Keep this tab open a few seconds.'

const byId = (s, id) => s.boards.find(b => b.id === id) || null

export const drawingBoardsKind = {
  name: 'drawingBoards',
  // Boards are the member's own, the same whichever layout is open: a layout switch neither pins nor blocks them.
  boardScoped: false,
  // commit itself waits for the server's copy and says in its receipt whether it was seen.
  persistsInCommit: true,
  selfDescribing: true,
  list: (host) => { const s = snapOf(host); return s ? [s] : [] },
  read: (host, ref) => (ref === 'drawingBoards' ? snapOf(host) : null),
  stateOf: (s) => ({ boards: s.boards, activeId: s.activeId, op: null }),
  patch: (before, after) => (after.op ? { ...after.op } : null),
  async commit(host, ref, patch) {
    const src = host?.drawingBoards
    if (!src) return false
    const now = () => src.snapshot()
    if (patch.switch) {
      if (!byId(now(), patch.switch.to)) throw new Error(`${quote(patch.switch.toLabel)} isn't one of your boards anymore`)
      src.setActive(patch.switch.to)
    } else if (patch.create) {
      if (now().boards.some(b => norm(b.label) === norm(patch.create.label))) throw new Error(`you already have a board called ${quote(patch.create.label)}`)
      patch.createdId = src.create(patch.create.name)
    } else if (patch.rename) {
      const b = byId(now(), patch.rename.id)
      if (!b) throw new Error(`${quote(patch.rename.fromLabel)} isn't one of your boards anymore`)
      if (b.label !== patch.rename.fromLabel) throw new Error('that board was renamed since I read it. Ask again')
      src.rename(patch.rename.id, patch.rename.to)
    } else if (patch.remove) {
      // The board as it is NOW must be exactly the one on the card: same name, same drawings, not the last one.
      const s = now()
      const b = byId(s, patch.remove.id)
      if (!b) throw new Error(`${quote(patch.remove.label)} is already gone`)
      if (b.label !== patch.remove.label || b.drawings !== patch.remove.drawings || b.active !== patch.remove.wasActive) {
        const e = new Error(`${quote(patch.remove.label)} changed since you saw the card, so nothing was deleted. Ask again to see it as it is now.`)
        e.complete = true
        throw e
      }
      if (s.boards.length <= 1) throw new Error('you always keep at least one board')
      src.remove(patch.remove.id)
    } else if (patch.undoSwitch) {
      if (!byId(now(), patch.undoSwitch.to)) throw new Error(`${quote(patch.undoSwitch.toLabel)} isn't one of your boards anymore`)
      src.setActive(patch.undoSwitch.to)
    } else if (patch.undoCreate) {
      const s = now()
      const b = byId(s, patch.undoCreate.id)
      if (!b) throw new Error(`${quote(patch.undoCreate.label)} is already gone`)
      if (b.drawings > 0) { const e = new Error(`${quote(b.label)} has drawings on it now, so I left it. Delete it in Drawing Boards if you don't want it.`); e.complete = true; throw e }
      if (byId(s, patch.undoCreate.back)) src.setActive(patch.undoCreate.back)
      src.remove(patch.undoCreate.id)
    } else return false
    const sync = typeof src.confirm === 'function' ? await src.confirm() : { ok: false }
    const line = lineOf(patch)
    return { lines: line ? [sync?.ok ? line : `${line}${NOT_SYNCED}`] : [] }
  },
  landed(s, p) {
    if (!s) return false
    if (p.switch) return s.activeId === p.switch.to
    if (p.create) return !!p.createdId && s.activeId === p.createdId && byId(s, p.createdId)?.label === p.create.label
    if (p.rename) return byId(s, p.rename.id)?.name === p.rename.to
    if (p.remove) return !byId(s, p.remove.id)
    if (p.undoSwitch) return s.activeId === p.undoSwitch.to
    if (p.undoCreate) return !byId(s, p.undoCreate.id)
    return false
  },
  undoPatch(item) {
    const p = item.patch || {}
    if (p.switch) return { undoSwitch: { to: p.switch.from, toLabel: p.switch.fromLabel } }
    if (p.create) return p.createdId ? { undoCreate: { id: p.createdId, label: p.create.label, back: p.create.from, backLabel: p.create.fromLabel } } : null
    if (p.rename) return { rename: { id: p.rename.id, fromLabel: p.rename.toLabel || p.rename.to, to: p.rename.from, toLabel: p.rename.fromLabel } }
    return null                                   // a delete has no Undo: the store keeps no copy of a deleted board
  },
  fingerprint: (s) => JSON.stringify([s.activeId, s.boards.map(b => [b.id, b.label, b.drawings])]),
  // Undo needs only what THIS change touched to be as it left it.
  fingerprintFor(host, s, item) {
    if (!s) return null
    const p = item?.patch || {}
    const ids = p.switch ? [p.switch.from, p.switch.to] : p.create ? [p.createdId] : p.rename ? [p.rename.id] : []
    return JSON.stringify([p.rename ? null : s.activeId, ids.map(id => { const b = byId(s, id); return b ? [b.id, b.label, p.create ? b.drawings : null] : null })])
  },
}


// ── deterministic phrases (whole sentence, before any chart qualifier is stripped) ──
// A phrase is claimed only when it says "board" and names exactly ONE of the member's boards (or, to create one, says
// "drawing board"); anything else is the model's. A question ("how do I …") never matches: every phrase starts with its verb.
// ⛔ ONE CHART: boards are app-wide, so a board request aimed at one chart is answered, never run.
const ONE_CHART = /\s(?:(?:on|for|in) (?:the |this |that |my )?(?:[a-z0-9.^-]+ ){0,2}(?:chart|cell|pane)s?|only (?:on |for )?(?:the |this |that )?(?:[a-z0-9.^-]+ )?chart)\b/i
export const ONE_CHART_SAY = 'Drawing boards are shared by every chart, so I can\'t change the board for one chart only. Nothing was changed. Say it without the chart (for example “switch to my Swing drawing board”) to change it for every chart.'
// ⛔ "delete this / my / the current board": a delete needs the board's own name.
const DELETE_DEIXIS = /^(?:please )?(?:delete|remove|get rid of|trash|erase) (?:(?:my|the|this|that) )?(?:(?:current|active) )?(?:drawing )?board$/i
const LEAD = '^(?:please |can you |could you )?'
/** The sentence as typed (case kept, end punctuation and extra spaces dropped), without a one-chart qualifier, and whether it had one. */
function sentence(raw) {
  const t = String(raw || '').trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
  const one = ONE_CHART.exec(t)
  return { t: one ? t.replace(one[0], '').replace(/\s+/g, ' ').trim() : t, one: !!one }
}
const stripQuotes = (s) => String(s || '').replace(/^[“"'‘]|[”"'’]$/g, '').trim()
const saysBoard = (t) => /\bboards?\b/i.test(t)
/** The one board these words name, for a fast phrase: the op's args, the one-chart answer, or null (the model's). */
function claim(host, s, phrase, args) {
  const hits = boardsNamed(host.drawingBoards.snapshot().boards, phrase)
  if (hits.length !== 1) return null
  return s.one ? { __say: ONE_CHART_SAY } : args(hits[0])
}

let registered = false
export function registerDrawingBoardCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(drawingBoardsKind)
  registerContextProvider({
    key: 'drawingBoards',
    build: (host, refFor) => {
      const s = snapOf(host)
      return s ? [{
        ref: refFor('drawingBoards', 'drawingBoards'), label: 'Drawing boards (shared by every chart)',
        boards: s.boards.map(b => ({ name: b.label, ...(b.active ? { active: true } : {}), drawings: b.drawings })),
      }] : undefined
    },
  })

  registerCapability({
    name: 'drawing.setActiveBoard',
    target: 'drawingBoards',
    surfaces: ['charts'],
    summary: 'Switch the Drawing Board the member draws on (Drawing Boards in the chart toolbar). Boards are named sheets of drawings shared by EVERY chart and symbol: switching changes what every chart shows and draws on. Not a layout and not the workspace.',
    hints: 'target = the ref of the drawingBoards entry; board = the board\'s name as the member said it (a name from its boards list, e.g. "Swing" or "Board 2"). UCT matches it itself; when the member gives no name, or it could be more than one board, clarify with the real names. Never pick one. Boards cannot be switched for one chart only.',
    args: { type: 'object', properties: { board: { type: 'string' } }, required: ['board'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      if (!host?.drawingBoards) return null
      const s = sentence(raw)
      if (!saysBoard(s.t)) return null
      const m = new RegExp(`${LEAD}(?:switch|change|go|flip|move|jump)(?: over| back)? to (.+)$`, 'i').exec(s.t) || new RegExp(`${LEAD}(?:draw on|use) (.+)$`, 'i').exec(s.t)
      return m ? claim(host, s, m[1], (b) => ({ board: b.label })) : null
    },
    check(st, { board }) {
      const r = resolveOne(st, board)
      return r.ask || null
    },
    apply(st, { board }) {
      const b = resolveOne(st, board).board
      if (b.id === st.activeId) return st
      const from = byId(st, st.activeId)
      return { ...st, op: { switch: { from: st.activeId, fromLabel: from?.label || 'your board', to: b.id, toLabel: b.label } } }
    },
    noop: (st) => `You're already drawing on ${quote(byId(st, st.activeId)?.label || 'that board')}`,
    describe: (b, a) => (a.op?.switch ? lineOf(a.op) : null),
  })

  registerCapability({
    name: 'drawing.createBoard',
    target: 'drawingBoards',
    surfaces: ['charts'],
    summary: 'Make a new Drawing Board and switch to it, exactly like "New board" in Drawing Boards: new drawings go on it, and the other boards keep theirs. Not a new layout or a blank workspace.',
    hints: 'target = the ref of the drawingBoards entry; name = the name the member gave, or null for none (UCT shows it as "Board N", as the panel does).',
    args: { type: 'object', properties: { name: { type: ['string', 'null'] } }, required: ['name'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      if (!host?.drawingBoards) return null
      const s = sentence(raw)
      const m = new RegExp(`${LEAD}(?:create|make|add|start|open)(?: me)? (?:a |an )?(?:new |another |fresh |second )?drawing board(?: (?:called|named) (.+))?$`, 'i').exec(s.t)
      if (!m) return null
      if (s.one) return { __say: ONE_CHART_SAY }
      return { name: m[1] ? stripQuotes(m[1]) || null : null }
    },
    check: (st, { name }) => (name == null ? null : nameProblem(st, name)),
    apply(st, { name }) {
      const n = name == null ? '' : String(name).trim()
      const from = byId(st, st.activeId)
      return { ...st, op: { create: { name: n, label: n || `Board ${st.boards.length + 1}`, from: st.activeId, fromLabel: from?.label || 'your board' } } }
    },
    describe: (b, a) => (a.op?.create ? lineOf(a.op) : null),
  })

  registerCapability({
    name: 'drawing.renameBoard',
    target: 'drawingBoards',
    surfaces: ['charts'],
    summary: 'Rename one Drawing Board (the pencil on its row in Drawing Boards).',
    hints: 'target = the ref of the drawingBoards entry; board = the board\'s current name as the member said it ("Board 2" for an unnamed one); to = the new name. When they do not say which board and there is more than one, clarify with the real names.',
    args: { type: 'object', properties: { board: { type: 'string' }, to: { type: 'string' } }, required: ['board', 'to'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      if (!host?.drawingBoards) return null
      const s = sentence(raw)
      const m = new RegExp(`${LEAD}rename (.+?) to (.+)$`, 'i').exec(s.t)
      if (!m || !saysBoard(m[1])) return null
      const to = stripQuotes(m[2])
      return to ? claim(host, s, m[1], (b) => ({ board: b.label, to })) : null
    },
    check(st, { board, to }) {
      const r = resolveOne(st, board)
      if (r.ask) return r.ask
      return nameProblem(st, to, r.board.id)
    },
    apply(st, { board, to }) {
      const b = resolveOne(st, board).board
      const n = String(to).trim()
      if (b.name === n) return st
      return { ...st, op: { rename: { id: b.id, from: b.name, fromLabel: b.label, to: n, toLabel: n } } }
    },
    noop: () => 'That board already has that name',
    describe: (b, a) => (a.op?.rename ? lineOf(a.op) : null),
  })

  registerCapability({
    name: 'drawing.deleteBoard',
    target: 'drawingBoards',
    surfaces: ['charts'],
    risk: 'confirm',
    reversible: false,
    undo: 'none',
    exclusive: true,
    exclusiveReason: 'Delete the board on its own, then ask for any other changes.',
    summary: 'Delete one Drawing Board and every drawing on it, on every symbol (the bin on its row in Drawing Boards). Permanent: it cannot be undone. Never the last board.',
    hints: 'target = the ref of the drawingBoards entry; board = the board\'s name exactly as the member said it. If they did not name a board ("delete my board", "delete this board"), or it could be more than one, clarify with the real names. Never pick one, and never the active board unless they named it. UCT always shows a confirmation card first, so do not ask "are you sure?".',
    args: { type: 'object', properties: { board: { type: 'string' } }, required: ['board'], additionalProperties: false },
    fastWhole: true,
    fast: ({ raw, host }) => {
      if (!host?.drawingBoards) return null
      const s = sentence(raw)
      if (DELETE_DEIXIS.test(s.t)) {
        const boards = host.drawingBoards.snapshot().boards
        if (boards.length <= 1) return { __say: 'You have one drawing board, and you always keep at least one, so there is nothing to delete. Nothing was changed.' }
        return { __say: `Which drawing board should I delete? Your boards: ${listNames(boards)}. Say its name, for example “delete the ${boards.find(b => !b.active)?.label || boards[0].label} board”. Nothing was deleted.` }
      }
      if (!saysBoard(s.t)) return null
      const m = new RegExp(`${LEAD}(?:delete|remove|get rid of|trash|erase) (.+)$`, 'i').exec(s.t)
      return m ? claim(host, s, m[1], (b) => ({ board: b.label })) : null
    },
    check(st, { board }) {
      if (st.boards.length <= 1) return 'You always keep at least one drawing board, so this one can\'t be deleted.'
      return resolveOne(st, board).ask || null
    },
    apply(st, { board }) {
      const b = resolveOne(st, board).board
      // the panel's own fallback when the active board goes (drawingsStore.deleteTracing): the first board left,
      // which then shows as "Board 1" when it has no name of its own
      const fallback = b.active ? st.boards.find(x => x.id !== b.id) : null
      return { ...st, op: { remove: { id: b.id, label: b.label, drawings: b.drawings, symbols: b.symbols, wasActive: !!b.active, fallbackLabel: fallback ? (fallback.name || 'Board 1') : null } } }
    },
    // what the CARD says, before anything is deleted: the board, its drawings, and that there is no Undo
    describe(b, a) {
      const r = a.op?.remove
      if (!r) return null
      const what = r.drawings ? `${plural(r.drawings, 'drawing')} on ${plural(r.symbols, 'symbol')}` : 'no drawings'
      return `Delete the drawing board ${quote(r.label)} (${what}). This can't be undone.${r.wasActive ? ` It's the board you draw on now; afterwards you'll draw on ${quote(r.fallbackLabel)}.` : ''}`
    },
  })
}
