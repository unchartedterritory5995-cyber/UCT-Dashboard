// A lightweight-charts stand-in for the BarStore renderer tests. Its TIME SCALE is the one
// StockChart.tfSwitchPinned.test.jsx uses (ported verbatim in behaviour, extracted so it
// is importable — that file's copy lives inside its vi.mock factory and is untouched):
//   • logical index space = the sorted union of every series' times
//   • rightOffset is measured from the last REAL (non-whitespace) bar
//   • a bar appended on the right keeps rightOffset when shiftVisibleRangeOnNewBar is on
//     (the frame slides) — and when it is off the view stays put
//   • update() at a time older than the series' last throws, like LWC
// Added for the renderer: timeToIndex, setData's ascending-unique assertion, update(p, true)
// (LWC 5 historical update: on a time the series lacks it overwrites the wrong row and sets
// `corrupted`, as real LWC does silently) and a call log per series.

export const PLOT_W = 600

export function createFakeChart({ width = PLOT_W } = {}) {
  const series = []
  const ts = { points: [], base: null, rightOffset: 0, barSpacing: 6, opts: { shiftVisibleRangeOnNewBar: true } }
  const isWs = (p) => p && p.open === undefined && p.value === undefined
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const recompute = () => {
    const oldPts = ts.points
    const oldBase = ts.base
    const set = new Set()
    let newBase = null
    for (const s of series) for (const p of s.__data) set.add(p.time)
    const pts = [...set].sort(cmp)
    for (const s of series) {
      for (let i = s.__data.length - 1; i >= 0; i--) {
        if (!isWs(s.__data[i])) { const ix = pts.indexOf(s.__data[i].time); if (newBase == null || ix > newBase) newBase = ix; break }
      }
    }
    const same = oldPts.length === pts.length && oldPts.every((t, i) => t === pts[i])
    if (oldPts.length && pts.length && oldBase != null && newBase != null) {
      const to = oldBase + ts.rightOffset
      const from = to - width / ts.barSpacing + 1
      const lastVisible = oldBase >= from && oldBase <= to
      const leftShift = pts[0] < oldPts[0]
      const prepended = leftShift ? pts.indexOf(oldPts[0]) : 0
      const added = newBase > oldBase + prepended
      const needShift = lastVisible && !same && ts.opts.shiftVisibleRangeOnNewBar
      if (added && !leftShift && !needShift) ts.rightOffset -= (newBase - oldBase)
    }
    ts.points = pts
    ts.base = newBase
  }
  const makeSeries = (name) => {
    const s = {
      name, __data: [], calls: [], corrupted: false,
      setData: (d) => {
        const arr = d || []
        // LWC asserts strictly ascending, unique times; so does the fake.
        for (let i = 1; i < arr.length; i++) if (!(arr[i - 1].time < arr[i].time)) throw new Error(`setData: times not ascending/unique at ${i}`)
        s.calls.push(['setData', arr.length]); s.__data = [...arr]; recompute()
      },
      update: (p, historical) => {
        s.calls.push([historical ? 'updateHistorical' : 'update', p.time])
        const i = s.__data.findIndex(d => d.time === p.time)
        if (historical) {
          // Real LWC 5.2 does NOT throw for a time it lacks: it overwrites the wrong row. Emulate
          // that (the nearest older row) and flag it, so a test can prove the painter never does it.
          if (i < 0) {
            let j = s.__data.length - 1
            while (j > 0 && s.__data[j].time > p.time) j--
            s.corrupted = true
            s.__data = s.__data.map((d, k) => (k === j ? p : d)); recompute(); return
          }
          s.__data = s.__data.map((d, j) => (j === i ? p : d)); recompute(); return
        }
        const last = s.__data[s.__data.length - 1]
        if (last && p.time < last.time) throw new Error('Cannot update oldest data')
        if (last && last.time === p.time) s.__data = [...s.__data.slice(0, -1), p]
        else s.__data = [...s.__data, p]
        recompute()
      },
      data: () => s.__data,
    }
    series.push(s)
    return s
  }
  const range = () => {
    if (ts.base == null) return null
    const to = ts.base + ts.rightOffset
    return { from: to - width / ts.barSpacing + 1, to }
  }
  const timeScale = {
    setVisibleLogicalRange: ({ from, to }) => {
      if (ts.base == null) return
      ts.barSpacing = width / (to - from + 1)
      ts.rightOffset = to - ts.base
    },
    getVisibleLogicalRange: () => range(),
    timeToIndex: (time) => { const i = ts.points.indexOf(time); return i < 0 ? null : i },
    applyOptions: (o) => { Object.assign(ts.opts, o || {}) },
  }
  /** One painted frame of `s`: newest real bar's time + pixel x + spacing, or blank. */
  const frame = (s) => {
    const d = s.__data.filter(p => !isWs(p))
    const last = d[d.length - 1]
    if (!last || ts.base == null) return { blank: true }
    const idx = ts.points.indexOf(last.time)
    const x = width - (ts.base + ts.rightOffset - idx + 0.5) * ts.barSpacing
    return { time: last.time, x: Math.round(x * 1e6) / 1e6, sp: Math.round(ts.barSpacing * 1e6) / 1e6, n: d.length }
  }
  /** Pixel x of the bar at chart time `time` (null when not held). */
  const xOfTime = (time) => {
    const idx = ts.points.indexOf(time)
    if (idx < 0 || ts.base == null) return null
    return Math.round((width - (ts.base + ts.rightOffset - idx + 0.5) * ts.barSpacing) * 1e6) / 1e6
  }
  return { addSeries: makeSeries, timeScale: () => timeScale, ts, series, frame, xOfTime, width }
}
