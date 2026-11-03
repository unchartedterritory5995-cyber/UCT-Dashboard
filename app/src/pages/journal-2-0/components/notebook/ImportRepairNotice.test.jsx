// Plan F Task 10: the one-time notice for imports that lost pictures or files.
//
// The copy is checked on the component itself; the rest runs through the real NotebookTab, with
// only the network faked (the a11y fixtures), because what matters is the wiring: one read per
// page load, the chunk fetched only when there is something to show, the dismiss POST, and the
// live import wizard opened with recover already ticked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers } from '../../a11y/fixtures'
import NotebookTab, { __resetRepairNoticeForTests } from '../../tabs/NotebookTab'

// Counts how many times NotebookTab's lazy import pulls the notice chunk in. The copy tests below
// read the real module through `vi.importActual`, which bypasses this factory, so only the
// NotebookTab path is counted.
const chunk = vi.hoisted(() => ({ loads: 0 }))
vi.mock('./ImportRepairNotice', async () => {
  chunk.loads += 1
  return vi.importActual('./ImportRepairNotice')
})

const NOTICE_GET = '/api/j2/notes/import/repair-notice'
const NOTICE_DISMISS = '/api/j2/notes/import/repair-notice/dismiss'
const LIST_ROUTE = '/journal/notebook?view=all'
const HEADING = 'Some imported notes are missing pictures'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

function calls(spy, path, method = 'GET') {
  return spy.mock.calls.filter(([input, init]) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    return url.split('?')[0] === path && (init?.method || 'GET').toUpperCase() === method
  })
}

async function renderList() {
  render(<Providers route={LIST_ROUTE}><NotebookTab /></Providers>)
  await screen.findAllByText('Weekly plan')
  await settle()
}

beforeEach(() => {
  __resetRepairNoticeForTests()
  latchWave8Flags(false)
})
afterEach(() => { cleanup() })

describe('ImportRepairNotice', () => {
  // ORDER MATTERS: this runs first, while the chunk counter can still move. A later test loads the
  // chunk on purpose, and a module loads once per file, so this check would be vacuous after it.
  it('nothing renders and no chunk loads when show is false', async () => {
    const spy = installFetch([[/^\/api\/j2\/notes\/import\/repair-notice$/, { show: false, lossNotes: 0 }]])
    await renderList()
    expect(calls(spy, NOTICE_GET)).toHaveLength(1)
    expect(screen.queryByText(HEADING)).toBeNull()
    expect(screen.queryByTestId('import-repair-notice')).toBeNull()
    expect(chunk.loads).toBe(0)
  })

  it('renders the singular and plural copy exactly', async () => {
    const { default: ImportRepairNotice } = await vi.importActual('./ImportRepairNotice')
    const { unmount } = render(<ImportRepairNotice lossNotes={1} onRecover={() => {}} onDismiss={() => {}} />)
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument()
    expect(screen.getByText(
      "When you imported from Evernote, Notion or Obsidian, 1 note lost a picture or file on the way in. Where we could, we've marked the spot in the note. Import the same export again with Re-import to recover turned on to bring it back. Notes you've changed since importing are never touched.",
    )).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-import to recover' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: HEADING })).toBeInTheDocument()
    unmount()

    render(<ImportRepairNotice lossNotes={4} onRecover={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText(
      "When you imported from Evernote, Notion or Obsidian, 4 notes lost a picture or file on the way in. Where we could, we've marked the spot in each note. Import the same export again with Re-import to recover turned on to bring them back. Notes you've changed since importing are never touched.",
    )).toBeInTheDocument()
    // ASCII only: no curly apostrophes, no em dashes.
    expect(document.body.textContent).not.toMatch(/[—‘’]/)
  })

  it('Dismiss posts once and hides', async () => {
    const spy = installFetch([
      [/^\/api\/j2\/notes\/import\/repair-notice\/dismiss$/, { ok: true }],
      [/^\/api\/j2\/notes\/import\/repair-notice$/, { show: true, lossNotes: 2 }],
    ])
    await renderList()
    await screen.findByRole('heading', { name: HEADING })
    expect(chunk.loads).toBe(1) // the control for the first test: a shown notice DOES load the chunk
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(HEADING)).toBeNull())
    expect(calls(spy, NOTICE_DISMISS, 'POST')).toHaveLength(1)
    expect(calls(spy, NOTICE_DISMISS, 'POST')[0][1].credentials).toBe('include')

    // Once per page load: a remount of the tab neither reads again nor shows it again.
    cleanup()
    await renderList()
    expect(calls(spy, NOTICE_GET)).toHaveLength(1)
    expect(screen.queryByText(HEADING)).toBeNull()
    expect(calls(spy, NOTICE_DISMISS, 'POST')).toHaveLength(1)
  })

  it('Re-import to recover dismisses then opens the wizard with recover ticked', async () => {
    const spy = installFetch([
      [/^\/api\/j2\/notes\/import\/repair-notice\/dismiss$/, { ok: true }],
      [/^\/api\/j2\/notes\/import\/repair-notice$/, { show: true, lossNotes: 1 }],
      [/^\/api\/j2\/notes\/import\/check$/, {
        existing: { 'file:hello.md': { id: 'n1', updatedAt: '2026-10-01T00:00:00Z', importHash: null } },
      }],
    ])
    await renderList()
    await screen.findByRole('heading', { name: HEADING })
    expect(screen.queryByTestId('import-file-input')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Re-import to recover' }))
    const input = await screen.findByTestId('import-file-input', {}, { timeout: 10000 })
    expect(screen.queryByText(HEADING)).toBeNull()
    const dismisses = calls(spy, NOTICE_DISMISS, 'POST')
    expect(dismisses).toHaveLength(1)
    // The dismiss went out before the wizard did anything on the network.
    const order = spy.mock.calls.map(([u]) => String(typeof u === 'string' ? u : u?.url))
    const firstImportCall = order.findIndex((u) => u.includes('/api/j2/notes/import/') && !u.includes('repair-notice'))
    expect(order.indexOf(NOTICE_DISMISS)).toBeGreaterThan(-1)
    if (firstImportCall !== -1) expect(order.indexOf(NOTICE_DISMISS)).toBeLessThan(firstImportCall)

    const md = new File(['# Hello\n\nbody'], 'hello.md', { type: 'text/markdown' })
    fireEvent.change(input, { target: { files: [md] } })
    await waitFor(() => expect(screen.getByText(/update 1/i)).toBeInTheDocument(), { timeout: 10000 })
    expect(screen.getByTestId('import-recover-mode')).toBeChecked()
  }, 20000)
})

// Task 10 concern 2: a member lands on Research Home (the bare root), not on a list.
describe('ImportRepairNotice on Research Home', () => {
  async function renderHome() {
    render(<Providers route="/journal/notebook"><NotebookTab /></Providers>)
    await screen.findAllByText('Theses') // the folder tree is real and fed by the fixtures
    // Non-vacuity: this IS Research Home, not a list (the list's view switcher is absent).
    await waitFor(() => expect(screen.queryByRole('button', { name: 'List view' })).toBeNull())
    await settle()
  }

  it('Import notes on Research Home opens the import wizard', async () => {
    installFetch([
      [/^\/api\/j2\/notes\/import\/repair-notice$/, { show: false, lossNotes: 0 }],
      // Home offers "Import notes" to a member with no notes yet (its welcome).
      [/^\/api\/j2\/notes$/, { notes: [], total: 0 }],
    ])
    await renderHome()
    expect(screen.queryByTestId('import-file-input')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /Import notes/ })[0])
    await screen.findByTestId('import-file-input', {}, { timeout: 10000 })
  }, 20000)

  it('shows once on Research Home, and its Re-import to recover opens the wizard ticked', async () => {
    const spy = installFetch([
      [/^\/api\/j2\/notes\/import\/repair-notice\/dismiss$/, { ok: true }],
      [/^\/api\/j2\/notes\/import\/repair-notice$/, { show: true, lossNotes: 5 }],
      [/^\/api\/j2\/notes\/import\/check$/, {
        existing: { 'file:hello.md': { id: 'n1', updatedAt: '2026-10-01T00:00:00Z', importHash: null } },
      }],
    ])
    await renderHome()
    await screen.findByRole('heading', { name: HEADING })
    expect(screen.getAllByTestId('import-repair-notice')).toHaveLength(1)
    expect(calls(spy, NOTICE_GET)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Re-import to recover' }))
    const input = await screen.findByTestId('import-file-input', {}, { timeout: 10000 })
    expect(screen.queryByText(HEADING)).toBeNull()
    expect(calls(spy, NOTICE_DISMISS, 'POST')).toHaveLength(1)
    const md = new File(['# Hello\n\nbody'], 'hello.md', { type: 'text/markdown' })
    fireEvent.change(input, { target: { files: [md] } })
    await waitFor(() => expect(screen.getByText(/update 1/i)).toBeInTheDocument(), { timeout: 10000 })
    expect(screen.getByTestId('import-recover-mode')).toBeChecked()
  }, 20000)
})
