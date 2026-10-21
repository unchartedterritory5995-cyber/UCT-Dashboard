// Notebook widgets Task 17: the Chart sets dialog, asserted by the text a member reads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import SetsDialog, { WATCHLISTS_URL } from './SetsDialog'
import { __resetSetsCache, CHART_SETS_PREF } from '../../../lib/notebookSets'

const SEMIS = { id: 's_1', name: 'Semis', charts: [{ symbol: 'NVDA', tf: 'D' }, { symbol: 'AMD', tf: '60' }] }
const SOFTWARE = { id: 's_2', name: 'Software', charts: [{ symbol: 'NOW', tf: 'D' }] }
const PRESET = { id: 'p_1', name: 'Flagged only', kind: 'myWatchlistToday', params: { list: 'flagged', share: false } }

let stored
let posts
const realFetch = global.fetch
function install({ readOk = true, watchlists = [] } = {}) {
  posts = []
  global.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/auth/preferences' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push(body)
      stored = body.value
      return { ok: true, status: 200, json: async () => ({}) }
    }
    if (url === '/api/auth/preferences') {
      if (!readOk) return { ok: false, status: 502, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ [CHART_SETS_PREF]: stored }) }
    }
    if (url === WATCHLISTS_URL) return { ok: true, status: 200, json: async () => watchlists }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const lastValue = () => JSON.parse(posts[posts.length - 1].value)

beforeEach(() => {
  __resetSetsCache()
  stored = JSON.stringify({ v: 1, sets: [SEMIS, SOFTWARE], presets: [PRESET] })
})
afterEach(() => { global.fetch = realFetch })

describe('SetsDialog', () => {
  it('lists the sets with their chart counts, the presets, and how to use a set', async () => {
    install()
    render(<SetsDialog onClose={() => {}} />)
    expect(await screen.findByText('Semis')).toBeInTheDocument()
    expect(screen.getByText('2 charts')).toBeInTheDocument()
    expect(screen.getByText('1 chart')).toBeInTheDocument()
    expect(screen.getByText('Flagged only')).toBeInTheDocument()
    expect(screen.getByText(/in a note to put all its charts in at once/)).toBeInTheDocument()
    expect(screen.getByText('Chart sets')).toBeInTheDocument()
  })

  it('a set is deleted only after the member says so, and the other key is kept', async () => {
    install()
    render(<SetsDialog onClose={() => {}} />)
    fireEvent.click(await screen.findByLabelText('Delete Semis'))
    expect(screen.getByText('Delete Semis?')).toBeInTheDocument()
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Semis')).not.toBeInTheDocument())
    expect(lastValue().sets.map((s) => s.name)).toEqual(['Software'])
    expect(lastValue().presets).toEqual([PRESET])
  })

  it('up and down reorder the sets (touch works: buttons, not drag)', async () => {
    install()
    render(<SetsDialog onClose={() => {}} />)
    fireEvent.click(await screen.findByLabelText('Move Software up'))
    await waitFor(() => expect(lastValue().sets.map((s) => s.name)).toEqual(['Software', 'Semis']))
    const names = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(names[0]).toMatch(/^Software/)
  })

  it('a set is renamed in its editor and saved', async () => {
    install()
    render(<SetsDialog onClose={() => {}} />)
    fireEvent.click(await screen.findByLabelText('Rename or edit Semis'))
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Chips' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save set' }))
    expect(await screen.findByText('Chips')).toBeInTheDocument()
    expect(lastValue().sets.map((s) => s.name)).toEqual(['Chips', 'Software'])
  })

  it('a set started from a watchlist takes its first 12 names and says the set is full', async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ sym: `W${String.fromCharCode(65 + i)}` }))
    install({ watchlists: [{ id: 7, name: 'Momentum', items }] })
    render(<SetsDialog onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start from a watchlist' }))
    fireEvent.change(await screen.findByLabelText('Watchlist'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use the first 12' }))
    expect(screen.getByLabelText('Set name').value).toBe('Momentum')
    expect(screen.getByText('12 of 12 charts. This set is full.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add a chart/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save set' }))
    await waitFor(() => expect(lastValue().sets.map((s) => s.name)).toEqual(['Semis', 'Software', 'Momentum']))
    expect(lastValue().sets[2].charts).toHaveLength(12)
  })

  it('a set with no name is refused in words, and nothing is saved', async () => {
    install()
    render(<SetsDialog onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /New chart set/ }))
    const row = screen.getByLabelText('Chart 1 symbol')
    fireEvent.change(row, { target: { value: 'nvda' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save set' }))
    expect(screen.getByText('Give the set a name.')).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  it('an unreadable value says so and offers nothing to change', async () => {
    install({ readOk: false })
    render(<SetsDialog onClose={() => {}} />)
    expect(await screen.findByText(/couldn't be read just now/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New chart set/ })).not.toBeInTheDocument()
  })

  it('a preset is deleted after asking, and the sets are kept', async () => {
    install()
    render(<SetsDialog onClose={() => {}} />)
    fireEvent.click(await screen.findByLabelText('Delete preset Flagged only'))
    const row = screen.getByText('Delete Flagged only?').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText(/No presets yet/)).toBeInTheDocument())
    expect(lastValue().sets.map((s) => s.name)).toEqual(['Semis', 'Software'])
    expect(lastValue().presets).toEqual([])
  })

  it('the back button closes the dialog', async () => {
    install()
    const onClose = vi.fn()
    render(<SetsDialog onClose={onClose} />)
    await screen.findByText('Semis')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an edit is applied to a FRESH read: a set another tab added meanwhile is kept', async () => {
    install()
    render(<SetsDialog onClose={() => {}} />)
    await screen.findByText('Semis')
    // Another tab saves a third set after this dialog loaded.
    stored = JSON.stringify({ v: 1, sets: [SEMIS, SOFTWARE, { id: 's_3', name: 'Banks', charts: [{ symbol: 'JPM', tf: 'D' }] }], presets: [PRESET] })
    fireEvent.click(screen.getByLabelText('Delete Semis'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(lastValue().sets.map((x) => x.name)).toEqual(['Software', 'Banks'])
  })
})
