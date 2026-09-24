import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

import NoteTasksView from './NoteTasksView'

const TODAY = '2026-09-23'
const task = (over) => ({
  noteId: 'n1', noteTitle: 'Plan', noteUpdatedAt: '2026-09-22', index: 0, checked: false,
  text: 'A task', due: null, bucket: 'none', depth: 0, ...over,
})
const OPEN = {
  today: TODAY, truncated: false,
  tasks: [
    task({ text: 'Overdue item', due: '2026-09-20', bucket: 'overdue', index: 0 }),
    task({ text: 'Due today', due: TODAY, bucket: 'today', index: 1, noteId: 'n2', noteTitle: 'Watchlist' }),
    task({ text: 'No date item', index: 4 }),
  ],
}
OPEN.count = OPEN.tasks.length

let fetchSpy
function routes(map) {
  fetchSpy = vi.fn((url) => {
    const hit = Object.entries(map).find(([k]) => url.endsWith(k))
    if (!hit) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    const [ok, body] = hit[1]
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })
  })
  vi.stubGlobal('fetch', fetchSpy)
}

const renderIt = (props = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <NoteTasksView {...props} />
  </SWRConfig>,
)

beforeEach(() => navSpy.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('NoteTasksView', () => {
  it('says it is loading, then groups open tasks in the fixed order and omits empty groups', async () => {
    routes({ '?status=open': [true, OPEN] })
    renderIt()
    expect(screen.getByRole('status').textContent).toBe('Loading your tasks…')
    await screen.findByText('Overdue item')
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Overdue (1)', 'Today (1)', 'No date (1)'])   // no "Upcoming": empty
    expect(screen.getByText('3 days overdue', { exact: false })).toBeTruthy()
  })

  it('a row opens its note AT that task', async () => {
    routes({ '?status=open': [true, OPEN] })
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: /Due today/ }))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n2&task=1')
  })

  it('an onOpenTask prop takes the click instead of navigating', async () => {
    routes({ '?status=open': [true, OPEN] })
    const onOpenTask = vi.fn()
    renderIt({ onOpenTask })
    fireEvent.click(await screen.findByRole('button', { name: /No date item/ }))
    expect(onOpenTask).toHaveBeenCalledWith('n1', 4)
    expect(navSpy).not.toHaveBeenCalled()
  })

  it('is READ-ONLY: no checkbox, and clicking never writes', async () => {
    routes({ '?status=open': [true, OPEN] })
    renderIt()
    await screen.findByText('Overdue item')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('To tick a task off, open its note.')).toBeTruthy()
    for (const b of screen.getAllByRole('button')) fireEvent.click(b)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    for (const [, init] of fetchSpy.mock.calls) {
      expect((init?.method || 'GET').toUpperCase()).toBe('GET')
    }
  })

  it('each row names the task, its due date and its note for a screen reader', async () => {
    routes({ '?status=open': [true, OPEN] })
    renderIt()
    const row = await screen.findByRole('button', { name: /Overdue item/ })
    expect(row.getAttribute('aria-label')).toBe('Overdue item, 3 days overdue. Open “Plan”')
  })

  it('the Done tab asks for finished tasks and shows them in one list', async () => {
    routes({
      '?status=open': [true, OPEN],
      '?status=done': [true, { today: TODAY, truncated: false, count: 1,
        tasks: [task({ text: 'Logged the trade', checked: true, index: 2 })] }],
    })
    renderIt()
    await screen.findByText('Overdue item')
    const toggle = screen.getByRole('group', { name: 'Show tasks' })
    fireEvent.click(within(toggle).getByRole('button', { name: 'Done' }))
    await screen.findByText('Logged the trade')
    expect(within(toggle).getByRole('button', { name: 'Done' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Done (1)'])
    expect(fetchSpy.mock.calls.some(([u]) => u.endsWith('?status=done'))).toBe(true)
  })

  it('an empty list says what to do', async () => {
    routes({ '?status=open': [true, { today: TODAY, tasks: [], count: 0, truncated: false }] })
    renderIt()
    expect(await screen.findByText('No open tasks. Add a checklist to any note and its items show up here.')).toBeTruthy()
  })

  it('a failed load says so and can be retried — never a silent blank', async () => {
    routes({ '?status=open': [false, {}] })
    renderIt()
    expect(await screen.findByText('Couldn’t load your tasks.')).toBeTruthy()
    routes({ '?status=open': [true, OPEN] })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Overdue item')).toBeTruthy()
  })

  it('says when the list was cut short', async () => {
    routes({ '?status=open': [true, { ...OPEN, truncated: true }] })
    renderIt()
    expect(await screen.findByText('Showing the first 3 tasks.')).toBeTruthy()
  })
})
