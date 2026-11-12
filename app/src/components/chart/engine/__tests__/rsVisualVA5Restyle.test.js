// app/src/components/chart/engine/__tests__/rsVisualVA5Restyle.test.js
//
// UCT RS Phase 2a VISUAL, unit VA5 (contract "Plot restyle opt-out", spec A6):
// a plot declaring `restyle: false` is offered no Plot style (`availableStyles`
// answers []), and the resolver draws it as declared whatever is stored, so a
// style stored before the opt-out cannot turn a dot column into an empty line.
// Control: every plot without the field keeps its offer and its resolution.
import { describe, it, expect } from 'vitest'
import { availableStyles, resolvePlotStyle, isPlotRestyleable } from '../presentation'
import { styleChoicesFor } from '../styleCapability'
import * as registry from '../nativeRegistry'

const dot = { key: 'dotNH', style: 'markers', color: '#6ba3be', width: 2 }
const optedOut = { ...dot, restyle: false }

describe('isPlotRestyleable', () => {
  it('absent or true means yes; only an explicit false opts out', () => {
    expect(isPlotRestyleable(dot)).toBe(true)
    expect(isPlotRestyleable({ ...dot, restyle: true })).toBe(true)
    expect(isPlotRestyleable(optedOut)).toBe(false)
    expect(isPlotRestyleable(null)).toBe(false)
  })
})

describe('availableStyles', () => {
  it('a markers plot is restyleable until it opts out', () => {
    expect(availableStyles(dot, {}).length).toBeGreaterThan(0)
    expect(availableStyles(optedOut, {})).toEqual([])
    expect(availableStyles(optedOut, { ohlcCapable: true, allowedStyles: ['line', 'dots'] })).toEqual([])
  })
})

describe('resolvePlotStyle', () => {
  const stored = { presentation: { plots: { dotNH: { style: 'line' } } } }
  const instanceLevel = { presentation: { plotStyle: 'area' } }
  it('an opted-out plot draws as declared over a per-output, an instance-level or a source default', () => {
    expect(resolvePlotStyle(stored, optedOut, {})).toBe('dots')
    expect(resolvePlotStyle(instanceLevel, optedOut, {})).toBe('dots')
    expect(resolvePlotStyle({}, optedOut, { sourceDefaultStyle: 'line' })).toBe('dots')
  })
  it('control: without the opt-out the stored style still wins', () => {
    expect(resolvePlotStyle(stored, dot, {})).toBe('line')
    expect(resolvePlotStyle(instanceLevel, dot, {})).toBe('area')
    expect(resolvePlotStyle({}, dot, {})).toBe('dots')
  })
})

describe('control — no shipped definition other than UCT RS declares the opt-out', () => {
  it('every non-RS plot is restyleable, so every other Plot style offer is unchanged', () => {
    const defs = registry.listDefinitions()
    expect(defs.length).toBeGreaterThan(10)
    for (const def of defs) {
      if (def.id === 'rsLine') continue
      // 2026-11-12 (RS Exit Warnings): its three glyph dots opt out like the RS line's (a sparse dot column
      // restyled as a line draws nothing); the next case pins that none of them is offered a Plot style.
      if (def.id === 'rsExit') continue
      for (const p of def.plots || []) expect(isPlotRestyleable(p), `${def.id}.${p.key}`).toBe(true)
    }
  })

  it('UCT RS: styleChoicesFor never lists a plot that opts out', () => {
    const def = registry.getDefinition('rsLine')
    const inst = { instanceId: 'legacy:rsLine', defId: 'rsLine', inputs: {} }
    const offered = styleChoicesFor(def, inst, { indicatorInstances: [inst] }).map((c) => c.key)
    for (const p of def.plots) if (p.restyle === false) expect(offered).not.toContain(p.key)
    for (const k of ['rsLine', 'rsMa', 'mansfield']) expect(offered).toContain(k)
  })

  it('UCT RS Exit Warnings: styleChoicesFor offers the line and the averages, never a dot (2026-11-12)', () => {
    const def = registry.getDefinition('rsExit')
    const inst = { instanceId: 'user:rsExit:1', defId: 'rsExit', inputs: {} }
    const offered = styleChoicesFor(def, inst, { indicatorInstances: [inst] }).map((c) => c.key)
    for (const k of ['dotQuick', 'dotQuicksand', 'dotDead']) {
      expect(def.plots.find((p) => p.key === k).restyle, k).toBe(false)
      expect(offered, k).not.toContain(k)
    }
    for (const k of ['rsLine', 'fast', 'slow']) expect(offered, k).toContain(k)
  })
})
