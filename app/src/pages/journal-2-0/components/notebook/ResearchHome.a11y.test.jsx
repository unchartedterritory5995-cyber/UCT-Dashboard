// Research Home through 8A's axe harness (wave 8, lane 8C, C3) -- the rail file
// a11y/notebookSurfaces.js names for this surface. Harness: a11y/axeHarness.js
// (`expectNoAxeViolations`, component level). Three states: the first-run screen with the
// two new doors, the same screen after a refused sample (its alert), and the home with the
// sample strip.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { SAMPLE_URL } from './onboarding/sampleNotebook'
import { expectNoAxeViolations } from '../../a11y/axeHarness'

vi.mock('../../hooks/useNotebookHome', () => ({
  default: () => ({ home: { continueWorking: [{ id: 'n1', title: 'A note', updatedAt: '2026-09-26T00:00:00Z' }],
    favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }, isLoading: false }),
}))
vi.mock('./AskPanel', () => ({ default: () => <div>ask</div> }))

const IDS = ['w1', 'r1']
const ok = (body) => ({ ok: true, status: 200, json: async () => body })

function renderHome(hasAnyNotes) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter>
          <ResearchHome hasAnyNotes={hasAnyNotes} onOpenNote={vi.fn()} onCreateNote={vi.fn()}
            onCreateThesis={vi.fn()} onImport={vi.fn()} />
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences') {
      return ok(method === 'GET' ? { notebook_sample: JSON.stringify({ v: 1, ids: IDS, at: 'x' }) } : {})
    }
    if (url === SAMPLE_URL && method === 'GET') return ok({ ids: IDS, activeIds: IDS })
    if (url === SAMPLE_URL && method === 'POST') {
      return { ok: false, status: 409, json: async () => ({ detail: "You already have notes, so we didn't add the sample. You can import notes instead." }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('ResearchHome -- axe', () => {
  it('the first-run screen with the sample and tour doors: zero violations', async () => {
    global.fetch = vi.fn(async () => ok({}))
    const { container } = renderHome(false)
    expect(screen.getByRole('button', { name: 'Add a sample notebook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take the tour' })).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('the refused sentence: zero violations', async () => {
    global.fetch = vi.fn(async (url, init = {}) => ((init.method || 'GET') === 'POST'
      ? { ok: false, status: 409, json: async () => ({ detail: "You already have notes, so we didn't add the sample. You can import notes instead." }) }
      : ok({})))
    const { container } = renderHome(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add a sample notebook' }))
    await screen.findByRole('alert')
    await expectNoAxeViolations(container)
  })

  it('the home with the sample strip: zero violations', async () => {
    const { container } = renderHome(true)
    await screen.findByRole('button', { name: 'Remove it' })
    await expectNoAxeViolations(container)
  })
})
