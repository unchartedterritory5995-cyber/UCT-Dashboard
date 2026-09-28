// app/src/components/Layout.skipLink.test.jsx
//
// F4 / A2R-01 (WCAG 2.4.1, Bypass Blocks). Lane 10E-2's keyboard walk found the app's first
// Tab stop was the logo and the Notebook's own skip link was the 36th: a keyboard member walked
// past 22 sidebar links and the Journal's header on every page load.
//
// The rail walks the RENDERED shell with the keyboard (user-event's Tab and Enter, never a
// click): the first stop is "Skip to main content", Enter puts focus on <main>, and a page's
// own skip link -- the real NotebookTab's -- is the SECOND stop.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test-utils'
import Layout from './Layout'
import { SkipLinkPortal, MAIN_CONTENT_ID } from './skipLinks'
import { installFetch, latchWave8Flags, Providers } from '../pages/journal-2-0/a11y/fixtures'
import NotebookTab from '../pages/journal-2-0/tabs/NotebookTab'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

describe('the app shell skip link (A2R-01)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('is the first focusable element in the shell, before the nav', () => {
    renderWithProviders(<Layout><button type="button">Page control</button></Layout>)
    const first = document.querySelector(FOCUSABLE)
    expect(first.textContent.trim()).toBe('Skip to main content')
    expect(first.getAttribute('href')).toBe(`#${MAIN_CONTENT_ID}`)
    // non-vacuity: the nav's own links are there, and after it
    const nav = screen.getByTestId('nav-sidebar')
    expect(nav.querySelector(FOCUSABLE)).not.toBeNull()
    expect(first.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Tab from the top reaches it first, and Enter puts focus on <main>', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Layout><button type="button">Page control</button></Layout>)
    await user.tab()
    const skip = document.activeElement
    expect(skip.textContent.trim()).toBe('Skip to main content')
    await user.keyboard('{Enter}')
    const main = document.getElementById(MAIN_CONTENT_ID)
    expect(main.tagName).toBe('MAIN')
    expect(document.activeElement).toBe(main)
    // <main> takes focus only programmatically: it is never a Tab stop of its own
    expect(main.tabIndex).toBe(-1)
    // and the next Tab goes INTO the page, past the whole nav
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Page control' }))
  })

  it('a page skip link rendered through SkipLinkPortal is the SECOND stop', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Layout>
        <SkipLinkPortal><a href="#page-target">Skip to the page list</a></SkipLinkPortal>
        <button type="button">Page control</button>
      </Layout>,
    )
    await user.tab()
    expect(document.activeElement.textContent.trim()).toBe('Skip to main content')
    await user.tab()
    expect(document.activeElement.textContent.trim()).toBe('Skip to the page list')
  })

  it('rendered alone, a page skip link stays where the page put it', () => {
    render(<div data-testid="page"><SkipLinkPortal><a href="#x">Skip here</a></SkipLinkPortal></div>)
    expect(screen.getByTestId('page').querySelector('a').textContent).toBe('Skip here')
  })
})

describe('on the Notebook, inside the shell (A2R-01)', () => {
  beforeEach(() => { document.body.innerHTML = ''; installFetch(); latchWave8Flags(true) })

  it('the Notebook skip link is the second Tab stop, and it still moves focus to the list', async () => {
    const user = userEvent.setup()
    render(
      <Providers route="/journal/notebook?folder=f1">
        <Layout><NotebookTab /></Layout>
      </Providers>,
    )
    await screen.findAllByText('Theses')
    await waitFor(() => expect(document.querySelectorAll('[data-note-card-id]').length).toBeGreaterThan(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    await user.tab()
    expect(document.activeElement.textContent.trim()).toBe('Skip to main content')
    await user.tab()
    const nbSkip = document.activeElement
    expect(nbSkip.textContent.trim()).toBe('Skip to notes list')
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Notes in this folder' }))
  }, 30000)
})
