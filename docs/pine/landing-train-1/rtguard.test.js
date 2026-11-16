// SCRATCH (train-1): the runtime door's answer for every census source (guard + message)
import { it } from 'vitest'
import fs from 'node:fs'
import { buildRuntimeIr } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/ast/pineRuntimeFrontend.js'
import { memberPaneDefinition } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/builder/memberPane/memberPaneDefinition.js'
const RDDT = JSON.parse(fs.readFileSync(process.env.TRAIN_BARS, 'utf8')).bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
it('runtime guards', () => {
  const src = JSON.parse(fs.readFileSync(process.env.TRAIN_IN, 'utf8'))
  const out = []
  for (const s of src) {
    let g = 'OK'; let m = null
    try { const r = buildRuntimeIr(s.text, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true }); if (!r.ok) { g = r.refusal ? r.refusal.guard : '?'; m = r.refusal ? String(r.refusal.message).slice(0, 200) : null } } catch (e) { g = 'THREW'; m = String(e && e.message).slice(0, 120) }
    let half = null
    if (g === 'pine:bool-na-unwitnessed' || process.env.TRAIN_DOOR === '1') {
      try { const d = memberPaneDefinition({ source: s.text, id: 'u_rt', name: 'rt' }); half = d.ok ? { lane: d.lane || null, declined: d.runHalfDeclined ? d.runHalfDeclined.code : null } : { guard: d.guard } } catch (e) { half = { threw: 1 } }
    }
    out.push({ set: s.set, key: s.key, sha: s.sha, guard: g, msg: m, half })
  }
  fs.writeFileSync(process.env.TRAIN_OUT, JSON.stringify(out))
})
