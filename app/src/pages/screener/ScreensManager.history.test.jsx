// COV-06 — the History door on a My-screens row, and "save the current filters
// into it", which exists ONLY where the overwrite can be undone. Same data-source
// mocks as ScreensManager.test.jsx; the artifact-versions fetches are routed.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi } from 'vitest'

const update = vi.fn(async () => {})
const refresh = vi.fn()
vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({
    saved: [{ id: 9, name: 'My RSI', spec: { view: 'technical' }, is_public: false, share_token: null }],
    starters: [], error: null,
    create: vi.fn(), update, remove: vi.fn(), refresh,
  }),
}))
vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => ({ rows: [], error: null, refresh: vi.fn() }),
  deleteUserDefinition: vi.fn(),
}))
vi.mock('../../components/screener/ScanResults', () => ({ default: () => <div /> }))
vi.mock('./hooks/useScreenerMeta', () => ({ default: () => ({ meta: null, isLoading: false }), META_KEY: '/api/screener/meta' }))

import ScreensManager from './ScreensManager'

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
async function flush() {
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
}
function stubFetch(armed) {
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/artifact-versions/status') return armed ? res(200, { enabled: true }) : res(404, {})
    if (url === '/api/artifact-versions/screen/9') return armed
      ? res(200, { versions: [{ version: 1, source: 'save', created_at: 1_800_000_000, label: 'My RSI' }] })
      : res(404, {})
    return res(404, {})
  })
}
const CURRENT = { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }], view: 'technical' }
async function openMenu() {
  render(<ScreensManager currentSpec={CURRENT} onApply={() => {}} onUseScan={vi.fn()} />)
  fireEvent.click(screen.getByText('Screener ▾'))
  await flush()
}

beforeEach(() => { update.mockClear(); refresh.mockClear() })
afterEach(() => { delete global.fetch })

test('dark: no History control, so no overwrite-in-place either', async () => {
  stubFetch(false)
  await openMenu()
  expect(screen.getByRole('button', { name: 'Rename My RSI' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'History of My RSI' })).toBeNull()
  expect(screen.queryByText(/Save the current filters into/)).toBeNull()
})

test('armed: History opens the list; saving the current filters goes through the one update door', async () => {
  stubFetch(true)
  await openMenu()
  fireEvent.click(screen.getByRole('button', { name: 'History of My RSI' }))
  await flush()
  expect(screen.getByTestId('artifact-history-screen-9')).toBeInTheDocument()
  expect(screen.getByTestId('artifact-version-1').textContent).toContain('Current')
  await act(async () => { fireEvent.click(screen.getByText('Save the current filters into “My RSI”')) })
  await flush()
  expect(update).toHaveBeenCalledWith(9, { spec: CURRENT })
})
