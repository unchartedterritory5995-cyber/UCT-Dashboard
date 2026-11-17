/**
 * Indicator commands in the command palette (plan docs/pine/studio/STUDIO-TRACK-PLAN.md
 * section 6, lane P1). Each is held to the Notebook commands' three rules:
 *   - offered only where it can work;
 *   - at least six typed characters, so it can never lead a ticker and take its Enter;
 *   - it opens a door that already exists: a route, or a chart door the charts page answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import CommandPalette, { INDICATOR_COMMANDS } from './CommandPalette'
import { AuthContext } from '../context/AuthContext'
import { INDICATOR_DOORS, PENDING_KEY, onIndicatorDoor, peekPendingIndicatorDoor } from './indicatorKit/indicatorDoors'

function RouteSpy() {
  const l = useLocation()
  return <div data-testid="route-spy">{l.pathname}{l.search}{l.hash}</div>
}
const MEMBER_IN = { user: { role: 'member' }, cohorts: ['create-indicator'] }
const MEMBER_OUT = { user: { role: 'member' }, cohorts: [] }
const renderPalette = (at = '/dashboard', auth = MEMBER_IN) => render(
  <AuthContext.Provider value={auth}>
    <MemoryRouter initialEntries={[at]}><CommandPalette /><RouteSpy /></MemoryRouter>
  </AuthContext.Provider>)

async function openAndType(q) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
  })
  const box = await screen.findByRole('combobox')
  fireEvent.change(box, { target: { value: q } })
  return box
}
const option = (name) => screen.queryByRole('option', { name })

beforeEach(() => {
  sessionStorage.clear()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
})
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

describe('palette: indicator commands', () => {
  it('every job is listed by its member name', () => {
    expect(INDICATOR_COMMANDS.map((c) => c.label)).toEqual([
      'Add an indicator', 'Describe an indicator', 'Paste a TradingView script', 'Write a formula',
      'Start an indicator from a picture', 'Look up a function', "Browse members' indicators",
      'Run an indicator over a list',
    ])
  })

  it('every command either names a route or a door the chart knows', () => {
    const doors = new Set(Object.values(INDICATOR_DOORS))
    for (const c of INDICATOR_COMMANDS) {
      const isRoute = typeof c.to === 'string' && c.to.startsWith('/')
      const isDoor = c.action === 'indicatorDoor' && doors.has(c.door)
      expect(isRoute !== isDoor, c.id).toBe(true)
    }
  })

  it('from another page: the door is parked, then the member lands on the charts page', async () => {
    renderPalette('/dashboard')
    await openAndType('paste a script')
    fireEvent.click(await screen.findByRole('option', { name: 'Paste a TradingView script' }))
    // ⛔ IN THE SAME TICK, with no wait: a deferred navigation let the page being left write its
    // own address afterwards (measured on production from the Screener, 2026-11-16).
    expect(screen.getByTestId('route-spy').textContent).toBe('/charts')
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe('/charts'))
    expect(peekPendingIndicatorDoor()).toBe('pine')
    expect(screen.queryByRole('combobox')).toBeNull()                    // the palette closed
  })

  it('on the charts page: the door is announced and there is no navigation', async () => {
    const heard = vi.fn()
    const off = onIndicatorDoor(heard)
    renderPalette('/charts')
    await openAndType('add an indicator')
    fireEvent.click(await screen.findByRole('option', { name: 'Add an indicator' }))
    await waitFor(() => expect(heard).toHaveBeenCalledWith('library'))
    expect(screen.getByTestId('route-spy').textContent).toBe('/charts')
    off()
  })

  it('a route command navigates and parks nothing', async () => {
    renderPalette('/dashboard')
    await openAndType('look up a function')
    fireEvent.click(await screen.findByRole('option', { name: 'Look up a function' }))
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe('/formulas/reference'))
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull()
  })

  it('Describe an indicator is offered only to an account the chart would open it for', async () => {
    renderPalette('/charts', MEMBER_OUT)
    await openAndType('describe an indicator')
    expect(option('Describe an indicator')).toBeNull()
    expect(option('Add an indicator')).toBeNull()            // control: a different phrase, so not offered either
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'add an indicator' } })
    expect(option('Add an indicator')).not.toBeNull()        // control: the other commands ARE offered to this account
  })

  it('Describe an indicator is offered to a released account', async () => {
    renderPalette('/charts', MEMBER_IN)
    await openAndType('describe an indicator')
    expect(option('Describe an indicator')).not.toBeNull()
  })

  it.each(['indic', 'paste', 'formu', 'RUN', 'ADD', 'LOOK'])(
    'five typed characters or fewer (%s) never offer a command, so a ticker keeps its Enter', async (q) => {
      renderPalette('/charts')
      await openAndType(q)
      for (const c of INDICATOR_COMMANDS) expect(option(c.label), `${q} -> ${c.label}`).toBeNull()
    })

  it('six characters that begin a phrase do offer it', async () => {
    renderPalette('/charts')
    await openAndType('indica')
    expect(option('Add an indicator')).not.toBeNull()
  })
})
