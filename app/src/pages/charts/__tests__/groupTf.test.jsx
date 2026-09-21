// ── The linked chart's timeframe reaches the list widgets that warm for it ────
//
// The defect this rails: embedded in the /charts workspace, Theme Tracker and
// Watchlists hide their OWN chart panel, so their internal `chartPeriod` never
// left its 'D' default — yet all of their bar warming was keyed on it. A user
// scanning a theme on 5m had every flip warm SYM_D while the linked ChartWidget
// read SYM_5, so EVERY switch was a cold client cache (measured: 287ms p50 to
// first paint cold vs 12ms warm).
//
// The channel is `groupTfs` on the workspace: ChartWidget publishes the tf of
// its active color group, the scoped ChartsSymContext carries it to the wrapped
// list. It is deliberately EPHEMERAL — `opts.tf` stays the persisted authority.

import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { test, expect, vi } from 'vitest'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'
import { ChartsSymContext, useChartsSym } from '../ChartsSymContext'
import ThemesWidget from '../widgets/ThemesWidget'

// The wrapped page is replaced by a probe that reports what useChartsSym gives it.
vi.mock('../../ThemeTrackerPage', () => ({
  default: () => {
    const { sym, tf } = useChartsSym()
    return <div data-testid="probe" data-sym={String(sym)} data-tf={String(tf)} />
  },
}))

// A miniature workspace: holds groupSyms + the ephemeral groupTfs, and exposes
// setGroupTf the way ChartsWorkspace does (bail-when-unchanged included).
function Workspace({ children }) {
  const [groupSyms, setGroupSyms] = useState({ A: 'AAPL', B: null, C: null, D: null })
  const [groupTfs, setGroupTfs] = useState({ A: 'D', B: 'D', C: 'D', D: 'D' })
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(p => ({ ...p, [c]: s })),
    groupTfs,
    setGroupTf: (c, t) => setGroupTfs(p => (p[c] === t ? p : { ...p, [c]: t })),
  }
  return <WorkspaceContext.Provider value={value}>{children(value)}</WorkspaceContext.Provider>
}

test('ThemesWidget hands the wrapped list its color group timeframe', () => {
  let ws = null
  render(
    <Workspace>
      {(value) => { ws = value; return <ThemesWidget color="A" opts={{}} /> }}
    </Workspace>,
  )
  // Baseline: no chart has published, so the group sits on the seeded default.
  expect(screen.getByTestId('probe').getAttribute('data-tf')).toBe('D')

  // A ChartWidget in group A retimes to 5m → the list must see 5m, not 'D'.
  act(() => { ws.setGroupTf('A', '5') })
  expect(screen.getByTestId('probe').getAttribute('data-tf')).toBe('5')
})

test('a timeframe published to ANOTHER color group does not leak', () => {
  let ws = null
  render(
    <Workspace>
      {(value) => { ws = value; return <ThemesWidget color="A" opts={{}} /> }}
    </Workspace>,
  )
  act(() => { ws.setGroupTf('B', '60') })
  expect(screen.getByTestId('probe').getAttribute('data-tf')).toBe('D')
})

test('setGroupTf returns the SAME object when unchanged (no render storm)', () => {
  // ChartWidget publishes from an effect on every tf/color commit; a new object
  // each time would re-render every workspace consumer on every chart paint.
  const reducer = (prev, c, t) => (prev[c] === t ? prev : { ...prev, [c]: t })
  const a = { A: 'D', B: 'D', C: 'D', D: 'D' }
  expect(reducer(a, 'A', 'D')).toBe(a)
  expect(reducer(a, 'A', '5')).not.toBe(a)
})

test('useChartsSym falls back to group A tf with no explicit provider', () => {
  function Probe() {
    const { tf } = useChartsSym()
    return <div data-testid="p" data-tf={String(tf)} />
  }
  render(
    <WorkspaceContext.Provider value={{
      groupSyms: { A: 'SPY' }, setGroupSym: () => {}, groupTfs: { A: '15' },
    }}>
      <Probe />
    </WorkspaceContext.Provider>,
  )
  expect(screen.getByTestId('p').getAttribute('data-tf')).toBe('15')
})

test('an explicit provider WITHOUT tf yields undefined, not group A’s', () => {
  // Contract for older providers: undefined means "no linked chart", and the
  // list must fall back to its own on-page selector rather than silently
  // inheriting some other group's timeframe.
  function Probe() {
    const { tf } = useChartsSym()
    return <div data-testid="p" data-tf={String(tf)} />
  }
  render(
    <WorkspaceContext.Provider value={{
      groupSyms: { A: 'SPY' }, setGroupSym: () => {}, groupTfs: { A: '15' },
    }}>
      <ChartsSymContext.Provider value={{ sym: 'TSLA', setSym: () => {} }}>
        <Probe />
      </ChartsSymContext.Provider>
    </WorkspaceContext.Provider>,
  )
  expect(screen.getByTestId('p').getAttribute('data-tf')).toBe('undefined')
})

test('WorkspaceContext fallback seeds every group so a hostless list never reads undefined', () => {
  expect(WORKSPACE_FALLBACK.groupTfs).toEqual({ A: 'D', B: 'D', C: 'D', D: 'D' })
  expect(typeof WORKSPACE_FALLBACK.setGroupTf).toBe('function')
})
