// app/src/lib/minuteFrames/memorySink.js — an in-memory sink for the minute-frame rollup.
//
// The reference implementation of the sink contract (rollup.js header) and what the tests read.
// The device store (OPFS + Worker) will implement the same four methods over its append API.

/** bars: Map<`${sym}|${tf}`, Map<t, {t,o,h,l,c,v,partial?,final}>> */
export function createMemorySink() {
  const bars = new Map()
  const stale = []
  const gaps = []
  const resets = []
  const frames = []
  let upserts = 0
  return {
    upsert(sym, tf, bar, final) {
      upserts++
      const k = `${sym}|${tf}`
      let m = bars.get(k)
      if (!m) { m = new Map(); bars.set(k, m) }
      m.set(bar.t, { ...bar, final: !!final })
    },
    stale(sym, tf, t) { stale.push({ sym, tf, t }) },
    gap(info) { gaps.push({ ...info }) },
    reset(info) { resets.push(info); bars.clear() },
    frameDone(info) { frames.push(info) },
    /** The bars of (sym, tf) in time order. */
    series(sym, tf) { return [...(bars.get(`${sym}|${tf}`)?.values() || [])].sort((a, b) => a.t - b.t) },
    keys: () => [...bars.keys()],
    stale_: stale, gaps, resets, frames,
    get upserts() { return upserts },
  }
}
