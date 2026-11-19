// Theme rotation, the pure half. Fixtures are the shape compute_rotation_signals returns
// (api/services/theme_performance.py), with made-up themes.
import { describe, it, expect } from 'vitest'
import {
  ROTATION_SIDES, ROTATION_SIDE_WORDS, ROTATION_THRESHOLD, THEME_ROTATION_CODE, THEME_ROTATION_URL, deltaText,
  normRotationSide, parseRotationSide, rankMoveText, rotationCommandArgs, rotationRead, rotationSummary,
} from './themeRotationModel'

const entry = (ticker, name, r1w, k1w, r1m, k1m, delta) => ({
  name, ticker, '1w_return': r1w, '1w_rank': k1w, '1m_return': r1m, '1m_rank': k1m, '3m_return': null, '3m_rank': null,
  ...(delta === undefined ? {} : { momentum_delta: delta }),
})
const SEMI = entry('SEMI', 'Semiconductors', 6.21, 91.2, 1.1, 48.6, 42.6)
const GOLD = entry('GOLDM', 'Gold miners', -0.4, 55, -9.8, 12.5, 42.5)
const NUKE = entry('NUKE', 'Nuclear', 2.2, 70.3, 3.1, 50.1, 20.2)
const SOLAR = entry('SOLAR', 'Solar', -7.5, 4.4, 5.6, 77.7, -73.3)
const BANKS = entry('BANKS', 'Regional banks', -1.2, 30, 2.4, 60, -30)
const FLAT = entry('FLAT', 'Utilities', 0.3, 51, 0.6, 50, 1)
const UNRANKED = entry('NEWT', 'New theme', null, null, null, null)
const BODY = {
  rotating_in: [SEMI, GOLD, NUKE],
  rotating_out: [SOLAR, BANKS],
  rankings: { SEMI, GOLDM: GOLD, NUKE, SOLAR, BANKS, FLAT, NEWT: UNRANKED },
  generated_at: '2026-11-17T15:04:05.123456+00:00',
}
const COLD = { rotating_in: [], rotating_out: [], rankings: {}, generated_at: '2026-11-17T15:04:05.123456+00:00' }
const QUIET = { rotating_in: [], rotating_out: [], rankings: { FLAT }, generated_at: '2026-11-17T15:04:05+00:00' }

describe('theme rotation model', () => {
  it('names its route, its code and the server threshold', () => {
    expect(THEME_ROTATION_URL).toBe('/api/theme-rotation')
    expect(THEME_ROTATION_CODE).toMatch(/^[A-Z]{2,6}$/)
    expect(ROTATION_THRESHOLD).toBe(20)
  })

  it('the words a list is typed as, and the command arguments', () => {
    expect(Object.keys(ROTATION_SIDES)).toEqual(['both', 'in', 'out'])
    for (const [raw, want] of [['IN', 'in'], ['in', 'in'], [' Leaders ', 'in'], ['OUT', 'out'], ['fading', 'out'], ['LAGGARDS', 'out']]) {
      expect(parseRotationSide(raw), String(raw)).toBe(want)
    }
    for (const bad of [null, undefined, '', 'nonsense', 'toString', 'constructor', 'both', 7]) expect(parseRotationSide(bad), String(bad)).toBeNull()
    expect(normRotationSide('nonsense')).toBe('both')
    expect(normRotationSide(null)).toBe('both')
    expect(normRotationSide('both')).toBe('both')
    expect(normRotationSide('OUT')).toBe('out')
    expect(normRotationSide('in')).toBe('in')
    expect(normRotationSide('constructor')).toBe('both')
    expect(rotationCommandArgs()).toEqual([])
    expect(rotationCommandArgs({ side: 'both' })).toEqual([])
    expect(rotationCommandArgs({ side: 'in' })).toEqual(['IN'])
    expect(rotationCommandArgs({ side: 'out' })).toEqual(['OUT'])
    // every token a chip writes is a word the reader gives back as the same list
    for (const [key, s] of Object.entries(ROTATION_SIDES)) if (s.token) expect(parseRotationSide(s.token)).toBe(key)
    for (const side of Object.values(ROTATION_SIDE_WORDS)) expect(['in', 'out']).toContain(side)
  })

  it('rotationRead: both lists, biggest move first, ranks and returns as sent', () => {
    const out = rotationRead(BODY)
    expect(out.state).toBe('ok')
    expect(out.ranked).toBe(7)
    expect(out.generatedAt).toBe('2026-11-17T15:04:05.123+00:00')
    expect(out.rotatingIn.map((r) => [r.themeKey, r.name, r.delta])).toEqual([
      ['SEMI', 'Semiconductors', 42.6], ['GOLDM', 'Gold miners', 42.5], ['NUKE', 'Nuclear', 20.2],
    ])
    expect(out.rotatingOut.map((r) => [r.themeKey, r.delta])).toEqual([['SOLAR', -73.3], ['BANKS', -30]])
    expect(out.rotatingIn[0]).toMatchObject({ rank1w: 91.2, rank1m: 48.6, rank3m: null, ret1w: 6.21, ret1m: 1.1, ret3m: null })
    expect(new Set([...out.rotatingIn, ...out.rotatingOut].map((r) => r.key)).size).toBe(5)
  })

  it('rotationRead: a reordered list is put back biggest move first', () => {
    const out = rotationRead({ ...BODY, rotating_in: [NUKE, SEMI, GOLD], rotating_out: [BANKS, SOLAR] })
    expect(out.rotatingIn.map((r) => r.themeKey)).toEqual(['SEMI', 'GOLDM', 'NUKE'])
    expect(out.rotatingOut.map((r) => r.themeKey)).toEqual(['SOLAR', 'BANKS'])
  })

  it('rotationRead: a row with no key, no rank change or the wrong sign is dropped, never drawn as 0', () => {
    const out = rotationRead({
      ...BODY,
      rotating_in: [SEMI, SEMI, UNRANKED, { name: 'No key', momentum_delta: 30 }, null, 'x', SOLAR],
      rotating_out: [BANKS, GOLD, { ticker: 'NAN', name: 'Bad', momentum_delta: 'big' }],
    })
    expect(out.rotatingIn.map((r) => r.themeKey)).toEqual(['SEMI'])
    expect(out.rotatingOut.map((r) => r.themeKey)).toEqual(['BANKS'])
  })

  it('rotationRead: nothing ranked is warming, themes ranked with empty lists is a quiet answer', () => {
    expect(rotationRead(COLD)).toMatchObject({ state: 'warming', rotatingIn: [], rotatingOut: [], ranked: 0 })
    expect(rotationRead(QUIET)).toMatchObject({ state: 'ok', rotatingIn: [], rotatingOut: [], ranked: 1 })
    expect(rotationRead({ ...COLD, rankings: null }).state).toBe('warming')
  })

  it('rotationRead: anything that is not the route\'s shape is a failed read, never an empty board', () => {
    for (const body of [undefined, null, [], 'x', {}, { rotating_in: [] }, { rotating_in: 'none', rotating_out: [] }, { detail: 'boom' }, { status: 'computing' }]) {
      const out = rotationRead(body)
      expect(out.state, JSON.stringify(body)).toBe('failed')
      expect(out.rotatingIn).toEqual([])
      expect(out.rotatingOut).toEqual([])
    }
  })

  it('rankMoveText and deltaText: whole points, the 1 month rank first, a sign on every change', () => {
    const [semi] = rotationRead(BODY).rotatingIn
    const [solar] = rotationRead(BODY).rotatingOut
    expect(rankMoveText(semi)).toBe('49 to 91')
    // the change is the difference of the two whole ranks shown (42.6 as sent), so the row agrees with itself
    expect(deltaText(semi)).toBe('+42')
    expect(rankMoveText(solar)).toBe('78 to 4')
    expect(deltaText(solar)).toBe('-74')
    expect(deltaText({ delta: 42.6 })).toBe('+43')
    expect(deltaText({ delta: -73.3, rank1w: null, rank1m: 77.7 })).toBe('-73')
    expect(deltaText({ delta: 0.2 })).toBe('0')
    expect(deltaText({ delta: null })).toBeNull()
    expect(deltaText(null)).toBeNull()
    expect(rankMoveText({ rank1w: 50, rank1m: null })).toBeNull()
    expect(rankMoveText(undefined)).toBeNull()
  })

  it('rotationSummary counts both lists and the themes ranked', () => {
    expect(rotationSummary(rotationRead(BODY))).toBe('3 themes are rotating in and 2 themes are rotating out, of 7 ranked.')
    expect(rotationSummary(rotationRead({ ...BODY, rotating_in: [SEMI], rotating_out: [] })))
      .toBe('1 theme is rotating in and 0 themes are rotating out, of 7 ranked.')
    expect(rotationSummary(rotationRead(COLD))).toBe('')
    expect(rotationSummary(null)).toBe('')
  })
})
