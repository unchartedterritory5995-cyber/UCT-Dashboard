// Ready-made STOCK boards — the pure half: the ONE list (stockBoards.js) is checked against the
// function registry, the board an entry opens for a ticker is an ordinary boardModel layout whose
// panels all sit in ONE group of the board's own, and the typed command (`NVDA STOCK`) reads
// through the one parser. The menu half is BoardsMenu.stock.test.jsx, the shell half is
// TerminalShell.stockBoards.test.jsx.
//
//     cd app && npx vitest run src/pages/terminal/stockBoards.test.js --maxWorkers=2
//
// ⛔ THE CHECK IS DERIVED. Every code of every entry is read against the registry (functions.js)
// and its panel through the importer table the shell mounts from (panels.jsx), and again through
// the one parser with a ticker in front. A code renamed, removed, turned into a door, put behind a
// flag or made market-wide fails HERE, by name. Each rule also runs against a fixture that MUST fail.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  STOCK_BOARDS, STOCK_BOARD_WORD, defaultStockBoard, findStockBoard, stockBoardByWord, stockBoardCommand, stockBoardUsage,
} from './stockBoards'
import {
  STOCK_GROUP_NAME, buildStockBoard, readStockCode, stockBoardGroup, stockBoardNotice, stockBoardProblems, stockBoardRefusal,
  stockBoardTicker, stockBoardsProblems, stockTicker,
} from './stockBoardModel'
import {
  COMPAT_CHANNELS, DEFAULT_LAYOUT, MAX_CHANNELS, MAX_VISIBLE, addChannel, applyChannelSym, channelSyms, emptyLibrary, isCompatChannel,
  isLinkable, normalizeLayout, openBoard, panelChannel, panelSym, readLayout, saveBoard, serializeLayout, setCount as countOf,
} from './boardModel'
import { BY_CODE, FUNCTIONS, isCode } from './functions'
import { PANEL_IMPORTERS, URL_OWNING_PANELS, panelNameFor } from './panels'
import { STARTER_ABOUT_MAX, STARTER_BOARDS, readStarterCommand } from './starterBoards'
import parseCommand, { formatCommand } from './parseCommand'
import { RESERVED_WORDS, STOCK_BOARD_RULE, STOCK_BOARD_SHAPE, aliasNameRefusal, describeCommand } from './grammar'
import { terminalCommandRow } from './paletteGrammar'
import { resolvePanel, telemetryKey } from './TerminalShell'

const fixture = (over = {}) => ({
  id: 'fixture', word: 'FIXTURE', name: 'Fixture', about: 'One plain sentence for the fixture.', codes: ['GP', 'LVL'], ...over,
})
/** The group the visible panels of a built board sit in (one id when they share a group). */
const groupsOf = (l) => [...new Set(l.panels.slice(0, l.count).map((p) => panelChannel(p)))]
/** A layout whose board already has every group it can hold, each given `sym(i)` (null = empty). */
function fullBoard(sym) {
  let l = normalizeLayout(countOf(DEFAULT_LAYOUT, 2))
  for (let i = 0; l.channels.length < MAX_CHANNELS; i += 1) {
    const added = addChannel(l)
    l = sym(i) ? applyChannelSym(added.layout, added.id, sym(i)) : added.layout
  }
  return normalizeLayout({ ...l, activeChannel: 'A' })
}

describe('the shipped list: every stock board is checked against the registry', () => {
  it('CONTROL: there is a list to check, and its first entry is the default', () => {
    expect(STOCK_BOARDS.length).toBeGreaterThanOrEqual(2)
    expect(STOCK_BOARDS.length).toBeLessThanOrEqual(3)
    expect(defaultStockBoard()).toBe(STOCK_BOARDS[0])
    expect(STOCK_BOARDS.flatMap((b) => b.codes).length).toBeGreaterThan(STOCK_BOARDS.length)
  })

  it('the whole list has no problem (ids, names, words, sentences, panel counts, codes)', () => {
    expect(stockBoardsProblems()).toEqual([])
  })

  it.each(STOCK_BOARDS.map((b) => [b.name, b]))('%s: 1 to MAX_VISIBLE codes, each a registered per-stock panel with no flag and no door', (_n, b) => {
    expect(b.codes.length).toBeGreaterThanOrEqual(1)
    expect(b.codes.length).toBeLessThanOrEqual(MAX_VISIBLE)
    for (const code of b.codes) {
      // Independently of the module under test: the registry and the importer table.
      const fn = FUNCTIONS.find((f) => f.code === code)
      expect(fn, `${b.name}: ${code} must be a registered code (not an alias, not removed)`).toBeTruthy()
      const v = fn.ticker
      expect(v, `${b.name}: ${code} must take a ticker`).toBeTruthy()
      expect(v.door, `${b.name}: ${code} is a door out of the terminal`).toBeUndefined()
      expect(v.flag, `${b.name}: ${code} is behind a flag`).toBeUndefined()
      const name = panelNameFor(v)
      expect(typeof PANEL_IMPORTERS[name], `${b.name}: ${code} mounts no panel module`).toBe('function')
      expect(URL_OWNING_PANELS.has(name), `${b.name}: ${code} owns the address bar`).toBe(false)
      expect(name, `${b.name}: ${code} is the trader archive`).not.toBe('TraderArchive')
      expect(isLinkable({ code }), `${b.name}: ${code} must follow its group's ticker`).toBe(true)
      // …and through the ONE parser, with a ticker in front, exactly as a member would type it.
      const cmd = parseCommand(`NVDA ${code}`)
      expect(cmd, `${b.name}: "NVDA ${code}"`).toMatchObject({ ok: true, type: 'function', code, sym: 'NVDA', args: [] })
      expect(readStarterCommand(`NVDA ${code}`), `${b.name}: ${code}`).toMatchObject({ ok: true, code, sym: 'NVDA', name })
      // …and as the shell resolves a panel of the board's group, for a member with NO flags.
      const r = resolvePanel({ code, channel: 'E', args: [] }, { E: 'NVDA' }, {})
      expect(r, `${b.name}: ${code} for a member with no flags`).toMatchObject({ state: 'ready', sym: 'NVDA', name })
    }
  })

  it('the default board is the one that was offered: chart, earnings, options flow and key levels', () => {
    expect(defaultStockBoard().codes).toEqual(['GP', 'EXMV', 'FLOW', 'LVL'])
  })

  it('names, ids and words are unique, beside each other and beside the market boards; ONE plain sentence each', () => {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const all = [...STOCK_BOARDS, ...STARTER_BOARDS]
    expect(new Set(all.map((b) => norm(b.name))).size).toBe(all.length)
    expect(new Set(all.map((b) => b.id)).size).toBe(all.length)
    expect(new Set(STOCK_BOARDS.map((b) => b.word)).size).toBe(STOCK_BOARDS.length)
    for (const b of STOCK_BOARDS) {
      expect(b.about.length, b.name).toBeLessThanOrEqual(STARTER_ABOUT_MAX)
      expect(b.about, b.name).toMatch(/^[A-Z].*\.$/)
      expect(b.about.slice(0, -1), `${b.name}: one sentence`).not.toMatch(/[.!?]\s/)
      expect(`${b.name} ${b.about}`).not.toMatch(/[–—]/)
      expect(b.name).toBe(b.name[0].toUpperCase() + b.name.slice(1).toLowerCase())
      // No ticker in the data: the ticker is supplied when the board opens.
      for (const code of b.codes) expect(code, b.name).toMatch(/^[A-Z]{2,6}$/)
    }
  })

  it('the command word and every board word are not listed tickers, and not function codes', () => {
    // eslint-disable-next-line no-undef
    const universe = new Set(JSON.parse(readFileSync(join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.has('NVDA'), 'CONTROL: the universe file was read').toBe(true)
    expect(universe.has('SB'), 'CONTROL: the shorter spelling IS a listed ticker, which is why it was not used').toBe(true)
    expect(STOCK_BOARD_WORD).toMatch(/^[A-Z]{2,6}$/)
    for (const w of [STOCK_BOARD_WORD, ...STOCK_BOARDS.map((b) => b.word)]) {
      expect(universe.has(w), `${w} is a listed ticker`).toBe(false)
      expect(isCode(w), `${w} is a function code`).toBe(false)
    }
  })

  it('the list is frozen data, and the lookups read it', () => {
    expect(Object.isFrozen(STOCK_BOARDS)).toBe(true)
    for (const b of STOCK_BOARDS) {
      expect(Object.isFrozen(b)).toBe(true)
      expect(Object.isFrozen(b.codes)).toBe(true)
      expect(findStockBoard(b.id)).toBe(b)
      expect(stockBoardByWord(b.word)).toBe(b)
      expect(stockBoardByWord(b.word.toLowerCase())).toBe(b)
    }
    expect(findStockBoard('nope')).toBe(null)
    expect(stockBoardByWord('NOPE')).toBe(null)
    expect(stockBoardByWord('')).toBe(null)
    expect(stockBoardCommand(STOCK_BOARDS[0])).toBe('NVDA STOCK')
    expect(stockBoardCommand(STOCK_BOARDS[1], 'AMD')).toBe(`AMD STOCK ${STOCK_BOARDS[1].word}`)
    for (const b of STOCK_BOARDS) expect(stockBoardUsage()).toContain(`${stockBoardCommand(b)} (${b.name})`)
  })
})

describe('first-open bytes: the list rides the lazy Terminal chunk, and the parser reads only the list', () => {
  // eslint-disable-next-line no-undef
  const SRC = join(process.cwd(), 'src')
  const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
  const imports = (text) => [...text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    .concat([...text.matchAll(/^\s*export\s[^'"]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]))

  it('the entry chunk (App.jsx, TerminalRoutes.jsx) imports neither the list nor its model', () => {
    for (const file of ['App.jsx', 'pages/terminal/TerminalRoutes.jsx']) {
      const from = imports(read(file))
      expect(from.length, `CONTROL: ${file} was read`).toBeGreaterThan(3)
      for (const m of from) expect(m, `${file} imports ${m}`).not.toMatch(/stockBoard|starterBoards|BoardsMenu/)
    }
    // The files the entry-chunk route file DOES import stay clear of them too.
    for (const file of ['pages/terminal/boardPrefs.js', 'pages/terminal/terminalGate.js']) {
      for (const m of imports(read(file))) expect(m, `${file} imports ${m}`).not.toMatch(/stockBoard/)
    }
  })

  it('the list imports NOTHING, and the parser and the rules import the list, never its model or the panel table', () => {
    expect(imports(read('pages/terminal/stockBoards.js'))).toEqual([])
    for (const file of ['pages/terminal/parseCommand.js', 'pages/terminal/grammar.js']) {
      const from = imports(read(file))
      expect(from, file).toContain('./stockBoards')
      expect(from, file).not.toContain('./stockBoardModel')
      expect(from, file).not.toContain('./panels')
    }
    // CONTROL: the reader sees an import and a re-export.
    expect(imports(["import A from './a'", "export { b } from './b'", ''].join('\n'))).toEqual(['./a', './b'])
  })
})

describe('the check can fail: each rule against a fixture that must', () => {
  it('CONTROL: the fixture itself is clean', () => {
    expect(stockBoardProblems(fixture())).toEqual([])
  })

  const BAD = [
    ['a ticker in the data', { codes: ['NVDA GP'] }, /not a bare function code/],
    ['an argument in the data', { codes: ['GP W'] }, /not a bare function code/],
    ['a code that does not exist', { codes: ['GP', 'ZZZQ'] }, /ZZZQ is not a registered function/],
    ['a removed code', { codes: ['SETL'] }, /SETL is not a registered function/],
    ['another spelling of a code', { codes: ['WIIM'] }, /another spelling of MOVE/],
    ['a market-wide code', { codes: ['HILO'] }, /HILO is market-wide/],
    ['another market-wide code', { codes: ['CAL'] }, /CAL is market-wide/],
    ['a door out of the terminal', { codes: ['RES'] }, /outside the terminal/],
    ['a per-stock door (gamma exposure opens a page)', { codes: ['GEX'] }, /outside the terminal/],
    ['a flagged code', { codes: ['TECH'] }, /behind the researchTechnicalTabEnabled flag/],
    ['a flagged depth panel', { codes: ['ERX'] }, /flag/],
    ['a flagged options panel', { codes: ['OMON'] }, /flag/],
    ['a panel that owns the address bar', { codes: ['ERN'] }, /owns the address bar/],
    ['the trader archive', { codes: ['WHO'] }, /trader archive/],
    ['no panels', { codes: [] }, /1 to 4 panels/],
    ['five panels', { codes: ['GP', 'DES', 'CN', 'LVL', 'OWN'] }, /1 to 4 panels/],
    ['the same panel twice', { codes: ['GP', 'GP'] }, /GP is on the board twice/],
    ['no sentence', { about: '' }, /one sentence/],
    ['two sentences', { about: 'First sentence. Second sentence.' }, /ONE sentence/],
    ['a sentence with no full stop', { about: 'No full stop' }, /ONE sentence/],
    ['a sentence too long for the menu', { about: `${'word '.repeat(60)}end.` }, /longer than/],
    ['no name', { name: '  ' }, /needs a name/],
    ['an id that is not a slug', { id: 'Not A Slug' }, /lower-case slug/],
    ['a word in lower case', { word: 'earnings' }, /3 to 12 capitals/],
    ['no word', { word: undefined }, /3 to 12 capitals/],
    ['a word that is a function code', { word: 'FLOW' }, /FLOW is a function code/],
    ['a word the command line reserves', { word: 'BOARD' }, /reserved word/],
    ['the command word itself', { word: STOCK_BOARD_WORD }, /reserved word/],
  ]
  it.each(BAD)('%s', (_n, over, re) => {
    const problems = stockBoardProblems(fixture(over))
    expect(problems.join(' | ')).toMatch(re)
  })

  it('a name, an id or a word used twice, and a name or id a market board already has', () => {
    const a = fixture()
    expect(stockBoardProblems(a, [a, fixture({ id: 'other', word: 'OTHER' })]).join(' | ')).toMatch(/name is used twice/)
    expect(stockBoardProblems(a, [a, fixture({ name: 'Other', word: 'OTHER' })]).join(' | ')).toMatch(/id fixture is used twice/)
    expect(stockBoardProblems(a, [a, fixture({ id: 'other', name: 'Other' })]).join(' | ')).toMatch(/word FIXTURE is used twice/)
    const market = STARTER_BOARDS[0]
    expect(stockBoardProblems(fixture({ name: market.name.toUpperCase() })).join(' | ')).toMatch(/name is a market board's/)
    expect(stockBoardProblems(fixture({ id: market.id })).join(' | ')).toMatch(/is a market board's/)
    expect(stockBoardsProblems([a, fixture({ id: 'two', name: 'Two', word: 'TWO' })])).toEqual([])
    expect(stockBoardProblems(null)).toEqual(['a stock board must be an object'])
  })

  it('readStockCode names the panel it would mount, and refuses by name', () => {
    expect(readStockCode('LVL')).toEqual({ ok: true, code: 'LVL', name: 'Levels' })
    expect(readStockCode('EXMV')).toEqual({ ok: true, code: 'EXMV', name: 'ExpectedMove' })
    expect(readStockCode('lvl').ok).toBe(false)
    expect(readStockCode(undefined).ok).toBe(false)
  })
})

describe('the ticker a board opens for', () => {
  it('stockTicker: capitals, the $ escape dropped, a share class kept; anything else is not one', () => {
    expect(stockTicker('nvda')).toBe('NVDA')
    expect(stockTicker(' $amd ')).toBe('AMD')
    expect(stockTicker('BRK.B')).toBe('BRK.B')
    for (const bad of ['', null, undefined, 'TOOLONGX', 'NV DA', '12', 'A/B', '@B']) expect(stockTicker(bad), String(bad)).toBe(null)
  })

  it('with none named: the focused panel\'s own security, else the active group\'s, else none', () => {
    const base = normalizeLayout(countOf(DEFAULT_LAYOUT, 3))                 // CAL (A) · DES (A) · GP (A)
    expect(stockBoardTicker(base, { A: 'NVDA', B: 'AMD' })).toBe('NVDA')     // the calendar is focused: group A's ticker
    expect(stockBoardTicker(base, {})).toBe(null)
    // an unlinked chart that holds its own ticker is focused: that one, not the group's
    const own = normalizeLayout({ ...base, focus: 2, panels: base.panels.map((p, i) => (i === 2 ? { ...p, channel: null, sym: 'TSLA' } : p)) })
    expect(stockBoardTicker(own, { A: 'NVDA' })).toBe('TSLA')
    // a panel on another group is focused: that group's ticker
    const onB = normalizeLayout({ ...base, focus: 1, panels: base.panels.map((p, i) => (i === 1 ? { ...p, channel: 'B' } : p)) })
    expect(stockBoardTicker(onB, { A: 'NVDA', B: 'AMD' })).toBe('AMD')
    expect(stockBoardTicker(null, { A: 'NVDA' })).toBe(null)
  })
})

describe('opening one for a ticker: an ordinary board, every panel on that ticker, in ONE group of its own', () => {
  const MINE = normalizeLayout({ ...countOf(DEFAULT_LAYOUT, 2), density: 'compact' })
  const GROUPS = { A: 'AAPL', B: 'MSFT' }

  it.each(STOCK_BOARDS.map((b) => [b.name, b]))('%s for NVDA: its codes in order, one group, every panel showing NVDA', (_n, b) => {
    const built = buildStockBoard(MINE, b, 'nvda')
    expect(built.count).toBe(b.codes.length)
    expect(built.focus).toBe(0)
    expect(built.closed).toEqual([])
    expect(built.density).toBe('compact')                                    // the member's density is kept
    const visible = built.panels.slice(0, built.count)
    expect(visible.map((p) => p.code)).toEqual(b.codes)
    const groups = groupsOf(built)
    expect(groups).toHaveLength(1)
    const [g] = groups
    expect(g).toBeTruthy()
    expect(isCompatChannel(g), 'never one of the /charts groups').toBe(false)
    expect(built.activeChannel).toBe(g)
    expect(built.channels.find((c) => c.id === g)).toMatchObject({ name: STOCK_GROUP_NAME, sym: 'NVDA', history: ['NVDA'] })
    // What each panel SHOWS, read the way the shell reads it, whatever the /charts groups hold.
    const syms = channelSyms(built, GROUPS)
    for (const p of visible) expect(panelSym(p, syms), p.code).toBe('NVDA')
    for (const p of visible) expect(p.sym, 'the ticker lives in the group, not in each panel').toBe(null)
    expect(new Set(visible.map((p) => p.id)).size).toBe(visible.length)
    // It survives the stored form (what `terminal_layout` holds) byte for byte in meaning.
    const again = readLayout(serializeLayout(built))
    expect(again.status).toBe('ok')
    expect(again.layout).toEqual(built)
  })

  it('a new ticker in the group moves EVERY panel (what typing a ticker in any of them does)', () => {
    const built = buildStockBoard(MINE, defaultStockBoard(), 'NVDA')
    const [g] = groupsOf(built)
    const moved = applyChannelSym(built, g, 'AMD')
    const syms = channelSyms(moved, GROUPS)
    for (const p of moved.panels.slice(0, moved.count)) expect(panelSym(p, syms), p.code).toBe('AMD')
    expect(moved.channels.find((c) => c.id === g).history).toEqual(['AMD', 'NVDA'])
  })

  it('carries NO /charts group security, so opening it writes nothing to the /charts groups', () => {
    const built = buildStockBoard(MINE, defaultStockBoard(), 'NVDA')
    for (const id of COMPAT_CHANNELS) expect(built.channels.find((c) => c.id === id).sym, id).toBe(null)
    // `openBoard` is what the shell opens a snapshot with: `compatSyms` is what it would write.
    const opened = openBoard(built)
    expect(opened.compatSyms).toEqual({})
    expect(opened.layout).toEqual(built)
    // CONTROL: a snapshot that DOES carry group A's security would be written.
    expect(openBoard({ ...built, channels: built.channels.map((c) => (c.id === 'A' ? { ...c, sym: 'TSLA' } : c)) }).compatSyms).toEqual({ A: 'TSLA' })
  })

  it('the member\'s other groups are untouched: a group they added keeps its ticker and its history', () => {
    const added = addChannel(MINE)
    const mine = normalizeLayout(applyChannelSym(applyChannelSym(added.layout, added.id, 'TSLA'), added.id, 'SHOP'))
    const theirs = mine.channels.find((c) => c.id === added.id)
    expect(theirs).toMatchObject({ sym: 'SHOP', history: ['SHOP', 'TSLA'] })
    const built = buildStockBoard(mine, defaultStockBoard(), 'NVDA')
    const [g] = groupsOf(built)
    expect(g).not.toBe(added.id)
    expect(built.channels.find((c) => c.id === added.id)).toEqual(theirs)
    for (const id of COMPAT_CHANNELS) {
      expect(built.channels.find((c) => c.id === id)).toEqual(mine.channels.find((c) => c.id === id))
    }
    expect(built.channels).toHaveLength(mine.channels.length + 1)
  })

  it('never mutates the board it was built from', () => {
    const before = JSON.stringify(MINE)
    buildStockBoard(MINE, defaultStockBoard(), 'NVDA')
    expect(JSON.stringify(MINE)).toBe(before)
  })

  it('a second stock board reuses the SAME group: opening many adds one group, not many', () => {
    const first = buildStockBoard(MINE, STOCK_BOARDS[0], 'NVDA')
    const second = buildStockBoard(first, STOCK_BOARDS[1], 'AMD')
    const third = buildStockBoard(second, STOCK_BOARDS[0], 'TSLA')
    expect(groupsOf(second)).toEqual(groupsOf(first))
    expect(groupsOf(third)).toEqual(groupsOf(first))
    expect(third.channels).toHaveLength(first.channels.length)
    expect(first.channels).toHaveLength(MINE.channels.length + 1)
    const [g] = groupsOf(third)
    expect(third.channels.find((c) => c.id === g)).toMatchObject({ sym: 'TSLA', history: ['TSLA', 'AMD', 'NVDA'] })
    expect(second.panels.slice(0, second.count).map((p) => p.code)).toEqual(STOCK_BOARDS[1].codes)
  })

  it('a board with every group taken: an EMPTY added group is used; with none empty it is refused, in words', () => {
    const oneEmpty = fullBoard((i) => (i === 3 ? null : `T${String.fromCharCode(65 + i)}`))
    expect(oneEmpty.channels).toHaveLength(MAX_CHANNELS)
    const empty = oneEmpty.channels.find((c) => !isCompatChannel(c.id) && !c.sym)
    const built = buildStockBoard(oneEmpty, defaultStockBoard(), 'NVDA')
    expect(groupsOf(built)).toEqual([empty.id])
    expect(built.channels).toHaveLength(MAX_CHANNELS)
    for (const c of oneEmpty.channels) {
      if (c.id !== empty.id) expect(built.channels.find((x) => x.id === c.id), c.id).toEqual({ ...c, sym: isCompatChannel(c.id) ? null : c.sym })
    }
    // …and the group it took is the stock board's from then on (a second open still finds it).
    expect(groupsOf(buildStockBoard(built, STOCK_BOARDS[1], 'AMD'))).toEqual([empty.id])

    const allTaken = fullBoard((i) => `T${String.fromCharCode(65 + i)}`)
    expect(stockBoardGroup(allTaken)).toBe(null)
    expect(buildStockBoard(allTaken, defaultStockBoard(), 'NVDA')).toBe(null)
    expect(stockBoardRefusal(allTaken, defaultStockBoard(), 'NVDA')).toMatch(new RegExp(`already has ${MAX_CHANNELS} color groups.*Your board was not changed\\.`))
  })

  it('refuses, in words, a ticker that is not one and a board with a problem; a good one has no refusal', () => {
    expect(stockBoardRefusal(MINE, defaultStockBoard(), 'NVDA')).toBe(null)
    expect(stockBoardRefusal(MINE, defaultStockBoard(), 'not a ticker')).toMatch(/"not a ticker" is not one.*NVDA STOCK.*Your board was not changed\./)
    expect(stockBoardRefusal(MINE, defaultStockBoard(), null)).toMatch(/opens for one ticker\. Type the ticker first/)
    expect(buildStockBoard(MINE, defaultStockBoard(), '')).toBe(null)
    const broken = fixture({ name: 'Broken', codes: ['GP', 'HILO'] })
    expect(stockBoardRefusal(MINE, broken, 'NVDA')).toBe('Broken could not be opened on this release; your board was not changed.')
    expect(buildStockBoard(MINE, broken, 'NVDA')).toBe(null)
    expect(buildStockBoard(MINE, null, 'NVDA')).toBe(null)
  })

  it('saving one keeps the group and its ticker in the saved copy', () => {
    const built = buildStockBoard(MINE, defaultStockBoard(), 'NVDA')
    const [g] = groupsOf(built)
    const res = saveBoard(emptyLibrary(), 'Stock at a glance', built, channelSyms(built, GROUPS), 1000)
    expect(res.ok).toBe(true)
    const saved = res.board.layout
    expect(saved.channels.find((c) => c.id === g)).toMatchObject({ name: STOCK_GROUP_NAME, sym: 'NVDA' })
    expect(saved.panels.slice(0, saved.count).map((p) => [p.code, p.channel])).toEqual(defaultStockBoard().codes.map((c) => [c, g]))
  })

  it('what the shell says names the board, the ticker and the codes, and that nothing saved was changed', () => {
    const b = defaultStockBoard()
    const text = stockBoardNotice(b, '$nvda')
    expect(text).toContain(`Opened the stock board ${b.name} for NVDA (${b.codes.join(', ')}).`)
    expect(text).toContain('a new ticker in any of them moves the whole board')
    expect(text).toContain('Your saved boards were not changed.')
  })
})

describe('the typed command: NVDA STOCK reads through the one parser', () => {
  const [glance, second] = STOCK_BOARDS
  const ok = (sym, board) => ({ ok: true, type: 'stock-board', sym, board })

  it.each([
    ['NVDA STOCK', ok('NVDA', null)],
    ['nvda stock', ok('NVDA', null)],
    ['STOCK NVDA', ok('NVDA', null)],
    ['$NVDA STOCK', ok('NVDA', null)],
    ['BRK.B STOCK', ok('BRK.B', null)],
    ['STOCK', ok(null, null)],
    [`NVDA STOCK ${second.word}`, ok('NVDA', second.id)],
    [`nvda stock ${second.word.toLowerCase()}`, ok('NVDA', second.id)],
    [`STOCK NVDA ${second.word}`, ok('NVDA', second.id)],
    [`STOCK ${second.word}`, ok(null, second.id)],
    [`NVDA STOCK ${glance.word}`, ok('NVDA', glance.id)],
    [`STOCK $${glance.word}`, ok(glance.word, null)],              // `$` forces a ticker reading
    ['CF STOCK', ok('CF', null)],                                   // a code in FIRST place is the ticker, as for `CF DES`
  ])('%s', (text, want) => {
    expect(parseCommand(text)).toEqual(want)
  })

  it('a word that is not a board, and a function code where the ticker goes, are refused with the way to type it', () => {
    const bad = parseCommand('NVDA STOCK SIDEWAYS')
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('"SIDEWAYS" is not a stock board.')
    for (const b of STOCK_BOARDS) expect(bad.error).toContain(stockBoardCommand(b))
    expect(parseCommand('STOCK NVDA SIDEWAYS').error).toContain('"SIDEWAYS" is not a stock board.')
    expect(parseCommand('STOCK GP').error).toMatch(/GP is a function code; put \$ in front for the ticker \(STOCK \$GP\)/)
    expect(parseCommand('STOCK $GP')).toEqual(ok('GP', null))
    expect(parseCommand('STOCK 12.5').error).toMatch(/is not a ticker or a stock board/)
    expect(parseCommand('12 STOCK').error).toMatch(/"12" is not a ticker/)
  })

  it('it is a reserved word: no alias may take it, and it never aims at a panel or rides in a link', () => {
    expect(RESERVED_WORDS).toContain(STOCK_BOARD_WORD)
    expect(aliasNameRefusal(STOCK_BOARD_WORD)).toMatch(/reserved word/)
    expect(parseCommand('ALIAS STOCK = SMH GP').ok).toBe(false)
    expect(parseCommand('ALIAS MINE = NVDA STOCK').ok).toBe(false)
    // an alias a member saved under the word before it was reserved cannot hijack it
    expect(parseCommand('NVDA STOCK', { aliases: { STOCK: 'SMH GP', NVDA: 'AMD GP' } })).toEqual(ok('NVDA', null))
    expect(parseCommand('@B NVDA STOCK')).toMatchObject({ ok: false, error: expect.stringContaining('does not open one') })
    // No `?cmd=` text and no palette row: a link must never replace the member's board.
    expect(formatCommand(parseCommand('NVDA STOCK'))).toBe('')
    expect(terminalCommandRow('NVDA STOCK')).toBe(null)
    expect(telemetryKey(parseCommand('NVDA STOCK'))).toBe(STOCK_BOARD_WORD)
    expect(telemetryKey(parseCommand('NVDA STOCK'))).not.toContain('NVDA')       // never a ticker
  })

  it('everything that is NOT this command parses exactly as before', () => {
    expect(parseCommand('NVDA GP')).toMatchObject({ ok: true, type: 'function', code: 'GP', sym: 'NVDA' })
    expect(parseCommand('NVDA')).toMatchObject({ ok: true, type: 'function', code: 'DES', sym: 'NVDA' })
    expect(parseCommand('BOARD GP')).toMatchObject({ ok: true, type: 'board', code: 'GP' })
    expect(parseCommand('$STOCK')).toMatchObject({ ok: true, type: 'function', code: 'DES', sym: 'STOCK' })
    expect(parseCommand('$STOCK GP')).toMatchObject({ ok: true, type: 'function', code: 'GP', sym: 'STOCK' })
    // a sentence that starts with the word still goes to the question rule, as any sentence does
    expect(parseCommand('stock market crash today why')).toMatchObject({ ok: true, type: 'ask', fallback: true })
    expect(parseCommand('stock nvda?')).toMatchObject({ ok: true, type: 'ask' })
    expect(parseCommand('NVDA GP STOCK').type).toBe('function')
  })

  it('the echo says which board and which ticker before Enter, and HELP\'s rule names every board from the list', () => {
    const e = describeCommand(parseCommand('NVDA STOCK'))
    expect(e).toMatchObject({ tone: 'ok', shape: STOCK_BOARD_SHAPE })
    expect(e.text).toBe(`Open the stock board ${glance.name} (${glance.codes.join(', ')}) for NVDA, in one color group`)
    expect(describeCommand(parseCommand(`AMD STOCK ${second.word}`)).text).toContain(`${second.name} (${second.codes.join(', ')}) for AMD`)
    expect(describeCommand(parseCommand('STOCK')).text).toContain('for the ticker your board is on')
    expect(describeCommand(parseCommand('NVDA STOCK SIDEWAYS'))).toMatchObject({ tone: 'error' })
    expect(STOCK_BOARD_SHAPE).toBe(`[TICKER] STOCK [${STOCK_BOARDS.slice(1).map((b) => b.word).join(' | ')}]`)
    for (const b of STOCK_BOARDS) {
      expect(STOCK_BOARD_RULE).toContain(`${stockBoardCommand(b)} is ${b.name} (${b.codes.join(', ')})`)
    }
    expect(STOCK_BOARD_RULE).toContain('the charts page is not changed')
  })

  it('CONTROL: the codes named here are real (the tests above would pass on an empty registry otherwise)', () => {
    for (const c of ['GP', 'EXMV', 'FLOW', 'LVL', 'HILO', 'TECH', 'WHO', 'ERN', 'RES']) expect(BY_CODE[c], c).toBeTruthy()
  })
})
