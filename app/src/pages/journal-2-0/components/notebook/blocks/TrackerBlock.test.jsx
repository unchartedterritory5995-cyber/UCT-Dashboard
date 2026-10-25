// The tracker block (Notebook widgets phase 2, wave 9, Task 9.14). Asserted by RENDERED TEXT after the action has
// settled, never by state: a sentence a member cannot read is not a sentence.
import { Profiler, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import TrackerBlock, { CHECKIN_LINE, EMPTY_LINE, TRADING_ONLY } from './TrackerBlock'
import { DURATION_HINT } from '../../../lib/blocks/trackerValues'
import { TOOL_COPY } from '../../../lib/blocks/toolsApi'
import { CAVEAT, FAILED, PNL_FIRST, TRACKER_FLIP } from './VsPnlPanel'
import { contrast } from '../../../../../styles/__tests__/contrastMath'
import { themeVars, resolveVars, parseColor, THEMES } from '../../../a11y/cssAudit'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })

// The server's own value words (api/services/journal_two/tracker_days.format_value), restated for the fake only.
const numText = (v) => { const t = (Math.round(v * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); return t === '-0' ? '0' : t }
function fmt(kind, v, unit) {
  if (v === null || v === undefined) return null
  if (kind === 'yesno') return v >= 0.5 ? 'Yes' : 'No'
  if (kind === 'scale') return String(Math.round(v))
  if (kind === 'duration') { const t = Math.round(v); const h = Math.floor(t / 60); const m = t % 60; return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m` }
  return unit ? `${numText(v)} ${unit}` : numText(v)
}
/** The server's value gate (tracker_days.clean_value): a refusal is `{code: 'invalid', message}`. */
function clean(kind, raw) {
  const finite = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  if (kind === 'yesno') { if (typeof raw === 'boolean') return raw ? 1 : 0; if (finite === 0 || finite === 1) return finite; throw new Error('Pick yes or no.') }
  if (kind === 'scale') { if (finite === null || !Number.isInteger(finite) || finite < 1 || finite > 5) throw new Error('Pick a value from 1 to 5.'); return finite }
  if (kind === 'duration') { if (finite === null) throw new Error('Enter a number.'); if (finite < 0 || finite > 1440) throw new Error('A duration can be at most 24 hours.'); return finite }
  if (finite === null || Math.abs(finite) > 1e9) throw new Error('Enter a number.')
  return finite
}

/** The server's summary over the recent entries (trackers._summary): the readable values' average, the newest entry
 *  when it has a value, and the count (never 0). The fake computes what the real server sends. */
const summary = (recent) => {
  const vals = recent.map((r) => r.value).filter((v) => typeof v === 'number' && Number.isFinite(v))
  const last = recent[recent.length - 1]
  return { average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    latest: last && typeof last.value === 'number' ? { ...last } : null, n: recent.length || null }
}
/** A fake trackers server over `fetch`, holding one tracker (or a built-in check-in). */
function serve(over = {}) {
  const st = {
    id: 't1', name: 'Sleep', kind: 'duration', unit: null, values: {}, today: '2026-10-27', readStatus: 200,
    logStatus: [], archived: false, foreign: false, writable: true, days: 'any', readOnly: false, ...over,
  }
  const calls = []
  const dayOf = (d) => ({ day: st.entryDay ?? d, value: st.values[d] ?? null, text: fmt(st.kind, st.values[d] ?? null, st.unit),
    writable: st.forceWritable || (st.writable && !st.archived && !st.readOnly) })
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null })
    if (url === '/api/j2/trackers/days' && method === 'POST') {
      if (st.readStatus !== 200) return json(st.readStatus, {})
      const { ids, days } = JSON.parse(init.body)
      const out = { trackers: {} }
      if (days.includes('today')) out.resolved = { today: st.today }
      const real = days.map((d) => (d === 'today' ? st.today : d))
      const upto = [...real].sort().at(-1)
      for (const id of ids) {
        if (id !== st.id || st.foreign) continue
        const recent = Object.keys(st.values).filter((d) => d <= upto).sort().slice(-30).map((d) => ({ day: d, value: st.values[d] }))
        out.trackers[id] = {
          tracker: { id, name: st.name, kind: st.kind, unit: st.unit, archived: st.archived, readOnly: st.readOnly, settings: { days: st.days } },
          days: Object.fromEntries(real.map((d) => [d, dayOf(d)])),
          recent, ...summary(recent),
        }
      }
      return json(200, out)
    }
    let m = /^\/api\/j2\/trackers\/([^/]+)\/days\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      const s = st.logStatus.length ? st.logStatus.shift() : 200
      if (s !== 200) return json(s, {})
      if (st.readOnly) return json(409, { detail: { code: 'read_only', message: CHECKIN_LINE } })
      if (st.forceRefusal) return json(400, { detail: st.forceRefusal })
      const day = decodeURIComponent(m[2])
      const { value } = JSON.parse(init.body)
      if (value === null) delete st.values[day]
      else {
        try { st.values[day] = clean(st.kind, value) } catch (e) { return json(400, { detail: { code: 'invalid', message: e.message } }) }
      }
      return json(200, dayOf(day))
    }
    m = /^\/api\/j2\/trackers\/([^/]+)\/unarchive$/.exec(url)
    if (m && method === 'POST') { st.archived = false; return json(200, { id: st.id }) }
    // The tracker editor's own read (Task 9.16's door, ruling W9-R47).
    if (url === `/api/j2/trackers/${st.id}` && method === 'GET' && st.editorReadable) {
      return json(200, { id: st.id, name: st.name, kind: st.kind, unit: st.unit, settings: { days: st.days }, etag: 1,
        archived: st.archived, readOnly: st.readOnly, usedIn: 1 })
    }
    m = /^\/api\/j2\/trackers\/([^/]+)\/vs-pnl$/.exec(url)
    if (m && method === 'GET') return json(200, { buckets: [], sentence: 'Sleep under 6h: avg day −$210 (9 days); 6h-8h: +$95 (22 days). A comparison, not proof.' })
    return json(404, {})
  })
  return { st, calls, reads: () => calls.filter((c) => c.url === '/api/j2/trackers/days'), puts: () => calls.filter((c) => c.method === 'PUT') }
}

const PARAMS = { trackerId: 't1', day: '2026-10-27', bind: 'note-day', display: 'chart' }
/** The fake vs P&L sentence without its caveat: the panel's first line (the caveat is its own last line). */
const PNL_LEAD = 'Sleep under 6h: avg day −$210 (9 days); 6h-8h: +$95 (22 days).'
const editorWith = (noteDay) => ({ storage: { uctJournalWidgets: noteDay ? { noteDay } : {} } })
function mount(props = {}) {
  const setParams = props.setParams || vi.fn(() => true)
  const utils = render(<TrackerBlock params={PARAMS} setParams={setParams} editable editor={editorWith('2026-10-27')} {...props} />)
  return { ...utils, setParams }
}
const dayLine = () => screen.getByText(/^For /).closest('p')
const input = () => screen.queryByRole('textbox')
const menuRow = (label) => screen.getByText(label).closest('button')
const pressed = (name) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
async function typeEnter(text) {
  const box = input()
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
/** Every text node, SPACE-separated (textContent runs neighbouring nodes together and hides a 0 from \b). */
function textOf(el) {
  const out = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) out.push(w.currentNode.nodeValue)
  return out.join(' ')
}
const days = (n, from = '2026-09-01') => Array.from({ length: n }, (_, i) => {
  const t = new Date(`${from}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + i); return t.toISOString().slice(0, 10)
})

beforeEach(() => { setOnline(true) })
afterEach(() => { cleanup(); setOnline(true); vi.restoreAllMocks() })

describe('TrackerBlock', () => {
  it('logs_each_kind_in_one_action', async () => {
    // yes/no: one click.
    let srv = serve({ kind: 'yesno', name: 'Walked' })
    let u = mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(within(dayLine()).getByText('Yes')).toBeTruthy())
    expect(pressed('Yes')).toBe('true')
    expect(pressed('No')).toBe('false')
    expect(srv.puts().map((c) => [c.url, c.body])).toEqual([['/api/j2/trackers/t1/days/2026-10-27', { value: true }]])
    u.unmount()
    // scale: one click.
    srv = serve({ kind: 'scale', name: 'Mood' })
    u = mount()
    await waitFor(() => expect(screen.getByRole('button', { name: '4' })).toBeTruthy())
    expect(screen.getAllByRole('button', { name: /^[1-5]$/ })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await waitFor(() => expect(within(dayLine()).getByText('4')).toBeTruthy())
    expect(pressed('4')).toBe('true')
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: 4 }])
    u.unmount()
    // number: one keystroke (Enter).
    srv = serve({ kind: 'number', name: 'Caffeine', unit: 'cups' })
    u = mount()
    await waitFor(() => expect(input()).toBeTruthy())
    expect(input().getAttribute('inputmode')).toBe('decimal')
    expect(screen.getByText('cups')).toBeTruthy()
    await typeEnter('2.5')
    await waitFor(() => expect(within(dayLine()).getByText('2.5 cups')).toBeTruthy())
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: 2.5 }])
    u.unmount()
    // duration: h:mm, Enter. 7:30 is 450 minutes.
    srv = serve({ kind: 'duration', name: 'Sleep' })
    u = mount()
    await waitFor(() => expect(input()).toBeTruthy())
    expect(input().getAttribute('placeholder')).toBe('h:mm')
    await typeEnter('7:30')
    await waitFor(() => expect(within(dayLine()).getByText('7h 30m')).toBeTruthy())
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: 450 }])
    expect(input().value).toBe('7:30')
  })

  it('a number also logs on blur, and an unchanged box sends nothing', async () => {
    const srv = serve({ kind: 'number', name: 'Weight', values: { '2026-10-27': 80 } })
    mount()
    await waitFor(() => expect(input().value).toBe('80'))
    fireEvent.focus(input())
    fireEvent.blur(input())                                            // nothing typed: nothing sent
    expect(srv.puts()).toHaveLength(0)
    fireEvent.change(input(), { target: { value: '80' } })
    fireEvent.blur(input())                                            // the same value: nothing sent
    expect(srv.puts()).toHaveLength(0)
    fireEvent.change(input(), { target: { value: '79.4' } })
    fireEvent.blur(input())
    await waitFor(() => expect(within(dayLine()).getByText('79.4')).toBeTruthy())
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: 79.4 }])
  })

  it('pressing_picked_value_clears', async () => {
    let srv = serve({ kind: 'scale', name: 'Focus', values: { '2026-10-27': 3 } })
    let u = mount()
    await waitFor(() => expect(pressed('3')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    await waitFor(() => expect(pressed('3')).toBe('false'))
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: null }])
    expect(srv.st.values['2026-10-27']).toBeUndefined()
    expect(within(dayLine()).queryByText('3')).toBeNull()
    u.unmount()
    // yes/no: pressing the picked No again clears it too (No is stored as 0, which is still a value).
    srv = serve({ kind: 'yesno', name: 'Walked', values: { '2026-10-27': 0 } })
    u = mount()
    await waitFor(() => expect(pressed('No')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    await waitFor(() => expect(pressed('No')).toBe('false'))
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: null }])
    u.unmount()
    // a number: emptying the box clears the day.
    srv = serve({ kind: 'number', name: 'Weight', values: { '2026-10-27': 80 } })
    mount()
    await waitFor(() => expect(input().value).toBe('80'))
    await typeEnter('')
    await waitFor(() => expect(srv.puts()).toHaveLength(1))
    expect(srv.puts()[0].body).toEqual({ value: null })
    await waitFor(() => expect(input().value).toBe(''))
  })

  it('refusal_sentence_shown_nothing_kept', async () => {
    const srv = serve({ kind: 'number', name: 'Weight', values: { '2026-10-27': 80 } })
    const { container } = mount()
    await waitFor(() => expect(input().value).toBe('80'))
    await typeEnter('1e309')                                           // never turned into Infinity (JSON null = a clear)
    await waitFor(() => expect(screen.getByText('Enter a number.')).toBeTruthy())
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: '1e309' }])   // sent as typed; the server said why
    expect(srv.st.values['2026-10-27']).toBe(80)                         // nothing stored
    expect(within(dayLine()).getByText('80')).toBeTruthy()               // nothing kept on screen
    expect(input().value).toBe('80')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()   // a bad value is not retried
    // The sentence is beside the control: the box names it, and the live region holding it follows the box.
    const live = container.querySelector('[data-tracker-live]')
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(input().getAttribute('aria-describedby')).toBe(live.id)
    expect(live.textContent).toBe('Enter a number.')
    expect(input().closest('div').nextElementSibling).toBe(live)
    fireEvent.blur(input())                                              // leaving the box sends nothing again
    expect(srv.puts()).toHaveLength(1)
    // A range refusal is the server's sentence too.
    await typeEnter('-5')
    await waitFor(() => expect(srv.puts()).toHaveLength(2))
    expect(srv.puts()[1].body).toEqual({ value: -5 })
  })

  it('a duration over 24 hours and a scale out of range are refused with the server sentence', async () => {
    let srv = serve({ kind: 'duration', name: 'Sleep' })
    let u = mount()
    await waitFor(() => expect(input()).toBeTruthy())
    await typeEnter('25:00')
    await waitFor(() => expect(screen.getByText('A duration can be at most 24 hours.')).toBeTruthy())
    expect(srv.puts()[0].body).toEqual({ value: 1500 })
    expect(srv.st.values).toEqual({})
    expect(input().value).toBe('')
    u.unmount()
    srv = serve({ kind: 'duration', name: 'Sleep' })
    u = mount()
    await waitFor(() => expect(input()).toBeTruthy())
    await typeEnter('abc')                                               // W9-R41: refused here, no request
    await waitFor(() => expect(screen.getByText(DURATION_HINT)).toBeTruthy())
    expect(DURATION_HINT).toBe('Enter a time like 1:30.')
    expect(srv.puts()).toHaveLength(0)
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByText('Enter a number.')).toBeNull()
    await typeEnter('90')                                                // whole minutes
    await waitFor(() => expect(srv.puts()).toHaveLength(1))
    expect(srv.puts()[0].body).toEqual({ value: 90 })
    await waitFor(() => expect(within(dayLine()).getByText('1h 30m')).toBeTruthy())
    await typeEnter('1:30')                                              // the same time as h:mm: unchanged, nothing sent
    await typeEnter('2:15')
    await waitFor(() => expect(srv.puts()).toHaveLength(2))
    expect(srv.puts()[1].body).toEqual({ value: 135 })
    u.unmount()
    // A server "not a number" refusal on a duration says the duration's words, never "Enter a number."
    srv = serve({ kind: 'duration', name: 'Sleep', forceRefusal: { code: 'invalid', message: 'Enter a number.' } })
    u = mount()
    await waitFor(() => expect(input()).toBeTruthy())
    await typeEnter('1:30')
    await waitFor(() => expect(screen.getByText(DURATION_HINT)).toBeTruthy())
    expect(srv.puts()[0].body).toEqual({ value: 90 })
    expect(screen.queryByText('Enter a number.')).toBeNull()
    u.unmount()
  })

  it('chart_last_30_and_table_alternative_same_points', async () => {
    const all = days(35)
    const values = Object.fromEntries(all.map((d, i) => [d, 400 + i]))
    values[all[20]] = null                                              // an unreadable value: a GAP, never a 0
    const srv = serve({ values })
    const { container } = mount({ params: { ...PARAMS, day: all[34] } })
    await waitFor(() => expect(container.querySelector('[data-tracker-chart] svg')).toBeTruthy())
    const shown = all.slice(-30)
    const svg = container.querySelector('[data-tracker-chart] svg')
    expect(svg.querySelectorAll('polyline').length).toBe(2)            // the line breaks at the gap
    const dots = [...svg.querySelectorAll('circle')].map((c) => c.getAttribute('data-day'))
    expect(dots).toEqual(shown.filter((d) => d !== all[20]))           // the last 30, the gap drawn as nothing
    expect(dots).toHaveLength(29)
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe(`Sleep, the last 30 entries (${'Sun Sep 6'} to ${'Mon Oct 5'}), from 6h 45m to 7h 14m. 1 day with no value.`)
    // No point is drawn at the bottom for the gap: every dot's value is a real one.
    const ys = [...svg.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy')))
    expect(Math.max(...ys)).toBeLessThanOrEqual(96)
    expect(srv.reads()).toHaveLength(1)
    // The table: the SAME 30 points, the gap written as "No data".
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show as table' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    expect(screen.getByRole('button', { name: 'Hide table' }).getAttribute('aria-expanded')).toBe('true')   // M-2
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('rowheader')).toHaveLength(30)                                       // M-2: the day heads its row
    expect(within(table).getByText('Sleep, as a table')).toBeTruthy()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(30)
    expect(rows[0].textContent).toBe('Sun Sep 6' + '6h 45m')
    const gap = rows.find((r) => r.textContent.startsWith('Mon Sep 21'))
    expect(gap.textContent).toBe('Mon Sep 21No data')
    expect(rows.at(-1).textContent).toBe('Mon Oct 5' + '7h 14m')
    fireEvent.click(screen.getByRole('button', { name: 'Hide table' }))
    expect(container.querySelector('table')).toBeNull()
  })

  it('average_latest_with_counts_never_zero_on_empty', async () => {
    let srv = serve({ values: { '2026-10-22': 420, '2026-10-23': 450, '2026-10-26': 435, '2026-10-27': 450 } })
    let u = mount()
    await waitFor(() => expect(screen.getByText('Average 7h 19m from 4 entries')).toBeTruthy())
    expect(screen.getByText('Latest 7h 30m (Tue Oct 27)')).toBeTruthy()          // M-1: the server's latest, with its day
    u.unmount()
    // One entry: singular.
    srv = serve({ kind: 'number', unit: 'cups', values: { '2026-10-27': 2 } })
    u = mount()
    await waitFor(() => expect(screen.getByText('Average 2 cups from 1 entry')).toBeTruthy())
    u.unmount()
    // A logged value moves the summary through ONE server re-read (W9-R40): the server's numbers, never a client sum.
    srv = serve({ values: { '2026-10-26': 420 } })
    u = mount()
    await waitFor(() => expect(screen.getByText('Average 7h from 1 entry')).toBeTruthy())
    await typeEnter('8:00')
    await waitFor(() => expect(screen.getByText('Average 7h 30m from 2 entries')).toBeTruthy())
    expect(screen.getByText('Latest 8h (Tue Oct 27)')).toBeTruthy()
    expect(srv.reads()).toHaveLength(2)
    u.unmount()
    // Empty: the sentence, no average, no latest, no chart and no 0 anywhere.
    serve({ values: {} })
    const { container } = mount()
    await waitFor(() => expect(screen.getByText(EMPTY_LINE)).toBeTruthy())
    expect(EMPTY_LINE).toBe('Log your first value; the chart starts with it.')
    expect(container.textContent).not.toMatch(/Average|Latest/)
    expect(container.querySelector('[data-tracker-chart]')).toBeNull()
    expect(textOf(container)).not.toMatch(/\b0\b/)
    expect(input().value).toBe('')
  })

  it('builtin_checkin_read_only_line', async () => {
    const srv = serve({ id: 'checkin:mood', name: 'Check-in mood', kind: 'scale', readOnly: true, values: { '2026-10-26': 4, '2026-10-27': 3 } })
    const { container } = mount({ params: { ...PARAMS, trackerId: 'checkin:mood' } })
    await waitFor(() => expect(screen.getByText(CHECKIN_LINE)).toBeTruthy())
    expect(CHECKIN_LINE).toBe('Mood and focus come from your check-ins.')
    expect(within(dayLine()).getByText('3')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^[1-5]$/ })).toBeNull()      // no log controls
    expect(input()).toBeNull()
    expect(screen.getByText('Average 3.5 from 2 entries')).toBeTruthy()
    expect(container.querySelector('[data-tracker-chart] svg')).toBeTruthy()
    expect(screen.queryByText(TOOL_COPY.window)).toBeNull()                   // read-only says why, not "the window"
    expect(srv.puts()).toHaveLength(0)
    cleanup()
    // Even an entry that says writable: a built-in check-in is never logged from a note.
    serve({ id: 'checkin:mood', name: 'Check-in mood', kind: 'scale', readOnly: true, forceWritable: true, values: { '2026-10-27': 3 } })
    mount({ params: { ...PARAMS, trackerId: 'checkin:mood' } })
    await waitFor(() => expect(screen.getByText(CHECKIN_LINE)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^[1-5]$/ })).toBeNull()
  })

  it('flag_off_offline_read_failure_tick_failure_window_archived', async () => {
    // flag off: the route 404s.
    serve({ readStatus: 404 })
    let u = mount()
    await waitFor(() => expect(screen.getByText('Not available right now.')).toBeTruthy())
    expect(input()).toBeNull()
    u.unmount()
    // offline at open: the sentence, no request.
    let srv = serve()
    setOnline(false)
    u = mount()
    await waitFor(() => expect(screen.getByText("You're offline. Ticks save when you're back online.")).toBeTruthy())
    expect(srv.reads()).toHaveLength(0)
    act(() => { setOnline(true); window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(input()).toBeTruthy())
    u.unmount()
    // read failure: the sentence and Retry, never a 0.
    srv = serve({ readStatus: 500 })
    let r = mount()
    await waitFor(() => expect(screen.getByText("Can't load this tracker right now.")).toBeTruthy())
    expect(textOf(r.container)).not.toMatch(/\b0\b/)
    srv.st.readStatus = 200
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(input()).toBeTruthy())
    r.unmount()
    // log failure: rolled back visibly, Retry resends the same value.
    srv = serve({ kind: 'scale', name: 'Mood', logStatus: [500] })
    u = mount()
    await waitFor(() => expect(screen.getByRole('button', { name: '2' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    await waitFor(() => expect(screen.getByText("Didn't save. Retry?")).toBeTruthy())
    expect(pressed('2')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(pressed('2')).toBe('true'))
    await waitFor(() => expect(screen.queryByText("Didn't save. Retry?")).toBeNull())
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: 2 }, { value: 2 }])
    u.unmount()
    // outside the window (a past day): read-only, the sentence.
    serve({ writable: false, values: { '2026-10-01': 420 } })
    u = mount({ params: { ...PARAMS, day: '2026-10-01' } })
    await waitFor(() => expect(screen.getByText('Ticks can be added up to 7 trading days back.')).toBeTruthy())
    expect(input()).toBeNull()
    u.unmount()
    // archived: history only, Restore in the ⋯ menu.
    srv = serve({ archived: true, values: { '2026-10-27': 420 } })
    mount()
    await waitFor(() => expect(screen.getByText('Archived tracker, history only')).toBeTruthy())
    expect(input()).toBeNull()
    expect(screen.queryByText(TOOL_COPY.window)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(menuRow('Restore'))
    await waitFor(() => expect(input()).toBeTruthy())
    expect(srv.calls.some((c) => c.method === 'POST' && c.url === '/api/j2/trackers/t1/unarchive')).toBe(true)
    expect(screen.queryByText('Archived tracker, history only')).toBeNull()
  })

  it('missing or foreign says "Not available."', async () => {
    serve({ foreign: true })
    mount()
    await waitFor(() => expect(screen.getByText('Not available.')).toBeTruthy())
    expect(input()).toBeNull()
  })

  it('a future day says when it can be logged (W9-R34), a trading-only tracker on a closed day says so', async () => {
    serve({ writable: false })
    let u = mount({ params: { ...PARAMS, day: '2099-10-30' } })
    await waitFor(() => expect(screen.getByText(/^You can log this on /)).toBeTruthy())
    expect(screen.getByText(/^You can log this on /).textContent).toBe('You can log this on Fri Oct 30.')
    expect(screen.queryByText(TOOL_COPY.window)).toBeNull()
    u.unmount()
    serve({ writable: false, days: 'trading' })
    u = mount({ params: { ...PARAMS, day: '2026-10-24' } })                  // a Saturday
    await waitFor(() => expect(screen.getByText(TRADING_ONLY)).toBeTruthy())
    expect(TRADING_ONLY).toBe('This tracker logs trading days only.')
    expect(screen.queryByText(TOOL_COPY.window)).toBeNull()
  })

  it('a re-render storm fails: one read and one log commit a bounded number of renders (H14)', async () => {
    serve({ values: { '2026-10-26': 420 } })
    let commits = 0
    render(
      <Profiler id="tracker" onRender={() => { commits += 1 }}>
        <TrackerBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} />
      </Profiler>,
    )
    await waitFor(() => expect(input()).toBeTruthy())
    await typeEnter('7:30')
    await waitFor(() => expect(screen.getByText('Latest 7h 30m (Tue Oct 27)')).toBeTruthy())
    const settled = commits
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(commits).toBe(settled)                                   // nothing keeps rendering once settled
    expect(commits).toBeLessThanOrEqual(12)                         // mount, read, typing, log press, log answer (and slack)
  })

  it('two instances adopt one log, from one batched read', async () => {
    const { reads } = serve({ kind: 'scale', name: 'Mood' })
    render(
      <>
        <div data-testid="a"><TrackerBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
        <div data-testid="b"><TrackerBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
      </>,
    )
    await waitFor(() => expect(screen.getAllByRole('button', { name: '5' })).toHaveLength(2))
    expect(reads()).toHaveLength(1)
    const a = screen.getByTestId('a'), b = screen.getByTestId('b')
    fireEvent.click(within(a).getByRole('button', { name: '5' }))
    await waitFor(() => expect(within(b).getByRole('button', { name: '5' }).getAttribute('aria-pressed')).toBe('true'))
    await waitFor(() => expect(within(b).getByText('Average 5 from 1 entry')).toBeTruthy())
  })

  it('a fixed-day block ignores an entry for another day', async () => {
    const { st } = serve({ kind: 'number', name: 'Weight', values: { '2026-10-26': 80 } })
    mount({ params: { ...PARAMS, day: '2026-10-26' } })
    await waitFor(() => expect(input().value).toBe('80'))
    st.values = { '2026-10-26': 70 }
    st.entryDay = '2026-10-27'                                       // the server answers another day's entry
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(input().value).toBe('80')
    expect(screen.getByText('For Mon Oct 26')).toBeTruthy()
    expect(screen.getByText('Average 80 from 1 entry')).toBeTruthy()
    st.entryDay = undefined                                          // control: its own day's entry IS adopted
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(input().value).toBe('70'))
    expect(screen.getByText('Average 70 from 1 entry')).toBeTruthy()
  })

  it('the settings: each is ONE setParams call carrying its search text; reads and logs never call it', async () => {
    serve({ today: '2026-10-28' })
    const { setParams, unmount } = mount({ params: { ...PARAMS, day: '2026-10-26' } })
    await waitFor(() => expect(input()).toBeTruthy())
    await typeEnter('7:00')
    await waitFor(() => expect(screen.getByText('Latest 7h (Mon Oct 26)')).toBeTruthy())
    expect(setParams).not.toHaveBeenCalled()                          // ⛔ a read and a log never write the note
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(menuRow('Follow today'))
    await waitFor(() => expect(setParams).toHaveBeenCalledTimes(1))
    expect(setParams.mock.calls[0]).toEqual([{ bind: 'today', day: '' }, { searchText: '[tracker: Sleep · For Wed Oct 28]' }])
    unmount()
    const set2 = vi.fn()
    mount({ params: { trackerId: 't1', day: '', bind: 'today', display: 'chart' }, setParams: set2, editor: editorWith('2026-10-26') })
    await waitFor(() => expect(input()).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(menuRow("Use this note's day"))
    expect(set2).toHaveBeenCalledTimes(1)
    expect(set2.mock.calls[0]).toEqual([{ bind: 'note-day', day: '2026-10-26' }, { searchText: '[tracker: Sleep · For Mon Oct 26]' }])
  })

  it("display 'pnl' shows the vs P&L sentence, and the menu switches between the two in one call", async () => {
    serve({ values: { '2026-10-27': 420 } })
    const setParams = vi.fn()
    const { container, unmount } = mount({ params: { ...PARAMS, display: 'pnl' }, setParams })
    await waitFor(() => expect(screen.getByText(PNL_LEAD)).toBeTruthy())
    expect(container.querySelector('[data-tracker-chart] svg')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(menuRow('Show the chart first'))
    expect(setParams.mock.calls).toEqual([[{ display: 'chart' }, { searchText: '[tracker: Sleep · For Tue Oct 27]' }]])
    unmount()
    const set2 = vi.fn()
    mount({ setParams: set2 })
    await waitFor(() => expect(input()).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(menuRow(PNL_FIRST))
    expect(set2.mock.calls).toEqual([[{ display: 'pnl' }, { searchText: '[tracker: Sleep · For Tue Oct 27]' }]])
  })

  it('offline: controls are aria-disabled (never disabled), nothing is sent, and the sentence is said ONCE', async () => {
    const srv = serve({ kind: 'scale', name: 'Mood' })
    const { container } = mount()
    await waitFor(() => expect(screen.getByRole('button', { name: '3' })).toBeTruthy())
    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
    await waitFor(() => expect(screen.getAllByText(TOOL_COPY.offline)).toHaveLength(1))
    const b3 = screen.getByRole('button', { name: '3' })
    expect(b3.getAttribute('aria-disabled')).toBe('true')
    expect(b3.disabled).toBe(false)
    fireEvent.click(b3)
    expect(srv.puts()).toHaveLength(0)
    const live = container.querySelector('[data-tracker-live]')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe(TOOL_COPY.offline)
    expect(container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1)
    act(() => { setOnline(true); window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(screen.getByRole('button', { name: '3' }).hasAttribute('aria-disabled')).toBe(false))
    expect(screen.queryByText(TOOL_COPY.offline)).toBeNull()
  })

  it('focus: a log Retry returns to the retried control; a read Retry lands on the first control', async () => {
    serve({ kind: 'scale', name: 'Mood', logStatus: [500] })
    let u = mount()
    await waitFor(() => expect(screen.getByRole('button', { name: '4' })).toBeTruthy())
    screen.getByRole('button', { name: '4' }).focus()
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '4' }))
    screen.getByRole('button', { name: 'Retry' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(pressed('4')).toBe('true'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '4' }))
    u.unmount()
    const srv = serve({ readStatus: 500 })
    u = mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.readFailedTracker)).toBeTruthy())
    srv.st.readStatus = 200
    screen.getByRole('button', { name: 'Retry' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(input()).toBeTruthy())
    await waitFor(() => expect(document.activeElement).toBe(input()))
  })

  it('the ⋯ button says what opens: a menu on a fine pointer, a dialog on touch', async () => {
    serve()
    let u = mount()
    await waitFor(() => expect(input()).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Tracker options' }).getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    u.unmount()
    const mm = window.matchMedia
    window.matchMedia = (q) => ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
    try {
      serve()
      u = mount()
      await waitFor(() => expect(input()).toBeTruthy())
      const b = screen.getByRole('button', { name: 'Tracker options' })
      expect(b.getAttribute('aria-haspopup')).toBe('dialog')
      fireEvent.click(b)
      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      window.matchMedia = mm
    }
  })

  it('a reader (editable false): the value and lines, no controls and no menu', async () => {
    serve({ values: { '2026-10-27': 420 } })
    const setParams = vi.fn()
    mount({ editable: false, setParams })
    await waitFor(() => expect(screen.getByText('Latest 7h (Tue Oct 27)')).toBeTruthy())
    expect(input()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tracker options' })).toBeNull()
    // No WRITE control: the vs P&L flip (a view, 9.15 I-1) and the chart's own table toggle are the only buttons.
    expect(screen.queryAllByRole('button').filter((b) => !b.hasAttribute('data-pnl-flip') && !/table$/.test(b.textContent))).toEqual([])
    expect(setParams).not.toHaveBeenCalled()
  })

  it('the block makes no request of its own (no fetch in TrackerBlock.jsx or TrackerChart.jsx)', () => {
    for (const f of ['TrackerBlock.jsx', 'TrackerChart.jsx']) {
      const src = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/blocks', f), 'utf8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code, f).toMatch(/\bimport\b/)                                // control: the reader sees code
      expect(code, f).not.toMatch(/\bfetch\s*\(/)
      expect(code, f).not.toMatch(/XMLHttpRequest|sendBeacon|ResizeObserver/)
    }
    const block = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/blocks/TrackerBlock.jsx'), 'utf8')
    expect(block).toMatch(/\blogValue\(/)                                  // control: the log goes through the layer
    expect(block).toMatch(/\bunarchive\('tracker'/)
    expect(readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/blocks/TrackerChart.jsx'), 'utf8'))
      .toMatch(/useChartWidth\(/)                                          // the shared measure, not a new observer
  })

  it('the input is 16px on touch (no iOS zoom), every control holds the 44px floor, and no text uses --gain/--loss', () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/blocks/TrackerBlock.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const touch = /@media \(max-width: 1024px\)\s*\{([\s\S]*?)\}\s*\}/.exec(css)
    expect(touch, 'a touch block').toBeTruthy()
    expect(touch[1]).toMatch(/\.input\s*\{[^}]*font-size:\s*16px/)
    for (const cls of ['tap', 'input', 'choice']) {
      const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css)
      expect(rule, cls).toBeTruthy()
      expect(rule[1], cls).toMatch(/min-(height|width):\s*var\(--tap-min\)/)
    }
    expect(css).not.toMatch(/var\(--(gain|loss)\b/)
    expect(css).not.toMatch(/line-through/)
  })

  it("the chart's line and dots pass 3:1 on --bg-elevated in every theme (the graphic bar), its labels 4.5:1", () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/blocks/TrackerBlock.module.css'), 'utf8')
    const ink = (sel, prop) => new RegExp(`\\.${sel}\\s*\\{[^}]*${prop}:\\s*([^;]+);`).exec(css)?.[1]?.trim()
    const pairs = [[ink('chartLine', 'stroke'), 3], [ink('chartDot', 'fill'), 3], [ink('caption', 'color'), 4.5], [ink('line', 'color'), 4.5]]
    const vars = themeVars()
    expect(THEMES.length).toBe(3)                                          // dark, oled, light
    for (const [value, bar] of pairs) {
      expect(value, 'the rule was read').toMatch(/^var\(--/)
      for (const theme of THEMES) {
        const on = parseColor(resolveVars('var(--bg-elevated)', vars[theme])).rgb
        const fg = parseColor(resolveVars(value, vars[theme])).rgb
        expect(contrast(fg, on), `${value} on --bg-elevated @${theme}`).toBeGreaterThanOrEqual(bar)
      }
    }
    // control: a colour that fails is seen failing
    const dark = vars.dark
    expect(contrast(parseColor(resolveVars('var(--border)', dark)).rgb, parseColor(resolveVars('var(--bg-elevated)', dark)).rgb)).toBeLessThan(3)
  })
})

describe('TrackerBlock, fix round 1', () => {
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 450)) })   // past TOOL_SETTLE_MS

  it('I-2 (W9-R40): a block on the same page bound to ANOTHER day updates its average, count and chart after a log', async () => {
    const srv = serve({ values: { '2026-10-26': 420 } })
    render(
      <>
        <div data-testid="today"><TrackerBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
        <div data-testid="later"><TrackerBlock params={{ ...PARAMS, day: '2026-10-28' }} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
      </>,
    )
    const later = screen.getByTestId('later')
    await waitFor(() => expect(within(later).getByText('Average 7h from 1 entry')).toBeTruthy())
    expect(srv.reads()).toHaveLength(2)                                      // one request per day (W9-R13)
    const box = screen.getByTestId('today').querySelector('[data-value-input]')
    fireEvent.change(box, { target: { value: '8:00' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(within(later).getByText('Average 7h 30m from 2 entries')).toBeTruthy())
    expect(within(later).getByText('Latest 8h (Tue Oct 27)')).toBeTruthy()
    expect(later.querySelectorAll('[data-tracker-chart] circle')).toHaveLength(2)
    expect(within(later).queryByText('8h')).toBeNull()                       // its OWN day's value is untouched
    await settle()
    expect(srv.reads()).toHaveLength(4)                                      // ONE re-read round: a request per day
  })

  it('I-2: a block for a PAST day does not move after a later day is logged (the server bounds its summary)', async () => {
    const srv = serve({ values: { '2026-10-22': 420 } })
    render(
      <>
        <div data-testid="past"><TrackerBlock params={{ ...PARAMS, day: '2026-10-23' }} setParams={vi.fn()} editable editor={editorWith('2026-10-23')} /></div>
        <div data-testid="now"><TrackerBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
      </>,
    )
    const past = screen.getByTestId('past'), now = screen.getByTestId('now')
    await waitFor(() => expect(within(past).getByText('Average 7h from 1 entry')).toBeTruthy())
    const box = now.querySelector('[data-value-input]')
    fireEvent.change(box, { target: { value: '9:00' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(within(now).getByText('Average 8h from 2 entries')).toBeTruthy())   // control: it moved
    await settle()
    expect(within(past).getByText('Average 7h from 1 entry')).toBeTruthy()
    expect(within(past).getByText('Latest 7h (Thu Oct 22)')).toBeTruthy()
    expect(past.querySelectorAll('[data-tracker-chart] circle')).toHaveLength(1)
    expect(srv.reads().length).toBe(4)                                       // two days, read twice: never more
  })

  it('I-3: a log fails while following today, the member picks "Use this note\'s day": the Retry is gone and nothing is written there', async () => {
    const srv = serve({ kind: 'scale', name: 'Mood', today: '2026-10-28', logStatus: [500] })
    function Host() {
      const [params, setP] = useState({ trackerId: 't1', day: '', bind: 'today', display: 'chart' })
      return <TrackerBlock params={params} setParams={(patch) => { setP((x) => ({ ...x, ...patch })); return true }} editable editor={editorWith('2026-10-26')} />
    }
    render(<Host />)
    await waitFor(() => expect(screen.getByText('For Wed Oct 28')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(menuRow("Use this note's day"))
    await waitFor(() => expect(screen.getByText('For Mon Oct 26')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByText("Didn't save. Retry?")).toBeNull()
    expect(pressed('4')).toBe('false')
    await settle()
    expect(srv.puts().map((c) => c.url)).toEqual(['/api/j2/trackers/t1/days/2026-10-28'])   // never the note's day
    expect(srv.st.values['2026-10-26']).toBeUndefined()
  })

  it('I-3: a read key changed from OUTSIDE the block (no menu: another tab, an undo) drops the Retry too', async () => {
    const srv = serve({ kind: 'scale', name: 'Mood', logStatus: [500] })
    const { rerender } = mount()
    await waitFor(() => expect(screen.getByRole('button', { name: '4' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy())
    rerender(<TrackerBlock params={{ ...PARAMS, day: '2026-10-26' }} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} />)
    await waitFor(() => expect(screen.getByText('For Mon Oct 26')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(srv.puts().map((c) => c.url)).toEqual(['/api/j2/trackers/t1/days/2026-10-27'])
  })

  it('I-3: a log answer that lands AFTER the day changed is dropped (no Retry for the old day on the new one)', async () => {
    const srv = serve({ kind: 'scale', name: 'Mood' })
    const { rerender } = mount()
    await waitFor(() => expect(screen.getByRole('button', { name: '4' })).toBeTruthy())
    const inner = globalThis.fetch
    let answer
    globalThis.fetch = vi.fn((url, init = {}) => ((init.method === 'PUT')
      ? new Promise((resolve) => { answer = () => resolve(json(500, {})) })
      : inner(url, init)))
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await waitFor(() => expect(answer).toBeTypeOf('function'))
    rerender(<TrackerBlock params={{ ...PARAMS, day: '2026-10-26' }} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} />)
    await waitFor(() => expect(screen.getByText('For Mon Oct 26')).toBeTruthy())
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByText("Didn't save. Retry?")).toBeNull()
    expect(srv.puts()).toHaveLength(0)                                   // control: the gated PUT never reached the fake
  })

  it('I-3: a settings change clears a pending sentence even when the day stays (Show the P&L comparison first)', async () => {
    serve({ kind: 'scale', name: 'Mood', logStatus: [500] })
    const setParams = vi.fn()
    mount({ setParams })
    await waitFor(() => expect(screen.getByRole('button', { name: '4' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(menuRow(PNL_FIRST))
    expect(setParams).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('I-4: a missed session breaks the line, and the text alternative counts the days with no value', async () => {
    // A trading-day tracker: Wed Oct 21 is missed (a gap); the weekend between Fri and Mon is not a session (no gap).
    const values = { '2026-10-19': 400, '2026-10-20': 410, '2026-10-22': 420, '2026-10-23': 430, '2026-10-26': 440 }
    serve({ kind: 'duration', days: 'trading', values })
    let r = mount({ params: { ...PARAMS, day: '2026-10-26' } })
    await waitFor(() => expect(r.container.querySelector('[data-tracker-chart] svg')).toBeTruthy())
    let svg = r.container.querySelector('[data-tracker-chart] svg')
    expect(svg.querySelectorAll('polyline')).toHaveLength(2)                 // [Mon, Tue] and [Thu, Fri, Mon]
    expect(svg.querySelectorAll('circle')).toHaveLength(5)
    expect(svg.getAttribute('aria-label')).toMatch(/\. 1 day with no value\.$/)
    r.unmount()
    // The same entries on an any-day tracker: Wed, Sat and Sun are all missed days.
    serve({ kind: 'duration', days: 'any', values })
    r = mount({ params: { ...PARAMS, day: '2026-10-26' } })
    await waitFor(() => expect(r.container.querySelector('[data-tracker-chart] svg')).toBeTruthy())
    svg = r.container.querySelector('[data-tracker-chart] svg')
    expect(svg.querySelectorAll('polyline')).toHaveLength(3)
    expect(svg.getAttribute('aria-label')).toMatch(/\. 3 days with no value\.$/)
  })

  it('M-3 (H14): with the chart\'s ResizeObserver driven and past its settle window, nothing keeps rendering', async () => {
    const realRO = globalThis.ResizeObserver
    const observers = []
    globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this) } observe() {} disconnect() {} }
    try {
      serve({ values: { '2026-10-26': 420, '2026-10-27': 450 } })
      let commits = 0
      const { container } = render(
        <Profiler id="tracker" onRender={() => { commits += 1 }}>
          <TrackerBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} />
        </Profiler>,
      )
      await waitFor(() => expect(container.querySelector('[data-tracker-chart] svg')).toBeTruthy())
      expect(observers.length).toBeGreaterThan(0)                              // control: the shared measure observes
      act(() => { for (const o of observers) o.cb([{ contentRect: { width: 320 } }]) })
      await waitFor(() => expect(container.querySelector('[data-tracker-chart] svg').getAttribute('width')).toBe('320'))
      act(() => { for (const o of observers) o.cb([{ contentRect: { width: 330 } }]) })   // a small flip, then back
      act(() => { for (const o of observers) o.cb([{ contentRect: { width: 320 } }]) })
      await act(async () => { await new Promise((res) => setTimeout(res, 450)) })        // past SETTLE_MS
      const settled = commits
      await act(async () => { await new Promise((res) => setTimeout(res, 450)) })
      expect(commits).toBe(settled)
      expect(commits).toBeLessThanOrEqual(14)
    } finally {
      globalThis.ResizeObserver = realRO
    }
  })

  it('M-6: a recent list whose values are all unreadable shows the empty line, never a blank body', async () => {
    serve({ values: { '2026-10-26': null, '2026-10-27': null } })
    const { container } = mount()
    await waitFor(() => expect(screen.getByText(EMPTY_LINE)).toBeTruthy())
    expect(container.querySelector('[data-tracker-chart]')).toBeNull()
    expect(container.textContent).not.toMatch(/Average|Latest/)
  })

  it('M-7: a state is said by the ONE live region (no second status element)', async () => {
    for (const [over, text] of [[{ readStatus: 500 }, TOOL_COPY.readFailedTracker], [{ readStatus: 404 }, TOOL_COPY.flagOff], [{ foreign: true }, TOOL_COPY.missing]]) {
      serve(over)
      const { container, unmount } = mount()
      await waitFor(() => expect(screen.getByText(text)).toBeTruthy())
      expect(container.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1)
      expect(container.querySelector('[data-tracker-live]').textContent).toMatch(new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
      unmount()
    }
  })

  it('M-8: a comma decimal logs as a number', async () => {
    const srv = serve({ kind: 'number', name: 'Coffee', unit: 'cups' })
    mount()
    await waitFor(() => expect(input()).toBeTruthy())
    await typeEnter('2,5')
    await waitFor(() => expect(within(dayLine()).getByText('2.5 cups')).toBeTruthy())
    expect(srv.puts().map((c) => c.body)).toEqual([{ value: 2.5 }])
  })

  it('M-4: the vs P&L sentence refreshes on a tool change, and its read failure has a Retry', async () => {
    const srv = serve({ values: { '2026-10-27': 420 } })
    let pnlFail = 1
    const inner = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => {
      if (/vs-pnl$/.test(url) && pnlFail > 0) { pnlFail -= 1; return Promise.resolve(json(500, {})) }
      return inner(url, init)
    })
    const pnlCalls = () => globalThis.fetch.mock.calls.filter(([u]) => /vs-pnl$/.test(u)).length
    render(
      <>
        <div data-testid="p"><TrackerBlock params={{ ...PARAMS, display: 'pnl' }} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
        <div data-testid="c"><TrackerBlock params={{ ...PARAMS, day: '2026-10-26' }} setParams={vi.fn()} editable editor={editorWith('2026-10-26')} /></div>
      </>,
    )
    const p = screen.getByTestId('p')
    await waitFor(() => expect(within(p).getByText(FAILED)).toBeTruthy())
    fireEvent.click(p.querySelector('[data-pnl-retry]'))
    await waitFor(() => expect(within(p).getByText(PNL_LEAD)).toBeTruthy())
    const before = pnlCalls()
    const box = screen.getByTestId('c').querySelector('[data-value-input]')
    fireEvent.change(box, { target: { value: '6:00' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(pnlCalls()).toBe(before + 1))
    expect(within(p).getByText(PNL_LEAD)).toBeTruthy()                       // no "Loading…" flash while it refreshes
    expect(within(p).queryByText('Loading…')).toBeNull()
    expect(srv.puts()).toHaveLength(1)
  })
})

describe('TrackerBlock, fix round 2 (MIN-2: the vs P&L read follows only an applied, changed summary)', () => {
  it('a tab return with nothing new and an answer the block discards cost no vs P&L GET; a real change costs one', async () => {
    const { st } = serve({ values: { '2026-10-27': 420 } })
    const pnlGets = () => globalThis.fetch.mock.calls.filter(([u]) => /vs-pnl$/.test(u)).length
    mount({ params: { ...PARAMS, display: 'pnl' } })
    await waitFor(() => expect(screen.getByText(PNL_LEAD)).toBeTruthy())
    expect(pnlGets()).toBe(1)
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    // A tab return with nothing new: the tool re-read lands, the summary is the same.
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(pnlGets()).toBe(1)
    // An answer about another day (a fixed-day block discards it whole).
    st.values['2026-10-26'] = 300
    st.entryDay = '2026-10-28'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(pnlGets()).toBe(1)
    expect(screen.queryByText('Average 6h from 2 entries')).toBeNull()     // and nothing of it was shown
    // A real change for this block: one GET.
    st.entryDay = undefined
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(screen.getByText('Average 6h from 2 entries')).toBeTruthy())
    await settle()
    expect(pnlGets()).toBe(2)
  })
})

describe('TrackerBlock, Task 9.15 (vs P&L: the shared panel)', () => {
  const pnlGets = () => globalThis.fetch.mock.calls.filter(([u]) => /\/vs-pnl$/.test(u)).length
  const flip = () => screen.getByRole('button', { name: TRACKER_FLIP })

  it('flip_fetches_once_and_writes_no_note', async () => {
    const srv = serve({ values: { '2026-10-26': 400, '2026-10-27': 420 } })
    const { setParams, container } = mount()
    await waitFor(() => expect(container.querySelector('[data-tracker-chart] svg')).toBeTruthy())
    expect(pnlGets()).toBe(0)                                                // lazy: nothing until the first flip
    expect(flip().getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(flip())
    await waitFor(() => expect(screen.getByText(PNL_LEAD)).toBeTruthy())
    expect(container.querySelector('[data-tracker-chart]')).toBeNull()       // the panel takes the chart's place
    expect(input()).toBeTruthy()                                             // the log control stays
    expect(screen.getByText('Average 6h 50m from 2 entries')).toBeTruthy()
    expect(flip().getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(flip())
    await waitFor(() => expect(container.querySelector('[data-tracker-chart] svg')).toBeTruthy())
    fireEvent.click(flip())
    await waitFor(() => expect(container.querySelector('[data-vs-pnl]').hasAttribute('hidden')).toBe(false))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(pnlGets()).toBe(1)
    expect(setParams).not.toHaveBeenCalled()
    expect(srv.calls.filter((c) => c.url.startsWith('/api/j2/notes'))).toEqual([])
    expect(srv.puts()).toEqual([])
  })

  it('display_pnl_opens_on_panel', async () => {
    serve({ values: { '2026-10-27': 420 } })
    const { container, rerender } = mount({ params: { ...PARAMS, display: 'pnl' } })
    await waitFor(() => expect(screen.getByText(PNL_LEAD)).toBeTruthy())
    expect(container.querySelector('[data-tracker-chart]')).toBeNull()
    expect(flip().getAttribute('aria-pressed')).toBe('true')
    expect([...container.querySelector('[data-vs-pnl]').children].at(-1).textContent).toBe(CAVEAT)
    // A flip is the member's own view: the params are untouched, and a display the note changes to wins over it.
    fireEvent.click(flip())
    await waitFor(() => expect(container.querySelector('[data-tracker-chart] svg')).toBeTruthy())
    rerender(<TrackerBlock params={{ ...PARAMS, display: 'chart' }} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} />)
    rerender(<TrackerBlock params={{ ...PARAMS, display: 'pnl' }} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} />)
    await waitFor(() => expect(container.querySelector('[data-vs-pnl]').hasAttribute('hidden')).toBe(false))
    expect(container.querySelector('[data-tracker-chart]')).toBeNull()
  })

  it("an empty tracker can flip too (the panel takes the empty line's place); a reader's flip writes nothing", async () => {
    serve({ values: {} })
    const { container, unmount } = mount()
    await waitFor(() => expect(screen.getByText(EMPTY_LINE)).toBeTruthy())
    fireEvent.click(flip())
    await waitFor(() => expect(screen.getByText(PNL_LEAD)).toBeTruthy())
    expect(screen.queryByText(EMPTY_LINE)).toBeNull()
    expect(container.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1)   // still ONE live region
    unmount()
    const srv = serve({ values: { '2026-10-27': 420 } })
    const setParams = vi.fn()
    const r = mount({ editable: false, setParams, params: { ...PARAMS, display: 'pnl' } })
    await waitFor(() => expect(screen.getByText(PNL_LEAD)).toBeTruthy())
    fireEvent.click(flip())                                                  // I-1: a reader flips back to the chart
    await waitFor(() => expect(r.container.querySelector('[data-tracker-chart] svg')).toBeTruthy())
    await act(async () => { await new Promise((res) => setTimeout(res, 20)) })
    expect(setParams).not.toHaveBeenCalled()
    expect(srv.calls.filter((c) => c.method !== 'GET' && c.url !== '/api/j2/trackers/days')).toEqual([])
  })
})

// Task 9.16 fix round 1 (M-8, ruling W9-R47): "Edit tracker" opens the REAL tracker editor on THIS tracker. A write
// door, so editors only; a check-in tracker has nothing to edit and gets no such row.
describe('TrackerBlock, Edit tracker (W9-R47)', () => {
  it('opens the editor on this tracker: its own name and type in the editor', async () => {
    serve({ editorReadable: true })
    mount()
    await waitFor(() => expect(input()).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(menuRow('Edit tracker'))
    expect(await screen.findByRole('heading', { name: 'Edit tracker' })).toBeTruthy()
    expect((await screen.findByRole('textbox', { name: 'Name' })).value).toBe('Sleep')
    expect(screen.getByRole('radio', { name: 'Duration' }).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit tracker' })).toBeNull())
  })

  it('a reader gets no menu at all, and a check-in tracker gets no Edit tracker row', async () => {
    serve()
    const { unmount } = mount({ editable: false })
    await waitFor(() => expect(screen.queryByText(/^For /)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Tracker options' })).toBeNull()
    unmount()
    serve({ id: 'checkin:mood', name: 'Check-in mood', kind: 'scale', readOnly: true, values: { '2026-10-27': 3 } })
    mount({ params: { ...PARAMS, trackerId: 'checkin:mood' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Tracker options' }))
    expect(screen.queryByText('Edit tracker')).toBeNull()
    expect(screen.getByText('Manage…')).toBeTruthy()
  })
})
