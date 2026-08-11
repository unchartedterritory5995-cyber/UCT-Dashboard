import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ImportWizard from './ImportWizard'

// jsdom lacks DataTransfer; drive the wizard through its file-input path.
const mdFile = new File(['# Hello\n\n- [x] done'], 'hello.md', { type: 'text/markdown' })

function makeFile(name, relPath, content = '# x') {
  const f = new File([content], name, { type: 'text/markdown' })
  if (relPath) Object.defineProperty(f, 'webkitRelativePath', { value: relPath, configurable: true })
  return f
}

// Real `expandArchives` for every path except a sentinel `huge.zip` name,
// which throws the same ImportLimitError the real implementation would raise
// for an oversized archive (constructing an actual >2GB File in a unit test
// isn't practical). Pass-through keeps every other test exercising the real
// intake pipeline unchanged.
vi.mock('../../../lib/importer/intake', async () => {
  const actual = await vi.importActual('../../../lib/importer/intake')
  return {
    ...actual,
    expandArchives: vi.fn(async (vfiles, ...rest) => {
      if (vfiles.some((v) => v.path === 'huge.zip')) {
        throw new actual.ImportLimitError(
          'This import is larger than 2.0GB. Split it into smaller batches and try again.'
        )
      }
      return actual.expandArchives(vfiles, ...rest)
    }),
  }
})

// Controllable stall point for the "close mid-scan" race test below: real
// `detectAdapter` for every file set except one containing the `slow.md`
// sentinel, which hangs until the test resolves `slowGate.promise` itself.
// Assigned per-test; untouched (null) tests never hit the sentinel branch.
let slowGate = null
vi.mock('../../../lib/importer/registry', async () => {
  const actual = await vi.importActual('../../../lib/importer/registry')
  return {
    ...actual,
    detectAdapter: vi.fn(async (vfiles) => {
      if (vfiles.some((v) => v.path === 'slow.md')) {
        await slowGate.promise
      }
      return actual.detectAdapter(vfiles)
    }),
  }
})

describe('ImportWizard wire', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/import/check')) return new Response(JSON.stringify({ existing: {} }))
      if (url.endsWith('/import/confirm')) return new Response(JSON.stringify({
        created: [{ importKey: 'file:hello.md', id: 'n1' }], updated: [], skipped: [] }))
      if (url.endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))
  })

  it('drop -> preview shows counts -> confirm actually POSTs /import/confirm', async () => {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [mdFile] } })
    // preview: found 1 note, will create 1
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeInTheDocument())
    expect(screen.getByText(/create 1/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    await waitFor(() => {
      const urls = vi.mocked(fetch).mock.calls.map((c) => c[0])
      expect(urls).toContain('/api/j2/notes/import/confirm')
    })
    await waitFor(() => expect(screen.getByText(/imported/i)).toBeInTheDocument())
  })

  it('unchecking a top-level folder excludes its notes from the confirm payload', async () => {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const rootFile = makeFile('root.md', 'root.md', '# Root')
    const subFile = makeFile('inner.md', 'Sub/inner.md', '# Inner')
    const input = screen.getByTestId('import-dir-input')
    fireEvent.change(input, { target: { files: [rootFile, subFile] } })

    await waitFor(() => expect(screen.getByText(/2 notes/i)).toBeInTheDocument())

    const subCheckbox = screen.getByRole('checkbox', { name: /Sub/i })
    expect(subCheckbox.checked).toBe(true)
    fireEvent.click(subCheckbox) // uncheck -> exclude the "Sub" folder

    fireEvent.click(screen.getByRole('button', { name: /import/i }))

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
      expect(call).toBeTruthy()
    })
    const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
    const body = JSON.parse(call[1].body)
    expect(body.notes.map((n) => n.importKey)).toEqual(['file:root.md'])
  })

  it('renders a readable error when the import exceeds size limits (ImportLimitError)', async () => {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const bigFile = new File(['PK'], 'huge.zip', { type: 'application/zip' })
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [bigFile] } })

    await waitFor(() =>
      expect(screen.getByText(/split it into smaller batches/i)).toBeInTheDocument()
    )
    // Recoverable, not a crash — the wizard offers a way back to the drop step.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('reuses an existing "Imported from {label}" root folder instead of recreating it', async () => {
    const EXISTING_NAME = 'Imported from Files (Markdown, Text, HTML, Word)'
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/import/check')) return new Response(JSON.stringify({ existing: {} }))
      if (url.endsWith('/import/confirm')) return new Response(JSON.stringify({
        created: [{ importKey: 'file:hello.md', id: 'n1' }], updated: [], skipped: [] }))
      if (url.endsWith('/note-folders')) {
        return new Response(JSON.stringify({
          folders: [{ id: 'existing-folder-1', name: EXISTING_NAME, parentId: null }],
        }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }))

    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [mdFile] } })
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeInTheDocument())

    // The duplicate-looking "create new" option must not be offered — only
    // the real folder (same name, but a real id) is in the list, and it's
    // what's actually selected. Guarded with waitFor: the folders list
    // resolves via a separate SWR fetch that can settle a tick after the
    // "1 note" preview text does.
    const select = screen.getByLabelText('Destination folder')
    await waitFor(() => expect(select.value).toBe('existing-folder-1'))
    const optionValues = [...select.querySelectorAll('option')].map((o) => o.value)
    expect(optionValues).not.toContain('__new__')
    const matchingByName = [...select.querySelectorAll('option')].filter((o) => o.textContent === EXISTING_NAME)
    expect(matchingByName).toHaveLength(1) // the real folder only — no duplicate

    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
      expect(call).toBeTruthy()
    })

    const confirmCall = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
    const body = JSON.parse(confirmCall[1].body)
    expect(body.destFolderId).toBe('existing-folder-1')

    // createFolder (the hook's POST /api/j2/note-folders) must never fire.
    const folderPosts = vi.mocked(fetch).mock.calls.filter(
      (c) => c[0] === '/api/j2/note-folders' && c[1]?.method === 'POST'
    )
    expect(folderPosts).toHaveLength(0)
  })

  it('closing mid-scan cancels the pipeline — no stale state lands on the still-mounted instance', async () => {
    let resolveGate
    slowGate = { promise: new Promise((resolve) => { resolveGate = resolve }) }

    const { rerender } = render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const slowFile = new File(['# Slow'], 'slow.md', { type: 'text/markdown' })
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [slowFile] } })

    // Scan is in flight and stalled inside the mocked detectAdapter.
    await waitFor(() => expect(screen.getByText(/reading your files/i)).toBeInTheDocument())

    // Simulate the parent closing the wizard mid-scan (Escape / backdrop) —
    // same mounted ImportWizard instance, `open` just flips false.
    rerender(<ImportWizard open={false} onClose={() => {}} onImported={() => {}} />)

    // Let the stalled pipeline resume and run to whatever completion it reaches.
    resolveGate()
    await new Promise((r) => setTimeout(r, 30))

    // Reopen — must show a fresh drop step, never a stale preview from the
    // cancelled scan.
    rerender(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    expect(screen.getByTestId('import-file-input')).toBeInTheDocument()
    expect(screen.queryByText(/will create/i)).not.toBeInTheDocument()
  })
})
