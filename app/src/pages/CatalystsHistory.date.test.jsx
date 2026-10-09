// Wave 4 (lane A): `CATH 2026-10-01` hands the page a `date` prop; it opens on that day.
// Wave 6 (lane B): a day picked inside the panel is written back into its command.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../components/TickerPopup', () => ({ default: ({ sym }) => <span>{sym}</span> }))
import CatalystsHistory from './CatalystsHistory'
import { PanelListContext, TerminalPanelContext } from '../components/terminal'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const wrap = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter><CatalystsHistory {...props} /></MemoryRouter>
  </SWRConfig>,
)

describe('CATH opening date', () => {
  it('opens on the day it was handed', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) })
    wrap({ date: '2026-10-01' })
    await screen.findByText(/No catalysts recorded/)
    expect(spy.mock.calls[0][0]).toBe('/api/catalysts/by-date/2026-10-01')
  })

  it('a malformed date is ignored (the latest session opens instead)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) })
    wrap({ date: 'soon' })
    await screen.findByText(/No catalysts recorded/)
    expect(spy.mock.calls[0][0]).not.toContain('soon')
  })
})

// Wave 6 (lane B): inside a terminal panel a picked day is written back into the panel's command
// through `usePanelRerun`, so `?cmd=` and a reload keep it. The re-run remounts the panel on the
// new day; a mount, and a pick of the day already shown, must never re-run (no remount loop).
describe('CATH writes a picked day back into its command', () => {
  const inPanel = (props, api) => render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter>
        <PanelListContext.Provider value={api}>
          <TerminalPanelContext.Provider value={{ code: 'CATH', density: 'comfortable', inset: true }}>
            <CatalystsHistory {...props} />
          </TerminalPanelContext.Provider>
        </PanelListContext.Provider>
      </MemoryRouter>
    </SWRConfig>,
  )
  const mkApi = () => ({ publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4, rerun: vi.fn() })
  const empty = () => vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) })
  const dateInput = () => document.querySelector('input[type="date"]')

  it('a day picked in the date field re-runs the panel as `CATH <day>` once the member leaves it', async () => {
    empty()
    const api = mkApi()
    inPanel({ date: '2026-10-01' }, api)
    await screen.findByText(/No catalysts recorded/)
    fireEvent.change(dateInput(), { target: { value: '2026-06-01' } })
    expect(api.rerun).not.toHaveBeenCalled()          // not mid-typing: the remount would steal the caret
    fireEvent.blur(dateInput())
    expect(api.rerun).toHaveBeenCalledTimes(1)
    expect(api.rerun).toHaveBeenCalledWith('CATH 2026-06-01')
  })

  it('Enter in the date field writes the day back too', async () => {
    empty()
    const api = mkApi()
    inPanel({ date: '2026-10-01' }, api)
    await screen.findByText(/No catalysts recorded/)
    fireEvent.change(dateInput(), { target: { value: '2026-06-02' } })
    fireEvent.keyDown(dateInput(), { key: 'Enter' })
    expect(api.rerun).toHaveBeenCalledWith('CATH 2026-06-02')
  })

  it('a quick jump writes its day back at once', async () => {
    empty()
    const api = mkApi()
    inPanel({ date: '2020-01-02' }, api)
    await screen.findByText(/No catalysts recorded/)
    fireEvent.click(screen.getByRole('button', { name: '30 days ago' }))
    expect(api.rerun).toHaveBeenCalledTimes(1)
    expect(api.rerun.mock.calls[0][0]).toMatch(/^CATH \d{4}-\d{2}-\d{2}$/)
    expect(api.rerun.mock.calls[0][0]).not.toBe('CATH 2020-01-02')
  })

  it('picking the day the command already names re-runs nothing; neither does mounting on it', async () => {
    empty()
    const api = mkApi()
    inPanel({ date: '2026-10-01' }, api)              // the remount a re-run causes looks exactly like this
    await screen.findByText(/No catalysts recorded/)
    expect(api.rerun).not.toHaveBeenCalled()
    fireEvent.blur(dateInput())                        // focus in and out, nothing changed
    fireEvent.change(dateInput(), { target: { value: '2026-10-01' } })
    fireEvent.blur(dateInput())
    fireEvent.keyDown(dateInput(), { key: 'Enter' })
    expect(api.rerun).not.toHaveBeenCalled()
  })

  it('a cleared or future day is not written back', async () => {
    empty()
    const api = mkApi()
    inPanel({ date: '2026-10-01' }, api)
    await screen.findByText(/No catalysts recorded/)
    fireEvent.change(dateInput(), { target: { value: '' } })
    fireEvent.blur(dateInput())
    fireEvent.change(dateInput(), { target: { value: '2999-01-01' } })
    fireEvent.blur(dateInput())
    expect(api.rerun).not.toHaveBeenCalled()
  })

  it('outside the terminal a pick only changes the page (nothing to re-run)', async () => {
    const spy = empty()
    wrap({ date: '2026-10-01' })
    await screen.findByText(/No catalysts recorded/)
    fireEvent.change(dateInput(), { target: { value: '2026-06-01' } })
    fireEvent.blur(dateInput())
    await screen.findByText(/Top Catalysts · 2026-06-01/)
    expect(spy.mock.calls.some((c) => c[0] === '/api/catalysts/by-date/2026-06-01')).toBe(true)
  })
})
