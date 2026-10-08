// Finish program, lane KEYS: focus lands on the new page after an in-app navigation.
//
// The click-budget measurement (docs/notebook/fin-clicks.md) found focus left on <body> after
// every Journal route change, so a keyboard member was back at "Skip to main content" on each
// page. The REAL JournalLayout is rendered here; only its data hooks and modals are stubbed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link, useNavigate } from 'react-router-dom'

vi.mock('../../context/AuthContext', () => ({ useIsPaid: () => true, useAuth: () => ({ isPaid: true }) }))
vi.mock('./hooks/useJ2Settings', () => ({
  default: () => ({ settings: { setups: [] }, isLoading: false, error: null, save: vi.fn(), accountName: 'Default', isAllAccounts: false }),
}))
vi.mock('./hooks/useBrokerSync', () => ({ default: () => {} }))
vi.mock('./components/accounts/AccountSelector', () => ({ default: () => <div data-testid="account-selector" /> }))
vi.mock('./components/PortfolioSettingsModal', () => ({ default: () => null }))
vi.mock('./components/accounts/NewAccountModal', () => ({ default: () => null }))
vi.mock('./components/GenerateReportModal', () => ({ default: () => null }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { id: 'a1', name: 'Default' }, accounts: [{ id: 'a1', name: 'Default' }], setAccount: vi.fn(), isLoading: false }),
}))
vi.mock('./components/AddPositionModal', () => ({ default: () => null }))
vi.mock('./components/AddTradeModal', () => ({ default: () => null }))

import JournalLayout from './JournalLayout'
import RouteFocusTarget, { journalPageTitle } from './lib/routeFocus'
import { latchNotebookFlags } from './lib/offline/notebookFlags'

latchNotebookFlags({ notebook_offline_default_on: true })

let nav = null
function Page({ name, children }) {
  nav = useNavigate()
  return <div data-testid={name}><button type="button">first control on {name}</button>{children}</div>
}
function DialogPage() {
  // a page that opens its own dialog on arrival and focuses inside it
  return <div role="dialog" aria-modal="true" aria-label="A dialog"><button type="button" autoFocus>inside the dialog</button></div>
}

function renderAt(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/elsewhere" element={<Page name="elsewhere"><Link to="/journal/trades">to trades</Link></Page>} />
        <Route path="/journal" element={<JournalLayout />}>
          <Route index element={<Page name="today" />} />
          <Route path="trades" element={<Page name="trades" />} />
          <Route path="calendar" element={<Page name="calendar" />} />
          <Route path="notebook" element={<Page name="notebook" />} />
          <Route path="notebook/setups" element={<Page name="setups" />} />
          <Route path="notebook/research/:ticker" element={<Page name="research" />} />
          <Route path="insights" element={<Page name="insights" />} />
          <Route path="compass" element={<Page name="compass" />} />
          <Route path="community" element={<DialogPage />} />
        </Route>
        <Route path="/journal-2-0/playbook" element={<><RouteFocusTarget title="My Playbook" /><Page name="playbook" /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })
const target = () => document.querySelector('[data-route-focus]')
async function go(to, opts) {
  await act(async () => { nav(to, opts) })
  await settle()
}

beforeEach(() => { nav = null })

describe('Journal routes: focus lands on the new page after an in-app navigation', () => {
  it.each([
    ['/journal/trades', 'Trades'],
    ['/journal/calendar', 'Calendar'],
    ['/journal/notebook', 'Notebook'],
    ['/journal/notebook/setups', 'Active setups'],
    ['/journal/notebook/research/NVDA', 'NVDA research'],
    ['/journal/insights', 'Insights'],
    ['/journal/compass', 'Compass'],
    ['/journal', 'Today'],
  ])('%s: the page target holds focus and is named %s', async (to, title) => {
    renderAt(to === '/journal' ? '/journal/trades' : '/journal')
    await settle()
    await go(to)
    const el = target()
    expect(document.activeElement).toBe(el)
    expect(el.getAttribute('tabindex')).toBe('-1')
    expect(el.textContent).toBe(title)        // its accessible name: read once, on focus
    expect(journalPageTitle(to)).toBe(title)
  })

  it('pressing Enter on a Journal tab moves focus off the tab and onto the page target', async () => {
    renderAt('/journal')
    await settle()
    const tab = screen.getAllByRole('link', { name: /Trades/ })[0]
    tab.focus()
    fireEvent.click(tab)
    await settle()
    expect(screen.getByTestId('trades')).toBeTruthy()
    expect(document.activeElement).toBe(target())
  })

  it('arriving in the Journal from another page lands on the target too', async () => {
    renderAt('/elsewhere')
    fireEvent.click(screen.getByRole('link', { name: 'to trades' }))
    await settle()
    expect(document.activeElement).toBe(target())
  })

  it('the next Tab stop after the target is inside the page, past the Journal header', async () => {
    renderAt('/journal')
    await settle()
    await go('/journal/trades')
    const el = target()
    const page = screen.getByTestId('trades')
    // the target sits directly before the page in document order, after every header control
    expect(el.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const header = screen.getByRole('button', { name: 'Show keyboard shortcuts' })
    expect(header.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('focusing the target does not scroll', async () => {
    renderAt('/journal')
    await settle()
    const spy = vi.spyOn(HTMLElement.prototype, 'focus')
    await go('/journal/trades')
    const call = spy.mock.calls.find((c, i) => spy.mock.instances[i] === target())
    expect(call?.[0]).toEqual({ preventScroll: true })
    spy.mockRestore()
  })

  it('a standalone Journal page (outside the layout) lands on its own target', async () => {
    renderAt('/journal')
    await settle()
    await go('/journal-2-0/playbook')
    expect(document.activeElement).toBe(target())
    expect(target().textContent).toBe('My Playbook')
  })
})

describe('Journal routes: focus is left alone when something else owns it', () => {
  it('a fresh page load leaves focus on <body> (the skip link stays the first Tab stop)', async () => {
    renderAt('/journal/trades')
    await settle()
    expect(document.activeElement).toBe(document.body)
  })

  it('a query-only change does not move focus (opening a note, a segment, a filter)', async () => {
    renderAt('/journal/notebook')
    await settle()
    const btn = screen.getByRole('button', { name: 'first control on notebook' })
    btn.focus()
    await go('/journal/notebook?note=abc')
    expect(document.activeElement).toBe(btn)
  })

  it('a hash-only change does not move focus (a skip link)', async () => {
    renderAt('/journal/notebook')
    await settle()
    const btn = screen.getByRole('button', { name: 'first control on notebook' })
    btn.focus()
    await go('/journal/notebook#notes')
    expect(document.activeElement).toBe(btn)
  })

  it('Back does not move focus (the browser restores the place)', async () => {
    renderAt('/journal')
    await settle()
    await go('/journal/trades')
    const btn = screen.getByRole('button', { name: 'first control on trades' })
    btn.focus()
    await go(-1)
    expect(screen.getByTestId('today')).toBeTruthy()
    expect(document.activeElement).not.toBe(target())
  })

  it('a navigation that opens its own dialog keeps the dialog\'s focus', async () => {
    renderAt('/journal')
    await settle()
    await go('/journal/community')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'inside the dialog' })))
  })

  it('a tour step that changes the route keeps its own focus', async () => {
    renderAt('/journal')
    await settle()
    // the tour card: a modal dialog that lives outside the route tree and holds focus across steps
    const tour = document.createElement('div')
    tour.setAttribute('role', 'dialog')
    tour.setAttribute('aria-modal', 'true')
    tour.innerHTML = '<button type="button">Next</button>'
    document.body.appendChild(tour)
    const next = tour.querySelector('button')
    next.focus()
    await go('/journal/insights')
    expect(document.activeElement).toBe(next)
    tour.remove()
  })

  it('a caller can opt out with state.keepFocus', async () => {
    renderAt('/journal')
    await settle()
    const btn = screen.getByRole('button', { name: 'first control on today' })
    btn.focus()
    await go('/journal/trades', { state: { keepFocus: true } })
    expect(document.activeElement).not.toBe(target())
  })
})
