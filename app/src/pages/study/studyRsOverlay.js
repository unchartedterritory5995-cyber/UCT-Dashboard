/**
 * studyRsOverlay — the REAL UCT RS Line (`rsLine`) on a Study drill chart
 * (RS Phase 4, unit 4-09). The bank's RS drills (`docs/study/bank/rs.drills.json`,
 * generator `scripts/study/bank_v2/gen_rs.py`) carry the server's own columns,
 * precomputed by `relative_strength.compute_phase1_columns` over `bars.db`:
 *
 *   prompt_json.chart.rs      = {columns: {rsLine, rsMa, dotNH, dotNHbeforePx}, times, inputs}
 *   prompt_json.chart.rs_pair = {A: {...}, B: {...}}   (two stocks against SPY, on SPY's chart)
 *   reveal_json.rs            = the real columns of a TAP or red-day item, whose prompt blanks the
 *                               dots (a TAP item's dot IS the answer; a new-high dot on the marked
 *                               red session says "strong that day"), served only after scoring
 *   reveal_json.rs_pair       = the real columns of BOTH leader lines, whose prompt blanks every
 *                               dot (only the leader can make a new RS high, so a dot names it)
 *   prompt_json.chart.mark    = {bar_index, time, label}: the red market day a spot item asks about
 *
 * The drill chart's `sym` is the item id, never the ticker (study_store), so the
 * RS line can never be fetched from `/api/signature/columns`. Instead each line
 * is PRIMED into the server lane's cache (`serverCompute.primeServerColumns`)
 * under exactly the key the binder will ask for, and an ordinary `rsLine` engine
 * instance with the line's own defaults (`RS_CLASSIC_INPUTS`) draws it. Nothing
 * new is rendered: it is the indicator members add on the Charts tab.
 *
 * ⭐ TWO `rsLine` DEFINITIONS, ONE OVERLAY (UCT RS split, U7 / U8, 2026-11-09).
 * `VITE_RS_SPLIT_ENABLED=1` registers the slim UCT RS Line (no presets, price
 * pane, `rsMa` drawn only under `showAverage`); off, today's UCT Relative
 * Strength. This module reads nothing a build flag changes: the inputs come from
 * the registry's `RS_CLASSIC_INPUTS` export (the one object both definitions
 * agree on), the rev from the registered definition, and the slot key from a
 * server input both declare. `studyRsOverlay.test.js` (flag off) and
 * `studyRsOverlay.flagOn.test.js` (flag on, fresh module graph) pin both.
 *
 * ⛔ THE REV IS READ FROM THE DEFINITION (`getDefinition('rsLine').compute.rev`),
 * never typed: a primed wire whose rev differs from the client definition's is
 * what `revMismatch` flags, and the definition's rev moves with the maths.
 *
 * ⛔ NO INSTANCE WITHOUT A PRIMED ENTRY. An `rsLine` instance whose key is not in
 * the cache makes the binder fetch it — under the item id, from the network. So
 * a line whose wire is malformed, or whose inputs disagree with the defaults the
 * instance claims, is dropped whole: no line, and no request.
 *
 * ⭐ ONE KEY PER LINE. The cache key is (definition, chart symbol, timeframe, the
 * server inputs). Two lines on one chart (Line A and Line B, or a TAP item's
 * prompt and reveal columns) share the first three, so each line carries a slot
 * number in `mansfieldLength`: a server input that only shapes the Mansfield
 * column, which nothing on a drill draws (the v5 definition keeps `showMansfield`
 * off; the slim one declares the key `legacy`, rendered by no control, and keeps
 * it in `meta.serverInputs` for exactly this reader) and which is absent from
 * every primed wire. Slot 0 is the server default (200), so a chart with one
 * line carries `RS_CLASSIC_INPUTS` exactly.
 *
 * ⚠️ THE PANE LABEL. The engine prints `<meta.name> · SPY` (`UCT RS Line · SPY`
 * under the split flag, `UCT Relative Strength · SPY` before it; the benchmark
 * input; no rating, since the primed wire carries no payload): it reads the
 * definition and the benchmark, never the chart's symbol, so it never names the
 * stock. On a leader chart the two lines collide, and the engine's sibling
 * disambiguator (`readout.disambiguateSiblings`, Phase 3 unit 3-09b) suffixes
 * each with its instance `display.name` when every colliding sibling carries a
 * distinct one: `… · SPY · Line A` / `· Line B` (chip `UCT RS(SPY) · Line A`).
 * Without the names it would print the one input the lines differ in
 * (`(mansfieldLength 200)`), which is why every leader line carries its label.
 * The drill's own key (`rsPairKey`) says Line A is the upper. The two test files
 * pin the labels as rendered under each definition.
 *
 * Pure apart from the cache write in `primeRsColumns`. No React, no fetch.
 */
import { getDefinition, resolveInputs, RS_CLASSIC_INPUTS } from '../../components/chart/engine/nativeRegistry'
import { pickServerInputs, primeServerColumns, serverColumnsKey } from '../../components/chart/engine/serverCompute'
import { toChartTime } from '../../components/chart/patternTime'

export const RS_DEF_ID = 'rsLine'
export const RS_INSTANCE_ID = 'study:rs'
export const RS_REVEAL_INSTANCE_ID = 'study:rs:reveal'
/** A leader line's instance id: the prompt's (`study:rs:A`) or, once scored, the reveal's (`study:rs:reveal:A`). */
export const rsPairInstanceId = (name, revealed = false) => `${revealed ? RS_REVEAL_INSTANCE_ID : RS_INSTANCE_ID}:${name}`
export const RS_PAIR_SLOTS = Object.freeze(['A', 'B'])
export const RS_TF = 'D'
/** The RS line's own columns a drill wire may carry. Anything else on the wire is ignored. */
export const RS_WIRE_COLUMNS = Object.freeze(['rsLine', 'rsMa', 'dotNH', 'dotNHbeforePx'])
/** The server default of `mansfieldLength` (both definitions declare it); slot n keys as SLOT_BASE + n. */
const SLOT_BASE = 200
/** The red-day mark: a small muted dot under the bar, never the gold of the setup level. */
export const RS_MARK_COLOR = 'rgba(255, 255, 255, 0.55)'

/** The `rsLine` definition, from the registry the chart draws with. */
export function rsDefinition() {
  return getDefinition(RS_DEF_ID)
}

/** The definition's `compute.rev`, read live (never typed), or null without one. */
export function rsRev() {
  const def = rsDefinition()
  const rev = def && def.compute ? def.compute.rev : undefined
  return Number.isFinite(rev) ? rev : null
}

/**
 * The line's own look as input values (colours, toggles, average, lookback).
 * ⭐ UCT RS split, U7 / U8 (2026-11-09): read from the registry's
 * `RS_CLASSIC_INPUTS` export, never from `meta.presets` — the slim UCT RS Line
 * declares no presets, and the v5 definition's Classic preset IS this object.
 * `showAverage: true` on top: a drill wire carries the 21 EMA column
 * (`RS_WIRE_COLUMNS`), and the slim definition draws `rsMa` only while that
 * switch holds; on the v5 definition the key is a declared legacy input (U7a),
 * stored and read by nothing. The name `classicInputs` stays: three callers and
 * both test files read it, and "classic" here means the defaults, not a preset.
 */
export function classicInputs() {
  return { ...RS_CLASSIC_INPUTS, showAverage: true }
}

function chartOf(item) {
  const c = item && item.prompt_json && item.prompt_json.chart
  return c && typeof c === 'object' ? c : null
}

/** Does this item draw an RS pane (one line, or the leader pair)? */
export function isRsItem(item) {
  const c = chartOf(item)
  return !!(c && ((c.rs && typeof c.rs === 'object') || (c.rs_pair && typeof c.rs_pair === 'object')))
}

/** A leader item: two RS lines, Line A and Line B, on the market's chart. */
export function isRsPairItem(item) {
  const c = chartOf(item)
  return !!(c && c.rs_pair && typeof c.rs_pair === 'object')
}

/**
 * The lines this item draws in this phase: `[{slot, instanceId, label, wire}]`.
 * A pair draws Line A and Line B: the prompt's (every dot blank) and, once the
 * item is scored and the reveal carries both (`reveal.rs_pair`), the reveal's,
 * in slots 2 and 3 so neither shares a cache key with a prompt line. A single
 * line draws the prompt's columns, and once scored and the reveal carries its
 * own (`reveal.rs`, a TAP or red-day item's dots), the reveal's. A reveal line
 * carries `reveal: true`.
 */
export function rsLinesFor(item, { reveal = null, revealed = false } = {}) {
  const c = chartOf(item)
  if (!c) return []
  if (c.rs_pair && typeof c.rs_pair === 'object') {
    const after = revealed && reveal && reveal.rs_pair && typeof reveal.rs_pair === 'object' ? reveal.rs_pair : null
    const src = after || c.rs_pair
    const base = after ? RS_PAIR_SLOTS.length : 0
    return RS_PAIR_SLOTS
      .map((name, n) => ({ slot: base + n, instanceId: rsPairInstanceId(name, !!after), label: `Line ${name}`,
        wire: src[name], ...(after ? { reveal: true } : {}) }))
      .filter((l) => l.wire && typeof l.wire === 'object')
  }
  const after = revealed && reveal && reveal.rs && typeof reveal.rs === 'object' ? reveal.rs : null
  if (after) return [{ slot: 1, instanceId: RS_REVEAL_INSTANCE_ID, label: null, wire: after, reveal: true }]
  if (c.rs && typeof c.rs === 'object') return [{ slot: 0, instanceId: RS_INSTANCE_ID, label: null, wire: c.rs }]
  return []
}

/** The instance inputs for slot n: the line's defaults (`classicInputs`), plus the slot key past slot 0. */
export function slotInputs(slot) {
  const inputs = classicInputs()
  if (slot > 0) inputs.mansfieldLength = SLOT_BASE + slot
  return inputs
}

/** The server inputs the binder keys the fetch with for these instance inputs (`computeFor`'s own path). */
export function keyInputs(instanceInputs) {
  const def = rsDefinition()
  return pickServerInputs(def, resolveInputs(def, instanceInputs))
}

/**
 * Does the wire's own `inputs` block (what the generator computed with) agree
 * with the instance's server inputs on every key both name? A disagreement means
 * the columns are not what the pane would say they are, so the line is dropped.
 * Keys the instance does not send (`redDayThreshold` on a Classic chart) are the
 * server's own and are not compared.
 */
export function wireAgrees(wire, instanceInputs) {
  const sent = keyInputs(instanceInputs)
  const own = wire && wire.inputs && typeof wire.inputs === 'object' ? wire.inputs : {}
  for (const [k, v] of Object.entries(own)) {
    if (!(k in sent)) continue
    const a = sent[k]
    if (typeof a === 'number' || typeof v === 'number') {
      if (Number(a) !== Number(v)) return false
    } else if (String(a) !== String(v)) return false
  }
  return true
}

/** The wire handed to the cache: the RS columns only, the times, the definition's rev, no payload. */
export function primeWire(wire) {
  const cols = wire && wire.columns && typeof wire.columns === 'object' ? wire.columns : {}
  const columns = {}
  for (const k of RS_WIRE_COLUMNS) if (Array.isArray(cols[k])) columns[k] = cols[k]
  return { columns, times: Array.isArray(wire && wire.times) ? wire.times : [], rev: rsRev(), payload: null }
}

/**
 * Prime every line this item draws into the server lane's cache, under the key
 * the chart's binder will compute for it (`sym` = the chart's symbol, the item
 * id; `tf` = the chart's timeframe). Call it BEFORE the chart binds (in render,
 * ahead of StockChart): `primeServerColumns` does not notify, by design.
 *
 * @returns {{instanceId, slot, label, inputs, key}[]} the lines that primed; a
 *   line that did not (a malformed wire, a disagreeing input, no rev, a non-daily
 *   chart) is absent, and so is its instance.
 */
export function primeRsColumns(item, sym, tf, opts = {}) {
  const def = rsDefinition()
  const rev = rsRev()
  if (!def || rev == null || !sym || String(tf || RS_TF) !== RS_TF) return []
  const out = []
  for (const line of rsLinesFor(item, opts)) {
    const inputs = slotInputs(line.slot)
    if (!wireAgrees(line.wire, inputs)) continue
    const wire = primeWire(line.wire)
    if (!Array.isArray(wire.columns.rsLine) || !wire.times.length) continue
    const sent = keyInputs(inputs)
    const parsed = primeServerColumns(RS_DEF_ID, sym, RS_TF, sent, wire)
    if (!parsed) continue
    out.push({ instanceId: line.instanceId, slot: line.slot, label: line.label, inputs, key: serverColumnsKey(RS_DEF_ID, sym, RS_TF, sent),
      ...(line.reveal ? { reveal: true } : {}) })
  }
  return out
}

/**
 * The engine instances for the primed lines, merged by id into the drill chart's
 * `indicatorInstances` (`studyChartLook` `extras.instances`). A line the reveal
 * replaced is tombstoned, so the prompt's blank-dot line never draws beside it
 * (the single line, or both leader lines).
 */
export function rsInstances(primed) {
  if (!Array.isArray(primed) || !primed.length) return null
  // A leader line carries its name as the instance's display name (`Line A`): the sibling disambiguator prints it
  // as the " · Line A" suffix in place of the slot input (3-09b).
  const out = primed.map((p) => ({ instanceId: p.instanceId, defId: RS_DEF_ID, inputs: { ...p.inputs },
    ...(p.label ? { display: { name: p.label } } : {}) }))
  if (primed.some((p) => p.instanceId === RS_REVEAL_INSTANCE_ID)) out.push({ instanceId: RS_INSTANCE_ID, deleted: true })
  for (const name of RS_PAIR_SLOTS) {
    if (primed.some((p) => p.instanceId === rsPairInstanceId(name, true))) out.push({ instanceId: rsPairInstanceId(name), deleted: true })
  }
  return out
}

/** Did the reveal's own columns replace the prompt's (a scored TAP, red-day or leader item)? */
export function rsRevealPrimed(primed) {
  return (Array.isArray(primed) ? primed : []).some((p) => p.reveal)
}

/** The drill's own key for the leader pair: the lines in pane order. Null for any other item. */
export function rsPairKey(primed) {
  const named = (Array.isArray(primed) ? primed : []).filter((p) => p.label)
  if (named.length < 2) return null
  return named.map((p) => p.label)
}

/**
 * The red-day mark as a StockChart marker: a small muted dot under the marked
 * bar (`prompt_json.chart.mark`), the session the question asks about. It says
 * where to look, never what the answer is. Null for any other item, or when the
 * bar is not on the chart.
 */
export function rsMarkMarkers(item, bars) {
  const c = chartOf(item)
  const m = c && c.mark && typeof c.mark === 'object' ? c.mark : null
  if (!m || !Array.isArray(bars) || !bars.length) return null
  const want = m.time != null ? toChartTime(m.time, RS_TF) : null
  let bar = want ? bars.find((b) => toChartTime(b && b.t, RS_TF) === want) : null
  if (!bar && Number.isInteger(m.bar_index)) bar = bars[m.bar_index] || null
  if (!bar) return null
  return [{ time: toChartTime(bar.t, RS_TF), position: 'belowBar', color: RS_MARK_COLOR, shape: 'circle', text: '', id: 'study-rs-mark' }]
}
