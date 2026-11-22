// IPO LOCKUP (2026-11-22): the argument kind that opens IPO's lockup view, and the code's registry.
//
// args.js keeps its own small copy of the vocabulary the panel model owns (so the panel's code stays out of the
// shell's first-open bytes). This rail pins the copy to its owner, and checks the words collide with nothing.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, IPO_VIEW_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, codesForWords, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import { IPO_VIEWS, IPO_VIEW_ARG_WORDS, ipoViewCommandArgs, normIpoView, parseIpoView } from './panels/ipoLockupModel'

describe('the view word matches the panel that owns it', () => {
  it('the copy equals the model, word for word, and the lockup token is taken', () => {
    expect(IPO_VIEW_WORDS).toEqual(IPO_VIEW_ARG_WORDS)
    expect(Object.keys(IPO_VIEW_ARG_WORDS).sort()).toEqual(['LOCKUP', 'LOCKUPS'])
    for (const [word, value] of Object.entries(IPO_VIEW_ARG_WORDS)) {
      expect(ARG_KINDS.ipoView.parse(word.toLowerCase()), word).toBe(value)
      expect(parseIpoView(word), word).toBe(value)
    }
    expect(ARG_KINDS.ipoView.parse(IPO_VIEWS.lockup.token)).toBe('lockup')
    for (const no of ['NVDA', 'toString', 'constructor', '', 'LOCK', 'YEAR', 'UNLOCK']) expect(ARG_KINDS.ipoView.parse(no), no).toBeNull()
    expect(ARG_KINDS.ipoView.describe('lockup')).toBe('IPO lockup expiries (estimated)')
    expect(ARG_KINDS.ipoView.takes).toBe('LOCKUP')
  })

  it('the registry applies the word to the prop the panel reads, and bare IPO stays the calendar', () => {
    const run = (tokens) => applyArgs(BY_CODE.IPO.market, tokens)
    expect(run([]).props).toEqual({})
    expect(run(['lockup']).props).toEqual({ view: 'lockup' })
    expect(run(['LOCKUPS']).props).toEqual({ view: 'lockup' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['LOCKUP', 'LOCKUP']).ignored).toEqual(['LOCKUP'])
    expect(ipoViewCommandArgs({ view: 'lockup' })).toEqual(['LOCKUP'])
    expect(ipoViewCommandArgs({ view: 'calendar' })).toEqual([])
    expect(writeBackCommand('IPO', ['LOCKUP'])).toBe('IPO LOCKUP')
    expect(writeBackCommand('IPO', [])).toBe('IPO')
    expect(normIpoView('lockup')).toBe('lockup')
    expect(normIpoView(undefined)).toBe('calendar')
  })
})

describe('the code', () => {
  it('IPO keeps its label, group and panel; the market variant takes the view word; there is no per-stock IPO', () => {
    expect(BY_CODE.IPO.market).toEqual({ panel: 'IpoCalendar', args: [{ kind: 'ipoView', prop: 'view' }] })
    expect(BY_CODE.IPO.ticker).toBeUndefined()
    expect([BY_CODE.IPO.label, BY_CODE.IPO.group]).toEqual(['IPO calendar (upcoming and priced deals)', 'Calendar'])
    expect(variantFor('IPO', false)).toMatchObject({ scope: 'market' })
    expect(BY_CODE.IPO.note).toContain('IPO LOCKUP')
    expect(BY_CODE.IPO.note).toContain('an estimate (180 days after listing)')
  })

  it('the words a member would type find it, and the IPO words stay IPO\'s', () => {
    for (const words of ['lockup', 'lockups', 'ipo lockup', 'ipo lockups']) {
      expect(BY_CODE.IPO.keywords, words).toContain(words)
      expect(codesForWords(words)[0], words).toBe('IPO')
    }
    for (const words of ['ipo', 'ipos', 'ipo calendar', 'new issues']) expect(codesForWords(words)[0], words).toBe('IPO')
  })

  it('the bare code and the view word after it both parse as the market function', () => {
    expect(parseCommand('IPO')).toMatchObject({ ok: true, type: 'function', code: 'IPO', sym: null, args: [] })
    expect(parseCommand('ipo lockup')).toMatchObject({ ok: true, type: 'function', code: 'IPO', sym: null, args: ['LOCKUP'] })
    expect(parseCommand('IPO LOCKUPS')).toMatchObject({ ok: true, type: 'function', code: 'IPO', sym: null, args: ['LOCKUPS'] })
  })

  it('no view word is a function code, a COT market word, a word in another title, or a word another kind takes', () => {
    for (const word of Object.keys(IPO_VIEW_ARG_WORDS)) {
      expect(isCode(word), word).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(COT_WORDS, word), word).toBe(false)
      for (const [kind, spec] of Object.entries(ARG_KINDS)) {
        if (kind === 'ipoView') continue
        const tickerKind = spec.parse('NVDA', { today: '2026-11-22' }) != null
        expect(spec.parse(word, { today: '2026-11-22' }) == null || tickerKind || /Name|Query|code/i.test(kind), `${kind} takes ${word}`).toBe(true)
      }
      for (const f of FUNCTIONS) expect(String(f.label).toLowerCase().split(/[^a-z]+/), `${f.code} ${word}`).not.toContain(word.toLowerCase())
    }
    expect(isCode('IPO')).toBe(true)                                // the control: isCode can say yes
  })

  it('the view words are not stocks the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    for (const word of Object.keys(IPO_VIEW_ARG_WORDS)) expect(universe.has(word), word).toBe(false)
  })
})
