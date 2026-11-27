// tools/value_cases/script_lane.mjs
//
// THE SCRIPT LANE OF THE VALUE CASES, run in node: what a script the assistant wrote COMPUTES and DRAWS.
//
// ⭐ IT RUNS THE SHIPPED MODULES, NOT A COPY (the `tools/converse_eval_lane.mjs` precedent): the member
// pane's own path. `memberPaneDefinition` builds the script exactly as a member's paste is built,
// `nativeRegistry.computeFor` runs it on the engine's own built bars (`recipeBars`), and what it draws is
// read from the engine's own render state: every table cell's text, every label, line and box.
//
// It answers NUMBERS, never a verdict. The verdict is `tools/value_cases/script_rules.py`, in Python,
// importing nothing of the engine, on the bars this file hands back.
//
// ⛔ Nothing in this process may reach the network: `fetch` is replaced by a refusal.
//
// Use: node <bundle> <job.json> <out.json>. Job: {scripts: [{id, source, chart: 'daily' | 'intraday'}]}.

import fs from 'node:fs'
import * as registry from '../../app/src/components/chart/engine/nativeRegistry.js'
import { memberPaneDefinition } from '../../app/src/components/chart/builder/memberPane/memberPaneDefinition.js'
import { objectReaderFor } from '../../app/src/components/chart/engine/objectColumns.js'
import { evaluateObjects } from '../../app/src/components/chart/engine/objectRuntime.js'
import { toRenderState } from '../../app/src/components/chart/engine/objectRenderState.js'
import { layoutTables } from '../../app/src/components/chart/engine/objectCanvas.js'
import { __permitRuntimePaneForTests } from '../../app/src/components/chart/engine/runtimePaneGate.js'
import { __allowEveryRuntimeScriptForTests } from '../../app/src/components/chart/engine/runtimeKill.js'
import { recipeBars, recipeContext } from '../../app/src/components/chart/supportLoop/assistantRecipes.js'

const BLOCKED = []
globalThis.fetch = async (url) => {
  BLOCKED.push(String(url).slice(0, 120))
  throw new Error('value cases script lane: network is refused in this process')
}

// The run a member's chart gives a script: the bar-by-bar pane permitted, every script admitted. Both
// are the engine's own test doors; what is under test here is what the assistant WROTE, not admission.
__permitRuntimePaneForTests()
__allowEveryRuntimeScriptForTests()

const num = (x) => (Number.isFinite(x) ? x : null)
const plain = (b) => ({ t: b.t ?? b.time, o: b.o ?? b.open, h: b.h ?? b.high, l: b.l ?? b.low, c: b.c ?? b.close, v: b.v ?? b.volume })

/** ANOTHER SYMBOL'S BARS: a fixed walk per ticker on the chart's own times (built series, not the real funds). */
function othersFor(bars) {
  const walkOf = (seed, start) => {
    let s = seed
    let px = start
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
    return bars.map((b) => {
      const o = px * (1 + (rnd() - 0.5) * 0.008)
      px = o * (1 + (rnd() - 0.49) * 0.03)
      return { t: b.t ?? b.time, o, h: Math.max(o, px) * (1 + rnd() * 0.006), l: Math.min(o, px) * (1 - rnd() * 0.006), c: px, v: Math.round(5e7 * (0.5 + rnd())) }
    })
  }
  return { SPY: walkOf(101, 400), QQQ: walkOf(202, 330), IWM: walkOf(303, 190) }
}

const CHARTS = {}
function chartWith(key, kind, bars, others) {
  const withOthers = (ctx) => ({
    ...ctx,
    secondary: new Map(Object.entries(others).map(([k, v]) => [k, { bars: v, status: 'ok' }])),
    exchangeOf: (t) => (others[t] ? 'NYSE Arca' : null),
  })
  CHARTS[key] = { bars, others, ctx: () => withOthers(recipeContext(kind, 'fromListing')) }
  return CHARTS[key]
}

/**
 * The chart a script is run on. Plain: the engine's built bars. With an EDGE: the same bars with ONE bar,
 * exactly `back` bars before the newest, made a strict extreme (the highest high and/or the lowest low of the
 * whole chart, or another symbol's close ten times over). A request for "the last 252 bars" does not reach
 * that bar and a script that reads 253 does: on the plain bars the two often draw the same level, and a check
 * that cannot tell them apart proves nothing about the window.
 *
 * ⭐ 2026-11-24, `close`: a window of CLOSES counted back from the bar before the newest ("looking back at most
 * 250 bars", cap-01). The bar `back` bars before the newest gets the strict highest close of the chart, and the
 * newest bar a close above every other bar's and below that one. On the newest bar a look-back of `back - 1`
 * bars finds no higher close and one of `back` bars finds that bar: the two answers differ there, by construction.
 * The bar 2 before the newest closes EXACTLY at the newest's close (a tie), so "above" (strict) and "at least"
 * also give different answers on the newest bar: nothing for "above", 2 for "at least".
 */
function chartOf(kind, edge) {
  if (!CHARTS[kind]) {
    const bars = recipeBars(kind)
    chartWith(kind, kind, bars, othersFor(bars))
  }
  if (!edge) return { key: kind, ...CHARTS[kind] }
  // ⛔ 2026-11-25: a FORMULA-lane edge (a list of parts, `edges.py`) read here found no `back` and graded the PLAIN
  // bars under a new key, saying nothing. A script is given its own form (`edges.script_form`), never that one.
  if (Array.isArray(edge)) throw new Error(`a formula-lane edge on the script lane: ${JSON.stringify(edge)}`)
  const key = `${kind}@${JSON.stringify(edge)}`
  if (!CHARTS[key]) {
    const base = CHARTS[kind]
    const bars = base.bars.map((b) => ({ ...b }))
    const i = bars.length - 1 - edge.back
    if (edge.high) bars[i].h = Math.max(...bars.map((b) => b.h)) * 1.5
    if (edge.low) bars[i].l = Math.min(...bars.map((b) => b.l)) * 0.5
    if (edge.close) {
      const top = Math.max(...bars.map((b) => b.c))
      const last = bars[bars.length - 1]
      bars[i].c = top * 1.5
      bars[i].h = Math.max(bars[i].h, bars[i].c)
      last.c = top * 1.25
      last.h = Math.max(last.h, last.c)
      // and a TIE: the bar 2 before the newest closes EXACTLY at the newest's close, so a script that counts a close
      // "at least" today's (>=) finds it there, while one that counts a close "above" it (>) does not
      const tie = bars[bars.length - 3]
      tie.c = last.c
      tie.h = Math.max(tie.h, tie.c)
    }
    // ⭐ 2026-11-25, `ties`: [{field, back, as, from?}], EXACT ties set last: the bar `back` bars before the newest takes
    // the value of the bar `as` bars before it (its `from` field, the same field by default: "a low above the prior
    // bar's HIGH" ties a low to a high), so "above" and "at least" (or "below" and "at most") disagree on the bar that
    // reads them. The value-case audit found strict words these bars never tie on. A tie that would break a bar (a
    // close outside its own high and low) is refused, never patched.
    if (Array.isArray(edge.ties)) {
      for (const t of edge.ties) {
        const a = bars.length - 1 - t.back
        const b = bars.length - 1 - t.as
        const from = t.from || t.field
        if (!(a >= 0 && b >= 0 && a !== b && ['o', 'h', 'l', 'c', 'v'].includes(t.field) && ['o', 'h', 'l', 'c', 'v'].includes(from))) throw new Error(`a tie names two bars and a field: ${JSON.stringify(t)}`)
        if (t.shift) {
          // `shift` (2026-11-25): the WHOLE bar moves by one amount so its `field` lands exactly on the value. A tie
          // that set one price alone broke most bars it was aimed at (a low lifted above the bar's own close)
          const delta = bars[b][from] - bars[a][t.field]
          for (const k of ['o', 'h', 'l', 'c']) bars[a][k] += delta
        }
        bars[a][t.field] = bars[b][from]
        const x = bars[a]
        if (!(x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c))) throw new Error(`the tie breaks the bar: ${JSON.stringify(t)}`)
      }
    }
    const others = Object.fromEntries(Object.entries(base.others).map(([sym, series]) => [sym, series.map((b) => ({ ...b }))]))
    if (edge.othersClose) {
      for (const series of Object.values(others)) {
        series[i].c *= edge.othersClose
        series[i].h = Math.max(series[i].h, series[i].c)
      }
    }
    chartWith(key, kind, bars, others)
  }
  return { key, ...CHARTS[key] }
}

function runOne({ id, source, chart, edge }) {
  const kind = chart === 'intraday' ? 'intraday' : 'daily'
  const { key, bars, ctx } = chartOf(kind, edge || null)
  const pane = memberPaneDefinition({ source, id: `u_value_case_${id}`, name: id })
  if (!pane.ok) return { ok: false, chart: key, reason: String(pane.reason || '').slice(0, 300) }
  const cols = registry.computeFor(pane.definition, bars, undefined, ctx())
  const out = {
    ok: true,
    chart: key,
    errors: registry.columnErrors(cols) || {},
    columns: Object.fromEntries(Object.keys(cols).filter((k) => !k.startsWith('__')).map((k) => [k, Array.from(cols[k]).map(num)])),
    // what each MARK plot writes on its bars (plotchar's character, plotshape's text): one fixed text per plot,
    // as the pane itself holds it. A column says WHERE a mark is; only this says WHAT it reads.
    marks: Object.fromEntries((pane.definition.plots || []).filter((p) => p && p.style === 'markers')
      .map((p) => [p.key, { text: (p.marker && p.marker.text) ?? null, position: (p.marker && p.marker.position) ?? null }])),
  }
  const drawn = { via: null, tables: [], labels: [], lines: [], boxes: [] }
  try {
    const c = ctx()
    let state = null
    if (pane.definition.objects) {
      const reader = objectReaderFor(pane.definition, bars, { inputs: undefined, tf: c.tf, symbol: c.symbol, secondary: c.secondary, exchangeOf: c.exchangeOf })
      if (reader) {
        const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readUnknown: reader.readUnknown, readTime: (i) => bars[i].t })
        state = toRenderState(run.live, { bars })
        drawn.via = 'object program'
        // ⭐ e95 (computed number formats) — what the run withheld and SAYS to the member (the drawing note's
        // sentences, `objectRuntime.js::withheldWhy`), so a value case can read why a cell is empty. Additive:
        // present only when the run says something, so every other output is unchanged.
        if (run.withheldWhy && Object.keys(run.withheldWhy).length) drawn.why = { ...run.withheldWhy }
      }
    } else if (cols.__runtimeObjects) {
      const ro = cols.__runtimeObjects
      drawn.via = 'runtime'
      state = Array.isArray(ro.tables) || Array.isArray(ro.labels) ? ro : toRenderState(ro.live || ro, { bars })
    }
    if (state) {
      drawn.tables = layoutTables(state).map((t) => ({ position: t.position, grid: (t.grid || []).map((r) => r.map((cell) => (cell ? String(cell.text ?? '') : null))) }))
      drawn.labels = (state.labels || []).map((l) => ({ text: l.text == null ? '' : String(l.text), x: l.x, y: num(l.y) }))
      drawn.lines = (state.lines || []).map((l) => ({ x1: l.x1, y1: num(l.y1), x2: l.x2, y2: num(l.y2), extend: l.extend ?? null }))
      drawn.boxes = (state.boxes || []).map((b) => ({ left: b.left, right: b.right, top: num(b.top), bottom: num(b.bottom), extend: b.extend ?? null }))
    }
  } catch (e) {
    drawn.error = String(e && e.message).slice(0, 300)
  }
  out.drawn = drawn
  return out
}

const [jobPath, outPath] = process.argv.slice(2)
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'))
const answer = { charts: {}, scripts: {}, blocked: BLOCKED }
for (const script of job.scripts) {
  try {
    answer.scripts[script.id] = runOne(script)
  } catch (e) {
    answer.scripts[script.id] = { ok: false, reason: `the run threw: ${String(e && e.message).slice(0, 300)}` }
  }
}
for (const [kind, c] of Object.entries(CHARTS)) {
  answer.charts[kind] = { bars: c.bars.map(plain), others: Object.fromEntries(Object.entries(c.others).map(([k, v]) => [k, v.map(plain)])) }
}
fs.writeFileSync(outPath, JSON.stringify(answer))
