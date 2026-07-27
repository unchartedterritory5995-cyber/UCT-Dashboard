// Desk Courses — lesson clip windows (start_seconds / end_seconds).
// The syllabus chip ("starts at 22:20" / "22:20 – 41:05"), the play boundary
// (onPlay carries { startAt } for a fresh/rewatch pick but NEVER clobbers an
// in-progress resume), the CTA resume path, and the admin editor's start/end
// time inputs → PUT payload (mm:ss / h:mm:ss / bare-seconds parsing).
import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

import PathView, { parseTimeInput } from './PathView'

const videos = [
  { youtube_id: 'v0000000001', title: 'Lesson One', duration: '45:00' },
  { youtube_id: 'v0000000002', title: 'Lesson Two', duration: '1:10:00' },
  { youtube_id: 'v0000000003', title: 'Lesson Three', duration: '30:00' },
]

const pathFixture = () => ({
  id: 1,
  slug: 'foundations',
  name: 'Foundations',
  kind: 'course',
  blurb: null,
  steps: [
    { youtube_id: 'v0000000001', module_label: null, note: null, start_seconds: 1340, end_seconds: 2465 },
    { youtube_id: 'v0000000002', module_label: null, note: null, start_seconds: 90, end_seconds: null },
    { youtube_id: 'v0000000003', module_label: null, note: null, start_seconds: null, end_seconds: null },
  ],
  videos,
})

const freshStats = { done: 0, total: 3, started: false, mid: false, nextIndex: 0 }

let onPlay
beforeEach(() => {
  onPlay = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const renderView = (over = {}) =>
  render(
    <PathView
      path={pathFixture()}
      stats={freshStats}
      progress={{}}
      onBack={() => {}}
      onPlay={onPlay}
      {...over}
    />,
  )

/* ── The chip — mono clip window on rows that carry one ───────────────────── */

test('rows show the clip chip: range when both ends are set, "starts at" with start alone, nothing without', () => {
  renderView()
  expect(screen.getByText('22:20 – 41:05')).toBeTruthy() // lesson 1: both
  expect(screen.getByText('starts at 1:30')).toBeTruthy() // lesson 2: start only
  const rowThree = screen.getByRole('button', { name: 'Play Lesson Three' })
  expect(rowThree.textContent).not.toMatch(/starts at|–/)
})

/* ── Row click — the seek boundary ────────────────────────────────────────── */

test('clicking a start_seconds lesson plays with { startAt }; a plain lesson plays without', () => {
  renderView()
  fireEvent.click(screen.getByRole('button', { name: 'Play Lesson Two' }))
  expect(onPlay).toHaveBeenCalledWith(videos, 1, { startAt: 90 })
  fireEvent.click(screen.getByRole('button', { name: 'Play Lesson Three' }))
  expect(onPlay).toHaveBeenLastCalledWith(videos, 2)
})

test('an IN-PROGRESS lesson resumes — startAt must not clobber the member’s spot', () => {
  renderView({
    progress: { v0000000002: { t: 400, d: 4200, at: 5, done: false } },
    stats: { done: 0, total: 3, started: true, mid: true, nextIndex: 1 },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Play Lesson Two' }))
  expect(onPlay).toHaveBeenCalledWith(videos, 1)
})

test('a DONE lesson rewatches from the clip start', () => {
  renderView({
    progress: { v0000000001: { t: 2700, d: 2700, at: 5, done: true } },
    stats: { done: 1, total: 3, started: true, mid: true, nextIndex: 1 },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Play Lesson One' }))
  expect(onPlay).toHaveBeenCalledWith(videos, 0, { startAt: 1340 })
})

/* ── CTA — Start / Continue resume into a clip lesson ─────────────────────── */

test('Start on an untouched course seeks lesson 1 to its clip start', () => {
  renderView()
  fireEvent.click(screen.getByRole('button', { name: /Start/ }))
  expect(onPlay).toHaveBeenCalledWith(videos, 0, { startAt: 1340 })
})

test('Continue into an in-progress clip lesson resumes plainly (no startAt)', () => {
  renderView({
    progress: { v0000000002: { t: 400, d: 4200, at: 5, done: false } },
    stats: { done: 0, total: 3, started: true, mid: true, nextIndex: 1 },
  })
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
  expect(onPlay).toHaveBeenCalledWith(videos, 1)
})

test('Continue into a NOT-YET-STARTED clip lesson seeks to its clip start', () => {
  renderView({
    progress: { v0000000001: { t: 2700, d: 2700, at: 5, done: true } },
    stats: { done: 1, total: 3, started: true, mid: true, nextIndex: 1 },
  })
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
  expect(onPlay).toHaveBeenCalledWith(videos, 1, { startAt: 90 })
})

/* ── Admin editor — start/end inputs → PUT payload ────────────────────────── */

const jsonRes = (obj, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(obj) })

const renderEditor = () => {
  const fetchFn = vi.fn(() => jsonRes({ ok: true }))
  vi.stubGlobal('fetch', fetchFn)
  renderView({ isAdmin: true, initialEdit: true, allVideos: videos, onSaved: vi.fn() })
  return fetchFn
}
const clickSave = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })

test('editor prefills stored seconds as mm:ss / h:mm:ss text', () => {
  renderEditor()
  expect(screen.getByLabelText('Start time for lesson 1').value).toBe('22:20')
  expect(screen.getByLabelText('End time for lesson 1').value).toBe('41:05')
  expect(screen.getByLabelText('Start time for lesson 2').value).toBe('1:30')
  expect(screen.getByLabelText('End time for lesson 2').value).toBe('')
})

test('edited times land in the PUT as integer seconds (mm:ss AND bare seconds both parse)', async () => {
  const fetchFn = renderEditor()
  fireEvent.change(screen.getByLabelText('Start time for lesson 3'), { target: { value: '5:00' } })
  fireEvent.change(screen.getByLabelText('End time for lesson 3'), { target: { value: '600' } })
  await clickSave()
  const put = fetchFn.mock.calls.find(([url, opts]) => opts?.method === 'PUT' && String(url).includes('/paths/1/steps'))
  expect(put).toBeTruthy()
  expect(JSON.parse(put[1].body).steps).toEqual([
    { youtube_id: 'v0000000001', module_label: null, note: null, start_seconds: 1340, end_seconds: 2465 },
    { youtube_id: 'v0000000002', module_label: null, note: null, start_seconds: 90, end_seconds: null },
    { youtube_id: 'v0000000003', module_label: null, note: null, start_seconds: 300, end_seconds: 600 },
  ])
})

test('clearing a time input saves null (removes the clip window)', async () => {
  const fetchFn = renderEditor()
  fireEvent.change(screen.getByLabelText('Start time for lesson 1'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('End time for lesson 1'), { target: { value: '' } })
  await clickSave()
  const put = fetchFn.mock.calls.find(([, opts]) => opts?.method === 'PUT')
  expect(JSON.parse(put[1].body).steps[0]).toEqual({
    youtube_id: 'v0000000001', module_label: null, note: null, start_seconds: null, end_seconds: null,
  })
})

test('an unparseable time blocks the save inline — nothing is fetched, the draft survives', async () => {
  const fetchFn = renderEditor()
  fireEvent.change(screen.getByLabelText('Start time for lesson 2'), { target: { value: 'twenty' } })
  await clickSave()
  expect(fetchFn).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toMatch(/Lesson 2/)
  expect(screen.getByLabelText('Start time for lesson 2').value).toBe('twenty') // draft intact
})

test('end at-or-before start blocks the save inline', async () => {
  const fetchFn = renderEditor()
  fireEvent.change(screen.getByLabelText('End time for lesson 2'), { target: { value: '1:30' } })
  await clickSave()
  expect(fetchFn).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toMatch(/Lesson 2/)
})

/* ── parseTimeInput — the documented input grammar ────────────────────────── */

test('parseTimeInput: mm:ss, h:mm:ss, bare seconds; empty → null; junk → undefined', () => {
  expect(parseTimeInput('22:20')).toBe(1340)
  expect(parseTimeInput('1:02:05')).toBe(3725)
  expect(parseTimeInput('0:07')).toBe(7)
  expect(parseTimeInput('1340')).toBe(1340)
  expect(parseTimeInput('0')).toBe(0)
  expect(parseTimeInput(' 5:00 ')).toBe(300)
  expect(parseTimeInput('')).toBeNull()
  expect(parseTimeInput('  ')).toBeNull()
  expect(parseTimeInput('twenty')).toBeUndefined()
  expect(parseTimeInput('1:75')).toBeUndefined() // seconds > 59
  expect(parseTimeInput('1:99:00')).toBeUndefined() // minutes > 59 with hours
  expect(parseTimeInput('-5')).toBeUndefined()
})
