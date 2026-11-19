// Share a panel: the rule. Which panels may offer it, and as what.
//
// ⛔ EVERY REGISTERED PANEL HAS A DECISION, AND NONE GETS SHARING BY OMISSION. The registry
// (functions.js) is walked, never retyped: every variant of every function is asked. A function
// nobody has classed yet is `unreviewed`, which is never shared, so a panel registered tomorrow
// ships with sharing OFF until its data has been read. This rail prints the codes still waiting.
//
//   * a door has no panel; a whole page keeps its own export;
//   * only class A in the licensing register shares today (your own records, UCT's own words,
//     filings read from the SEC); the trading team's archive never does;
//   * the table names only registered codes, each once.
import { describe, it, expect } from 'vitest'
import { BY_CODE, FUNCTIONS } from '../functions'
import { SHARE_CLASS_BY_CODE, SHARE_CLASS_DUPLICATES, SHARE_POLICY, shareClassOf, shareDecision } from './shareRule'

const variants = FUNCTIONS.flatMap((fn) => ['ticker', 'market'].filter((side) => fn[side]).map((side) => ({ fn, side, variant: fn[side] })))
const panels = variants.filter((v) => v.variant.panel)
const panelCodes = [...new Set(panels.map((v) => v.fn.code))]

describe('every registered panel is classified', () => {
  it('every variant of every function gets a whole decision', () => {
    expect(variants.length).toBeGreaterThan(100)
    for (const { fn, side, variant } of variants) {
      const d = shareDecision(fn, variant)
      expect(typeof d.offered, `${fn.code} ${side}`).toBe('boolean')
      expect(d.offered, `${fn.code} ${side}`).toBe(d.image || d.file)
      expect(d.why.length, `${fn.code} ${side} has no reason`).toBeGreaterThan(5)
      expect(['none', 'page', ...Object.keys(SHARE_POLICY)], `${fn.code} ${side}`).toContain(d.cls)
    }
  })

  it('a panel is only offered when its code was classed BY NAME into a class the policy allows', () => {
    const offered = panels.filter((v) => shareDecision(v.fn, v.variant).offered)
    for (const { fn } of offered) {
      expect(Object.keys(SHARE_CLASS_BY_CODE), `${fn.code} is offered without a class`).toContain(fn.code)
      expect(SHARE_POLICY[SHARE_CLASS_BY_CODE[fn.code]].image || SHARE_POLICY[SHARE_CLASS_BY_CODE[fn.code]].file).toBe(true)
    }
    expect(offered.length).toBeGreaterThan(0)
  })

  it('\u26D4 a panel nobody has classed is unreviewed, and unreviewed is never shared', () => {
    const fresh = { code: 'ZZNEW', label: 'A panel registered tomorrow', group: 'Market', market: { panel: 'Fresh' }, ticker: { panel: 'Fresh' } }
    expect(shareClassOf('ZZNEW')).toBe('unreviewed')
    for (const variant of [fresh.market, fresh.ticker]) {
      expect(shareDecision(fresh, variant)).toMatchObject({ offered: false, image: false, file: false, cls: 'unreviewed' })
    }
    expect(SHARE_POLICY.unreviewed).toMatchObject({ image: false, file: false })
    // An object's own keys are not codes: `constructor` and `toString` are not classed.
    for (const odd of ['constructor', 'toString', '__proto__', 'hasOwnProperty', '', null, undefined]) expect(shareClassOf(odd)).toBe('unreviewed')
  })

  it('prints what is offered, what is not, and which panels still wait for a class', () => {
    const waiting = panelCodes.filter((code) => shareClassOf(code) === 'unreviewed')
    const byClass = {}
    for (const code of panelCodes) (byClass[shareClassOf(code)] = byClass[shareClassOf(code)] || []).push(code)
    const lines = Object.entries(byClass).map(([cls, codes]) => `  ${cls.padEnd(10)} ${SHARE_POLICY[cls].image ? 'image' : '-----'} ${SHARE_POLICY[cls].file ? 'file' : '----'}  ${codes.length}: ${codes.join(' ')}`)
    // eslint-disable-next-line no-console
    console.info(`[share rule] ${panelCodes.length} function codes open a panel.\n${lines.join('\n')}\n  waiting for a class (${waiting.length}): ${waiting.join(' ') || 'none'}`)
    // Every panel on this registry was classed when the rule was written. A code added since
    // lands in `waiting`, with sharing off, and this line says so without failing anybody's build.
    expect(Array.isArray(waiting)).toBe(true)
  })
})

describe('the derived half: read off the registry, never typed', () => {
  it('a door has no panel to share', () => {
    const doors = variants.filter((v) => v.variant.door)
    expect(doors.length).toBeGreaterThan(10)
    for (const { fn, variant } of doors) expect(shareDecision(fn, variant), fn.code).toMatchObject({ offered: false, cls: 'none' })
    expect(shareDecision(null, null)).toMatchObject({ offered: false, cls: 'none' })
    expect(shareDecision(BY_CODE.PERF, null)).toMatchObject({ offered: false, cls: 'none' })
  })

  it('a whole page keeps its own export: the frame offers none, whatever class its code might have', () => {
    const pages = variants.filter((v) => v.variant.surface)
    expect(pages.map((v) => v.fn.code)).toEqual(expect.arrayContaining(['SCR', 'BRD', 'FREC']))
    for (const { fn, variant } of pages) expect(shareDecision(fn, variant), fn.code).toMatchObject({ offered: false, cls: 'page' })
    expect(shareDecision({ code: 'PERF' }, { surface: '/somewhere' })).toMatchObject({ offered: false, cls: 'page' })
  })

  it('one code, two variants: a panel variant is decided by its class, a door variant has none', () => {
    expect(shareDecision(BY_CODE.MB, BY_CODE.MB.ticker).cls).toBe('vendor')
    expect(shareDecision(BY_CODE.MB, BY_CODE.MB.market).cls).toBe('none')
  })
})

describe('the policy today', () => {
  it('your own records, UCT\'s own words and SEC filings share as a picture and as a file', () => {
    for (const code of ['PERF', 'HELP', 'FEED', 'FTD']) {
      const fn = BY_CODE[code]
      expect(shareDecision(fn, fn.market || fn.ticker), code).toMatchObject({ offered: true, image: true, file: true })
    }
    expect(shareClassOf('PERF')).toBe('own')
    // MYH is the member's own record on one stock: the same class as PERF, on its ticker variant.
    expect(shareClassOf('MYH')).toBe('own')
    expect(shareDecision(BY_CODE.MYH, BY_CODE.MYH.ticker)).toMatchObject({ offered: true, image: true, file: true, cls: 'own' })
    expect(shareClassOf('help')).toBe('uct')
    expect(shareClassOf('FEED')).toBe('public')
    // RATES is the US Treasury's own published yields (register row T-95, class A): public, so shared.
    expect(shareClassOf('RATES')).toBe('public')
    expect(shareDecision(BY_CODE.RATES, BY_CODE.RATES.market)).toMatchObject({ offered: true, image: true, file: true, cls: 'public' })
  })

  it('licensed and third-party data, and analytics worked out from it, are not offered', () => {
    for (const code of ['MOST', 'MON', 'TOPF', 'FLWL', 'UPDG', 'TSRC', 'TWT', 'SENT', 'INS', 'CONG', 'ALRT', 'RSL', 'THMS', 'PCHG', 'H52', 'UNVOL', 'ERNS', 'CEOS', 'SHINT', 'SHRTS']) {
      const fn = BY_CODE[code]
      expect(shareDecision(fn, fn.market || fn.ticker), code).toMatchObject({ offered: false, image: false, file: false })
    }
    expect(shareClassOf('RSL')).toBe('derived')
    // GRP joins PCHG's changes with RS ranks and the confluence board: worked out from licensed data.
    expect(shareClassOf('GRP')).toBe('derived')
    expect(shareDecision(BY_CODE.GRP, BY_CODE.GRP.market)).toMatchObject({ offered: false, image: false, file: false, cls: 'derived' })
    // UNVOL is a ratio UCT works out from licensed volume and prices: derived, so not offered.
    expect(shareClassOf('UNVOL')).toBe('derived')
    expect(shareClassOf('MOST')).toBe('vendor')
  })

  it('\u26D4 the trading team\'s archive is never shared, and its class can never be switched on by accident', () => {
    for (const code of ['WHO', 'HIS', 'CHK']) {
      expect(shareClassOf(code), code).toBe('team')
      const fn = BY_CODE[code]
      expect(shareDecision(fn, fn.ticker), code).toMatchObject({ offered: false, image: false, file: false })
    }
    expect(SHARE_POLICY.team).toMatchObject({ image: false, file: false })
  })

  it('the policy table is frozen: a class is widened by editing its line, never at run time', () => {
    expect(Object.isFrozen(SHARE_POLICY)).toBe(true)
    for (const row of Object.values(SHARE_POLICY)) expect(Object.isFrozen(row)).toBe(true)
    expect(Object.isFrozen(SHARE_CLASS_BY_CODE)).toBe(true)
  })
})

describe('the table is sound', () => {
  it('names only registered codes (never an alias), each under one class the policy knows', () => {
    const registered = new Set(FUNCTIONS.map((f) => f.code))
    for (const [code, cls] of Object.entries(SHARE_CLASS_BY_CODE)) {
      expect(registered.has(code), `${code} is classed but is not a registered function code`).toBe(true)
      expect(Object.keys(SHARE_POLICY), `${code} has the unknown class ${cls}`).toContain(cls)
      expect(cls).not.toBe('unreviewed')
    }
    expect(SHARE_CLASS_DUPLICATES).toEqual([])
  })

  it('classes only codes that open a panel (a door-only or page-only code needs no class)', () => {
    const stray = Object.keys(SHARE_CLASS_BY_CODE).filter((code) => !panelCodes.includes(code))
    expect(stray).toEqual([])
  })

  it('every panel on the registry at the time of writing has a class', () => {
    // Pinned as a count, not a list: the list is derived above. If a classed code is removed
    // from the registry the rail above fails by name; a NEW code never fails this line.
    const classed = panelCodes.filter((code) => shareClassOf(code) !== 'unreviewed')
    expect(classed.length).toBeGreaterThanOrEqual(87)
    expect(classed.length).toBe(Object.keys(SHARE_CLASS_BY_CODE).length)
  })
})
