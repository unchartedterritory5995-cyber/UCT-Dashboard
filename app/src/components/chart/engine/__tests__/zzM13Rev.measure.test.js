// REVIEW-ONLY probe: C18 door output, base vs head.
import { describe, it, vi } from 'vitest'
import fs from 'node:fs'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'

const OUT = process.env.REV_OUT
const PROBES = JSON.parse(fs.readFileSync(process.env.REV_PROBES, 'utf8'))
const N = 40
const BARS = Array.from({ length: N }, (_, i) => {
  const o = 100 + 5 * Math.sin(i * 0.9), c = 100 + 5 * Math.sin(i * 1.7 + 1)
  return { t: 1700000000 + i * 86400, o, h: Math.max(o, c) + 1 + (i % 3), l: Math.min(o, c) - 1, c, v: 1000 + i }
})
function c18(src) {
  const d = memberPaneDefinition({ source: src, id: 'u_rev', name: 'rt' })
  if (!d.ok) return { defOk: false, reason: String(d.reason).slice(0, 200) }
  const reader = objectReaderFor(d.definition, BARS, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
  if (!reader) return { reader: null }
  const run = evaluateObjects(reader.program, {
    barCount: N, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return {
    labels: run.live.filter((o) => o.family === 'label').map((o) => [Number.isNaN(o.props.y) ? null : +Number(o.props.y).toFixed(6), o.props.text]),
    rt: reader.runtime ? !!reader.runtime.served : null,
    rtReason: reader.runtime ? reader.runtime.reason : null,
  }
}
describe.skipIf(!OUT)('rev', () => {
  it('runs', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const out = {}
    for (const [name, src] of Object.entries(PROBES)) {
      const row = {}
      try { Object.assign(row, c18(src)) } catch (e) { row.threw = String(e && e.message).slice(0, 200) }
      for (const [k, door] of [['door', true], ['pane', false]]) {
        try {
          const b = buildRuntimeIr(src + 'plot(close)\n', { bars: BARS, inputs: {}, objectTrees: [], objectTreesAt: [], ...(door ? { objectDoor: true } : {}) })
          row[k] = b.ok ? 'ok' : `${b.refusal.guard}: ${String(b.refusal.message).slice(0, 140)}`
        } catch (e) { row[k] = 'threw ' + String(e && e.message).slice(0, 120) }
      }
      out[name] = row
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 600000)
})
