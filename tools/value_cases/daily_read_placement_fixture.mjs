// tools/value_cases/daily_read_placement_fixture.mjs
//
// ⭐⭐ U-DAILY (e96, part A) — THE PLACEMENT OF A DAILY READ, WRITTEN BY THE ONE AUTHORITY.
//
// A daily read (`tf(x, 'D')` on a chart below a day) shows on each chart bar THE LAST FINISHED DAY. Which daily bar a
// chart bar shows is decided by the chart's own projection, `app/src/components/chart/engine/mtfProjection.js::
// projectFrameColumns` (the rule a whole indicator calculated on daily bars is drawn by). The server's twin,
// `api/services/ast_interpret.py::daily_read_placement`, is asserted equal to what THIS script writes
// (`tests/test_ast_daily_read.py`); nobody types an expected placement by hand, in either language.
//
//   node tools/value_cases/daily_read_placement_fixture.mjs --write   # (re)writes tests/fixtures/ast/daily_read_placement.json
//   node tools/value_cases/daily_read_placement_fixture.mjs --print   # the same JSON on stdout (the check reads it)
//
// The cases are the shapes a daily placement can get wrong: a session's bars across a daylight-saving change, a market
// holiday, a half day, daily bars that skip a day the chart has (behind: the chart's previous day is the witness), daily
// bars that start after the chart (the first days read nothing), a newest daily bar not proven finished, and the three
// ways a bar time is spelled (unix seconds, unix milliseconds, YYYYMMDD and ISO dates). No market data: the times are
// built here, the values are the daily bar indices.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const OUT = path.join(ROOT, 'tests', 'fixtures', 'ast', 'daily_read_placement.json')
const { projectFrameColumns } = await import(pathToFileURL(path.join(ROOT, 'app', 'src', 'components', 'chart',
  'engine', 'mtfProjection.js')).href)

/** Unix seconds of a New York wall time: `isoDay` 'YYYY-MM-DD', minutes after midnight, the day's UTC offset (hours). */
const nyWall = (isoDay, minute, offsetHours) => Date.parse(`${isoDay}T00:00:00Z`) / 1000 + minute * 60 + offsetHours * 3600

/** A session's bars: every `tf` minutes from 09:30 to the close (`closeMinute`), New York time. */
function session(isoDay, tf, offsetHours, closeMinute = 16 * 60) {
  const out = []
  for (let m = 9 * 60 + 30; m < closeMinute; m += tf) out.push(nyWall(isoDay, m, offsetHours))
  return out
}

/** Weekdays from `from` to `to` inclusive, ISO, skipping `holidays`. */
function weekdays(from, to, holidays = []) {
  const out = []
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86400000) {
    const d = new Date(t)
    const iso = d.toISOString().slice(0, 10)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.includes(iso)) out.push(iso)
  }
  return out
}

/** New York's UTC offset on `iso` for 2026 (EDT from 8 March, EST before): enough for the days these cases use. */
const offsetOf = (iso) => (iso >= '2026-03-08' && iso < '2026-11-01' ? 4 : 5)

function chartOf(days, tf, { halfDays = {}, spell = (t) => t } = {}) {
  const out = []
  for (const d of days) for (const t of session(d, tf, offsetOf(d), halfDays[d] || 16 * 60)) out.push(spell(t))
  return out
}

const ymd = (iso) => Number(iso.replace(/-/g, ''))

function place(name, why, chartTf, chartTimes, frameTimes, newestFinal) {
  const chartBars = chartTimes.map((t) => ({ t }))
  const frameBars = frameTimes.map((t) => ({ t }))
  const idx = Float64Array.from(frameBars, (_b, j) => j)
  const p = projectFrameColumns(frameBars, { v: idx }, 'D', chartBars, chartTf, { newestFinal })
  const at = Array.from(p.columns.v, (v) => (Number.isFinite(v) ? v : -1))
  return { name, why, chartTf, newestFinal, chartTimes, frameTimes, at, stale: p.stale }
}

export function buildFixture() {
  const jan = weekdays('2026-01-12', '2026-01-23', ['2026-01-19'])           // MLK day closed
  const dst = weekdays('2026-03-04', '2026-03-12')                            // the spring clock change, 8 March
  const thanksgiving = weekdays('2025-11-24', '2025-12-02', ['2025-11-27'])  // Thanksgiving closed, the 28th a half day
  const before = weekdays('2025-12-29', '2026-01-23', ['2026-01-01', '2026-01-19'])
  const cases = [
    place('five-minute, a holiday, every daily bar final', 'each bar of a day shows the day before it (the holiday has no '
      + 'bar on either side, so the Tuesday after it shows the Friday)', '5', chartOf(jan, 5), before, true),
    place('five-minute, the clock change', 'the New York date decides, whatever the UTC offset', '5', chartOf(dst, 5),
      weekdays('2026-02-02', '2026-03-12'), true),
    place('five-minute, a half day', 'the half day\'s 13:00 close ends its bars; the day after shows the half day',
      '5', chartOf(thanksgiving, 5, { halfDays: { '2025-11-28': 13 * 60 } }).map((t) => t), weekdays('2025-11-03',
        '2025-12-02', ['2025-11-27']), true),
    place('sixty-minute bars, milliseconds', 'a bar time in milliseconds is the same instant', '60',
      chartOf(jan, 60, { spell: (t) => t * 1000 }), before, true),
    place('daily bars spelled YYYYMMDD', 'the store\'s daily key reads as its date', '15', chartOf(jan, 15),
      before.map(ymd), true),
    place('the daily bars skip a day the chart has', 'from the day after the missing one the daily bars are BEHIND '
      + '(the chart\'s previous day is the witness): nothing is shown, and stale is said', '30', chartOf(jan, 30),
      before.filter((d) => d !== '2026-01-15'), true),
    place('the daily bars start after the chart', 'a chart bar whose finished day is before the first daily bar shows '
      + 'nothing', '5', chartOf(jan, 5), weekdays('2026-01-14', '2026-01-23', ['2026-01-19']), true),
    place('the newest daily bar is today\'s, not proven final', 'today\'s bars show yesterday, which is final; the newest '
      + 'daily bar (today\'s, forming) is shown on no bar', '5', chartOf(jan.slice(-3), 5), before, false),
    place('the newest daily bar is yesterday\'s, not proven final', 'today\'s bars would show the newest daily bar, which '
      + 'is not proven finished: nothing is shown, and stale is said', '5', chartOf(jan.slice(-3), 5),
      before.slice(0, -1), false),
  ]
  return {
    schema: 'uct.daily-read-placement/v1',
    generatedBy: 'tools/value_cases/daily_read_placement_fixture.mjs (mtfProjection.projectFrameColumns, frame D)',
    about: 'WRITTEN by the JS authority, never by hand. Each case: the chart bar times, the daily bar times, and `at`, '
      + 'the daily bar each chart bar shows (-1: none). ast_interpret.daily_read_placement is asserted equal to it.',
    cases,
  }
}

const text = () => `${JSON.stringify(buildFixture(), null, 1)}\n`
if (process.argv.includes('--write')) fs.writeFileSync(OUT, text())
if (process.argv.includes('--print')) process.stdout.write(text())
