import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { WorkspaceContext } from './WorkspaceContext'

// COV-10 remainder: what colour KEY a widget body links through. A stored E-H while
// CHARTS_EXTRA_GROUPS_ENABLED is off must be NOT LINKED (its own per-widget key),
// never a silent shared fifth group, and the stored colour must reach nothing else.
const authState = vi.hoisted(() => ({ value: {} }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authState.value }))
vi.mock('./widgets/ChartWidget', () => ({ default: ({ color }) => <div data-testid="body-chart" data-key={color} /> }))

import WidgetHost from './WidgetHost'

afterEach(() => { authState.value = {} })

const wsValue = { groupSyms: { A: null, B: null, C: null, D: null }, setGroupSym: () => {} }

function keyFor(color, id = 'w1') {
  const { unmount } = render(
    <WorkspaceContext.Provider value={wsValue}>
      <WidgetHost widget={{ id, type: 'chart', color, opts: {} }} onRemove={() => {}} onColorChange={() => {}} onOptsChange={() => {}} />
    </WorkspaceContext.Provider>,
  )
  const k = screen.getByTestId('body-chart').getAttribute('data-key')
  unmount()
  return k
}

test('OFF: base groups link through their own letter, N is per-widget (unchanged)', () => {
  expect(keyFor('A')).toBe('A')
  expect(keyFor('N')).toMatch(/^N:/)
})

test('OFF: a stored E links through a per-widget not-linked key, not "E"', () => {
  const k = keyFor('E')
  expect(k).not.toBe('E')
  expect(k).toMatch(/^N:/)
  // Two suspended widgets do not share a group with each other either.
  expect(keyFor('E', 'w2')).not.toBe(k)
})

test('ON: a stored E is the shared group E', () => {
  authState.value = { chartsExtraGroupsEnabled: true }
  expect(keyFor('E')).toBe('E')
  expect(keyFor('H', 'w2')).toBe('H')
})
