// app/src/data/barStore/subscribeProbe.js — OPT-IN: what a chart's FIRST subscribe does to the entry it shows.
//
// (2026-11-26, the cold typed Enter) The trace of a cold typed Enter shows the chart's first subscribe (index._start ->
// persist.hydrate -> hydrateMem) changing the entry INSIDE the Enter task, after the first paint: the chart renders again,
// re-derives its frame and runs updateChart a second time (~8-10 ms). Unit reproductions (a mem copy, a device copy the
// lake joined, a local copy on the real chart) change only `source`, never the rows. So this records, on a real page,
// what the first subscribe changed: the snapshot fields, whether the rows array is a new one, and if so whether any row's
// VALUES differ or only its provenance (`src`). Read `window.__uctSubscribeProbe`.
// ⛔ OFF unless localStorage['uct.subscribeprobe'] === '1' (read once per page load): off, nothing is computed or kept.
export const SUBSCRIBE_PROBE_KEY = 'uct.subscribeprobe'
export const SUBSCRIBE_PROBE_MAX = 200
let _on = null
export function subscribeProbeOn() {
  if (_on !== null) return _on
  try { _on = typeof localStorage !== 'undefined' && localStorage.getItem(SUBSCRIBE_PROBE_KEY) === '1' } catch { _on = false }
  return _on
}
/** Tests: force the switch (null re-reads storage). */
export function __setSubscribeProbeForTests(v) { _on = v === null || v === undefined ? null : !!v }

const FIELDS = (s) => (s ? Object.keys(s) : [])
function shape(s) {
  if (!s) return null
  const bars = s.bars || []
  return {
    rows: bars.length, first: bars[0]?.t ?? null, last: bars.length ? bars[bars.length - 1].t : null,
    dev: s.developing ? s.developing.t : null, source: s.source ?? null, status: s.status ?? null, restSeen: !!s.restSeen,
    baseRev: s.baseRev ?? null, devRev: s.devRev ?? null, deviceRows: !!s.deviceRows, lakeOnly: !!s.lakeOnly,
    srcs: [...new Set(bars.map((b) => b.src))].join('/'),
  }
}
/** Rows that differ between two arrays of the same length: by value (t/o/h/l/c/v) and by provenance only (`src`). */
function rowDiff(a, b) {
  if (!a || !b || a === b) return null
  if (a.length !== b.length) return { lengths: [a.length, b.length] }
  let values = 0
  let srcOnly = 0
  let firstValue = null
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (x.t !== y.t || x.o !== y.o || x.h !== y.h || x.l !== y.l || x.c !== y.c || x.v !== y.v) {
      values++
      if (firstValue == null) firstValue = { i, t: x.t, before: [x.o, x.h, x.l, x.c, x.v], after: [y.o, y.h, y.l, y.c, y.v] }
    } else if (x.src !== y.src || x.rev !== y.rev || !!x.fin !== !!y.fin) srcOnly++
  }
  return { values, srcOnly, firstValue }
}

/** Record one phase of a key's first subscribe ('sync': right after the hydrate's synchronous half; 'hydrated': after
 *  the whole hydrate) against the entry as it was before it. Never throws. */
export function probeFirstSubscribe(key, before, after, phase) {
  if (!subscribeProbeOn() || typeof window === 'undefined') return
  try {
    const log = (window.__uctSubscribeProbe = window.__uctSubscribeProbe || [])
    const changed = before && after ? [...new Set([...FIELDS(before), ...FIELDS(after)])].filter((k) => before[k] !== after[k]) : null
    log.push({
      key, phase, at: typeof performance !== 'undefined' ? Math.round(performance.now() * 10) / 10 : null,
      sameSnapshot: before === after, sameBars: (before?.bars ?? null) === (after?.bars ?? null), changed,
      rows: rowDiff(before?.bars, after?.bars), before: shape(before), after: shape(after),
    })
    if (log.length > SUBSCRIBE_PROBE_MAX) log.splice(0, log.length - SUBSCRIBE_PROBE_MAX)
  } catch { /* a probe never breaks the store */ }
}
