import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ImportWizard from './ImportWizard'

// jsdom lacks DataTransfer; drive the wizard through its file-input path.
const mdFile = new File(['# Hello\n\n- [x] done'], 'hello.md', { type: 'text/markdown' })

function makeFile(name, relPath, content = '# x') {
  const f = new File([content], name, { type: 'text/markdown' })
  if (relPath) Object.defineProperty(f, 'webkitRelativePath', { value: relPath, configurable: true })
  return f
}

// A real `<input type="file">`'s `.files` is a LIVE FileList backed by the
// input's own state: reading it returns the SAME object every time, and
// clearing `input.value` (done so re-picking the same file still fires
// onChange) empties that object IN PLACE. jsdom's `fireEvent.change(input,
// {target: {files: [...]}})` instead does `Object.defineProperty(node,
// 'files', {value: [...]})` — a STATIC snapshot, never live-bound to
// `value` — which is why that idiom cannot catch a handler that reads
// `.files` after clearing `.value`. This class simulates the live coupling:
// same object identity across every `.files` read, contents zeroed when
// `.value` is set to `''`.
class LiveFileList {
  constructor(files) {
    this._files = [...files]
  }
  get length() { return this._files.length }
  item(i) { return this._files[i] ?? null }
  [Symbol.iterator]() { return this._files[Symbol.iterator]() }
}

function installLiveFileInput(input, files) {
  const liveList = new LiveFileList(files)
  Object.defineProperty(input, 'files', {
    configurable: true,
    get() { return liveList },
  })
  Object.defineProperty(input, 'value', {
    configurable: true,
    set(v) {
      if (v === '') liveList._files = [] // real browser: clearing value empties the live FileList in place
    },
  })
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

  it('surfaces a warning when the server could not check every note for duplicates (audit B1)', async () => {
    // `import_check` truncates past its own resource cap and now says so —
    // the wizard must show this, not silently let the tail reclassify as
    // "create" and duplicate an already-imported note.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/import/check')) return new Response(JSON.stringify({
        existing: {}, checked: 5000, total: 6000, truncated: true,
      }))
      if (url.endsWith('/import/confirm')) return new Response(JSON.stringify({
        created: [{ importKey: 'file:hello.md', id: 'n1' }], updated: [], skipped: [] }))
      if (url.endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [mdFile] } })
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeInTheDocument())
    expect(screen.getByText(/5,000 of 6,000/)).toBeInTheDocument()
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

  it('snapshots a LIVE FileList before clearing input.value (real-browser file-picker regression)', async () => {
    // Real Chromium: choosing a file, then clearing input.value (done so
    // re-picking the same file still fires onChange), truncates the live
    // FileList in place. A handler that reads `.files` AFTER the clear sees
    // zero files every time — the wizard silently never leaves the drop
    // step. `LiveFileList`/`installLiveFileInput` (top of file) simulate
    // that live coupling; jsdom's own `fireEvent.change(input, {target:
    // {files:[...]}})` idiom is a static, non-live assignment and is
    // structurally blind to this class of bug.
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    installLiveFileInput(input, [mdFile])
    fireEvent.change(input, {})
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeInTheDocument())
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

// ---------------------------------------------------------------------------
// Task 12 — compact connect tiles above the dropzone (configured providers only)
// ---------------------------------------------------------------------------
describe('ImportWizard — connect tiles (Task 12)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockConnectorsFetch(providers) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/j2/notes/connectors/status')) {
        return new Response(JSON.stringify({ providers }))
      }
      // MUST come before the '/connect' check below — '/api/j2/notes/
      // connectors/dropbox/folders' contains the substring '/connect' as a
      // prefix of '/connectors', so a naive ordering would misroute the
      // Dropbox folder-picker GET into the OAuth-connect branch.
      if (String(url).includes('/dropbox/folders')) {
        return new Response(JSON.stringify({ folders: [] }))
      }
      if (String(url).includes('/connect')) {
        return new Response(JSON.stringify({ redirectUrl: 'https://api.notion.com/v1/oauth/authorize?x=1' }))
      }
      if (String(url).endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))
  }

  it('shows a tile only for configured providers — an unconfigured provider renders nothing', async () => {
    mockConnectorsFetch({
      roam: { configured: true, sources: [] },
      craft: { configured: false, sources: [] },
      notion: { configured: false, sources: [] },
      dropbox: { configured: false, sources: [] },
    })
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)

    expect(await screen.findByTestId('connect-tile-roam')).toBeInTheDocument()
    expect(screen.queryByTestId('connect-tile-craft')).not.toBeInTheDocument()
    expect(screen.queryByTestId('connect-tile-notion')).not.toBeInTheDocument()
    expect(screen.queryByTestId('connect-tile-dropbox')).not.toBeInTheDocument()
  })

  it('renders no tile row at all when no provider is configured', async () => {
    mockConnectorsFetch({
      roam: { configured: false, sources: [] },
      craft: { configured: false, sources: [] },
      notion: { configured: false, sources: [] },
      dropbox: { configured: false, sources: [] },
    })
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)

    await waitFor(() => {
      expect(screen.queryByText(/connect an app/i)).not.toBeInTheDocument()
    })
  })

  it('a connected provider reads "{Provider} connected" instead of "Connect {Provider}"', async () => {
    mockConnectorsFetch({
      // `connected` is connector-level (read directly, per the shipped
      // router) — not derived from sources.length (Task 12b correction).
      roam: { configured: true, connected: true, sources: [{ id: 's1', provider: 'roam', displayName: 'My Graph', syncEnabled: true, counts: {} }] },
      craft: { configured: false, sources: [] },
      notion: { configured: false, sources: [] },
      dropbox: { configured: false, sources: [] },
    })
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)

    const tile = await screen.findByTestId('connect-tile-roam')
    expect(tile).toHaveTextContent('Roam Research connected')
  })

  it('an OAuth tile (notion) gates behind consent too — no connect POST until checked (fix-round 1, finding #1)', async () => {
    mockConnectorsFetch({
      roam: { configured: false, sources: [] },
      craft: { configured: false, sources: [] },
      notion: { configured: true, sources: [] },
      dropbox: { configured: false, sources: [] },
    })
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)

    fireEvent.click(await screen.findByTestId('connect-tile-notion'))
    const continueBtn = await screen.findByRole('button', { name: /^continue$/i })
    expect(continueBtn).toBeDisabled()
    await new Promise((r) => setTimeout(r, 20))
    expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('/notion/connect'))).toBe(false)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).includes('/notion/connect'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call[1].body)).toEqual({ consent: true })
    })
  })

  // Task 12b: the OAuth return always redirects to /settings (the router
  // hardcodes it), so this surface never auto-opens the picker — but a user
  // can still arrive here later with Dropbox connected-but-sourceless
  // (connected via Settings, closed the picker without picking, then opened
  // the wizard). The tile must read that state honestly rather than showing
  // a misleadingly-healthy "Dropbox connected" pill with a dead Sync.
  it('a connected-but-sourceless Dropbox tile reads "Choose a folder", not "Dropbox connected" — and opens the same picker', async () => {
    mockConnectorsFetch({
      roam: { configured: false, sources: [] },
      craft: { configured: false, sources: [] },
      notion: { configured: false, sources: [] },
      dropbox: { configured: true, connected: true, sources: [] },
    })
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)

    const tile = await screen.findByTestId('connect-tile-dropbox')
    expect(tile).toHaveTextContent(/choose a folder/i)
    expect(tile).not.toHaveTextContent('Dropbox connected')

    fireEvent.click(tile)
    expect(await screen.findByText('Choose a Dropbox folder')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Task 1 — the export guide is actually reachable from the drop step, not
// just present as a standalone component nobody surfaces.
// ---------------------------------------------------------------------------
describe('ImportWizard — export guide surfaced on the drop step (Task 1)', () => {
  it('opening "How do I get my export file?" reveals the per-platform guide, Notion included', async () => {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /how do i get my export file/i }))
    expect(await screen.findByRole('button', { name: /notion/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Task 2 — per-note selection on the preview step, composing with the
// existing folder exclusion rather than fighting it.
// ---------------------------------------------------------------------------
describe('ImportWizard — per-note selection on the preview step (Task 2)', () => {
  // The confirm mock ECHOES exactly what it was sent (rather than a fixed
  // fixture) — this is what makes the summary-count test (below) actually
  // able to fail: if the implementation silently sent every note regardless
  // of what's checked, the echoed counts would say so.
  function mockEchoConfirm() {
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).endsWith('/import/check')) return new Response(JSON.stringify({ existing: {} }))
      if (String(url).endsWith('/import/confirm')) {
        const body = JSON.parse(opts.body)
        return new Response(JSON.stringify({
          created: body.notes.map((n) => ({ importKey: n.importKey, id: `id-${n.importKey}` })),
          updated: [],
          skipped: [],
        }))
      }
      if (String(url).endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))
  }

  beforeEach(() => {
    mockEchoConfirm()
  })

  it('imports only the notes the member left checked', async () => {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const files = [
      makeFile('a.md', 'a.md', '# Alpha'),
      makeFile('b.md', 'b.md', '# Bravo'),
      makeFile('c.md', 'c.md', '# Charlie'),
    ]
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(screen.getByText(/3 notes/i)).toBeInTheDocument())

    // Uncheck the middle note — everything else stays checked by default.
    const bravoCheckbox = screen.getByRole('checkbox', { name: /Bravo/i })
    expect(bravoCheckbox.checked).toBe(true)
    fireEvent.click(bravoCheckbox)

    fireEvent.click(screen.getByRole('button', { name: /import/i }))

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
      expect(call).toBeTruthy()
    })
    // Assertion OUTSIDE any mock callback — on the RECORDED call, not on
    // anything the mock's own response body computed.
    const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
    const body = JSON.parse(call[1].body)
    expect(body.notes.map((n) => n.importKey)).toEqual(['file:a.md', 'file:c.md'])
  })

  it('a folder excluded and a note excluded inside a kept folder both hold', async () => {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const files = [
      makeFile('root.md', 'root.md', '# Root'),
      makeFile('inner1.md', 'Sub/inner1.md', '# Inner1'),
      makeFile('inner2.md', 'Sub/inner2.md', '# Inner2'),
      makeFile('keep1.md', 'Keep/keep1.md', '# Keep1'),
      makeFile('keep2.md', 'Keep/keep2.md', '# Keep2'),
    ]
    const input = screen.getByTestId('import-dir-input')
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(screen.getByText(/5 notes/i)).toBeInTheDocument())

    // Exclude the whole "Sub" folder via the existing folder mechanism.
    fireEvent.click(screen.getByRole('checkbox', { name: /^Sub$/i }))
    // Exclude ONE note inside the "Keep" folder, which stays otherwise kept.
    fireEvent.click(screen.getByRole('checkbox', { name: /Keep2/i }))

    fireEvent.click(screen.getByRole('button', { name: /import/i }))

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
      expect(call).toBeTruthy()
    })
    const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
    const body = JSON.parse(call[1].body)
    // Root survives (untouched), both Sub notes are gone (whole-folder
    // exclusion), Keep1 survives (folder kept), Keep2 is gone (per-note
    // exclusion inside a KEPT folder) — both mechanisms held at once.
    expect(body.notes.map((n) => n.importKey).sort()).toEqual(
      ['file:Keep/keep1.md', 'file:root.md'].sort()
    )
  })

  it('the summary counts match what was actually imported', async () => {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const files = [
      makeFile('a.md', 'a.md', '# Alpha'),
      makeFile('b.md', 'b.md', '# Bravo'),
      makeFile('c.md', 'c.md', '# Charlie'),
    ]
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(screen.getByText(/3 notes/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('checkbox', { name: /Bravo/i }))
    // The "will create" line updates immediately too — the preview never
    // shows a count larger than what will actually be sent.
    await waitFor(() => expect(screen.getByText(/create 2/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /import/i }))

    await waitFor(() => expect(screen.getByText(/Imported 2 notes\./i)).toBeInTheDocument())
    expect(screen.getByText(/Created: 2/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Task 5 — closing the transfer-gap coverage hole. The importer's core
// promise is that re-importing UPDATES existing notes rather than duplicating
// them: every incoming note is classified create/update/unchanged by
// `importKey` fingerprint against what the member already has. Every test
// above only ever exercises the CREATE path (`checkExisting` mocked to
// `{ existing: {} }`) — the update/unchanged branches of `classifyDocs` had
// zero coverage, and `cadaa4ad0` (perf: defer body conversion) restructured
// exactly the code around them: body conversion during scan is now
// restricted to notes with an existing server match (only those need a
// converted body to compute the update-vs-unchanged hash), while everything
// else defers to confirm. These tests drive a genuine existing-match through
// the SAME `checkExisting` mocking idiom the rest of this file uses, so the
// classification + deferred-conversion interaction actually runs.
// ---------------------------------------------------------------------------
describe('ImportWizard — re-import classification survives deferred body conversion (Task 5)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeFileAt(name, content, lastModified) {
    return new File([content], name, { type: 'text/markdown', lastModified })
  }

  // classifyDocs's 'unchanged' verdict needs the wizard's own internal,
  // unexported `computeImportHash` (SHA-256 over title/subtitle/bodyJson/
  // tags/ticker/folderPath/updatedAt — see the "UX estimate, not a source of
  // truth" comment atop ImportWizard.jsx) to equal the "existing" fixture's
  // importHash. Re-deriving that canonical-JSON basis independently in this
  // test file would be a second, driftable copy of the exact algorithm this
  // test exists to hold accountable (the repo's own standing lesson: derive,
  // never restate). Instead: run the SAME file through the real wizard once
  // with a deliberately-WRONG placeholder importHash — this forces the real
  // scan-time hash computation (and an 'update' verdict, since the
  // placeholder can't match) — spy on the real, pass-through
  // `crypto.subtle.digest` to CAPTURE what the wizard actually computed, then
  // feed that captured value back as the "existing" fixture in the real
  // assertion pass below. The spy never changes `digest`'s behavior; it only
  // observes the real result.
  async function primeRealHash(name, content, lastModified) {
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest')
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/import/check')) {
        return new Response(JSON.stringify({
          existing: {
            [`file:${name}`]: {
              id: 'prime',
              updatedAt: new Date(lastModified).toISOString(),
              importHash: 'placeholder-that-can-never-match-a-real-sha256-digest',
            },
          },
        }))
      }
      return new Response(JSON.stringify({ ok: true }))
    }))

    const { unmount } = render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [makeFileAt(name, content, lastModified)] } })
    await waitFor(() => expect(screen.getByText(/update 1/i)).toBeInTheDocument())
    expect(digestSpy).toHaveBeenCalledTimes(1)
    const digestBuf = await digestSpy.mock.results[0].value
    const hex = [...new Uint8Array(digestBuf)].map((b) => b.toString(16).padStart(2, '0')).join('')
    unmount()
    digestSpy.mockRestore()
    return hex
  }

  it('a note whose content is unchanged since last import classifies as unchanged, counts correctly, and is not re-written on confirm', async () => {
    const NAME = 'unchanged.md'
    const CONTENT = '# Steady\n\nThis body never changes across imports. STABLE_MARKER_9001'
    const LAST_MOD = 1700000000000
    const realHash = await primeRealHash(NAME, CONTENT, LAST_MOD)

    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).endsWith('/import/check')) {
        return new Response(JSON.stringify({
          existing: {
            [`file:${NAME}`]: { id: 'existing-1', updatedAt: new Date(LAST_MOD).toISOString(), importHash: realHash },
          },
        }))
      }
      if (String(url).endsWith('/import/confirm')) {
        // Real server behavior: a fingerprint match comes back `skipped`
        // (not `updated`) — the ECHO here mirrors that, keyed off importKey.
        const body = JSON.parse(opts.body)
        return new Response(JSON.stringify({
          created: body.notes.filter((n) => n.importKey !== `file:${NAME}`).map((n) => ({ importKey: n.importKey, id: `id-${n.importKey}` })),
          updated: [],
          skipped: body.notes.filter((n) => n.importKey === `file:${NAME}`).map((n) => ({ importKey: n.importKey, id: 'existing-1' })),
        }))
      }
      if (String(url).endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))

    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    // A lone unchanged note leaves `importTotal` (create+update) at 0, which
    // disables the Import button — pair it with a create note so the confirm
    // step actually runs and the unchanged note's fate through it is provable.
    const files = [makeFileAt(NAME, CONTENT, LAST_MOD), makeFileAt('fresh.md', '# Fresh\n\nBrand new note.', LAST_MOD)]
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(screen.getByText(/2 notes/i)).toBeInTheDocument())
    expect(screen.getByText(/create 1/i)).toBeInTheDocument()
    expect(screen.getByText(/unchanged 1/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /import/i }))

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
      expect(call).toBeTruthy()
    })
    // Assertion OUTSIDE any mock callback — on the RECORDED call.
    const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
    const body = JSON.parse(call[1].body)
    expect(body.notes.map((n) => n.importKey).sort()).toEqual(['file:fresh.md', `file:${NAME}`].sort())

    await waitFor(() => expect(screen.getByText(/Imported 1 note\./i)).toBeInTheDocument())
    expect(screen.getByText(/Created: 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Unchanged: 1/i)).toBeInTheDocument()
  })

  it('a note whose content changed classifies as update, and the confirm payload carries its NEW body', async () => {
    const NAME = 'changed.md'
    const LAST_MOD = 1700000000001
    const NEW_CONTENT = '# Changed\n\nThe member edited this since the last import. NEW_BODY_MARKER_4242'

    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).endsWith('/import/check')) {
        return new Response(JSON.stringify({
          existing: {
            [`file:${NAME}`]: {
              id: 'existing-2',
              updatedAt: new Date(LAST_MOD).toISOString(),
              importHash: 'placeholder-that-can-never-match-a-real-sha256-digest',
            },
          },
        }))
      }
      if (String(url).endsWith('/import/confirm')) {
        return new Response(JSON.stringify({ created: [], updated: [{ importKey: `file:${NAME}`, id: 'existing-2' }], skipped: [] }))
      }
      if (String(url).endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))

    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [makeFileAt(NAME, NEW_CONTENT, LAST_MOD)] } })

    await waitFor(() => expect(screen.getByText(/update 1/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /import/i }))

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
      expect(call).toBeTruthy()
    })
    // Assertion OUTSIDE any mock callback — on the RECORDED call, not on
    // anything a mock's own response body computed. This is the one the
    // deferral could plausibly break: an update needs a converted body, and
    // the perf change decides conversion timing based on whether a server
    // match exists.
    const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
    const body = JSON.parse(call[1].body)
    expect(body.notes).toHaveLength(1)
    const sentBody = body.notes[0].bodyJson
    expect(sentBody).toBeTruthy()
    expect(JSON.stringify(sentBody)).toContain('NEW_BODY_MARKER_4242')
  })

  it('a mix of create/update/unchanged in one import gets each preview count right', async () => {
    const UNCHANGED_NAME = 'steady.md'
    const UNCHANGED_CONTENT = '# Steady\n\nThis one never changes. STABLE_MARKER_777'
    const LAST_MOD = 1700000000002
    const realHash = await primeRealHash(UNCHANGED_NAME, UNCHANGED_CONTENT, LAST_MOD)

    const UPDATE_NAME = 'edited.md'
    const UPDATE_CONTENT = '# Edited\n\nThis one changed since last time. EDITED_MARKER_888'
    const CREATE_NAME = 'brandnew.md'
    const CREATE_CONTENT = '# Brand New\n\nNever seen before.'

    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      if (String(url).endsWith('/import/check')) {
        return new Response(JSON.stringify({
          existing: {
            [`file:${UNCHANGED_NAME}`]: { id: 'e-unchanged', updatedAt: new Date(LAST_MOD).toISOString(), importHash: realHash },
            [`file:${UPDATE_NAME}`]: {
              id: 'e-update',
              updatedAt: new Date(LAST_MOD).toISOString(),
              importHash: 'placeholder-that-can-never-match-a-real-sha256-digest',
            },
          },
        }))
      }
      if (String(url).endsWith('/import/confirm')) {
        const body = JSON.parse(opts.body)
        return new Response(JSON.stringify({
          created: body.notes.filter((n) => n.importKey === `file:${CREATE_NAME}`).map((n) => ({ importKey: n.importKey, id: `id-${n.importKey}` })),
          updated: body.notes.filter((n) => n.importKey === `file:${UPDATE_NAME}`).map((n) => ({ importKey: n.importKey, id: 'e-update' })),
          skipped: body.notes.filter((n) => n.importKey === `file:${UNCHANGED_NAME}`).map((n) => ({ importKey: n.importKey, id: 'e-unchanged' })),
        }))
      }
      if (String(url).endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))

    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const files = [
      makeFileAt(UNCHANGED_NAME, UNCHANGED_CONTENT, LAST_MOD),
      makeFileAt(UPDATE_NAME, UPDATE_CONTENT, LAST_MOD),
      makeFileAt(CREATE_NAME, CREATE_CONTENT, LAST_MOD),
    ]
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(screen.getByText(/3 notes/i)).toBeInTheDocument())
    // A member reads these three counts to decide whether to proceed — each
    // one has to be right, independently, in the same preview.
    expect(screen.getByText(/create 1/i)).toBeInTheDocument()
    expect(screen.getByText(/update 1/i)).toBeInTheDocument()
    expect(screen.getByText(/unchanged 1/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /import/i }))

    await waitFor(() => expect(screen.getByText(/Imported 2 notes\./i)).toBeInTheDocument())
    expect(screen.getByText(/Created: 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Updated: 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Unchanged: 1/i)).toBeInTheDocument()
  })

  it('a match with no stored fingerprint skips scan-time conversion but still gets its NEW body before confirm', async () => {
    const NAME = 'nohash.md'
    const LAST_MOD = 1700000000003
    const NEW_CONTENT = '# No Hash On File\n\nThe existing record has no importHash to compare against. NOHASH_MARKER_1313'

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/import/check')) {
        return new Response(JSON.stringify({
          existing: {
            // No `importHash` key at all — classifyDocs treats this as
            // 'update' WITHOUT computing a hash (the `ex.importHash ? ... :
            // null` short-circuit in classifyDocs), so beginScan's
            // `needsHash` filter deliberately EXCLUDES this note from
            // scan-time body conversion. Its body must still arrive intact
            // via handleConfirm's confirm-time `needsBody` fallback — this is
            // the deferral's OTHER half, distinct from the update test above
            // (which goes through the scan-time path because its existing
            // record DOES carry an importHash to compare against).
            [`file:${NAME}`]: { id: 'existing-3', updatedAt: new Date(LAST_MOD).toISOString() },
          },
        }))
      }
      if (String(url).endsWith('/import/confirm')) {
        return new Response(JSON.stringify({ created: [], updated: [{ importKey: `file:${NAME}`, id: 'existing-3' }], skipped: [] }))
      }
      if (String(url).endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))

    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [makeFileAt(NAME, NEW_CONTENT, LAST_MOD)] } })

    await waitFor(() => expect(screen.getByText(/update 1/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /import/i }))

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
      expect(call).toBeTruthy()
    })
    const call = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/api/j2/notes/import/confirm')
    const body = JSON.parse(call[1].body)
    const sentBody = body.notes[0].bodyJson
    // Not stale, not empty: a real, non-trivial TipTap doc carrying the
    // CURRENT content, filled in by confirm's own lazy conversion since scan
    // deliberately skipped it.
    expect(sentBody).toBeTruthy()
    expect(sentBody.content?.length || 0).toBeGreaterThan(0)
    expect(JSON.stringify(sentBody)).toContain('NOHASH_MARKER_1313')
  })
})

// ---------------------------------------------------------------------------
// Wave 5 — the arrival screen (spec §9) and post-migration enrichment (§8.1).
// ---------------------------------------------------------------------------
describe('ImportWizard — the arrival screen (§9)', () => {
  afterEach(() => vi.restoreAllMocks())

  function mockArrival({ scan } = {}) {
    return vi.fn(async (url, opts) => {
      const u = String(url)
      if (u.endsWith('/import/check')) return new Response(JSON.stringify({ existing: {} }))
      if (u.endsWith('/import/confirm')) {
        const body = JSON.parse(opts.body)
        return new Response(JSON.stringify({
          created: body.notes.map((n) => ({ importKey: n.importKey, id: `id-${n.importKey}` })),
          updated: [], skipped: [],
        }))
      }
      if (u.endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      if (u.endsWith('/enrichment/scan')) {
        return new Response(JSON.stringify(scan ?? { candidates: [], scanned: 0, truncated: false }))
      }
      return new Response(JSON.stringify({ ok: true }))
    })
  }

  it('shows a per-folder breakdown DERIVED from actual server outcomes, not the preview guess', async () => {
    // The confirm mock deliberately reports Sub/inner.md as `skipped` (not
    // `created`, whatever the preview may have guessed) — this is what makes
    // the test able to fail if the table read the preview's `docStatus`
    // instead of `summaryResult.outcomes`.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (u.endsWith('/import/check')) return new Response(JSON.stringify({ existing: {} }))
      if (u.endsWith('/import/confirm')) return new Response(JSON.stringify({
        created: [{ importKey: 'file:root.md', id: 'id-root' }],
        updated: [],
        skipped: [{ importKey: 'file:Sub/inner.md', id: 'id-inner' }],
      }))
      if (u.endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      if (u.endsWith('/enrichment/scan')) return new Response(JSON.stringify({ candidates: [], scanned: 1 }))
      return new Response(JSON.stringify({ ok: true }))
    }))
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const files = [
      makeFile('root.md', 'root.md', '# Root'),
      makeFile('inner.md', 'Sub/inner.md', '# Inner'),
    ]
    const input = screen.getByTestId('import-dir-input')
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(screen.getByText(/2 notes/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    await waitFor(() => expect(screen.getByText(/Imported 1 note\./i)).toBeInTheDocument())

    const unfiledRow = screen.getByRole('row', { name: /^Unfiled/i })
    const unfiledCells = within(unfiledRow).getAllByRole('cell').map((c) => c.textContent)
    expect(unfiledCells).toEqual(['Unfiled', '1', '0', '—']) // arrived, unchanged, needs-attention

    const subRow = screen.getByRole('row', { name: /^Sub/i })
    const subCells = within(subRow).getAllByRole('cell').map((c) => c.textContent)
    expect(subCells).toEqual(['Sub', '0', '1', '—'])
  })

  it('names notes the member excluded on the previous screen', async () => {
    vi.stubGlobal('fetch', mockArrival())
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const files = [makeFile('a.md', 'a.md', '# A'), makeFile('b.md', 'b.md', '# B')]
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(screen.getByText(/2 notes/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('checkbox', { name: /^B$/i }))
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    await waitFor(() => expect(screen.getByText(/Imported 1 note\./i)).toBeInTheDocument())

    expect(screen.getByText(/1 note left out of this import/i)).toBeInTheDocument()
  })

  it('the audit-B1 truncation warning survives onto the arrival screen, not just the preview', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const u = String(url)
      if (u.endsWith('/import/check')) return new Response(JSON.stringify({
        existing: {}, checked: 5000, total: 6000, truncated: true,
      }))
      if (u.endsWith('/import/confirm')) return new Response(JSON.stringify({
        created: [{ importKey: 'file:hello.md', id: 'n1' }], updated: [], skipped: [] }))
      if (u.endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      if (u.endsWith('/enrichment/scan')) return new Response(JSON.stringify({ candidates: [], scanned: 1 }))
      return new Response(JSON.stringify({ ok: true }))
    }))
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [mdFile] } })
    await waitFor(() => expect(screen.getByText(/5,000 of 6,000/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    await waitFor(() => expect(screen.getByText(/Imported 1 note\./i)).toBeInTheDocument())

    expect(screen.getByText(/5,000 of 6,000/)).toBeInTheDocument()
  })
})

describe('ImportWizard — post-migration enrichment offer (§8.1)', () => {
  afterEach(() => vi.restoreAllMocks())

  function mockEnrichment({ scan, embedsBody, putOk = true } = {}) {
    return vi.fn(async (url, opts) => {
      const u = String(url)
      if (u.endsWith('/import/check')) return new Response(JSON.stringify({ existing: {} }))
      if (u.endsWith('/import/confirm')) return new Response(JSON.stringify({
        created: [{ importKey: 'file:hello.md', id: 'id-1' }], updated: [], skipped: [] }))
      if (u.endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      if (u.endsWith('/enrichment/scan')) return new Response(JSON.stringify(scan))
      if (/\/notes\/[^/]+\/embeds$/.test(u)) {
        return new Response(JSON.stringify(embedsBody ?? {
          note: { bodyJson: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'widgetEmbed', attrs: { widgetId: 'chart' } }] } },
        }))
      }
      if (opts?.method === 'PUT' && /\/notes\/[^/]+$/.test(u)) {
        return new Response(JSON.stringify({ note: putOk ? {} : null }), { status: putOk ? 200 : 500 })
      }
      return new Response(JSON.stringify({ ok: true }))
    })
  }

  async function importOneNote() {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [mdFile] } })
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    await waitFor(() => expect(screen.getByText(/Imported 1 note\./i)).toBeInTheDocument())
  }

  it('scans the newly-written notes and offers the exact count found — with no offer at all when nothing matches', async () => {
    const fetchMock = mockEnrichment({ scan: { candidates: [], scanned: 1, truncated: false } })
    vi.stubGlobal('fetch', fetchMock)
    await importOneNote()

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/enrichment/scan'))).toBe(true)
    })
    // Assertion OUTSIDE the mock callback, on the recorded call.
    const scanCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/enrichment/scan'))
    expect(JSON.parse(scanCall[1].body)).toEqual({ noteIds: ['id-1'] })
    expect(screen.queryByText(/mentioning tickers/i)).not.toBeInTheDocument()
  })

  it('offers, applies (one embed POST per ticker), and truly UNDOES (a real PUT restoring the pre-append body)', async () => {
    const fetchMock = mockEnrichment({
      scan: { candidates: [{ id: 'id-1', title: 'Hello', tickers: ['NVDA'] }], scanned: 1, truncated: false },
    })
    vi.stubGlobal('fetch', fetchMock)
    await importOneNote()

    await waitFor(() => expect(screen.getByText(/We found 1 note mentioning tickers/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add live charts/i }))
    await waitFor(() => expect(screen.getByText(/Added 1 live chart to 1 note\./i)).toBeInTheDocument())

    const embedCall = fetchMock.mock.calls.find((c) => /\/notes\/id-1\/embeds$/.test(String(c[0])))
    expect(embedCall).toBeTruthy()
    expect(embedCall[1].method).toBe('POST')
    const sentAttrs = JSON.parse(embedCall[1].body).attrs
    expect(sentAttrs.widgetId).toBe('chart')
    expect(sentAttrs.params.symbol).toBe('NVDA')

    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }))
    await waitFor(() => expect(screen.getByText(/Undone/i)).toBeInTheDocument())

    const undoCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT' && /\/notes\/id-1$/.test(String(c[0])))
    expect(undoCall).toBeTruthy()
    // The undo PUT carries the doc with exactly its own last (the embed we
    // just added) content node removed — proving this is a real reversal,
    // not a client-side hide.
    const restoredBody = JSON.parse(undoCall[1].body).bodyJson
    expect(restoredBody.content).toEqual([{ type: 'paragraph' }])
  })

  it('"Not now" dismisses the offer and writes nothing', async () => {
    const fetchMock = mockEnrichment({
      scan: { candidates: [{ id: 'id-1', title: 'Hello', tickers: ['NVDA'] }], scanned: 1, truncated: false },
    })
    vi.stubGlobal('fetch', fetchMock)
    await importOneNote()

    await waitFor(() => expect(screen.getByText(/We found 1 note mentioning tickers/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))

    expect(screen.queryByText(/mentioning tickers/i)).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => /\/embeds$/.test(String(c[0])))).toBe(false)
  })
})
