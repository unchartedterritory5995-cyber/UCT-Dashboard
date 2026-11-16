// SCRATCH (train-1): which labels of vw-w3n-draw-block-history-c (SPY) differ from TradingView's
import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRuntimeIr } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/runtime/lowerIr.js'
import { execute } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/runtime/vm.js'
const RUN = path.join(process.env.LOCALAPPDATA, 'uct-vendor-batch/runs/s10-2026-11-15')
const nn = (y) => (y == null || Number.isNaN(y) ? null : y)
it('l4d probe', () => {
  const out = {}
  for (const id of ['vw-w3n-draw-block-history-c-spy-1d-2026-11-15', 'vw-w3n-draw-block-history-c-rddt-1d-2026-11-15', 'vw-w3n-draw-block-history-a-spy-1d-2026-11-15']) {
    const cap = JSON.parse(fs.readFileSync(path.join(RUN, 'captures', `${id}.json`)))
    const xm = JSON.parse(fs.readFileSync(path.join(RUN, 'xmap', `${id}.json`)))
    const vendor = cap.objects.records.labels.slice().sort((a, b) => a.id - b.id).map((x) => [xm.barIndex[x.x], nn(x.y), x.t])
    const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
    const built = buildRuntimeIr(cap.source.text, { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
    if (!built.ok) { out[id] = { refused: built.refusal.guard }; continue }
    const program = lowerIrProgram(built.ir)
    const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
    const res = execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t) })
    const ours = res.objects.finish().live.filter((o) => o.family === 'label').sort((a, b) => a.id - b.id).map((o) => [o.props.x, nn(o.props.y), o.props.text])
    const diffs = []
    for (let i = 0; i < Math.max(vendor.length, ours.length); i++) {
      const v = vendor[i]; const o = ours[i]
      if (!v || !o || v[0] !== o[0] || v[2] !== o[2] || Number(Number(v[1]).toPrecision(12)) !== Number(Number(o[1]).toPrecision(12))) diffs.push({ i, vendor: v, ours: o })
    }
    out[id] = { vendor: vendor.length, ours: ours.length, differ: diffs.length, textOnly: diffs.filter((d) => d.vendor && d.ours && d.vendor[0] === d.ours[0] && Number(Number(d.vendor[1]).toPrecision(12)) === Number(Number(d.ours[1]).toPrecision(12))).length, first: diffs.slice(0, 6) }
  }
  fs.writeFileSync(process.env.TRAIN_OUT, JSON.stringify(out, null, 1))
})
