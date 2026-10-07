// Scan-to-board (feature-gaps-2026-10-06 #9) — the pure half: what a list becomes, what is said
// about the names not on screen, and which functions can fill a board. The shell half is
// TerminalShell.scanBoard.test.jsx.
import { describe, it, expect } from 'vitest'
import {
  BOARD_PAGE, QUICK_BOARD_CODES, boardCodeRefusal, boardableCodes, buildScanBoard, cleanSymbols,
  pageBounds, scanBoardName, scanBoardNotice, symbolsFromRows,
} from './scanBoard'
import { DEFAULT_LAYOUT, MAX_VISIBLE, addChannel, panelChannel, panelSym, readLayout, serializeLayout } from './boardModel'
import { BY_CODE } from './functions'
import parseCommand from './parseCommand'
import { BOARD_RULE, RESERVED_WORDS, aliasNameRefusal, describeCommand } from './grammar'

const OPEN = { optionsChainEnabled: true, researchTechnicalTabEnabled: true }

describe('the page size is the board model\'s, never restated', () => {
  it('one name per visible panel', () => {
    expect(BOARD_PAGE).toBe(MAX_VISIBLE)
  })
})

describe('cleanSymbols — never loses a name in silence', () => {
  it('upper-cases, drops $, keeps order, and reports repeats and non-tickers', () => {
    const r = cleanSymbols(['nvda', '$AMD', 'NVDA', 'BRK.B', 'BRK-B', 'not a ticker', '', null, 'MSFT'])
    expect(r.syms).toEqual(['NVDA', 'AMD', 'BRK.B', 'MSFT'])
    expect(r.repeats).toEqual(['NVDA', 'BRK-B'])
    expect(r.invalid).toEqual(['not a ticker'])
  })
  it('a non-array is an empty list, not a throw', () => {
    expect(cleanSymbols(undefined)).toEqual({ syms: [], repeats: [], invalid: [] })
  })
})

describe('symbolsFromRows — the securities a panel\'s numbered list names', () => {
  it('MOST rows ($SYM), RRG rows (SYM GP) and MOVE rows (one ticker, many functions)', () => {
    expect(symbolsFromRows(['$AMD', '$TSLA'])).toEqual(['AMD', 'TSLA'])
    expect(symbolsFromRows(['XLK GP', 'SMH GP'])).toEqual(['XLK', 'SMH'])
    expect(symbolsFromRows(['NVDA CN', 'NVDA CATS'])).toEqual(['NVDA', 'NVDA'])
  })
  it('HELP\'s list (bare codes) names no security', () => {
    expect(symbolsFromRows(['GP', 'DES', 'CAL'])).toEqual([])
    expect(symbolsFromRows(null)).toEqual([])
  })
})

describe('pageBounds', () => {
  it('pages of BOARD_PAGE, clamped at both ends', () => {
    expect(pageBounds(10, 0)).toEqual({ page: 0, pages: 3, start: 0, end: 4 })
    expect(pageBounds(10, 2)).toEqual({ page: 2, pages: 3, start: 8, end: 10 })
    expect(pageBounds(10, 9).page).toBe(2)
    expect(pageBounds(10, -1).page).toBe(0)
    expect(pageBounds(3, 0)).toEqual({ page: 0, pages: 1, start: 0, end: 3 })
  })
})

describe('buildScanBoard — an ordinary boardModel layout', () => {
  it('one unlinked panel per name, as many visible as names, focus first, no undo stack', () => {
    const cur = { ...DEFAULT_LAYOUT, closed: [{ panel: { ...DEFAULT_LAYOUT.panels[0] }, index: 0 }], density: 'dense' }
    const b = buildScanBoard(cur, 'GP', ['NVDA', 'AMD'])
    expect(b.count).toBe(2)
    expect(b.focus).toBe(0)
    expect(b.closed).toEqual([])
    expect(b.density).toBe('dense')
    expect(b.panels.slice(0, 2).map((p) => [p.code, p.sym, panelChannel(p)])).toEqual([['GP', 'NVDA', null], ['GP', 'AMD', null]])
    // Each panel shows its OWN security whatever the groups hold.
    expect(b.panels.slice(0, 2).map((p) => panelSym(p, { A: 'TSLA' }))).toEqual(['NVDA', 'AMD'])
    // It round-trips through the stored shape (it is saved like any board).
    expect(readLayout(serializeLayout(b)).status).toBe('ok')
  })
  it('never more than MAX_VISIBLE panels, whatever it is handed', () => {
    const b = buildScanBoard(DEFAULT_LAYOUT, 'DES', ['A', 'B', 'C', 'D', 'E', 'F'])
    expect(b.count).toBe(MAX_VISIBLE)
    expect(b.panels.slice(0, MAX_VISIBLE).map((p) => p.sym)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('keeps the member\'s groups, but carries no A-D security (opening it never moves /charts\' groups)', () => {
    const { layout: withE } = addChannel(DEFAULT_LAYOUT)
    const cur = { ...withE, channels: withE.channels.map((c) => (c.id === 'E' ? { ...c, sym: 'QQQ' } : c)) }
    const b = buildScanBoard(cur, 'GP', ['NVDA'])
    expect(b.channels.map((c) => c.id)).toEqual(cur.channels.map((c) => c.id))
    expect(b.channels.filter((c) => ['A', 'B', 'C', 'D'].includes(c.id)).every((c) => c.sym == null)).toBe(true)
    expect(b.channels.find((c) => c.id === 'E').sym).toBe('QQQ')
  })
})

describe('boardCodeRefusal — which functions can fill a board', () => {
  it('a per-security panel can', () => {
    for (const c of ['GP', 'DES', 'CN', 'FA']) expect(boardCodeRefusal(c, OPEN)).toBeNull()
  })
  it('a market-wide code, a door, the calendar (URL-owning) and an unknown code cannot — each says why', () => {
    expect(boardCodeRefusal('MOST', OPEN)).toMatch(/market-wide/)
    expect(boardCodeRefusal('CMP', OPEN)).toMatch(/outside the terminal/)
    expect(boardCodeRefusal('ERN', OPEN)).toMatch(/only once/)
    expect(boardCodeRefusal('ZZZZ', OPEN)).toMatch(/not a function/)
  })
  it('a function the member is not switched on for is refused, not built empty', () => {
    expect(boardCodeRefusal('TECH', {})).toMatch(/not enabled/)
    expect(boardableCodes({}).map((c) => c.code)).not.toContain('TECH')
    expect(boardableCodes(OPEN).map((c) => c.code)).toContain('TECH')
  })
  it('every quick code is a real per-security code, labelled from the registry', () => {
    for (const c of QUICK_BOARD_CODES) expect(BY_CODE[c]?.ticker?.panel).toBeTruthy()
    expect(boardableCodes(OPEN)[0]).toEqual({ code: 'GP', label: BY_CODE.GP.label })
  })
})

describe('scanBoardNotice — every name not on screen is named', () => {
  const ten = ['NVDA', 'AMD', 'MSFT', 'TSLA', 'SMCI', 'PLTR', 'META', 'AVGO', 'ARM', 'MU']
  it('a list that fits says so plainly', () => {
    const n = scanBoardNotice({ code: 'GP', label: 'your list', syms: ['NVDA', 'AMD'] })
    expect(n.text).toBe('Opened your list as a board of GP: NVDA, AMD.')
    expect(n.pages).toBe(1)
  })
  it('a long list names the page, the limit, and every name left off it', () => {
    const n = scanBoardNotice({ code: 'GP', label: 'MOST gainers', syms: ten })
    expect(n.text).toMatch(/NVDA, AMD, MSFT, TSLA\./)
    expect(n.text).toMatch(/Names 1-4 of 10; a board shows 4 panels at a time\./)
    for (const s of ten.slice(4)) expect(n.text).toContain(s)
    expect(n.pages).toBe(3)
  })
  it('a later page names what came before and what is still to come', () => {
    const n = scanBoardNotice({ code: 'DES', label: 'x', syms: ten, page: 1 })
    expect(n.text).toMatch(/: SMCI, PLTR, META, AVGO\./)
    expect(n.text).toMatch(/Not on screen yet: ARM, MU\./)
    expect(n.text).toMatch(/Earlier pages: NVDA, AMD, MSFT, TSLA\./)
  })
  it('repeats and a partly loaded list are said', () => {
    const n = scanBoardNotice({ code: 'GP', label: 'screener results', syms: ['A', 'B'], repeats: ['A'], total: 312 })
    expect(n.text).toMatch(/1 repeated name counted once \(A\)/)
    expect(n.text).toMatch(/The list holds 312 in all; 2 were loaded/)
  })
  it('a board name fits the library\'s 60 characters', () => {
    expect(scanBoardName('GP', 'MOST gainers')).toBe('GP · MOST gainers')
    expect(scanBoardName('GP', 'x'.repeat(100)).length).toBe(60)
  })
})

describe('the grammar — BOARD FUNC [source]', () => {
  it('the focused panel\'s list, a typed list, a watchlist, the flagged list', () => {
    expect(parseCommand('BOARD GP')).toEqual({ ok: true, type: 'board', code: 'GP', source: { kind: 'panel' } })
    expect(parseCommand('board des nvda, amd $cf')).toEqual({ ok: true, type: 'board', code: 'DES',
      source: { kind: 'list', syms: ['NVDA', 'AMD', 'CF'] } })
    expect(parseCommand('BOARD GP W:12')).toEqual({ ok: true, type: 'board', code: 'GP',
      source: { kind: 'watchlist', id: '12', address: 'W:12' } })
    expect(parseCommand('BOARD CN FLAGGED').source).toEqual({ kind: 'flagged' })
  })
  it('every refusal says what to type instead', () => {
    expect(parseCommand('BOARD').error).toMatch(/BOARD needs a function: BOARD GP/)
    expect(parseCommand('BOARD NVDA AMD').error).toMatch(/BOARD GP NVDA AMD/)
    expect(parseCommand('BOARD CMP NVDA').error).toMatch(/outside the terminal/)
    expect(parseCommand('BOARD MOST').error).toMatch(/shows no single security/)
    expect(parseCommand('BOARD GP L:3').error).toMatch(/watchlist \(W:id\)/)
    expect(parseCommand('BOARD GP NVDA CN').error).toMatch(/CN is a function code; put \$ in front/)
    expect(parseCommand('BOARD GP NVDA 123').error).toMatch(/Not a ticker: "123"/)
  })
  it('$BOARD is still a ticker, and no alias may take the word', () => {
    expect(parseCommand('$BOARD').type).toBe('function')
    expect(RESERVED_WORDS).toContain('BOARD')
    expect(aliasNameRefusal('BOARD')).toMatch(/reserved/)
  })
  it('the echo says what Enter will do — and never claims a long list fits', () => {
    expect(describeCommand(parseCommand('BOARD GP')).text).toMatch(/focused panel's list as a board of GP \(Price chart\), 4 names at a time/)
    expect(describeCommand(parseCommand('BOARD GP A B C D E F')).text).toMatch(/the first 4 of 6 \(Next pages through the rest\)/)
    expect(describeCommand(parseCommand('BOARD GP W:3')).text).toMatch(/watchlist W:3/)
    expect(describeCommand(parseCommand('BOARD GP W:3')).shape).toMatch(/^BOARD FUNC/)
  })
  it('a pasted list now names the board command', () => {
    expect(parseCommand('NVDA AMD MSFT TSLA').error).toMatch(/BOARD GP NVDA AMD MSFT TSLA/)
  })
  it('HELP\'s rule names the forms and the limit', () => {
    expect(BOARD_RULE).toMatch(/BOARD GP/)
    expect(BOARD_RULE).toMatch(/4 panels at a time/)
  })
})
