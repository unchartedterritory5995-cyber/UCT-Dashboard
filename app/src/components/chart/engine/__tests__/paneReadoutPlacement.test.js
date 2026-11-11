import { describe, it, expect } from 'vitest'
import { rendererPaneIndexOf } from '../paneReadoutPlacement'

const series = (idx) => ({ getPane: () => ({ paneIndex: () => idx }) })
// Pane keys are host instance ids; a guest names its host.
const HOSTS = { 'inst:a': 'inst:a', 'inst:b': 'inst:b', 'inst:ma': 'inst:b' }
const hostOf = (c) => HOSTS[c.instanceId] || null

describe('rendererPaneIndexOf -- a pane readout goes where its series drew', () => {
  it('an EMPTY host above a drawn one: the empty key has no pane, the drawn key keeps its REAL index', () => {
    // The measured defect: the layout gave inst:a slot 2 and inst:b slot 3, but
    // inst:a is all-NaN, so the renderer put inst:b in pane 2.
    const bindings = [{ instanceId: 'inst:b', series: series(2) }]
    expect(rendererPaneIndexOf('inst:a', bindings, hostOf)).toBe(null)
    expect(rendererPaneIndexOf('inst:b', bindings, hostOf)).toBe(2)
  })

  it('a GUEST places its host pane even when the host itself is hidden/undrawn', () => {
    const bindings = [{ instanceId: 'inst:ma', series: series(3) }]
    expect(rendererPaneIndexOf('inst:b', bindings, hostOf)).toBe(3)
  })

  it('bindings without a series never count as drawn', () => {
    expect(rendererPaneIndexOf('inst:a', [{ instanceId: 'inst:a', series: null }], hostOf)).toBe(null)
  })

  it('UNANSWERABLE is undefined, not null -- the caller keeps its old behaviour', () => {
    expect(rendererPaneIndexOf('inst:a', null, hostOf)).toBe(undefined)
    expect(rendererPaneIndexOf('inst:a', [], null)).toBe(undefined)
    const noPaneApi = [{ instanceId: 'inst:a', series: {} }]
    expect(rendererPaneIndexOf('inst:a', noPaneApi, hostOf)).toBe(undefined)
  })
})

// ⭐ UCT RS 3-14 — the band the arrangement reserved for a pane that drew nothing.
import { reservedEmptyPaneIndex } from '../paneReadoutPlacement'
describe('reservedEmptyPaneIndex', () => {
  const pane = (n) => ({ getSeries: () => Array.from({ length: n }, () => ({})) })
  it('the slot, when the renderer pane there exists and holds no series', () => {
    expect(reservedEmptyPaneIndex(2, [pane(1), pane(1), pane(0)])).toBe(2)
  })
  it('null when the pane at the slot holds somebody\'s series (never steal a caption)', () => {
    expect(reservedEmptyPaneIndex(1, [pane(1), pane(2)])).toBeNull()
  })
  it('null when there is no pane at the slot, no pane API, or a bad slot', () => {
    expect(reservedEmptyPaneIndex(3, [pane(1), pane(0)])).toBeNull()
    expect(reservedEmptyPaneIndex(1, [pane(1), {}])).toBeNull()
    expect(reservedEmptyPaneIndex(1, null)).toBeNull()
    expect(reservedEmptyPaneIndex(-1, [pane(0)])).toBeNull()
    expect(reservedEmptyPaneIndex(1.5, [pane(0), pane(0)])).toBeNull()
    expect(reservedEmptyPaneIndex(0, [{ getSeries: () => { throw new Error('x') } }])).toBeNull()
  })
})
