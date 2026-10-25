// The routine block (Notebook widgets phase 2, wave 9, Task 9.13). Asserted by RENDERED TEXT after the action has
// settled, never by state: a sentence a member cannot read is not a sentence.
import { Profiler } from 'react'
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
    day, state: st.state ?? (n === st.items.length ? 'done' : 'open'), label: '', ticked, skipped: !!st.skipped,
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
      const s = st.tickStatus.length ? st.tickStatus.shift() : 200
      if (s !== 200) return json(s, {})
      st.ticked[decodeURIComponent(m[3])] = JSON.parse(init.body).ticked
      return json(200, entryFrom(st, decodeURIComponent(m[2])))
    }
    m = /^\/api\/j2\/routines\/([^/]+)\/days\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      st.skipped = JSON.parse(init.body).skipped
      st.state = st.skipped ? 'skipped' : undefined
      return json(200, entryFrom(st, decodeURIComponent(m[2])))
    }
    m = /^\/api\/j2\/routines\/([^/]+)\/unarchive$/.exec(url)
    if (m && method === 'POST') { st.archived = false; st.writable = true; return json(200, { id: st.id }) }
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
    expect(boxes().every((b) => b.disabled)).toBe(true)
    expect(screen.getByRole('button', { name: 'Skip this day' }).disabled).toBe(true)
    act(() => { setOnline(true); window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(boxes().every((b) => !b.disabled)).toBe(true))
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
