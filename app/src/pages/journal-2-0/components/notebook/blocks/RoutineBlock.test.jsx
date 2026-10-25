// The routine block (Notebook widgets phase 2, wave 9, Task 9.13). Asserted by RENDERED TEXT after the action has
// settled, never by state: a sentence a member cannot read is not a sentence.
import { Profiler, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import RoutineBlock, { NOT_DONE_TIP } from './RoutineBlock'
import { TOOL_COPY } from '../../../lib/blocks/toolsApi'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const ITEMS = [
  { id: 'i1', text: 'Read the morning wire', negative: false },
  { id: 'i2', text: 'Mark key levels', negative: false },
  { id: 'i3', text: 'Size from the stop', negative: false },
  { id: 'i4', text: 'Write the plan', negative: false },
  { id: 'i5', text: 'No revenge trades', negative: true },
  { id: 'i6', text: 'Check earnings dates', negative: false },
]

function entryFrom(st, day) {
  const ticked = Object.fromEntries(st.items.map((it) => [it.id, st.ticked[it.id] === true]))
  const n = Object.values(ticked).filter(Boolean).length
  return {
    day: st.entryDay ?? day, state: st.state ?? (n === st.items.length ? 'done' : 'open'), label: '', ticked, skipped: !!st.skipped,
    partial: n ? `${n} of ${st.items.length}` : null, items: st.items, writable: st.writable ?? true,
    beyondNote: null, consistency: st.consistency ?? null, rate: null,
    run: { line: st.runLine ?? null, milestone: !!st.milestone, best: st.best ?? null }, suggested: [],
  }
}

/** A fake routines server over `fetch`, holding one routine. */
function serve(over = {}) {
  const st = {
    id: 'r1', name: 'Pre-market routine', items: ITEMS, ticked: {}, today: '2026-10-27',
    readStatus: 200, tickStatus: [], archived: false, foreign: false, ...over,
  }
  const calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null })
    if (url === '/api/j2/routines/days' && method === 'POST') {
      if (st.readStatus !== 200) return json(st.readStatus, {})
      const { ids, days } = JSON.parse(init.body)
      const out = { routines: {} }
      if (days.includes('today')) out.resolved = { today: st.today }
      for (const id of ids) {
        if (id !== st.id || st.foreign) continue
        out.routines[id] = {
          routine: { id, name: st.name, archived: st.archived, items: st.items },
          days: Object.fromEntries(days.map((d) => { const real = d === 'today' ? st.today : d; return [real, entryFrom(st, real)] })),
        }
      }
      return json(200, out)
    }
    let m = /^\/api\/j2\/routines\/([^/]+)\/days\/([^/]+)\/items\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      if (st.tickRefusal) return json(400, { detail: st.tickRefusal })
      const s = st.tickStatus.length ? st.tickStatus.shift() : 200
      if (s !== 200) return json(s, {})
      st.ticked[decodeURIComponent(m[3])] = JSON.parse(init.body).ticked
      return json(200, entryFrom(st, decodeURIComponent(m[2])))
    }
    m = /^\/api\/j2\/routines\/([^/]+)\/days\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      const s = st.skipStatus?.length ? st.skipStatus.shift() : 200
      if (s !== 200) return json(s, {})
      st.skipped = JSON.parse(init.body).skipped
      st.state = st.skipped ? 'skipped' : undefined
      return json(200, entryFrom(st, decodeURIComponent(m[2])))
    }
    m = /^\/api\/j2\/routines\/([^/]+)\/unarchive$/.exec(url)
    if (m && method === 'POST') {
      if (st.unarchiveRefusal) return json(400, { detail: st.unarchiveRefusal })
      st.archived = false; st.writable = true; return json(200, { id: st.id })
    }
    return json(404, {})
  })
  return { st, calls, reads: () => calls.filter((c) => c.url === '/api/j2/routines/days') }
}

const PARAMS = { routineId: 'r1', day: '2026-10-27', bind: 'note-day', display: 'items' }
const editorWith = (noteDay) => ({ storage: { uctJournalWidgets: noteDay ? { noteDay } : {} } })
function mount(props = {}) {
  const setParams = props.setParams || vi.fn(() => true)
  const utils = render(<RoutineBlock params={PARAMS} setParams={setParams} editable editor={editorWith('2026-10-27')} {...props} />)
  return { ...utils, setParams }
}
const boxes = () => screen.queryAllByRole('checkbox')
const checked = (name) => screen.getByRole('checkbox', { name }).getAttribute('aria-checked')
const menuRow = (label) => screen.getByText(label).closest('button')
const NO_ZERO = [/\b0 (of|sessions)\b/, /0%/]

/** Every text node, SPACE-separated: textContent runs "dates" and "0 of 6" together as "dates0 of 6", where 
 *  sees no boundary and a zero would slip past the check (a mutation proved it). */
function textOf(el) {
  const out = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) out.push(w.currentNode.nodeValue)
  return out.join(' ')
}

beforeEach(() => { setOnline(true) })
afterEach(() => { cleanup(); setOnline(true); vi.restoreAllMocks() })

describe('RoutineBlock', () => {
  it('renders_items_partial_consistency_and_run_line', async () => {
    serve({ ticked: { i1: true, i2: true, i3: true, i4: true }, consistency: '18 of the last 20 trading days (2 skipped)', runLine: '5 sessions in a row' })
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    expect(screen.getByText('For Tue Oct 27')).toBeTruthy()
    expect(screen.getByText('Not yet')).toBeTruthy()
    expect(boxes().filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(4)
    expect(checked('Read the morning wire')).toBe('true')
    expect(checked('Check earnings dates')).toBe('false')
    expect(screen.getByText('4 of 6')).toBeTruthy()
    expect(screen.getByText('18 of the last 20 trading days (2 skipped)')).toBeTruthy()
    expect(screen.getByText('5 sessions in a row')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Skip this day' })).toBeTruthy()
  })

  it('a re-render storm fails: one read and one tick commit a bounded number of renders (H14)', async () => {
    serve()
    let commits = 0
    render(
      <Profiler id="routine" onRender={() => { commits += 1 }}>
        <RoutineBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} />
      </Profiler>,
    )
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark key levels' }))
    await waitFor(() => expect(screen.getByText('1 of 6')).toBeTruthy())
    const settled = commits
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(commits).toBe(settled)                                   // nothing keeps rendering once settled
    expect(commits).toBeLessThanOrEqual(10)                         // mount, read, tick press, tick answer (and slack)
  })

  it('run_line_absent_under_three_and_no_zero_anywhere', async () => {
    // Runs 0, 1 and 2 (the server sends no line under 3), and a routine created today with nothing ticked.
    const cases = [
      { consistency: '1 of the last 1 trading day' },
      { consistency: '2 of the last 3 trading days' },
      { consistency: '2 of the last 2 trading days', best: null },
      {},                                                            // brand new: no consistency, no run, no partial
    ]
    for (const c of cases) {
      serve(c)
      const { container, unmount } = mount()
      await waitFor(() => expect(boxes()).toHaveLength(6))
      expect(container.textContent).not.toMatch(/sessions in a row/)
      for (const re of NO_ZERO) expect(textOf(container), `${re} in ${textOf(container)}`).not.toMatch(re)
      unmount()
    }
  })

  it('milestone_21_one_line', async () => {
    serve({ runLine: '21 sessions in a row', milestone: true, consistency: '20 of the last 22 trading days (1 skipped)' })
    const { container } = mount()
    await waitFor(() => expect(screen.getByText('21 sessions in a row')).toBeTruthy())
    const line = screen.getByText('21 sessions in a row')
    expect(line.hasAttribute('data-milestone')).toBe(true)
    expect(line.className).toMatch(/milestone/)
    expect(container.querySelectorAll('[data-milestone]')).toHaveLength(1)
    expect(container.textContent.match(/sessions in a row/g)).toHaveLength(1)        // one line, nothing else
    expect(container.textContent).not.toMatch(/Best run/)
  })

  it('not_done_has_text_label_and_tooltip_no_strike', async () => {
    serve({ day: '2026-10-23', state: 'not_done', ticked: { i1: true } })
    mount({ params: { ...PARAMS, day: '2026-10-23' } })
    await waitFor(() => expect(screen.getByText('Not done')).toBeTruthy())
    const label = screen.getByText('Not done')
    expect(label.getAttribute('title')).toBe(NOT_DONE_TIP)
    expect(getComputedStyle(label).textDecoration || '').not.toMatch(/line-through/)
    // The rules for every class this block renders: no strike-through and no red anywhere.
    const dir = join(process.cwd(), 'src/pages/journal-2-0/components/notebook/blocks')
    for (const f of ['RoutineBlock.module.css', 'Blocks.module.css']) {
      const css = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')   // rules, not prose
      expect(css, f).toMatch(/\{/)                                                          // non-vacuity
      expect(css, f).not.toMatch(/line-through/)
      expect(css, f).not.toMatch(/--color-danger|--danger|\bred\b|#f87171|#ef4444/)
    }
  })

  it('an open day reads "Not yet", a skipped day "Skipped", an off day "Off day"', async () => {
    for (const [state, word] of [['open', 'Not yet'], ['skipped', 'Skipped'], ['off', 'Off day'], ['done', 'Done']]) {
      serve({ state, skipped: state === 'skipped' })
      const { unmount } = mount()
      await waitFor(() => expect(screen.getAllByText(word).length).toBeGreaterThan(0))
      unmount()
    }
  })

  it('flag_off_says_not_available_right_now', async () => {
    serve({ readStatus: 404 })
    const { container } = mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.flagOff)).toBeTruthy())
    expect(TOOL_COPY.flagOff).toBe('Not available right now.')
    expect(boxes()).toHaveLength(0)
    for (const re of NO_ZERO) expect(textOf(container)).not.toMatch(re)
  })

  it('foreign_says_not_available', async () => {
    serve({ foreign: true })                                         // answered, but the id is not the member's
    mount()
    await waitFor(() => expect(screen.getByText('Not available.')).toBeTruthy())
    expect(boxes()).toHaveLength(0)
  })

  it('archived_read_only_with_restore', async () => {
    const { calls } = serve({ archived: true, writable: false, ticked: { i1: true } })
    mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.archivedRoutine)).toBeTruthy())
    expect(boxes()).toHaveLength(0)                                  // history only: the items as text
    expect(screen.getByText('Read the morning wire')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip this day' })).toBeNull()
    expect(screen.queryByText(TOOL_COPY.window)).toBeNull()          // archived says archived, not "the window"
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow('Restore'))
    await waitFor(() => expect(boxes()).toHaveLength(6))             // restored, re-read, tickable again
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/j2/routines/r1/unarchive')).toBe(true)
    expect(screen.queryByText(TOOL_COPY.archivedRoutine)).toBeNull()
  })

  it('offline_disables_with_sentence', async () => {
    serve()
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
    await waitFor(() => expect(screen.getByText(TOOL_COPY.offline)).toBeTruthy())
    expect(boxes().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(screen.getByRole('button', { name: 'Skip this day' }).getAttribute('aria-disabled')).toBe('true')
    const before = globalThis.fetch.mock.calls.length
    fireEvent.click(boxes()[0])                                      // the handler guard: nothing is sent
    expect(globalThis.fetch.mock.calls.length).toBe(before)
    expect(boxes()[0].getAttribute('aria-checked')).toBe('false')
    act(() => { setOnline(true); window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(boxes().every((b) => !b.hasAttribute('aria-disabled'))).toBe(true))
    expect(screen.queryByText(TOOL_COPY.offline)).toBeNull()
  })

  it('offline at open: the sentence, no request; back online, it reads', async () => {
    const { reads } = serve()
    setOnline(false)
    mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.offline)).toBeTruthy())
    expect(reads()).toHaveLength(0)
    act(() => { setOnline(true); window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(boxes()).toHaveLength(6))
  })

  it('read_failure_sentence_and_retry_never_zero', async () => {
    const { st } = serve({ readStatus: 500 })
    const { container } = mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.readFailedRoutine)).toBeTruthy())
    for (const re of NO_ZERO) expect(textOf(container)).not.toMatch(re)
    expect(container.textContent).not.toMatch(/\b0\b/)
    st.readStatus = 200
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(boxes()).toHaveLength(6))
    expect(screen.queryByText(TOOL_COPY.readFailedRoutine)).toBeNull()
  })

  it('tick_failure_rolls_back_and_retries', async () => {
    const { calls } = serve({ tickStatus: [500] })
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark key levels' }))
    await waitFor(() => expect(screen.getByText(TOOL_COPY.tickFailed)).toBeTruthy())
    expect(checked('Mark key levels')).toBe('false')                // rolled back, on screen
    expect(screen.queryByText('1 of 6')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(checked('Mark key levels')).toBe('true'))
    await waitFor(() => expect(screen.queryByText(TOOL_COPY.tickFailed)).toBeNull())
    expect(screen.getByText('1 of 6')).toBeTruthy()
    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts.map((c) => [c.url, c.body])).toEqual([
      ['/api/j2/routines/r1/days/2026-10-27/items/i2', { ticked: true }],
      ['/api/j2/routines/r1/days/2026-10-27/items/i2', { ticked: true }],
    ])
  })

  it('outside_window_read_only_with_sentence', async () => {
    serve({ writable: false, state: 'not_done', ticked: { i1: true } })
    mount({ params: { ...PARAMS, day: '2026-10-01' } })
    await waitFor(() => expect(screen.getByText(TOOL_COPY.window)).toBeTruthy())
    expect(boxes()).toHaveLength(0)
    expect(screen.getByText('Mark key levels')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip this day' })).toBeNull()
  })

  it('a reader (editable false): the items and lines, no controls and no menu', async () => {
    serve({ ticked: { i1: true }, consistency: '3 of the last 4 trading days' })
    const setParams = vi.fn()
    mount({ editable: false, setParams })
    await waitFor(() => expect(screen.getByText('Read the morning wire')).toBeTruthy())
    expect(boxes()).toHaveLength(0)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('3 of the last 4 trading days')).toBeTruthy()
    expect(setParams).not.toHaveBeenCalled()
  })

  it('two_instances_adopt_one_tick', async () => {
    const { reads } = serve()
    render(
      <>
        <div data-testid="a"><RoutineBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
        <div data-testid="b"><RoutineBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
      </>,
    )
    await waitFor(() => expect(boxes()).toHaveLength(12))
    expect(reads()).toHaveLength(1)                                  // one batched read for both
    const a = screen.getByTestId('a'), b = screen.getByTestId('b')
    fireEvent.click(a.querySelector('[role="checkbox"][aria-label="Write the plan"]'))
    await waitFor(() => expect(b.querySelector('[aria-label="Write the plan"]').getAttribute('aria-checked')).toBe('true'))
    expect(a.querySelector('[aria-label="Write the plan"]').getAttribute('aria-checked')).toBe('true')
    expect(b.textContent).toContain('1 of 6')
  })

  it('bound_day_note_day_and_week_label', async () => {
    // note-day with no day of its own: the note's day.
    let srv = serve()
    let u = mount({ params: { routineId: 'r1', day: '', bind: 'note-day' }, editor: editorWith('2026-10-27') })
    await waitFor(() => expect(screen.getByText('For Tue Oct 27')).toBeTruthy())
    expect(srv.reads()[0].body.days).toEqual(['2026-10-27'])
    u.unmount()
    // week: the week's Monday.
    srv = serve()
    u = mount({ params: { routineId: 'r1', day: '2026-10-28', bind: 'week' } })
    await waitFor(() => expect(screen.getByText('For the week of Oct 26')).toBeTruthy())
    expect(srv.reads()[0].body.days).toEqual(['2026-10-28'])
    u.unmount()
    // today: the SERVER's day.
    srv = serve({ today: '2026-10-30' })
    u = mount({ params: { routineId: 'r1', day: '', bind: 'today' } })
    await waitFor(() => expect(screen.getByText('For Fri Oct 30')).toBeTruthy())
    expect(srv.reads()[0].body.days).toEqual(['today'])
    u.unmount()
  })

  it('negative_item_reads_didnt_happen', async () => {
    serve({ ticked: { i5: true } })
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    const neg = screen.getByRole('checkbox', { name: 'No revenge trades' })
    expect(neg.getAttribute('aria-checked')).toBe('true')
    expect(neg.textContent).toContain("Didn't happen")
    expect(screen.getAllByText("Didn't happen")).toHaveLength(1)    // only the ticked negative item
    fireEvent.click(neg)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'No revenge trades' }).getAttribute('aria-checked')).toBe('false'))
    expect(screen.queryByText("Didn't happen")).toBeNull()
  })

  it('skip: "Skip this day" becomes "Skipped" once the server answers, and never calls setParams', async () => {
    const setParams = vi.fn()
    serve()
    mount({ setParams })
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('button', { name: 'Skip this day' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skipped' }).getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write the plan' }))
    await waitFor(() => expect(checked('Write the plan')).toBe('true'))
    expect(setParams).not.toHaveBeenCalled()                         // ⛔ a read, a skip and a tick never write the note
  })

  it('Edit routine (until Task 9.16) says "Not available right now." in the block, after the menu has closed', async () => {
    serve()
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow('Edit routine'))
    await waitFor(() => expect(screen.getByText(TOOL_COPY.flagOff)).toBeTruthy())
    expect(screen.queryByText('Edit routine')).toBeNull()            // the menu is gone; the sentence is not
    expect(boxes()).toHaveLength(6)
  })

  it('the day settings: each is ONE setParams call carrying its search text', async () => {
    serve({ today: '2026-10-28' })
    const { setParams, unmount } = mount({ params: { ...PARAMS, day: '2026-10-26' } })
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow('Follow today'))
    await waitFor(() => expect(setParams).toHaveBeenCalledTimes(1))
    expect(setParams.mock.calls[0]).toEqual([{ bind: 'today', day: '' }, { searchText: '[routine: Pre-market routine · For Wed Oct 28]' }])
    unmount()
    const set2 = vi.fn()
    mount({ params: { routineId: 'r1', day: '', bind: 'today' }, setParams: set2, editor: editorWith('2026-10-26') })
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow("Use this note's day"))
    expect(set2).toHaveBeenCalledTimes(1)
    expect(set2.mock.calls[0]).toEqual([{ bind: 'note-day', day: '2026-10-26' }, { searchText: '[routine: Pre-market routine · For Mon Oct 26]' }])
  })
})

describe('RoutineBlock, fix round 1', () => {
  const inert = (el) => el.getAttribute('aria-disabled') === 'true'

  it("I-1: a follow-today block hears a tick written for the server's day by another block (W9-R27)", async () => {
    serve({ today: '2026-10-27' })
    render(
      <>
        <div data-testid="t"><RoutineBlock params={{ routineId: 'r1', day: '', bind: 'today' }} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
        <div data-testid="f"><RoutineBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
      </>,
    )
    await waitFor(() => expect(boxes()).toHaveLength(12))
    const t = screen.getByTestId('t'), f = screen.getByTestId('f')
    fireEvent.click(f.querySelector('[aria-label="Size from the stop"]'))
    await waitFor(() => expect(t.querySelector('[aria-label="Size from the stop"]').getAttribute('aria-checked')).toBe('true'))
  })

  it('I-1: a fixed-day block ignores an entry for another day', async () => {
    const { st } = serve()
    mount({ params: { ...PARAMS, day: '2026-10-26' } })
    await waitFor(() => expect(boxes()).toHaveLength(6))
    st.ticked = { i1: true, i2: true }
    st.entryDay = '2026-10-27'                                       // the server answers another day's entry
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(checked('Read the morning wire')).toBe('false')
    expect(screen.getByText('For Mon Oct 26')).toBeTruthy()
    st.entryDay = undefined                                          // control: its own day's entry IS adopted
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(checked('Read the morning wire')).toBe('true'))
  })

  it('I-2: an offline Restore says the offline sentence once and sends no request', async () => {
    const { calls } = serve({ archived: true, writable: false })
    mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.archivedRoutine)).toBeTruthy())
    setOnline(false)
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow('Restore'))
    await waitFor(() => expect(screen.getByText(TOOL_COPY.offline)).toBeTruthy())
    expect(screen.getAllByText(TOOL_COPY.offline)).toHaveLength(1)
    expect(calls.some((c) => c.url.endsWith('/unarchive'))).toBe(false)
  })

  it("I-2: count_cap shows the server's sentence and no Retry", async () => {
    serve({ archived: true, writable: false, unarchiveRefusal: { code: 'count_cap', message: 'You can have 30 routines at a time.' } })
    mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.archivedRoutine)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow('Restore'))
    await waitFor(() => expect(screen.getByText('You can have 30 routines at a time.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('I-2: a Restore re-reads EVERY placed block of that routine', async () => {
    serve({ archived: true, writable: false })
    render(
      <>
        <div data-testid="a"><RoutineBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
        <div data-testid="b"><RoutineBlock params={PARAMS} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} /></div>
      </>,
    )
    await waitFor(() => expect(screen.getAllByText(TOOL_COPY.archivedRoutine)).toHaveLength(2))
    fireEvent.click(screen.getByTestId('a').querySelector('[aria-label="Routine options"]'))
    fireEvent.click(menuRow('Restore'))
    await waitFor(() => expect(boxes()).toHaveLength(12))
    expect(screen.queryByText(TOOL_COPY.archivedRoutine)).toBeNull()
  })

  it('I-2: the block makes no request of its own (no fetch in RoutineBlock.jsx)', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/blocks/RoutineBlock.jsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/\bunarchive\(/)                             // control: the restore is there, through the layer
    expect(code).not.toMatch(/\bfetch\s*\(/)
    expect(code).not.toMatch(/XMLHttpRequest|sendBeacon/)
  })

  it('I-3: the not-done tooltip, word for word', async () => {
    serve({ state: 'not_done', ticked: { i1: true } })
    mount({ params: { ...PARAMS, day: '2026-10-23' } })
    await waitFor(() => expect(screen.getByText('Not done')).toBeTruthy())
    expect(screen.getByText('Not done').getAttribute('title')).toBe('Not enough items were ticked to count this day as done.')
  })

  it('I-4: a tick Retry puts focus on the retried checkbox', async () => {
    serve({ tickStatus: [500] })
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    const box = screen.getByRole('checkbox', { name: 'Write the plan' })
    box.focus()
    fireEvent.click(box)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy())
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Write the plan' }))   // aria-disabled kept it
    screen.getByRole('button', { name: 'Retry' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(checked('Write the plan')).toBe('true'))
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Write the plan' }))
  })

  it('I-4: Skip keeps focus while busy and after, and a Skip Retry returns to the toggle', async () => {
    const { st } = serve({ skipStatus: [500] })
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    const skip = screen.getByRole('button', { name: 'Skip this day' })
    skip.focus()
    fireEvent.click(skip)
    expect(inert(skip)).toBe(true)                                  // busy: aria-disabled, never `disabled`
    expect(skip.disabled).toBe(false)
    await waitFor(() => expect(screen.getByText(TOOL_COPY.tickFailed)).toBeTruthy())
    expect(document.activeElement).toBe(skip)
    screen.getByRole('button', { name: 'Retry' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skipped' })).toBeTruthy())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skipped' }))
    expect(st.skipped).toBe(true)
  })

  it('I-4: after a read Retry, focus lands on the first control once the read is in', async () => {
    const { st } = serve({ readStatus: 500 })
    mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.readFailedRoutine)).toBeTruthy())
    st.readStatus = 200
    screen.getByRole('button', { name: 'Retry' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(boxes()).toHaveLength(6))
    await waitFor(() => expect(document.activeElement).toBe(boxes()[0]))
  })

  it("M-2: going offline is said once, in the block's one live region", async () => {
    serve({ tickStatus: [500] })
    const { container } = mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write the plan' }))
    await waitFor(() => expect(screen.getByText(TOOL_COPY.tickFailed)).toBeTruthy())
    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
    await waitFor(() => expect(screen.getAllByText(TOOL_COPY.offline)).toHaveLength(1))
    const live = container.querySelector('[data-routine-live]')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe(TOOL_COPY.offline)
    expect(container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1)
  })

  it("M-3 (W9-R33): with no day, next-trading-day reads the session after the note's day, week its last session", async () => {
    const cases = [
      [{ bind: 'next-trading-day' }, '2026-11-25', '2026-11-27'],    // Thanksgiving is closed; the half day is a session
      [{ bind: 'next-trading-day' }, '2026-10-23', '2026-10-26'],    // Friday -> Monday
      [{ bind: 'week' }, '2026-10-27', '2026-10-30'],                // that week's Friday
      [{ bind: 'week' }, '2027-03-24', '2027-03-25'],                // Good Friday 2027-03-26 is closed: Thursday
    ]
    for (const [p, noteDay, want] of cases) {
      const srv = serve()
      const u = mount({ params: { routineId: 'r1', day: '', ...p }, editor: editorWith(noteDay) })
      await waitFor(() => expect(srv.reads()).toHaveLength(1))
      expect(srv.reads()[0].body.days, `${p.bind} ${noteDay}`).toEqual([want])
      u.unmount()
    }
  })

  it('M-4 (W9-R34): a future day not yet tickable says when it can be; the 7-day sentence is for the past', async () => {
    serve({ writable: false })
    let u = mount({ params: { ...PARAMS, day: '2099-10-30' } })
    await waitFor(() => expect(screen.getByText(/^You can tick this on /)).toBeTruthy())
    expect(screen.getByText(/^You can tick this on /).textContent).toBe('You can tick this on Fri Oct 30.')
    expect(screen.queryByText(TOOL_COPY.window)).toBeNull()
    u.unmount()
    serve({ writable: false })
    u = mount({ params: { ...PARAMS, day: '2026-10-01' } })
    await waitFor(() => expect(screen.getByText(TOOL_COPY.window)).toBeTruthy())
    expect(screen.queryByText(/^You can tick this on /)).toBeNull()
  })

  it("M-7: the server's read_only sentence is shown, with no Retry", async () => {
    serve({ tickRefusal: { code: 'read_only', message: 'This routine is archived.' } })
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write the plan' }))
    await waitFor(() => expect(screen.getByText('This routine is archived.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(checked('Write the plan')).toBe('false')
  })

  it('M-8: a long item wraps instead of widening the block (overflow-wrap: anywhere on the item text)', () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/blocks/RoutineBlock.module.css'), 'utf8')
    const rule = /\.text\s*\{([^}]*)\}/.exec(css)
    expect(rule, '.text rule').toBeTruthy()
    expect(rule[1]).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule[1]).toMatch(/min-width:\s*0/)
  })

  it('N-4: on touch the ⋯ button says a dialog opens (the Sheet), and a dialog opens', async () => {
    const mm = window.matchMedia
    window.matchMedia = (q) => ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
    try {
      serve()
      mount()
      await waitFor(() => expect(boxes()).toHaveLength(6))
      const b = screen.getByRole('button', { name: 'Routine options' })
      expect(b.getAttribute('aria-haspopup')).toBe('dialog')
      fireEvent.click(b)
      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      window.matchMedia = mm
    }
  })

  it('N-2: a Restore whose re-read reached the block sends ONE read and never shows the loading line', async () => {
    const { reads } = serve({ archived: true, writable: false })
    const { container } = mount()
    await waitFor(() => expect(screen.getByText(TOOL_COPY.archivedRoutine)).toBeTruthy())
    const before = reads().length
    let sawLoading = false
    const mo = new MutationObserver(() => { if (container.textContent.includes('Loading…')) sawLoading = true })
    mo.observe(container, { childList: true, subtree: true, characterData: true })
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow('Restore'))
    await waitFor(() => expect(boxes()).toHaveLength(6))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    mo.disconnect()
    expect(reads().length - before).toBe(1)                          // the layer's re-read, and no second one
    expect(sawLoading).toBe(false)
  })

  it('M-9: the ⋯ button says a menu opens on a fine pointer, and a menu opens', async () => {
    serve()
    mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    const b = screen.getByRole('button', { name: 'Routine options' })
    expect(b.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(b)
    expect(screen.getByRole('menu')).toBeTruthy()
  })
})

describe('RoutineBlock, Task 9.14 fix round 1 (I-3: a stale Retry after a bind switch)', () => {
  it('a tick fails while following today, the member picks "Use this note\'s day": the Retry is gone and nothing is written there', async () => {
    const { calls } = serve({ today: '2026-10-28', tickStatus: [500] })
    function Host() {
      const [params, setP] = useState({ routineId: 'r1', day: '', bind: 'today', display: 'items' })
      return <RoutineBlock params={params} setParams={(patch) => { setP((x) => ({ ...x, ...patch })); return true }} editable editor={editorWith('2026-10-26')} />
    }
    render(<Host />)
    await waitFor(() => expect(screen.getByText('For Wed Oct 28')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark key levels' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow("Use this note's day"))
    await waitFor(() => expect(screen.getByText('For Mon Oct 26')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByText(TOOL_COPY.tickFailed)).toBeNull()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual(['/api/j2/routines/r1/days/2026-10-28/items/i2'])
  })

  it('a read key changed from OUTSIDE the block (no menu: another tab, an undo) drops the Retry too', async () => {
    const { calls } = serve({ tickStatus: [500] })
    const { rerender } = mount()
    await waitFor(() => expect(boxes()).toHaveLength(6))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark key levels' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy())
    rerender(<RoutineBlock params={{ ...PARAMS, day: '2026-10-26' }} setParams={vi.fn()} editable editor={editorWith('2026-10-27')} />)
    await waitFor(() => expect(screen.getByText('For Mon Oct 26')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual(['/api/j2/routines/r1/days/2026-10-27/items/i2'])
  })

  it('M-7: a state is said by the ONE live region (no second status element)', async () => {
    for (const [over, text] of [[{ readStatus: 500 }, TOOL_COPY.readFailedRoutine], [{ readStatus: 404 }, TOOL_COPY.flagOff], [{ foreign: true }, TOOL_COPY.missing]]) {
      serve(over)
      const { container, unmount } = mount()
      await waitFor(() => expect(screen.getByText(text)).toBeTruthy())
      expect(container.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1)
      unmount()
    }
  })
})
