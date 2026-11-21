// INS CLUSTER (2026-11-21): the argument kind that opens INS's cluster view, and the code's registry.
//
// args.js keeps its own small copy of the vocabulary the panel model owns (so the panel's code stays
// out of the shell's first-open bytes). This rail pins the copy to its owner.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, INS_VIEW_WORDS, applyArgs } from './args'
import { BY_CODE, codesForWords, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import {
  INS_CODE, INS_VIEWS, INS_VIEW_ARG_WORDS, insiderViewCommandArgs, normInsView, parseInsView,
} from './panels/insiderClustersModel'

describe('the view word matches the panel that owns it', () => {
  it('the copy equals the model, word for word, and the cluster token is taken', () => {
    expect(INS_VIEW_WORDS).toEqual(INS_VIEW_ARG_WORDS)
    expect(Object.keys(INS_VIEW_ARG_WORDS).sort()).toEqual(['CLUSTER', 'CLUSTERS'])
    for (const [word, value] of Object.entries(INS_VIEW_ARG_WORDS)) {
      expect(ARG_KINDS.insView.parse(word.toLowerCase()), word).toBe(value)
      expect(parseInsView(word), word).toBe(value)
    }
    expect(ARG_KINDS.insView.parse(INS_VIEWS.cluster.token)).toBe('cluster')
    for (const no of ['NVDA', 'toString', 'constructor', '', 'CLUST', 'BUYS', 'ALL']) expect(ARG_KINDS.insView.parse(no), no).toBeNull()
    expect(ARG_KINDS.insView.describe('cluster')).toBe('insider cluster buys')
    expect(ARG_KINDS.insView.takes).toBe('CLUSTER')
  })

  it('the registry applies the word to the prop the panel reads, and bare INS stays the default view', () => {
    const run = (tokens) => applyArgs(BY_CODE.INS.market, tokens)
    expect(run([]).props).toEqual({})
    expect(run(['cluster']).props).toEqual({ view: 'cluster' })
    expect(run(['CLUSTERS']).props).toEqual({ view: 'cluster' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['CLUSTER', 'CLUSTER']).ignored).toEqual(['CLUSTER'])
    // what the panel writes back is read as the same view, and the default is the bare command
    expect(insiderViewCommandArgs({ view: 'cluster' })).toEqual(['CLUSTER'])
    expect(insiderViewCommandArgs({ view: 'buys' })).toEqual([])
    expect(insiderViewCommandArgs({ view: 'nonsense' })).toEqual([])
    expect(writeBackCommand('INS', ['CLUSTER'])).toBe('INS CLUSTER')
    expect(writeBackCommand('INS', [])).toBe('INS')
    expect(normInsView('cluster')).toBe('cluster')
    expect(normInsView(undefined)).toBe('buys')
  })
})

describe('the code', () => {
  it('INS keeps its label, group and panel; the market variant takes the view word; there is no per-stock INS', () => {
    expect(INS_CODE).toBe('INS')
    expect(BY_CODE.INS.market).toEqual({ panel: 'InsiderBuys', args: [{ kind: 'insView', prop: 'view' }] })
    expect(BY_CODE.INS.ticker).toBeUndefined()
    expect(BY_CODE.INS.group).toBe('Market')
    expect(BY_CODE.INS.label).toBe('Insider buying (market-wide, last 7 days)')
    expect(variantFor('INS', false)).toMatchObject({ scope: 'market' })
  })

  it('the words a member would type find it', () => {
    for (const words of ['cluster buys', 'insider clusters', 'insider cluster buys']) {
      expect(BY_CODE.INS.keywords, words).toContain(words)
      expect(codesForWords(words)[0], words).toBe('INS')
    }
    expect(codesForWords('insider')[0]).toBe('INS')
  })

  it('the bare code and the view word after it both parse as the market function', () => {
    expect(parseCommand('INS')).toMatchObject({ ok: true, type: 'function', code: 'INS', sym: null, args: [] })
    expect(parseCommand('ins cluster')).toMatchObject({ ok: true, type: 'function', code: 'INS', sym: null, args: ['CLUSTER'] })
    expect(parseCommand('INS CLUSTERS')).toMatchObject({ ok: true, type: 'function', code: 'INS', sym: null, args: ['CLUSTERS'] })
  })

  it('no view word is a function code, and no other kind takes it', () => {
    for (const word of Object.keys(INS_VIEW_ARG_WORDS)) expect(isCode(word), word).toBe(false)
    expect(isCode('INS')).toBe(true)                                // the control: isCode can say yes
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      if (kind === 'insView') continue
      expect(spec.parse('CLUSTER', { today: '2026-11-21' }) == null || kind === 'symbol' || /Name|Query|code/i.test(kind), `${kind} takes CLUSTER`).toBe(true)
    }
  })

  it('the view words are not stocks the site follows', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                         // the control: the list is the ticker list
    for (const word of Object.keys(INS_VIEW_ARG_WORDS)) expect(universe.has(word), word).toBe(false)
  })
})
