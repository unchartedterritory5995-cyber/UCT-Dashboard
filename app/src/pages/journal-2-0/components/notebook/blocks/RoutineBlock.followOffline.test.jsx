// "Follow today" while offline (wave 9, Task 9.13 fix rounds 1-2: M-5, ruling W9-R35). The resolved 'today' has ONE
// authority, the data layer's own cache (toolsApi.resolvedTodayIfCurrent); the block keeps no copy. Each test starts
// from a FRESH layer (vi.resetModules), never from a block-side seam.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const ITEMS = [{ id: 'i1', text: 'Read the morning wire', negative: false }]
function serve(today) {
  const calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' })
    if (url === '/api/j2/routines/days') {
      const { ids, days } = JSON.parse(init.body)
      const out = { routines: {} }
      if (days.includes('today')) out.resolved = { today }
      for (const id of ids) {
        out.routines[id] = { routine: { id, name: 'Pre-market routine', archived: false },
          days: Object.fromEntries(days.map((d) => { const r = d === 'today' ? today : d
            return [r, { day: r, state: 'open', ticked: {}, skipped: false, items: ITEMS, writable: true, run: {} }] })) }
      }
      return json(200, out)
    }
    return json(404, {})
  })
  return calls
}
async function freshBlock() {
  vi.resetModules()
  return (await import('./RoutineBlock')).default
}
const menuRow = (label) => screen.getByText(label).closest('button')
const editor = { storage: { uctJournalWidgets: { noteDay: '2026-10-26' } } }
const FIXED = { routineId: 'r1', day: '2026-10-26', bind: 'note-day' }

beforeEach(() => setOnline(true))
afterEach(() => { cleanup(); setOnline(true); vi.restoreAllMocks() })

describe('M-5 / W9-R35: Follow today offline', () => {
  it('with no resolved day in the layer, the row is disabled and nothing is written; it never guesses', async () => {
    const RoutineBlock = await freshBlock()
    serve('2026-10-29')
    const setParams = vi.fn()
    render(<RoutineBlock params={FIXED} setParams={setParams} editable editor={editor} />)
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(1))
    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    const row = menuRow('Follow today')
    expect(row.disabled).toBe(true)
    fireEvent.click(row)
    expect(setParams).not.toHaveBeenCalled()
  })

  it("with the layer's resolved day from this ET day, it follows that day and sends nothing", async () => {
    const RoutineBlock = await freshBlock()
    const calls = serve('2026-10-29')
    const t = render(<RoutineBlock params={{ routineId: 'r1', day: '', bind: 'today' }} setParams={vi.fn()} editable editor={editor} />)
    await waitFor(() => expect(screen.getByText('For Thu Oct 29')).toBeTruthy())   // the layer heard the server's day
    t.unmount()
    const setParams = vi.fn()
    render(<RoutineBlock params={FIXED} setParams={setParams} editable editor={editor} />)
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(1))
    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')) })
    const sent = calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(menuRow('Follow today'))
    await waitFor(() => expect(setParams).toHaveBeenCalledTimes(1))
    expect(setParams.mock.calls[0]).toEqual([{ bind: 'today', day: '' }, { searchText: '[routine: Pre-market routine · For Thu Oct 29]' }])
    expect(calls.length).toBe(sent)
  })
})
