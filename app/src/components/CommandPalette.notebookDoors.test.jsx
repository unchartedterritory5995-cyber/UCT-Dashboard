/**
 * Finish program, lane KEYS3: Notebook commands in the command palette.
 *
 * A keyboard member in a note was 9 to 20 Tab stops from the note's own actions
 * (docs/notebook/fin-clicks.md section 14.8). Ctrl+K is one chord from anywhere, so the
 * palette carries a few Notebook commands. Each one is held to three rules, tested here:
 *   - it is offered only where it can work (a note is open, the feature's switch is on);
 *   - it needs at least six typed characters, so it can never lead a ticker (tickers are
 *     five letters at most) and take its Enter;
 *   - it does what the surface's own control does: a route, or a door the surface listens for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import CommandPalette from './CommandPalette'
import {
  NOTEBOOK_DOORS, NOTEBOOK_LIST_TO, NOTEBOOK_PREP_FLAG, NOTEBOOK_PREP_TO, NOTEBOOK_TEMPLATES_TO, onNotebookDoor,
} from '../pages/journal-2-0/lib/notebookDoors'
import { EARNINGS_PREP_FLAG } from '../pages/journal-2-0/lib/earningsPrepShared'
import { latchNotebookFlags, __resetNotebookFlags } from '../pages/journal-2-0/lib/offline/notebookFlags'
import RouteFocusTarget from '../pages/journal-2-0/lib/routeFocus'

function RouteSpy() {
  const l = useLocation()
  return <div data-testid="route-spy">{l.pathname}{l.search}{l.hash}</div>
}
const NOTE = '/journal/notebook?note=n1'
const renderPalette = (at = NOTE) => render(
  <MemoryRouter initialEntries={[at]}><CommandPalette /><RouteSpy /></MemoryRouter>)

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
  __resetNotebookFlags()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('palette: Visual playbook (Q22)', () => {
  it('in a note, with the switch on, choosing it opens the door the chart listens for', async () => {
    latchNotebookFlags({ notebook_visual_playbook_enabled: true })
    const heard = vi.fn()
    const off = onNotebookDoor(NOTEBOOK_DOORS.VISUAL_PLAYBOOK, heard)
    renderPalette()
    await openAndType('visual playbook')
    fireEvent.click(await screen.findByRole('option', { name: 'Visual playbook' }))
    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('route-spy').textContent).toBe(NOTE)      // no navigation
    expect(screen.queryByRole('combobox')).toBeNull()                    // the palette closed
    off()
  })

  it('DARK: with the switch off (or never answered) the command is not offered', async () => {
    renderPalette()
    await openAndType('visual playbook')
    expect(option('Visual playbook')).toBeNull()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_visual_playbook_enabled: false })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'visual playbook ' } })
    expect(option('Visual playbook')).toBeNull()
  })

  it('not offered where no note is open', async () => {
    latchNotebookFlags({ notebook_visual_playbook_enabled: true })
    renderPalette('/journal/notebook')
    await openAndType('visual playbook')
    expect(option('Visual playbook')).toBeNull()
  })

  it('five characters or fewer never offer it: a ticker keeps its Enter', async () => {
    latchNotebookFlags({ notebook_visual_playbook_enabled: true })
    renderPalette()
    const box = await openAndType('visua')
    expect(option('Visual playbook')).toBeNull()
    fireEvent.change(box, { target: { value: 'visual' } })
    expect(await screen.findByRole('option', { name: 'Visual playbook' })).toBeTruthy()
    fireEvent.change(box, { target: { value: 'playbo' } })
    expect(await screen.findByRole('option', { name: 'Visual playbook' })).toBeTruthy()
  })
})

describe('palette: Export this note (Q12)', () => {
  it('in a note, choosing it asks for the export door and does not navigate', async () => {
    const heard = vi.fn()
    const off = onNotebookDoor(NOTEBOOK_DOORS.EXPORT, heard)
    renderPalette()
    await openAndType('export')
    fireEvent.click(await screen.findByRole('option', { name: 'Export this note' }))
    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('route-spy').textContent).toBe(NOTE)
    off()
  })

  it('"expo" (a ticker) never offers it, and it is not offered where no note is open', async () => {
    renderPalette()
    const box = await openAndType('expo')
    expect(option('Export this note')).toBeNull()
    fireEvent.change(box, { target: { value: 'export note' } })
    expect(await screen.findByRole('option', { name: 'Export this note' })).toBeTruthy()
  })

  it('not offered on the notes list (no note open)', async () => {
    renderPalette('/journal/notebook?view=all')
    await openAndType('export')
    expect(option('Export this note')).toBeNull()
  })
})

describe('palette: Ask about this note (Q9)', () => {
  it('in a note, choosing it asks for the Ask door and does not navigate', async () => {
    const heard = vi.fn()
    const off = onNotebookDoor(NOTEBOOK_DOORS.ASK, heard)
    renderPalette()
    await openAndType('ask this note')
    fireEvent.click(await screen.findByRole('option', { name: 'Ask about this note' }))
    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('route-spy').textContent).toBe(NOTE)
    off()
  })

  it('"ask" alone never offers it, and it is not offered where no note is open', async () => {
    renderPalette()
    const box = await openAndType('ask')
    expect(option('Ask about this note')).toBeNull()
    fireEvent.change(box, { target: { value: 'ask no' } })
    expect(await screen.findByRole('option', { name: 'Ask about this note' })).toBeTruthy()
  })

  it('not offered on Research Home (no note open)', async () => {
    renderPalette('/journal/notebook')
    await openAndType('ask this note')
    expect(option('Ask about this note')).toBeNull()
  })
})

describe('palette: Active setups (Q23)', () => {
  it('with the board\'s switch on, choosing it opens the board', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    renderPalette('/journal/notebook')
    await openAndType('active setups')
    fireEvent.click(await screen.findByRole('option', { name: 'Active setups' }))
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe('/journal/notebook/setups'))
  })

  it('it is offered from anywhere in the app, by "setups" too', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    renderPalette('/dashboard')
    await openAndType('setups')
    expect(await screen.findByRole('option', { name: 'Active setups' })).toBeTruthy()
  })

  it('DARK: with the switch off, or never answered, it is not offered', async () => {
    renderPalette('/journal/notebook')
    const box = await openAndType('active setups')
    expect(option('Active setups')).toBeNull()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_setups_board_enabled: false })
    fireEvent.change(box, { target: { value: 'active setups ' } })
    fireEvent.change(box, { target: { value: 'active setups' } })
    expect(option('Active setups')).toBeNull()
  })

  it('"setup" (five letters) never offers it', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    renderPalette('/journal/notebook')
    await openAndType('setup')
    expect(option('Active setups')).toBeNull()
  })
})

// A PIN, not a fix (it passed before any change here). The palette is a modal dialog, and a
// Journal page never takes focus for its landing while a dialog holds it (lib/routeFocus.jsx).
// The palette closes in the same render as the move, so by the time the page looks, the dialog
// is gone and the landing takes focus. Q23's count depends on that; a special "close first"
// branch was written for it, shown to be unnecessary by removing it, and deleted.
describe('palette: Active setups lands keyboard focus on the page (Q23)', () => {
  it('after the move, focus is on the Journal page\'s landing, not on <body>', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    render(
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <CommandPalette />
        <RouteFocusTarget />
        <button type="button">first control of the page</button>
      </MemoryRouter>)
    await openAndType('active setups')
    fireEvent.click(await screen.findByRole('option', { name: 'Active setups' }))
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-route-focus')).toBe(true))
    expect(document.activeElement.textContent).toBe('Active setups')
  })
})

describe('palette: New note from a template (Q2)', () => {
  it('choosing it lands on the notes list with the templates door', async () => {
    renderPalette('/journal/notebook')
    await openAndType('template')
    fireEvent.click(await screen.findByRole('option', { name: 'New note from a template' }))
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe(NOTEBOOK_TEMPLATES_TO))
    expect(NOTEBOOK_TEMPLATES_TO).toBe('/journal/notebook?view=all#templates')
  })

  it('five characters or fewer never offer it, and "New Note" is still its own command', async () => {
    renderPalette('/journal/notebook')
    const box = await openAndType('templ')
    expect(option('New note from a template')).toBeNull()
    fireEvent.change(box, { target: { value: 'new note' } })
    expect(await screen.findByRole('option', { name: 'New Note' })).toBeTruthy()
    expect(option('New note from a template')).toBeTruthy()      // "new note" starts its phrase too
  })
})

describe('palette: All notes (Q11)', () => {
  it('choosing it lands on the notes list with the list door', async () => {
    renderPalette('/journal/notebook')
    await openAndType('all notes')
    fireEvent.click(await screen.findByRole('option', { name: 'All notes' }))
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe(NOTEBOOK_LIST_TO))
    expect(NOTEBOOK_LIST_TO).toBe('/journal/notebook?view=all#notes')
  })

  it('five characters or fewer never offer it ("notes" stays a plain query)', async () => {
    renderPalette('/journal/notebook')
    await openAndType('all n')
    expect(option('All notes')).toBeNull()
  })
})

describe('palette: Earnings prep (Q15)', () => {
  it('with the switch on, choosing it lands on Research Home with the prep door', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    renderPalette('/dashboard')
    await openAndType('earnings prep')
    fireEvent.click(await screen.findByRole('option', { name: 'Earnings prep: reporting soon' }))
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe(NOTEBOOK_PREP_TO))
    expect(NOTEBOOK_PREP_TO).toBe('/journal/notebook#prep')
  })

  it('DARK: with the switch off, or never answered, it is not offered', async () => {
    renderPalette('/journal/notebook')
    const box = await openAndType('earnings prep')
    expect(option('Earnings prep: reporting soon')).toBeNull()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_earnings_prep_enabled: false })
    fireEvent.change(box, { target: { value: 'earnings pre' } })
    expect(option('Earnings prep: reporting soon')).toBeNull()
  })

  it('the palette\'s copy of the switch name is the feature\'s own (they cannot drift)', () => {
    expect(NOTEBOOK_PREP_FLAG).toBe(EARNINGS_PREP_FLAG)
  })
})
