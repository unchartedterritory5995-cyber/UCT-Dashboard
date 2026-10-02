// Wave 11 lane 11C — a note's version history lists the AI change sets that changed it,
// each labelled with the change set and its request, and undoable in one click.
// Hidden while the flag is off. Rendered TEXT is asserted; requests are read from fetch.mock.calls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const settled = []
vi.mock('../../lib/offline/settleNoteWrite', () => ({
  settleNoteWrite: vi.fn(async () => null),
  settleNoteWrites: vi.fn(async (revs) => { settled.push(...(revs || [])); return revs || [] }),
}))

import AiChangeSetHistory from './AiChangeSetHistory'
import AskInsertView, { writingHelpLabel } from './AskInsertView'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div>,
  NodeViewContent: (p) => <div {...p} />,
}))

const SETS = [{ id: 'csA', request: 'tag every NVDA earnings note', status: 'applied',
  createdAt: '2026-10-01T14:00:00+00:00', appliedAt: '2026-10-01T14:01:00+00:00', appliedChanges: 2 }]

function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body } }

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ai_actions_enabled: true })
  settled.length = 0
  global.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/j2/ai-actions?noteId=n1') return json(200, { changeSets: SETS })
    if (url === '/api/j2/ai-actions/csA/undo' && init.method === 'POST') {
      return json(200, { results: [{ id: 'x', noteId: 'n1', status: 'undone' }],
        revisions: [{ noteId: 'n1', updatedAt: 'rev-9' }] })
    }
    return json(404, { detail: 'Not Found' })
  })
})
afterEach(() => __resetNotebookFlags())

describe('AI change sets in a note’s history', () => {
  it('lists each set with its request and offers a named Undo; the undo lands the revision', async () => {
    const user = userEvent.setup()
    const onUndone = vi.fn()
    render(<AiChangeSetHistory noteId="n1" open onUndone={onUndone} />)
    expect(await screen.findByRole('region', { name: 'AI change sets on this note' })).toBeInTheDocument()
    expect(screen.getByText(/“tag every NVDA earnings note”/)).toBeInTheDocument()
    expect(screen.getByText(/2 changes/)).toBeInTheDocument()
    const undo = screen.getByRole('button', { name: 'Undo AI change set “tag every NVDA earnings note”' })
    await user.click(undo)
    expect(await screen.findByRole('status')).toHaveTextContent('Undid 1 change. Your notes are back as they were.')
    expect(settled).toEqual([{ noteId: 'n1', updatedAt: 'rev-9' }])
    expect(onUndone).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/· undone/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undo AI change set/ })).toBeNull()
  })

  it('says why when the note was edited since, in the server’s own sentence', async () => {
    const user = userEvent.setup()
    global.fetch.mockImplementation(async (url) => (url.endsWith('/undo')
      ? json(200, { results: [{ id: 'x', noteId: 'n1', status: 'undo_refused',
        message: 'This note was edited after the change set was applied, so it was left as it is.' }],
      revisions: [] })
      : json(200, { changeSets: SETS })))
    render(<AiChangeSetHistory noteId="n1" open />)
    await user.click(await screen.findByRole('button', { name: /Undo AI change set/ }))
    expect(await screen.findByRole('status'))
      .toHaveTextContent('This note was edited after the change set was applied, so it was left as it is.')
  })

  it('renders nothing while the flag is off (and asks the server nothing)', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ai_actions_enabled: false })
    const { container } = render(<AiChangeSetHistory noteId="n1" open />)
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('the provenance label on an AI-added block', () => {
  it('reads “Compass · AI change · <model> · <time>” and names the change set to a screen reader', () => {
    expect(writingHelpLabel({ action: 'ai_change', model: 'claude-sonnet-5', insertedAt: '' }))
      .toBe('Compass · AI change · claude-sonnet-5')
    render(<AskInsertView node={{ attrs: { action: 'ai_change', model: 'claude-sonnet-5',
      insertedAt: null, question: 'tag my notes' } }} />)
    expect(screen.getByRole('group', { name: 'Added by an AI change set: tag my notes' })).toBeInTheDocument()
    expect(screen.getByText('Compass · AI change · claude-sonnet-5')).toBeInTheDocument()
  })
})
