// app/src/components/chart/engine/ast/htfCalendarMerge.test.js
//
// ─── ⭐⭐ U-HTF-CALENDAR — A SHORT PERIOD BEFORE TRADINGVIEW'S EXCHANGE CALENDAR CLOSES ON THE NEXT BAR ───
//
// `tfMergeReads` (the run's supply pick and the host's `tf_merge` arm) showed every completed week and month on its
// LAST session. TradingView does that only from 2000: before it, a SHORT period (its last session is not the
// period's last weekday) is shown one bar later, and so is the week of 10 Sep 2001 (closed without notice).
// Measured on Q-HTF-CAL-1a / 1b; the rule and its numbers are in `interpret.js` above `htfClosesOnNextBar`.
// Pinned here: the hand-written cases, each passed by that rule only, and TradingView's own weekly and monthly
// close with look-ahead off (A02 / A05) on every bar of both committed captures.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { interpret, TF_MERGE, htfClosesOnNextBar } from './interpret'
import { TRADINGVIEW_CLOSURES_FROM, TRADINGVIEW_UNAPPLIED_CLOSURES } from '../../../../lib/marketClock/tradingViewSession.js'

const CLOSE = { type: 'series', name: 'close' }
const merge = (code) => ({ type: TF_MERGE, value: code, args: [CLOSE] })
const col = (tree, bars) => Array.from(interpret(tree, bars, {}, undefined, undefined, { tf: 'D', historyFromListing: true }))
  .map((v) => (Number.isFinite(v) ? v : null))
// closes are 1..n in date order, so a value names the bar whose close it is
const barsOn = (dates) => dates.map((t, i) => ({ t, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1, v: 100 }))

describe('htfClosesOnNextBar — the rule, case by case', () => {
  it("it reads TradingView's own session calendar: closures applied from 2000, not 11-14 September 2001", () => {
    expect(TRADINGVIEW_CLOSURES_FROM).toBe('2000-01-01')
    expect(TRADINGVIEW_UNAPPLIED_CLOSURES.map((e) => e.date)).toContain('2001-09-14')
    expect(htfClosesOnNextBar('2012-10-26', 'W')).toBe(false)   // the Friday before Hurricane Sandy: a full week
  })
  it('a week whose last session is not a Friday, before 2000: the next bar', () => {
    expect(htfClosesOnNextBar('1999-04-01', 'W')).toBe(true)    // Good Friday 1999
    expect(htfClosesOnNextBar('1999-12-23', 'W')).toBe(true)    // 24 Dec 1999 closed
    expect(htfClosesOnNextBar('1999-04-09', 'W')).toBe(false)   // a Friday: a full week
  })
  it('from 2000 a short week closes on its last bar, except the week of 10 Sep 2001', () => {
    expect(htfClosesOnNextBar('2000-04-20', 'W')).toBe(false)   // Good Friday 2000
    expect(htfClosesOnNextBar('2004-06-10', 'W')).toBe(false)   // 11 Jun 2004 closed, in the calendar
    expect(htfClosesOnNextBar('2001-09-10', 'W')).toBe(true)
  })
  it('a month whose last weekday held no session, before 2000: the next bar', () => {
    expect(htfClosesOnNextBar('1999-05-28', 'M')).toBe(true)    // Memorial Day 31 May 1999
    expect(htfClosesOnNextBar('1999-04-30', 'M')).toBe(false)   // its last weekday
    expect(htfClosesOnNextBar('2004-05-28', 'M')).toBe(false)   // Memorial Day 2004, after the calendar
    expect(htfClosesOnNextBar('1999-07-30', 'M')).toBe(false)   // Friday; the 31st is a Saturday
  })
})

describe('tf_merge on hand-written dates: the short period moves one bar, nothing else does', () => {
  it('weekly: Good Friday 1999 shows on the next Monday; a full week and Good Friday 2000 on their last bar', () => {
    const D = [
      '1999-03-22', '1999-03-23', '1999-03-24', '1999-03-25', '1999-03-26',   // full week, closes Fri (close 5)
      '1999-03-29', '1999-03-30', '1999-03-31', '1999-04-01',                 // Good Friday week (close 9)
      '1999-04-05', '1999-04-06',
      '2000-04-17', '2000-04-18', '2000-04-19', '2000-04-20',                 // Good Friday 2000 (close 15)
      '2000-04-24', '2000-04-25',
    ]
    const c = col(merge('W'), barsOn(D))
    expect(c[D.indexOf('1999-03-26')]).toBe(5)        // a full week: its own Friday
    expect(c[D.indexOf('1999-04-01')]).toBe(5)        // ⭐ the short week's Thursday still reads the week before
    expect(c[D.indexOf('1999-04-05')]).toBe(9)        // ...and the next Monday reads it
    expect(c[D.indexOf('2000-04-20')]).toBe(15)       // from 2000: its own Thursday
    expect(c[D.indexOf('2000-04-24')]).toBe(15)
  })
  it('the week of 10 Sep 2001 shows on 17 Sep', () => {
    const D = ['2001-09-04', '2001-09-05', '2001-09-06', '2001-09-07', '2001-09-10', '2001-09-17', '2001-09-18']
    const c = col(merge('W'), barsOn(D))
    expect(c[D.indexOf('2001-09-07')]).toBe(4)
    expect(c[D.indexOf('2001-09-10')]).toBe(4)        // ⭐ not its own close (5)
    expect(c[D.indexOf('2001-09-17')]).toBe(5)
  })
  it('monthly: May 1999 (Memorial Day the 31st) shows on 1 June; May 2004 on its last bar', () => {
    const D = ['1999-04-29', '1999-04-30', '1999-05-27', '1999-05-28', '1999-06-01', '1999-06-02',
      '2004-04-29', '2004-04-30', '2004-05-27', '2004-05-28', '2004-06-01', '2004-06-02']
    const c = col(merge('M'), barsOn(D))
    expect(c[D.indexOf('1999-04-30')]).toBe(2)
    expect(c[D.indexOf('1999-05-28')]).toBe(2)        // ⭐ still April's
    expect(c[D.indexOf('1999-06-01')]).toBe(4)
    expect(c[D.indexOf('2004-05-28')]).toBe(10)       // from 2000: its own last bar
    expect(c[D.indexOf('2004-06-01')]).toBe(10)
  })
})

describe('⭐⭐ TradingView\'s own A02 / A05 on every bar of Q-HTF-CAL-1a / 1b', () => {
  const DIR = path.resolve(process.cwd(), '../tests/fixtures/vendor/harness')
  for (const id of ['vw-request-htf-alignment-spy-1d-2026-11-18', 'vw-request-htf-alignment-qqq-1d-2026-11-18']) {
    const cap = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'))
    const rows = cap.bars.rows
    const bars = rows.map((r) => ({ t: new Date(r[0] * 1000).toISOString().slice(0, 10), o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
    const fields = cap.plotValues.fields
    const titles = Object.fromEntries(cap.study.plots.map((p) => [p.id, p.title]))
    const byT = new Map(cap.plotValues.rows.map((r) => [r[0], r]))
    const tv = (title) => {
      const k = fields.findIndex((f) => titles[f] === title)
      return rows.map((r) => { const v = (byT.get(r[0]) || [])[k]; return Number.isFinite(v) ? v : null })
    }
    for (const [code, title] of [['W', 'A02_close_W_lookahead_OFF'], ['M', 'A05_close_M_lookahead_OFF']]) {
      it(`${id}: tf_merge ${code} equals TradingView's ${title} on every bar but the newest`, () => {
        const ours = col(merge(code), bars)
        const want = tv(title)
        let compared = 0
        for (let i = 0; i < rows.length - 1; i += 1) {
          expect(ours[i], `bar ${i} (${bars[i].t})`).toBe(want[i])
          if (want[i] !== null) compared += 1
        }
        expect(compared).toBeGreaterThan(rows.length - 30)
      })
    }
  }
})
