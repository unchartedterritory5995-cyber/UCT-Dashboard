// S7 (audit 2026-11-05): the Styles button reads "Manage templates" (the manager's own title too).
// Notebook P1 lane C: the Styles button and the `?styles=1` deep link on the REAL Notebook tab, with only the
// network faked. ⛔ THE SWITCH GATES THE DOOR: off => no button a member could press, and the deep link opens
// nothing. Each absent case has a control that proves the list header itself rendered (the Import button).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'
import JournalStylesCard from '../components/JournalStylesCard'
import { pressToolbar, toolbarOffers } from './__tests__/toolbarDoors'

// The manager has its own rail (styles/StylesManager.test.jsx), and refuses to render while the switch is off.
// It is replaced here by a stub that does NOT refuse, so these tests prove the TAB's gate on its own: with the
// tab's gate removed, a stub that shows whenever it is opened would appear with the switch off.
// Follow-up C: the stub also shows WHERE it was asked to open (`show`), and how many times (`showKey`).
vi.mock('../components/notebook/styles/StylesManager', () => ({
  default: ({ open, show, showKey }) => (open ? (
    <><h2>Manage templates</h2><p data-testid="manager-show">{`${String(show)} #${showKey}`}</p></>
  ) : null),
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

  // Follow-up C: `?styles=1&show=` names where the manager opens (My tools' "Open Manage templates"; a link that
  // wants a place). The tab hands the value over once and takes both out of the URL; the manager decides what an
  // unknown value means (Active: StylesManager.views.test.jsx).
  it('?styles=1&show=archived|deleted|plain hands the place to the manager', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    for (const place of ['archived', 'deleted', 'plain']) {
      await show(`/journal/notebook?view=all&styles=1&show=${place}`)
      expect(await screen.findByTestId('manager-show')).toHaveTextContent(new RegExp(`^${place} #`))
      cleanup()
    }
  })

  it('the More menu opens the manager at Active even after a link opened it somewhere else', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    await show('/journal/notebook?view=all&styles=1&show=archived')
    expect(await screen.findByTestId('manager-show')).toHaveTextContent(/^archived #/)
    pressToolbar('Manage templates')
    expect(await screen.findByTestId('manager-show')).toHaveTextContent(/^null #/)
  })

  it('?styles=1&show=daily is not a URL place (the daily control is an in-app ask): it opens Active', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    await show('/journal/notebook?view=all&styles=1&show=daily')
    expect(await screen.findByTestId('manager-show')).toHaveTextContent(/^null #/)
  })

  // Follow-up C: the New note sheet's "Your templates" picks; its two links open the manager at the Plain templates
  // group (Manage) or the daily control (Change), and the New note sheet closes first (one room at a time).
  it("the New note sheet's Manage and Change links open the manager in the right place and close the sheet", async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    installFetch([[/^\/api\/j2\/journal-styles$/, LIST], [/mapping-offer$/, { offer: null }],
      [/^\/api\/j2\/note-templates$/, { templates: [{ id: 't1', name: 'Morning plan', title: '', createdAt: '1' }] }]])
    await show('/journal/notebook?view=all#templates')
    const sheet = await screen.findByRole('dialog', { name: 'New note' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Manage your plain templates' }))
    expect(await screen.findByTestId('manager-show')).toHaveTextContent(/^plain #/)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New note' })).toBeNull())
    cleanup()
    await show('/journal/notebook?view=all#templates')
    fireEvent.click(await within(await screen.findByRole('dialog', { name: 'New note' }))
      .findByRole('button', { name: 'Change what daily notes start from' }))
    expect(await screen.findByTestId('manager-show')).toHaveTextContent(/^daily #/)
  })

  it('CONTROL: with the switch off the New note sheet draws neither link (there is no manager to open)', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: false })
    installFetch([[/^\/api\/j2\/note-templates$/, { templates: [{ id: 't1', name: 'Morning plan', title: '', createdAt: '1' }] }]])
    await show('/journal/notebook?view=all#templates')
    const sheet = await screen.findByRole('dialog', { name: 'New note' })
    expect(await within(sheet).findByRole('button', { name: /^Morning plan/ })).toBeInTheDocument()   // the list drew
    expect(within(sheet).queryByRole('button', { name: 'Manage your plain templates' })).toBeNull()
    expect(within(sheet).queryByText(/Daily notes start from/)).toBeNull()
  })
})
