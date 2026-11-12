// S7 (audit 2026-11-05): the Styles button reads "Manage templates" (the manager's own title too).
// Notebook P1 lane C: the Styles button and the `?styles=1` deep link on the REAL Notebook tab, with only the
// network faked. ⛔ THE SWITCH GATES THE DOOR: off => no button a member could press, and the deep link opens
// nothing. Each absent case has a control that proves the list header itself rendered (the Import button).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'
import JournalStylesCard from '../components/JournalStylesCard'
import { pressToolbar, toolbarOffers } from './__tests__/toolbarDoors'

// The manager has its own rail (styles/StylesManager.test.jsx), and refuses to render while the switch is off.
// It is replaced here by a stub that does NOT refuse, so these tests prove the TAB's gate on its own: with the
// tab's gate removed, a stub that shows whenever it is opened would appear with the switch off.
vi.mock('../components/notebook/styles/StylesManager', () => ({
  default: ({ open }) => (open ? <h2>Manage templates</h2> : null),
}))

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const LIST = { kinds: [{ id: 'trade_plan', name: 'Trade plan', icon: 'chart', builtin: true, sortOrder: 0 }], blockKinds: ['chart'], styles: [] }

beforeEach(() => {
  installFetch([[/^\/api\/j2\/journal-styles$/, LIST], [/mapping-offer$/, { offer: null }]])
})
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function show(route = '/journal/notebook?view=all') {
  render(<Providers route={route}><NotebookTab /></Providers>)
  await settle()
  expect(toolbarOffers('Import')).toBe(true)   // control: the header rendered
}

describe('the Styles door on the Notebook tab', () => {
  it('shows a Styles button beside Import while the switch is on, and it opens the manager', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    await show()
    pressToolbar('Manage templates')
    expect(await screen.findByRole('heading', { name: 'Manage templates' })).toBeInTheDocument()
  })

  it('has no Styles button while the switch is off', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: false })
    await show()
    expect(toolbarOffers('Manage templates')).toBe(false)
  })

  it('has no Styles button when the server never said', async () => {
    await show()
    expect(toolbarOffers('Manage templates')).toBe(false)
  })

  it('?styles=1 opens the manager when the switch is on', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    await show('/journal/notebook?view=all&styles=1')
    expect(await screen.findByRole('heading', { name: 'Manage templates' })).toBeInTheDocument()
  })

  // Task 15 (fin walk, 2026-10-12): the Settings card links to `/journal/notebook?styles=1` with NO `view=all`,
  // which lands on Research Home. The manager was mounted inside the notes-list branch, so that link opened
  // nothing. The href is READ from the real card (never retyped). Notebook simplify, Task 5: that bare address is the
  // notes list now (it was Research Home), so the control proves the LIST is what rendered.
  it("the Settings card's own link opens the manager on the bare Notebook (the list)", async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    render(<Providers route="/settings"><JournalStylesCard /></Providers>)
    const href = screen.getByRole('link', { name: 'Manage templates' }).getAttribute('href')
    cleanup()
    expect(href).not.toMatch(/view=/)                                       // the case under test: the bare address
    render(<Providers route={href}><NotebookTab /></Providers>)
    await settle()
    expect(await screen.findByRole('heading', { name: 'Manage templates' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Notes list tools' })).toBeInTheDocument()   // control: the list is here
  })

  // Task 15 review Minor 7: the same deep link with no `view=` (the Settings card's own URL), switch OFF.
  it('?styles=1 on the bare Notebook opens nothing, and asks for nothing, when the switch is off', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: false })
    render(<Providers route="/journal/notebook?styles=1"><NotebookTab /></Providers>)
    await settle()
    expect(await screen.findByRole('toolbar', { name: 'Notes list tools' })).toBeInTheDocument()   // control: the list
    await settle()
    expect(screen.queryByRole('heading', { name: 'Manage templates' })).toBeNull()
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('journal-styles'))).toBe(false)
  })

  it('?styles=1 opens nothing, and asks for nothing, when the switch is off', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: false })
    await show('/journal/notebook?view=all&styles=1')
    await settle()
    expect(screen.queryByRole('heading', { name: 'Manage templates' })).toBeNull()
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('journal-styles'))).toBe(false)
  })
})
