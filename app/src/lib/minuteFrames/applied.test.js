// @vitest-environment node
// "Minute M's file is in the browser's cache now": the one message the device store's worker sends the pages
// (applied.js). The sender and the reader share this module, so its shape is one fact.
//   A1 a frame read as its own minute file: { type, day, hhmm, seq, minute }, hhmm the minute file's own name
//   A2 a frame replayed from today.bin (file false / not said): NOTHING is told
//   A3 an info that is not a whole minute of a day: nothing
//   A4 the reader takes exactly what the sender made, and nothing else on the channel
import { describe, it, expect } from 'vitest'
import { appliedSignal, readAppliedSignal, MINUTE_APPLIED_CHANNEL, MINUTE_APPLIED } from './applied'

const MIN = Date.UTC(2026, 10, 10, 15, 2) / 60000                 // Tue 2026-11-10 10:02 ET
const info = (over = {}) => ({ day: '2026-11-10', seq: 362, minute: MIN, withAv: false, dailyOk: false, file: true, ...over })

describe('the minute-applied message', () => {
  it('A1 a frame read as its own minute file is told: day, the file name, seq, minute', () => {
    expect(MINUTE_APPLIED_CHANNEL).toBe('uct-minute-applied')
    expect(appliedSignal(info())).toEqual({ type: MINUTE_APPLIED, day: '2026-11-10', hhmm: '1002', seq: 362, minute: MIN })
    expect(appliedSignal(info({ seq: 0 })).hhmm).toBe('0400')
    expect(Object.keys(appliedSignal(info())).sort()).toEqual(['day', 'hhmm', 'minute', 'seq', 'type'])   // nothing else travels
  })

  it('A2 a frame replayed from today.bin, or one that does not say how it was read: nothing is told', () => {
    expect(appliedSignal(info({ file: false }))).toBe(null)
    expect(appliedSignal(info({ file: undefined }))).toBe(null)
    expect(appliedSignal(info({ file: 'yes' }))).toBe(null)
  })

  it('A3 an info that is not a whole minute of a day: nothing', () => {
    for (const bad of [null, undefined, {}, info({ day: 20261110 }), info({ day: 'today' }), info({ seq: 1.5 }), info({ seq: -1 }), info({ minute: 'x' })]) {
      expect(appliedSignal(bad)).toBe(null)
    }
  })

  it('A4 the reader takes exactly what the sender made, and nothing else on the channel', () => {
    const msg = appliedSignal(info())
    expect(readAppliedSignal(msg)).toEqual({ day: '2026-11-10', seq: 362, minute: MIN })
    for (const bad of [null, undefined, {}, { ...msg, type: 'event' }, { ...msg, day: 'x' }, { ...msg, seq: 362.5 }, { ...msg, hhmm: '1003' }, { ...msg, minute: null }]) {
      expect(readAppliedSignal(bad)).toBe(null)
    }
  })
})
