// UCT Terminal — the function-list trim (owner decision 2026-10-08):
//   * BRKE is folded into EE and kept as an alias that opens EE;
//   * WIIM is folded into MOVE and kept as an alias that opens MOVE;
//   * EXP, PMKT and SETL leave the registry; the pages behind them stay.
// A saved board, share link, pop-out or favourite that still names one of these must not crash:
// an alias opens its code, and a removed code answers with a plain note saying where it went.
import { describe, it, expect } from 'vitest'
import { BY_CODE, CODE_ALIASES, FUNCTIONS, RETIRED, canonicalCode, isCode, retiredNote, suggest } from './functions'
import parseCommand from './parseCommand'
import { TICKER_COLLISIONS, describeCommand } from './grammar'
import {
  decodePopout, decodeShare, defaultLayout, encodeShare, normalizeLayout, popoutHref, readLibrary,
} from './boardModel'
import { PANEL_IMPORTERS } from './panels'

const codes = FUNCTIONS.map((f) => f.code)

describe('the registry after the trim', () => {
  it('BRKE and WIIM are aliases, not functions: one entry each in HELP and the rail', () => {
    expect(codes).not.toContain('BRKE')
    expect(codes).not.toContain('WIIM')
    expect(CODE_ALIASES).toMatchObject({ BRKE: 'EE', WIIM: 'MOVE' })
    expect(BY_CODE.BRKE).toBe(BY_CODE.EE)
    expect(BY_CODE.WIIM).toBe(BY_CODE.MOVE)
  })

  it('EXP, PMKT and SETL are gone from the registry and answered by a note instead', () => {
    for (const c of ['EXP', 'PMKT', 'SETL']) {
      expect(codes, c).not.toContain(c)
      expect(isCode(c), c).toBe(false)
      expect(retiredNote(c), c).toMatch(/removed from the terminal/)
    }
    expect(Object.keys(RETIRED).sort()).toEqual(['EXP', 'PMKT', 'SETL'])
    // A removed code is never suggested as if it were still there.
    expect(suggest('PMK')).not.toContain('PMKT')
    expect(suggest('SET')).not.toContain('SETL')
  })

  it('EXP is no longer a code/ticker collision: $EXP and EXP DES both load the ticker', () => {
    expect(TICKER_COLLISIONS).not.toContain('EXP')
    expect(parseCommand('$EXP')).toMatchObject({ ok: true, code: 'DES', sym: 'EXP' })
    expect(parseCommand('EXP DES')).toMatchObject({ ok: true, code: 'DES', sym: 'EXP' })
    expect(parseCommand('GP EXP')).toMatchObject({ ok: true, code: 'GP', sym: 'EXP' })
  })

  it('the broker-estimates panel is no longer a terminal panel of its own (EE carries it)', () => {
    expect(PANEL_IMPORTERS.BrokerEstimates).toBeUndefined()
    expect(BY_CODE.EE.ticker.panel).toBe('Estimates')
  })
})

describe('typed: an alias runs its code, a removed code says where it went', () => {
  it('NVDA BRKE opens EE and NVDA WIIM opens MOVE, under the code’s own name', () => {
    expect(parseCommand('NVDA BRKE')).toMatchObject({ ok: true, code: 'EE', sym: 'NVDA' })
    expect(parseCommand('NVDA WIIM')).toMatchObject({ ok: true, code: 'MOVE', sym: 'NVDA' })
    expect(parseCommand('BRKE NVDA')).toMatchObject({ ok: true, code: 'EE', sym: 'NVDA' })
    expect(canonicalCode('wiim')).toBe('MOVE')
  })

  it.each(['PMKT', 'SETL', 'EXP', 'NVDA PMKT', 'pmkt'])('%s answers with the removal note, not "unknown"', (line) => {
    const r = parseCommand(line)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/was removed from the terminal/)
    expect(r.error).not.toMatch(/Unknown/)
    // Not mistaken for a question and sent to AI Search.
    expect(r.type).not.toBe('ask')
    expect(describeCommand(r)).toEqual({ text: r.error, tone: 'error', shape: null })
  })
})

describe('saved boards, share links, pop-outs and favourites survive the trim', () => {
  const withCodes = (...cs) => {
    const l = defaultLayout()
    return { ...l, count: cs.length, panels: cs.map((code, i) => ({ id: `p${i + 1}`, code, channel: null, sym: 'NVDA', args: [] })) }
  }

  it('a stored board naming WIIM / BRKE opens MOVE / EE; a removed code is kept for its note', () => {
    const l = normalizeLayout(withCodes('WIIM', 'brke', 'PMKT'))
    expect(l.panels.slice(0, 3).map((p) => p.code)).toEqual(['MOVE', 'EE', 'PMKT'])
  })

  it('a share link made before the trim opens the merged codes', () => {
    const token = encodeShare('old', withCodes('WIIM', 'BRKE'), {})
    const shared = decodeShare(token)
    expect(shared.layout.panels.slice(0, 2).map((p) => p.code)).toEqual(['MOVE', 'EE'])
  })

  it('a pop-out link naming WIIM opens MOVE', () => {
    const href = popoutHref({ code: 'WIIM', args: [] }, 'NVDA')
    expect(decodePopout(href.split('popout=')[1])).toMatchObject({ code: 'MOVE', sym: 'NVDA' })
  })

  it('favourites map an alias to its code and drop a removed code', () => {
    const { library } = readLibrary(JSON.stringify({ v: 1, boards: [], presets: {}, favorites: ['WIIM', 'PMKT', 'GP', 'MOVE'] }))
    expect(library.favorites).toEqual(['MOVE', 'GP'])
  })
})
