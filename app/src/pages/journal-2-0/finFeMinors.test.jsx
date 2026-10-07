// Finish program, lane FE — the MINOR findings of the frontend review, one rail each.
//   1. the plan-status read covers EVERY trade on the page, not the first 200 by string order
//   2. a trade with no P&L does not crash My Playbook
//   3. /vs says so when its lookup fails (it used to insert nothing and say nothing)
//   4. two entry-context cards on one page do not share DOM ids
//   5. the Setups page with both flags off sends the member back, like My Playbook does
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, renderHook } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { latchNotebookFlags, __resetNotebookFlags } from './lib/offline/notebookFlags'
import { usePlanStatuses, MAX_STATUS_IDS } from './hooks/usePlanGrade'
import { Drill } from './components/insights/MyPlaybook'
import { widgetItems } from './components/notebook/SlashMenu'
import WhyPrompt from './components/WhyPrompt'
import EntryContextCard from './components/EntryContextCard'
import SetupsBoard from './components/notebook/SetupsBoard'

const swr = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)
const ok = (data) => ({ ok: true, status: 200, json: async () => data })
const realFetch = global.fetch
beforeEach(() => { __resetNotebookFlags() })
afterEach(() => { __resetNotebookFlags(); global.fetch = realFetch; vi.restoreAllMocks() })

describe('1 — plan statuses cover every trade on the page', () => {
  it('more than the server’s cap: asked in batches, and every trade gets its status', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    const ids = Array.from({ length: MAX_STATUS_IDS + 50 }, (_, i) => `t-${i}`)
    const asked = []
    global.fetch = vi.fn(async (url) => {
      const list = decodeURIComponent(String(url).split('ids=')[1] || '').split(',').filter(Boolean)
      asked.push(list)
      if (list.length > MAX_STATUS_IDS) return { ok: false, status: 400, json: async () => ({ detail: 'At most 200 trades at a time' }) }
      return ok({ statuses: Object.fromEntries(list.map((id) => [id, { tradeRef: id, status: 'unplanned' }])) })
    })
    const { result } = renderHook(() => usePlanStatuses(ids), { wrapper: swr })
    await waitFor(() => expect(result.current.statuses).not.toBeNull())
    expect(Object.keys(result.current.statuses).length).toBe(ids.length)
    // the trade that sorts LAST as a string used to be the one cut off
    expect(result.current.statuses['t-99']).toEqual({ tradeRef: 't-99', status: 'unplanned' })
    expect(asked.every((l) => l.length <= MAX_STATUS_IDS)).toBe(true)
    expect(asked.length).toBe(2)
  })

  it('CONTROL — a normal page is still one request', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    global.fetch = vi.fn(async () => ok({ statuses: { a: { tradeRef: 'a', status: 'planned' } } }))
    const { result } = renderHook(() => usePlanStatuses(['a', 'b']), { wrapper: swr })
    await waitFor(() => expect(result.current.statuses).not.toBeNull())
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(String(global.fetch.mock.calls[0][0])).toBe('/api/j2/plan-grades/status?ids=a,b')
  })
})

describe('2 — My Playbook survives a trade with no P&L', () => {
  it('renders a dash for a missing P&L or R instead of throwing', () => {
    const rows = [
      { id: 't1', symbol: 'NVDA', exitDate: '2026-03-03T19:30:00+00:00', result: 'win', rMultiple: 1.5, pnlDollar: 120.5, source: null },
      { id: 't2', symbol: 'AMD', exitDate: null, result: 'open', rMultiple: null, pnlDollar: null, source: 'broker' },
      { id: 't3', symbol: 'TSLA', exitDate: '2026-03-04', result: 'loss', rMultiple: -1, source: null },
    ]
    const item = { label: 'Wins', drillLabel: 'trades', drill: () => true }
    render(<MemoryRouter><Drill setup="VCP" idx={0} item={item} trades={rows} onClose={() => {}} /></MemoryRouter>)
    const cells = (id) => [...document.querySelector(`[data-trade="${id}"]`).querySelectorAll('td')].map((td) => td.textContent)
    expect(cells('t1').slice(-2)).toEqual(['1.50', '120.50'])
    expect(cells('t2').slice(-2)).toEqual(['—', '—'])
    expect(cells('t3').slice(-2)).toEqual(['-1.00', '—'])
  })
})

describe('3 — /vs tells the member when it could not find the comparison', () => {
  const run = (item, notify) => {
    const box = { inserted: null }
    const chain = {
      focus: () => chain, deleteRange: () => chain,
      insertContent: (c) => { box.inserted = c; return chain },
      caretAfterWidgetEmbed: () => chain, run: () => {},
    }
    return { box, p: item.command({ editor: { chain: () => chain, storage: { uctJournalWidgets: { notify } } }, range: {} }) }
  }
  beforeEach(() => latchNotebookFlags({ notebook_chart_plan_enabled: true }))

  it('a stock with no theme ETF: nothing is inserted, and one sentence says why', async () => {
    global.fetch = vi.fn(async () => ok({ options: [{ key: 'SPY', symbol: 'SPY' }], missing: { theme: 'x' } }))
    const notify = vi.fn()
    const r = run(widgetItems('vs AMD theme')[0], notify); await r.p
    expect(r.box.inserted).toBeNull()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toBe('AMD has no theme ETF on file, so nothing was added. Try /vs AMD SPY.')
  })

  it('a refused or failed lookup: nothing is inserted, and one sentence says so', async () => {
    const notify = vi.fn()
    global.fetch = vi.fn(async () => ({ ok: false, status: 503 }))
    let r = run(widgetItems('vs AMD sector')[0], notify); await r.p
    global.fetch = vi.fn(async () => { throw new Error('down') })
    r = run(widgetItems('vs AMD sector')[0], notify); await r.p
    expect(r.box.inserted).toBeNull()
    expect(notify.mock.calls.map((c) => c[0])).toEqual([
      'The sector ETF for AMD could not be looked up just now, so nothing was added. Try /vs again.',
      'The sector ETF for AMD could not be looked up just now, so nothing was added. Try /vs again.',
    ])
  })

  it('CONTROL — a found benchmark inserts the pair and says nothing; no notifier is not an error', async () => {
    global.fetch = vi.fn(async () => ok({ options: [{ key: 'sector', symbol: 'XLK', label: 'Technology sector' }], missing: {} }))
    const notify = vi.fn()
    const r = run(widgetItems('vs AMD sector')[0], notify); await r.p
    expect(r.box.inserted.map((n) => n.attrs.params.symbol)).toEqual(['AMD', 'XLK'])
    expect(notify).not.toHaveBeenCalled()
    global.fetch = vi.fn(async () => ({ ok: false, status: 503 }))
    await expect(run(widgetItems('vs AMD sector')[0], undefined).p).resolves.toBeUndefined()
  })
})

describe('3b — the sentence has somewhere to go', () => {
  it('the note editor hands commands its own toast as `notify`', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, 'components/notebook/NoteEditorPage.jsx'), 'utf8')
    expect(src).toMatch(/notify: \(message, tone = 'error'\) => setUploadToast\(\{ message, tone \}\)/)
  })
})

describe('4 — two cards on one page do not share ids', () => {
  it('each "Why did you take it?" label points at its own box', () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    render(
      <>
        <WhyPrompt symbol="AMD" entryDay="2026-03-02" why={null} whyMaxChars={500} onSaved={() => {}} />
        <WhyPrompt symbol="AMD" entryDay="2026-03-09" why={null} whyMaxChars={500} onSaved={() => {}} />
      </>,
    )
    const boxes = screen.getAllByLabelText('Why did you take it?')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).not.toBe(boxes[1])
    expect(new Set(boxes.map((b) => b.id)).size).toBe(2)
  })

  it('each entry-context card is named by its own title', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    render(<>
      <EntryContextCard kind="position" id="lot-1" />
      <EntryContextCard kind="position" id="lot-2" />
    </>, { wrapper: swr })
    await waitFor(() => expect(document.querySelectorAll('section[aria-labelledby]').length).toBe(2))
    const ids = [...document.querySelectorAll('section[aria-labelledby]')].map((s) => s.getAttribute('aria-labelledby'))
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(document.querySelectorAll(`[id="${id}"]`).length).toBe(1)
    expect(document.querySelectorAll('[id]').length).toBe(new Set([...document.querySelectorAll('[id]')].map((e) => e.id)).size)
  })
})

describe('5 — the Setups page with both flags off', () => {
  let here = null
  const Probe = () => { here = useLocation().pathname; return null }
  it('sends the member to the Notebook and fetches nothing (no "not available yet" page)', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: false, notebook_find_similar_enabled: false })
    global.fetch = vi.fn(async () => ok({}))
    render(
      <MemoryRouter initialEntries={['/journal/notebook/setups']}>
        <Probe />
        <Routes>
          <Route path="/journal/notebook/setups" element={<SetupsBoard />} />
          <Route path="/journal/notebook" element={<h1>Notebook</h1>} />
        </Routes>
      </MemoryRouter>, { wrapper: swr },
    )
    await waitFor(() => expect(here).toBe('/journal/notebook'))
    expect(screen.queryByText('This page is not available yet.')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
