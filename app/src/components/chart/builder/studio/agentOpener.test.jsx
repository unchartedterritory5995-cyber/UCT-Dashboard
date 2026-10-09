// app/src/components/chart/builder/studio/agentOpener.test.jsx
//
// ⭐ AGENT MILESTONE 1 — `openCreateIndicatorFor({defId?, seed?})`, the door UCT Agent
// opens Create Indicator through. Its promises, each failable here:
//   * it checks ACCESS itself (admin + flag, or the cohort) and answers by reason;
//   * a seed is PREFILLED into the box and never sent (no converse request at all);
//   * a draft already kept for the chart WINS over the seed;
//   * an unknown definition refuses; the existing boolean opener is unchanged.
import { createRef } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import ChartToolbar from '../../ChartToolbar'
import { mergeChartSettings } from '../../chartDefaults'
import { AuthContext } from '../../../../context/AuthContext'
import { setCreateIndicatorFlag, CREATE_INDICATOR_FLAG_KEY } from './createIndicatorFlag'
import { writeSession, clearSession, createKey, chartScope } from '../authoring/conversationSessions'
import { newAuthoringState } from '../authoring/authoringState'
import STOCKCHART_SRC from '../../../StockChart.jsx?raw'
import PANE_SRC from '../../pane/ChartPane.jsx?raw'

const CHART = 'w-agent-m1-test'

function mount({ role = 'admin', writable = true, preview = true } = {}) {
  const ref = createRef()
  render(
    <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role }, loading: false }}>
      <ChartToolbar
        ref={ref}
        activeTool="cursor"
        setActiveTool={() => {}}
        chartId={CHART}
        chartSettings={mergeChartSettings(null)}
        onUpdateSettings={writable ? vi.fn() : undefined}
        onStudioPreview={preview ? vi.fn() : undefined}
      />
    </AuthContext.Provider>,
  )
  return { ref }
}
const box = () => screen.findByTestId('create-indicator-input')

afterEach(() => {
  cleanup()
  try { localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY) } catch { /* */ }
  clearSession(createKey(chartScope(CHART)))
})

describe('openCreateIndicatorFor — the Agent door', () => {
  it('⛔ refuses by reason: no access (flag off, or a member), read-only chart, unknown definition', () => {
    const a = mount()
    let r
    act(() => { r = a.ref.current.openCreateIndicatorFor({ seed: 'RSI' }) })
    expect(r).toEqual({ ok: false, reason: 'access', prefilled: false, draft: false, editing: false })
    cleanup()
    act(() => { setCreateIndicatorFlag(true) })
    const m = mount({ role: 'user' })
    act(() => { r = m.ref.current.openCreateIndicatorFor({ seed: 'RSI' }) })
    expect(r.reason).toBe('access')
    cleanup()
    const ro = mount({ writable: false })
    act(() => { r = ro.ref.current.openCreateIndicatorFor({}) })
    expect(r.reason).toBe('readonly')
    cleanup()
    const u = mount()
    act(() => { r = u.ref.current.openCreateIndicatorFor({ defId: 'u_ffffffffffff' }) })
    expect(r.reason).toBe('unknown-definition')
    expect(screen.queryByTestId('create-indicator')).toBeNull()      // nothing opened
  })

  it('⭐ a seed is PREFILLED into the box — never sent — and the panel is the ordinary one', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const t = mount()
    let r
    act(() => { r = t.ref.current.openCreateIndicatorFor({ seed: '  Help me build an\tRSI indicator ' }) })
    expect(r).toEqual({ ok: true, prefilled: true, draft: false, editing: false })
    const input = await box()
    expect(input.value).toBe('Help me build an RSI indicator')
    expect(fetchSpy.mock.calls.some((c) => /converse/.test(String(c[0])))).toBe(false)  // NOTHING sent
    expect(screen.getByTestId('create-indicator').dataset.revision).toBe('0')            // nothing applied
    fetchSpy.mockRestore()
  })

  it('⭐ a draft kept for this chart WINS: restored as today, the seed is not applied', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    writeSession(createKey(chartScope(CHART)), { state: newAuthoringState(), transcript: [{ role: 'member', text: 'make an EMA' }], acked: false })
    const t = mount()
    let r
    act(() => { r = t.ref.current.openCreateIndicatorFor({ seed: 'Help me build an RSI indicator' }) })
    expect(r).toEqual({ ok: true, prefilled: false, draft: true, editing: false })
    const input = await box()
    expect(input.value).toBe('')
    expect(screen.getByTestId('create-indicator').textContent).toMatch(/make an EMA/)
  })

  it('already open: nothing is typed over the box; the plain opener is unchanged (boolean) and now checks access', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    const t = mount()
    let ok
    act(() => { ok = t.ref.current.openCreateIndicator() })
    expect(ok).toBe(true)
    await box()
    let r
    act(() => { r = t.ref.current.openCreateIndicatorFor({ seed: 'RSI' }) })
    expect(r).toEqual({ ok: true, prefilled: false, draft: false, editing: false })
    expect((await box()).value).toBe('')
    cleanup()
    act(() => { setCreateIndicatorFlag(false) })
    const n = mount()
    act(() => { ok = n.ref.current.openCreateIndicator() })
    expect(ok).toBe(false)                                            // ⭐ the access check
  })
})

describe('the route UCT Agent reaches it by (source rails)', () => {
  it('StockChart forwards openCreateIndicatorFor; ChartPane exposes it (closing settings first) and canCreateIndicator', () => {
    expect(STOCKCHART_SRC).toMatch(/openCreateIndicatorFor: \(opts = null\) => \{[\s\S]{0,200}toolbarRef\.current\?\.openCreateIndicatorFor\?\.\(opts\)/)
    // ⭐ the opener is called FIRST; Chart Settings closes only when it actually opened
    expect(PANE_SRC).toMatch(/openCreateIndicatorFor: \(opts = null\) => \{[\s\S]{0,260}res = paneToolbarApi\.current\?\.openCreateIndicatorFor\?\.\(opts\)[\s\S]{0,300}if \(res && res\.ok\) setSettingsOpen\(false\)/)
    expect(PANE_SRC).not.toMatch(/openCreateIndicatorFor: \(opts = null\) => \{\s*setSettingsOpen\(false\)/)
    expect(PANE_SRC).toMatch(/canCreateIndicator: \(\) => \{ try \{ return !!paneToolbarApi\.current\?\.canModifyWithIntelligence\?\.\(\)/)
  })
})

describe('a seed lives for one opening', () => {
  it('after an Agent prefill is closed, the plain Create Indicator button opens an EMPTY box', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    const t = mount()
    act(() => { t.ref.current.openCreateIndicatorFor({ seed: 'Help me build an RSI indicator' }) })
    expect((await box()).value).toBe('Help me build an RSI indicator')
    act(() => { screen.getByRole('button', { name: /close/i }).click() })
    expect(screen.queryByTestId('create-indicator')).toBeNull()
    act(() => { t.ref.current.openCreateIndicator() })
    expect((await box()).value).toBe('')
  })
})
