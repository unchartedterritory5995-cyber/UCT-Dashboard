// COV-06 follow-up — Recently deleted + the history panel in deleted mode.
// A URL-routed fetch stub answers like api/routers/artifact_versions.py.
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import RecentlyDeleted from './RecentlyDeleted'
import ArtifactHistory, { versionSourceLabel } from './ArtifactHistory'

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
async function flush() {
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
}
let calls
function stubFetch(routes) {
  calls = []
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
    for (const [match, answer] of routes) {
      if (url === match) return typeof answer === 'function' ? answer(url, init) : answer
    }
    return res(500, {})
  })
}
afterEach(() => { delete global.fetch })

const DELETED = '/api/artifact-versions/layout/deleted'
const ROW = { artifact_id: 12, label: 'Swing board', head: 4, deleted_at: 1_800_000_000 }

test('dark (404) and nothing-deleted both render nothing', async () => {
  stubFetch([[DELETED, res(404, {})]])
  const { container, unmount } = render(<RecentlyDeleted kind="layout" />)
  await flush()
  expect(container.innerHTML).toBe('')
  unmount()
  stubFetch([[DELETED, res(200, { deleted: [] })]])
  const r2 = render(<RecentlyDeleted kind="layout" />)
  await flush()
  expect(r2.container.innerHTML).toBe('')
})

test('Bring back posts the head version as the base, then says it is back and re-reads', async () => {
  let rows = [ROW]
  stubFetch([
    [DELETED, () => res(200, { deleted: rows })],
    ['/api/artifact-versions/layout/12/undelete', () => { rows = []; return res(200, { artifact: { id: 12, name: 'Swing board' }, version: 5 }) }],
  ])
  const onBroughtBack = vi.fn()
  render(<RecentlyDeleted kind="layout" noun="layout" onBroughtBack={onBroughtBack} />)
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Recently deleted (1)' }))
  expect(screen.getByTestId('deleted-layout-12').textContent).toContain('Swing board')
  fireEvent.click(screen.getByRole('button', { name: 'Bring back Swing board' }))
  await flush()
  expect(calls.find(c => c.method === 'POST')).toEqual({
    url: '/api/artifact-versions/layout/12/undelete', method: 'POST', body: { version: 4, base_version: 4 } })
  expect(onBroughtBack).toHaveBeenCalledWith({ artifact: { id: 12, name: 'Swing board' }, version: 5 })
  expect(screen.getByRole('status').textContent).toBe('“Swing board” is back.')
  expect(screen.queryByTestId('deleted-layout-12')).toBeNull()
})

test('a refused bring-back (409) says so by name and writes nothing else', async () => {
  stubFetch([
    [DELETED, res(200, { deleted: [ROW] })],
    ['/api/artifact-versions/layout/12/undelete', res(409, { detail: { error: 'version_conflict' } })],
  ])
  const onBroughtBack = vi.fn()
  render(<RecentlyDeleted kind="layout" onBroughtBack={onBroughtBack} />)
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Recently deleted (1)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Bring back Swing board' }))
  await flush()
  expect(onBroughtBack).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toBe(
    '“Swing board” changed or is already back, so nothing was restored. The list has been refreshed.')
})

test('deleted mode: every version, the newest included, is offered as Bring back via /undelete', async () => {
  stubFetch([
    ['/api/artifact-versions/screen/7', res(200, { head: 3, versions: [
      { version: 3, source: 'delete', label: 'Leaders', created_at: 1_800_000_180 },
      { version: 2, source: 'save', label: 'Leaders', created_at: 1_800_000_120 }] })],
    ['/api/artifact-versions/screen/7/undelete', res(200, { artifact: { id: 7 }, version: 4 })],
  ])
  const onRestored = vi.fn()
  render(<ArtifactHistory kind="screen" artifactId={7} deleted onRestored={onRestored} />)
  await flush()
  expect(screen.getByTestId('artifact-version-3').textContent).toContain('Deleted (as it was when deleted)')
  expect(screen.queryByText('Current')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Bring back version 2' }))
  await flush()
  expect(calls.find(c => c.method === 'POST')).toEqual({
    url: '/api/artifact-versions/screen/7/undelete', method: 'POST', body: { version: 2, base_version: 3 } })
  expect(onRestored).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toBe('Brought back from version 2.')
  expect(versionSourceLabel({ source: 'delete' })).toBe('Deleted (as it was when deleted)')
})
