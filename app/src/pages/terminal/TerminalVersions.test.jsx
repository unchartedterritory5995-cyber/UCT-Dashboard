// FIX 3: a restore success must survive a transiently-failing post-restore list refresh.
// FIX 4b: a tombstoned version's disabled Restore button explains why, via title/tooltip.
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import TerminalVersions from './TerminalVersions'

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

const BASE = '/api/workspace/doc'
const VERSIONS = [
  { version: 2, source: 'mirror', created_at: 1790002000, tombstone: false, restored_from: null },
  { version: 1, source: 'migration', created_at: 1790001000, tombstone: false, restored_from: null },
]
const VERSIONS_WITH_TOMBSTONE = [
  { version: 3, source: 'mirror', created_at: 1790003000, tombstone: false, restored_from: null },
  { version: 2, source: 'delete', created_at: 1790002000, tombstone: true, restored_from: null },
  { version: 1, source: 'migration', created_at: 1790001000, tombstone: false, restored_from: null },
]

async function flush() {
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })
}

afterEach(() => { delete global.fetch })

test('FIX 3: restore succeeds, then the list refresh fails — success is kept, refresh failure is a separate lesser notice', async () => {
  let listCall = 0
  global.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const method = (init?.method || 'GET').toUpperCase()
    if (method === 'GET' && u.startsWith(`${BASE}/versions?`)) {
      listCall += 1
      if (listCall === 1) return res(200, { versions: VERSIONS })
      return res(500, {}) // the post-restore refresh fails
    }
    if (method === 'POST' && u === `${BASE}/restore`) return res(200, {})
    return res(404, {})
  })

  render(<TerminalVersions />)
  await flush()

  fireEvent.click(screen.getByTestId('terminal-restore-1'))
  await flush()

  // The success message must still be visible…
  expect(screen.getByText(/restored version 1/i)).toBeInTheDocument()
  // …and the failed refresh is reported too, but as a distinct, lesser notice.
  expect(screen.getByTestId('terminal-versions-refresh-notice').textContent).toMatch(/couldn.?t refresh the list/i)
  // The list itself (stale, from the first successful load) must still render — not an error screen.
  expect(screen.getByTestId('terminal-versions')).toBeInTheDocument()
})

test('FIX 3: restore succeeds and the refresh also succeeds — only the success message shows', async () => {
  global.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const method = (init?.method || 'GET').toUpperCase()
    if (method === 'GET' && u.startsWith(`${BASE}/versions?`)) return res(200, { versions: VERSIONS })
    if (method === 'POST' && u === `${BASE}/restore`) return res(200, {})
    return res(404, {})
  })

  render(<TerminalVersions />)
  await flush()

  fireEvent.click(screen.getByTestId('terminal-restore-1'))
  await flush()

  expect(screen.getByText(/restored version 1/i)).toBeInTheDocument()
  expect(screen.queryByTestId('terminal-versions-refresh-notice')).toBeNull()
})

test('FIX 4b: a tombstoned version\'s disabled Restore button has a title explaining why', async () => {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith(`${BASE}/versions?`)) return res(200, { versions: VERSIONS_WITH_TOMBSTONE })
    return res(404, {})
  })

  render(<TerminalVersions />)
  await flush()

  const tombstoned = screen.getByTestId('terminal-restore-2')
  expect(tombstoned).toBeDisabled()
  expect(tombstoned.title).toMatch(/cleared|can no longer be restored/i)

  // A normal, non-tombstoned, non-current version carries no such explanation.
  const normal = screen.getByTestId('terminal-restore-1')
  expect(normal).not.toBeDisabled()
  expect(normal.title).toBe('')
})
