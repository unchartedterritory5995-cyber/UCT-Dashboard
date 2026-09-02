import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ExportDialog from './ExportDialog'

// The export existed for a full wave with NO UI door — 549 lines of service,
// 718 lines of tests, a live route, and `grep -rn "notes/export" app/src/`
// returning nothing. These tests exist to keep that from recurring: they
// assert the door is REACHABLE and that pressing it actually hits the
// endpoint, which is the one thing a service-level test structurally cannot
// prove.
//
// ⛔ Every assertion on `fetch` reads `fetch.mock.calls` OUTSIDE any mock
// callback. An assertion written inside a mock's `json()`/`blob()` body is
// swallowed by the caller's `.catch` and passes while the wire is cut — a
// mistake that has shipped in this codebase before.

function zipResponse({ filename = 'uct-notebook-export-20260902.zip' } = {}) {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(['PK'], { type: 'application/zip' }),
    headers: {
      get: (name) =>
        name.toLowerCase() === 'content-disposition'
          ? `attachment; filename="${filename}"`
          : null,
    },
  }
}

let clickedAnchors

beforeEach(() => {
  clickedAnchors = []
  // jsdom has no download manager: capture the anchor the component builds
  // rather than letting it no-op silently, so "a download was handed off" is
  // an assertable fact instead of an assumption.
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
    const el = realCreate(tag, ...rest)
    if (tag === 'a') {
      el.click = () => { clickedAnchors.push({ href: el.href, download: el.download }) }
    }
    return el
  })
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  global.URL.revokeObjectURL = vi.fn()
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ExportDialog', () => {
  it('does not fetch anything until the member asks for the download', () => {
    render(<ExportDialog open onClose={() => {}} />)
    // Opening the dialog must not start an export — the archive is expensive
    // to build and this is a single-replica pod.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('requests the export endpoint when the download is pressed', async () => {
    global.fetch.mockResolvedValue(zipResponse())
    render(<ExportDialog open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /download/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // Asserted OUTSIDE the mock, on the recorded calls.
    const [url] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/j2/notes/export')
  })

  it('hands the browser a download named by the server, not a guess', async () => {
    global.fetch.mockResolvedValue(
      zipResponse({ filename: 'uct-notebook-export-19991231.zip' }),
    )
    render(<ExportDialog open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /download/i }))

    await waitFor(() => expect(clickedAnchors.length).toBe(1))
    // The filename must come from Content-Disposition. A component that
    // invented its own name would pass a weaker assertion; this one pins the
    // server as the authority.
    expect(clickedAnchors[0].download).toBe('uct-notebook-export-19991231.zip')
  })

  it('surfaces a failed export instead of looking like it worked', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({ detail: 'export failed' }),
      text: async () => 'export failed',
    })
    render(<ExportDialog open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /download/i }))

    // Silence after a failure is the defect: a member who sees nothing
    // assumes the file is coming. Assert the server's own reason is shown —
    // not a generic message — and that recovery is offered.
    await waitFor(() => {
      expect(screen.getByText('export failed')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(clickedAnchors.length).toBe(0)
  })
})
