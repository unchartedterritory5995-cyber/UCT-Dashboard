// IDAY, the pure half. Rails:
//   * the route's `{}` is "no update on hand", a foreign body is "failed", and neither is an update;
//   * the writer's timestamp reads with its microseconds and its New York offset, and a stamp with
//     no zone is refused (never read in the reader's own zone);
//   * every string is flattened to one line of plain text, whatever the model wrote;
//   * OWNER RULING 2026-11-17: the view carries the market phase and the session note only. The
//     update's per-stock list (`ep_updates`: symbols, statuses, notes, their count) and the
//     model's own exposure, trend, risk and leader numbers never reach it.
// The fixture is the shape the writer posts (api/routers/push.py push_intraday), made-up content.
import { describe, it, expect } from 'vitest'
import {
  INTRADAY_KEEP_HOURS, INTRADAY_MODES, INTRADAY_POLL_MS, INTRADAY_UPDATE_CODE, INTRADAY_UPDATE_URL, NOTE_MAX, intradayRead, writtenAtOf,
} from './intradayUpdateModel'
import * as model from './intradayUpdateModel'

const UPDATE = {
  mode: 'midday',
  timestamp: '2026-11-17T12:02:31.123456-05:00',
  date: '2026-11-17',
  regime: { phase: 'Uptrend', trend_score: 7, distribution_days: 2, risk_score: 3.0, exposure_pct: 80, notes: 'Breadth is holding and volume is above average.' },
  ep_updates: [
    { symbol: 'ZZQA', status: 'new', current_price: 41.25, pct_from_entry: 6.5, note: 'Gapped on earnings and held the open.' },
    { symbol: 'ZZQB', status: 'following through', note: 'Second day of heavy volume.' },
  ],
  session_notes: 'The strongest stocks are holding their gains into midday.',
  leaders_count: 14,
}
const VIEW_KEYS = [
  'state', 'mode', 'modeLabel', 'modeDue', 'writtenAt', 'day', 'phase', 'phaseNote', 'phaseNoteCut', 'sessionNote', 'sessionNoteCut', 'hasText',
]

describe('IDAY constants', () => {
  it('the code, the route, the three runs and the paces', () => {
    expect(INTRADAY_UPDATE_CODE).toBe('IDAY')
    expect(INTRADAY_UPDATE_URL).toBe('/api/intraday-update')
    expect(Object.keys(INTRADAY_MODES)).toEqual(['open', 'midday', 'preclose'])
    expect(INTRADAY_KEEP_HOURS).toBe(4)
    expect(INTRADAY_POLL_MS).toBe(300000)
    expect(NOTE_MAX).toBe(1000)
  })

  it('the model exports nothing about stocks or the writer\'s own limits', () => {
    for (const name of Object.keys(model)) expect(name).not.toMatch(/STOCK|SYMBOL|CAP$|_CAP|^EP_|_EP_|CANDIDATE/i)
  })
})

describe('IDAY writtenAtOf', () => {
  it('reads the writer\'s stamp, microseconds and offset included, as one instant', () => {
    expect(writtenAtOf('2026-11-17T12:02:31.123456-05:00')).toBe('2026-11-17T17:02:31.123Z')
    expect(writtenAtOf('2026-07-01T09:45:02-04:00')).toBe('2026-07-01T13:45:02.000Z')
    expect(writtenAtOf('2026-11-17T17:02:31Z')).toBe('2026-11-17T17:02:31.000Z')
    expect(writtenAtOf(' 2026-11-17T12:02-0500 ')).toBe('2026-11-17T17:02:00.000Z')
  })
  it('refuses a stamp with no zone, a bare date and anything that is not a time', () => {
    for (const bad of [null, undefined, '', 'noon', '2026-11-17', '2026-11-17T12:02:31', '2026-13-40T12:02:31-05:00', 1763398951, {}, []]) {
      expect(writtenAtOf(bad), String(bad)).toBeNull()
    }
  })
})

describe('IDAY intradayRead', () => {
  it('an update: the run, when it was written, the phase and the session note, and nothing else', () => {
    const v = intradayRead(UPDATE)
    expect(v).toEqual({
      state: 'ok', mode: 'midday', modeLabel: 'Midday', modeDue: '12:00 PM ET', writtenAt: '2026-11-17T17:02:31.123Z', day: '2026-11-17',
      phase: 'Uptrend', phaseNote: 'Breadth is holding and volume is above average.', phaseNoteCut: false,
      sessionNote: 'The strongest stocks are holding their gains into midday.', sessionNoteCut: false,
      hasText: true,
    })
  })

  it('the per-stock list never reaches the view: no symbol, no status, no note, no count, in any state', () => {
    const view = intradayRead(UPDATE)
    expect(Object.keys(view).sort()).toEqual([...VIEW_KEYS].sort())
    const flat = JSON.stringify(view)
    for (const s of ['ZZQA', 'ZZQB', 'Gapped on earnings', 'Second day of heavy volume', 'following through', '41.25', '6.5', 'ep_updates']) {
      expect(flat, s).not.toContain(s)
    }
    for (const k of Object.keys(view)) expect(k).not.toMatch(/stock|symbol|candidate|ep_|count/i)
    // the same view with and without the list: nothing about it leaks into any field (a count included)
    const { ep_updates: _left, ...without } = UPDATE
    expect(intradayRead(without)).toEqual(view)
    expect(intradayRead({ ...UPDATE, ep_updates: Array.from({ length: 40 }, (_, i) => ({ symbol: `ZZ${i}`, note: 'n' })) })).toEqual(view)
    // an update that carries only the list is not read as having anything to show
    expect(intradayRead({ mode: 'open', ep_updates: UPDATE.ep_updates })).toMatchObject({ state: 'ok', hasText: false })
    expect(JSON.stringify(intradayRead({ mode: 'open', ep_updates: UPDATE.ep_updates }))).not.toContain('ZZQ')
    // and the list alone does not make a body this route's update
    expect(intradayRead({ ep_updates: UPDATE.ep_updates }).state).toBe('failed')
  })

  it('the model\'s own exposure, trend, risk and leader numbers never reach the view', () => {
    const view = intradayRead({ ...UPDATE, regime: { ...UPDATE.regime, trend_score: 7.7, distribution_days: 66, risk_score: 3.3, exposure_pct: 83 }, leaders_count: 19 })
    for (const k of Object.keys(view)) expect(k).not.toMatch(/exposure|trend|risk|distribution|leaders/i)
    const flat = JSON.stringify(view)
    for (const n of ['83', '7.7', '3.3', '66', '19']) expect(flat, n).not.toContain(n)
  })

  it('the route\'s {} is "none"; a body that is not this route\'s is "failed"; neither is an update', () => {
    expect(intradayRead({})).toMatchObject({ state: 'none', hasText: false, writtenAt: null })
    for (const body of [undefined, null, [], 'x', 7, { detail: 'The daily wire surface requires a paid plan' }, { status: 'ok' }]) {
      expect(intradayRead(body).state, JSON.stringify(body)).toBe('failed')
    }
  })

  it('a thin update is still an update, and says what it does not carry', () => {
    const v = intradayRead({ mode: 'afterhours', timestamp: 'soon', date: '11/17', session_notes: '', regime: null })
    expect(v).toMatchObject({
      state: 'ok', mode: null, modeLabel: null, modeDue: null, writtenAt: null, day: null, phase: null, phaseNote: null, sessionNote: null,
      hasText: false,
    })
    expect(intradayRead({ mode: 'OPEN ' })).toMatchObject({ state: 'ok', mode: 'open', modeLabel: 'After the open', modeDue: 'about 9:45 AM ET' })
    expect(intradayRead({ regime: { phase: 'Pullback' } })).toMatchObject({ state: 'ok', phase: 'Pullback', hasText: true })
    expect(intradayRead({ session_notes: 'Quiet tape.' })).toMatchObject({ state: 'ok', sessionNote: 'Quiet tape.', hasText: true })
    // a prototype word is not a mode
    expect(intradayRead({ mode: 'constructor' }).mode).toBeNull()
  })

  it('every string is one line of plain text, whatever the model wrote', () => {
    const v = intradayRead({
      mode: 'open',
      session_notes: '  <b>Strong</b>\n\nopen.\t<script>alert(1)</script>\u0000 ',
      regime: { phase: ['Uptrend'], notes: { text: 'x' } },
    })
    // markup is kept as the characters it is (the panel draws text), only the white space is flattened
    expect(v.sessionNote).toBe('<b>Strong</b> open. <script>alert(1)</script>')
    expect(v.phase).toBeNull()
    expect(v.phaseNote).toBeNull()
    expect(intradayRead({ regime: { phase: 'Up\ntrend', notes: 'line one\r\nline two' } })).toMatchObject({ phase: 'Up trend', phaseNote: 'line one line two' })
  })

  it('cuts a note that runs too long, and says it did', () => {
    const long = intradayRead({ session_notes: 'x'.repeat(NOTE_MAX + 5), regime: { notes: 'y'.repeat(NOTE_MAX + 5), phase: 'z'.repeat(200) } })
    expect(long.sessionNote).toHaveLength(NOTE_MAX)
    expect(long.sessionNoteCut).toBe(true)
    expect(long.phaseNote).toHaveLength(NOTE_MAX)
    expect(long.phaseNoteCut).toBe(true)
    expect(long.phase).toHaveLength(60)
    const exact = intradayRead({ session_notes: 'x'.repeat(NOTE_MAX), regime: { notes: 'y'.repeat(NOTE_MAX) } })
    expect([exact.sessionNoteCut, exact.phaseNoteCut]).toEqual([false, false])
  })
})
