/**
 * A preferences restore belongs to the member who started it (lib/prefsSession `beginPrefsOp`).
 *
 * The restore is one POST per key, awaited in sequence, and the session is one cookie per browser:
 * another tab signing in as B mid-restore made every remaining POST land in B's account. The repro:
 * A confirms a three-key restore, the first POST is in flight, B signs in, the first POST answers.
 * Nothing further may be sent, nothing may claim "Imported", and the page must not reload as if done.
 * Control: the same member's restore sends all three.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../lib/prefsSession'

import { PreferencesBackupCard, RESTORE_STOPPED_SWITCH } from '../Settings'

const BACKUP = {
  type: 'uct-intelligence-preferences', version: 1, exported_at: '2026-10-01T12:00:00.000Z',
  preferences: { charts_theme: 'default', alert_sound: 'chime', charts_merged: 'true' },
}

let posts
let release
function mockFetch({ holdFirstPost = false, holdPost = holdFirstPost ? 1 : 0 } = {}) {
  posts = []
  release = null
  globalThis.fetch = vi.fn((url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences' && method === 'GET') {
      return Promise.resolve({ ok: true, headers: { get: () => 'v=5' }, json: () => Promise.resolve({}) })
    }
    if (url === '/api/auth/preferences' && method === 'POST') {
      posts.push(JSON.parse(opts.body))
      const answer = { ok: true, json: () => Promise.resolve({ ok: true }) }
      if (holdPost && posts.length === holdPost) return new Promise((resolve) => { release = () => resolve(answer) })
      return Promise.resolve(answer)
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`))
  })
}
const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })

async function confirmRestore() {
  render(<PreferencesBackupCard />)
  const input = screen.getByLabelText('Choose a preferences backup file')
  const file = { text: () => Promise.resolve(JSON.stringify(BACKUP)) }
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Import 3' }))
  await flush()
}

let reload
beforeEach(() => {
  __resetPrefsSessionForTests()
  publishPrefsUser('A')
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  __resetPrefsSessionForTests()
  delete globalThis.fetch
})

describe('preferences restore across an account switch', () => {
  it('B signs in while A\'s restore is mid-flight: no further key is sent, nothing claims Imported, no reload', async () => {
    mockFetch({ holdFirstPost: true })
    await confirmRestore()
    expect(posts).toHaveLength(1)                        // A's first key is in flight
    act(() => { publishPrefsUser('B') })                 // another tab signed in as B
    await act(async () => { release() })
    await flush()
    expect(posts).toHaveLength(1)                        // the other two never reach B's account
    expect(screen.getByText(RESTORE_STOPPED_SWITCH)).toBeInTheDocument()
    expect(screen.queryByText(/^Imported/)).toBeNull()
    act(() => { vi.advanceTimersByTime(1500) })
    expect(reload).not.toHaveBeenCalled()
  })

  it('B signs in while A\'s LAST key is in flight: no "Imported" for B and no reload of B\'s page', async () => {
    mockFetch({ holdPost: 3 })
    await confirmRestore()
    expect(posts).toHaveLength(3)
    act(() => { publishPrefsUser('B') })
    await act(async () => { release() })
    await flush()
    expect(screen.queryByText(/^Imported/)).toBeNull()
    expect(screen.getByText(RESTORE_STOPPED_SWITCH)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1500) })
    expect(reload).not.toHaveBeenCalled()
  })

  it('B signs in after A confirmed but before the head read answered: nothing is sent at all', async () => {
    mockFetch()
    render(<PreferencesBackupCard />)
    const input = screen.getByLabelText('Choose a preferences backup file')
    await act(async () => { fireEvent.change(input, { target: { files: [{ text: () => Promise.resolve(JSON.stringify(BACKUP)) }] } }) })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Import 3' }))
    act(() => { publishPrefsUser('B') })                 // the head read is still awaiting
    await flush()
    expect(posts).toEqual([])
    expect(screen.getByText(RESTORE_STOPPED_SWITCH)).toBeInTheDocument()
  })

  it('control: the same member\'s restore sends every key and says Imported', async () => {
    mockFetch({ holdFirstPost: true })
    await confirmRestore()
    await act(async () => { release() })
    await flush()
    expect(posts.map((p) => p.key)).toEqual(['charts_theme', 'alert_sound', 'charts_merged'])
    expect(posts.every((p) => p.base_version === 5)).toBe(true)
    expect(screen.getByText('Imported 3 preferences')).toBeInTheDocument()
    expect(screen.queryByText(RESTORE_STOPPED_SWITCH)).toBeNull()
    act(() => { vi.advanceTimersByTime(1500) })
    expect(reload).toHaveBeenCalledTimes(1)              // the reload spy is live (so the switch case's "not called" means something)
  })
})
