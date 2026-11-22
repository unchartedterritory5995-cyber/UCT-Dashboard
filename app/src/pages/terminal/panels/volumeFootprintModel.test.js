// VFP's pure half: the answer read into the panel's view, and every sentence the panel says. Every value
// is invented (__fixtures__/volumeFootprintFixture.js and the literals below), in the route's real shape.
import { describe, it, expect } from 'vitest'
import {
  HELD_POLL_MS, VFP_CODE, VFP_SOURCE, VFP_WHAT, adDates, bigDaysLine, bigVolumeCell, changeText, earningsNote, fillCell,
  filledCell, gapCell, gapDayCell, gapsLine, partialYearText, pivotCells, pivotsLine, rangeText, sharesText, shortText, signOf,
  timesText, updownText, vfpRead, vfpUrl, windowText, windowsAsOf,
} from './volumeFootprintModel'
import { vfpAnswer } from './__fixtures__/volumeFootprintFixture'

describe('reading the answer', () => {
  it('names the code, the one route and its pace', () => {
    expect(VFP_CODE).toBe('VFP')
    expect(VFP_WHAT).toBe('The volume footprint')
    expect(VFP_SOURCE).toBe("UCT's stored daily prices and volumes")
    expect(vfpUrl('BRK.B')).toBe('/api/research/volume-footprint/BRK.B')
    expect(vfpUrl('A B')).toBe('/api/research/volume-footprint/A%20B')
    expect(HELD_POLL_MS).toBe(1800000)
  })

  it('reads every section of an ok answer', () => {
    const v = vfpRead(vfpAnswer())
    expect(v.state).toBe('ok')
    expect([v.symbol, v.dataThrough, v.first, v.sessions, v.jumpPct]).toEqual(['NVDA', '2026-11-20', '2019-03-01', 1944, 40])
    expect(v.accumulation.windows.map((w) => w.sessions)).toEqual([25, 50])
    expect(v.bigDays.rows).toHaveLength(10)
    expect(v.pivots.state).toBe('ok')
    expect(v.gaps.rows).toHaveLength(60)
    expect(v.gaps.total).toBe(91)
    expect(v.earnings).toMatchObject({ state: 'ok', reports: 12, cover: { from: '2023-11-29', through: '2026-11-20' } })
  })

  it('every other status is a state in words, and a body that is not the route\'s is a failed read', () => {
    expect(vfpRead({ status: 'not_held', detail: 'UCT holds no daily prices for ZZQA.' })).toEqual({ state: 'not_held', detail: 'UCT holds no daily prices for ZZQA.' })
    expect(vfpRead({ status: 'busy', detail: 'x' }).state).toBe('busy')
    expect(vfpRead({ status: 'unavailable', detail: 'y' }).state).toBe('unavailable')
    expect(vfpRead({ status: 'refused' }).state).toBe('unavailable')
    for (const b of [null, [], 'ok', { status: 'computing' }, { items: [] }]) expect(vfpRead(b).state).toBe('failed')
  })

  it('an earnings mark is true, false or not known, never guessed from a missing value', () => {
    const b = vfpAnswer()
    b.big_days.rows[0].earnings = null
    b.big_days.rows[1].earnings = 'yes'
    const v = vfpRead(b)
    expect(v.bigDays.rows[0].earnings).toBeNull()
    expect(v.bigDays.rows[1].earnings).toBeNull()
    expect(v.bigDays.rows[2].earnings).toBe(true)
  })

  it('a section too short for its window reads as short, not as zero', () => {
    const b = vfpAnswer()
    b.accumulation.windows[1] = { state: 'short', needed: 51, held: 30, unit: 'sessions', sessions: 50 }
    b.pivots = { as_of: '2026-11-20', from: '2025-11-20', full_year: false, held_from: '2026-11-06', lookback: 10, ma: 10, state: 'short', needed: 12, held: 11, unit: 'sessions' }
    b.gaps = { as_of: '2026-11-20', first: '2026-11-20', min_gap_pct: 3, state: 'short', needed: 2, held: 1, unit: 'sessions' }
    const v = vfpRead(b)
    expect(v.accumulation.windows[1]).toMatchObject({ state: 'short', needed: 51, held: 30, sessions: 50 })
    expect(v.pivots).toMatchObject({ state: 'short', rows: [] })
    expect(v.gaps).toMatchObject({ state: 'short', rows: [] })
    expect(windowText(v.accumulation.windows[1])).toBe('Needs 51 sessions; UCT holds 30.')
    expect(pivotsLine(v.pivots, 'ZZQA')).toBe('Needs 12 sessions; UCT holds 11.')
    expect(gapsLine(v.gaps, 'ZZQA')).toBe('Needs 2 sessions; UCT holds 1.')
  })
})

describe('section 1 in words', () => {
  it('a window: both counts, the net with its sign, and sessions not judged', () => {
    expect(windowText({ state: 'ok', sessions: 25, accumulation: 7, distribution: 5, net: 2, notJudged: 0 }))
      .toBe('7 accumulation days, 5 distribution days: net +2')
    expect(windowText({ state: 'ok', sessions: 25, accumulation: 1, distribution: 4, net: -3, notJudged: 2 }))
      .toBe('1 accumulation day, 4 distribution days: net -3; 2 sessions not judged (no volume held)')
  })

  it('up/down volume: the ratio and its parts; no ratio when a volume is missing or nothing closed down', () => {
    const u = { state: 'ok', sessions: 50, upVolume: 612_000_000, downVolume: 463_000_000, up: 27, down: 21, flat: 2, noVolume: 0, ratio: 1.32 }
    expect(updownText(u)).toBe('1.32 (612.0M shares on 27 up closes, 463.0M on 21 down closes)')
    expect(updownText({ ...u, ratio: null, noVolume: 1 })).toBe('No ratio: 1 session that moved has no volume held.')
    expect(updownText({ ...u, ratio: null, down: 0, downVolume: 0 })).toMatch(/^No ratio: nothing closed down in the 50 sessions/)
    expect(updownText({ state: 'short', needed: 51, held: 20 })).toBe('Needs 51 sessions; UCT holds 20.')
  })

  it('the day lists keep the newest 25 sessions, newest first', () => {
    const days = [
      { date: '2026-11-19', kind: 'distribution', session: 2 }, { date: '2026-11-10', kind: 'accumulation', session: 9 },
      { date: '2026-11-03', kind: 'distribution', session: 14 }, { date: '2026-09-30', kind: 'distribution', session: 37 },
    ]
    expect(adDates(days, 'distribution')).toBe('Nov 19, Nov 3')
    expect(adDates(days, 'accumulation')).toBe('Nov 10')
    expect(adDates([], 'accumulation')).toBe('none')
  })

  it('the as-of names the close and where each window starts', () => {
    const a = vfpRead(vfpAnswer()).accumulation
    expect(windowsAsOf(a)).toBe('As of the close of Nov 20, 2026; the windows run 25 from Oct 19, 2026 and 50 from Sep 14, 2026.')
  })
})

describe('sections 2 and 3 in words', () => {
  it('the biggest volume days: the line, the multiple, the change and where it closed', () => {
    const b = vfpRead(vfpAnswer()).bigDays
    expect(bigDaysLine(b, 'NVDA')).toBe(`The 10 heaviest sessions since Nov 20, 2025: ${b.summary.up} closed up, ${b.summary.down} down; 4 were on an earnings report.`)
    expect(bigVolumeCell({ volume: 98_400_000, vsAvg: 3.46 })).toEqual({ main: '98.4M', sub: '3.5x its 50-day average' })
    expect(bigVolumeCell({ volume: 1000, vsAvg: null }).sub).toBe('under 50 sessions with volume before it')
    expect(rangeText({ closeInRangePct: 85.4 })).toBe('closed 85% up its range')
    expect(rangeText({ closeInRangePct: null })).toBe('no range that day')
    expect(bigDaysLine({ rows: [], from: '2025-11-20', summary: {} }, 'ZZQA')).toBe('No session with volume held for ZZQA since Nov 20, 2025.')
  })

  it('a young stock says its year is short', () => {
    expect(partialYearText({ fullYear: false, heldFrom: '2026-03-02' }, 'ZZQA')).toBe("UCT's prices for ZZQA start Mar 2, 2026, less than a year back: this covers what is held.")
    expect(partialYearText({ fullYear: true, heldFrom: '2019-03-01' }, 'ZZQA')).toBeNull()
  })

  it("a pocket pivot's margins are to the hundredth, so one just above never reads as level", () => {
    expect(pivotCells({ vsDownMax: 1.04, downMax: 30e6, aboveMaPct: 0.04 })).toEqual({ volume: '1.04x the biggest down day', aboveMa: '+0.04%' })
    expect(pivotCells({ vsDownMax: null, downMax: 0, aboveMaPct: 2.9 }).volume).toBe('biggest down day 0')
    expect(timesText(1.04)).toBe('1.0x')                                        // the control: the default would hide it
  })

  it('pocket pivots: how many, the last, the earnings ones; none is a sentence', () => {
    const p = vfpRead(vfpAnswer()).pivots
    expect(pivotsLine(p, 'NVDA')).toMatch(new RegExp(`^${p.count} pocket pivots since Nov 20, 2025\\. The last was [A-Z][a-z]{2} \\d{1,2}, 2026\\.`))
    expect(pivotsLine({ state: 'ok', count: 0, from: '2025-11-20', rows: [], earnings: 0 }, 'ZZQA')).toBe('No pocket pivot in ZZQA since Nov 20, 2025.')
  })
})

describe('section 4 in words', () => {
  it('the line counts every gap, up and down, and the ones never filled', () => {
    const g = vfpRead(vfpAnswer()).gaps
    expect(gapsLine(g, 'NVDA')).toBe(`91 gaps of 3% or more since Mar 1, 2019: ${g.summary.up.count} up, ${g.summary.down.count} down; ${g.summary.all.open} not filled yet.`)
    expect(gapsLine({ state: 'ok', total: 0, first: '2026-01-02', minGapPct: 3, summary: {} }, 'ZZQA')).toBe('No gap of 3% or more in ZZQA since Jan 2, 2026.')
  })

  it('a fill share is over the gaps old enough to say, and none old enough is words', () => {
    expect(fillCell({ filled: 21, judged: 91, pct: 23.1 })).toEqual({ main: '23%', sub: '21 of 91' })
    expect(fillCell({ filled: 0, judged: 0, pct: null })).toEqual({ main: 'n/a', sub: 'none old enough' })
  })

  it('one gap: its size and the close before, the day, and when it filled', () => {
    const r = { date: '2026-08-27', up: true, gapPct: 7.84, priorClose: 101.2, open: 109.13, close: 111.02, closeVsOpenPct: 1.73,
      filled: null, sessionsToFill: null, sessionsSince: 59 }
    expect(gapCell(r)).toEqual({ main: 'Aug 27, 2026', sub: 'up 7.8% from $101.20' })
    expect(gapCell({ ...r, up: false, gapPct: -4.06 }).sub).toBe('down 4.1% from $101.20')
    expect(gapDayCell(r)).toEqual({ main: '+1.7%', sign: 'up', sub: 'close $111.02 vs open $109.13' })
    expect(filledCell(r)).toEqual({ main: 'Not yet', sub: '59 sessions since', kind: 'open' })
    expect(filledCell({ ...r, filled: '2026-08-27', sessionsToFill: 0 })).toEqual({ main: 'Same session', sub: null, kind: 'same' })
    expect(filledCell({ ...r, filled: '2026-09-02', sessionsToFill: 3 })).toEqual({ main: 'Sep 2, 2026', sub: '3 sessions later', kind: 'later' })
  })
})

describe('earnings and the shared words', () => {
  it('the note names the span the marks cover, or says why there are none', () => {
    const e = vfpRead(vfpAnswer()).earnings
    expect(earningsNote(e, 'NVDA')).toBe('UCT holds 12 report dates for NVDA (Nov 29, 2023 to Aug 26, 2026). A mark means a report dated that session or the session '
      + 'before (the time of day is not held, so a report day and the session after both carry it). The marks are complete from Nov 29, 2023 to Nov 20, 2026; '
      + 'outside that span a session carries no mark either way.')
    expect(earningsNote({ ...e, cover: null }, 'NVDA')).toMatch(/not a complete run of quarters, so a session without a mark may still have had a report\.$/)
    expect(earningsNote({ state: 'not_held' }, 'ZZQA')).toBe("UCT's earnings page has not been built for ZZQA on this server yet, so no session carries an earnings mark.")
    expect(earningsNote({ state: 'no_dates' }, 'ZZQA')).toMatch(/carries no report dates/)
    expect(earningsNote({ state: 'missing' }, 'ZZQA')).toMatch(/could not be read/)
  })

  it('a missing number is n/a, never 0; signs only mark direction', () => {
    expect(changeText(null)).toBe('n/a')
    expect(changeText(4.236)).toBe('+4.2%')
    expect(changeText(-0.31)).toBe('-0.3%')
    expect(timesText(null)).toBe('n/a')
    expect(timesText(12.6)).toBe('13x')
    expect(sharesText(null)).toBe('n/a')
    expect([signOf(2), signOf(-1), signOf(0), signOf(null)]).toEqual(['up', 'down', null, null])
    expect(shortText({ state: 'missing' })).toBe('Not in the answer.')
  })
})
