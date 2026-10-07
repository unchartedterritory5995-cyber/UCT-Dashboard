// CATH publishes the day's catalysts (completeness audit 2026-10-07, column g): each row, in
// order, is a numbered row that loads its name (`$SYM`); the day's names are the board list.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PanelListContext } from '../components/terminal'

vi.mock('../components/TickerPopup', () => ({ default: ({ sym }) => <span>{sym}</span> }))
import CatalystsHistory from './CatalystsHistory'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function mount() {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [{ code: 'GP', label: 'Chart' }], pageSize: 4 }
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter><PanelListContext.Provider value={api}><CatalystsHistory /></PanelListContext.Provider></MemoryRouter>
    </SWRConfig>,
  )
  return api
}
const row = (ticker) => ({ ticker, rank: 1, tag: 'Catalyst', thesis_text: 'Beat.', thesis_status: 'ok', gap_pct: 3, price: 28 })

describe('CATH rows', () => {
  it('one `$SYM` row per catalyst row, in order, and the day\'s names as its list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [row('XP'), row('NVDA'), row('AMD')] }) })
    const api = mount()
    await screen.findByText('3 rows')
    await waitFor(() => expect(api.publishRows).toHaveBeenLastCalledWith(['$XP', '$NVDA', '$AMD']))
    expect(api.publish.mock.calls.at(-1)[0]).toMatchObject({ syms: ['XP', 'NVDA', 'AMD'] })
    expect(api.publish.mock.calls.at(-1)[0].label).toMatch(/^CATH \d{4}-\d{2}-\d{2}$/)
    expect(screen.getByTestId('cath-board-open')).toHaveTextContent('Open 3')
  })

  it('CONTROL: a failed read publishes nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const api = mount()
    await screen.findByTestId('cath-error')
    expect(api.publishRows).toHaveBeenLastCalledWith([])
    expect(api.publish).toHaveBeenLastCalledWith(null)
  })
})
