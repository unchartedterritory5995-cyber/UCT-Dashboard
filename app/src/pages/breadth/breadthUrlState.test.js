/**
 * The URL contract, param by param — including EVERY invalid-input fallback,
 * because "absent or invalid falls back to today's behaviour exactly" is a
 * claim about the bad cases, not the good one.
 */
import { describe, it, expect } from 'vitest'
import {
  PARAM_VIEW, PARAM_DATE, PARAM_DAYS, PARAM_COMPARE,
  parseBreadthParams, serializeBreadthParams, parseDate, parseDays, parseView, parseCompare,
} from './breadthUrlState'
import { defaultQuad } from './compareQuad'
import { STYLES } from './views/viewMetricConfig'

const sp = (s) => new URLSearchParams(s)
const DAY_CHOICES = [90, 180, 365]

describe('the spec’s example link', () => {
  it('parses ?view=clock&date=2026-08-14&days=180&compare=… whole', () => {
    const got = parseBreadthParams(
      sp('view=clock&date=2026-08-14&days=180&compare=clock,divergence,events,analogues'),
      { dayChoices: DAY_CHOICES })
    expect(got).toEqual({
      view: 'clock', date: '2026-08-14', days: 180,
      compare: ['clock', 'divergence', 'events', 'analogues'],
    })
  })

  it('round-trips back to the same query', () => {
    const patch = serializeBreadthParams({
      view: 'clock', date: '2026-08-14', days: 180, layout: 'compare',
      compare: ['clock', 'divergence', 'events', 'analogues'],
    })
    expect(patch).toEqual({
      [PARAM_VIEW]: 'clock', [PARAM_DATE]: '2026-08-14', [PARAM_DAYS]: '180',
      [PARAM_COMPARE]: 'clock,divergence,events,analogues',
    })
  })
})

describe('absent params fall back to today’s behaviour exactly', () => {
  it('an empty query yields four nulls', () => {
    expect(parseBreadthParams(sp(''), { dayChoices: DAY_CHOICES }))
      .toEqual({ view: null, date: null, days: null, compare: null })
  })

  it('a missing params object does not throw', () => {
    expect(parseBreadthParams(null)).toEqual({ view: null, date: null, days: null, compare: null })
    expect(parseBreadthParams({})).toEqual({ view: null, date: null, days: null, compare: null })
  })
})

describe('?view= — a style key or nothing', () => {
  it('accepts every key the registry declares', () => {
    for (const s of STYLES) expect(parseView(s)).toBe(s)
  })
  it('refuses anything else, case included', () => {
    for (const bad of ['Clock', 'heatmap', '', '  ', null, undefined, '../etc']) {
      expect(parseView(bad), String(bad)).toBeNull()
    }
  })
})

describe('?date= — a real calendar day or nothing', () => {
  it('accepts a well-formed session date', () => {
    expect(parseDate('2026-08-14')).toBe('2026-08-14')
    expect(parseDate(' 2026-08-14 ')).toBe('2026-08-14')
  })

  it('refuses a date that MATCHES the shape but is not a day', () => {
    // ⛔ The regex alone lets 2026-02-31 through, and a date that does not
    // exist can never resolve — it would sit in the URL being seeked for.
    expect(parseDate('2026-02-31')).toBeNull()
    expect(parseDate('2026-13-01')).toBeNull()
    expect(parseDate('2026-00-10')).toBeNull()
    expect(parseDate('2025-02-29')).toBeNull()          // not a leap year
    expect(parseDate('2024-02-29')).toBe('2024-02-29')  // …but this one is
  })

  it('refuses the wrong shape entirely', () => {
    for (const bad of ['08/14/2026', '2026-8-14', 'yesterday', '', 42, null]) {
      expect(parseDate(bad), String(bad)).toBeNull()
    }
  })
})

describe('?days= — a window the page actually offers', () => {
  it('accepts one of the day pills', () => {
    for (const d of DAY_CHOICES) expect(parseDays(String(d), DAY_CHOICES)).toBe(d)
  })

  it('refuses a window no pill can undo', () => {
    // A `?days=7000` would ask the server for a window the UI cannot get back
    // out of — the pills would all read inactive and nothing would say why.
    for (const bad of ['7000', '0', '-90', '90.5', '', 'lots', null]) {
      expect(parseDays(bad, DAY_CHOICES), String(bad)).toBeNull()
    }
  })

  it('refuses everything when the caller offers no choices', () => {
    expect(parseDays('90')).toBeNull()
  })
})

describe('?compare= — an unknown style key is ignored, not fatal', () => {
  it('keeps the good names and tops the quad up', () => {
    const q = parseCompare('clock,bogus,events')
    expect(q).toHaveLength(4)
    expect(q.slice(0, 2)).toEqual(['clock', 'events'])
  })

  it('falls back to Single only when NOTHING was recognisable', () => {
    expect(parseCompare('bogus,nonsense')).toBeNull()
    expect(parseCompare('')).toBeNull()
    expect(parseCompare(null)).toBeNull()
  })

  it('collapses duplicates rather than mounting a style twice', () => {
    const q = parseCompare('clock,clock,clock,clock')
    expect(new Set(q).size).toBe(4)
  })

  it('a single valid name is a legal quad, topped up from the default', () => {
    const q = parseCompare('ribbon')
    expect(q[0]).toBe('ribbon')
    expect(q.slice(1)).toEqual(defaultQuad().filter(s => s !== 'ribbon').slice(0, 3))
  })
})

describe('what gets written back', () => {
  it('DELETES a param the state no longer has (null = delete)', () => {
    // A stale `?date=` left behind after LATEST would pin every reload to a
    // session the reader already walked away from.
    expect(serializeBreadthParams({ view: 'clock', date: null, days: null, layout: 'single' }))
      .toEqual({ [PARAM_VIEW]: 'clock', [PARAM_DATE]: null, [PARAM_DAYS]: null, [PARAM_COMPARE]: null })
  })

  it('writes `compare` ONLY in compare layout — its presence IS the layout', () => {
    const quad = ['clock', 'divergence', 'events', 'analogues']
    expect(serializeBreadthParams({ compare: quad, layout: 'single' })[PARAM_COMPARE]).toBeNull()
    expect(serializeBreadthParams({ compare: quad, layout: 'compare' })[PARAM_COMPARE])
      .toBe('clock,divergence,events,analogues')
  })

  it('never writes a value it would itself refuse to read', () => {
    const patch = serializeBreadthParams({
      view: 'bogus', date: '2026-02-31', days: 90.5, layout: 'compare', compare: ['nope'],
    })
    expect(patch).toEqual({
      [PARAM_VIEW]: null, [PARAM_DATE]: null, [PARAM_DAYS]: null, [PARAM_COMPARE]: null,
    })
  })

  it('survives being called with nothing', () => {
    expect(() => serializeBreadthParams()).not.toThrow()
  })
})
