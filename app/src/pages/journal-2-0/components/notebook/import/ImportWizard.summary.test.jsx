// Plan B Task 11: the arrival screen's report of what was kept, not copied, or not connected,
// and the running step's Stop. `runImport` is replaced here (and only here) so each test can
// hand the wizard an exact result; the real pipeline's shapes are pinned in commit.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ImportWizard from './ImportWizard'
import { runImport } from '../../../lib/importer/commit'
import { importNoticeText, MEDIA_RETRY_MAX_ATTEMPTS } from '../../../lib/importNoticeText'

vi.mock('../../../lib/importer/commit', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, runImport: vi.fn() }
})

const mdFile = (name = 'hello.md') => new File(['# Hello'], name, { type: 'text/markdown' })

const RESULT = (extra = {}) => ({
  created: 1, updated: 0, skipped: 0, recovered: 0, failures: [], failedBatches: [],
  outcomes: { 'file:hello.md': 'created' }, importedNoteIds: [], attentionKeys: [],
  notices: [], unconnectedLinks: [], keptEdited: [], stopped: false, ...extra,
})

async function toPreview(files = [mdFile()]) {
  render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
  fireEvent.change(screen.getByTestId('import-file-input'), { target: { files } })
  await waitFor(() => expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument(), { timeout: 10000 })
}

describe('ImportWizard — the report of what was kept, not copied, or not connected', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (u.endsWith('/import/check')) return new Response(JSON.stringify({ existing: {} }))
      if (u.endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      if (u.endsWith('/enrichment/scan')) return new Response(JSON.stringify({ candidates: [], scanned: 0 }))
      return new Response(JSON.stringify({ ok: true }))
    }))
    runImport.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows kept-edited, could-not-copy and not-connected sections from the result', async () => {
    runImport.mockResolvedValue(RESULT({
      keptEdited: [{ name: 'My trade plan', importKey: 'file:plan.md' }],
      notices: [
        { note: 'Hello', importKey: 'file:hello.md', reason: 'fetch_failed', name: 'chart.png', sourceUrl: 'https://cdn.example.com/chart.png' },
        { note: 'Hello', importKey: 'file:hello.md', reason: 'too_large', name: 'deck.pdf', sourceUrl: null },
      ],
      unconnectedLinks: [{ note: 'Hello', text: 'Q3 review' }],
    }))
    await toPreview()
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(() => expect(screen.getByText('Import complete')).toBeInTheDocument(), { timeout: 10000 })

    const kept = screen.getByRole('region', { name: 'Kept as you edited them' })
    expect(within(kept).getByText('My trade plan')).toBeInTheDocument()
    expect(within(kept).getByText(
      "You've edited this note since it was imported, so it was left as it is. Open it beside the export to copy anything across.",
    )).toBeInTheDocument()

    const notCopied = screen.getByRole('region', { name: "Couldn't be copied" })
    const rows = within(notCopied).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // the notice sentence is the in-note one (final: never "retrying on the next sync")
    const sentence = importNoticeText({ reason: 'fetch_failed', name: 'chart.png', attempts: MEDIA_RETRY_MAX_ATTEMPTS })
    expect(sentence).not.toMatch(/retrying/i)
    expect(within(rows[0]).getByText('Hello')).toBeInTheDocument()
    expect(within(rows[0]).getByText(sentence, { exact: false })).toBeInTheDocument()
    const link = within(rows[0]).getByRole('link')
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/chart.png')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(within(rows[1]).queryByRole('link')).toBeNull()
    expect(within(rows[1]).getByText(importNoticeText({ reason: 'too_large', name: 'deck.pdf', attempts: MEDIA_RETRY_MAX_ATTEMPTS }), { exact: false })).toBeInTheDocument()

    const unconnected = screen.getByRole('region', { name: 'Links not connected yet' })
    expect(within(unconnected).getByText('Q3 review', { exact: false })).toBeInTheDocument()
    expect(within(unconnected).getByText('These connect automatically when the note they point to is imported.')).toBeInTheDocument()
  })

  it('renders none of the three sections when there is nothing to report', async () => {
    runImport.mockResolvedValue(RESULT())
    await toPreview()
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(() => expect(screen.getByText('Import complete')).toBeInTheDocument(), { timeout: 10000 })
    expect(screen.queryByRole('region', { name: 'Kept as you edited them' })).toBeNull()
    expect(screen.queryByRole('region', { name: "Couldn't be copied" })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Links not connected yet' })).toBeNull()
  })

  it('the per-folder breakdown counts recovered as arrived and kept-as-edited as unchanged', async () => {
    runImport.mockResolvedValue(RESULT({
      created: 0, recovered: 1, keptEdited: [{ name: 'b', importKey: 'file:b.md' }],
      outcomes: { 'file:a.md': 'recovered', 'file:b.md': 'kept_edited' },
    }))
    await toPreview([mdFile('a.md'), mdFile('b.md')])
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(() => expect(screen.getByText('Import complete')).toBeInTheDocument(), { timeout: 10000 })
    const row = screen.getByRole('row', { name: /^Unfiled/i })
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Unfiled', '1', '1', '—'])
    expect(screen.getByText(/Imported 1 note\./)).toBeInTheDocument()
  })

  it('Stop really stops the import: runImport is told, and the screen says what was saved', async () => {
    let seenCancel = null
    runImport.mockImplementation(async ({ isCancelled }) => {
      seenCancel = isCancelled
      await waitFor(() => expect(isCancelled()).toBe(true), { timeout: 5000 })
      return RESULT({ stopped: true })
    })
    await toPreview()
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    const stop = await screen.findByRole('button', { name: /stop import/i }, { timeout: 10000 })
    await waitFor(() => expect(typeof seenCancel).toBe('function'), { timeout: 10000 })
    expect(seenCancel()).toBe(false)
    fireEvent.click(stop)
    await waitFor(() => expect(screen.getByText(/You stopped this import/)).toBeInTheDocument(), { timeout: 10000 })
  })

  it('shows per-item progress within a note', async () => {
    let finish
    runImport.mockImplementation(({ onProgress }) => new Promise((resolve) => {
      onProgress({ phase: 'commit', done: 0, total: 1, note: 'Hello', itemDone: 1, itemTotal: 4 })
      finish = () => resolve(RESULT())
    }))
    await toPreview()
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(() => expect(screen.getByText('“Hello” — file 2 of 4')).toBeInTheDocument(), { timeout: 10000 })
    finish()
    await waitFor(() => expect(screen.getByText('Import complete')).toBeInTheDocument(), { timeout: 10000 })
  })
})
