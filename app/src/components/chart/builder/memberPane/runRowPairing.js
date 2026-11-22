// app/src/components/chart/builder/memberPane/runRowPairing.js
//
// ─── ⭐⭐ ENGINE 53 — WHICH RUN OUTPUT IS WHICH HOST OUTPUT: ONE PAIRING, BOTH LANES ──
//
// The per-bar run and the host translation each list a script's outputs in source
// order. The n-th `plotshape` of the one is the n-th `plotshape` of the other, and the
// n-th `plotcandle` is four host outputs (open, high, low, close) against one run
// group of four. When the two lanes disagree on how many outputs of a kind the script
// has, which column is which cannot be known: that is a refusal, never a guess.
//
// ⛔ ONE COPY. This was written inline in `memberPaneDefinition::runtimeLaneDefinition`
// (the runtime document's rows) and engine 53's run half (`hostPartialRunHalf`, the run
// drawing a host document's objects) needs the same answer. Two copies of a pairing
// rule are two authorities over one mapping, and the first one to drift draws a plot's
// column under another plot's name. Both lanes call `pairRunRows`; a rail
// (`runHalf.pairing.rail.test.js`) refuses a second copy in the door.

/** The Pine outputs a runtime document draws as a chart row: the ones paired one to one. */
export const RUNTIME_ROW_KINDS = new Set(['plot', 'plotshape', 'plotchar'])

/** The calls paired as a candle: four host outputs (open, high, low, close, in that order:
 *  `pine.js::MULTI_OUTPUT_CALLS`) against one run group whose outputs name their `role`. */
export const RUNTIME_CANDLE_KINDS = Object.freeze(['plotcandle', 'plotbar'])
const CANDLE_ROLES = Object.freeze(['open', 'high', 'low', 'close'])
const isCandleKind = (k) => RUNTIME_CANDLE_KINDS.includes(k)

/**
 * Pair the host translation's outputs with the run's.
 *
 * @param {object} t the host translation (`translatePine`'s result; reads `t.outputs`)
 * @param {object[]} runOutputs the run's output descriptors (`probeRuntimeProgram(...).outputs`)
 * @returns {{ok: false, code: string, why: string}
 *   | {ok: true,
 *      ofKind: {o: object, index: number}[],          // host outputs of a row kind, hidden included
 *      runtimeByKind: Map<string, number[]>,           // run output indices by call, in order
 *      hostCandles: Map<string, {o, index}[]>,         // host candle outputs by call
 *      runCandles: Map<string, {byRole, ro}[]>,        // run candle groups by call
 *      runOutputOf: Map<number, number>}}              // host output index -> run output index
 */
export function pairRunRows(t, runOutputs) {
  const outs = Array.isArray(runOutputs) ? runOutputs : []
  // ⭐ RT1 — every host output of a drawn kind, hidden ones included, so the ordinal of
  // each is the runtime lane's ordinal (the runtime lane emits a `display.none` plot too).
  const ofKind = []
  ;((t && t.outputs) || []).forEach((o, index) => {
    if (o && RUNTIME_ROW_KINDS.has(o.kind)) ofKind.push({ o, index })
  })
  const runtimeByKind = new Map()
  outs.forEach((ro, k) => {
    const call = ro && ro.call
    if (!runtimeByKind.has(call)) runtimeByKind.set(call, [])
    runtimeByKind.get(call).push(k)
  })
  const hostByKind = new Map()
  for (const c of ofKind) hostByKind.set(c.o.kind, (hostByKind.get(c.o.kind) || 0) + 1)
  for (const kind of RUNTIME_ROW_KINDS) {
    const n = hostByKind.get(kind) || 0
    const m = (runtimeByKind.get(kind) || []).length
    if (m !== n) {
      return { ok: false, code: 'runtime:output-map', why: `the two lanes disagree on how many \`${kind}\` outputs the script has `
        + `(${n} against ${m}), so which column is which cannot be known` }
    }
  }
  // ⭐ W4-T13 - THE CANDLES AND BARS, paired the same way: the n-th `plotcandle` of the host's
  // outputs is the n-th the run emitted (four outputs each, `role` in source order). A count that
  // disagrees is the same `runtime:output-map` decline as any other kind's.
  const hostCandles = new Map()
  ;((t && t.outputs) || []).forEach((o, index) => {
    if (!o || !isCandleKind(o.kind)) return
    if (!hostCandles.has(o.kind)) hostCandles.set(o.kind, [])
    hostCandles.get(o.kind).push({ o, index })
  })
  const runCandles = new Map()
  outs.forEach((ro, k) => {
    if (!ro || !isCandleKind(ro.call)) return
    if (!runCandles.has(ro.call)) runCandles.set(ro.call, [])
    const list = runCandles.get(ro.call)
    if (!list[ro.group]) list[ro.group] = { byRole: {}, ro: null }
    // keyed by the role the run NAMES (the pane keeps no second list of them)
    list[ro.group].byRole[ro.role] = k
    if (ro.role === 'close') list[ro.group].ro = ro
  })
  for (const kind of RUNTIME_CANDLE_KINDS) {
    const n = (hostCandles.get(kind) || []).length
    const m = (runCandles.get(kind) || []).filter(Boolean).length
    if (n !== m * 4) {
      return { ok: false, code: 'runtime:output-map', why: `the two lanes disagree on how many \`${kind}\` calls the script has `
        + `(${n / 4} against ${m}), so which column is which cannot be known` }
    }
  }
  // The pairing itself, as one map: host output index -> run output index.
  const runOutputOf = new Map()
  const seen = new Map()
  for (const { o, index } of ofKind) {
    const ord = seen.get(o.kind) || 0
    seen.set(o.kind, ord + 1)
    runOutputOf.set(index, runtimeByKind.get(o.kind)[ord])
  }
  for (const kind of RUNTIME_CANDLE_KINDS) {
    const hosts = hostCandles.get(kind) || []
    const runs = runCandles.get(kind) || []
    hosts.forEach(({ index }, i) => {
      const run = runs[Math.floor(i / 4)]
      const k = run && run.byRole[CANDLE_ROLES[i % 4]]
      if (Number.isInteger(k)) runOutputOf.set(index, k)
    })
  }
  return { ok: true, ofKind, runtimeByKind, hostCandles, runCandles, runOutputOf }
}
