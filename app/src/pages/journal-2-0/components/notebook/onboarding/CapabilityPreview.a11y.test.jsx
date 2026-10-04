// The capability preview through 8A's axe harness (wave 14, lane W14-A) -- its own rail,
// never inherited from Research Home's (plan 5.4, risk R9). Two states: on its own (every
// line armed, with the sample promotion), and inside the real first-run screen, where the
// sample button points at the promotion through aria-describedby.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import CapabilityPreview from './CapabilityPreview'
import ResearchHome from '../ResearchHome'
import { CAPABILITY_PREVIEW } from './capabilityList'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { expectNoAxeViolations } from '../../../a11y/axeHarness'

vi.mock('../../../hooks/useNotebookHome', () => ({
  default: () => ({ home: { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }, isLoading: false }),
}))

const ALL_ON = Object.fromEntries(CAPABILITY_PREVIEW.map((c) => [c.flag, true]))

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ ...ALL_ON, notebook_onboarding_enabled: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('CapabilityPreview -- axe', () => {
  it('every line armed, with the sample promotion: zero violations', async () => {
    const { container } = render(<main><CapabilityPreview canAddSample promoId="p1" /></main>)
    expect(screen.getAllByRole('listitem')).toHaveLength(CAPABILITY_PREVIEW.length)
    await expectNoAxeViolations(container)
  })

  it('inside the first-run welcome: zero violations', async () => {
    const { container } = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AuthContext.Provider value={{ isPaid: true }}>
          <MemoryRouter>
            <main>
              <ResearchHome hasAnyNotes={false} onOpenNote={vi.fn()} onCreateNote={vi.fn()}
                onCreateThesis={vi.fn()} onImport={vi.fn()} onOpenToday={vi.fn()} />
            </main>
          </MemoryRouter>
        </AuthContext.Provider>
      </SWRConfig>,
    )
    const add = screen.getByRole('button', { name: 'Add a sample notebook' })
    expect(add).toHaveAccessibleDescription(/remove them/i)
    await expectNoAxeViolations(container)
  })
})
