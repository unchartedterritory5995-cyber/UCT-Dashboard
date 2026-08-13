// Capture-inbox tray rails (panel batch 3):
// 1. CONSUME-AFTER-SAVE — placing a capture must NOT delete its inbox row;
//    the row dies only after the save that persists the embed succeeds
//    (the page wires onPlaced → commitSave). Deleting on insert lost the
//    capture on BOTH ends whenever that save failed.
// 2. Two-step ✕ — the discard is unrecoverable and sat one misclick from
//    Insert (the 8/10 builder-sweep defect class).
// 3. Stale chips say their age — a week-old capture inserted as "today's"
//    was wrong evidence even though its capturedAt was honest.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { CaptureInboxTray } from './NoteEditorPage'

const OLD_ISO = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()

function makeEditor() {
  const chain = {
    focus: () => chain,
    insertWidgetEmbed: vi.fn(() => chain),
    run: () => true,
  }
  return {
    chain: () => chain,
    state: { selection: { node: null, from: 5 } },
    _chain: chain,
  }
}

function mockInbox(captures) {
  global.fetch = vi.fn((url, opts = {}) => {
    if (String(url) === '/api/j2/inbox' && !opts.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ captures }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
}

const renderTray = (editor, onPlaced) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <CaptureInboxTray editor={editor} onPlaced={onPlaced} />
  </SWRConfig>,
)

describe('CaptureInboxTray', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('placing inserts but does NOT delete — consumption waits for the save', async () => {
    mockInbox([{ id: 'c1', widgetId: 'chart', params: { symbol: 'AMD', tf: '5' }, searchText: '[chart: AMD 5m]', capturedAt: OLD_ISO }])
    const editor = makeEditor()
    const onPlaced = vi.fn()
    renderTray(editor, onPlaced)
    const chip = await screen.findByText(/\[chart: AMD 5m\]/)
    await userEvent.setup().click(chip)
    expect(editor._chain.insertWidgetEmbed).toHaveBeenCalledWith(
      'chart', { symbol: 'AMD', tf: '5' }, expect.objectContaining({ capturedAt: OLD_ISO }),
    )
    expect(onPlaced).toHaveBeenCalledWith('c1')
    // The chip hides locally, but NO DELETE reached the wire.
    await waitFor(() => expect(screen.queryByText(/\[chart: AMD 5m\]/)).toBeNull())
    const deletes = global.fetch.mock.calls.filter(([, o]) => o?.method === 'DELETE')
    expect(deletes).toHaveLength(0)
  })

  it('✕ is a two-step confirm; only the second click deletes', async () => {
    mockInbox([{ id: 'c2', widgetId: 'chart', params: {}, searchText: '[chart: NVDA D]', capturedAt: OLD_ISO }])
    renderTray(makeEditor(), vi.fn())
    const user = userEvent.setup()
    const x = await screen.findByRole('button', { name: 'Discard capture' })
    await user.click(x)
    // Armed, not deleted.
    expect(global.fetch.mock.calls.filter(([, o]) => o?.method === 'DELETE')).toHaveLength(0)
    const confirm = screen.getByRole('button', { name: 'Confirm discard' })
    expect(confirm).toHaveTextContent('Discard?')
    await user.click(confirm)
    await waitFor(() => {
      const deletes = global.fetch.mock.calls.filter(([, o]) => o?.method === 'DELETE')
      expect(deletes.map(([u]) => u)).toEqual(['/api/j2/inbox/c2'])
    })
  })

  it('a stale capture chip names its age', async () => {
    mockInbox([{ id: 'c3', widgetId: 'chart', params: {}, searchText: '[chart: MSFT D]', capturedAt: OLD_ISO }])
    renderTray(makeEditor(), vi.fn())
    await screen.findByText(/· 8d ago/)
  })
})
