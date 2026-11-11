// BarStore diff renderer (P2, BARSTORE-SPEC "diffRenderer.js"). NOT WIRED yet.
//
// ⭐ THE ONLY PLACE THAT WILL CALL series.setData / series.update (census rail R1 once P3
// lands). It turns a sequence of adapter results (adapter.toSeries) into the MINIMAL
// correct LWC calls:
//   R1  setData only when (key, baseRev, viewTransformId) changed AND the change is not
//       expressible incrementally. A devRev-only change never setData()s.
//   R2  update() only at a time ≥ the last painted time (LWC's own rule — an older time
//       throws "Cannot update oldest data"); the developing bar rides this path.
//   R3  A changed OLDER bar (a correction) is painted with update(p, true) — LWC 5's
//       historical update — ONLY when the series already holds that time and at most
//       MAX_HISTORICAL_UPDATES points changed; anything else is a full setData.
//   R4  An append (seal of the developing bar, new sealed bars) is a run of update()s.
//   R5  A left prepend (deep history) is a setData + framing K2 (right edge unchanged).
//   R6  A key change (symbol / tf / session) is setData + framing K1 in the same call;
//       an EMPTY key change holds the outgoing frame (framing K4).
// Every decision is made BEFORE any call is issued, so a fallback never leaves a
// half-applied incremental on screen.

import { composePoints } from './adapter'
import { frameAfterKeyChange, frameAfterPrepend, indexOfTime } from './framing'

export const MAX_HISTORICAL_UPDATES = 4

function pointEqual(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}
const before = (a, b) => a < b   // chart times are all numbers or all 'YYYY-MM-DD' strings

/** base[from..] joined with tail — the painted/desired suffix without copying the head. */
function suffixOf(base, tail, from) {
  return composePoints(base.slice(from), tail || [])
}

function prefixEqual(oldB, newB) {
  if (newB.length < oldB.length) return false
  for (let i = 0; i < oldB.length; i++) if (!pointEqual(oldB[i], newB[i])) return false
  return true
}
// A left prepend is judged by TIMES: the old series' times are exactly the new series'
// newest times. Values may legitimately differ (Heikin-Ashi re-seeds from the new first
// bar), which a setData repaints anyway — the framing rule K2 depends only on the times.
function suffixTimesEqual(oldB, newB) {
  const d = newB.length - oldB.length
  if (d <= 0 || !oldB.length) return false
  for (let i = 0; i < oldB.length; i++) if (oldB[i].time !== newB[i + d].time) return false
  return true
}
function sameTimes(oldB, newB) {
  if (oldB.length !== newB.length) return -1
  let first = -1
  for (let i = 0; i < oldB.length; i++) {
    if (oldB[i].time !== newB[i].time) return -1
    if (first < 0 && !pointEqual(oldB[i], newB[i])) first = i
  }
  return first < 0 ? oldB.length : first
}

/**
 * Plan the calls that turn `painted` (a suffix the series holds) into `desired`, given the
 * last painted time. Returns an op list, or null when only a setData is correct.
 */
function planSuffix(painted, desired, lastTime) {
  const held = new Map(painted.map(p => [p.time, p]))
  const want = new Set(desired.map(p => p.time))
  for (const t of held.keys()) if (!want.has(t)) return null   // a painted point must vanish
  const ops = []
  let last = lastTime
  let hist = 0
  for (const d of desired) {
    const p = held.get(d.time)
    if (p && pointEqual(p, d)) continue
    if (last == null || !before(d.time, last)) { ops.push([d, false]); last = d.time; continue }
    // R3 guard. ⛔ LWC 5.2's update(p, true) on a time the series does NOT hold does not
    // throw — it overwrites the wrong row (integrator review of the 5.2 source). This check
    // is the only protection, so a time that is not held is always a full setData.
    if (!p || ++hist > MAX_HISTORICAL_UPDATES) return null
    ops.push([d, true])
  }
  return ops
}

/** One series' painter. `paint` returns { op, calls, keyChange, added?, n }. */
export function createSeriesPainter(series) {
  let st = null   // { key, frameId, vtid, baseRev, base, tail, lastTime, n }
  const lastTimeOf = (base, tail) => (tail?.length ? tail[tail.length - 1].time : base.length ? base[base.length - 1].time : null)
  const countOf = (base, tail) => composePoints(base, tail || []).length

  function commit(input, base, tail) {
    st = { key: input.key, frameId: input.frameId, vtid: input.vtid, baseRev: input.baseRev, base, tail, lastTime: lastTimeOf(base, tail), n: countOf(base, tail) }
  }
  function setData(input, base, tail, op, extra = {}) {
    series.setData(composePoints(base, tail))
    const keyChange = !st || st.frameId !== input.frameId
    commit(input, base, tail)
    return { op, calls: 1, keyChange, n: st.n, ...extra }
  }
  function run(ops) {
    for (const [p, historical] of ops) {
      if (historical) series.update(p, true)
      else series.update(p)
    }
  }

  return {
    get state() { return st },
    reset() { st = null },
    paint(input, { allowEmpty = false } = {}) {
      const base = input.base || []
      const tail = input.tail || []
      const empty = !base.length && !tail.length
      if (!st || st.frameId !== input.frameId || st.vtid !== input.vtid) {
        // R6 / K4: never trade a painted frame for a blank one on a key change.
        if (empty && st && st.n > 0 && !allowEmpty && st.frameId !== input.frameId) return { op: 'hold', calls: 0, keyChange: false, n: st.n }
        return setData(input, base, tail, 'setData')
      }
      let from
      let op = 'tail'
      if (st.baseRev !== input.baseRev) {
        const old = st.base
        if (prefixEqual(old, base)) { from = Math.max(0, old.length - 1); op = base.length > old.length ? 'append' : 'tail' }
        else if (suffixTimesEqual(old, base)) return setData(input, base, tail, 'prepend', { added: base.length - old.length })
        else {
          const i = sameTimes(old, base)
          if (i < 0) return setData(input, base, tail, 'rebase')
          from = Math.min(i, Math.max(0, old.length - 1)); op = 'correct'
        }
      } else {
        from = Math.max(0, base.length - 1)
      }
      const ops = planSuffix(suffixOf(st.base, st.tail, from), suffixOf(base, tail, from), st.lastTime)
      if (!ops) return setData(input, base, tail, 'rebase')
      run(ops)
      commit(input, base, tail)
      return { op: ops.length ? op : 'noop', calls: ops.length, keyChange: false, n: st.n }
    },
  }
}

/**
 * The chart's renderer: candle (or line) + volume + overlay series, and the framing
 * contract. `render(result)` takes an adapter.toSeries result.
 *   opts.candleField — 'candles' (OHLC types) | 'closes' (line/area)
 *   opts.allowEmpty  — paint an empty series on a key change (status 'unavailable')
 *   opts.overlays    — [{ id, series, input }] painted in the SAME call, before framing,
 *                      because their times join the time scale's logical index space
 *   opts.reserve     — seeded future slots right of the newest candle (framing K1)
 * plotWidthPx: number | () => number — the candle plot width (right-margin policy).
 *
 * Replay / HA / any view-transform change: a new vtid ⇒ one full setData per series and
 * NO reframe (the logical range is kept; only a key change reframes). Each replay step is
 * therefore one setData — today's behavior too.
 */
export function createDiffRenderer({ timeScale, candle, volume = null, defaultVisibleBars = null, plotWidthPx = null } = {}) {
  const main = createSeriesPainter(candle)
  const vol = volume ? createSeriesPainter(volume) : null
  const overlays = new Map()
  const idsOf = (r) => ({ key: r.key, frameId: r.frameId ?? `${r.key}|${r.tf}`, vtid: r.vtid, baseRev: r.baseRev })
  const paintOverlay = (id, series, input) => {
    let p = overlays.get(id)
    if (!p || p.series !== series) { p = { series, painter: createSeriesPainter(series) }; overlays.set(id, p) }
    return p.painter.paint(input, { allowEmpty: true })
  }

  return {
    render(result, { candleField = 'candles', allowEmpty = false, overlays: ovs = [], reserve = 0 } = {}) {
      const ids = idsOf(result)
      const hadFrame = !!main.state?.n
      const oldNewest = main.state?.lastTime ?? null
      let prevRange = null
      try { prevRange = timeScale?.getVisibleLogicalRange?.() ?? null } catch { prevRange = null }
      const prevNewestIdx = indexOfTime(timeScale, oldNewest)
      const c = main.paint({ ...ids, base: result.base[candleField], tail: result.tail[candleField] }, { allowEmpty })
      if (c.op === 'hold') return { candle: c, volume: null, overlays: [], held: true, range: null }
      const v = vol ? vol.paint({ ...ids, base: result.base.volume, tail: result.tail.volume }, { allowEmpty: true }) : null
      const o = ovs.map(({ id, series, input }) => paintOverlay(id, series, input))
      let range = null
      if (c.keyChange && c.n > 0) {
        // The newest candle's index FROM THE TIME SCALE: other series' times share the space.
        const newestIndex = indexOfTime(timeScale, main.state.lastTime) ?? c.n - 1
        const px = typeof plotWidthPx === 'function' ? plotWidthPx() : plotWidthPx
        range = frameAfterKeyChange({ newestIndex, prevRange: hadFrame ? prevRange : null, defaultVisibleBars, plotWidthPx: px, reserve })
      } else if (c.op === 'prepend') {
        const nowIdx = indexOfTime(timeScale, oldNewest)
        const shift = (prevNewestIdx != null && nowIdx != null) ? nowIdx - prevNewestIdx : c.added
        range = frameAfterPrepend(prevRange, shift)
      }
      if (range) timeScale.setVisibleLogicalRange(range)   // same call ⇒ same frame
      return { candle: c, volume: v, overlays: o, held: false, range }
    },
    /** Overlay hook outside a render (e.g. a live MA tick): same diff rules, own painter. */
    paintOverlay,
    removeOverlay(id) { overlays.delete(id) },
    reset() { main.reset(); vol?.reset(); overlays.clear() },
    get state() { return { candle: main.state, volume: vol?.state ?? null } },
  }
}
