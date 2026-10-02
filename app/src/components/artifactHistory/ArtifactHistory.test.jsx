// COV-06 — the version-history list for a saved screen / named layout.
// The fetches are the path under test: a URL-routed fetch stub answers them.
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import ArtifactHistory, { probeArtifactVersions, versionSourceLabel } from './ArtifactHistory'

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const V = (version, source = 'save', extra = {}) => ({ version, source, label: 'Leaders', restored_from: null, created_at: 1_800_000_000 + version * 60, ...extra })

async function flush() {
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
}

let calls
function stubFetch(routes) {
  calls = []
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
    for (const [match, answer] of routes) {
      if (url === match || (match instanceof RegExp && match.test(url))) {
        return typeof answer === 'function' ? answer(url, init) : answer
      }
    }
    return res(500, {})
  })
}
afterEach(() => { delete global.fetch })

const LIST = '/api/artifact-versions/screen/7'
const RESTORE = '/api/artifact-versions/screen/7/restore'

test('the probe is true only on a 200 status answer — a dark 404 hides the control', async () => {
  stubFetch([['/api/artifact-versions/status', res(404, { detail: 'Not Found' })]])
  expect(await probeArtifactVersions()).toBe(false)
  stubFetch([['/api/artifact-versions/status', res(200, { enabled: true })]])
  expect(await probeArtifactVersions()).toBe(true)
})

test('dark: the list answers 404, the panel renders nothing and tells its host', async () => {
  stubFetch([[LIST, res(404, {})]])
  const onUnavailable = vi.fn()
  const { container } = render(<ArtifactHistory kind="screen" artifactId={7} onUnavailable={onUnavailable} />)
  await flush()
  expect(container.innerHTML).toBe('')
  expect(onUnavailable).toHaveBeenCalledTimes(1)
})

test('lists newest first; the head is Current and is not offered for restore', async () => {
  stubFetch([[LIST, res(200, { head: 3, versions: [V(3), V(2, 'restore', { restored_from: 1 }), V(1, 'baseline')] })]])
  render(<ArtifactHistory kind="screen" artifactId={7} />)
  await flush()
  expect(screen.getByTestId('artifact-version-3').textContent).toContain('Current')
  expect(screen.queryByRole('button', { name: 'Restore version 3' })).toBeNull()
  expect(screen.getByTestId('artifact-version-2').textContent).toContain('Restored from version 1')
  expect(screen.getByTestId('artifact-version-1').textContent).toContain('As it was before this history began')
})

test('restore posts the version and the head it was based on, then names the undo', async () => {
  let head = 2
  stubFetch([
    [LIST, () => res(200, { versions: head === 2 ? [V(2), V(1)] : [V(3, 'restore', { restored_from: 1 }), V(2), V(1)] })],
    [RESTORE, () => { head = 3; return res(200, { appended: true, version: 3, artifact: { id: 7, name: 'Leaders' } }) }],
  ])
  const onRestored = vi.fn()
  render(<ArtifactHistory kind="screen" artifactId={7} onRestored={onRestored} />)
  await flush()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' })) })
  await flush()
  const post = calls.find(c => c.method === 'POST')
  expect(post.body).toEqual({ version: 1, base_version: 2 })
  expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ version: 3, artifact: { id: 7, name: 'Leaders' } }))
  expect(screen.getByRole('status').textContent).toBe('Restored version 1. To undo, restore version 2.')
  // Nothing was removed: the version the restore replaced is still offered.
  expect(screen.getByRole('button', { name: 'Restore version 2' })).toBeInTheDocument()
})

test('a stale base (409) is never retried: the list is re-read and the member is told', async () => {
  stubFetch([
    [LIST, res(200, { versions: [V(2), V(1)] })],
    [RESTORE, res(409, { detail: { error: 'version_conflict' } })],
  ])
  const onRestored = vi.fn()
  render(<ArtifactHistory kind="screen" artifactId={7} onRestored={onRestored} />)
  await flush()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' })) })
  await flush()
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
  expect(calls.filter(c => c.url === LIST)).toHaveLength(2)
  expect(onRestored).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toMatch(/^This changed after the list was loaded, so nothing was restored/)
})

test('no read ever writes: mounting and listing make GETs only', async () => {
  stubFetch([[LIST, res(200, { versions: [V(2), V(1)] })]])
  render(<ArtifactHistory kind="screen" artifactId={7} />)
  await flush()
  expect(calls.every(c => c.method === 'GET')).toBe(true)
})

test('source words', () => {
  expect(versionSourceLabel({ source: 'save' })).toBe('Saved')
  expect(versionSourceLabel({ source: 'restore', restored_from: 4 })).toBe('Restored from version 4')
})
