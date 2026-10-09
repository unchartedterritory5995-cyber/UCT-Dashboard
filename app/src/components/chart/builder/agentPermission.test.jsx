// app/src/components/chart/builder/agentPermission.test.jsx
//
// ⭐ AGENT M2 — `canManageIndicators()`, the authoritative "may this chart's indicators be
// added / removed / shown / hidden?" It is the Indicators button's OWN predicate (a chart
// with settings and a way to save them), reached from the ChartPane handle UCT Agent holds.
import { createRef } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import ChartToolbar from '../ChartToolbar'
import { mergeChartSettings } from '../chartDefaults'
import { AuthContext } from '../../../context/AuthContext'
import STOCKCHART_SRC from '../../StockChart.jsx?raw'
import PANE_SRC from '../pane/ChartPane.jsx?raw'
import TOOLBAR_SRC from '../ChartToolbar.jsx?raw'

function mount({ settings = true, writable = true, role = 'member' } = {}) {
  const ref = createRef()
  render(
    <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role }, loading: false }}>
      <ChartToolbar ref={ref} activeTool="cursor" setActiveTool={() => {}} chartId="w-agent-m2"
        chartSettings={settings ? mergeChartSettings(null) : undefined}
        onUpdateSettings={writable ? vi.fn() : undefined} />
    </AuthContext.Provider>,
  )
  return ref
}
afterEach(cleanup)

describe('canManageIndicators — the same answer as the Indicators button', () => {
  for (const [label, opts, want] of [
    ['a writable chart', {}, true],
    ['a read-only mount (no save path)', { writable: false }, false],
    ['a chart with no settings', { settings: false }, false],
  ]) {
    it(`${label} → ${want}`, () => {
      const ref = mount(opts)
      expect(ref.current.canManageIndicators()).toBe(want)
      // the Indicator Library's own opener is gated by the same predicate
      let opened
      act(() => { opened = ref.current.openIndicatorLibrary() })
      expect(opened).toBe(want)
    })
  }
  it('is not the Create Indicator access gate: a member without the flag can still manage indicators', () => {
    const ref = mount({ role: 'member' })
    expect(ref.current.canManageIndicators()).toBe(true)
    expect(ref.current.canModifyWithIntelligence()).toBe(false)
  })
})

describe('the route UCT Agent reaches it by (source rails)', () => {
  it('ChartToolbar answers with its own predicate; StockChart and ChartPane forward it', () => {
    expect(TOOLBAR_SRC).toMatch(/const canManageIndicators = !!\(chartSettings && onUpdateSettings\)/)
    expect(TOOLBAR_SRC).toMatch(/canManageIndicators: \(\) => canManageIndicators,/)
    expect(STOCKCHART_SRC).toMatch(/canManageIndicators: \(\) => \{\s*try \{ return !!toolbarRef\.current\?\.canManageIndicators\?\.\(\) \} catch \{ return false \}/)
    expect(PANE_SRC).toMatch(/canManageIndicators: \(\) => \{ try \{ return !!paneToolbarApi\.current\?\.canManageIndicators\?\.\(\) \} catch \{ return false \} \}/)
  })
})
