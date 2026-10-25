// app/src/pages/journal-2-0/a11y/traderBlockTracker.a11y.test.jsx
//
// Wave 9 Task 9.14: the tracker block through 8A's axe harness, in the REAL BlockNodeView frame (its named group and
// Remove button), in the states a member meets: a scale with a value picked (its five buttons, the average, the
// latest, the chart and its table toggle), a duration input, the table shown, the ⋯ menu open, read-only (no
// controls), a built-in check-in, archived, a read failure with its Retry, a refused value beside its box, and
// offline. Each recipe asserts what painted before axe runs, so an empty screen cannot pass as a clean one. `fetch` is
// a fake trackers server; nothing reaches the network.
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { vi, expect, afterEach } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
import BlockNodeView from '../components/notebook/blocks/BlockNodeView'
import { TOOL_COPY } from '../lib/blocks/toolsApi'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const VALUES = { '2026-10-22': 3, '2026-10-23': 4, '2026-10-26': 2, '2026-10-27': 4 }
function serve({ kind = 'scale', archived = false, readOnly = false, readStatus = 200, refuse = null } = {}) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    if (url === '/api/j2/trackers/days' && method === 'POST') {
      if (readStatus !== 200) return json(readStatus, {})
      const { ids, days } = JSON.parse(init.body)
      const recent = Object.entries(VALUES).map(([day, value]) => ({ day, value: kind === 'duration' ? value * 100 : value }))
      return json(200, { trackers: Object.fromEntries(ids.map((id) => [id, {
        tracker: { id, name: readOnly ? 'Check-in mood' : 'Focus', kind, unit: null, archived, readOnly, settings: { days: 'any' } },
        days: Object.fromEntries(days.map((d) => [d, { day: d, value: recent.at(-1).value, text: kind === 'duration' ? '6h 40m' : '4', writable: !archived && !readOnly }])),
        recent, average: null, latest: null, n: recent.length }])) })
    }
    if (/^\/api\/j2\/trackers\/[^/]+\/days\//.test(url) && method === 'PUT' && refuse) return json(400, { detail: { code: 'invalid', message: refuse } })
    return json(404, {})
  })
}
const node = (id = 't1') => ({ attrs: { widgetId: 'tracker', params: { trackerId: id, day: '2026-10-27', bind: 'note-day', display: 'chart' }, searchText: '[tracker: Focus · For Tue Oct 27]' } })
const editor = (editable = true) => ({ isEditable: editable, storage: { uctJournalWidgets: { noteId: 'n1', noteDay: '2026-10-27' } } })
const mount = (editable = true, id) => render(<BlockNodeView node={node(id)} editor={editor(editable)} updateAttributes={() => {}} deleteNode={() => {}} />)
const frameOf = () => screen.findByRole('group', { name: 'Tracker' })

afterEach(() => { setOnline(true) })

axeSurface('trader-block-tracker', async () => {
  serve()
  mount()
  const frame = await frameOf()
  await within(frame).findByRole('button', { name: '4' })
  expect(within(frame).getAllByRole('button', { name: /^[1-5]$/ })).toHaveLength(5)
  expect(within(frame).getByRole('button', { name: '4' }).getAttribute('aria-pressed')).toBe('true')
  expect(within(frame).getByText('Average 3.25 from 4 entries')).toBeTruthy()
  expect(within(frame).getByText('Latest 4')).toBeTruthy()
  expect(within(frame).getByRole('img')).toBeTruthy()
  expect(within(frame).getByRole('button', { name: 'Show as table' })).toBeTruthy()
  expect(within(frame).getByRole('button', { name: 'Tracker options' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Remove Tracker' })).toBeTruthy()
})

axeSurface('trader-block-tracker:duration', async () => {
  serve({ kind: 'duration' })
  mount()
  const frame = await frameOf()
  const box = await within(frame).findByRole('textbox', { name: 'Focus (hours:minutes)' })
  expect(box.value).toBe('6:40')
})

axeSurface('trader-block-tracker:table', async () => {
  serve()
  mount()
  const frame = await frameOf()
  fireEvent.click(await within(frame).findByRole('button', { name: 'Show as table' }))
  const table = within(frame).getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(5)
})

axeSurface('trader-block-tracker:menu', async () => {
  serve()
  mount()
  const frame = await frameOf()
  await within(frame).findByRole('button', { name: '4' })
  fireEvent.click(within(frame).getByRole('button', { name: 'Tracker options' }))
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Manage…', 'Follow today', 'Show vs P&L'])
})

axeSurface('trader-block-tracker:readonly', async () => {
  serve()
  mount(false)
  const frame = await frameOf()
  expect(await within(frame).findByText('Latest 4')).toBeTruthy()
  expect(within(frame).queryAllByRole('button', { name: /^[1-5]$/ })).toEqual([])
  expect(within(frame).queryByRole('textbox')).toBeNull()
})

axeSurface('trader-block-tracker:checkin', async () => {
  serve({ readOnly: true })
  mount(true, 'checkin:mood')
  const frame = await frameOf()
  expect(await within(frame).findByText('Mood and focus come from your check-ins.')).toBeTruthy()
  expect(within(frame).queryAllByRole('button', { name: /^[1-5]$/ })).toEqual([])
})

axeSurface('trader-block-tracker:archived', async () => {
  serve({ archived: true })
  mount()
  const frame = await frameOf()
  expect(await within(frame).findByText(TOOL_COPY.archivedTracker)).toBeTruthy()
  expect(within(frame).queryAllByRole('button', { name: /^[1-5]$/ })).toEqual([])
})

axeSurface('trader-block-tracker:read-failed', async () => {
  serve({ readStatus: 500 })
  mount()
  const frame = await frameOf()
  expect(await within(frame).findByText(TOOL_COPY.readFailedTracker)).toBeTruthy()
  expect(within(frame).getByRole('button', { name: 'Retry' })).toBeTruthy()
})

axeSurface('trader-block-tracker:refused', async () => {
  serve({ kind: 'duration', refuse: 'A duration can be at most 24 hours.' })
  mount()
  const frame = await frameOf()
  const box = await within(frame).findByRole('textbox')
  fireEvent.change(box, { target: { value: '25:00' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(await within(frame).findByText('A duration can be at most 24 hours.')).toBeTruthy()
  expect(box.getAttribute('aria-invalid')).toBe('true')
})

axeSurface('trader-block-tracker:offline', async () => {
  serve()
  mount()
  const frame = await frameOf()
  await within(frame).findByRole('button', { name: '4' })
  act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
  expect(await within(frame).findByText(TOOL_COPY.offline)).toBeTruthy()
  expect(within(frame).getAllByRole('button', { name: /^[1-5]$/ }).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true)
})
