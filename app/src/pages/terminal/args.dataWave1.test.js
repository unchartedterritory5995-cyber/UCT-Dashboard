// Data wave 1 (2026-11-17): the four argument kinds of the new panels (LEAD, UPDG, HILO).
//
// args.js types each kind's accepted words as a plain map, so the panels' code stays out of the
// shell's first-open bytes. That is a second copy of a vocabulary the PANEL owns, so this rail pins
// every word in args.js to what the panel's own reader makes of it, and every token a panel writes
// back into its command to a word args.js accepts. Change one side alone and this fails.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, ANALYST_KIND_WORDS, HILO_GROUP_WORDS, HILO_SIDE_WORDS, LONG_RUN_WORDS, applyArgs } from './args'
import { BY_CODE } from './functions'
import { LONG_RUN_LENS_KEYS, parseLongRunLens } from './panels/longRunModel'
import { UPGRADE_KINDS, normKind } from './panels/UpgradesPanel'
import { HILO_GROUPS, HILO_SIDES, normGroup, normSide } from './panels/HighsLowsPanel'
import { SECTOR_PERIODS, normPeriod } from './panels/SectorsPanel'

describe('data wave 1 argument kinds match the panels that own the words', () => {
  it('NON-VACUITY: every map holds words', () => {
    for (const m of [LONG_RUN_WORDS, ANALYST_KIND_WORDS, HILO_SIDE_WORDS, HILO_GROUP_WORDS]) {
      expect(Object.keys(m).length).toBeGreaterThan(3)
    }
  })

  it('LEAD: each word parses to the lens the panel model gives, and every lens is reachable', () => {
    for (const [word, lens] of Object.entries(LONG_RUN_WORDS)) {
      expect(parseLongRunLens(word), word).toBe(lens)
      expect(ARG_KINDS.longRunLens.parse(word.toLowerCase()), word).toBe(lens)
    }
    expect([...new Set(Object.values(LONG_RUN_WORDS))].sort()).toEqual([...LONG_RUN_LENS_KEYS].sort())
    expect(ARG_KINDS.longRunLens.parse('NVDA')).toBeNull()
  })

  it('UPDG: each word parses to the kind the panel reads, and every chip token is accepted', () => {
    for (const [word, kind] of Object.entries(ANALYST_KIND_WORDS)) {
      expect(normKind(word), word).toBe(kind)
      expect(ARG_KINDS.analystKind.parse(word.toLowerCase()), word).toBe(kind)
    }
    for (const [kind, spec] of Object.entries(UPGRADE_KINDS)) {
      if (spec.token) expect(ARG_KINDS.analystKind.parse(spec.token), kind).toBe(kind)
    }
    expect(ARG_KINDS.analystKind.parse('NVDA')).toBeNull()
  })

  it('HILO: side and group words parse to what the panel reads, and every chip token is accepted', () => {
    for (const [word, side] of Object.entries(HILO_SIDE_WORDS)) expect(normSide(word), word).toBe(side)
    for (const [word, group] of Object.entries(HILO_GROUP_WORDS)) expect(normGroup(word), word).toBe(group)
    for (const [side, spec] of Object.entries(HILO_SIDES)) {
      if (spec.token) expect(ARG_KINDS.hiloSide.parse(spec.token), side).toBe(side)
    }
    for (const [group, spec] of Object.entries(HILO_GROUPS)) {
      if (spec.token) expect(ARG_KINDS.hiloGroup.parse(spec.token), group).toBe(group)
    }
    // UP and DOWN are UPDG's words; on HILO they would read as a side, so args.js leaves them out.
    expect(ARG_KINDS.hiloSide.parse('UP')).toBeNull()
  })

  it('SCTR: every period chip is a window the shared window kind accepts', () => {
    for (const key of Object.keys(SECTOR_PERIODS)) {
      const typed = key === 'Today' ? '1D' : key
      const window = ARG_KINDS.contribWindow.parse(typed)
      expect(window, key).not.toBeNull()
      expect(normPeriod(window), key).toBe(key)
    }
  })

  it('the registry applies each argument to the prop its panel reads', () => {
    const run = (code, scope, tokens) => applyArgs(BY_CODE[code][scope], tokens)
    expect(run('LEAD', 'market', ['60d']).props).toEqual({ lens: '60D' })
    expect(run('UPDG', 'market', ['down']).props).toEqual({ kind: 'downgrades' })
    expect(run('HILO', 'market', ['lows', 'sector']).props).toEqual({ side: 'lows', group: 'sector' })
    expect(run('SCTR', 'market', ['1M']).props).toEqual({ period: '1M' })
    expect(run('EMOV', 'market', ['2026-01-02']).props).toEqual({ date: '2026-01-02' })
    expect(run('LEAD', 'market', ['banana']).ignored).toEqual(['banana'])
  })
})
