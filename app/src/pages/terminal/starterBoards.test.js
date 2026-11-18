// Ready-made boards — the pure half: the ONE list is checked against the function registry, the
// board each entry opens is an ordinary boardModel layout, and keeping one never replaces a
// board the member made. The menu half is BoardsMenu.starter.test.jsx, the shell half is
// TerminalShell.starterBoards.test.jsx.
//
//     cd app && npx vitest run src/pages/terminal/starterBoards.test.js --maxWorkers=2
//
// ⛔ THE CHECK IS DERIVED. Every command of every entry is read through the one parser
// (parseCommand) and the registry (functions.js), and its panel through the importer table the
// shell mounts from (panels.jsx / surfacePanels.js). A code renamed, removed, turned into a door,
// put behind a flag, or given an argument it stopped taking fails HERE, by name, before a member
// can open a board with a dead panel. Each rule also runs against a fixture that MUST fail.
import { describe, it, expect } from 'vitest'
import {
  STARTER_ABOUT_MAX, STARTER_BOARDS, buildStarterBoard, findStarterBoard, freeBoardName, readStarterCommand,
  starterBoardNotice, starterBoardProblems, starterBoardsProblems,
} from './starterBoards'
import {
  DEFAULT_LAYOUT, MAX_BOARDS, MAX_VISIBLE, addChannel, applyChannelSym, emptyLibrary, openBoard, panelChannel,
  readLayout, saveBoard, serializeLayout, setCount as countOf,
} from './boardModel'
import { BY_CODE, FUNCTIONS, variantFor } from './functions'
import { PANEL_IMPORTERS, URL_OWNING_PANELS, panelNameFor } from './panels'
import { SURFACE_IMPORTERS_BY_ID } from './surfacePanels'
import parseCommand from './parseCommand'
import { applyArgs } from './args'
import { resolvePanel } from './TerminalShell'

const board = (over = {}) => ({
  id: 'fixture', name: 'Fixture', about: 'One plain sentence for the fixture.', commands: ['HILO'], ...over,
})

describe('the shipped list — every entry is checked against the registry', () => {
  it('CONTROL: there is a list to check', () => {
    expect(STARTER_BOARDS.length).toBeGreaterThan(0)
    expect(STARTER_BOARDS.flatMap((b) => b.commands).length).toBeGreaterThan(STARTER_BOARDS.length)
  })

  it('the whole list has no problem (ids and names unique, sentences, panel counts, commands)', () => {
    expect(starterBoardsProblems()).toEqual([])
  })

  it.each(STARTER_BOARDS.map((b) => [b.name, b]))('%s: holds 1 to MAX_VISIBLE panels, and each command opens a registered panel', (_n, b) => {
    expect(b.commands.length).toBeGreaterThanOrEqual(1)
    expect(b.commands.length).toBeLessThanOrEqual(MAX_VISIBLE)
    for (const text of b.commands) {
      // Independently of the module under test: the parser, the registry, the importer table.
      const cmd = parseCommand(text)
      expect(cmd.ok, `${b.name}: "${text}" must parse`).toBe(true)
      expect(cmd.type, `${b.name}: "${text}" must be a function command`).toBe('function')
      // The command NAMES the code it runs. A word the registry no longer knows reads as a
      // ticker and would open that "stock's" overview (code DES), passing every check below.
      expect(text.toUpperCase().split(/\s+/), `${b.name}: "${text}" reads as ${cmd.sym || ''} ${cmd.code}, a code it does not name`).toContain(cmd.code)
      expect(FUNCTIONS.some((f) => f.code === cmd.code), `${b.name}: ${cmd.code} must be a registered code`).toBe(true)
      const { variant, ignoredTicker } = variantFor(cmd.code, !!cmd.sym)
      expect(variant, `${b.name}: "${text}" needs a ticker it does not carry`).toBeTruthy()
      expect(ignoredTicker, `${b.name}: "${text}" carries a ticker its code drops`).toBeFalsy()
      expect(variant.door, `${b.name}: "${text}" is a door out of the terminal`).toBeUndefined()
      expect(variant.flag, `${b.name}: "${text}" is behind a flag`).toBeUndefined()
      const name = panelNameFor(variant)
      expect(typeof (PANEL_IMPORTERS[name] || SURFACE_IMPORTERS_BY_ID[name]), `${b.name}: "${text}" mounts no panel module`).toBe('function')
      expect(applyArgs(variant, cmd.args).ignored, `${b.name}: "${text}" has an argument that is not applied`).toEqual([])
    }
  })

  it('no entry is a ticker-only code without a ticker (a market board opens the same for everyone)', () => {
    for (const b of STARTER_BOARDS) {
      for (const text of b.commands) {
        const r = readStarterCommand(text)
        expect(r.ok, `${b.name}: ${r.why}`).toBe(true)
        if (!BY_CODE[r.code].market) expect(r.sym, `${b.name}: ${r.code} needs a ticker`).toBeTruthy()
      }
    }
  })

  it('names are unique whatever the case or spacing, and each has ONE plain sentence', () => {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const names = STARTER_BOARDS.map((b) => norm(b.name))
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(STARTER_BOARDS.map((b) => b.id)).size).toBe(STARTER_BOARDS.length)
    for (const b of STARTER_BOARDS) {
      expect(b.about.length, b.name).toBeLessThanOrEqual(STARTER_ABOUT_MAX)
      expect(b.about, b.name).toMatch(/^[A-Z].*\.$/)
      expect(b.about.slice(0, -1), `${b.name}: one sentence`).not.toMatch(/[.!?]\s/)
      // Sentence case, plain punctuation: no dash a member would not type.
      expect(`${b.name} ${b.about}`).not.toMatch(/[–—]/)
      expect(b.name).toBe(b.name[0].toUpperCase() + b.name.slice(1).toLowerCase())
    }
  })

  it('the Earnings season board opens on the earnings season screen, a market-wide panel with no flag', () => {
    const b = findStarterBoard('earnings-season')
    expect(b.commands[0]).toBe('ERNS')
    expect(b.commands).toHaveLength(MAX_VISIBLE)
    expect(readStarterCommand('ERNS')).toEqual({ ok: true, code: 'ERNS', sym: null, args: [], name: 'EarningsSeason' })
    expect(BY_CODE.ERNS.market.flag).toBeUndefined()
    expect(URL_OWNING_PANELS.has('EarningsSeason')).toBe(false)       // the calendar stays the board's one address-bar panel
    // its typed words would be taken too, were the board ever to carry one
    expect(readStarterCommand('ERNS TONIGHT')).toMatchObject({ ok: true, code: 'ERNS', args: ['TONIGHT'] })
    expect(readStarterCommand('ERNS SIDEWAYS').ok).toBe(false)
  })

  it('the list is frozen data (nothing can rewrite an entry at run time)', () => {
    expect(Object.isFrozen(STARTER_BOARDS)).toBe(true)
    for (const b of STARTER_BOARDS) {
      expect(Object.isFrozen(b)).toBe(true)
      expect(Object.isFrozen(b.commands)).toBe(true)
    }
    expect(findStarterBoard(STARTER_BOARDS[0].id)).toBe(STARTER_BOARDS[0])
    expect(findStarterBoard('nope')).toBe(null)
  })
})

describe('the check can fail — each rule against a fixture that must', () => {
  it('CONTROL: the fixture itself is clean', () => {
    expect(starterBoardProblems(board())).toEqual([])
  })

  const BAD = [
    // A word the registry does not know reads as a TICKER: this is what a removed code looks like.
    ['a code that does not exist (it reads as a ticker)', { commands: ['HILO', 'ZZZQ'] }, /names no function code/],
    ['a retired code', { commands: ['SETL'] }, /does not parse|names no function code/],
    ['an alias of a code', { commands: ['MOVERS'] }, /names no function code/],
    ['a ticker-only code with no ticker', { commands: ['LVL'] }, /LVL needs a ticker/],
    ['another ticker-only code with no ticker', { commands: ['EXMV'] }, /EXMV needs a ticker/],
    ['a ticker on a market-wide code', { commands: ['NVDA HILO'] }, /market-wide/],
    ['a door out of the terminal', { commands: ['DASH'] }, /outside the terminal/],
    ['a flagged code', { commands: ['OSCR'] }, /flag/],
    ['an argument the code does not take', { commands: ['HILO SIDEWAYS'] }, /does not take "SIDEWAYS"/],
    ['an alias instruction', { commands: ['ALIAS HIGHS = HILO'] }, /not a function command/],
    ['a panel target', { commands: ['@2 HILO'] }, /aims at a panel/],
    ['a free-text question', { commands: ['why is the market down?'] }, /not a function command/],
    ['no panels', { commands: [] }, /1 to 4 panels/],
    ['five panels', { commands: ['HILO', 'SCTR', 'UPDG', 'TROT', 'LEAD'] }, /1 to 4 panels/],
    ['the same panel twice', { commands: ['HILO', 'HILO'] }, /on the board twice/],
    ['two panels that own the address bar', { commands: ['CAL', 'SCR'] }, /own the address bar/],
    ['no sentence', { about: '' }, /one sentence/],
    ['two sentences', { about: 'First sentence. Second sentence.' }, /ONE sentence/],
    ['a sentence with no full stop', { about: 'No full stop' }, /ONE sentence/],
    ['a sentence too long for the menu', { about: `${'word '.repeat(60)}end.` }, /longer than/],
    ['no name', { name: ' ' }, /needs a name/],
    ['an id that is not a slug', { id: 'Not A Slug' }, /lower-case slug/],
  ]
  it.each(BAD)('%s is refused', (_what, over, why) => {
    const problems = starterBoardProblems(board(over))
    expect(problems.join(' | ')).toMatch(why)
    expect(buildStarterBoard(DEFAULT_LAYOUT, board(over))).toBe(null)   // …and it never opens
  })

  it('CONTROL: the fixtures name real codes of the kind they claim (so each fails for ITS reason)', () => {
    expect(BY_CODE.LVL.market).toBeUndefined()
    expect(BY_CODE.EXMV.market).toBeUndefined()
    expect(BY_CODE.DASH.market.door).toBeTruthy()
    expect(BY_CODE.OSCR.market.flag).toBeTruthy()
    expect(BY_CODE.HILO.ticker).toBeUndefined()
    expect(URL_OWNING_PANELS.has(panelNameFor(BY_CODE.CAL.market))).toBe(true)
    expect(URL_OWNING_PANELS.has(panelNameFor(BY_CODE.SCR.market))).toBe(true)
  })

  it('a second board with the same name or id is refused, whatever the case', () => {
    const a = board()
    const twin = board({ id: 'other', name: 'FIXTURE ' })
    expect(starterBoardsProblems([a, twin]).join(' | ')).toMatch(/name is used twice/)
    expect(starterBoardsProblems([a, board({ name: 'Another' })]).join(' | ')).toMatch(/id fixture is used twice/)
    expect(starterBoardsProblems([a, board({ id: 'other', name: 'Another' })])).toEqual([])
  })

  it('a code that carries its own ticker is allowed, and holds it', () => {
    const b = board({ commands: ['HILO', 'NVDA EXMV'] })
    expect(starterBoardProblems(b)).toEqual([])
    const built = buildStarterBoard(DEFAULT_LAYOUT, b)
    expect(built.panels[1]).toMatchObject({ code: 'EXMV', sym: 'NVDA', channel: null })
  })
})

describe('buildStarterBoard — an ordinary board, one panel per command', () => {
  it.each(STARTER_BOARDS.map((b) => [b.name, b]))('%s: every panel is on screen, in order, and READY for a member with no flags at all', (_n, b) => {
    const built = buildStarterBoard(DEFAULT_LAYOUT, b)
    expect(built.count).toBe(b.commands.length)
    expect(built.focus).toBe(0)
    expect(built.closed).toEqual([])
    const visible = built.panels.slice(0, built.count)
    visible.forEach((p, i) => {
      const r = resolvePanel(p, {}, {})                      // the shell's own resolver, no auth flags
      expect(r.state, `${b.name}: ${b.commands[i]}`).toBe('ready')
      expect([p.sym, p.code, ...p.args].filter(Boolean).join(' ')).toBe(b.commands[i].toUpperCase())   // the command, whole
      expect(panelChannel(p)).toBe(built.activeChannel)        // market panels join the active group
    })
    expect(new Set(visible.map((p) => p.id)).size).toBe(visible.length)
    // It survives the stored round trip unchanged (it IS a valid v2 board).
    expect(readLayout(serializeLayout(built))).toEqual({ layout: built, status: 'ok' })
  })

  it('an argument rides in the panel (PCHG QTD opens the quarter, not the bare panel)', () => {
    const leaders = STARTER_BOARDS.find((b) => b.commands.includes('PCHG QTD'))
    expect(leaders, 'the fixture this test reads: a board with PCHG QTD').toBeTruthy()
    const built = buildStarterBoard(DEFAULT_LAYOUT, leaders)
    const p = built.panels.find((x) => x.code === 'PCHG')
    expect(p.args).toEqual(['QTD'])
    expect(resolvePanel(p, {}, {}).props).toMatchObject({ range: expect.anything() })
  })

  it('keeps the member\'s density and groups, and never carries a security for groups A to D', () => {
    let mine = { ...countOf(DEFAULT_LAYOUT, 2), density: 'dense' }
    const added = addChannel(mine)
    mine = applyChannelSym(added.layout, added.id, 'TSLA')      // group E holds TSLA in its record
    mine = { ...mine, activeChannel: 'B' }
    const built = buildStarterBoard(mine, STARTER_BOARDS[0])
    expect(built.density).toBe('dense')
    expect(built.channels.map((c) => c.id)).toEqual(mine.channels.map((c) => c.id))
    expect(built.channels.find((c) => c.id === 'E').sym).toBe('TSLA')
    expect(built.channels.filter((c) => 'ABCD'.includes(c.id)).every((c) => c.sym == null)).toBe(true)
    expect(built.activeChannel).toBe('B')
    // Opening it writes NO group security: /charts' groups are left exactly as they were.
    expect(openBoard(built).compatSyms).toEqual({})
  })

  it('does not mutate the board it was built from', () => {
    const before = serializeLayout(DEFAULT_LAYOUT)
    buildStarterBoard(DEFAULT_LAYOUT, STARTER_BOARDS[0])
    expect(serializeLayout(DEFAULT_LAYOUT)).toBe(before)
  })

  it('the notice names the board and its codes, and says the saved boards were not changed', () => {
    const b = STARTER_BOARDS[0]
    const text = starterBoardNotice(b)
    expect(text).toContain(b.name)
    for (const c of b.commands) expect(text).toContain(c)
    expect(text).toContain('Your saved boards were not changed')
  })
})

describe('freeBoardName — keeping a ready-made board never replaces a board the member made', () => {
  const lib = (...names) => names.reduce((l, n, i) => saveBoard(l, n, DEFAULT_LAYOUT, {}, 1000 + i).library, emptyLibrary())

  it('a free name is used as it is', () => {
    expect(freeBoardName(emptyLibrary(), 'Leaders')).toBe('Leaders')
    expect(freeBoardName(lib('Swing'), 'Leaders')).toBe('Leaders')
    expect(freeBoardName(undefined, 'Leaders')).toBe('Leaders')
  })

  it('a taken name (in any case or spacing) gets the first free number', () => {
    expect(freeBoardName(lib('Leaders'), 'Leaders')).toBe('Leaders 2')
    expect(freeBoardName(lib('LEADERS'), 'Leaders')).toBe('Leaders 2')
    expect(freeBoardName(lib('Leaders', 'leaders-2'), 'Leaders')).toBe('Leaders 3')
    expect(freeBoardName(lib('Leaders', 'Leaders 3'), 'Leaders')).toBe('Leaders 2')
  })

  it('saving under it ADDS a board and leaves the member\'s own board of that name byte-for-byte', () => {
    const mine = countOf(DEFAULT_LAYOUT, 3)
    const before = saveBoard(emptyLibrary(), 'Leaders', mine, { A: 'NVDA' }, 1000).library
    const kept = JSON.stringify(before.boards[0])
    const starter = STARTER_BOARDS.find((b) => b.name === 'Leaders')
    expect(starter, 'the fixture this test reads: a ready-made board named Leaders').toBeTruthy()
    const res = saveBoard(before, freeBoardName(before, starter.name), buildStarterBoard(mine, starter), {}, 2000)
    expect(res.ok).toBe(true)
    expect(res.library.boards).toHaveLength(2)
    expect(JSON.stringify(res.library.boards[0])).toBe(kept)
    expect(res.library.boards[1].name).toBe('Leaders 2')
    // CONTROL: the plain name is the one that WOULD have replaced it (why the free name exists).
    const naive = saveBoard(before, starter.name, buildStarterBoard(mine, starter), {}, 2000)
    expect(naive.library.boards).toHaveLength(1)
    expect(JSON.stringify(naive.library.boards[0])).not.toBe(kept)
  })

  it('always finds a name, even in a full library of numbered copies', () => {
    const names = ['Leaders', ...Array.from({ length: MAX_BOARDS - 1 }, (_, i) => `Leaders ${i + 2}`)]
    const full = lib(...names)
    expect(full.boards).toHaveLength(MAX_BOARDS)
    const name = freeBoardName(full, 'Leaders')
    expect(names.map((n) => n.toLowerCase())).not.toContain(name.toLowerCase())
  })
})
