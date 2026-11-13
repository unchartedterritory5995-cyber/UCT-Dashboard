// Simplify pass 2 (C5, C6): a brand-new member's empty list, and the sample row's words on a phone.
//   C5  the inline "Start from a template" grid is not drawn while the Get started card is up (the card's "Start a note
//       from a template" row and "+ New" both open the picker); with the card hidden or absent the grid draws as before;
//       while the preferences read (which decides the card) is in flight, neither is drawn, so nothing flashes.
//   C6  at 640 px and below the More menu's removal row reads "Remove sample notebook"; above, the old words.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { CHECKLIST_PREF, CHECKLIST_STATES, closedAs } from '../components/notebook/onboarding/gettingStartedPref'
import NotebookTab from './NotebookTab'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => { cleanup(); __resetNotebookFlags(); vi.restoreAllMocks() })

const EMPTY = [/^\/api\/j2\/notes$/, { notes: [], total: 0 }]
const GET_STARTED = { notebook_onboarding_enabled: true, notebook_getting_started_enabled: true }
const grid = () => document.querySelector('[data-template-key]')

async function renderTab(routes = []) {
  const spy = installFetch([[/mapping-offer$/, { offer: null }], ...routes])
  render(<Providers auth={AUTH} route="/journal/notebook?view=all"><NotebookTab /></Providers>)
  await settle()
  return spy
}

describe('C5: the empty list and the Get started card', () => {
  it('card up: the card is drawn and the template grid is not', async () => {
    latchNotebookFlags(GET_STARTED)
    await renderTab([EMPTY])
    expect(await screen.findByText('Your notebook is empty.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument()
    await settle()
    expect(grid()).toBeNull()
    // "+ New"'s arrow still opens the picker
    expect(screen.getByRole('button', { name: 'More ways to start a note' })).toBeInTheDocument()
  })

  it('card hidden: the grid draws as before', async () => {
    latchNotebookFlags(GET_STARTED)
    await renderTab([EMPTY, [/^\/api\/auth\/preferences$/, { [CHECKLIST_PREF]: closedAs(null, CHECKLIST_STATES.dismissed) }]])
    expect(await screen.findByText('Your notebook is empty.')).toBeInTheDocument()
    await waitFor(() => expect(grid()).not.toBeNull(), { timeout: 5000 })
    expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull()
  })

  it('CONTROL: no card at all (its switch off): the grid draws', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    await renderTab([EMPTY])
    await waitFor(() => expect(grid()).not.toBeNull(), { timeout: 5000 })
  })

  it('while the preferences read is in flight: neither the card nor the grid', async () => {
    latchNotebookFlags(GET_STARTED)
    const spy = installFetch([[/mapping-offer$/, { offer: null }], EMPTY])
    const real = spy.getMockImplementation()
    let release
    const held = new Promise((r) => { release = r })
    spy.mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.split('?')[0] === '/api/auth/preferences') return held.then(() => real(input, init))
      return real(input, init)
    })
    render(<Providers auth={AUTH} route="/journal/notebook?view=all"><NotebookTab /></Providers>)
    expect(await screen.findByText('Your notebook is empty.')).toBeInTheDocument()
    await settle()
    expect(grid()).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull()
    await act(async () => { release() })
    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument()
    expect(grid()).toBeNull()
  })
})
