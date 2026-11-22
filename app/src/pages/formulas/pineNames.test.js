// app/src/pages/formulas/pineNames.test.js
//
// The reference page's Pine section arranges the door's own generated answer.
// These rails hold it to that file and prove each can fail. Engine-free: the
// family lookup is passed in.

import { describe, it, expect } from 'vitest'
import COVERAGE from '../../components/chart/supportLoop/doorNameCoverage.json'
import { SCOPE_NOTE, STATUS_WORDS, buildPineNames, searchPineNames } from './pineNames'

const FAMILY = (guard) => (guard === 'pine:request'
  ? { id: 'request', label: 'Data from another symbol or timeframe', why: 'w' }
  : { id: 'unknown', label: 'Not supported yet' })
const flat = (b) => b.groups.flatMap((g) => g.items)
const find = (b, name) => flat(b).find((it) => it.name === name)

describe('buildPineNames over the door\'s real coverage file', () => {
  const built = buildPineNames(COVERAGE, FAMILY)

  it('lists every name in the file exactly once', () => {
    const names = flat(built).map((it) => it.name)
    expect(names.length).toBe(Object.keys(COVERAGE.names).length)
    expect(new Set(names).size).toBe(names.length)
    expect(built.total).toBe(names.length)
  })

  it('its counts are the file\'s counts, never a second tally', () => {
    const notRunning = (COVERAGE.counts['call-unmapped'] || 0) + (COVERAGE.counts['name-unknown'] || 0)
      + (COVERAGE.counts.unprobed || 0)
    expect(built.runs).toBe(built.total - notRunning)
    expect(built.runs).toBe(Object.values(COVERAGE.names).filter((r) => r.status === 'reachable').length)
    expect(built.runs).toBeGreaterThan(0)
    expect(built.runs).toBeLessThan(built.total)       // control: both kinds are present
  })

  it('a name that runs says so and shows the form the door accepted', () => {
    const rsi = find(built, 'ta.rsi')
    expect(rsi.status).toBe('reachable')
    expect(rsi.words).toBe('Runs')
    expect(rsi.example).toBe(COVERAGE.names['ta.rsi'].probe)
    expect(rsi.family).toBeNull()
  })

  it('a name that does not run carries the engine\'s plain-words family, not a guard id', () => {
    const sec = find(built, 'request.security')
    expect(sec.status).not.toBe('reachable')
    expect(sec.words).toBe('Not yet')
    expect(sec.example).toBeNull()
    expect(sec.family).toEqual({ id: 'request', label: 'Data from another symbol or timeframe', why: 'w' })
    expect(JSON.stringify(flat(built))).not.toMatch(/pine:[a-z-]+/)     // no guard id reaches a row
  })

  it('an unknown family is left out rather than shown as a generic sentence', () => {
    const one = flat(built).find((it) => it.status !== 'reachable' && COVERAGE.names[it.name].guard !== 'pine:request')
    expect(one.family).toBeNull()
  })

  it('with no family lookup the rows are still built', () => {
    const bare = buildPineNames(COVERAGE)
    expect(bare.total).toBe(built.total)
    expect(flat(bare).every((it) => it.family === null)).toBe(true)
  })

  it('groups lead with ta, math and request, end with the plain names, and every row is in its own group', () => {
    const ids = built.groups.map((g) => g.id)
    expect(ids.slice(0, 3)).toEqual(['ta', 'math', 'request'])
    expect(ids[ids.length - 1]).toBe('plain')
    for (const g of built.groups) {
      for (const it of g.items) expect(it.name.includes('.') ? it.name.split('.')[0] : 'plain').toBe(g.id)
      expect(g.runs).toBe(g.items.filter((it) => it.status === 'reachable').length)
    }
  })

  it('an entry with no status is "Not checked", never "Runs"', () => {
    const b = buildPineNames({ names: { 'x.y': {} } })
    expect(flat(b)[0].words).toBe(STATUS_WORDS.unprobed)
    expect(b.runs).toBe(0)
  })
})

describe('searchPineNames', () => {
  const built = buildPineNames(COVERAGE, FAMILY)

  it('an empty query returns everything', () => {
    expect(searchPineNames('', built).shown).toBe(built.total)
    expect(searchPineNames('   ', built).groups.length).toBe(built.groups.length)
  })

  it('finds a name by any part of it, whatever the case', () => {
    const r = searchPineNames('RSI', built)
    expect(flat(r).map((it) => it.name)).toContain('ta.rsi')
    expect(flat(r).every((it) => it.name.toLowerCase().includes('rsi'))).toBe(true)
    expect(r.shown).toBe(flat(r).length)
  })

  it('a namespace prefix narrows to that namespace', () => {
    const r = searchPineNames('request.', built)
    expect(r.groups.map((g) => g.id)).toEqual(['request'])
  })

  it('"runs" and "not yet" show one kind, and together they are the whole list', () => {
    const runs = searchPineNames('runs', built)
    const not = searchPineNames('not yet', built)
    expect(flat(runs).every((it) => it.status === 'reachable')).toBe(true)
    expect(flat(not).some((it) => it.status === 'reachable')).toBe(false)
    expect(runs.shown + not.shown).toBe(built.total)
  })

  it('nothing found is zero rows with the total still stated', () => {
    const r = searchPineNames('zzzz-no-such-name', built)
    expect(r.shown).toBe(0)
    expect(r.groups).toEqual([])
    expect(r.total).toBe(built.total)
  })
})

describe('the scope sentence', () => {
  it('says what the list covers and that a chart can answer differently', () => {
    expect(SCOPE_NOTE).toMatch(/formula or a screen/)
    expect(SCOPE_NOTE).toMatch(/chart/)
    expect(SCOPE_NOTE).not.toMatch(/\b(valid|supported|verified|converted)\b/i)
  })
})
