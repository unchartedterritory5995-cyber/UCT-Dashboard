// The Charts view mounts the REAL /charts Multi-Chart grid (only the canvas is stubbed): the
// screener host must supply everything the grid and its cells read, or a cell renders dead.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({
  default: p => { p.onBarsReady?.(); return <div data-testid="stockchart" data-sym={p.sym} data-tf={p.tf} /> },
}))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchGridWarm: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import ScreenerChartGrid from '../ScreenerChartGrid'
import { registerShortcuts } from '../../../command/shortcutRegistry'
import { AuthContext } from '../../../../context/AuthContext'

beforeEach(() => {
  localStorage.clear()
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})
const rows = n => Array.from({ length: n }, (_, i) => ({ ticker: `R${i}` }))

test('the real grid charts the first page of results through its mount queue', async () => {
  localStorage.setItem('uct.screener.gridLayout', '2x2')
  render(<MemoryRouter><AuthContext.Provider value={{ user: { role: 'member' } }}><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ScreenerChartGrid rows={rows(6)} total={6} hasMore={false} onLoadMore={() => {}} resetKey="k" />
  </SWRConfig></AuthContext.Provider></MemoryRouter>)
  // ≤3 at once, each slot freed by onBarsReady: all four land.
  await waitFor(() => expect(screen.getAllByTestId('stockchart')).toHaveLength(4))
  expect(screen.getAllByTestId('stockchart').map(c => c.dataset.sym)).toEqual(['R0', 'R1', 'R2', 'R3'])
  expect(screen.getByText(/1–4 of 6/)).toBeInTheDocument()
})

// The view's two window keys (PageDown/PageUp turn the page, Escape closes the layout menu)
// moved onto the shortcut registry; these keep what each key DOES on screen.
const mount = () => render(<MemoryRouter><AuthContext.Provider value={{ user: { role: 'member' } }}><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
  <ScreenerChartGrid rows={rows(6)} total={6} hasMore={false} onLoadMore={() => {}} resetKey="k" />
</SWRConfig></AuthContext.Provider></MemoryRouter>)

test('PageDown and PageUp turn the page of charts from anywhere in the view', async () => {
  localStorage.setItem('uct.screener.gridLayout', '2x2')
  mount()
  await waitFor(() => expect(screen.getByText(/1–4 of 6/)).toBeInTheDocument())
  fireEvent.keyDown(document.body, { key: 'PageDown' })
  await waitFor(() => expect(screen.getByText(/5–6 of 6/)).toBeInTheDocument())
  fireEvent.keyDown(document.body, { key: 'PageUp' })
  await waitFor(() => expect(screen.getByText(/1–4 of 6/)).toBeInTheDocument())
})

test('PageDown typed in a text field leaves the page where it is', async () => {
  localStorage.setItem('uct.screener.gridLayout', '2x2')
  mount()
  await waitFor(() => expect(screen.getByText(/1–4 of 6/)).toBeInTheDocument())
  const input = document.createElement('input')
  document.body.appendChild(input)
  fireEvent.keyDown(input, { key: 'PageDown' })
  expect(screen.getByText(/1–4 of 6/)).toBeInTheDocument()
  input.remove()
})

test('Escape closes the layout menu', async () => {
  localStorage.setItem('uct.screener.gridLayout', '2x2')
  mount()
  const toggle = await screen.findByRole('button', { expanded: false })
  fireEvent.click(toggle)
  expect(screen.getByText('Layout')).toBeInTheDocument()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByText('Layout')).not.toBeInTheDocument())
})

// Review M4: one key press is answered by the topmost surface only. A stand-in modal layer (what
// the command palette or a ticker popup is: role="dialog" aria-modal) opened over the surface, and
// a live video binding, are the two things that used to answer the same press as well.
const openModalLayer = () => {
  const el = document.createElement('div')
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  document.body.appendChild(el)
  return () => el.remove()
}

test('Escape with a modal layer over the page leaves the menu; alone it closes the menu and nothing else', async () => {
  localStorage.setItem('uct.screener.gridLayout', '2x2')
  const videoEscape = vi.fn()
  const off = registerShortcuts({ 'video.escape': videoEscape })
  try {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /2×2/ }))
    expect(screen.getByText('Layout')).toBeInTheDocument()
    const close = openModalLayer()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByText('Layout')).toBeInTheDocument()
    close()
    videoEscape.mockClear()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Layout')).not.toBeInTheDocument())
    expect(videoEscape).not.toHaveBeenCalled()
  } finally { off() }
})
