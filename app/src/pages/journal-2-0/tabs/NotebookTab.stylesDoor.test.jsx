// Notebook P1 lane C: the Styles button and the `?styles=1` deep link on the REAL Notebook tab, with only the
// network faked. ⛔ THE SWITCH GATES THE DOOR: off => no button a member could press, and the deep link opens
// nothing. Each absent case has a control that proves the list header itself rendered (the Import button).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'

// The manager has its own rail (styles/StylesManager.test.jsx), and refuses to render while the switch is off.
// It is replaced here by a stub that does NOT refuse, so these tests prove the TAB's gate on its own: with the
// tab's gate removed, a stub that shows whenever it is opened would appear with the switch off.
vi.mock('../components/notebook/styles/StylesManager', () => ({
  default: ({ open }) => (open ? <h2>Journal styles</h2> : null),
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
  expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()   // control: the header rendered
}

describe('the Styles door on the Notebook tab', () => {
  it('shows a Styles button beside Import while the switch is on, and it opens the manager', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Styles' }))
    expect(await screen.findByRole('heading', { name: 'Journal styles' })).toBeInTheDocument()
  })

  it('has no Styles button while the switch is off', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: false })
    await show()
    expect(screen.queryByRole('button', { name: 'Styles' })).toBeNull()
  })

  it('has no Styles button when the server never said', async () => {
    await show()
    expect(screen.queryByRole('button', { name: 'Styles' })).toBeNull()
  })

  it('?styles=1 opens the manager when the switch is on', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    await show('/journal/notebook?view=all&styles=1')
    expect(await screen.findByRole('heading', { name: 'Journal styles' })).toBeInTheDocument()
  })

  it('?styles=1 opens nothing, and asks for nothing, when the switch is off', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: false })
    await show('/journal/notebook?view=all&styles=1')
    await settle()
    expect(screen.queryByRole('heading', { name: 'Journal styles' })).toBeNull()
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('journal-styles'))).toBe(false)
  })
})
