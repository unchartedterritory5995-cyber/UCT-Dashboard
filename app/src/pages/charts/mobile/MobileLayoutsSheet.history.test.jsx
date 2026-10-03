/* COV-06 phone door — version history + Recently deleted in the phone charts shell's
 * Layouts sheet, the same two entry points the desktop Layout Dock has. Dark
 * (status probe != 200) they are HIDDEN; armed, "Version history" is offered on
 * YOUR layouts only, a restore / bring-back hands the route's row to the workspace,
 * and every control the panel adds is at the 44px tap floor.
 */
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi, test, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MobileLayoutsSheet from './MobileLayoutsSheet'

const MINE = [{ id: 11, name: 'Swing board', scope: 'user' }]
const PREBUILT = [{ id: 90, name: 'UCT Standard', scope: 'global' }]
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
function mount(over = {}) {
  const props = {
    open: true, onClose: vi.fn(), mine: MINE, prebuilt: PREBUILT, active: null, isAdmin: true,
    onApply: vi.fn(), onApplyUctDefault: vi.fn(), onSaveCurrent: vi.fn(), onSaveAs: vi.fn(),
    onDelete: vi.fn(), onRestored: vi.fn(), ...over,
  }
  render(<MobileLayoutsSheet {...props} />)
  return props
}
afterEach(() => { delete global.fetch })

test('dark: no Version history control and no Recently deleted, and no /deleted read', async () => {
  stubFetch(false, { '/api/artifact-versions/layout/deleted': () => res(200, { deleted: [{ artifact_id: 9, label: 'X', head: 1 }] }) })
  mount()
  await flush()
  expect(screen.getByText('Swing board')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Version history of layout/ })).toBeNull()
  expect(screen.queryByTestId('recently-deleted-layout')).toBeNull()
  expect(global.fetch.mock.calls.map(c => c[0])).not.toContain('/api/artifact-versions/layout/deleted')
})

test('armed: offered on YOUR layout only, never on a firm prebuilt (even for an admin)', async () => {
  stubFetch(true)
  mount()
  await flush()
  expect(screen.getByRole('button', { name: 'Version history of layout Swing board' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Version history of layout UCT Standard' })).toBeNull()
})

test('a restore from the phone hands the restored row to the workspace', async () => {
  const row = { id: 11, name: 'Swing board', scope: 'user', layout: { widgets: [], cols: 24 } }
  stubFetch(true, {
    '/api/artifact-versions/layout/11': () => res(200, { versions: [
      { version: 2, source: 'save', created_at: 1_800_000_100 },
      { version: 1, source: 'save', created_at: 1_800_000_000 },
    ] }),
    '/api/artifact-versions/layout/11/restore': () => res(200, { appended: true, version: 3, artifact: row }),
  })
  const props = mount()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Version history of layout Swing board' }))
  await flush()
  expect(screen.getByText('Versions of “Swing board”')).toBeInTheDocument()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' })) })
  await flush()
  expect(props.onRestored).toHaveBeenCalledWith(row)
  fireEvent.click(screen.getByRole('button', { name: '‹ Back' }))
  expect(screen.getByText('Swing board')).toBeInTheDocument()
})

test('Recently deleted brings a deleted layout back on the phone', async () => {
  const row = { id: 9, name: 'Old Swing', scope: 'user', layout: { widgets: [], cols: 24 } }
  let deleted = [{ artifact_id: 9, label: 'Old Swing', head: 3, deleted_at: 1_800_000_000 }]
  stubFetch(true, {
    '/api/artifact-versions/layout/deleted': () => res(200, { deleted }),
    '/api/artifact-versions/layout/9/undelete': () => { deleted = []; return res(200, { version: 4, artifact: row }) },
  })
  const props = mount()
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Recently deleted (1)' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bring back Old Swing' })) })
  await flush()
  expect(props.onRestored).toHaveBeenCalledWith(row)
  expect(screen.getByTestId('recently-deleted-layout').textContent).toContain('“Old Swing” is back.')
})

test('a phone delete re-reads Recently deleted, so the layout just deleted is offered back', async () => {
  let deleted = []
  stubFetch(true, { '/api/artifact-versions/layout/deleted': () => res(200, { deleted }) })
  const onDelete = vi.fn(async () => { deleted = [{ artifact_id: 11, label: 'Swing board', head: 2, deleted_at: 1_800_000_000 }] })
  mount({ onDelete })
  await flush()
  expect(screen.queryByTestId('recently-deleted-layout')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Delete layout Swing board' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
  await flush()
  expect(onDelete).toHaveBeenCalledWith(11)
  expect(screen.getByRole('button', { name: 'Recently deleted (1)' })).toBeInTheDocument()
})

test('every control the history door adds sits at the 44px tap floor on every width', () => {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'MobileCharts.module.css'), 'utf8')
  const block = (sel) => {
    const m = css.match(new RegExp(`(^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
    return m ? m[2] : ''
  }
  expect(block('.layoutHistory')).toMatch(/min-height:\s*var\(--tap-min,\s*44px\)/)
  expect(block('.layoutHistory')).toMatch(/min-width:\s*var\(--tap-min,\s*44px\)/)
  // Unconditional (not inside a media query): the shell also serves coarse tablets >1024px.
  expect(css).toMatch(/\n\.historyHost button\s*\{\s*min-height:\s*var\(--tap-min,\s*44px\);?\s*\}/)
})
