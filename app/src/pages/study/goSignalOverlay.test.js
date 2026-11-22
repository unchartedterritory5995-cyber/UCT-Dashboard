/** goSignalOverlay rails: the flag high + flag low rays every HOURLY Go Signal chart carries. */
import { describe, it, expect } from 'vitest'
import { goSignalOpenBarTimes, goSignalAnnotations, flagStartBar, isGoSignalHourlyItem, GO_SIGNAL_SKILL_ID } from './goSignalOverlay'
import { studyAnnotations, hasStudyOverlay } from './studyOverlays'

// seven regular-session hourly bars a day, unix seconds, three sessions
function hourly(n) {
  const out = []
  let t = 1668695400 // 2022-11-17 09:30 ET
  for (let i = 0; i < n; i++) {
    out.push({ t, o: 10 + i * 0.1, h: 10.5 + i * 0.1, l: 9.5 + i * 0.1, c: 10.2 + i * 0.1, v: 100 })
    t += (i % 7 === 6) ? 3600 * 18 : 3600
  }
  return out
}
const GO = {
  skill_id: GO_SIGNAL_SKILL_ID, asof: '2022-11-17',
  reveal_json: { facts: { flag_start_t: 1668695400 + 3600 * 2, flag_low: 9.8, flag_high: 11.1 } },
}

describe('goSignalOverlay', () => {
  it('is an hourly Go Signal item only with a flag start in the facts (a daily draft carries no layer)', () => {
    expect(isGoSignalHourlyItem(GO)).toBe(true)
    expect(isGoSignalHourlyItem({ skill_id: GO_SIGNAL_SKILL_ID, reveal_json: { facts: {} } })).toBe(false)
    expect(isGoSignalHourlyItem({ skill_id: 'setup.vcp', reveal_json: { facts: { setup: 'Go Signal (hourly)', flag_start_t: 5 } } })).toBe(true)
    expect(isGoSignalHourlyItem(null)).toBe(false)
  })
  it('finds the flag start bar by its numeric key, and by the same key as a string', () => {
    expect(flagStartBar(GO, hourly(14)).t).toBe(1668695400 + 7200)
    const strings = hourly(14).map((b) => ({ ...b, t: String(b.t) }))
    expect(flagStartBar(GO, strings).t).toBe(String(1668695400 + 7200))
    expect(flagStartBar(GO, hourly(2))).toBeNull()
  })
  it('draws the flag high faint and the flag low gold with the price label, both rays from the flag start', () => {
    const out = goSignalAnnotations(GO, hourly(14))
    expect(out.map((a) => a.id)).toEqual(['study-go-flag-high', 'study-go-flag-low'])
    expect(out[0]).toMatchObject({ type: 'hray', points: [{ time: 1668695400 + 7200, price: 11.1 }], lineWidth: 1 })
    expect(out[0].showPriceLabel).toBeUndefined()
    expect(out[1]).toMatchObject({ type: 'hray', points: [{ time: 1668695400 + 7200, price: 9.8 }], lineWidth: 2, showPriceLabel: true })
    expect(out[1].color).not.toBe(out[0].color)
  })
  it('refuses a flag without both levels', () => {
    expect(goSignalAnnotations({ ...GO, reveal_json: { facts: { flag_start_t: 1668695400, flag_low: 9.8 } } }, hourly(14))).toBeNull()
  })
  it('is reachable through the one study overlay door both screens ask', () => {
    expect(hasStudyOverlay(GO)).toBe(true)
    expect(studyAnnotations(GO, hourly(14)).map((a) => a.id)).toEqual(['study-go-flag-high', 'study-go-flag-low'])
    expect(studyAnnotations({ skill_id: GO_SIGNAL_SKILL_ID, reveal_json: { facts: {} } }, hourly(14))).toBeNull()
  })
  it('names the ruled session first three hourly bars from the first-hour key (the open, painted white)', () => {
    const item = { skill_id: 'setup.intraday.go_signal', reveal_json: { facts: { flag_start_t: 1, first_hour_t: 1793107800, flag_low: 1, flag_high: 2 } } }
    const bars = [1793104200, 1793107800, 1793111400, 1793115000, 1793118600].map((t) => ({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }))
    expect(goSignalOpenBarTimes(item, bars)).toEqual([1793107800, 1793111400, 1793115000])
    expect(goSignalOpenBarTimes(item, bars.slice(0, 1))).toBeNull()
    expect(goSignalOpenBarTimes({ reveal_json: { facts: {} } }, bars)).toBeNull()
  })
})
