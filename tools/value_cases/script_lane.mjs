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
function chartOf(kind) {
  if (!CHARTS[kind]) {
    const bars = recipeBars(kind)
    const others = othersFor(bars)
    const withOthers = (ctx) => ({
      ...ctx,
      secondary: new Map(Object.entries(others).map(([k, v]) => [k, { bars: v, status: 'ok' }])),
      exchangeOf: (t) => (others[t] ? 'NYSE Arca' : null),
    })
    CHARTS[kind] = { bars, others, ctx: () => withOthers(recipeContext(kind, 'fromListing')) }
  }
  return CHARTS[kind]
}

function runOne({ id, source, chart }) {
  const kind = chart === 'intraday' ? 'intraday' : 'daily'
  const { bars, ctx } = chartOf(kind)
  const pane = memberPaneDefinition({ source, id: `u_value_case_${id}`, name: id })
  if (!pane.ok) return { ok: false, chart: kind, reason: String(pane.reason || '').slice(0, 300) }
  const cols = registry.computeFor(pane.definition, bars, undefined, ctx())
  const out = {
    ok: true,
    chart: kind,
    errors: registry.columnErrors(cols) || {},
    columns: Object.fromEntries(Object.keys(cols).filter((k) => !k.startsWith('__')).map((k) => [k, Array.from(cols[k]).map(num)])),
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
