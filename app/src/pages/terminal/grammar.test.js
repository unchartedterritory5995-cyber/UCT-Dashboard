// Lane T3 — the PUBLISHED grammar rules (grammar.js), the suggestion ranking (ranking.js) and
// the palette as a second front end of the ONE parser (paletteGrammar.js).
//
// Each rail fails for its own reason:
//   * the collision list names only registered codes, and each one is ALSO a ticker shape;
//   * the address table is pinned to the Python module that serves the addresses;
//   * the echo before Enter says what Enter will do — and a colliding bare code says so;
//   * ranking classes are never crossed by a habit (frecency only breaks ties);
//   * the palette offers a terminal row only when the shell's parser says it is a command,
//     and a bare ticker keeps the palette's own "Go to" row (no terminal row at all).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  TICKER_COLLISIONS, isTickerCollision, ADDRESS_PREFIXES, RANKING_ORDER, aliasNameRefusal,
  looksLikeQuestion, compareMode, argShape, describeCommand,
} from './grammar'
import { BY_CODE } from './functions'
import parseCommand, { ADDRESS_RE } from './parseCommand'
import { rankCandidates, frecency, CLASS } from './ranking'
import { terminalCommandRow } from './paletteGrammar'
import { SHORTCUTS } from '../command/shortcutRegistry'
import { HELP_SHORTCUT_IDS, chordLabel } from './panels/HelpPanel'

const REPO = path.resolve(process.cwd(), '..')

describe('V5: codes that are also tickers', () => {
  it('every collision is a registered code', () => {
    for (const c of TICKER_COLLISIONS) expect(BY_CODE[c], c).toBeTruthy()
    expect(TICKER_COLLISIONS.length).toBeGreaterThan(5)
  })
  it('a bare colliding code runs the function but the echo says it is also a ticker', () => {
    const cmd = parseCommand('CF')
    expect(cmd).toMatchObject({ ok: true, code: 'CF', collision: 'CF' })
    const echo = describeCommand(cmd)
    expect(echo.tone).toBe('warn')
    expect(echo.text).toContain('$CF')
  })
  it('$CF is the ticker; CF DES is the ticker with a function — neither warns', () => {
    expect(parseCommand('$CF')).toMatchObject({ ok: true, sym: 'CF' })
    expect(describeCommand(parseCommand('$CF')).tone).toBe('ok')
    expect(describeCommand(parseCommand('CF DES')).tone).toBe('ok')
  })
  it('isTickerCollision is case-blind and false for a non-colliding code', () => {
    expect(isTickerCollision('dash')).toBe(true)
    expect(isTickerCollision('HELP')).toBe(false)
  })
  it('2026-10-05 audit: a real-ticker code now warns; a removed false-collision code no longer does', () => {
    // CAL (Caleres) is a real tracked ticker that was missing from the list — it now warns.
    expect(isTickerCollision('CAL')).toBe(true)
    const cmd = parseCommand('CAL')
    expect(cmd).toMatchObject({ ok: true, code: 'CAL', collision: 'CAL' })
    // GP was never a real ticker (verified against api/data/cap_universe.json) — removed, so
    // a bare GP no longer carries a false "also a ticker" warning.
    expect(isTickerCollision('GP')).toBe(false)
    const gp = parseCommand('GP')
    expect(gp).toMatchObject({ ok: true, code: 'GP' })
    expect(gp.collision).toBeUndefined()
  })
})

describe('HELP: the address table is the server\'s own', () => {
  it('ADDRESS_PREFIXES match address_space.py KINDS, letter for letter and label for label', () => {
    const py = fs.readFileSync(path.join(REPO, 'api/services/address_space.py'), 'utf8')
    const kinds = [...py.matchAll(/Kind\("([A-Z])",\s*"([^"]+)"/g)].map((m) => ({ prefix: m[1], label: m[2] }))
    expect(kinds.length).toBeGreaterThan(4)
    expect([...ADDRESS_PREFIXES]).toEqual(kinds)
  })
  it('ADDRESS_RE accepts exactly the published letters', () => {
    for (const { prefix } of ADDRESS_PREFIXES) expect(ADDRESS_RE.test(`${prefix}:12`), prefix).toBe(true)
    expect(ADDRESS_RE.test('Q:12')).toBe(false)
  })
  it('the keys HELP lists are declared in the shortcut registry and render a chord', () => {
    for (const id of HELP_SHORTCUT_IDS) {
      const d = SHORTCUTS.find((s) => s.id === id)
      expect(d, id).toBeTruthy()
      expect(chordLabel(d)).toMatch(/\S/)
    }
    expect(chordLabel(SHORTCUTS.find((s) => s.id === 'terminal.focus'))).toBe('`')
    expect(chordLabel(SHORTCUTS.find((s) => s.id === 'terminal.panel2'))).toBe('Alt+2')
  })
})

describe('V6b / V16 / V18 rules', () => {
  it('alias names: a code, a reserved word or a bad shape is refused; a free name is allowed', () => {
    expect(aliasNameRefusal('GP')).toContain('already a function')
    expect(aliasNameRefusal('UNALIAS')).toContain('reserved word')
    expect(aliasNameRefusal('x')).toContain('not a valid alias name')
    expect(aliasNameRefusal('SEMIS')).toBeNull()
  })
  it('a question reads as a question; a short command-shaped line does not', () => {
    expect(looksLikeQuestion('is breadth improving')).toBe(true)
    expect(looksLikeQuestion('nvda?')).toBe(true)
    expect(looksLikeQuestion('NVDA GP')).toBe(false)
    expect(looksLikeQuestion('')).toBe(false)
  })
  it('comparison modes: sector, index vs index, security vs security', () => {
    expect(compareMode('NVDA', 'SECTOR')).toBe('sector')
    expect(compareMode('SPY', 'QQQ')).toBe('index')
    expect(compareMode('NVDA', 'AMD')).toBe('security')
  })
  it('argument shape is derived from the registry for every code, never blank', () => {
    for (const code of Object.keys(BY_CODE)) expect(argShape(code), code).toMatch(/\S/)
    expect(argShape('GP')).toBe('TICKER GP')
    expect(argShape('CMP')).toContain('SECTOR')
    expect(argShape('NOPE')).toBeNull()
  })
  it('the echo of a failure is the failure itself (the notice and the echo agree)', () => {
    const bad = parseCommand('NVDA GPX')
    expect(describeCommand(bad)).toEqual({ text: bad.error, tone: 'error', shape: null })
    expect(describeCommand(parseCommand(''))).toBeNull()
  })
  it('MOVE and WIIM are ticker functions with one shape', () => {
    expect(argShape('MOVE')).toBe('TICKER MOVE')
    expect(parseCommand('NVDA WIIM')).toMatchObject({ ok: true, code: 'WIIM', sym: 'NVDA' })
  })
  it('2026-10-05 audit: every door variant that fully navigates away carries leavesTerminal, ' +
     'and the interpreted-parse echo shows the cue for it', () => {
    // MYST ( /calendar/mystocks ) was one of the ~17 doors missing the flag.
    expect(BY_CODE.MYST.market).toMatchObject({ door: '/calendar/mystocks', leavesTerminal: true })
    const echo = describeCommand(parseCommand('MYST'))
    expect(echo.text).toContain('(leaves Terminal)')
    // A sampled GROUP of the other newly-flagged doors — each is a `door` with no panel/surface
    // alternative, so it is unconditionally "leaves Terminal" once a security is or isn't present.
    for (const code of ['GEX', 'LIVE', 'DASH', 'CHRT', 'PMKT', 'SETL', 'FORM', 'DESK', 'JRNL', 'NB', 'COMM', 'EXP']) {
      const variant = BY_CODE[code].market
      expect(variant?.door, code).toBeTruthy()
      expect(variant.leavesTerminal, code).toBe(true)
    }
    // A panel/surface code must NEVER carry the cue — it stays embedded in the Terminal.
    expect(BY_CODE.GP.ticker.door).toBeUndefined()
    expect(describeCommand(parseCommand('NVDA GP')).text).not.toContain('leaves Terminal')
  })
})

describe('V6c: the published ranking', () => {
  it('RANKING_ORDER is the order the ranker applies', () => {
    expect(RANKING_ORDER.map((r) => r.key)).toEqual(['alias', 'verb', 'symbol', 'prefix', 'fuzzy', 'frecency', 'popular'])
    expect(CLASS).toEqual({ alias: 0, verb: 1, symbol: 2, prefix: 3, fuzzy: 4 })
  })
  it('an exact alias beats an exact code beats an exact ticker beats a prefix', () => {
    const out = rankCandidates('GP', {
      aliases: { GP2: 'NVDA GP', GP: 'x' },
      tickers: [{ value: 'GP', label: 'GreenPower' }, { value: 'GPS', label: 'Gap' }],
    })
    expect(out.slice(0, 4).map((r) => `${r.kind}:${r.value}:${r.rank}`)).toEqual([
      'alias:GP:alias', 'function:GP:verb', 'ticker:GP:symbol', 'alias:GP2:prefix'])
  })
  it('a habit breaks a tie inside a class but never lifts a row across a class', () => {
    const now = 1_000_000
    const stats = { GPX: { n: 0, last: now }, GEX: { n: 50, last: now } }
    // Two prefix matches for "G": GEX (used 50 times) outranks GP-prefix peers alphabetically ahead.
    const pre = rankCandidates('G', { stats, nowSec: now }).filter((r) => r.rank === 'prefix')
    expect(pre[0].value).toBe('GEX')
    // …but a heavily-used prefix row never beats the exact code.
    const ex = rankCandidates('GP', { stats: { GPS: { n: 999, last: now } }, tickers: [{ value: 'GPS' }], nowSec: now })
    expect(ex[0]).toMatchObject({ value: 'GP', rank: 'verb' })
  })
  it('frecency decays with a 14-day half-life and is zero for no history', () => {
    const now = 100 * 86400
    expect(frecency({ n: 8, last: now }, now)).toBeCloseTo(8)
    expect(frecency({ n: 8, last: now - 14 * 86400 }, now)).toBeCloseTo(4)
    expect(frecency(undefined, now)).toBe(0)
  })
})

describe('V4: the palette is a second front end of the SAME parser', () => {
  it('an explicit command LEADS and routes to /terminal?cmd=', () => {
    const r = terminalCommandRow('nvda gp')
    expect(r.placement).toBe('lead')
    expect(r.row).toMatchObject({ kind: 'terminal', command: 'NVDA GP', to: '/terminal?cmd=NVDA%20GP' })
  })
  it('ASK leads; a natural-language fallback trails (a note title can read like a question)', () => {
    expect(terminalCommandRow('ASK why is SMH down').placement).toBe('lead')
    expect(terminalCommandRow('why is smh down today').placement).toBe('tail')
  })
  it('a bare code trails, so a bare Enter opens what it always opened', () => {
    expect(terminalCommandRow('CAL').placement).toBe('tail')
  })
  it('a bare ticker gets NO terminal row (the palette keeps its own "Go to NVDA")', () => {
    expect(terminalCommandRow('NVDA')).toBeNull()
  })
  it('what the shell refuses, the palette does not offer; aliases never come from the palette', () => {
    expect(terminalCommandRow('NVDA GPX')).toBeNull()
    expect(terminalCommandRow('ALIAS SEMIS = SMH GP')).toBeNull()
    expect(terminalCommandRow('3')).toBeNull()
    expect(terminalCommandRow('')).toBeNull()
  })
})
