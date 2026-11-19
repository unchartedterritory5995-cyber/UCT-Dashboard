// app/src/components/chart/builder/memberPane/costRoute.test.js
//
// ⭐⭐ ROUTE BY COST (Engine 73 (#1711)) — a host document moves to the runtime lane only when the run's
// document draws the same picture (`costRoute.js::sameDrawnSurface`). Each difference the measured
// corpus showed is railed with its control (docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md).
import { describe, it, expect } from 'vitest'
import { sameDrawnSurface, drawnSurfaceOf, COST_ROUTE_SURFACE } from './costRoute'

const astA = { type: 'series', name: 'close' }
const astB = { type: 'series', name: 'open' }
/** A host answer: rows name their tree, the translation lists outputs by tree. */
const host = ({ plots, paints = [], objects = null, outputs = [{ ast: astA }, { ast: astB }] } = {}) => ({
  definition: { plots, paints, ...(objects ? { objects } : {}) },
  rows: plots.filter((p) => p.out !== undefined).map((p) => ({ key: p.key, ast: outputs[p.out].ast })),
  translation: { outputs },
})
/** A runtime answer: rows name the output they draw. */
const run = ({ plots, paints = [], objects = null } = {}) => ({
  definition: { plots, paints, ...(objects ? { objects } : {}) },
  rows: plots.filter((p) => p.out !== undefined).map((p) => ({ key: p.key, output: p.out })),
  translation: { outputs: [{ ast: astA }, { ast: astB }] },
})
const line = (key, out, extra = {}) => ({ key, out, style: 'line', ...extra })

describe('sameDrawnSurface', () => {
  const H = () => host({ plots: [line('h0', 0), line('h1', 1)] })

  it('the same plots, by the output they draw (keys differ between lanes), are the same picture', () => {
    const r = run({ plots: [line('r0', 0), line('r1', 1)] })
    expect(sameDrawnSurface(H(), r)).toEqual({ ok: true })
    expect(drawnSurfaceOf(H()).visible).toEqual(drawnSurfaceOf(r).visible)
  })

  it('a plot the run does not draw is a different picture (opening-range lost seven markers)', () => {
    const r = run({ plots: [line('r0', 0)] })
    const v = sameDrawnSurface(H(), r)
    expect(v.ok).toBe(false)
    expect(v.code).toBe(COST_ROUTE_SURFACE)
    expect(v.why).toMatch(/1 the run does not draw/)
  })

  it('a row the host hides and the run draws is a different picture (keltner\'s fill anchors)', () => {
    const h = host({ plots: [line('h0', 0), line('h1', 1, { hidden: true })] })
    const r = run({ plots: [line('r0', 0), line('r1', 1)] })
    expect(sameDrawnSurface(h, r).ok).toBe(false)
    // control: hidden on both is the same picture
    expect(sameDrawnSurface(h, run({ plots: [line('r0', 0), line('r1', 1, { hidden: true })] })).ok).toBe(true)
  })

  it('a fill the run does not draw is a different picture (the runtime lane draws no fill yet)', () => {
    const h = host({ plots: [line('h0', 0), line('h1', 1), { key: 'f', fill: { a: 'h0', b: 'h1' } }] })
    const v = sameDrawnSurface(h, run({ plots: [line('r0', 0), line('r1', 1)] }))
    expect(v.ok).toBe(false)
    expect(v.why).toMatch(/fills \(1 against 0\)/)
  })

  it('a different style for the same output is a different picture', () => {
    const r = run({ plots: [line('r0', 0, { style: 'markers' }), line('r1', 1)] })
    expect(sameDrawnSurface(H(), r).ok).toBe(false)
  })

  it('horizontal lines, paints and drawings are each compared', () => {
    const hl = host({ plots: [line('h0', 0), line('h1', 1), { key: 'g', style: 'hlines' }] })
    expect(sameDrawnSurface(hl, run({ plots: [line('r0', 0), line('r1', 1)] })).why).toMatch(/horizontal lines/)
    const hp = host({ plots: [line('h0', 0), line('h1', 1)], paints: [{ kind: 'bgcolor' }] })
    expect(sameDrawnSurface(hp, run({ plots: [line('r0', 0), line('r1', 1)] })).why).toMatch(/background and bar colours/)
    const ho = host({ plots: [line('h0', 0), line('h1', 1)], objects: { ops: [{ k: 'create' }] } })
    expect(sameDrawnSurface(ho, run({ plots: [line('r0', 0), line('r1', 1)] })).why).toMatch(/drawings/)
    // control: the same paints and drawings on both
    const rp = run({ plots: [line('r0', 0), line('r1', 1)], paints: [{ kind: 'bgcolor' }], objects: { ops: [{ k: 'create' }] } })
    const hpo = host({ plots: [line('h0', 0), line('h1', 1)], paints: [{ kind: 'bgcolor' }], objects: { ops: [{ k: 'create' }] } })
    expect(sameDrawnSurface(hpo, rp)).toEqual({ ok: true })
  })
})
