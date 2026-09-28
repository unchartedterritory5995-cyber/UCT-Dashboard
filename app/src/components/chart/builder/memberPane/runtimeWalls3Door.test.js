// app/src/components/chart/builder/memberPane/runtimeWalls3Door.test.js
//
// ─── A CANDLE THE PANE CANNOT DRAW IS SAID, AND ITS KNOB IS NOT OFFERED ───────
//
// pine/runtime-walls-3 (2026-09-28): the runtime lane now COMPUTES `plotcandle` /
// `plotbar` (four value outputs). The member pane has no candle to draw them
// with, and four lines would be a picture TradingView never shows — so the door
// must (a) draw none of the four, (b) say so by name, and (c) not offer a setting
// that only moves the candle (`display = useBarColor ? display.all : display.none`
// in kernel-channel-backquant).
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition, loadRuntimeLaneDoor } from './memberPaneDefinition'

beforeAll(async () => { await loadRuntimeLaneDoor() })
afterEach(() => { vi.unstubAllEnvs() })

const REPO = path.resolve(process.cwd(), '..')
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus/committed', `${name}.pine`), 'utf8')

function door(source) {
  vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
  return memberPaneDefinition({ source, id: 'u_member-pane-rtw3', name: 'T' })
}

// A host-refused (`pine:state`) script, so the runtime fallback is asked.
const CANDLE = `//@version=6
indicator("t", overlay = true)
bool useBarColor = input.bool(false, "Color Bars")
var float m = 0.0
m := m + close
plot(m / (bar_index + 1), "Mean")
plotcandle(open, high, low, close, "Bar Coloring", color.red, color.red, true, display = useBarColor ? display.all : display.none)
`

describe('⭐ plotcandle through the member door', () => {
  it('⭐ attaches in the runtime lane, draws only the plot, and says the candle is not drawn', () => {
    const d = door(CANDLE)
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(d.rows.filter((r) => !r.colourFor).map((r) => r.label)).toEqual(['Mean'])
    const cols = Object.values(d.definition.compute.columns).map((c) => c.call)
    expect(cols).not.toContain('plotcandle')
    expect(d.notes.map((n) => n.note).join(' ')).toMatch(/`plotcandle` \(line 7\) draws candles, which this pane does not draw yet/)
  })

  it('⭐ a setting that only moves the candle is not offered as a knob that moves nothing', () => {
    // ⚠️ It is withheld because the lane never READS it — `display =` is
    // presentation the runtime does not evaluate — so it never reaches the
    // input list at all, and no per-setting sentence is written for it. The
    // candle's own sentence (above) is what the member reads.
    const d = door(CANDLE)
    expect(d.ok, d.reason).toBe(true)
    expect((d.definition.inputs || []).map((i) => i.key)).not.toContain('pine_useBarColor')
  })

  it('⭐ kernel-channel-backquant and nonlinear-regression-zero-lag-moving-average-loxx attach in the runtime lane', () => {
    for (const name of ['kernel-channel-backquant__d8c4b7f75c',
      'nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888']) {
      const d = door(corpus(name))
      expect(d.ok, `${name}: ${d.guard} ${d.reason}`).toBe(true)
      expect(d.lane, name).toBe('runtime')
    }
  })
})
