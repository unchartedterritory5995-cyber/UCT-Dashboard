// /support with the Notebook help articles, through 8A's axe harness (wave 8, lane 8C, C1) --
// the rail file a11y/notebookSurfaces.js names for this surface. Every Notebook article is
// expanded in turn (Quick answers opens one at a time) and the page is audited with each one
// open, gated articles included (their flags latched on).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Support, { FAQS } from './Support'
import { AuthContext } from '../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from './journal-2-0/lib/offline/notebookFlags'
import { expectNoAxeViolations } from './journal-2-0/a11y/axeHarness'

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ j2_share_links_enabled: true, notebook_publish_enabled: true, notebook_onboarding_enabled: true })
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/auth/faq-votes') return { ok: true, json: async () => ({ votes: [] }) }
    if (url === '/api/auth/tickets') return { ok: true, json: async () => [] }
    if (url === '/api/support/status') return { ok: true, json: async () => ({ status: 'operational', components: [] }) }
    return { ok: false, json: async () => ({}) }
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('Support with the Notebook articles -- axe', () => {
  it('zero violations with each Notebook article expanded', async () => {
    const { container } = render(
      <AuthContext.Provider value={{ user: { id: 'u1', email: 'm@local.dev' }, plan: 'pro', isPaid: true }}>
        <MemoryRouter initialEntries={[{ pathname: '/support', state: { from: '/journal/notebook' } }]}>
          <Support />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    const notebook = FAQS.filter((f) => f.topic === 'notebook')
    expect(notebook.length).toBeGreaterThanOrEqual(12)       // non-vacuity: the articles exist
    for (const f of notebook) {
      const q = await screen.findByRole('button', { name: f.q })
      fireEvent.click(q)
      expect(q).toHaveAttribute('aria-expanded', 'true')
      await expectNoAxeViolations(container)
    }
  }, 60_000)
})
