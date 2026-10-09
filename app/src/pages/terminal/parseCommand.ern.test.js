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
