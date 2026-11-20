// Mark day / Replay from this day (owner 2026-11-19).
import { describe, it, expect } from 'vitest'
import { markColorFor, scanDayView } from './scanDay'
import { resolveHighlightTimes } from '../../../components/chart/highlightBars'
import {
  parseBoard, serializeBoard, defaultBoard, DAY_PREF_DEFAULTS, DAY_PREF_LS, readDayPrefsLocal, writeDayPrefsLocal,
} from './drillBoardPrefs'

describe('Mark day color follows the canvas luminance', () => {
  it('white on dark canvases, black on light ones (custom canvases too)', () => {
    for (const c of ['#161a20', '#17181b', '#0a0a0a', 'rgb(30, 20, 60)']) expect(markColorFor(c)).toBe('#ffffff')
    for (const c of ['#f4f5f6', '#ffffff', 'rgb(250, 240, 220)']) expect(markColorFor(c)).toBe('#000000')
    expect(markColorFor(null)).toBe('#ffffff')
  })
})

describe('the bar the color lands on', () => {
  it('daily: the exact day', () => {
    const times = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']
    expect(resolveHighlightTimes(times, '2026-11-12').map(e => e.time)).toEqual(['2026-11-12'])
  })
  it('weekly / monthly: the bar that holds the day', () => {
    const weeks = ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']
    expect(resolveHighlightTimes(weeks, '2026-11-12').map(e => e.time)).toEqual(['2026-11-09'])
    const months = ['2026-09-01', '2026-10-01', '2026-11-01']
    expect(resolveHighlightTimes(months, '2026-11-12').map(e => e.time)).toEqual(['2026-11-01'])
  })
  it('intraday: every bar of that session', () => {
    const at = (d, hh, mm) => Date.UTC(...d.split('-').map((v, i) => (i === 1 ? v - 1 : +v)), hh, mm) / 1000
    const times = [at('2026-11-11', 15, 55), at('2026-11-12', 9, 30), at('2026-11-12', 12, 0), at('2026-11-12', 15, 55), at('2026-11-13', 9, 30)]
    expect(resolveHighlightTimes(times, '2026-11-12').map(e => e.time)).toEqual(times.slice(1, 4))
  })
})

describe('what the charts are told', () => {
  it('Mark day on by default; Replay cuts at the drill date only when on and not live', () => {
    expect(scanDayView({ date: '2026-11-12' })).toEqual({ markDay: '2026-11-12', replayCutoff: null })
    expect(scanDayView({ date: '2026-11-12', replay: true })).toEqual({ markDay: '2026-11-12', replayCutoff: '2026-11-12' })
    expect(scanDayView({ date: '2026-11-19', replay: true, live: true }).replayCutoff).toBeNull()
    expect(scanDayView({ date: '2026-11-12', markDay: false }).markDay).toBeNull()
  })
})

describe('per-member persistence', () => {
  it('defaults: Mark day on, Replay off', () => {
    expect(DAY_PREF_DEFAULTS).toEqual({ markDay: true, replay: false })
    expect(parseBoard(null)).toMatchObject({ markDay: true, replay: false })
    expect(defaultBoard()).toMatchObject({ markDay: true, replay: false })
  })
  it('saved on the board and read back', () => {
    const b = { ...parseBoard(null), markDay: false, replay: true }
    expect(parseBoard(serializeBoard(b))).toMatchObject({ markDay: false, replay: true })
    expect(parseBoard('{"markDay":"yes"}').markDay).toBe(true)   // junk → default
  })
  it('mirrored to localStorage under exact keys', () => {
    const store = new Map()
    const ls = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) }
    expect(DAY_PREF_LS).toEqual({ markDay: 'uct.breadthDrill.markDay', replay: 'uct.breadthDrill.replay' })
    writeDayPrefsLocal({ replay: true }, ls)
    expect([...store.keys()]).toEqual(['uct.breadthDrill.replay'])
    expect(readDayPrefsLocal(ls)).toEqual({ replay: true })
  })
})
