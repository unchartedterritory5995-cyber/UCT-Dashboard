// app/src/components/chart/engine/runtime/__tests__/alertEmit.test.js
//
// ⭐⭐ TRACK 6, AL1 (NUMBER PENDING, coordinator ruling 2026-11-22): a script's `alert()` calls are RECORDED where
// they run (`collections.js::ALERT_EMIT`, lowered by `pineRuntimeFrontend.js` C23) and carried beside the columns
// as the run's alert record (`runtimeColumns.js::RUNTIME_ALERTS_KEY`), so the server lane can deliver them. These
// rails hold the four promises:
//   1. an event is recorded on exactly the bars the call's branch runs, with its literal message and its freq;
//   2. a message built from values is recorded WITHHELD (the event, no text): never a new refusal;
//   3. NOTHING the pane draws moves: the columns equal the same script with its alert() lines removed;
//   4. only a run over every bar carries a record (a resumed run, which ran only the newest bars, carries none).
import { describe, it, expect, beforeEach } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeAlertsOf } from '../runtimeColumns.js'
import { ALERT_EMIT, ALERT_LOG_CAP, ALERT_MESSAGE_CAP, beginAlertLog, takeAlertLog, alertEmit } from '../collections.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

const NL = String.fromCharCode(10)
function weekdays(n, from = '2016-01-04') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const ROWS = weekdays(120).map((t, i) => {
  const c = 100 + Math.sin(i / 5) * 4 + i * 0.05
  return { t, o: c + (i % 3 === 0 ? 0.6 : -0.6), h: c + 1.5, l: c - 1.5, c, v: 1e5 + i }
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const doc = (source, outputs = { x: 0 }) => ({ id: 'u_alertemit', meta: {},
  compute: { kind: 'runtime', fn: 'runtime:u_alertemit', rev: 1, source, outputs } })
const run = (source, opts = {}) => computeRuntimeColumns(doc(source), ROWS, { ...CTX }, { now: () => 0, incremental: false, ...opts })
const head = ['//@version=5', 'indicator("alert emit")']

describe('AL1: alert() is recorded where it runs', () => {
  it('records the literal message and the freq on exactly the bars its branch runs', () => {
    const src = [...head, 'up = close > open', 'if up', '    alert("an up bar", alert.freq_once_per_bar_close)',
      'plot(close, "x")', ''].join(NL)
    const rec = runtimeAlertsOf(run(src))
    expect(rec).not.toBe(null)
    expect(rec.fromBar).toBe(0)
    const want = ROWS.map((r, i) => (r.c > r.o ? i : -1)).filter((i) => i >= 0)
    expect(want.length).toBeGreaterThan(10)
    expect(rec.events.map((e) => e.bar)).toEqual(want)
    for (const e of rec.events) {
      expect(e.message).toBe('an up bar')
      expect(e.freq).toBe('alert.freq_once_per_bar_close')
    }
    expect(rec.dropped).toBe(0)
  })

  it('a message built from values is recorded WITHHELD (null text), never refused; freq defaults to once per bar', () => {
    const src = [...head, 'if close > open', '    alert("close " + str.tostring(close))', 'plot(close, "x")', ''].join(NL)
    const rec = runtimeAlertsOf(run(src))
    expect(rec.events.length).toBeGreaterThan(10)
    for (const e of rec.events) {
      expect(e.message).toBe(null)
      expect(e.freq).toBe('alert.freq_once_per_bar')
    }
  })

  it('a script with no alert() carries an EMPTY record (recorded, none fired), not a missing one', () => {
    const rec = runtimeAlertsOf(run([...head, 'plot(close, "x")', ''].join(NL)))
    expect(rec).not.toBe(null)
    expect(rec.events).toEqual([])
  })

  it('NOTHING the pane draws moves: the columns equal the same script with its alert() lines removed', () => {
    const body = ['f() =>', '    close * 2', 'v = ta.sma(close, 5)', 'if v > open',
      '    alert("sma over open")', 'if close < v', '    alert("c " + str.tostring(f()), alert.freq_all)',
      'plot(v, "x")', '']
    const withAlerts = run([...head, ...body].join(NL))
    const without = run([...head, ...body.filter((l) => !l.includes('alert('))].join(NL)
      .replace(/if v > open\n(?!\s)/, '').replace(/if close < v\n(?!\s)/, ''))
    expect(withAlerts.x).toEqual(without.x)
    expect(Object.keys(withAlerts)).toEqual(Object.keys(without))
  })

  it('the builtin is internal (no script can spell it) and the log is capped, newest kept, the rest counted', () => {
    expect(ALERT_EMIT).toMatch(/ /)
    beginAlertLog()
    for (let i = 0; i < ALERT_LOG_CAP + 7; i += 1) alertEmit('m'.repeat(ALERT_MESSAGE_CAP + 10), 'alert.freq_all', i, 0)
    const log = takeAlertLog()
    expect(log.events.length).toBe(ALERT_LOG_CAP)
    expect(log.dropped).toBe(7)
    expect(log.events[0].bar).toBe(7)
    expect(log.events[0].message.length).toBe(ALERT_MESSAGE_CAP)
    expect(takeAlertLog()).toBe(null)
    alertEmit('after', 'x', 1, 0) // no log begun: nothing is kept
    expect(takeAlertLog()).toBe(null)
  })
})
