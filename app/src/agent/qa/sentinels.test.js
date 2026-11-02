// agent-qa — regression for the 2026-11-01 master-gate false positive (run 41372562071): a timing that contains a
// sentinel's digits must read clean; the sentinels themselves must still be caught.
import { describe, it, expect } from 'vitest'
import { leaksOf, SENT_NUM, SENT_INT, SENT_STR } from './sentinels'

describe('agent-qa sentinels', () => {
  it('timings, ids and hex carrying every sentinel\'s digits read CLEAN (the trace.js t0 case included)', () => {
    const noise = { t0: 213579.83, t1: 1213579.2468, ms: 13579, ms2: 2468, perf: 9987.6543211, x: 987.654,
      id: 'a1b2c3d4-13579-2468-9876-54321abcdef0', hex: '0x987654321', uuid: '987654321-e5f6', ver: 'v13579.24689',
      text: 'took 213579.2468 ms at 1987.654321s; run 13579.24681', label: 'ISO-SENTINEL', turns: [{ t0: 213579.83, ms: 13579 }] }
    expect(leaksOf(noise)).toEqual([])
    expect(leaksOf(JSON.stringify(noise)), 'the same noise as one request body').toEqual([])
  })
  it('THE MASTER FAILURE ITSELF: the old sentinel 13579 against trace.js t0 213579.83 is clean by the token rule alone', () => {
    expect(leaksOf({ turns: [{ id: 'u1', t0: 213579.83, ms: 12 }] }, ['13579'])).toEqual([])
    expect(leaksOf({ turns: [{ t0: 213579.83 }], v: 13579 }, ['13579']), 'CONTROL: the value itself still counts').toEqual(['13579'])
  })
  it('a 2-decimal DISPLAY-form sentinel (a table rounds) is safe from timings around it', () => {
    expect(leaksOf({ t: 1987.65, u: 987.6534, s: 'took 1987.65ms, then 987.651' }, ['987.65'])).toEqual([])
    expect(leaksOf({ cell: '987.65' }, ['987.65'])).toEqual(['987.65'])
    expect(leaksOf({ v: 987.65 }, ['987.65'])).toEqual(['987.65'])
  })
  it('CONTROL: the sentinels are caught as values, in prose, in a body string, and as the label', () => {
    expect(leaksOf({ composite: Number(SENT_NUM) })).toEqual([SENT_NUM])
    expect(leaksOf({ reading: Number(SENT_INT) })).toEqual([SENT_INT])
    expect(leaksOf(`NVDA rating ${SENT_NUM}; new highs ${SENT_INT}.`)).toEqual([SENT_NUM, SENT_INT])
    expect(leaksOf(JSON.stringify({ v: Number(SENT_NUM) }))).toEqual([SENT_NUM])
    expect(leaksOf({ title: `Ratings ${SENT_STR}` })).toEqual([SENT_STR])
    expect(leaksOf({ s: `(${SENT_NUM})` })).toEqual([SENT_NUM])
  })
})
