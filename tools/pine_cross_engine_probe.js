// W5-T5 cross-engine probe (docs/pine/SERVER-RUNTIME-DESIGN.md H7 and H8). ONE source, evaluated verbatim by
// Node (tools/pine_cross_engine_probe.mjs) and by every Playwright browser (tools/pine_cross_engine_report.py).
// It is an expression: a function of the runtime's own clockFns.js source (export keywords stripped by the
// caller) that returns RAW answers (base64 little-endian arrays). Nothing is decided here; the Python side compares.
(function probe(clockSrc) {
  const b64 = (typed) => {
    const u = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
    let s = ''
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000))
    return btoa(s)
  }
  const mulberry32 = (a) => () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // ---- H8: Math over a fixed input set (seeded, so every host sees identical doubles) ----
  const SETS = [['uniform20', 20000], ['unit', 5000], ['huge', 2000], ['posLog', 3000]]
  const rng = mulberry32(0x5eed05)
  const xs = []
  for (const [name, n] of SETS) {
    for (let i = 0; i < n; i += 1) {
      const u = rng()
      let x
      if (name === 'uniform20') x = -20 + 40 * u
      else if (name === 'unit') x = -1 + 2 * u
      // no Math.pow/exp here: the inputs must be bit-identical in every host (checked by the summarizer), so only
      // IEEE-exact multiplication and decimal parsing are used
      else if (name === 'huge') x = (rng() < 0.5 ? -1 : 1) * (1 + 9 * u) * Number(`1e${3 + Math.floor(rng() * 6)}`)
      else x = (1 + 9 * u) * Number(`1e${-6 + Math.floor(rng() * 12)}`)
      xs.push(x)
    }
  }
  const ys = xs.map(() => -5 + 10 * rng())
  const F1 = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10',
    'sqrt', 'cbrt', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']
  const F2 = {
    pow: (x, y) => Math.pow(Math.abs(x), y),
    atan2: (x, y) => Math.atan2(y, x),
    hypot: (x, y) => Math.hypot(x, y),
  }
  const math = {}
  for (const f of F1) {
    const out = new Float64Array(xs.length)
    for (let i = 0; i < xs.length; i += 1) out[i] = Math[f](xs[i])
    math[f] = b64(out)
  }
  for (const [f, g] of Object.entries(F2)) {
    const out = new Float64Array(xs.length)
    for (let i = 0; i < xs.length; i += 1) out[i] = g(xs[i], ys[i])
    math[f] = b64(out)
  }
  // a small anchor table of well-known inputs so a reader can check one by hand
  const anchorsX = [0.5, 1, 2, 3, 10, 100, Math.PI, Math.E]
  const anchors = { x: anchorsX }
  for (const f of ['sin', 'cos', 'tan', 'exp', 'log', 'atan']) anchors[f] = anchorsX.map((x) => Math[f](x))
  anchors.pow_2_to_x = anchorsX.map((x) => Math.pow(2, x))
  anchors.atan2_x_over_2 = anchorsX.map((x) => Math.atan2(x, 2))
  const inputs = new Float64Array(xs.length * 2)
  xs.forEach((x, i) => { inputs[2 * i] = x; inputs[2 * i + 1] = ys[i] })

  // ---- H7: the runtime's own New York clock over 1990..2030 ----
  const clock = new Function(`${clockSrc}\n;return { timestampMs, instantField }`)()
  const { timestampMs, instantField } = clock
  const HOUR = 3600000
  const T0 = Date.UTC(1990, 0, 1)
  const T1 = Date.UTC(2031, 0, 1)
  const nH = (T1 - T0) / HOUR
  // (a) every UTC hour, at :00 and :59:59 -> year month day dow hour minute second
  const sweep = new Uint16Array(nH * 2 * 7)
  const transitions = []
  let prevOff = null
  const FIELDS = ['year', 'month', 'dayofmonth', 'dayofweek', 'hour', 'minute', 'second']
  for (let h = 0; h < nH; h += 1) {
    for (let k = 0; k < 2; k += 1) {
      const ms = T0 + h * HOUR + (k ? 3599000 : 0)
      const base = (h * 2 + k) * 7
      for (let j = 0; j < 7; j += 1) sweep[base + j] = instantField(FIELDS[j], ms, 'exchange')
    }
    const b = h * 14
    const wall = Date.UTC(sweep[b], sweep[b + 1] - 1, sweep[b + 2], sweep[b + 4], sweep[b + 5], sweep[b + 6])
    const off = (wall - (T0 + h * HOUR)) / 60000
    if (prevOff !== null && off !== prevOff) transitions.push([T0 + h * HOUR, prevOff, off])
    prevOff = off
  }
  // (b) session edges on every calendar day, New York wall times through the runtime's timestampMs, then read back.
  //     01:30 and 02:30 sit in the fall-back and spring-forward hours.
  const EDGES = [[0, 0], [1, 30], [2, 30], [4, 0], [9, 30], [16, 0], [20, 0], [23, 59]]
  const days = []
  for (let t = Date.UTC(1990, 0, 1); t < T1; t += 86400000) days.push(t)
  const edgeMs = new Float64Array(days.length * EDGES.length)
  const edgeFields = new Uint8Array(days.length * EDGES.length * 4) // hour minute dayofweek dayofmonth, read back
  days.forEach((t, di) => {
    const d = new Date(t)
    EDGES.forEach(([h, mi], ei) => {
      const ms = timestampMs('exchange', d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, mi, 0)
      const i = di * EDGES.length + ei
      edgeMs[i] = ms
      edgeFields[i * 4] = instantField('hour', ms, 'exchange')
      edgeFields[i * 4 + 1] = instantField('minute', ms, 'exchange')
      edgeFields[i * 4 + 2] = instantField('dayofweek', ms, 'exchange')
      edgeFields[i * 4 + 3] = instantField('dayofmonth', ms, 'exchange')
    })
  })
  const meta = {
    intlTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    hours: nH, days: days.length,
  }
  return {
    math: { sets: SETS, inputs: b64(inputs), fns: math, anchors },
    tz: { meta, T0, edgesPerDay: EDGES, sweep: b64(sweep), transitions, edgeMs: b64(edgeMs), edgeFields: b64(edgeFields) },
  }
})
