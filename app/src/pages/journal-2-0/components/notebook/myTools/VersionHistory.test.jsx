// Wave 8 (Task 8.17): a widget's version history in My tools. What the member sees (dates, names, the changed words,
// the question) and what the server is sent (paths, If-Match, bodies).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import VersionHistory, { QUESTION_BACK } from './VersionHistory'
import { installFetch, refuse, LIVE } from './__fixtures__/myToolsFixtures'
import { COPY, diffWords } from './myToolsLib'
import { FAILURE_COPY } from '../../../lib/builtWidgets'

const S_CONFLICT = 'SERVER: changed in another tab, from the server.'
const CURRENT = 'Net P&L, split by setup, for closed trades in the last 90 days.'
const REVS = [
  { rev: 3, summary: CURRENT, savedAt: '2025-03-04T17:00:00Z', named: null, current: true, placed: false, plan: {} },
  { rev: 2, summary: 'Net P&L, split by symbol, for closed trades in the last 30 days.', savedAt: '2025-03-01T18:30:00Z',
    named: 'Before the setup split', current: false, placed: true, plan: {} },
  { rev: 1, summary: 'Net P&L for closed trades in the last 90 days.', savedAt: '2025-02-01T17:05:00Z', named: null,
    current: false, placed: false, plan: {} },
]
const W1 = LIVE[0]                      // usedIn 3, etag 7, rev 3
const restored = (extra = {}) => ({ ...W1, rev: 4, etag: 8, ...extra })

let net
function mount(d = W1, routes = []) {
  net = installFetch([['GET', `/${d.id}/revs`, () => ({ revs: REVS })], ...routes])
  const announce = vi.fn()
  const onChanged = vi.fn()
  const onBack = vi.fn()
  const subBack = createRef()
  render(<VersionHistory d={d} onBack={onBack} subBackRef={subBack} announce={announce} onChanged={onChanged} />)
  return { announce, onChanged, onBack, subBack }
}
const revRow = (rev) => document.querySelector(`[data-rev="${rev}"]`)
async function askRestore(rev) {
  await screen.findAllByTestId('my-tools-rev')
  fireEvent.click(within(revRow(rev)).getByRole('button', { name: /^Restore the version from/ }))
  fireEvent.click(within(revRow(rev)).getByRole('button', { name: 'Restore' }))
}

beforeEach(() => { vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { fn(0); return 0 }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Version history', () => {
  it('lists every version newest first with its date, its name, and the words that differ from the current one', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Version history: Net P&L by setup' })).toHaveFocus()
    const rows = await screen.findAllByTestId('my-tools-rev')
    expect(rows.map((r) => r.getAttribute('data-rev'))).toEqual(['3', '2', '1'])
    expect(rows[0]).toHaveTextContent('Mar 4, 2025')
    expect(rows[0]).toHaveTextContent('Current version')
    expect(within(rows[0]).queryByRole('button', { name: /^Restore/ })).toBeNull()     // nothing to restore to
    expect(within(rows[1]).getByTestId('rev-name')).toHaveTextContent('Before the setup split')
    expect(rows[1]).toHaveTextContent('In your notes')
    // The changed words are marked; the shared ones are not.
    const marks = [...rows[1].querySelectorAll('mark')].map((m) => m.textContent)
    expect(marks).toEqual(['symbol,', '30'])
    expect(rows[0].querySelectorAll('mark')).toHaveLength(0)
    expect(screen.getByText('Highlighted words differ from the current version.')).toBeInTheDocument()
  })

  it('version_history_restore_then_question_when_used_elsewhere', async () => {
    const { onChanged } = mount(W1, [
      ['POST', '/w1/revs/2/restore', () => restored({ usedIn: 3, lastAnswer: null })],
      ['PUT', '/w1', () => restored({ etag: 9, placedRev: 4, lastAnswer: 'update_all' })],
    ])
    await askRestore(2)
    // Restore first (If-Match: the etag, never the rev)...
    const post = await waitFor(() => {
      const c = net.calls.find((x) => x.path === '/w1/revs/2/restore')
      expect(c).toBeTruthy()
      return c
    })
    expect(post.method).toBe('POST')
    expect(post.headers['If-Match']).toBe('7')
    // ...then the builder's question, because the widget is in more than one note.
    expect(await screen.findByText('This widget is in 3 notes.')).toBeInTheDocument()
    const saveNew = screen.getByRole('radio', { name: /Save as a new widget/ })
    expect(saveNew).toBeChecked()                                     // what is counted changed: "save as new" first
    expect(screen.getByText('The notes keep the widget as it was.')).toBeInTheDocument()
    expect(net.calls.some((c) => c.method === 'PUT')).toBe(false)     // nothing more is written until they answer
    fireEvent.click(screen.getByRole('radio', { name: /Update all 3 notes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Update all 3 notes' }))
    await waitFor(() => expect(net.calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = net.calls.find((c) => c.method === 'PUT')
    expect(put.path).toBe('/w1')
    expect(put.headers['If-Match']).toBe('8')                          // the etag the restore answered with
    expect(put.body).toEqual({ apply: 'update_all' })
    expect(onChanged).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Version history: Net P&L by setup' })).toBeInTheDocument()
  })

  it('"Save as a new widget" after a restore makes the copy, then puts this widget back as it was', async () => {
    const { announce } = mount(W1, [
      ['POST', '/w1/revs/2/restore', () => restored()],
      ['PUT', '/w1', () => ({ ...W1, id: 'w9', name: 'Net P&L by setup copy', rev: 1, etag: 1 })],
      ['POST', '/w1/revs/3/restore', () => restored({ rev: 5, etag: 9 })],
    ])
    await askRestore(2)
    await screen.findByText('This widget is in 3 notes.')
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    await waitFor(() => expect(net.calls.some((c) => c.path === '/w1/revs/3/restore')).toBe(true))
    const put = net.calls.find((c) => c.method === 'PUT')
    expect(put.body).toEqual({ apply: 'save_new' })
    expect(put.headers['If-Match']).toBe('8')
    const back = net.calls.find((c) => c.path === '/w1/revs/3/restore')
    expect(back.headers['If-Match']).toBe('8')                         // save_new does not move this widget's etag
    await waitFor(() => expect(announce).toHaveBeenCalledWith(
      'Saved the restored version as a new widget, “Net P&L by setup copy”. This widget and its notes are as they were.', 'ok'))
  })

  it('a widget in one note or none restores without the question', async () => {
    const one = { ...W1, usedIn: 1 }
    const { announce } = mount(one, [['POST', '/w1/revs/2/restore', () => restored({ usedIn: 1 })]])
    await askRestore(2)
    await waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Restored the version from Mar 1, 2025/), 'ok'))
    expect(screen.queryByText(/This widget is in/)).toBeNull()
    expect(net.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('restore asks first, and Cancel sends nothing', async () => {
    mount()
    await screen.findAllByTestId('my-tools-rev')
    fireEvent.click(within(revRow(1)).getByRole('button', { name: /^Restore the version from/ }))
    expect(within(revRow(1)).getByRole('group')).toHaveTextContent(
      'Restore the version from Feb 1, 2025, 11:05 AM? It is saved as a new version, so nothing is lost.')
    fireEvent.click(within(revRow(1)).getByRole('button', { name: 'Cancel' }))
    expect(net.calls.some((c) => c.method === 'POST')).toBe(false)
    expect(within(revRow(1)).getByRole('button', { name: /^Restore the version from/ })).toHaveFocus()
  })

  it('a restore from a stale tab shows the conflict sentence and Reload reads the widget again', async () => {
    const { announce } = mount(W1, [
      ['POST', '/w1/revs/2/restore', () => refuse(409, 'conflict', S_CONFLICT)],
      ['GET', '/w1', () => ({ ...W1, etag: 12 })],
    ])
    await askRestore(2)
    await waitFor(() => expect(within(revRow(2)).getByTestId('restore-confirm')).toHaveTextContent(S_CONFLICT))
    expect(announce).toHaveBeenCalledWith(S_CONFLICT, 'error')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(net.calls.some((c) => c.method === 'GET' && c.path === '/w1')).toBe(true))
    // The next restore carries the fresh etag.
    net.calls.length = 0
    await askRestore(2)
    await waitFor(() => expect(net.calls.find((c) => c.path === '/w1/revs/2/restore')?.headers['If-Match']).toBe('12'))
  })

  it('a restore with no If-Match answer (428) is the same conflict', async () => {
    mount(W1, [['POST', '/w1/revs/2/restore', () => ({ ok: false, status: 428, json: async () => ({}) })]])
    await askRestore(2)
    await waitFor(() => expect(within(revRow(2)).getByTestId('restore-confirm')).toHaveTextContent(FAILURE_COPY.conflict))
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('Name this version names it; Remove the name unnames it', async () => {
    const { announce } = mount(W1, [['POST', /^\/w1\/revs\/\d\/name$/, (req) => ({ rev: 1, named: req.body.name || null })]])
    await screen.findAllByTestId('my-tools-rev')
    fireEvent.click(within(revRow(1)).getByRole('button', { name: /^Name this version, from/ }))
    const field = screen.getByLabelText('Name for this version')
    expect(field).toHaveFocus()
    fireEvent.change(field, { target: { value: '  First try  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(net.calls.find((c) => c.path === '/w1/revs/1/name')).toMatchObject({
      method: 'POST', body: { name: 'First try' } }))
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Named the version from Feb 1, 2025, 11:05 AM “First try”.', 'ok'))
    fireEvent.click(within(revRow(2)).getByRole('button', { name: /^Rename this version, from/ }))
    expect(screen.getByLabelText('Name for this version')).toHaveValue('Before the setup split')
    fireEvent.click(screen.getByRole('button', { name: 'Remove the name' }))
    await waitFor(() => expect(net.calls.find((c) => c.path === '/w1/revs/2/name')?.body).toEqual({ name: '' }))
  })

  it('Escape (through the tab\'s subBack) leaves naming before it leaves the panel', async () => {
    const { subBack } = mount()
    await screen.findAllByTestId('my-tools-rev')
    expect(subBack.current()).toBe(false)                              // at the list: the panel itself goes back
    fireEvent.click(within(revRow(1)).getByRole('button', { name: /^Name this version, from/ }))
    expect(screen.getByLabelText('Name for this version')).toBeInTheDocument()
    let handled
    await waitFor(() => { handled = subBack.current(); expect(handled).toBe(true) })
    await waitFor(() => expect(screen.queryByLabelText('Name for this version')).toBeNull())
  })

  it('versions that cannot load say so, with Try again', async () => {
    net = installFetch([['GET', '/w1/revs', () => refuse(500, 'failed', '')]])
    render(<VersionHistory d={W1} onBack={() => {}} announce={() => {}} />)
    expect(await screen.findByText(COPY.revsFailed)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('diffWords', () => {
  it('marks only the words of the second sentence that are not in the first', () => {
    expect(diffWords('a b c d', 'a x c d')).toEqual([
      { text: 'a ', changed: false }, { text: 'x', changed: true }, { text: ' c d', changed: false }])
    expect(diffWords('same words', 'same words').every((r) => !r.changed)).toBe(true)
    expect(diffWords('', 'all new').map((r) => r.changed)).toEqual([true])
    expect(diffWords('x', '')).toEqual([])
  })
  it('a run of changed words is one mark, spaces included', () => {
    expect(diffWords('Net P&L last 90 days', 'Net P&L by symbol last 90 days')).toEqual([
      { text: 'Net P&L ', changed: false }, { text: 'by symbol', changed: true }, { text: ' last 90 days', changed: false }])
  })
})

describe('Version history, review fixes', () => {
  it('Restore opens its confirm with focus on the confirm\'s first button', async () => {
    mount()
    await screen.findAllByTestId('my-tools-rev')
    fireEvent.click(within(revRow(2)).getByRole('button', { name: /^Restore the version from/ }))
    const group = within(revRow(2)).getByTestId('restore-confirm')
    expect(within(group).getAllByRole('button')[0]).toHaveFocus()
    expect(within(group).getAllByRole('button')[0]).toHaveTextContent('Cancel')
  })

  it('the confirm names notes only when the widget is in a note', async () => {
    mount({ ...W1, usedIn: 0 })
    await screen.findAllByTestId('my-tools-rev')
    fireEvent.click(within(revRow(2)).getByRole('button', { name: /^Restore the version from/ }))
    expect(within(revRow(2)).getByTestId('restore-confirm')).not.toHaveTextContent(/notes/)
    cleanup()
    mount({ ...W1, usedIn: 2 })
    await screen.findAllByTestId('my-tools-rev')
    fireEvent.click(within(revRow(2)).getByRole('button', { name: /^Restore the version from/ }))
    expect(within(revRow(2)).getByTestId('restore-confirm')).toHaveTextContent('Your notes keep what they show.')
  })

  it('the restore question is My tools\' own: its heading, "Back to versions", and Reload on a stale tab', async () => {
    mount(W1, [
      ['POST', '/w1/revs/2/restore', () => restored()],
      ['PUT', '/w1', () => refuse(409, 'conflict', S_CONFLICT)],
      ['GET', '/w1', () => restored({ etag: 15 })],
    ])
    await askRestore(2)
    expect(await screen.findByRole('heading', { name: 'Restore this version?' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Back to versions' })).toBeInTheDocument()
    expect(screen.getByTestId('my-tools-history-question').className).toMatch(/pushPanel/)
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    expect(await screen.findByText(S_CONFLICT)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(net.calls.some((c) => c.method === 'GET' && c.path === '/w1')).toBe(true))
  })

  it('Back and Escape out of the question say the same words', async () => {
    const { announce, subBack } = mount(W1, [['POST', /^\/w1\/revs\/\d\/restore$/, () => restored()]])
    await askRestore(2)
    await screen.findByRole('heading', { name: 'Restore this version?' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to versions' }))
    expect(announce).toHaveBeenLastCalledWith(QUESTION_BACK, 'ok')
    announce.mockClear()
    await askRestore(1)
    await screen.findByRole('heading', { name: 'Restore this version?' })
    await waitFor(() => expect(subBack.current()).toBe(true))
    expect(announce).toHaveBeenLastCalledWith(QUESTION_BACK, 'ok')
  })

  it('save as new, second step refused: the exact sentence as an error, and "Go back to the version before" retries', async () => {
    let backTries = 0
    const { announce } = mount(W1, [
      ['POST', '/w1/revs/2/restore', () => restored()],
      ['PUT', '/w1', () => ({ ...W1, id: 'w9', name: 'Net P&L by setup copy', rev: 1, etag: 1 })],
      ['POST', '/w1/revs/3/restore', () => { backTries += 1; return backTries === 1 ? refuse(500, 'failed', '') : restored({ rev: 5, etag: 9 }) }],
    ])
    await askRestore(2)
    await screen.findByRole('heading', { name: 'Restore this version?' })
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    await waitFor(() => expect(announce).toHaveBeenCalledWith(
      "Saved a copy as a new widget. This widget couldn't go back to the version before; it now has the restored version as its newest.", 'error'))
    expect(COPY.revertFailed).toBe("Saved a copy as a new widget. This widget couldn't go back to the version before; it now has the restored version as its newest.")
    const retry = await screen.findByRole('button', { name: 'Go back to the version before' })
    await waitFor(() => expect(retry).toHaveFocus())
    fireEvent.click(retry)
    await waitFor(() => expect(backTries).toBe(2))
    expect(net.calls.filter((c) => c.path === '/w1/revs/3/restore').map((c) => c.headers['If-Match'])).toEqual(['8', '8'])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Go back to the version before' })).toBeNull())
    expect(announce).toHaveBeenLastCalledWith('This widget is back to the version before. Its notes are as they were.', 'ok')
  })

  it('a widget gone in another tab (404) leaves the panel with "That widget isn\'t available."', async () => {
    const onGone = vi.fn()
    net = installFetch([['GET', '/w1/revs', () => ({ revs: REVS })],
      ['POST', '/w1/revs/2/restore', () => ({ ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) })]])
    render(<VersionHistory d={W1} onBack={() => {}} announce={() => {}} onGone={onGone} />)
    await askRestore(2)
    await waitFor(() => expect(onGone).toHaveBeenCalledWith(COPY.gone))
  })
})
