// The date step's arithmetic (rig.mjs --go-to-date), on its own so it has a rail: `node rig_dates.mjs --self-check`.
// Importing this file runs nothing; importing rig.mjs runs a pass (never import rig.mjs to test it).

/** M/D/YYYY -> the asked ET day as 'YYYY-MM-DD' and its UTC-midnight seconds (a day's bars sit inside [s, s + 1 day + 6 h)). */
export function dateCoverOf(mdy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(mdy || '').trim())
  if (!m) return null
  const day = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return { day, s: Date.UTC(+m[3], +m[1] - 1, +m[2]) / 1000 }
}
/** A chart time ('YYYY-MM-DD', {year, month, day}, or epoch seconds) as the ET-ish day string, or null. */
export function dayOf(t) {
  if (t == null) return null
  if (typeof t === 'string') return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null
  if (typeof t === 'object' && t.year) return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
  if (typeof t === 'number' && Number.isFinite(t)) return new Date((t - 5 * 3600) * 1000).toISOString().slice(0, 10)
  return null
}
/** Does a visible time range ({from, to}) reach the asked day? Intraday: the day's session overlaps the view. */
export function viewCovers(v, want) {
  if (!v || !want || v.from == null || v.to == null) return false
  if (typeof v.from === 'number') return v.from < want.s + 86400 + 6 * 3600 && v.to >= want.s
  const a = dayOf(v.from), b = dayOf(v.to)
  return !!(a && b && a <= want.day && want.day <= b)
}
/**
 * A symbol that LISTED after the asked date has no bar there; the chart frames its earliest bars. That counts only when
 * (1) the view MOVED from the one before Enter (the newest bar left it), unless the whole history already fitted;
 * (2) the view sits at the first bar (logical <= 0.5) and that bar is after the asked day;
 * (3) that first bar IS the symbol's earliest by the product's DEEP sources (`earliest`: {t, exhausted, source}, the
 *     minimum over them: D/W/M /api/bars-history, intraday the history lake's index), never the live /api/bars window
 *     a chart can be stuck on.
 * The whole-history-fitted exemption from (1) holds only when the deep source says the history is EXHAUSTED.
 * A chart that loaded SHORT history and never moved meets (2) alone at the present; (1) and (3) refuse it.
 */
export function viewBeforeListing(v, want, before, earliest) {
  if (!v || !want || !v.lr || v.from == null || !(v.lr.from <= 0.5)) return false
  const first = dayOf(v.from)
  if (!first || !(first > want.day)) return false
  const fitted = !!(before && before.lr && before.lr.from <= 0.5 && Number.isFinite(before.ni) && before.lr.to >= before.ni - 0.5)
  const moved = !!(before && before.lr && Number.isFinite(v.ni) && (v.lr.to < v.ni - 0.5) && (before.lr.to >= before.ni - 0.5))
  const e = earliest && typeof earliest === 'object' ? earliest : null
  if (!e || e.t == null) return false
  if (!(moved || (fitted && e.exhausted === true))) return false
  return dayOf(e.t) === first
}

/**
 * The deep daily store's answer (/api/bars-history, read in the page: {ok, sealed, partial, header, first, n, want}) as a
 * source: only a SEALED, non-partial answer counts. When the worker's deep origin does not answer, the route serves the
 * web's own shallow store marked `partial: true` / `X-Bars-History: partial`; its first bar is recent and must never
 * read as the symbol's earliest (in that outage a chart's short history would pass as 'earliest-bars').
 */
export function dailySource(a) {
  const base = { source: 'bars-history', n: a && a.n }
  if (!a || a.ok !== true || a.sealed !== true || a.partial || a.header === 'partial' || a.first == null) {
    return { ...base, t: null, refused: !a ? 'no answer' : a.ok !== true ? 'not ok' : a.partial || a.header === 'partial' ? 'partial' : a.sealed !== true ? 'not sealed' : 'no rows' }
  }
  return { ...base, t: a.first, exhausted: Number.isFinite(a.n) && Number.isFinite(a.want) && a.n > 0 && a.n < a.want }
}

/** The earliest bar over the deep sources ({t, exhausted, source}[]): the oldest one that answered, or null. */
export function deepEarliest(list) {
  const got = (list || []).filter((x) => x && x.t != null && dayOf(x.t))
  if (!got.length) return null
  got.sort((a, b) => (dayOf(a.t) < dayOf(b.t) ? -1 : dayOf(a.t) > dayOf(b.t) ? 1 : 0))
  return got[0]
}
/** The history lake's series for an intraday timeframe (custom 2h / 4h read the 60m series, 45m the 15m), or null. */
export function lakeSeriesFor(tf) {
  const s = String(tf)
  if (['1', '5', '15', '30', '60'].includes(s)) return s
  if (s === '120' || s === '240') return '60'
  if (s === '45') return '15'
  return null
}

export function selfCheck() {
  const w = dateCoverOf('1/3/2006')
  const ok = (c, m) => { if (!c) throw new Error(`rig_dates self-check: ${m}`) }
  ok(w.day === '2006-01-03' && dateCoverOf('bad') === null && dateCoverOf('6/14/2016').day === '2016-06-14', 'dateCoverOf')
  ok(!viewCovers({ from: '2026-05-29', to: '2026-12-08' }, w), 'the present does not cover 2006')
  ok(viewCovers({ from: '2005-08-01', to: '2006-01-03' }, w), 'a day range that holds it')
  ok(viewCovers({ from: { year: 2005, month: 8, day: 1 }, to: { year: 2006, month: 1, day: 3 } }, w), 'business-day objects')
  ok(!viewCovers({ from: 1795438800, to: 1795788000 }, w) && viewCovers({ from: 1135782000, to: 1136304000 }, w), 'intraday seconds')
  const present = { from: '2026-05-29', to: '2026-12-08', lr: { from: 1282, to: 1413.6 }, ni: 1407 }
  const qfin = { from: '2018-12-14', to: '2019-06-26', lr: { from: -0.08, to: 131.5 }, ni: 1998 }
  const deep = (t, exhausted = true) => ({ t, exhausted, source: 'bars-history' })
  ok(viewBeforeListing(qfin, w, present, deep('2018-12-14')), 'a jump to a symbol that listed later lands at its first bar')
  ok(!viewBeforeListing(qfin, w, present, deep('2015-03-02')), 'a first bar later than the DEEP earliest (stuck on the live window) is refused')
  ok(!viewBeforeListing(qfin, w, present, null) && !viewBeforeListing(qfin, w, present, { t: null }), 'no independent earliest: refused')
  // the blocker: short history, the view never moved, at the present (its first bar in view, newest in view)
  const short = { from: '2025-11-20', to: '2026-12-08', lr: { from: 0, to: 260 }, ni: 255 }
  ok(!viewBeforeListing(short, w, { ...short, lr: { from: 40, to: 260 } }, deep('2025-11-20')), 'a view still showing its newest bar did not jump')
  ok(viewBeforeListing({ ...short, lr: { from: 0, to: 260 } }, w, short, deep('2025-11-20')) === true, 'whole history fitted before, deep source exhausted: no move needed')
  ok(!viewBeforeListing({ ...short, lr: { from: 0, to: 260 } }, w, short, deep('2025-11-20', false)), 'fitted, but the deep source is not exhausted: refused')
  ok(!viewBeforeListing({ from: '2005-12-01', to: '2006-06-01', lr: { from: 0, to: 120 }, ni: 5000 }, w, present, deep('2005-12-01')), 'a first bar before the date is a cover question, not a listing one')
  ok(deepEarliest([{ t: '2016-02-01', exhausted: false, source: 'bars' }, { t: '2010-05-03', exhausted: true, source: 'bars-history' }]).t === '2010-05-03', 'the minimum over the sources')
  ok(deepEarliest([{ t: null, source: 'lake' }]) === null, 'no source answered: no earliest')
  const ans = (o) => ({ ok: true, sealed: true, partial: false, header: null, first: '2010-05-03', n: 4000, want: 12500, ...o })
  ok(dailySource(ans()).t === '2010-05-03' && dailySource(ans()).exhausted === true, 'a sealed answer is a source')
  ok(dailySource(ans({ partial: true })).t === null && dailySource(ans({ partial: true })).refused === 'partial', 'a partial answer (the shallow fallback) is refused')
  ok(dailySource(ans({ header: 'partial' })).t === null, 'the X-Bars-History: partial header is refused')
  ok(dailySource(ans({ sealed: false })).t === null && dailySource(ans({ ok: false })).t === null && dailySource(null).t === null, 'unsealed, not ok, no answer: refused')
  ok(dailySource(ans({ n: 12500 })).exhausted === false, 'a full page is not exhausted')
  ok(!viewBeforeListing(qfin, w, present, deepEarliest([dailySource(ans({ partial: true, first: '2018-12-14' }))])), 'in an outage the shallow answer never accepts earliest bars')
  ok(lakeSeriesFor('240') === '60' && lakeSeriesFor('45') === '15' && lakeSeriesFor('5') === '5' && lakeSeriesFor('D') === null, 'intraday lake series per timeframe')
  return 'rig_dates self-check: ok (covers: day strings, business-day objects, seconds; earliest bars need a move and the DEEP earliest; fitted only when exhausted)'
}

if (process.argv.includes('--self-check') && String(process.argv[1] || '').endsWith('rig_dates.mjs')) {
  console.log(selfCheck())
}
