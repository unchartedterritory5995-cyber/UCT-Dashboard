// Every chart's timeframe per colour group (2026-11-19).
//
// `groupTfs` (ChartsWorkspace) holds ONE timeframe per colour: with a daily and an hourly chart on the
// same colour (the owner's scan: both linked to one watchlist) the last chart to publish won, and the
// list warmed only that timeframe. Production flip proof of that board (S&P 500, D + 60m, 0.8 s a row):
// the warmed chart's data was there in 9 ms, the other one's waited 501 ms at every flip (both on
// screen: median 633 ms). Each chart REGISTERS its timeframe here and a linked list warms all of them.
//
// createGroupTfRegistry(onChange): `register(color, id, tf)` returns the unregister function;
// `onChange(sets)` receives { colour: sorted unique timeframes } whenever that changes (only then).
export function createGroupTfRegistry(onChange) {
  const regs = new Map()          // colour -> Map(id -> tf)
  let last = {}
  const same = (a, b) => {
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && kb.every((c) => a[c] && a[c].join() === b[c].join())
  }
  const publish = () => {
    const next = {}
    for (const [c, m] of regs) { const tfs = [...new Set(m.values())].sort(); if (tfs.length) next[c] = tfs }
    if (same(last, next)) return
    last = next
    onChange(next)
  }
  return {
    register(color, id, tf) {
      if (!color || !id || !tf) return () => {}
      let m = regs.get(color)
      if (!m) regs.set(color, (m = new Map()))
      m.set(id, tf)
      publish()
      let done = false
      return () => {
        if (done) return
        done = true
        const cur = regs.get(color)
        if (cur && cur.get(id) === tf) { cur.delete(id); if (!cur.size) regs.delete(color) }
        publish()
      }
    },
    sets: () => last,
  }
}
