// Wave 8 (Task 8.17): a widget's version history in My tools. What the member sees (dates, names, the changed words,
// the question) and what the server is sent (paths, If-Match, bodies).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import VersionHistory from './VersionHistory'
import { installFetch, refuse, LIVE } from './__fixtures__/myToolsFixtures'
import { diffWords } from './myToolsLib'

const S_CONFLICT = 'Changed in another tab. Reload to see the newer version.'
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
      'Saved the restored version as a new widget, “Net P&L by setup copy”. This widget and its notes are as they were.'))
  })

  it('a widget in one note or none restores without the question', async () => {
    const one = { ...W1, usedIn: 1 }
    const { announce } = mount(one, [['POST', '/w1/revs/2/restore', () => restored({ usedIn: 1 })]])
    await askRestore(2)
    await waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Restored the version from Mar 1, 2025/)))
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
    mount(W1, [
      ['POST', '/w1/revs/2/restore', () => refuse(409, 'conflict', S_CONFLICT)],
      ['GET', '/w1', () => ({ ...W1, etag: 12 })],
    ])
    await askRestore(2)
    expect(await screen.findByRole('alert')).toHaveTextContent(S_CONFLICT)
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
    expect(await screen.findByRole('alert')).toHaveTextContent(S_CONFLICT)
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
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Named the version from Feb 1, 2025, 11:05 AM “First try”.'))
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
    expect(await screen.findByRole('alert')).toHaveTextContent("The versions couldn't be loaded just now.")
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
