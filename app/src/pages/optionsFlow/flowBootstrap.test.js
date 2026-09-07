import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  DEFERRED_KEYS,
  DEFERRED_KEYS_BY_SURFACE,
  splitAggregate,
  mergeDeferred,
  needsDeferred,
  partsFrom,
  PART_NAMES,
  isPartName,
} from './flowBootstrap'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = resolve(HERE, '../OptionsFlow.jsx')

// A stand-in for one processFlowData result: the shape matters, not the values.
function makeD() {
  return {
    clean_confirmed: [{ S: 'NVDA', P: 1 }],
    all_directional: [{ S: 'NVDA', D: 'BULL' }],
    all_trades: [{ S: 'NVDA' }, { S: 'AMD' }],
    WATCH: [{ S: 'TSLA' }],
    ALL_SYMS: ['NVDA', 'AMD'],
    UOA_TRADES: [{ S: 'X' }],
    darkPool: [{ S: 'Y' }],
    TICKER_DB: [{ s: 'NVDA' }],
    CONV: [{ sym: 'NVDA' }],
    SECTORS: [{ name: 'Information Technology' }],
    THEMES: [{ name: 'AI' }],
    dateRange: '9/4',
    totalTrades: 2,
    totalPremium: 100,
    confirmedCount: 1,
    PERF_INIT: [],
    sectorTickerMode: false,
    shortBullTotal: 5,
  }
}

describe('the split is LOSSLESS — nothing is summarised or dropped', () => {
  // This is the whole safety argument. Deferring is only acceptable because the
  // member eventually receives byte-identical data, just later.
  it('bootstrap + deferred reconstitutes the original exactly', () => {
    const D = makeD()
    const { bootstrap, deferred } = splitAggregate(D)
    expect(mergeDeferred(bootstrap, deferred)).toEqual(D)
  })

  it('every key of the original lands in exactly one half', () => {
    const D = makeD()
    const { bootstrap, deferred } = splitAggregate(D)
    const b = Object.keys(bootstrap)
    const d = Object.keys(deferred)
    expect([...b, ...d].sort()).toEqual(Object.keys(D).sort())
    expect(b.filter((k) => d.includes(k))).toEqual([])
  })

  it('values are passed through by reference, never copied or reshaped', () => {
    const D = makeD()
    const { bootstrap, deferred } = splitAggregate(D)
    expect(deferred.all_trades).toBe(D.all_trades)
    expect(bootstrap.clean_confirmed).toBe(D.clean_confirmed)
  })

  it('a key absent from D is invented in NEITHER half', () => {
    // A consumer must be able to tell "no rows" from "not loaded yet"; an
    // invented [] erases that difference and reads as a real empty result.
    const { bootstrap, deferred } = splitAggregate({ clean_confirmed: [] })
    expect('WATCH' in bootstrap).toBe(false)
    expect('WATCH' in deferred).toBe(false)
  })

  it('survives a null / non-object input without throwing', () => {
    expect(() => splitAggregate(null)).not.toThrow()
    expect(splitAggregate(null).bootstrap).toBe(null)
  })
})

describe('what may be deferred', () => {
  it('defers the six audited keys and nothing else', () => {
    const { bootstrap, deferred } = splitAggregate(makeD())
    expect(Object.keys(deferred).sort()).toEqual([...DEFERRED_KEYS].sort())
    for (const k of DEFERRED_KEYS) expect(k in bootstrap).toBe(false)
  })

  it('⛔ NEVER defers clean_confirmed — FD re-filters it by cap on every load', () => {
    // OptionsFlow.jsx:1516 re-runs buildCharts(clean_confirmed) whenever the cap
    // filter or tab changes. Deferring it would break the cap filter outright,
    // not merely delay it.
    expect(DEFERRED_KEYS).not.toContain('clean_confirmed')
    expect(DEFERRED_KEYS).not.toContain('TICKER_DB')
    expect(DEFERRED_KEYS).not.toContain('CONV')
  })

  it('needsDeferred spots a bootstrap payload a surface cannot render from', () => {
    const { bootstrap } = splitAggregate(makeD())
    expect(needsDeferred(bootstrap, 'marketRead')).toBe(true)
    expect(needsDeferred(bootstrap, 'tracker')).toBe(true)
    expect(needsDeferred(makeD(), 'marketRead')).toBe(false)
    expect(needsDeferred(bootstrap, 'notASurface')).toBe(false)
    expect(needsDeferred(null, 'marketRead')).toBe(false)
  })
})

// ── The rail that keeps this module honest about the actual page ────────────
// Everything above tests the mechanism. This tests the CLAIM: that the keys
// listed as deferred really are the ones the first screen does not read. It
// re-derives that from OptionsFlow.jsx rather than trusting the comment block,
// so adding a first-paint read of a deferred key fails HERE instead of shipping
// a screen that renders without it.
describe('the deferral claim is re-derived from OptionsFlow.jsx', () => {
  const src = readFileSync(PAGE, 'utf8')
  const lines = src.split('\n')

  function defaultTab() {
    const m = src.match(/const\s*\[\s*tab\s*,\s*setTab\s*\]\s*=\s*useState\(\s*"([^"]+)"/)
    return m && m[1]
  }

  // Line numbers (1-based) where each tab's render is guarded.
  function tabGuardLines() {
    const out = []
    lines.forEach((l, i) => {
      const m = l.match(/tab\s*===\s*"([A-Za-z ]+)"/)
      if (m) out.push({ line: i + 1, tab: m[1] })
    })
    return out
  }

  // The span from the default tab's first guard to the next DIFFERENT tab guard.
  function firstPaintRange() {
    const guards = tabGuardLines()
    const dt = defaultTab()
    const start = guards.find((g) => g.tab === dt)
    const end = guards.find((g) => g.line > start.line && g.tab !== dt)
    return [start.line, end ? end.line - 1 : lines.length]
  }

  function keysReadIn([from, to]) {
    const body = lines.slice(from - 1, to).join('\n')
    const found = new Set()
    for (const m of body.matchAll(/\b(?:D|FD)\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(m[1])
    return found
  }

  it('CONTROL: the extractor finds the default tab and a real, non-empty range', () => {
    // Without this, every assertion below could pass by finding nothing at all.
    expect(defaultTab()).toBe('Market Read')
    const [a, b] = firstPaintRange()
    expect(b - a).toBeGreaterThan(200)
    const keys = keysReadIn([a, b])
    expect(keys.size).toBeGreaterThan(3)
    expect(keys).toContain('clean_confirmed') // known first-paint reader
  })

  it('every deferred key read on the FIRST-PAINT tab is declared for that surface', () => {
    const keys = keysReadIn(firstPaintRange())
    const deferredButRead = [...keys].filter((k) => DEFERRED_KEYS.includes(k))
    const declared = DEFERRED_KEYS_BY_SURFACE.marketRead
    for (const k of deferredButRead) {
      expect(
        declared,
        `OptionsFlow.jsx reads D.${k} on the first-paint tab, but ` +
          `DEFERRED_KEYS_BY_SURFACE.marketRead does not list it — the page would ` +
          `render that surface from a payload that has not arrived.`,
      ).toContain(k)
    }
  })

  it('keys declared for marketRead are all genuinely read there', () => {
    // The reverse direction: a stale declaration makes the page fetch a payload
    // it no longer needs, quietly undoing the win.
    const keys = keysReadIn(firstPaintRange())
    for (const k of DEFERRED_KEYS_BY_SURFACE.marketRead) {
      expect(keys, `marketRead declares ${k} but no first-paint code reads it`).toContain(k)
    }
  })

  it('the never-referenced keys really are referenced nowhere in the page', () => {
    // UOA_TRADES and darkPool are computed on every build and read by nothing.
    for (const k of ['UOA_TRADES', 'darkPool']) {
      const hits = [...src.matchAll(new RegExp(`\\b(?:D|FD)\\??\\.${k}\\b`, 'g'))]
      expect(hits.length, `${k} is now read somewhere; re-run the audit`).toBe(0)
    }
  })
})

describe('parts — one per deferred key, never one deferred blob', () => {
  it('produces bootstrap plus a part for each deferred key present', () => {
    const parts = partsFrom(makeD())
    expect(Object.keys(parts).sort()).toEqual(['bootstrap', ...DEFERRED_KEYS].sort())
  })

  it('recombining every part reproduces the original exactly', () => {
    const D = makeD()
    const parts = partsFrom(D)
    const { bootstrap, ...rest } = parts
    expect({ ...bootstrap, ...rest }).toEqual(D)
  })

  it('⛔ a surface can take ONE part without dragging the rest', () => {
    // The Tracker reads WATCH and nothing else deferred. If asking for WATCH
    // returned anything of all_trades, we would have rebuilt the same problem
    // one click later.
    const parts = partsFrom(makeD())
    const trackerNeeds = DEFERRED_KEYS_BY_SURFACE.tracker
    expect(trackerNeeds).toEqual(['WATCH'])
    for (const k of trackerNeeds) expect(parts[k]).toBeDefined()
    expect(trackerNeeds).not.toContain('all_trades')
    expect(trackerNeeds).not.toContain('all_directional')
  })

  it('omits a part whose key D never had', () => {
    const parts = partsFrom({ clean_confirmed: [], WATCH: [1] })
    expect('all_trades' in parts).toBe(false)
    expect(parts.WATCH).toEqual([1])
  })

  it('isPartName accepts every produced name and rejects others', () => {
    for (const n of PART_NAMES) expect(isPartName(n)).toBe(true)
    expect(isPartName('clean_confirmed')).toBe(false)  // bootstrap-only key
    expect(isPartName('__proto__')).toBe(false)
    expect(isPartName('')).toBe(false)
  })
})
