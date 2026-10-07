// Lane T2 — the board model, pure. The shell-level behaviour is TerminalBoards.test.jsx.
import { describe, it, expect } from 'vitest'
import {
  BOARD_ADDRESS_RE, CLOSED_MAX, DEFAULT_LAYOUT, MAX_CHANNELS, MAX_VISIBLE, addChannel, applyChannelSym,
  boardAddress, channelSyms, closePanel, decodePopout, decodeShare, deleteBoard, duplicatePanel, encodeShare,
  findBoard, groupLetter, isGuardedStatus, migrateV1, normalizeLayout, openBoard, panelBeside, panelSym, popoutHref, presetFor,
  readLayout, readLibrary, recentBoards, markOpened, saveBoard, serializeLayout, setCount, setPanelChannel,
  setPreset, toggleFavorite, undoClose, emptyLibrary,
} from './boardModel'

const V1 = { v: 1, count: 4, focus: 1, panels: [
  { code: 'GP', group: 'A' }, { code: 'DES', group: 'A' }, { code: 'CN', group: 'B' }, { code: 'FA', group: 'N', sym: 'MSFT' },
] }

describe('reading the stored layout — never silently the default', () => {
  it('absent is the default board, and saving it is allowed', () => {
    const r = readLayout(undefined)
    expect(r.status).toBe('absent')
    expect(isGuardedStatus(r.status)).toBe(false)
    expect(r.layout.panels[0].code).toBe('CAL')
  })

  it('a blob that does not parse is UNREADABLE, not absent (IA §2 #7)', () => {
    const r = readLayout('{"v":2,"panels":[{"code":"GP"')
    expect(r.status).toBe('unreadable')
    expect(isGuardedStatus(r.status)).toBe(true)
  })

  it('a foreign shape is unreadable; a later version is NEWER — both guarded', () => {
    expect(readLayout('{"hello":1}').status).toBe('unreadable')
    expect(readLayout('[1,2]').status).toBe('unreadable')
    expect(readLayout('{"v":7,"panels":[]}').status).toBe('newer')
    expect(isGuardedStatus('newer')).toBe(true)
  })

  it('the v1 SHIM: letters become channels, N becomes unlinked with its own security', () => {
    const r = readLayout(JSON.stringify(V1))
    expect(r.status).toBe('migrated')
    expect(r.layout.v).toBe(2)
    expect(r.layout.panels.map((p) => p.channel)).toEqual(['A', 'A', 'B', null])
    expect(r.layout.panels[3].sym).toBe('MSFT')
    expect(r.layout.count).toBe(4)
    expect(r.layout.focus).toBe(1)
  })

  it('a v1 shape the old reader would have rejected is still unreadable, not migrated', () => {
    expect(readLayout('{"v":1,"panels":"nope"}').status).toBe('unreadable')
  })

  it('A–D stays READABLE: every serialised panel carries its group letter', () => {
    const l = migrateV1(V1)
    const s = JSON.parse(serializeLayout(l))
    expect(s.panels.map((p) => p.group)).toEqual(['A', 'A', 'B', 'N'])
    const { layout: withE, id } = addChannel(l)
    const moved = setPanelChannel(withE, 0, id, {})
    expect(groupLetter(moved.panels[0])).toBe('E')
  })

  it('round-trips: serialise then read is the same board', () => {
    const l = migrateV1(V1)
    const back = readLayout(serializeLayout(l))
    expect(back.status).toBe('ok')
    expect(back.layout.panels.slice(0, 4).map((p) => [p.id, p.code, p.channel, p.sym]))
      .toEqual(l.panels.slice(0, 4).map((p) => [p.id, p.code, p.channel, p.sym]))
  })
})

describe('channels — a record, not a four-letter ceiling', () => {
  it('A–D are always present; their security is charts_workspace_groups\', never the record\'s', () => {
    const l = normalizeLayout({ v: 2, panels: [], channels: [{ id: 'A', sym: 'IGNORED' }] })
    expect(l.channels.map((c) => c.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(channelSyms(l, { A: 'nvda' }).A).toBe('NVDA')
    expect(l.channels[0].sym).toBe(null)
  })

  it('a fifth channel exists, holds its own security, and links panels', () => {
    let { layout, id } = addChannel(DEFAULT_LAYOUT)
    expect(id).toBe('E')
    layout = setPanelChannel(layout, 1, 'E', {})
    layout = applyChannelSym(layout, 'E', 'amd')
    const syms = channelSyms(layout, { A: 'NVDA' })
    expect(syms.E).toBe('AMD')
    expect(panelSym(layout.panels[1], syms)).toBe('AMD')
    expect(panelSym(layout.panels[0], syms)).toBe('NVDA')
  })

  it('the bound is MAX_CHANNELS, said with a null id rather than a silent overwrite', () => {
    let l = DEFAULT_LAYOUT
    for (let i = 0; i < 20; i++) l = addChannel(l).layout
    expect(l.channels).toHaveLength(MAX_CHANNELS)
    expect(addChannel(l).id).toBe(null)
  })

  it('history is per channel, most recent first, deduped', () => {
    let l = applyChannelSym(DEFAULT_LAYOUT, 'A', 'NVDA')
    l = applyChannelSym(l, 'A', 'AMD')
    l = applyChannelSym(l, 'A', 'NVDA')
    l = applyChannelSym(l, 'B', 'TSLA')
    expect(l.channels.find((c) => c.id === 'A').history).toEqual(['NVDA', 'AMD'])
    expect(l.channels.find((c) => c.id === 'B').history).toEqual(['TSLA'])
    expect(l.activeChannel).toBe('B')
  })

  it('unlinking keeps the security the panel was showing', () => {
    const l = setPanelChannel(DEFAULT_LAYOUT, 2, null, { A: 'NVDA' })
    expect(l.panels[2].channel).toBe(null)
    expect(l.panels[2].sym).toBe('NVDA')
  })

  it('a function with no security variant is not linkable and ignores its channel', () => {
    const cal = { id: 'x', code: 'CAL', channel: 'A' }
    expect(panelSym({ ...cal, linkable: false, sym: 'X' }, { A: 'NVDA' })).toBe('X')
  })
})

describe('the panel lifecycle', () => {
  const four = setCount(migrateV1(V1), 4)

  it('close removes a visible panel, pushes it on the undo stack, and keeps four slots', () => {
    const r = closePanel(four, 1)
    expect(r.ok).toBe(true)
    expect(r.layout.count).toBe(3)
    expect(r.layout.panels.slice(0, 3).map((p) => p.code)).toEqual(['GP', 'CN', 'FA'])
    expect(r.layout.closed[0]).toMatchObject({ index: 1, panel: { code: 'DES' } })
    expect(r.layout.panels.length).toBeGreaterThanOrEqual(4)
  })

  it('the last visible panel cannot close', () => {
    expect(closePanel(setCount(four, 1), 0)).toMatchObject({ ok: false, reason: 'last' })
  })

  it('undo puts it back where it was, with its id, and pops the stack', () => {
    const closed = closePanel(four, 1).layout
    const r = undoClose(closed)
    expect(r.ok).toBe(true)
    expect(r.layout.count).toBe(4)
    expect(r.layout.panels.slice(0, 4).map((p) => p.code)).toEqual(['GP', 'DES', 'CN', 'FA'])
    expect(r.layout.panels[1].id).toBe(four.panels[1].id)
    expect(r.layout.closed).toEqual([])
    expect(undoClose(r.layout).ok).toBe(false)
  })

  it('the undo stack is bounded', () => {
    let l = four
    for (let i = 0; i < CLOSED_MAX + 5; i++) {
      l = closePanel(setCount(l, 2), 0).layout
    }
    expect(l.closed).toHaveLength(CLOSED_MAX)
  })

  it('duplicate inserts a copy beside it on the same channel, and refuses a full board', () => {
    const two = setCount(four, 2)
    const r = duplicatePanel(two, 0)
    expect(r.ok).toBe(true)
    expect(r.layout.count).toBe(3)
    expect(r.layout.panels[1]).toMatchObject({ code: 'GP', channel: 'A' })
    expect(r.layout.panels[1].id).not.toBe(r.layout.panels[0].id)
    expect(duplicatePanel(four, 0)).toMatchObject({ ok: false, reason: 'full' })
    expect(four.count).toBe(MAX_VISIBLE)
  })

  it('a panel that becomes visible unlinked and empty joins the active channel (late-added inherits context)', () => {
    const l = normalizeLayout({ v: 2, count: 1, activeChannel: 'B', panels: [
      { id: 'a', code: 'GP', channel: 'B' }, { id: 'b', code: 'CN', channel: null },
    ] })
    const two = setCount(l, 2)
    expect(two.panels[1].channel).toBe('B')
  })

  it('pop-out encodes a frozen, unlinked copy of the panel', () => {
    const href = popoutHref({ code: 'GP', args: ['W'] }, 'NVDA')
    const token = new URLSearchParams(href.split('?')[1]).get('popout')
    expect(decodePopout(token)).toMatchObject({ code: 'GP', sym: 'NVDA', args: ['W'], channel: null })
    expect(decodePopout('%%%')).toBe(null)
  })
})

describe('the library — named, addressable, shareable boards', () => {
  const syms = { A: 'NVDA', B: 'TSLA' }

  it('save names a board and gives it a B: address; the same name overwrites', () => {
    let { library, board, ok } = saveBoard(emptyLibrary(), 'Earnings Morning!', DEFAULT_LAYOUT, syms, 1000)
    expect(ok).toBe(true)
    expect(board.slug).toBe('earnings-morning')
    expect(boardAddress(board)).toBe('B:earnings-morning')
    expect(BOARD_ADDRESS_RE.test(boardAddress(board))).toBe(true)
    const again = saveBoard(library, 'earnings morning', setCount(DEFAULT_LAYOUT, 2), syms, 2000)
    expect(again.library.boards).toHaveLength(1)
    expect(again.board.layout.count).toBe(2)
    library = again.library
    expect(findBoard(library, 'B:Earnings-Morning')?.id).toBe(board.id)
    expect(findBoard(library, 'B:nope')).toBe(null)
  })

  it('a saved board carries its CONTENT: every channel\'s security, A–D included', () => {
    const { board } = saveBoard(emptyLibrary(), 'x', DEFAULT_LAYOUT, syms, 1)
    expect(board.layout.channels.find((c) => c.id === 'A').sym).toBe('NVDA')
    const { library } = readLibrary(JSON.stringify(saveBoard(emptyLibrary(), 'x', DEFAULT_LAYOUT, syms, 1).library))
    expect(library.boards[0].layout.channels.find((c) => c.id === 'B').sym).toBe('TSLA')
  })

  it('opening a board hands back the A–D securities to write, and a preset ticker retargets its active channel', () => {
    const { board } = saveBoard(emptyLibrary(), 'x', DEFAULT_LAYOUT, syms, 1)
    expect(openBoard(board.layout).compatSyms).toEqual({ A: 'NVDA', B: 'TSLA' })
    const o = openBoard(board.layout, { sym: 'amd' })
    expect(o.compatSyms.A).toBe('AMD')
    expect(o.layout.channels.every((c) => c.sym === null || !['A', 'B', 'C', 'D'].includes(c.id))).toBe(true)
  })

  it('a share token round-trips the board, and garbage is refused', () => {
    const token = encodeShare('My board', DEFAULT_LAYOUT, syms)
    const d = decodeShare(token)
    expect(d.name).toBe('My board')
    expect(d.layout.panels[0].code).toBe('CAL')
    expect(openBoard(d.layout).compatSyms).toEqual({ A: 'NVDA', B: 'TSLA' })
    expect(decodeShare('not-a-token')).toBe(null)
    expect(decodeShare('x'.repeat(7000))).toBe(null)
  })

  it('a share of a STORED board keeps its saved securities (no live syms passed)', () => {
    const { board } = saveBoard(emptyLibrary(), 'x', DEFAULT_LAYOUT, syms, 1)
    expect(openBoard(decodeShare(encodeShare(board.name, board.layout, null)).layout).compatSyms)
      .toEqual({ A: 'NVDA', B: 'TSLA' })
  })

  it('presets: a ticker\'s own beats the any-ticker one; deleting the board clears both', () => {
    let lib = saveBoard(emptyLibrary(), 'one', DEFAULT_LAYOUT, syms, 1).library
    lib = saveBoard(lib, 'two', DEFAULT_LAYOUT, syms, 2).library
    const [one, two] = lib.boards
    lib = setPreset(lib, '*', one.id)
    lib = setPreset(lib, 'nvda', two.id)
    expect(presetFor(lib, 'NVDA').id).toBe(two.id)
    expect(presetFor(lib, 'AMD').id).toBe(one.id)
    lib = deleteBoard(lib, two.id)
    expect(presetFor(lib, 'NVDA').id).toBe(one.id)
    lib = setPreset(lib, '*', null)
    expect(presetFor(lib, 'NVDA')).toBe(null)
  })

  it('saved-object recents are boards by when they were opened', () => {
    let lib = saveBoard(emptyLibrary(), 'one', DEFAULT_LAYOUT, syms, 1).library
    lib = saveBoard(lib, 'two', DEFAULT_LAYOUT, syms, 2).library
    lib = markOpened(lib, lib.boards[0].id, 10)
    expect(recentBoards(lib).map((b) => b.name)).toEqual(['one', 'two'])
  })

  it('favourites hold only real codes', () => {
    let lib = toggleFavorite(emptyLibrary(), 'gp')
    lib = toggleFavorite(lib, 'NOTACODE')
    expect(lib.favorites).toEqual(['GP'])
    expect(toggleFavorite(lib, 'GP').favorites).toEqual([])
  })

  it('an unreadable library is guarded like an unreadable layout', () => {
    expect(readLibrary('{oops').status).toBe('unreadable')
    expect(readLibrary(undefined).status).toBe('absent')
    expect(readLibrary('{"v":9}').status).toBe('newer')
  })
})

describe('recents de-duplicate one security spelled two ways (audit #22)', () => {
  it('BRK.B and BRK-B are one entry in a channel\'s history — the newest spelling wins', () => {
    let l = applyChannelSym(DEFAULT_LAYOUT, 'A', 'BRK-B')
    l = applyChannelSym(l, 'A', 'NVDA')
    l = applyChannelSym(l, 'A', 'BRK.B')
    expect(l.channels.find((c) => c.id === 'A').history).toEqual(['BRK.B', 'NVDA'])
  })
})

describe('panelBeside: an "open X" link in a list panel lands beside the list', () => {
  const board = (count, codes) => normalizeLayout({ ...DEFAULT_LAYOUT, count, focus: 0,
    panels: codes.map((code, i) => ({ id: `p${i + 1}`, code, channel: i === 0 ? null : 'A', sym: null, args: [] })) })

  it('with room, inserts a fresh panel right after the list, on the list panel channel', () => {
    const l = board(2, ['MOST', 'GP', 'FA', 'DES'])
    const out = panelBeside(l, 0, 'MOVE')
    expect(out).toMatchObject({ index: 1, added: true })
    expect(out.layout.count).toBe(3)
    expect(out.layout.panels.slice(0, 3).map((p) => p.code)).toEqual(['MOST', 'MOVE', 'GP'])
    expect(out.layout.panels[1].channel).toBe(null)          // MOST is unlinked, so is its story
    expect(new Set(out.layout.panels.map((p) => p.id)).size).toBe(out.layout.panels.length)
  })

  it('reuses the next panel when it already shows that function (no stacking)', () => {
    const l = board(2, ['MOST', 'MOVE', 'FA', 'DES'])
    expect(panelBeside(l, 0, 'MOVE')).toMatchObject({ index: 1, added: false, layout: l })
  })

  it('on a full board, reuses the next visible panel and wraps from the last', () => {
    const l = board(MAX_VISIBLE, ['GP', 'FA', 'DES', 'RRG'])
    expect(panelBeside(l, 1, 'MOVE')).toMatchObject({ index: 2, added: false })
    expect(panelBeside(l, MAX_VISIBLE - 1, 'GP')).toMatchObject({ index: 0, added: false })
  })
})
