// Test fixtures for the comparison panels (RRG / REL / CORR): synthetic close series on real
// weekday dates, built from a per-step return function so each test states the SHAPE it needs.
// Imported only by *.test.* files.

/** `n` consecutive weekdays from `start` (YYYY-MM-DD), as YYYY-MM-DD strings. */
export function weekdays(n, start = '2025-01-02') {
  const out = []
  const d = new Date(`${start}T12:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** `n` consecutive FRIDAYS from the first one on/after `start` -- the key a weekly bar carries
 *  (the equity store stamps a week by its ISO Friday, and `closesFromBars(_, {weekly})` re-keys
 *  every weekly bar to it, so a weekly fixture must hold ONE date per week). */
export function fridays(n, start = '2025-01-03') {
  const out = []
  const d = new Date(`${start}T12:00:00Z`)
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1)
  while (out.length < n) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return out
}

/** `[{d, c}]` where close[i] = close[i-1] × (1 + step(i)). */
export function series(dates, step, start = 100) {
  let c = start
  return dates.map((d, i) => {
    if (i > 0) c *= 1 + step(i)
    return { d, c }
  })
}

/** A deterministic, wiggly daily return (no RNG: tests must not flake). */
export const wiggle = (i, seed = 1) => 0.01 * Math.sin(i * 1.7 + seed) + 0.004 * Math.cos(i * 0.37 + seed * 2)

/** `/api/bars` payload shape for a `[{d, c}]` series. */
export function barsPayload(s) {
  return { ticker: 'X', bars: s.map((p) => ({ t: p.d, o: p.c, h: p.c, l: p.c, c: p.c, v: 1000 })) }
}

/** A `fetch` stand-in serving `/api/bars/{SYM}` from `bySym`; anything absent answers 404. */
export function fakeBarsFetch(bySym) {
  return (url) => {
    const m = String(url).match(/\/api\/bars\/([^?]+)/)
    const sym = m ? decodeURIComponent(m[1]) : null
    const s = sym ? bySym[sym] : null
    if (!s) return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'no data' }) })
    return Promise.resolve({ ok: true, status: 200, json: async () => barsPayload(s) })
  }
}
