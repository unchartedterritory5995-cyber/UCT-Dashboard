// app/src/components/chart/engine/__tests__/rsScaleToRatingTarget.test.js
//
// ─── "Scale to rating" moves the UCT RS Line to its own pane (2026-11-12) ──────
//
// The scale exists to be READ, and the price pane gives the line an invisible
// overlay scale that can show no axis. So while a rating is chosen the AUTOMATIC
// destination is the line's own pane (`placement.axisWhen`, read by
// `displayTarget.resolveDisplayTarget`), where the axis shows. Proved through a
// fresh module graph with the slim definition registered, as the build registers
// it under `VITE_RS_SPLIT_ENABLED=1` (`rsSplitFlagOn.test.jsx`'s method):
//
//   · Off (and a saved chart with no key): 'price', exactly as before;
//   · on: 'pane', and the pane layout's own-pane set includes the instance;
//   · a member's explicit destination still wins (price stays price);
//   · a legacy restatement of the declared target does not pin it to price.
import { describe, it, expect, vi, afterEach } from 'vitest'

async function fresh() {
  vi.resetModules()
  vi.stubEnv('VITE_RS_SPLIT_ENABLED', '1')
  const reg = await import('../nativeRegistry')
  const dt = await import('../displayTarget')
  return { reg, dt }
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

const inst = (inputs, placement) => ({
  instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs, ...(placement ? { placement } : {}),
})

describe('the automatic destination follows the scale', () => {
  it('off: on the price pane, as every saved chart is', async () => {
    const { reg, dt } = await fresh()
    expect(reg.getDefinition('rsLine').meta.name).toBe('UCT RS Line')
    expect(dt.resolveDisplayTarget(inst({}), {})).toBe('price')
    expect(dt.resolveDisplayTarget(inst({ scaleToRating: 'off' }), {})).toBe('price')
  })

  it('on: its own pane, and the layout carves one for it', async () => {
    const { dt } = await fresh()
    for (const choice of ['ibd', 'm6', 'm12']) {
      expect(dt.resolveDisplayTarget(inst({ scaleToRating: choice }), {})).toBe('pane')
    }
    const on = inst({ scaleToRating: 'ibd' })
    expect([...dt.paneOwnKeys([on], { indicatorInstances: [on] })]).toEqual(['inst:rsLine:1'])
    expect(dt.automaticTargetOf({ indicatorInstances: [on] }, on)).toBe('pane')
  })

  it('a member\'s explicit choice wins; a legacy restatement of "price" does not', async () => {
    const { dt } = await fresh()
    expect(dt.resolveDisplayTarget(inst({ scaleToRating: 'ibd' }, { target: 'price', targetExplicit: true }), {})).toBe('price')
    expect(dt.resolveDisplayTarget(inst({ scaleToRating: 'ibd' }, { target: 'price' }), {})).toBe('pane')
    expect(dt.resolveDisplayTarget(inst({}, { target: 'pane', targetExplicit: true }), {})).toBe('pane')
  })
})
