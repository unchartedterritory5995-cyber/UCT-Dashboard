// The open boards as TABS: the pure model (boardTabs.js), behind TERMINAL_BOARD_TABS_ENABLED.
// The shell half is TerminalShell.boardTabs.test.jsx.
//
//     cd app && npx vitest run src/pages/terminal/boardTabs.test.js --maxWorkers=2
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LAYOUT, boardSnapshot, defaultLayout, emptyLibrary, firstVisitLayout, saveBoard, setCount,
} from './boardModel'
import * as boardPrefs from './boardPrefs'
import { STARTER_BOARDS, buildStarterBoard } from './starterBoards'
import { defaultStockBoard } from './stockBoards'
import { buildStockBoard } from './stockBoardModel'
import {
  BLANK_NAME, BOARD_TABS_KEY, MAX_TABS, OWN_NAME, TABS_FULL_TEXT, TABS_VERSION, activeTab, addTab, blankBoard,
  boardSignature, canRename, clearPending, closeTab, differsFromDefault, findTab, isUntouchedDefault, needsHeal,
  readTabs, renameTab, retargetTab, seedTabs, selectTab, serializeTabs, sessionTabs, stockSymOf, tabBase, tabFor,
  tabLabel, tabUnsaved,
} from './boardTabs'

const MINE = setCount(DEFAULT_LAYOUT, 3)                       // a board that is not the untouched default
const snapOf = (layout, syms) => boardSnapshot(layout, syms)
const starter = (i = 0) => buildStarterBoard(DEFAULT_LAYOUT, STARTER_BOARDS[i])
const own = (now = 1) => seedTabs({ layout: MINE, syms: {}, layoutStatus: 'ok', library: emptyLibrary() }, now).doc
const tab = (over) => ({ id: 'x', kind: 'own', ref: null, name: OWN_NAME, sym: null, copy: null, ...over })

describe('the store key', () => {
  it('is ONE new key, and it is not one of the Terminal document keys', () => {
    expect(BOARD_TABS_KEY).toBe('terminal_board_tabs')
    // The two existing keys keep their names; the new one is not exported from boardPrefs.js
    // (those exports are the versioned Terminal document's key set).
    expect(boardPrefs.TERMINAL_LAYOUT_PREF).toBe('terminal_layout')
    expect(boardPrefs.TERMINAL_BOARDS_PREF).toBe('terminal_boards')
    expect(Object.values(boardPrefs)).not.toContain(BOARD_TABS_KEY)
  })

  it('at most eight tabs, and the sentence says the number', () => {
    expect(MAX_TABS).toBe(8)
    expect(TABS_FULL_TEXT).toContain('8 boards open')
  })
})

describe('readTabs: what a stored blob reads as', () => {
  const good = () => ({ v: 1, active: 'a', pending: null, pendingFrom: null, tabs: [tab({ id: 'a' }), tab({ id: 'b', kind: 'blank', name: 'Scratch' })] })

  it('nothing stored is absent', () => {
    for (const raw of [undefined, null, '']) expect(readTabs(raw)).toEqual({ status: 'absent', doc: null })
  })

  it('a blob that is not this shape is unreadable, never a guess', () => {
    for (const raw of ['{not json', '[]', '"x"', JSON.stringify({ v: 1 }), JSON.stringify({ v: 0, tabs: [] }), JSON.stringify({ tabs: [] })]) {
      expect(readTabs(raw).status, raw).toBe('unreadable')
      expect(readTabs(raw).doc).toBeNull()
    }
  })

  it('a later build\'s blob is newer, and is not read', () => {
    expect(readTabs(JSON.stringify({ ...good(), v: 2 }))).toEqual({ status: 'newer', doc: null })
  })

  it('a good blob round-trips through serializeTabs', () => {
    const r = readTabs(serializeTabs(good()))
    expect(r.status).toBe('ok')
    expect(r.doc).toEqual(good())
    expect(JSON.parse(serializeTabs(r.doc)).v).toBe(TABS_VERSION)
  })

  it('drops a tab of an unknown kind and a repeated id, and keeps at most eight', () => {
    const many = Array.from({ length: 11 }, (_, i) => tab({ id: `t${i}` }))
    const r = readTabs({ v: 1, active: 't0', tabs: [tab({ id: 'z', kind: 'mystery' }), ...many, tab({ id: 't1' })] })
    expect(r.doc.tabs.map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
  })

  it('an active id that names no tab falls to the first tab; no usable tab reads as absent', () => {
    expect(readTabs({ ...good(), active: 'gone' }).doc.active).toBe('a')
    expect(readTabs({ v: 1, active: 'a', tabs: [{ id: '', kind: 'own' }] }).status).toBe('absent')
  })

  it('keeps "pending" only when it names the active tab and says what it replaced', () => {
    expect(readTabs({ ...good(), pending: 'a', pendingFrom: 'sig' }).doc).toMatchObject({ pending: 'a', pendingFrom: 'sig' })
    expect(readTabs({ ...good(), pending: 'b', pendingFrom: 'sig' }).doc).toMatchObject({ pending: null, pendingFrom: null })
    expect(readTabs({ ...good(), pending: 'a', pendingFrom: null }).doc).toMatchObject({ pending: null, pendingFrom: null })
  })

  it('only a stock tab keeps a ticker, cleaned the way the stock board command cleans it', () => {
    const r = readTabs({ v: 1, active: 'a', tabs: [tab({ id: 'a', kind: 'stock', ref: 'stock-glance', sym: '$nvda' }), tab({ id: 'b', sym: 'AAPL' })] })
    expect(r.doc.tabs.map((t) => t.sym)).toEqual(['NVDA', null])
  })
})

describe('boardSignature: what counts as changing a board', () => {
  const base = snapOf(MINE, { A: 'NVDA' })

  it('using a board is not changing it: a group\'s ticker, focus, density and panel ids do not count', () => {
    const sig = boardSignature(base)
    expect(boardSignature(snapOf(MINE, { A: 'AAPL' }))).toBe(sig)
    expect(boardSignature({ ...base, focus: 2, density: 'dense' })).toBe(sig)
    expect(boardSignature({ ...base, panels: base.panels.map((p, i) => ({ ...p, id: `zz${i}` })) })).toBe(sig)
  })

  it('the panel count, a panel\'s tool, its arguments and a ticker pinned on it all count', () => {
    const sig = boardSignature(base)
    expect(boardSignature(setCount(base, 2))).not.toBe(sig)
    const swap = (patch) => ({ ...base, panels: base.panels.map((p, i) => (i === 0 ? { ...p, ...patch } : p)) })
    expect(boardSignature(swap({ code: 'NEWS' }))).not.toBe(sig)
    expect(boardSignature(swap({ args: ['QTD'] }))).not.toBe(sig)
    expect(boardSignature(swap({ channel: null, group: 'N', sym: 'TSLA' }))).not.toBe(sig)
  })

  it('which group letter the panels follow does not count (a ready-made board opens on the active group)', () => {
    const onA = buildStarterBoard({ ...defaultLayout(), activeChannel: 'A' }, STARTER_BOARDS[0])
    const onB = buildStarterBoard({ ...defaultLayout(), activeChannel: 'B' }, STARTER_BOARDS[0])
    expect(boardSignature(boardSnapshot(onA))).toBe(boardSignature(boardSnapshot(onB)))
  })

  it('the exact form ({ own: true }) tells one stock board from the same board for another ticker', () => {
    const nvda = boardSnapshot(buildStockBoard(DEFAULT_LAYOUT, defaultStockBoard(), 'NVDA'))
    const aapl = boardSnapshot(buildStockBoard(DEFAULT_LAYOUT, defaultStockBoard(), 'AAPL'))
    expect(boardSignature(nvda)).toBe(boardSignature(aapl))
    expect(boardSignature(nvda, { own: true })).not.toBe(boardSignature(aapl, { own: true }))
    expect(stockSymOf(nvda)).toBe('NVDA')
  })

  it('something that is not a board has no signature', () => {
    for (const v of [null, undefined, 'x', {}, { panels: 'no' }]) expect(boardSignature(v)).toBe('')
  })
})

describe('seedTabs: the tabs a member sees the first time', () => {
  it('a member with a board of their own keeps it, as the first tab, called "My board"', () => {
    const { doc, open } = seedTabs({ layout: MINE, syms: {}, layoutStatus: 'ok', library: emptyLibrary() }, 5)
    expect(open).toBeNull()                                       // nothing is put on screen: their board stays
    expect(doc.tabs).toHaveLength(1)
    expect(doc.tabs[0]).toMatchObject({ kind: 'own', name: OWN_NAME, ref: null, copy: null })
    expect(doc.active).toBe(doc.tabs[0].id)
    expect(doc.pending).toBeNull()
  })

  it('a board that IS one of their saved boards goes under that board\'s name', () => {
    const lib = saveBoard(emptyLibrary(), 'Swing Board', MINE, { A: 'NVDA' }, 1000).library
    const { doc, open } = seedTabs({ layout: MINE, syms: { A: 'AAPL' }, layoutStatus: 'ok', library: lib }, 5)
    expect(open).toBeNull()
    expect(doc.tabs[0]).toMatchObject({ kind: 'saved', name: 'Swing Board', ref: lib.boards[0].id })
  })

  it.each([
    ['nothing stored', DEFAULT_LAYOUT, 'absent'],
    ['the one-panel default', defaultLayout(), 'ok'],
    ['the first-visit board', firstVisitLayout(), 'ok'],
  ])('the untouched default (%s) opens the first ready-made board under its own name', (_n, layout, status) => {
    const { doc, open } = seedTabs({ layout, syms: {}, layoutStatus: status, library: emptyLibrary() }, 5)
    const s = STARTER_BOARDS[0]
    expect(doc.tabs[0]).toMatchObject({ kind: 'starter', ref: s.id, name: s.name })
    expect(open.count).toBe(s.commands.length)
    expect(boardSignature(doc.tabs[0].copy)).toBe(boardSignature(boardSnapshot(open)))
    expect(isUntouchedDefault(MINE, 'ok')).toBe(false)             // CONTROL: a changed board is not "untouched"
  })

  it('a session that may not write gets one tab for the board on screen', () => {
    const doc = sessionTabs(9)
    expect(doc.tabs).toHaveLength(1)
    expect(doc.tabs[0]).toMatchObject({ kind: 'own', name: OWN_NAME, copy: null })
  })
})

describe('opening, switching and closing tabs', () => {
  it('addTab parks the board on screen as the outgoing tab\'s copy, and selects the new tab', () => {
    const doc = own()
    const current = snapOf(MINE, { A: 'NVDA' })
    const res = addTab(doc, { kind: 'starter', ref: STARTER_BOARDS[1].id, name: STARTER_BOARDS[1].name }, boardSnapshot(starter(1)), current, 7)
    expect(res.ok).toBe(true)
    expect(res.doc.tabs).toHaveLength(2)
    expect(res.doc.active).toBe(res.id)
    expect(res.doc.tabs[0].copy).toEqual(current)                  // the board they were on is kept, whole
    expect(res.doc.tabs[1]).toMatchObject({ kind: 'starter', name: STARTER_BOARDS[1].name })
    expect(res.doc.pending).toBe(res.id)
    expect(res.doc.pendingFrom).toBe(boardSignature(current, { own: true }))
    expect(doc.tabs).toHaveLength(1)                               // the input is not mutated
  })

  it('refuses a ninth tab and changes nothing', () => {
    let doc = own()
    for (let i = 1; i < MAX_TABS; i += 1) doc = addTab(doc, { kind: 'blank', name: `B${i}` }, blankBoard(MINE), snapOf(MINE), 100 + i).doc
    expect(doc.tabs).toHaveLength(MAX_TABS)
    const res = addTab(doc, { kind: 'blank', name: 'one too many' }, blankBoard(MINE), snapOf(MINE), 999)
    expect(res).toMatchObject({ ok: false, reason: 'full' })
    expect(res.doc).toBe(doc)
  })

  it('a switch keeps BOTH working copies: there and back returns each board as it was left', () => {
    const mine = snapOf(MINE, { A: 'NVDA' })
    const added = addTab(own(), { kind: 'starter', ref: STARTER_BOARDS[0].id, name: 'x' }, boardSnapshot(starter(0)), mine, 7)
    const first = added.doc.tabs[0].id
    const edited = setCount(boardSnapshot(starter(0)), 2)          // the member changed the second tab
    const back = selectTab(added.doc, first, edited)
    expect(back.ok).toBe(true)
    expect(back.doc.active).toBe(first)
    expect(findTab(back.doc, added.id).copy).toEqual(edited)       // parked with its change
    expect(findTab(back.doc, first).copy).toEqual(mine)            // and the first tab's copy is still there
    const again = selectTab(back.doc, added.id, mine)
    expect(activeTab(again.doc).copy).toEqual(edited)
    expect(selectTab(again.doc, added.id, mine).ok).toBe(false)    // already selected
    expect(selectTab(again.doc, 'nope', mine).ok).toBe(false)
  })

  it('a parked stock tab remembers the ticker its board was showing', () => {
    const doc = addTab(own(), { kind: 'stock', ref: defaultStockBoard().id, name: defaultStockBoard().name, sym: 'NVDA' },
      boardSnapshot(buildStockBoard(DEFAULT_LAYOUT, defaultStockBoard(), 'NVDA')), snapOf(MINE), 7)
    const now = boardSnapshot(buildStockBoard(DEFAULT_LAYOUT, defaultStockBoard(), 'AMD'))
    const back = selectTab(doc.doc, doc.doc.tabs[0].id, now)
    expect(findTab(back.doc, doc.id).sym).toBe('AMD')
    expect(tabLabel(findTab(back.doc, doc.id))).toEqual({ text: 'AMD', small: 'Stock' })
  })

  it('the last tab cannot close; closing the selected tab selects its neighbour', () => {
    const one = own()
    expect(closeTab(one, one.active, snapOf(MINE))).toMatchObject({ ok: false })
    let doc = one
    const ids = [one.active]
    for (let i = 0; i < 2; i += 1) { const r = addTab(doc, { kind: 'blank', name: `B${i}` }, blankBoard(MINE), snapOf(MINE), 50 + i); doc = r.doc; ids.push(r.id) }
    // [own, B0, B1*]: closing the selected last tab selects the one to its left
    const a = closeTab(doc, ids[2], snapOf(MINE))
    expect(a.doc.active).toBe(ids[1])
    expect(a.activate.id).toBe(ids[1])
    // [own*, B0, B1]: closing the selected first tab selects the one to its right
    const firstOn = selectTab(doc, ids[0], snapOf(MINE)).doc
    const b = closeTab(firstOn, ids[0], snapOf(MINE))
    expect(b.doc.active).toBe(ids[1])
    // closing a tab that is not selected moves nothing on screen
    const c = closeTab(doc, ids[0], snapOf(MINE))
    expect(c).toMatchObject({ ok: true, activate: null })
    expect(c.doc.active).toBe(ids[2])
    expect(c.doc.tabs.map((t) => t.id)).toEqual([ids[1], ids[2]])
  })

  it('a ready-made, stock or saved board has one tab: tabFor finds it', () => {
    const doc = addTab(own(), { kind: 'stock', ref: 'stock-glance', name: 'Stock at a glance', sym: 'NVDA' }, blankBoard(MINE), snapOf(MINE), 7).doc
    expect(tabFor(doc, { kind: 'stock', ref: 'stock-glance', sym: 'nvda' })?.kind).toBe('stock')
    expect(tabFor(doc, { kind: 'stock', ref: 'stock-glance', sym: 'AAPL' })).toBeNull()
    expect(tabFor(doc, { kind: 'own' })).toBeNull()
    expect(tabFor(doc, { kind: 'starter', ref: 'leaders' })).toBeNull()
  })
})

describe('renaming', () => {
  it('a saved board, "My board" and a blank board can be renamed; a UCT board keeps its name', () => {
    expect(['saved', 'own', 'blank'].every((kind) => canRename(tab({ kind })))).toBe(true)
    expect(['starter', 'stock'].some((kind) => canRename(tab({ kind })))).toBe(false)
    const doc = own()
    expect(activeTab(renameTab(doc, doc.active, '  Morning  ')).name).toBe('Morning')
    expect(renameTab(doc, doc.active, '   ')).toBe(doc)
    const uct = retargetTab(doc, doc.active, { kind: 'starter', ref: 'leaders', name: 'Leaders' })
    expect(renameTab(uct, uct.active, 'Mine')).toBe(uct)
  })

  it('retargetTab makes the tab the saved board it was saved as', () => {
    const doc = own()
    expect(activeTab(retargetTab(doc, doc.active, { kind: 'saved', ref: 'b1', name: 'Swing' }))).toMatchObject({ kind: 'saved', ref: 'b1', name: 'Swing', id: doc.active })
  })
})

describe('"does this tab hold changes saved nowhere else?"', () => {
  const lib = saveBoard(emptyLibrary(), 'Swing Board', MINE, {}, 1000).library
  const ctxOf = (snapshot, library = emptyLibrary()) => ({ layout: snapshot, library })

  it('a ready-made board: no until it is changed', () => {
    const snap = boardSnapshot(starter(0))
    const t = tab({ kind: 'starter', ref: STARTER_BOARDS[0].id, name: STARTER_BOARDS[0].name })
    expect(tabUnsaved(t, snap, ctxOf(snap))).toBe(false)
    expect(differsFromDefault(t, snap, ctxOf(snap))).toBe(false)
    const changed = setCount(snap, 2)
    expect(tabUnsaved(t, changed, ctxOf(changed))).toBe(true)
    expect(differsFromDefault(t, changed, ctxOf(changed))).toBe(true)
    expect(boardSignature(tabBase(t, ctxOf(changed)))).toBe(boardSignature(snap))   // what "Reset" returns to
  })

  it('"My board": yes, unless one of the saved boards is the same board', () => {
    const snap = snapOf(MINE)
    expect(tabUnsaved(tab(), snap, ctxOf(snap))).toBe(true)
    expect(tabUnsaved(tab(), snap, ctxOf(snap, lib))).toBe(false)
    expect(differsFromDefault(tab(), snap, ctxOf(snap))).toBe(false)               // not a UCT board: no reset
  })

  it('a saved board: no until it differs from what is saved; yes when the saved board is gone', () => {
    const t = tab({ kind: 'saved', ref: lib.boards[0].id, name: 'Swing Board' })
    const snap = snapOf(MINE, { A: 'TSLA' })
    expect(tabUnsaved(t, snap, ctxOf(snap, lib))).toBe(false)
    const changed = setCount(snap, 4)
    expect(tabUnsaved(t, changed, ctxOf(changed, lib))).toBe(true)
    expect(tabUnsaved(t, snap, ctxOf(snap))).toBe(true)
  })

  it('a blank board: no until something is put on it', () => {
    const snap = blankBoard(MINE)
    const t = tab({ kind: 'blank', name: BLANK_NAME })
    expect(snap.count).toBe(1)
    expect(tabUnsaved(t, snap, ctxOf(snap))).toBe(false)
    const changed = setCount(snap, 2)
    expect(tabUnsaved(t, changed, ctxOf(changed))).toBe(true)
  })
})

describe('the two-key gap: a switch whose second write was lost', () => {
  const mine = snapOf(MINE, { A: 'NVDA' })
  const switched = () => addTab(own(), { kind: 'starter', ref: STARTER_BOARDS[0].id, name: 'x' }, boardSnapshot(starter(0)), mine, 7).doc

  it('heals when the stored board is still the one that was replaced', () => {
    expect(needsHeal(switched(), mine)).toBe(true)
  })

  it('does not heal once the stored board has moved on, or when nothing is pending', () => {
    const doc = switched()
    expect(needsHeal(doc, boardSnapshot(starter(0)))).toBe(false)
    expect(needsHeal(doc, setCount(mine, 4))).toBe(false)          // a later edit: not the outgoing board any more
    expect(needsHeal(clearPending(doc), mine)).toBe(false)
    const clear = clearPending(doc)
    expect(clear).toMatchObject({ pending: null, pendingFrom: null })
    expect(clearPending(clear)).toBe(clear)                        // nothing pending: the same document, no write
  })
})
