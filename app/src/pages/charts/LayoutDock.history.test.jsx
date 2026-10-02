// COV-06 through the Layout Dock: the "Version history" door on a named layout.
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import LayoutDock from './LayoutDock'
import { UCT_DEFAULT_ID } from './layoutDockPins'

let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref: vi.fn(), loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

const ENTRIES = [
  { id: UCT_DEFAULT_ID, name: 'UCT Default', scope: 'global' },
  { id: 5, name: 'Prebuilt Swing', scope: 'global' },
  { id: 1, name: 'Main Trading', scope: 'user' },
]
const RAIL = { pins: [UCT_DEFAULT_ID, 5, 1], known: [UCT_DEFAULT_ID, 5, 1], hidden: false }
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

async function flush() {
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
}
function stubFetch(armed, extra = {}) {
  global.fetch = vi.fn(async (url, init) => {
    if (url === '/api/artifact-versions/status') return armed ? res(200, { enabled: true }) : res(404, {})
    if (extra[url]) return extra[url](init)
    return res(404, {})
  })
}
const openMenu = async (name) => {
  fireEvent.contextMenu(screen.getByRole('button', { name }))
  await flush()
}

beforeEach(() => { mockPrefs = { charts_layout_dock: JSON.stringify(RAIL) } })
afterEach(() => { delete global.fetch })

test('dark: no Version history entry on any layout', async () => {
  stubFetch(false)
  render(<LayoutDock entries={ENTRIES} activeId={1} />)
  await openMenu('Main Trading')
  expect(screen.getByRole('menu', { name: 'Main Trading actions' })).toBeInTheDocument()
  expect(screen.queryByTestId('layout-history-open')).toBeNull()
})

test('armed: offered on YOUR layout, never on a prebuilt or UCT Default', async () => {
  stubFetch(true)
  render(<LayoutDock entries={ENTRIES} activeId={1} />)
  await openMenu('Main Trading')
  expect(screen.getByTestId('layout-history-open')).toBeInTheDocument()
  await openMenu('Prebuilt Swing')
  expect(screen.queryByTestId('layout-history-open')).toBeNull()
  await openMenu('UCT Default')
  expect(screen.queryByTestId('layout-history-open')).toBeNull()
})

test('a restore hands the restored row to the workspace', async () => {
  const row = { id: 1, name: 'Main Trading', scope: 'user', layout: { widgets: [], cols: 24 } }
  stubFetch(true, {
    '/api/artifact-versions/layout/1': () => res(200, { versions: [
      { version: 2, source: 'save', created_at: 1_800_000_100 },
      { version: 1, source: 'save', created_at: 1_800_000_000 },
    ] }),
    '/api/artifact-versions/layout/1/restore': () => res(200, { appended: true, version: 3, artifact: row }),
  })
  const onRestored = vi.fn()
  render(<LayoutDock entries={ENTRIES} activeId={1} onRestored={onRestored} />)
  await openMenu('Main Trading')
  fireEvent.click(screen.getByTestId('layout-history-open'))
  await flush()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' })) })
  await flush()
  expect(onRestored).toHaveBeenCalledWith(row)
})
