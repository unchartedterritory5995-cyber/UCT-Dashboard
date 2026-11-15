// Plan F Task 10: the one-time notice for imports that lost pictures or files.
//
// The copy is checked on the component itself; the rest runs through the real NotebookTab, with
// only the network faked (the a11y fixtures), because what matters is the wiring: one read per
// page load, the dismiss POST, focus after either button, and the live import wizard opened with
// recover already ticked. Whether the chunk loads at all is ImportRepairNotice.chunk.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { AUTH, installFetch, latchWave8Flags, Providers } from '../../a11y/fixtures'
import Layout from '../../../../components/Layout'
import NotebookTab, { __resetRepairNoticeForTests } from '../../tabs/NotebookTab'
import ImportRepairNotice from './ImportRepairNotice'

const NOTICE_GET = '/api/j2/notes/import/repair-notice'
const NOTICE_DISMISS = '/api/j2/notes/import/repair-notice/dismiss'
const LIST_ROUTE = '/journal/notebook?view=all'
const HEADING = 'Some imported notes are missing pictures'
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

const pathOf = (input) => (typeof input === 'string' ? input : input?.url || '').split('?')[0]

function calls(spy, path, method = 'GET') {
  return spy.mock.calls.filter(([input, init]) => (
    pathOf(input) === path && (init?.method || 'GET').toUpperCase() === method
  ))
}

const NOTICE_ROUTES = (lossNotes) => [
  [/^\/api\/j2\/notes\/import\/repair-notice\/dismiss$/, { ok: true }],
  [/^\/api\/j2\/notes\/import\/repair-notice$/, { show: true, lossNotes }],
  [/^\/api\/j2\/notes\/import\/check$/, {
    existing: { 'file:hello.md': { id: 'n1', updatedAt: '2026-10-01T00:00:00Z', importHash: null } },
  }],
]

// The pane's own heading: the Notebook's landing place for the skip link and for focus that has
// nowhere better to go (wave 8, 8A A4). Present on Research Home and on every list.
const paneHeading = () => document.querySelector('#notebook-pane > h2')

async function renderList() {
  render(<Providers route={LIST_ROUTE}><NotebookTab /></Providers>)
  await screen.findAllByText('Weekly plan')
  await settle()
}

async function scanHelloAndExpectTicked(input) {
  const md = new File(['# Hello\n\nbody'], 'hello.md', { type: 'text/markdown' })
  fireEvent.change(input, { target: { files: [md] } })
  await waitFor(() => expect(screen.getByText(/update 1/i)).toBeInTheDocument(), { timeout: 10000 })
  expect(screen.getByTestId('import-recover-mode')).toBeChecked()
}

beforeEach(() => {
  __resetRepairNoticeForTests()
  latchWave8Flags(false)
})
afterEach(() => { cleanup() })

describe('ImportRepairNotice', () => {
  it('nothing renders when show is false', async () => {
    const spy = installFetch([[/^\/api\/j2\/notes\/import\/repair-notice$/, { show: false, lossNotes: 0 }]])
    await renderList()
    expect(calls(spy, NOTICE_GET)).toHaveLength(1)
    expect(screen.queryByText(HEADING)).toBeNull()
    expect(screen.queryByTestId('import-repair-notice')).toBeNull()
  })

  it('renders the singular and plural copy exactly', () => {
    const { unmount } = render(<ImportRepairNotice lossNotes={1} onRecover={() => {}} onDismiss={() => {}} />)
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument()
    expect(screen.getByText(
      "When you imported notes from another app or from files, 1 note lost a picture or file on the way in. Where we could, we've marked the spot in the note. Import the same files again with Re-import to recover turned on to bring it back. Notes you've changed since importing are never touched.",
    )).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-import to recover' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: HEADING })).toBeInTheDocument()
    unmount()

    render(<ImportRepairNotice lossNotes={4} onRecover={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText(
      "When you imported notes from another app or from files, 4 notes lost a picture or file on the way in. Where we could, we've marked the spot in each note. Import the same files again with Re-import to recover turned on to bring them back. Notes you've changed since importing are never touched.",
    )).toBeInTheDocument()
    // Final review M-2: the count covers every file import (the generic Files importer, Keep and
    // Logseq too), so the copy names no single app.
    expect(document.body.textContent).not.toMatch(/Evernote|Notion|Obsidian/)
    // ASCII only: no curly apostrophes, no em dashes.
    expect(document.body.textContent).not.toMatch(/[—‘’]/)
  })

  it('Dismiss posts once, hides, and leaves focus on the pane heading', async () => {
    const spy = installFetch(NOTICE_ROUTES(2))
    await renderList()
    await screen.findByRole('heading', { name: HEADING })
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    dismiss.focus()
    fireEvent.click(dismiss)
    await waitFor(() => expect(screen.queryByText(HEADING)).toBeNull())
    expect(calls(spy, NOTICE_DISMISS, 'POST')).toHaveLength(1)
    expect(calls(spy, NOTICE_DISMISS, 'POST')[0][1].credentials).toBe('include')
    // Review M-1: the button that held focus is gone; focus lands somewhere a member can resume from.
    expect(paneHeading()).not.toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(paneHeading()))

    // Once per page load: a remount of the tab neither reads again nor shows it again.
    cleanup()
    await renderList()
    expect(calls(spy, NOTICE_GET)).toHaveLength(1)
    expect(screen.queryByText(HEADING)).toBeNull()
    expect(calls(spy, NOTICE_DISMISS, 'POST')).toHaveLength(1)
  })

  it('Re-import to recover dismisses then opens the wizard with recover ticked, and closing it returns focus', async () => {
    const spy = installFetch(NOTICE_ROUTES(1))
    await renderList()
    await screen.findByRole('heading', { name: HEADING })
    expect(screen.queryByTestId('import-file-input')).toBeNull()

    const recover = screen.getByRole('button', { name: 'Re-import to recover' })
    recover.focus()
    fireEvent.click(recover)
    const input = await screen.findByTestId('import-file-input', {}, { timeout: 10000 })
    expect(screen.queryByText(HEADING)).toBeNull()
    expect(calls(spy, NOTICE_DISMISS, 'POST')).toHaveLength(1)

    await scanHelloAndExpectTicked(input)
    // Review M-3: the order is checked AFTER the scan, so the wizard's own call is there to compare.
    const order = spy.mock.calls.map(([u]) => pathOf(u))
    const dismissAt = order.indexOf(NOTICE_DISMISS)
    const checkAt = order.indexOf('/api/j2/notes/import/check')
    expect(dismissAt).toBeGreaterThan(-1)
    expect(checkAt).toBeGreaterThan(-1)
    expect(dismissAt).toBeLessThan(checkAt)

    // Review M-1: closing the wizard puts focus back on the pane heading, not on <body>.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('import-file-input')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(paneHeading()))
  }, 30000)

  // Final review M-1: sign-out does not reload the page, so the one read per page load is per
  // MEMBER. A second member on the same tab gets their own read and their own count.
  it('the read is per member: a different member on the same page load reads again', async () => {
    const counts = { u1: 3, u2: 7 }
    let who = 'u1'
    const spy = installFetch([[/^\/api\/j2\/notes\/import\/repair-notice$/, () => ({ show: true, lossNotes: counts[who] })]])
    const as = (id) => ({ ...AUTH, user: { ...AUTH.user, id } })
    render(<Providers route={LIST_ROUTE} auth={as('u1')}><NotebookTab /></Providers>)
    await screen.findByText(/, 3 notes lost a picture/)
    cleanup()

    who = 'u2'
    render(<Providers route={LIST_ROUTE} auth={as('u2')}><NotebookTab /></Providers>)
    await screen.findByText(/, 7 notes lost a picture/)
    expect(screen.queryByText(/, 3 notes lost a picture/)).toBeNull()
    expect(calls(spy, NOTICE_GET)).toHaveLength(2)
    cleanup()

    // and the same member again is still one read per page load
    render(<Providers route={LIST_ROUTE} auth={as('u2')}><NotebookTab /></Providers>)
    await screen.findByText(/, 7 notes lost a picture/)
    expect(calls(spy, NOTICE_GET)).toHaveLength(2)
  }, 30000)

  it('Re-import to recover opens the wizard even while the dismiss POST hangs', async () => {
    const routed = installFetch(NOTICE_ROUTES(3))
    // Review M-5: a dismiss that never answers must not hold the wizard back.
    const spy = vi.fn((input, init) => (pathOf(input) === NOTICE_DISMISS ? new Promise(() => {}) : routed(input, init)))
    global.fetch = spy
    await renderList()
    await screen.findByRole('heading', { name: HEADING })
    fireEvent.click(screen.getByRole('button', { name: 'Re-import to recover' }))
    const input = await screen.findByTestId('import-file-input', {}, { timeout: 10000 })
    expect(screen.queryByText(HEADING)).toBeNull()
    expect(calls(spy, NOTICE_DISMISS, 'POST')).toHaveLength(1)
    await scanHelloAndExpectTicked(input)
    expect(screen.queryByText(HEADING)).toBeNull()
  }, 30000)
})

// Task 10 concern 2: the notice is where a member LANDS -- the bare Notebook. Notebook simplify, Task 5: that is the
// notes list now (it was Research Home); these cases keep the bare address so they follow the landing.
describe('ImportRepairNotice on the bare Notebook (where a member lands)', () => {
  async function renderHome(wrap = (x) => x) {
    render(<Providers route="/journal/notebook">{wrap(<NotebookTab />)}</Providers>)
    await screen.findAllByText('Theses') // the folder tree is real and fed by the fixtures
    // Non-vacuity: the bare address IS the list now (its toolbar is there).
    await screen.findByRole('toolbar', { name: 'Notes list tools' })
    await settle()
  }

  it('Import notes on the empty Notebook opens the import wizard', async () => {
    installFetch([
      [/^\/api\/j2\/notes\/import\/repair-notice$/, { show: false, lossNotes: 0 }],
      // The list's empty state offers "Import notes" to a member with no notes yet.
      [/^\/api\/j2\/notes$/, { notes: [], total: 0 }],
    ])
    await renderHome()
    expect(screen.queryByTestId('import-file-input')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /Import notes/ })[0])
    await screen.findByTestId('import-file-input', {}, { timeout: 10000 })
  }, 20000)

  it('shows once on the bare Notebook, and its Re-import to recover opens the wizard ticked', async () => {
    const spy = installFetch(NOTICE_ROUTES(5))
    await renderHome()
    await screen.findByRole('heading', { name: HEADING })
    expect(screen.getAllByTestId('import-repair-notice')).toHaveLength(1)
    expect(calls(spy, NOTICE_GET)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Re-import to recover' }))
    const input = await screen.findByTestId('import-file-input', {}, { timeout: 10000 })
    expect(screen.queryByText(HEADING)).toBeNull()
    expect(calls(spy, NOTICE_DISMISS, 'POST')).toHaveLength(1)
    await scanHelloAndExpectTicked(input)
  }, 20000)

  // Review M-2: in the app shell, every skip link comes before the notice in Tab order, and the
  // Notebook's own "Skip to notes list" lands on the pane heading, which comes before it too.
  it('in the shell, the notice follows every skip link and the pane heading', async () => {
    installFetch(NOTICE_ROUTES(2))
    await renderHome((tab) => <Layout>{tab}</Layout>)
    await screen.findByRole('heading', { name: HEADING })
    const recover = screen.getByRole('button', { name: 'Re-import to recover' })
    const stops = [...document.querySelectorAll(FOCUSABLE)]
    const skips = stops.filter((el) => /^Skip to /.test(el.textContent.trim()))
    expect(skips.map((el) => el.textContent.trim())).toEqual(expect.arrayContaining(['Skip to main content', 'Skip to notes list']))
    for (const skip of skips) {
      expect(skip.compareDocumentPosition(recover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(paneHeading().compareDocumentPosition(recover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }, 30000)
})
