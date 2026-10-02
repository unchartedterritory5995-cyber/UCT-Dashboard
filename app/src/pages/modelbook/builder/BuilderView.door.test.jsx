/* TERM-038 tail (2026-10-01) — the playbook-entry door (`P:<id>`), in page.
 *
 * The CLICK path: the REAL Ctrl/Cmd+K palette is mounted next to the REAL Model Book,
 * under a BrowserRouter, the page is ALREADY open, and the member types a name and
 * clicks the row. The row's `to` is `/model-book?view=builder&playbookEntry=<id>`.
 * Asserted on what the page RENDERS (the entry's title), that a second pick replaces
 * it, and that the door left the URL (only the Model Book's own `view=` remains).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { Profiler } from 'react'
import { BrowserRouter } from 'react-router-dom'
import useSWR, { SWRConfig } from 'swr'
import { AuthContext } from '../../../context/AuthContext'
import CommandPalette from '../../../components/CommandPalette'

vi.mock('../../../components/StockChart', () => ({ default: () => <div data-testid="stock-chart" /> }))
// The entry page pulls TipTap + charts; this stand-in reads the entry the same way
// (GET /api/upb/entries/<id>) and renders its title, so the assertion is on served data.
vi.mock('./UpbEntryPage', () => ({
  default: function EntryStandIn({ entryId }) {
    const { data } = useSWR(`/api/upb/entries/${entryId}`, (u) => fetch(u).then(r => r.json()))
    return <h2>{data?.entry?.title || 'loading entry'}</h2>
  },
}))
import ModelBook from '../../ModelBook'

const MAX_COMMITS_PER_PICK = 12
const ADDRESSES = [
  { address: 'P:e1', kind: 'playbook', kind_label: 'Playbook entry', name: 'Gap and go rules', to: '/model-book?view=builder&playbookEntry=e1' },
  { address: 'P:e2', kind: 'playbook', kind_label: 'Playbook entry', name: 'Flag pullback recipe', to: '/model-book?view=builder&playbookEntry=e2' },
]
const SERVED = {
  '/api/upb/overview': { sections: [{ id: 's1', title: 'My Setups', blurb: '', accent: 'gold', entry_count: 2, chart_count: 0 }],
                         totals: { sections: 1, entries: 2, charts: 0 } },
  '/api/upb/entries/e1': { entry: { id: 'e1', title: 'Gap and go rules' } },
  '/api/upb/entries/e2': { entry: { id: 'e2', title: 'Flag pullback recipe' } },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (u) => {
    const url = String(u)
    if (url.startsWith('/api/address/search')) {
      const q = new URL(url, 'http://x').searchParams.get('q')?.toLowerCase() || ''
      return { ok: true, status: 200, json: async () => ({ results: ADDRESSES.filter(a => a.name.toLowerCase().includes(q)), unavailable: [] }) }
    }
    const path = url.split('?')[0]
    if (path in SERVED) return { ok: true, status: 200, json: async () => SERVED[path] }
    return { ok: true, status: 200, json: async () => ({ years: [], stocks: [], results: [], notes: [], entries: [] }) }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.pushState({}, '', '/') })

let commits = 0
function countCommit() {
  commits += 1
  if (commits > 300) throw new Error(`H14 runaway: ${commits} commits`)
}
function mountAt(path) {
  commits = 0
  window.history.pushState({}, '', path)
  const auth = { user: { id: 'u-me', role: 'user', email: 'me@example.invalid' }, addressSpaceEnabled: true }
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={auth}>
        <BrowserRouter>
          <CommandPalette />
          <Profiler id="page" onRender={countCommit}><ModelBook /></Profiler>
        </BrowserRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}
async function pick(query, rowName) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
  })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
  const row = await screen.findByRole('option', { name: `${rowName}. Enter to open.` })
  const before = commits
  fireEvent.click(row)
  return before
}
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 40)) })

describe('the playbook-entry door (P:) while the Model Book is already open', () => {
  it('opens the picked entry from the hub, then another, and strips the door', async () => {
    mountAt('/model-book')
    await settle()
    expect(screen.queryByRole('heading', { name: 'Gap and go rules' })).toBeNull()

    let before = await pick('gap', 'Playbook entry: Gap and go rules')
    await screen.findByRole('heading', { name: 'Gap and go rules' })
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
    expect(new URLSearchParams(window.location.search).has('playbookEntry')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Gap and go rules' })).toBeInTheDocument()

    before = await pick('flag', 'Playbook entry: Flag pullback recipe')
    await screen.findByRole('heading', { name: 'Flag pullback recipe' })
    await settle()
    expect(commits - before).toBeLessThanOrEqual(MAX_COMMITS_PER_PICK)
    expect(screen.queryByRole('heading', { name: 'Gap and go rules' })).toBeNull()
    expect(window.location.search).toBe('?view=builder')
  })

  it('opens an entry when My Playbook itself is the open screen', async () => {
    mountAt('/model-book?view=builder')
    await settle()
    expect(screen.getByRole('heading', { name: /my playbook/i })).toBeInTheDocument()
    await pick('flag', 'Playbook entry: Flag pullback recipe')
    await screen.findByRole('heading', { name: 'Flag pullback recipe' })
    await settle()
    expect(window.location.search).toBe('?view=builder')
  })
})
