// TERM-051: the version-history restore panel, on its own.
//
// Member-facing copy is asserted by RENDERED TEXT (CLAUDE.md, 2026-09-09): a
// state transition that is right while the sentence is blank is the defect class
// this repo has shipped twice. The workspace-level rails (the entry point inside
// the real Layouts menu, the board reloading after a restore, the STATE-2 guard)
// are in VersionHistory.workspace.test.jsx.
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'
import VersionHistoryPanel, {
  VersionHistoryMenuItem,
  diffPrefs,
  formatVersionTime,
  probeVersionHistory,
  WORKSPACE_DOC_URL,
} from './VersionHistory'

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const LAYOUT_NOW = JSON.stringify({ widgets: [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], cols: 24, version: 1 })
const LAYOUT_OLD = JSON.stringify({ widgets: [{ id: 's1', type: 'scanner', x: 0, y: 0, w: 24, h: 20 }], cols: 24, version: 1 })

const VERSIONS = [
  { version: 3, source: 'mirror', created_at: 1790003000, tombstone: false, restored_from: null },
  { version: 2, source: 'restore', created_at: 1790002000, tombstone: false, restored_from: 1 },
  { version: 1, source: 'migration', created_at: 1790001000, tombstone: false, restored_from: null },
]
const DOCS = {
  3: { schema_version: 1, board: 'charts', prefs: { charts_workspace_layout: LAYOUT_NOW, chart_settings: '{"a":1}' } },
  2: { schema_version: 1, board: 'charts', prefs: { charts_workspace_layout: LAYOUT_NOW, chart_settings: '{"a":1}' } },
  1: { schema_version: 1, board: 'charts', prefs: { charts_workspace_layout: LAYOUT_OLD } },
}

/** A fetch that answers the workspace-doc routes from a small in-memory store. */
function storeFetch({ listStatus = 200, restore } = {}) {
  const calls = { list: 0, restore: [] }
  const fn = vi.fn(async (url, init) => {
    const u = String(url)
    const method = (init?.method || 'GET').toUpperCase()
    if (method === 'GET' && u.startsWith(`${WORKSPACE_DOC_URL}/versions?`)) {
      calls.list += 1
      if (listStatus !== 200) return res(listStatus, { detail: 'Not Found' })
      return res(200, { board: 'charts', versions: VERSIONS })
    }
    const m = u.match(/\/versions\/(\d+)\?/)
    if (method === 'GET' && m) {
      const v = Number(m[1])
      return res(200, { version: v, tombstone: false, doc: DOCS[v] })
    }
    if (method === 'POST' && u === `${WORKSPACE_DOC_URL}/restore`) {
      const body = JSON.parse(init.body)
      calls.restore.push(body)
      return restore ? restore(body) : res(404, {})
    }
    return res(404, { detail: 'Not Found' })
  })
  fn.calls = calls
  return fn
}

async function flush() {
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })
}

afterEach(() => { delete global.fetch })

describe('the entry point', () => {
  test('store DARK (404): the entry point renders NOTHING, not a disabled control', async () => {
    global.fetch = storeFetch({ listStatus: 404 })
    const { container } = render(<VersionHistoryMenuItem onOpen={() => {}} />)
    await flush()
    // Non-vacuity: the probe really asked the store, and the store really said 404.
    expect(global.fetch.calls.list).toBe(1)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByText(/version history/i)).toBeNull()
  })

  test('CONTROL: store armed (200 with a list): the same entry point renders and opens', async () => {
    global.fetch = storeFetch()
    const onOpen = vi.fn()
    render(<VersionHistoryMenuItem onOpen={onOpen} />)
    const btn = await screen.findByRole('button', { name: /version history/i })
    fireEvent.click(btn)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('a 200 that is not a version list, an error or no network all read as unavailable', async () => {
    global.fetch = vi.fn(async () => res(200, { widgets: [] }))
    expect(await probeVersionHistory()).toBe(false)
    global.fetch = vi.fn(async () => res(500, {}))
    expect(await probeVersionHistory()).toBe(false)
    global.fetch = vi.fn(async () => { throw new TypeError('network') })
    expect(await probeVersionHistory()).toBe(false)
    delete global.fetch
    expect(await probeVersionHistory()).toBe(false)
  })
})

describe('the panel', () => {
  test('store DARK while open: the panel renders nothing and asks its host to drop it', async () => {
    global.fetch = storeFetch({ listStatus: 404 })
    const onUnavailable = vi.fn()
    const { container } = render(<VersionHistoryPanel onClose={() => {}} onRestored={() => {}} onUnavailable={onUnavailable} />)
    await flush()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
  })

  test('lists versions newest first with timestamp and source, and marks the current head', async () => {
    global.fetch = storeFetch()
    render(<VersionHistoryPanel onClose={() => {}} onRestored={() => {}} />)
    const list = await screen.findByRole('list', { name: 'Board versions' })
    const items = within(list).getAllByRole('listitem')
    expect(items.map(li => li.textContent.match(/Version \d+/)[0])).toEqual(['Version 3', 'Version 2', 'Version 1'])
    expect(items[0].textContent).toContain('Current')
    expect(items[0].textContent).toContain('Board saved')
    expect(items[1].textContent).toContain('Restored from version 1')
    expect(items[2].textContent).toContain('First saved copy of your board')
    const t = items[2].querySelector('time')
    expect(t.getAttribute('datetime')).toBe(new Date(1790001000 * 1000).toISOString())
    expect(t.textContent).toBe(formatVersionTime(1790001000))
    // The head is the board as it is now: it is not offered as a restore.
    expect(within(items[0]).queryByRole('button')).toBeNull()
  })

  test('Escape inside the dialog closes it; the close button closes it', async () => {
    global.fetch = storeFetch()
    const onClose = vi.fn()
    render(<VersionHistoryPanel onClose={onClose} onRestored={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Version history' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close version history' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('happy path: preview names the keys that differ, restore is CAS on the head it was based on', async () => {
    global.fetch = storeFetch({
      restore: (body) => res(200, {
        board: 'charts', version: 4, appended: true, restored_from: body.version,
        prefs_written: ['charts_workspace_layout'], prefs_unchanged: [], prefs_failed: [],
        left_untouched: ['chart_settings'], complete: true,
      }),
    })
    const onRestored = vi.fn()
    render(<VersionHistoryPanel onClose={() => {}} onRestored={onRestored} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Version 1,/ }))
    expect(await screen.findByText('Restoring version 1 changes: Board layout.')).toBeInTheDocument()
    expect(screen.getByText('Not in this version, so kept as they are now: Chart settings.')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' })) })
    await flush()
    expect(global.fetch.calls.restore).toEqual([{ version: 1, base_version: 3, board: 'charts' }])
    expect(onRestored).toHaveBeenCalledTimes(1)
    expect(onRestored.mock.calls[0][0]).toMatchObject({ restored_from: 1, complete: true })
  })

  test('a version identical to the head offers no restore and says why', async () => {
    global.fetch = storeFetch()
    render(<VersionHistoryPanel onClose={() => {}} onRestored={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Version 2,/ }))
    expect(await screen.findByText('Version 2 matches your current board. There is nothing to restore.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Restore version/ })).toBeNull()
  })

  test('409 (stale base): re-fetches the list, says so, and NEVER retries the restore', async () => {
    global.fetch = storeFetch({
      restore: () => res(409, { detail: { error: 'version_conflict', base_version: 3, head_version: 5 } }),
    })
    const onRestored = vi.fn()
    render(<VersionHistoryPanel onClose={() => {}} onRestored={onRestored} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Version 1,/ }))
    await screen.findByText('Restoring version 1 changes: Board layout.')
    expect(global.fetch.calls.list).toBe(1)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' })) })
    await flush()

    expect(global.fetch.calls.list).toBe(2)            // re-fetched
    expect(global.fetch.calls.restore).toHaveLength(1)  // never retried
    expect(onRestored).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(
      'Your board changed after this list was loaded, so nothing was restored. The list has been refreshed. Choose the version again.',
    )
    // The stale choice is cleared: the member picks again from the fresh list.
    expect(screen.queryByRole('button', { name: /^Restore version/ })).toBeNull()
  })
})

describe('diffPrefs', () => {
  test('changes are keys the version holds with a different value; kept are keys only the head holds', () => {
    expect(diffPrefs({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual({ changes: ['b'], kept: ['c'] })
    expect(diffPrefs({ a: '1' }, null)).toEqual({ changes: ['a'], kept: [] })
    expect(diffPrefs({ a: '1' }, { a: '1' })).toEqual({ changes: [], kept: [] })
  })
})
