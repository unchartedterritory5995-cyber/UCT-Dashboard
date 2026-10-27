// ⭐ A1 INTERIM TWO-UNDO CONTRACT — the pane's two settings doors (docs/indicators/a1/A1-INTERIM-UNDO-CONTRACT.md).
//
// ChartPane's imperative API carries BOTH doors onto a chart's settings:
//   · `applySettingsRecorded(next, {label, kind})` — a member's template apply (the right-click
//     "Chart template" menu): recorded once on this chart's indicator Undo stack (`chart:<chartId>`);
//   · `applySettings(next)` — unrecorded. It is also the door an Agent-side write reaches a pane by,
//     and the Agent keeps its OWN exact Undo, so a record here would be a second copy of one change.
// And a template's Undo is exact or nothing: once the chart moved on, it is REFUSED, never partial.
import { render, act } from '@testing-library/react'
import { createRef } from 'react'
import { vi, test, expect, beforeEach } from 'vitest'

vi.mock('../../StockChart', () => ({ default: () => <div data-testid="chart" /> }))
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
vi.mock('../ChartSettingsModal', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({ default: () => <span /> }))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({ default: () => <span /> }))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({ default: () => <div /> }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))

import ChartPane from './ChartPane'
import { mergeChartSettings } from '../chartDefaults'
import { adoptOverlayAverages } from '../maAdoption'
import {
  peekIndicatorHistory, undoIndicatorChange, _resetIndicatorHistoryForTests,
} from '../indicatorHistoryStore'

const KEY = 'chart:w1'
const load = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
const hideAll = (cs) => ({ ...cs, indicatorInstances: (cs.indicatorInstances || []).map(i => (i && !i.deleted ? { ...i, hidden: true } : i)) })

let stored
let writes
function mount() {
  const ref = createRef()
  const view = render(
    <ChartPane ref={ref} sym="NVDA" tf="D" chartId="w1" stored={stored}
      onStore={(next) => { writes.push(next); stored = next }} />,
  )
  const rerender = () => view.rerender(
    <ChartPane ref={ref} sym="NVDA" tf="D" chartId="w1" stored={stored}
      onStore={(next) => { writes.push(next); stored = next }} />,
  )
  return { ref, rerender }
}
const past = () => peekIndicatorHistory(KEY, { userId: null }).past

beforeEach(() => {
  _resetIndicatorHistoryForTests()
  try { sessionStorage.clear() } catch { /* */ }
  stored = load({})
  writes = []
})

test('a template applied through applySettingsRecorded is ONE entry on chart:<chartId>, labelled and kinded', () => {
  const { ref } = mount()
  const before = load(stored)
  expect(before.indicatorInstances.filter(i => !i.deleted).length).toBeGreaterThan(0)
  const next = { ...hideAll(before), preset: 'custom' }
  act(() => ref.current.applySettingsRecorded(next, { label: 'Applied template “Swing”', kind: 'template' }))
  expect(writes).toHaveLength(1)
  expect(past()).toHaveLength(1)
  expect(past()[0]).toMatchObject({ label: 'Applied template “Swing”', kind: 'template' })
})

test('⛔ applySettings (the unrecorded door — the Agent keeps its own Undo) records NOTHING', () => {
  const { ref } = mount()
  act(() => ref.current.applySettings({ ...hideAll(load(stored)), preset: 'custom' }))
  expect(writes).toHaveLength(1)
  expect(past()).toHaveLength(0)
  expect(sessionStorage.length === 0 || [...Array(sessionStorage.length)].every((_, i) => !String(sessionStorage.key(i)).startsWith('uct.indicators.history.v1:'))).toBe(true)
})

test('a template Undo is exact while nothing moved, and the entry is consumed', () => {
  const { ref, rerender } = mount()
  const before = load(stored)
  act(() => ref.current.applySettingsRecorded(hideAll(before), { label: 'Applied template “Swing”', kind: 'template' }))
  rerender()
  let r
  act(() => { r = undoIndicatorChange(KEY, load(stored), (cs) => { stored = cs }, { userId: null }) })
  expect(r.ok).toBe(true)
  expect(load(stored).indicatorInstances.map(i => !!i.hidden)).toEqual(before.indicatorInstances.map(i => !!i.hidden))
  expect(past()).toHaveLength(0)
})

test('⛔ STALE: the chart moved on since the template (an unrecorded write to the same indicator) — Undo is REFUSED and writes nothing', () => {
  const { ref, rerender } = mount()
  const before = load(stored)
  act(() => ref.current.applySettingsRecorded(hideAll(before), { label: 'Applied template “Swing”', kind: 'template' }))
  rerender()
  const first = load(stored).indicatorInstances.find(i => i && !i.deleted)
  // e.g. an Agent "show" of that indicator, through the unrecorded door
  act(() => ref.current.applySettings({ ...load(stored), indicatorInstances: load(stored).indicatorInstances.map(i => (i.instanceId === first.instanceId ? { ...i, hidden: false } : i)) }))
  rerender()
  const snapshot = JSON.stringify(stored)
  let wrote = false
  let r
  act(() => { r = undoIndicatorChange(KEY, load(stored), () => { wrote = true }, { userId: null }) })
  expect(r).toMatchObject({ ok: false, reason: 'changed-since' })
  expect(wrote).toBe(false)
  expect(JSON.stringify(stored)).toBe(snapshot)
  expect(past()).toHaveLength(1)                                                   // the entry stays where it was
})
