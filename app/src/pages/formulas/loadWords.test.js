// HOW HEAVY A PUBLISHED INDICATOR IS TO DRAW, IN WORDS (loadWords.js; Studio lane R6).
import { describe, it, expect } from 'vitest'
import { loadLine, deviceTimeLine, LOAD_CLASSES } from './loadWords'

describe('the load line', () => {
  it('words each class the server sends, and only those three', () => {
    expect(LOAD_CLASSES).toEqual(['light', 'moderate', 'heavy'])
    expect(loadLine({ class: 'light', work: 120000 })).toEqual({ code: 'light', text: 'Light to draw.' })
    expect(loadLine({ class: 'moderate', work: 9 }).text).toMatch(/^Moderate to draw/)
    expect(loadLine({ class: 'heavy', work: 9 }).text).toMatch(/^Heavy to draw/)
    for (const c of LOAD_CLASSES) expect(loadLine({ class: c }).text.endsWith('.')).toBe(true)
  })

  it('says "not measured yet" only when the server says it was not measured', () => {
    expect(loadLine({ class: null, measured: false }))
      .toEqual({ code: 'unmeasured', text: 'How heavy it is to draw has not been measured yet.' })
    // a class it does not know, or a count with no class, is not turned into one here
    expect(loadLine({ class: 'enormous' })).toBeNull()
    expect(loadLine({ work: 5000000 })).toBeNull()
    expect(loadLine({ class: null })).toBeNull()
  })

  it('⛔ a listing from before this existed draws nothing', () => {
    for (const load of [undefined, null, 'light', 7, []]) expect(loadLine(load), String(load)).toBeNull()
  })
})

describe('the time on this device', () => {
  it('is said as this device\'s, with the bars it was measured over', () => {
    expect(deviceTimeLine(0.4, 5000)).toBe('Drew 5,000 bars in under 1 ms on this device.')
    // nothing was run here (the engine's script lane is off in this build): said, never a number
    expect(deviceTimeLine({ unmeasured: 'lane-off' })).toBe('The time on this device was not measured.')
    expect(deviceTimeLine(6.25, 5000)).toBe('Drew 5,000 bars in 6.3 ms on this device.')
    expect(deviceTimeLine(41.7, 5000)).toBe('Drew 5,000 bars in 42 ms on this device.')
  })

  it('is nothing for anything that is not a real measurement', () => {
    for (const [ms, bars] of [[NaN, 5000], [-1, 5000], [null, 5000], [5, 0], [5, 2.5], [5, null]]) {
      expect(deviceTimeLine(ms, bars), `${ms} ${bars}`).toBeNull()
    }
  })
})
