// app/src/components/chart/lazyTimeIndex.js
//
// A bar-time -> bar-index lookup that is built the first time it is ASKED, not when it is made.
//
// The drawing overlay kept `new Map(bars.map((b, i) => [b.t, i]))` in a `useMemo` keyed on `bars`, so the
// whole map was rebuilt in the render of every symbol switch and every live tick, for each chart on the
// board (key-press CPU profile, 2026-11-20: about 0.5 ms per chart per switch, inside the render that
// carries the new candles to the screen). Its readers are the anchored-VWAP and measure renderers, the
// magnet snap and the off-series fallback of a drawing's x: none of them runs for a chart with no such
// drawing and no pointer over it, which is most of the rows a member scans past.
//
// The answers are the ones the Map gave: the LAST index holding a time wins, a time no bar holds is
// `undefined`. Only `get` exists because only `get` was ever called.

/**
 * @param {Array<{t: (string|number)}>|null|undefined} bars
 * @returns {{ get: (time: (string|number)) => (number|undefined) }}
 */
export function lazyTimeIndex(bars) {
  let map = null
  return {
    get(time) {
      if (map === null) {
        map = new Map()
        // the same statement the eager memo ran, so the two cannot differ on any input
        bars?.forEach((b, i) => map.set(b.t, i))
      }
      return map.get(time)
    },
  }
}
