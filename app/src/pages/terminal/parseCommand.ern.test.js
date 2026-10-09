// Wave 4 (lane A): `ERN` alone is the earnings calendar (CAL); `NVDA ERN` is one company.
import { describe, it, expect } from 'vitest'
import parseCommand from './parseCommand'
import { describeCommand } from './grammar'

describe('ERN with no ticker', () => {
  it('reads as CAL, and says why before Enter', () => {
    const cmd = parseCommand('ERN')
    expect(cmd).toMatchObject({ ok: true, type: 'function', code: 'CAL', sym: null, from: 'ERN' })
    expect(cmd.collision).toBeUndefined()
    expect(describeCommand(cmd).text).toMatch(/ERN with no ticker opens the earnings calendar/)
  })
  it('`NVDA ERN` and `ERN NVDA` still open that company\'s earnings', () => {
    expect(parseCommand('NVDA ERN')).toMatchObject({ ok: true, code: 'ERN', sym: 'NVDA' })
    expect(parseCommand('ERN NVDA')).toMatchObject({ ok: true, code: 'ERN', sym: 'NVDA' })
  })
})

// Wave 6 (lane A): `ERN TODAY` / `ERN NEXT` read TODAY and NEXT as a ticker. ERN's
// `marketAs: 'CAL'` (functions.js) makes them CAL's day arguments instead.
describe('ERN with a calendar argument', () => {
  it.each([
    ['ERN TODAY', ['TODAY']],
    ['ERN NEXT', ['NEXT']],
    ['ern next', ['NEXT']],
    ['ERN PREV', ['PREV']],
    ['ERN 2026-10-05', ['2026-10-05']],
  ])('%s opens the calendar', (line, args) => {
    const cmd = parseCommand(line)
    expect(cmd).toMatchObject({ ok: true, type: 'function', code: 'CAL', sym: null, args, from: 'ERN' })
    expect(describeCommand(cmd).tone).toBe('ok')
  })
  it('reads the same as CAL TODAY / CAL NEXT', () => {
    for (const day of ['TODAY', 'NEXT']) {
      const { from, argNotTicker, ...ern } = parseCommand(`ERN ${day}`)
      const { argNotTicker: _a, collision: _c, ...cal } = parseCommand(`CAL ${day}`)  // CAL is also a ticker; ERN is not
      expect(ern).toEqual(cal)
    }
  })
  it('`ERN $TODAY` still means the ticker TODAY', () => {
    expect(parseCommand('ERN $TODAY')).toMatchObject({ ok: true, code: 'ERN', sym: 'TODAY' })
  })
})
