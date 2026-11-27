// The extended-session rule, client side (the live follow-up to #2781): the store's ingest drops an intraday bar outside
// its ET day's extended session, so a held 20:00 bar (live, or read into IndexedDB before the server refused them)
// cannot survive: a delta answer never deletes one. The case list is SHARED with the server's rule
// (tests/fixtures/session_clamp_cases.json, also read by tests/test_bars_live_session_clamp.py).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionClampApplies, inExtendedSession, clampToExtendedSession } from './extendedSession'
import { reduce, initialState } from './reducer'
import { keyOf } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CASES = JSON.parse(readFileSync(path.resolve(HERE, '../../../../tests/fixtures/session_clamp_cases.json'), 'utf8'))
const at = (iso) => etUnix(iso.slice(0, 10), Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)))

describe('extendedSession: one rule with the server', () => {
  it('the shared case list: which names the session governs', () => {
    for (const s of CASES.clamped) expect(sessionClampApplies(s), s).toBe(true)
    for (const s of CASES.exempt) expect(sessionClampApplies(s), s).toBe(false)
  })
  it('the shared case list: which instants lie inside it (half day, weekend, Thanksgiving, both DST weeks)', () => {
    for (const t of CASES.inside) expect(inExtendedSession(at(t)), t).toBe(true)
    for (const t of CASES.outside) expect(inExtendedSession(at(t)), t).toBe(false)
  })
  it('clampToExtendedSession returns the same array when nothing goes, and leaves an exempt name alone', () => {
    const rows = [{ t: at('2026-11-11T19:55') }, { t: at('2026-11-11T20:00') }]
    expect(clampToExtendedSession(rows.slice(0, 1), 'SPY')).toHaveLength(1)
    const one = rows.slice(0, 1)
    expect(clampToExtendedSession(one, 'SPY')).toBe(one)
    expect(clampToExtendedSession(rows, 'SPY').map((r) => r.t)).toEqual([at('2026-11-11T19:55')])
    expect(clampToExtendedSession(rows, 'BTC-USD')).toBe(rows)
  })
})

describe('the store never ingests a bar outside the session', () => {
  const NOW = at('2026-11-11T20:30') * 1000
  const ctx = { nowMs: NOW, streamLive: true }
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })
  const bar = (t) => ({ t, o: 100, h: 101, l: 99, c: 100.5, v: 10 })

  it('a 60m eth answer (or a held copy) carrying a 20:00 row: the row never enters the store', () => {
    const K = keyOf({ sym: 'SPY', tf: '60', session: 'eth' })
    const rows = [bar(at('2026-11-11T18:00')), bar(at('2026-11-11T19:00')), bar(at('2026-11-11T20:00'))]
    const s = reduce(initialState(K, ctx), { type: 'rest-full', payload: { bars: rows } }, ctx)
    const held = [...s.bars.map((b) => b.t), s.developing?.t].filter(Boolean)
    expect(held).not.toContain(at('2026-11-11T20:00'))
    expect(held).toContain(at('2026-11-11T19:00'))
  })
  it('a 5m answer: 20:00, 20:05 and a Saturday row go; 19:55 stays; a crypto name keeps its night', () => {
    const rows = [bar(at('2026-11-11T19:55')), bar(at('2026-11-11T20:00')), bar(at('2026-11-11T20:05'))]
    const s = reduce(initialState(keyOf({ sym: 'SPY', tf: '5' }), ctx), { type: 'rest-full', payload: { bars: rows } }, ctx)
    const held = [...s.bars.map((b) => b.t), s.developing?.t].filter(Boolean)
    expect(held).toEqual([at('2026-11-11T19:55')])
    const c = reduce(initialState(keyOf({ sym: 'BTC-USD', tf: '5' }), ctx), { type: 'rest-full', payload: { bars: rows } }, ctx)
    const kept = [...c.bars.map((b) => b.t), c.developing?.t].filter(Boolean)
    expect(kept).toHaveLength(3)
  })
})
