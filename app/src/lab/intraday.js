// Intraday helpers for the workbench: the regular session in ET, bars grouped by ET day, and a daily candle that
// FORMS from its intraday closes (the owner, round 5: "tick by tick so each day has multiple ticks, using each 30
// min or hourly close to show how every day moved").
const fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })

export const etDay = (t) => fmtDay.format(new Date(t * 1000))
export const etTime = (t) => fmtTime.format(new Date(t * 1000))
export const etLabel = (t) => new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

/** Keep the regular session only: 09:30 up to (not including) 16:00 ET. The vendor's 16:00 bar is a stray closing
 *  print (one bar at an off price with the auction volume), not the session's close; the daily bar carries that. */
export function regularSession(bars) {
  return (bars || []).filter((b) => { const hm = etTime(b.t); return hm >= '09:30' && hm < '16:00' })
}

/** { 'YYYY-MM-DD': [bars...] } by ET day, session bars only. */
export function byDay(bars) {
  const out = {}
  for (const b of regularSession(bars)) { const d = etDay(b.t); (out[d] = out[d] || []).push(b) }
  return out
}

/** The daily candle as it stood after tick k (0-based) of that day's intraday bars. */
export function forming(dayT, ticks, k) {
  const upto = ticks.slice(0, k + 1)
  return { t: dayT, o: upto[0].o, h: Math.max(...upto.map((x) => x.h)), l: Math.min(...upto.map((x) => x.l)), c: upto[upto.length - 1].c, v: upto.reduce((s, x) => s + (x.v || 0), 0) }
}

/** Resample intraday bars to a coarser step (e.g. 30-minute to hourly) by ET clock, within a day. */
export function resample(bars, minutes) {
  const out = []
  for (const b of regularSession(bars)) {
    const key = Math.floor(b.t / (minutes * 60)) * (minutes * 60)
    const last = out[out.length - 1]
    if (last && last.t === key && etDay(last.t) === etDay(b.t)) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v || 0 }
    else out.push({ t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })
  }
  return out
}
