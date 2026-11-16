// SCRATCH (train-1 investigation, never committed): the weekly self-request over an unpinned
// `ta.stoch` flat run, on the host lane and on the runtime lane, after master's RS Rating L5.
import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/ast/pine.js'
import { interpret } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/ast/interpret.js'
import { memberPaneDefinition } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/builder/memberPane/memberPaneDefinition.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/runtime/runtimeColumns.js'
import { buildRuntimeIr } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/ast/pineRuntimeFrontend.js'
const REPO = 'C:/Users/Patrick/uct-worktrees/train-1'
const RDDT = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness/support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json'), 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const runs = (col) => {
  const out = []
  let s = -1
  for (let i = 0; i <= col.length; i++) {
    const nan = i < col.length && !(col[i] === col[i])
    if (nan && s < 0) s = i
    if (!nan && s >= 0) { out.push(s === i - 1 ? `${s}` : `${s}-${i - 1}`); s = -1 }
  }
  return out.join(',')
}
const retype = (n, from, to) => {
  if (Array.isArray(n)) return n.map((x) => retype(x, from, to))
  if (!n || typeof n !== 'object') return n
  const o = {}
  for (const k of Object.keys(n)) o[k] = k === 'type' && n[k] === from ? to : retype(n[k], from, to)
  return o
}
it('probe', () => {
  const out = {}
  const variants = {
    barIndex: '//@version=6\nindicator("e57 htf flat")\nfloat y = bar_index >= 60 and bar_index < 75 ? 1000.0 : close\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, y, y, 5)))',
    cum: '//@version=6\nindicator("e57 htf flat cum")\nfloat k = ta.cum(1)\nfloat y = k > 12 and k <= 20 ? 1000.0 : close\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, y, y, 5)))',
    inline: '//@version=6\nindicator("e57 htf flat inline")\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, ta.cum(1) > 12 and ta.cum(1) <= 20 ? 1000.0 : close, ta.cum(1) > 12 and ta.cum(1) <= 20 ? 1000.0 : close, 5)))',
    plainStoch: '//@version=6\nindicator("e57 htf plain")\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, high, low, 5)))',
    daily: '//@version=6\nindicator("e57 daily flat")\nfloat k = ta.cum(1)\nfloat y = k > 12 and k <= 20 ? 1000.0 : close\nplot(ta.stoch(close, y, y, 5))',
  }
  for (const [name, src] of Object.entries(variants)) {
    const r = {}
    resetRuntimeSessions(); resetRuntimeLedgers()
    const t = translatePine(src, { strict: true, basePeriod: 'D' })
    if (t.ok) {
      const outs = t.outputs.filter((o) => o.kind !== 'alertcondition')
      r.formula = outs[0].formula
      const clock = new Map()
      const col = Array.from(interpret(outs[0].ast, RDDT, undefined, undefined, undefined, { historyFromListing: true, tf: 'D', chartClockSink: clock }))
      r.hostClock = [...clock.keys()].sort()
      r.hostNaN = runs(col)
      r.hostDrawn = col.filter((v) => v === v).length
      r.types = JSON.stringify(outs[0].ast).match(/"type":"(tf_merge|tf_live|tf|sym)"/g)
      // the same tree read as the formula language's `tf` (last CLOSED period), for the F5b rail's subject
      const asTf = retype(outs[0].ast, 'tf_merge', 'tf')
      const clock2 = new Map()
      const col2 = Array.from(interpret(asTf, RDDT, undefined, undefined, undefined, { historyFromListing: true, tf: 'D', chartClockSink: clock2 }))
      r.tfClock = [...clock2.keys()].sort(); r.tfNaN = runs(col2)
      // runtime lane
      let rt
      try {
        const cols = computeRuntimeColumns({ id: 'e57', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:e57', outputs: { a: 0 }, source: src } }, RDDT, { ...CTX, symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
        rt = Array.from(cols.a)
        r.rtNaN = runs(rt); r.rtDrawn = rt.filter((v) => v === v).length
        let servedWhereHostWithheld = 0, differ = 0, first = null
        for (let i = 0; i < col.length; i++) {
          if (!(col[i] === col[i]) && rt[i] === rt[i]) { servedWhereHostWithheld += 1; if (first === null) first = [i, rt[i]] }
          if (col[i] === col[i] && rt[i] === rt[i] && Math.abs(col[i] - rt[i]) > 1e-9 * Math.max(1, Math.abs(col[i]))) differ += 1
        }
        r.rtServedWhereHostWithheld = servedWhereHostWithheld; r.rtFirstServed = first; r.rtDiffer = differ
      } catch (e) { r.rtGuard = e.guard || 'threw'; r.rtMessage = String(e && e.message).slice(0, 240) }
    } else r.translate = t.refusal || (t.outputs || []).map((o) => o.refusal)
    try { const ir = buildRuntimeIr(src, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true }); r.ir = ir.ok ? 'OK' : ir.refusal.guard } catch (e) { r.ir = 'threw ' + String(e && e.message).slice(0, 100) }
    const d = memberPaneDefinition({ source: src, id: 'u_probe', name: 'probe' })
    r.door = d.ok ? `OK kind=${(d.definition.compute || {}).kind}` : d.guard
    out[name] = r
  }
  fs.writeFileSync(process.env.TRAIN_OUT, JSON.stringify(out, null, 1))
})
