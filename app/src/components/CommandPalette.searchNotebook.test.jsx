/**
 * Finish program, lane KEYS: the palette's "Search Notebook" opens search.
 *
 * It used to navigate to /journal/notebook and stop: the member was on the Notebook's home with
 * the search panel closed, and still had to find the Search tab (9 keys against a budget of 5,
 * docs/notebook/fin-clicks.md Q4). It now carries `#search`, which the Notebook reads to open
 * its search panel with the cursor in the box. Only this one Notebook entry changed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import CommandPalette from './CommandPalette'
import { NOTEBOOK_SEARCH_HASH } from '../pages/journal-2-0/lib/notebookSearchDoor'
import { __resetNotebookFlags } from '../pages/journal-2-0/lib/offline/notebookFlags'

function RouteSpy() {
  const l = useLocation()
  return <div data-testid="route-spy">{l.pathname}{l.hash}</div>
}
const renderPalette = (at = '/dashboard') => render(
  <MemoryRouter initialEntries={[at]}><CommandPalette /><RouteSpy /></MemoryRouter>)

async function openAndType(q) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
  })
  const box = await screen.findByRole('combobox')
  fireEvent.change(box, { target: { value: q } })
  return box
}

beforeEach(() => {
  __resetNotebookFlags()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('palette: Search Notebook opens the search panel', () => {
  it('the door is a hash, and it is "#search"', () => {
    expect(NOTEBOOK_SEARCH_HASH).toBe('#search')
  })

  it('choosing "Search Notebook" lands on the Notebook WITH the search door', async () => {
    renderPalette()
    const box = await openAndType('search notebook')
    const opt = await screen.findByRole('option', { name: /Search Notebook/ })
    fireEvent.click(opt)
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent(`/journal/notebook${NOTEBOOK_SEARCH_HASH}`))
    expect(box).toBeTruthy()
  })

  it('control: "Open Notebook" still lands on the plain Notebook (only one entry changed)', async () => {
    renderPalette()
    await openAndType('open notebook')
    fireEvent.click(await screen.findByRole('option', { name: /Open Notebook/ }))
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe('/journal/notebook'))
  })
})
