// UCT Terminal — V8 rails: every panel the shell can render names a TERM-006 data class, and
// the as-of is stamped only by a fetch that RESOLVED.
import { describe, it, expect } from 'vitest'
import { PANEL_IMPORTERS } from './panels'
import { SURFACE_IMPORTERS, SURFACE_IMPORTERS_BY_ID } from './surfacePanels'
import {
  PANEL_DATA_CLASS, SURFACE_DATA_CLASS, boardFreshness, createFreshnessStore, freshnessMiddleware,
  panelAge, panelDataClass,
} from './panelFreshness'

describe('every panel names its data class (derived from the importers, never a typed list)', () => {
  it('each PANEL_IMPORTERS name has an entry, and nothing extra is declared', () => {
    const names = Object.keys(PANEL_IMPORTERS)
    expect(names.length).toBeGreaterThan(30)   // non-vacuity: the derivation found the panels
    expect(names.filter((n) => !Object.prototype.hasOwnProperty.call(PANEL_DATA_CLASS, n))).toEqual([])
    expect(Object.keys(PANEL_DATA_CLASS).filter((n) => !names.includes(n))).toEqual([])
  })

  it('each embedded page (panel-set surface) has an entry, reachable by its panel-set id', () => {
    const elements = Object.keys(SURFACE_IMPORTERS)
    expect(elements.filter((e) => !Object.prototype.hasOwnProperty.call(SURFACE_DATA_CLASS, e))).toEqual([])
    const ids = Object.keys(SURFACE_IMPORTERS_BY_ID)
    expect(ids.length).toBeGreaterThan(3)
    expect(ids.filter((id) => panelDataClass(id) === undefined)).toEqual([])
  })

  it('every class named is one the authority defines (its freshnessClass() throws on a misspelling)', () => {
    // Asked THROUGH the authority (panelAge -> explainMustShowAge -> freshnessClass), so this
    // file is not a second importer of it (freshnessAge.test.js §7 names the importers).
    for (const name of [...Object.keys(PANEL_DATA_CLASS), ...Object.keys(SURFACE_IMPORTERS_BY_ID)]) {
      expect(() => panelAge(name, null), name).not.toThrow()
    }
    expect(panelAge('Help', null)).toBeNull()
  })

  it('an unknown panel is judged as the TIGHTEST class, never silently fresh', () => {
    expect(panelDataClass('NoSuchPanel')).toBeUndefined()
    const now = new Date('2026-10-05T15:00:00Z')
    expect(panelAge('NoSuchPanel', new Date(now.getTime() - 120_000), { now }).mustShow).toBe(true)
  })
})

describe('the as-of is a RESOLVED fetch, stamped through the SWR middleware', () => {
  const runMiddleware = (store, fetcher) => {
    let seen = null
    const next = (key, f) => { seen = f; return { key } }
    freshnessMiddleware(store, 'p1')(next)('k', fetcher, {})
    return seen
  }

  it('a resolved fetch stamps the panel', async () => {
    const s = createFreshnessStore()
    const f = runMiddleware(s, async () => 'data')
    expect(s.get('p1')).toBeNull()
    await expect(f()).resolves.toBe('data')
    expect(typeof s.get('p1')).toBe('number')
  })

  it('a rejected fetch stamps NOTHING and the rejection still reaches SWR', async () => {
    const s = createFreshnessStore()
    const f = runMiddleware(s, async () => { throw new Error('402') })
    await expect(f()).rejects.toThrow('402')
    expect(s.get('p1')).toBeNull()
  })

  it('a hook with no fetcher (a cache read) passes through untouched', () => {
    const s = createFreshnessStore()
    expect(runMiddleware(s, null)).toBeNull()
  })

  it('subscribers of one panel hear only that panel', () => {
    const s = createFreshnessStore()
    const heard = []
    s.subscribe('a', () => heard.push('a'))
    s.subscribe('b', () => heard.push('b'))
    s.stamp('a')
    expect(heard).toEqual(['a'])
  })
})

describe('the board summary the L0 strip prints', () => {
  it('counts stale, unreported and judged; the shell\'s own panel is not judged', () => {
    const now = new Date('2026-10-05T15:00:00Z')
    const s = createFreshnessStore()
    s.stamp('chart', now.getTime() - 5 * 60_000)      // live, 5 min: past due
    s.stamp('fin', now.getTime() - 5 * 60_000)        // quarterly, 5 min: fine
    const r = boardFreshness([
      { id: 'chart', name: 'Chart' }, { id: 'fin', name: 'Financials' },
      { id: 'cal', name: 'Calendar' }, { id: 'help', name: 'Help' },
    ], s, { now })
    expect(r).toEqual({ stale: 1, unreported: 1, judged: 3 })
  })
})
