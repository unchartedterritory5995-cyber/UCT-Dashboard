// P2 Track B — the ephemeral preview seam. ASKED / CLAIMED / DID per case.
import { describe, it, expect, afterEach } from 'vitest'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { addInstance } from '../../engine/instanceControls'
import {
  STUDIO_PREVIEW_DEF_ID, previewInstanceFor, withPreviewInstance, stripPreview, isPreviewInstanceId,
} from './chartPreview'
import { newAuthoringState, applyTurn } from '../authoring'
import { stampSemantics } from '../../engine/definitionSemantics'

const C = 'uct.authoring.patch/1'
const ema = (n) => ({ type: 'call', name: 'ema', args: [{ type: 'series', name: 'close' }, { type: 'num', value: n }] })

/** The working definition the engine builds for "Add a <n> EMA". */
function working(n) {
  const s0 = newAuthoringState()
  const { state } = applyTurn(s0, { contract: C, baseRevision: 0, ops: [{ op: 'create', name: `EMA ${n}`, placement: 'price', outputs: [{ key: 'value', tree: ema(n), label: `EMA ${n}` }] }] })
  return state.working
}
const preview = (n, version = 1) => stampSemantics({ ...working(n), id: STUDIO_PREVIEW_DEF_ID, version }, { prior: null })

afterEach(() => registry.clearUserDefinitions())

describe('studio preview — one identity, never stored', () => {
  it('the preview instance is the instance Save would add, under a stable id across turns', () => {
    // ASKED: does turn 2 make a second preview?  CLAIMED: no — same instance id.
    const cs = mergeChartSettings({})
    registry.installUserDefinitions([preview(20, 1)])
    const a = previewInstanceFor(cs, registry)
    registry.installUserDefinitions([preview(50, 2)])
    const b = previewInstanceFor(cs, registry)
    expect(a.defId).toBe(STUDIO_PREVIEW_DEF_ID)
    expect(a.instanceId).toBe(b.instanceId)
    expect(isPreviewInstanceId(a.instanceId)).toBe(true)
    // DID: the stored blob is untouched by computing it
    expect((cs.indicatorInstances || []).some((i) => i.defId === STUDIO_PREVIEW_DEF_ID)).toBe(false)
  })

  it('withPreviewInstance replaces, never appends a second preview, and is identity without one', () => {
    const cs = mergeChartSettings({})
    registry.installUserDefinitions([preview(20)])
    const inst = previewInstanceFor(cs, registry)
    const v1 = withPreviewInstance(cs, inst)
    const v2 = withPreviewInstance(v1, { ...inst, inputs: {} })
    expect(v2.indicatorInstances.filter((i) => i.defId === STUDIO_PREVIEW_DEF_ID)).toHaveLength(1)
    expect(withPreviewInstance(cs, null)).toBe(cs)
  })

  it('stripPreview removes every reference and keeps identity when there is none', () => {
    const cs = mergeChartSettings({})
    expect(stripPreview(cs)).toBe(cs)
    registry.installUserDefinitions([preview(20)])
    const inst = previewInstanceFor(cs, registry)
    const leaked = {
      ...withPreviewInstance(cs, inst),
      indicators: { ...(cs.indicators || {}), [STUDIO_PREVIEW_DEF_ID]: { enabled: true } },
      paneOrder: ['price', inst.instanceId, 'volume'],
      paneSizes: { [inst.instanceId]: 0.2, volume: 0.1 },
      paneSeriesOrder: { price: ['ema9', `${inst.instanceId}:value`], [inst.instanceId]: ['x'] },
      header: { ...(cs.header || {}), infoValues: [{ instanceId: inst.instanceId, plotKey: 'value', format: 'auto' }] },
    }
    const out = stripPreview(leaked)
    expect(JSON.stringify(out)).not.toContain(STUDIO_PREVIEW_DEF_ID)
    expect(out.paneOrder).toEqual(['price', 'volume'])
    expect(out.paneSizes).toEqual({ volume: 0.1 })
    expect(out.paneSeriesOrder).toEqual({ price: ['ema9'] })
    expect(out.indicatorInstances).toEqual(cs.indicatorInstances)
  })

  it('a real saved instance (a different def id) survives the strip', () => {
    registry.installUserDefinitions([{ ...working(20), id: 'u_aaaaaaaaaaaa', version: 1 }])
    const saved = addInstance(mergeChartSettings({}), 'u_aaaaaaaaaaaa', registry)
    expect(stripPreview(saved)).toBe(saved)
  })
})

describe('the registry install key — one fixed preview id is enough', () => {
  it('re-installing a CHANGED tree under the same id+version replaces the installed copy', () => {
    // ASKED: can "make it 50" re-install under one fixed id and version?
    // DID: yes — the install key carries compute.fn, the tree's sha256.
    registry.installUserDefinitions([preview(20, 1)])
    const before = registry.getDefinition(STUDIO_PREVIEW_DEF_ID).compute.fn
    registry.installUserDefinitions([preview(50, 1)])
    const after = registry.getDefinition(STUDIO_PREVIEW_DEF_ID)
    expect(JSON.stringify(after)).toContain('"value":50')
    expect(after.compute.fn).not.toBe(before)
  })
})
