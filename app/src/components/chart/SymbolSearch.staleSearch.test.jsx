// ⭐ (2026-11-23, the typed ticker, item 3) A SUPERSEDED OR ABORTED TICKER SEARCH UPDATES NOTHING. Each query's
// search leaves 150 ms after the text holds still, and the next query (a keystroke, Enter, the dialog closing) aborts
// it. The aborted request's `catch` still wrote the fallback row and reset the highlight: after Enter that was a
// render of the search right after the chart switch, and while typing a stale "Go to {earlier text}" row stood under
// the newer text until the next answer. An answer that lands for a request already left (a transport that does not
// honour the abort) is not a result either. A REAL failure (the server down, a network error) still clears to the
// fallback, as it always has.
import { Profiler } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import SymbolSearch from './SymbolSearch'

/** Every /api/ticker-search request, in order: its query, its signal, and how the test answers it. */
let searches = []
/** Does the transport reject on abort, as fetch does? (false: a late answer arrives anyway) */
let honoursAbort = true

beforeEach(() => {
  vi.useFakeTimers()
  searches = []
  honoursAbort = true
  global.fetch = vi.fn((url, opts = {}) => {
    const u = String(url)
    if (!u.startsWith('/api/ticker-search')) return Promise.resolve({ ok: true, json: async () => ({ symbols: [], results: [] }) })
    return new Promise((resolve, reject) => {
      const q = new URL(u, 'http://x.test').searchParams.get('q')
      searches.push({
        q, signal: opts.signal,
        answer: (results) => resolve({ ok: true, json: async () => ({ results }) }),
        fail: (e) => reject(e),
      })
      if (honoursAbort) opts.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })
  })
})
afterEach(() => { vi.useRealTimers() })

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const input = () => screen.getByRole('textbox', { name: 'Search symbol or company' })
async function openAndType(text) {
  fireEvent.click(screen.getByRole('button', { name: /SPY/ }))
  await flush()
  fireEvent.change(input(), { target: { value: text } })
  await flush(150)                                                     // the search leaves once the text held still
}
async function typeMore(text) { fireEvent.change(input(), { target: { value: text } }); await flush(10) }
/** The "Go to {ticker}" rows shown, in order. */
const typedRows = () => screen.queryAllByText((_, el) => el?.tagName === 'SPAN' && /^Go to /.test(el.textContent)).map((el) => el.textContent)

test('Enter during a pending search: the aborted request updates nothing after the switch (no render after it)', async () => {
  const commits = []
  const onSymbolChange = vi.fn()
  render(<Profiler id="search" onRender={(_id, phase) => commits.push(phase)}><SymbolSearch sym="SPY" onSymbolChange={onSymbolChange} /></Profiler>)
  await openAndType('amd')
  expect(searches.map((s) => s.q)).toEqual(['AMD'])                    // in flight at Enter
  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(onSymbolChange).toHaveBeenCalledWith('AMD')
  expect(searches[0].signal.aborted).toBe(true)
  const after = commits.length
  await flush(50)
  expect(commits.length).toBe(after)
})

test('typing NV then NVD: the aborted NV request does not put "Go to NV" back under NVD', async () => {
  render(<SymbolSearch sym="SPY" onSymbolChange={vi.fn()} />)
  await openAndType('nv')
  expect(searches.map((s) => s.q)).toEqual(['NV'])
  await typeMore('nvd')                                                // NVD's own search has not left yet
  expect(searches[0].signal.aborted).toBe(true)
  expect(typedRows()).toEqual(['Go to NVD'])
})

test('typing NV then NVD: a late NV answer (a transport that ignores the abort) does not replace NVD\'s list', async () => {
  honoursAbort = false
  render(<SymbolSearch sym="SPY" onSymbolChange={vi.fn()} />)
  await openAndType('nv')
  await typeMore('nvd')
  searches[0].answer([{ ticker: 'NVO', name: 'Novo Nordisk' }, { ticker: 'NVS', name: 'Novartis' }])
  await flush()
  expect(screen.queryByText('Novo Nordisk')).toBeNull()
  expect(typedRows()).toEqual(['Go to NVD'])
})

test('CONTROL: a real (non-abort) failure still clears to the fallback (the Stocks chip: no matches)', async () => {
  render(<SymbolSearch sym="SPY" onSymbolChange={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /SPY/ }))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Stocks' }))
  fireEvent.change(input(), { target: { value: 'amd' } })
  await flush(150)
  expect(typedRows()).toEqual(['Go to AMD'])                           // the instant row, before the answer
  searches[0].fail(new TypeError('Failed to fetch'))
  await flush()
  expect(screen.getByText('No matches found')).toBeTruthy()
})
