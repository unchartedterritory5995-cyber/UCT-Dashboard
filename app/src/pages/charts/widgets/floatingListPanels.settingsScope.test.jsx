// app/src/pages/charts/widgets/floatingListPanels.settingsScope.test.jsx
//
// ⭐ POLICY A for the two floating list windows (owner ruling 2026-11-02). Both
// mount a Watchlists table and own no persisted store, so a ⚙ edit made in one
// is scoped to THAT window for the session. Before this, each mounted its table
// without a sink and Watchlists wrote the edit to the member's GLOBAL
// watchlist_settings — restyling every list they own.
//
// The table is stubbed to the ONE seam under test (`settingsOverride` in,
// `onSettingsPersist` out); `settingsScope.rail.test.js` proves by AST that the
// real table writes global exactly when that seam is missing.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

const H = vi.hoisted(() => ({ setPref: null, prefs: {}, seen: [] }))

vi.mock('../../../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => ({ prefs: H.prefs, setPref: H.setPref, loading: false }) }
})
vi.mock('../useExtraGroupsEnabled', () => ({ default: () => false }))
vi.mock('./EtfHoldingsResults', () => ({ default: (p) => { H.seen.push(p); return <div>holdings</div> } }))
vi.mock('./PeriodSortResults', () => ({ default: (p) => { H.seen.push(p); return <div>sort</div> } }))

const { default: EtfHoldingsPanel } = await import('./EtfHoldingsPanel')
const { default: PeriodSortPanel } = await import('../PeriodSortPanel')

const GLOBAL_TEMPLATE = { bg: '#111111', upColor: '#00aa00' }

beforeEach(() => {
  cleanup()
  H.setPref = vi.fn()
  H.prefs = { watchlist_settings: JSON.stringify(GLOBAL_TEMPLATE) }
  H.seen.length = 0
})

const CASES = [
  ['EtfHoldingsPanel (View Holdings)', () => <EtfHoldingsPanel sym="XLK" onClose={() => {}} />],
  ['PeriodSortPanel (Custom-Period Sort)', () => <PeriodSortPanel start={20260101} end={20260201} onClose={() => {}} />],
]

describe.each(CASES)('%s keeps its list settings to itself', (_name, el) => {
  it('passes a sink, seeds from the member\'s own template, and a write never touches global', () => {
    render(el())
    const first = H.seen.at(-1)
    expect(typeof first.onSettingsPersist, 'no sink — Watchlists would write global').toBe('function')
    // Unchanged look on open: the member's own template, as the sink-less table read it.
    expect(first.settingsOverride).toEqual(GLOBAL_TEMPLATE)
    const edited = { ...GLOBAL_TEMPLATE, bg: '#222222' }
    act(() => first.onSettingsPersist(edited))
    expect(H.seen.at(-1).settingsOverride).toEqual(edited)
    // The table's own Reset sends null: back to the seed, still nothing global.
    act(() => H.seen.at(-1).onSettingsPersist(null))
    expect(H.seen.at(-1).settingsOverride).toEqual(GLOBAL_TEMPLATE)
    expect(H.setPref).not.toHaveBeenCalled()
  })
})

describe('EtfHoldingsPanel keeps the host chart\'s look as its seed', () => {
  it('a host-provided wlOverride still wins over the global template', () => {
    const host = { bg: '#eaf3fb' }
    render(<EtfHoldingsPanel sym="XLK" onClose={() => {}} wlOverride={host} />)
    expect(H.seen.at(-1).settingsOverride).toEqual(host)
  })
})
