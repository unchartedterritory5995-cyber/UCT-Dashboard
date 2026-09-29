// Economic currentness: the backend's ten `model.Currentness` states -> the
// chart's `CURRENTNESS` vocabulary, and `next_release` -> display text that never
// invents a time. HTTP 200 NEVER implies current.
import { describe, it, expect } from 'vitest'
import {
  ECON_CURRENTNESS_MAP, economicCurrentnessState, economicCurrentness, economicNextRelease, readEconomicSeries,
} from '../economicSeries'
import { CURRENTNESS, isCurrentnessSettled } from '../../../../utils/marketSession'
import CPI_SAMPLE from '../../../../../../docs/economic-data/samples/USCPI.json'
import GDP_SAMPLE from '../../../../../../docs/economic-data/samples/USRGDPQA.json'
import FFU_SAMPLE from '../../../../../../docs/economic-data/samples/USFEDFUNDSU.json'

// Every state `api/services/econ/model.py::Currentness` defines (pinned by value).
const BACKEND_STATES = ['CURRENT', 'CHECKING', 'DELAYED', 'SOURCE_UNAVAILABLE', 'VALIDATION_FAILED',
  'NO_EXPECTATION', 'UNINITIALIZED', 'NOT_PRODUCTION', 'UNCONFIRMED']

const EXPECTED = {
  CURRENT: 'current',
  CHECKING: 'updating',
  UNCONFIRMED: 'updating',
  DELAYED: 'delayed',
  SOURCE_UNAVAILABLE: 'unavailable',
  VALIDATION_FAILED: 'unavailable',
  NO_EXPECTATION: 'no_expectation',
  UNINITIALIZED: 'no_expectation',
  NOT_PRODUCTION: 'no_expectation',
}

/** The contract as one checker, so a negative control can prove it bites. */
function contractViolations(mapState) {
  const bad = []
  for (const s of BACKEND_STATES) {
    const got = mapState(s)
    if (got !== EXPECTED[s]) bad.push(`${s} -> ${got} (want ${EXPECTED[s]})`)
    if (s !== 'CURRENT' && got === CURRENTNESS.CURRENT) bad.push(`${s} claims current`)
  }
  for (const junk of [undefined, null, '', 'current_ish', 'FRESH', 42, {}]) {
    if (mapState(junk) === CURRENTNESS.CURRENT) bad.push(`${String(junk)} claims current`)
  }
  return bad
}

describe('economic currentness mapping', () => {
  it('maps every backend state to the chart vocabulary; only CURRENT is current', () => {
    expect(contractViolations(economicCurrentnessState)).toEqual([])
    expect(Object.keys(ECON_CURRENTNESS_MAP).sort()).toEqual([...BACKEND_STATES].sort())
    for (const v of Object.values(ECON_CURRENTNESS_MAP)) expect(Object.values(CURRENTNESS)).toContain(v)
  })

  it('NEGATIVE CONTROL: a mapper that calls UNCONFIRMED current fails the contract', () => {
    const broken = (s) => (s === 'UNCONFIRMED' ? CURRENTNESS.CURRENT : economicCurrentnessState(s))
    const v = contractViolations(broken)
    expect(v).toContain('UNCONFIRMED claims current')
    expect(v.length).toBeGreaterThan(0)
    // and one that fails OPEN on an unknown state is caught too
    const open = (s) => (typeof s === 'string' && s in ECON_CURRENTNESS_MAP ? ECON_CURRENTNESS_MAP[s] : CURRENTNESS.CURRENT)
    expect(contractViolations(open).some((x) => x.endsWith('claims current'))).toBe(true)
  })

  it('UNCONFIRMED reads as updating and is NOT settled (no LIVE/current badge)', () => {
    const c = economicCurrentness({ state: 'UNCONFIRMED', latest_period: '2026-04-01', expected_period: '2026-04-01' })
    expect(c.state).toBe(CURRENTNESS.UPDATING)
    expect(c.claimsCurrent).toBe(false)
    expect(isCurrentnessSettled(c.state)).toBe(false)
    expect(c.backendState).toBe('UNCONFIRMED')
  })

  it('case-insensitive, unknown and missing fail closed', () => {
    expect(economicCurrentnessState('current')).toBe('current')
    expect(economicCurrentnessState(' unconfirmed ')).toBe('updating')
    expect(economicCurrentnessState('SOMETHING_NEW')).toBe('no_expectation')
    expect(economicCurrentness(null).claimsCurrent).toBe(false)
    expect(economicCurrentness(undefined).state).toBe('no_expectation')
  })

  it('readEconomicSeries carries the chart reading (real local-store samples)', () => {
    for (const body of [CPI_SAMPLE, GDP_SAMPLE, FFU_SAMPLE]) {
      const e = readEconomicSeries(body)
      expect(e.currentnessView.state).toBe(economicCurrentnessState(body.currentness.state))
      expect(e.currentnessView.backendState).toBe(body.currentness.state)
    }
    const e = readEconomicSeries({ ...GDP_SAMPLE, currentness: { ...GDP_SAMPLE.currentness, state: 'UNCONFIRMED' } })
    expect(e.currentnessView.state).toBe('updating')
    expect(e.currentnessView.claimsCurrent).toBe(false)
    expect(readEconomicSeries({ points: [] }).currentnessView.claimsCurrent).toBe(false)
  })
})

describe('an as-of view never claims currentness', () => {
  // Measured on the local store 2026-09-29: /api/econ/series/USFHFAHPI?asof=<1s before
  // the July release> carried currentness {state: CURRENT, latest_period: 2026-07-01}.
  const body = { ...CPI_SAMPLE, view: 'asof', asof: 1790686799 }
  it('pins to no_expectation, historical, no next release', () => {
    const e = readEconomicSeries(body)
    expect(e.currentnessView).toMatchObject({ state: 'no_expectation', claimsCurrent: false, historical: true,
      asof: 1790686799, latestPeriod: null, backendState: 'CURRENT' })
    expect(e.currentnessView.nextRelease.date).toBeNull()
    expect(e.currentnessView.nextRelease.text).toBe('As of 2026-09-29T12:59:59Z (historical view)')
  })
  it('NEGATIVE CONTROL: the same body as a latest view does claim current', () => {
    const e = readEconomicSeries({ ...body, view: 'latest', asof: null })
    expect(e.currentnessView.claimsCurrent).toBe(true)
    expect(e.currentnessView.historical).toBe(false)
  })
})

describe('economic next_release display', () => {
  it('a HOLE (precision unknown, date/time null) renders without a date or time', () => {
    const nr = economicNextRelease({ date: null, time: null, tz: 'America/New_York', precision: 'unknown' })
    expect(nr).toMatchObject({ date: null, time: null, precision: 'unknown' })
    expect(nr.text).toBe('Next release: not yet scheduled')
    expect(nr.text).not.toMatch(/\d{2}:\d{2}/)
  })

  it('precision unknown with a stale earliest-possible date still shows no date', () => {
    const nr = economicNextRelease({ date: '2026-10-01', time: '08:30', precision: 'unknown' })
    expect(nr.date).toBeNull()
    expect(nr.time).toBeNull()
  })

  it('date_only never shows a time (even if one is sent); time null never invents 08:30', () => {
    expect(economicNextRelease({ date: '2026-10-15', time: '08:30', tz: 'America/New_York', precision: 'date_only' }))
      .toMatchObject({ date: '2026-10-15', time: null, text: 'Next release: Oct 15, 2026' })
    for (const precision of ['exact', 'time_configured', 'rule']) {
      const nr = economicNextRelease({ date: '2026-10-15', time: null, tz: 'America/New_York', precision })
      expect(nr.time).toBeNull()
      expect(nr.text).not.toMatch(/\d{2}:\d{2}/)
    }
  })

  it('exact / time_configured / rule are worded honestly', () => {
    expect(economicNextRelease(GDP_SAMPLE.currentness.next_release).text).toBe('Next release: Sep 30, 2026 08:30 ET')
    // TIME_CONFIGURED: date from the OMB schedule, time from agency practice -> "typical", never agency-published
    expect(economicNextRelease(CPI_SAMPLE.currentness.next_release).text).toBe('Next release: Oct 14, 2026 08:30 ET (typical)')
    expect(economicNextRelease(FFU_SAMPLE.currentness.next_release).text).toBe('Next release: Sep 30, 2026 ~09:00 ET (est.)')
    // an unrecognised precision claims the least (date only)
    expect(economicNextRelease({ date: '2026-10-15', time: '08:30', precision: 'psychic' })).toMatchObject({ time: null, precision: 'date_only' })
    expect(economicNextRelease(null).precision).toBe('unknown')
  })
})
