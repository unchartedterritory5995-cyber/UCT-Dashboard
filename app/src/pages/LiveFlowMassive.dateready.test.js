// ⏸ /live-massive must not fetch everything twice on a closed day.
//
// MEASURED ON PROD 2026-08-29 (a Saturday), on a WARM pod: recent,
// worker-history, day-stats, by-contract and flow/dates were each fetched TWICE
// per page load. The page mounts with no ?date=, fires every data effect for
// LIVE — a day with no data at all — then /api/flow/dates resolves, the
// market-closed fallback sets ?date=<last session>, and every effect refires.
//
// The gate has to remove that WITHOUT taxing a normal session, and without ever
// being able to strand the page. Those three properties are what this pins.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { _etCouldHaveLiveSessionYet, _computeDateReady } from './LiveFlowMassive.jsx'

const et = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm)

describe('_etCouldHaveLiveSessionYet', () => {
  it('is false all weekend — the case that was double-fetching', () => {
    expect(_etCouldHaveLiveSessionYet(et(2026, 8, 29, 12, 0))).toBe(false) // Sat
    expect(_etCouldHaveLiveSessionYet(et(2026, 8, 30, 12, 0))).toBe(false) // Sun
  })

  it('is false pre-open on a weekday — the other double-fetch window', () => {
    // The owner is on this page around the 7:35 ET wire, well inside it.
    expect(_etCouldHaveLiveSessionYet(et(2026, 8, 28, 7, 35))).toBe(false)
    expect(_etCouldHaveLiveSessionYet(et(2026, 8, 28, 9, 29))).toBe(false)
  })

  it('is true from the opening bell onward, including after the close', () => {
    expect(_etCouldHaveLiveSessionYet(et(2026, 8, 28, 9, 30))).toBe(true)
    expect(_etCouldHaveLiveSessionYet(et(2026, 8, 28, 12, 0))).toBe(true)
    // ⭐ After 16:00 the session HAS data, so no fallback is coming and the page
    // must not wait. A naive "is the market open right now" check would be wrong
    // here — that is why this is 'could have data yet', not 'is open'.
    expect(_etCouldHaveLiveSessionYet(et(2026, 8, 28, 20, 0))).toBe(true)
  })
})

describe('_computeDateReady', () => {
  const F = { targetDate: null, couldHaveLiveSession: false, datesResolved: false }

  it('waits only in the case that was about to fetch twice', () => {
    expect(_computeDateReady(F)).toBe(false)
  })

  it('never waits when a date is already chosen', () => {
    // Deep link, or the fallback already ran — there is nothing left to learn.
    expect(_computeDateReady({ ...F, targetDate: '8/28/2026' })).toBe(true)
  })

  it('never waits during a normal session — the no-tax property', () => {
    // ⛔ The whole design constraint: a weekday session must pay NOTHING for
    // this gate. If this ever goes false, every trading-day load waits on a
    // network round-trip it does not need.
    expect(_computeDateReady({ ...F, couldHaveLiveSession: true })).toBe(true)
  })

  it('releases once the trading-day list answers', () => {
    expect(_computeDateReady({ ...F, datesResolved: true })).toBe(true)
  })

  it('releases on a FAILED list too — it can never strand the page', () => {
    // datesResolved is set in .finally(), so a 500/timeout still releases.
    // Gating on `latestDataDay !== null` instead would leave the page blank
    // forever after one failed request — worse than the bug being fixed.
    expect(_computeDateReady({ ...F, datesResolved: true, targetDate: null })).toBe(true)
  })
})

describe('the gate is actually wired into the page', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/LiveFlowMassive.jsx'), 'utf8')

  it('every data effect that keys on targetDate consults it', () => {
    // A gate nobody calls is decoration — and this repo has shipped that shape
    // repeatedly. Count the guard against the fetching effects it must cover.
    const guards = (src.match(/if \(!dateReady\) return;/g) || []).length
    expect(guards).toBeGreaterThanOrEqual(4)
    const deps = (src.match(/\}, \[[^\]]*dateReady[^\]]*\]/g) || []).length
    expect(deps).toBeGreaterThanOrEqual(4)
  })

  it('the page uses the shared helper rather than re-spelling the condition', () => {
    expect(src).toMatch(/const dateReady = _computeDateReady\(/)
  })

  it('resolution is set in finally(), not only on success', () => {
    // The one line that decides whether a failed request strands the page.
    expect(src).toMatch(/\.finally\(\(\) => \{ if \(!dead\) \{ clearTimeout\(bail\); setDatesResolved\(true\); \} \}\)/)
  })

  it('a hung request cannot hold the page open forever', () => {
    expect(src).toMatch(/setTimeout\(\(\) => \{ if \(!dead\) setDatesResolved\(true\); \}, \d+\)/)
  })
})
