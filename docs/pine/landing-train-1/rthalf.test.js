// SCRATCH (train-1): the member door's run half for every census source, both panes on (as #1342's acceptance rail stubs them)
import { it, vi } from 'vitest'
import fs from 'node:fs'
import { memberPaneDefinition } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/builder/memberPane/memberPaneDefinition.js'
it('run halves', () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const src = JSON.parse(fs.readFileSync(process.env.TRAIN_IN, 'utf8'))
  const out = []
  for (const s of src) {
    let r
    try {
      const d = memberPaneDefinition({ source: s.text, id: 'u_rt', name: 'rt' })
      r = d.ok ? { ok: 1, lane: d.lane || 'host', declined: d.runHalfDeclined ? d.runHalfDeclined.code : null, why: d.runHalfDeclined ? String(d.runHalfDeclined.why).slice(-90) : null, half: !!(d.definition.compute && d.definition.compute.runtimeObjects) }
        : { ok: 0, guard: d.guard, msg: String(d.message || d.reason || '').slice(0, 120) }
    } catch (e) { r = { threw: String(e && e.message).slice(0, 80) } }
    out.push({ set: s.set, key: s.key, sha: s.sha, ...r })
  }
  fs.writeFileSync(process.env.TRAIN_OUT, JSON.stringify(out))
})
