// Wave 14, lane W14-keys: Help > Walkthroughs on keys (docs/notebook/wave14-keys.md).
//
// W14-Q1 measured "replay a walkthrough from Help" at 57 keys against a budget of 4. On Help
// itself the cost was the page above Walkthroughs; this rails the two doors added for it:
//   * "Skip to Walkthroughs", a skip link that lands on the Walkthroughs heading, whose next
//     Tab stop is the first Replay;
//   * `/support#walkthroughs` (the command palette's "Help: Walkthroughs" goes there) lands
//     focus on the same heading on arrival.
// Both exist only with the wave-14 switch on, like the section itself.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'
import Support from './Support'
import { AuthContext } from '../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from './journal-2-0/lib/offline/notebookFlags'
import { expectNoAxeViolations } from './journal-2-0/a11y/axeHarness'

const SWITCH_ON = { notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_task_reminders_enabled: false }

beforeEach(() => {
  __resetNotebookFlags()
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/auth/preferences') return { ok: true, json: async () => ({}) }
    if (url === '/api/auth/faq-votes') return { ok: true, json: async () => ({ votes: [] }) }
    if (url === '/api/auth/tickets') return { ok: true, json: async () => [] }
    if (url === '/api/support/status') return { ok: true, json: async () => ({ status: 'operational', components: [] }) }
    return { ok: false, json: async () => ({}) }
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

function renderSupport(entry = '/support') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ user: { id: 'u1', email: 'm@local.dev' }, plan: 'pro', isPaid: true }}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes><Route path="/support" element={<Support />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

const walkthroughs = () => screen.findByRole('heading', { level: 2, name: 'Walkthroughs' }, { timeout: 3000 })

describe('Help > Walkthroughs on keys (W14-keys)', () => {
  it('"Skip to Walkthroughs" lands on the Walkthroughs heading; the next Tab is the first Replay', async () => {
    latchNotebookFlags(SWITCH_ON)
    renderSupport()
    const heading = await walkthroughs()
    const link = screen.getByRole('link', { name: 'Skip to Walkthroughs' })
    expect(link).toHaveAttribute('href', '#walkthroughs')
    expect(heading.tabIndex).toBe(-1)
    fireEvent.click(link)
    expect(document.activeElement).toBe(heading)
    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toHaveTextContent('Replay')
    expect(document.activeElement.closest('li')).toHaveTextContent('Notebook basics')
  })

  it('arriving at /support#walkthroughs puts focus on the Walkthroughs heading', async () => {
    latchNotebookFlags(SWITCH_ON)
    renderSupport('/support#walkthroughs')
    const heading = await walkthroughs()
    expect(document.activeElement).toBe(heading)
  })

  it('a plain /support arrival moves no focus', async () => {
    latchNotebookFlags(SWITCH_ON)
    renderSupport()
    await walkthroughs()
    expect(document.activeElement).toBe(document.body)
  })

  it('switch off: no Walkthroughs, no skip link', async () => {
    latchNotebookFlags({ ...SWITCH_ON, notebook_getting_started_enabled: false })
    renderSupport('/support#walkthroughs')
    await screen.findByText('New Ticket', {}, { timeout: 3000 })
    expect(screen.queryByText('Walkthroughs')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Skip to Walkthroughs' })).toBeNull()
  })

  it('axe: 0 violations with the skip link and the Walkthroughs heading', async () => {
    latchNotebookFlags(SWITCH_ON)
    const { container } = renderSupport()
    await walkthroughs()
    screen.getByRole('link', { name: 'Skip to Walkthroughs' })
    await expectNoAxeViolations(container)
  }, 30000)
})
