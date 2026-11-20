// Open interest change (2026-11-19): the argument kind of OIC, and the code's shape.
//
// args.js keeps its own small copy of the vocabulary the panel model owns (so the panel's code
// stays out of the shell's first-open bytes). This rail pins the copy to its owner.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ARG_KINDS, OI_SIDE_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { OI_CHANGE_CODE, OI_SIDES, OI_SIDE_ARG_WORDS, oiChangeCommandArgs, parseOiSide } from './panels/oiChangeModel'

describe('the open interest side matches the panel that owns the words', () => {
  it('the copy equals the model, word for word, and every chip token is taken', () => {
    expect(OI_SIDE_WORDS).toEqual(OI_SIDE_ARG_WORDS)
    for (const [word, value] of Object.entries(OI_SIDE_ARG_WORDS)) {
      expect(ARG_KINDS.oiSide.parse(word.toLowerCase()), word).toBe(value)
      expect(parseOiSide(word), word).toBe(value)
    }
    for (const [key, spec] of Object.entries(OI_SIDES)) if (spec.token) expect(ARG_KINDS.oiSide.parse(spec.token), key).toBe(key)
    for (const no of ['NVDA', 'toString', 'constructor', '', 'BOTH']) expect(ARG_KINDS.oiSide.parse(no), no).toBeNull()
    expect(ARG_KINDS.oiSide.describe('call')).toBe('calls only')
    expect(ARG_KINDS.oiSide.describe('put')).toBe('puts only')
  })

  it('the registry applies the word to the prop the panel reads, and says what it did not take', () => {
    const run = (tokens) => applyArgs(BY_CODE.OIC.ticker, tokens)
    expect(run(['c']).props).toEqual({ side: 'call' })
    expect(run(['PUTS']).props).toEqual({ side: 'put' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['C', 'P']).ignored).toEqual(['P'])             // one side: the second is said, not dropped
    // what the panel writes back is read as the same pick, and the default is the bare command
    for (const key of Object.keys(OI_SIDES)) {
      const tokens = oiChangeCommandArgs({ side: key })
      expect(run(tokens).props).toEqual(key === 'any' ? {} : { side: key })
      expect(writeBackCommand('OIC', tokens, 'nvda')).toBe(['NVDA', 'OIC', ...tokens].join(' '))
    }
    expect(writeBackCommand('OIC', ['P'])).toBeNull()         // a per-stock code: no command without its stock
  })
})

describe('the code', () => {
  it('OIC is one stock, in the Options group, and the model names it', () => {
    expect(OI_CHANGE_CODE).toBe('OIC')
    expect(BY_CODE.OIC.ticker).toEqual({ panel: 'OiChange', args: [{ kind: 'oiSide', prop: 'side' }] })
    expect(BY_CODE.OIC.market).toBeUndefined()
    expect(BY_CODE.OIC.group).toBe('Options')
    expect(BY_CODE.OIC.example).toBe('NVDA OIC')
    expect(variantFor('OIC', true)).toMatchObject({ scope: 'ticker' })
    expect(variantFor('OIC', false)).toEqual({ variant: null, reason: 'needs-ticker' })
  })

  it('both orders name the stock, and a side after the code is the side', () => {
    expect(parseCommand('NVDA OIC')).toMatchObject({ ok: true, type: 'function', code: 'OIC', sym: 'NVDA', args: [] })
    expect(parseCommand('OIC NVDA')).toMatchObject({ ok: true, type: 'function', code: 'OIC', sym: 'NVDA' })
    expect(parseCommand('nvda oic p')).toMatchObject({ ok: true, code: 'OIC', sym: 'NVDA', args: ['P'] })
    expect(parseCommand('NVDA OIC CALLS')).toMatchObject({ ok: true, code: 'OIC', sym: 'NVDA', args: ['CALLS'] })
    expect(parseCommand('OIC')).toMatchObject({ ok: true, type: 'function', code: 'OIC', sym: null })
  })

  it('C is a real ticker too: after the bare code it is the side, and $C or C first is the stock', () => {
    // the same rule as `GP W`: a word the code declares as an argument is that argument
    expect(parseCommand('OIC C')).toMatchObject({ ok: true, code: 'OIC', sym: null, args: ['C'], argNotTicker: 'C' })
    expect(parseCommand('C OIC')).toMatchObject({ ok: true, code: 'OIC', sym: 'C', args: [] })
    expect(parseCommand('OIC $C')).toMatchObject({ ok: true, code: 'OIC', sym: 'C' })
    expect(parseCommand('C OIC C')).toMatchObject({ ok: true, code: 'OIC', sym: 'C', args: ['C'] })
  })

  it('no side word is a function code, and the code is not a word another code takes', () => {
    // a code in second place makes the first token a ticker, so a side word that was a code would
    // turn `OIC CALL` into "the CALL function on a ticker called OIC"
    for (const word of Object.keys(OI_SIDE_ARG_WORDS)) expect(isCode(word), word).toBe(false)
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('OIC', { today: '2026-11-19' }) == null || kind === 'symbol' || /Name|Query|code/i.test(kind), `${kind} takes OIC`).toBe(true)
    }
  })

  it('the code is not a stock the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                    // the control: the list is the ticker list
    expect(universe.has('OIC')).toBe(false)
    expect(FUNCTIONS.filter((f) => f.code === 'OIC')).toHaveLength(1)
    expect('OIC').toMatch(/^[A-Z]{2,5}$/)
  })
})
