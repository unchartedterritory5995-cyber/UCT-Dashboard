// app/src/pages/journal-2-0/a11y/traderBlockTracker.a11y.test.jsx
//
// Wave 9 Task 9.14: the tracker block through 8A's axe harness, in the REAL BlockNodeView frame (its named group and
// Remove button), in the states a member meets: a scale with a value picked (its five buttons, the average, the
// latest, the chart and its table toggle), a duration input, the table shown, the ⋯ menu open, read-only (no
// controls), a built-in check-in, archived, a read failure with its Retry, a refused value beside its box, and
// offline. Each recipe asserts what painted before axe runs, so an empty screen cannot pass as a clean one. `fetch` is
// a fake trackers server; nothing reaches the network.
//
// ⛔ DETERMINISTIC (Task 9.14 fix round 1): every recipe runs on FAKE timers and drives them itself (`settle`), so no
// poll, debounce or animation frame depends on how loaded the box is; it awaits every dynamic import; and it hands
// axe a settled DOM on real timers (axe schedules its own work), with every fake timer still pending DISCARDED, never
// run after the test. The channel is a fake with no handle, so nothing is left open at teardown.
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { vi, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
import BlockNodeView from '../components/notebook/blocks/BlockNodeView'
import '../components/notebook/blocks/TrackerBlock'          // loaded up front: the lazy body resolves at once
import { TOOL_COPY } from '../lib/blocks/toolsApi'

/** A channel with no OS handle (the data layer opens one lazily). */
class QuietBC { constructor() { this.onmessage = null } postMessage() {} addEventListener() {} close() {} }
const realBC = globalThis.BroadcastChannel
beforeAll(() => { globalThis.BroadcastChannel = QuietBC })
afterAll(() => { globalThis.BroadcastChannel = realBC })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); setOnline(true) })

/** Run the fake clock forward in small steps, letting React commit and every dynamic import land between them. */
async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    await vi.dynamicImportSettled()
  }
}
/** `check()` once it passes (the clock is driven, never waited on); its own error if it never does. */
async function when(check) {
  for (let i = 0; i < 40; i += 1) {
    try { return check() } catch { await settle(1) }
  }
  return check()
}
/** The end of every recipe: settle, drop whatever the fake clock still holds, and give axe the real clock. */
async function done() {
  await settle(5)
  vi.clearAllTimers()
  vi.useRealTimers()
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const VALUES = { '2026-10-22': 3, '2026-10-23': 4, '2026-10-26': 2, '2026-10-27': 4 }
/** The server's summary over the recent entries (trackers._summary): the readable values' average, the newest entry
 *  when it has a value, and the count (never 0). The fake computes what the real server sends. */
const summary = (recent) => {
  const vals = recent.map((r) => r.value).filter((v) => typeof v === 'number' && Number.isFinite(v))
  const last = recent[recent.length - 1]
  return { average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    latest: last && typeof last.value === 'number' ? { ...last } : null, n: recent.length || null }
}
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
        recent, ...summary(recent) }])) })
    }
    if (/^\/api\/j2\/trackers\/[^/]+\/days\//.test(url) && method === 'PUT' && refuse) return json(400, { detail: { code: 'invalid', message: refuse } })
    return json(404, {})
  })
}
const node = (id = 't1') => ({ attrs: { widgetId: 'tracker', params: { trackerId: id, day: '2026-10-27', bind: 'note-day', display: 'chart' }, searchText: '[tracker: Focus · For Tue Oct 27]' } })
const editor = (editable = true) => ({ isEditable: editable, storage: { uctJournalWidgets: { noteId: 'n1', noteDay: '2026-10-27' } } })
const mount = (editable = true, id) => render(<BlockNodeView node={node(id)} editor={editor(editable)} updateAttributes={() => {}} deleteNode={() => {}} />)
const frameOf = () => when(() => screen.getByRole('group', { name: 'Tracker' }))

axeSurface('trader-block-tracker', async () => {
  serve()
  mount()
  const frame = await frameOf()
  await when(() => within(frame).getByRole('button', { name: '4' }))
  expect(within(frame).getAllByRole('button', { name: /^[1-5]$/ })).toHaveLength(5)
  expect(within(frame).getByRole('button', { name: '4' }).getAttribute('aria-pressed')).toBe('true')
  expect(within(frame).getByText('Average 3.25 from 4 entries')).toBeTruthy()
  expect(within(frame).getByText('Latest 4 (Tue Oct 27)')).toBeTruthy()
  expect(within(frame).getByRole('img')).toBeTruthy()
  expect(within(frame).getByRole('button', { name: 'Show as table' })).toBeTruthy()
  expect(within(frame).getByRole('button', { name: 'Tracker options' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Remove Tracker' })).toBeTruthy()
  await done()
})

axeSurface('trader-block-tracker:duration', async () => {
  serve({ kind: 'duration' })
  mount()
  const frame = await frameOf()
  const box = await when(() => within(frame).getByRole('textbox', { name: 'Focus (hours:minutes)' }))
  expect(box.value).toBe('6:40')
  await done()
})

axeSurface('trader-block-tracker:table', async () => {
  serve()
  mount()
  const frame = await frameOf()
  fireEvent.click(await when(() => within(frame).getByRole('button', { name: 'Show as table' })))
  await settle(2)
  const table = within(frame).getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(5)
  expect(within(table).getAllByRole('rowheader')).toHaveLength(4)
  expect(within(frame).getByRole('button', { name: 'Hide table' })).toBeTruthy()
  await done()
})

axeSurface('trader-block-tracker:menu', async () => {
  serve()
  mount()
  const frame = await frameOf()
  await when(() => within(frame).getByRole('button', { name: '4' }))
  fireEvent.click(within(frame).getByRole('button', { name: 'Tracker options' }))
  await settle(2)
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Manage…', 'Follow today', 'Show the P&L comparison first'])
  await done()
})

axeSurface('trader-block-tracker:readonly', async () => {
  serve()
  mount(false)
  const frame = await frameOf()
  await when(() => within(frame).getByText('Latest 4 (Tue Oct 27)'))
  expect(within(frame).queryAllByRole('button', { name: /^[1-5]$/ })).toEqual([])
  expect(within(frame).queryByRole('textbox')).toBeNull()
  await done()
})

axeSurface('trader-block-tracker:checkin', async () => {
  serve({ readOnly: true })
  mount(true, 'checkin:mood')
  const frame = await frameOf()
  await when(() => within(frame).getByText('Mood and focus come from your check-ins.'))
  expect(within(frame).queryAllByRole('button', { name: /^[1-5]$/ })).toEqual([])
  await done()
})

axeSurface('trader-block-tracker:archived', async () => {
  serve({ archived: true })
  mount()
  const frame = await frameOf()
  await when(() => within(frame).getByText(TOOL_COPY.archivedTracker))
  expect(within(frame).queryAllByRole('button', { name: /^[1-5]$/ })).toEqual([])
  await done()
})

axeSurface('trader-block-tracker:read-failed', async () => {
  serve({ readStatus: 500 })
  mount()
  const frame = await frameOf()
  await when(() => within(frame).getByText(TOOL_COPY.readFailedTracker))
  expect(within(frame).getByRole('button', { name: 'Retry' })).toBeTruthy()
  await done()
})

axeSurface('trader-block-tracker:refused', async () => {
  serve({ kind: 'duration', refuse: 'A duration can be at most 24 hours.' })
  mount()
  const frame = await frameOf()
  const box = await when(() => within(frame).getByRole('textbox'))
  fireEvent.change(box, { target: { value: '25:00' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await when(() => within(frame).getByText('A duration can be at most 24 hours.'))
  expect(box.getAttribute('aria-invalid')).toBe('true')
  await done()
})

axeSurface('trader-block-tracker:offline', async () => {
  serve()
  mount()
  const frame = await frameOf()
  await when(() => within(frame).getByRole('button', { name: '4' }))
  act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
  await when(() => within(frame).getByText(TOOL_COPY.offline))
  expect(within(frame).getAllByRole('button', { name: /^[1-5]$/ }).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true)
  await done()
})
