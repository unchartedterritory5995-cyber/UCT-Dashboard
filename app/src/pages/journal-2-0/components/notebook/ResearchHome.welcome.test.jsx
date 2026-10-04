// Wave 14 lane W14-A: the redesigned first-run welcome (plan 4.1, default D1).
//
//   * today's first-run buttons stay, in today's order, under the same tour anchor;
//   * a short text preview lists only the capabilities armed for this member;
//   * the sample notebook is promoted beside it, and only while its button is on screen;
//   * W14-D's "get started" checklist has ONE mount line, rendered in every Home state.
//
// ⛔ Copy contract: rendered text, never state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let homeData = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
vi.mock('../../hooks/useNotebookHome', () => ({
  default: () => ({ home: homeData, isLoading: false }),
}))
vi.mock('./AskPanel', () => ({ default: () => <div>ask</div> }))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { CAPABILITY_PREVIEW, PREVIEW_COPY } from './onboarding/capabilityList'
import { SAMPLE_COPY } from './onboarding/sampleNotebook'
import { J2_DIR } from '../../a11y/population'

const byFlag = (flag) => CAPABILITY_PREVIEW.find((c) => c.flag === flag)

function renderHome({ paid = true, hasAnyNotes = false, prefs = {} } = {}) {
  global.fetch = vi.fn(async (url) => ({
    ok: true, status: 200, json: async () => (url === '/api/auth/preferences' ? prefs : {}),
  }))
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: paid }}>
        <MemoryRouter>
          <ResearchHome hasAnyNotes={hasAnyNotes} onOpenNote={vi.fn()} onCreateNote={vi.fn()}
            onCreateThesis={vi.fn()} onImport={vi.fn()} onOpenToday={vi.fn()} />
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  homeData = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('first-run welcome -- the buttons members already know (D1)', () => {
  it('keeps every first-run button, in today\'s order, inside the tour anchor', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    const { container } = renderHome()
    const row = container.querySelector('[data-tour="first-run"]')
    expect(row).not.toBeNull()
    const names = within(row).getAllByRole('button').map((b) => b.textContent.trim())
    expect(names).toEqual([
      'Start a note', 'Create a thesis', 'Import notes', 'Today', SAMPLE_COPY.add, SAMPLE_COPY.tour,
    ])
  })

  it('the title and hint are unchanged', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: 'Welcome to your Notebook' })).toBeInTheDocument()
    expect(screen.getByText(/This is where your research lives/)).toBeInTheDocument()
  })
})

describe('first-run welcome -- the capability preview', () => {
  it('names only the capabilities armed for this member', () => {
    latchNotebookFlags({
      notebook_onboarding_enabled: true,
      notebook_chart_plan_enabled: true,
      notebook_earnings_prep_enabled: true,
      notebook_playbook_enabled: false,
    })
    renderHome()
    const list = screen.getByRole('list', { name: PREVIEW_COPY.heading })
    const text = list.textContent
    expect(text).toContain(byFlag('notebook_chart_plan_enabled').line)
    expect(text).toContain(byFlag('notebook_earnings_prep_enabled').line)
    expect(text).not.toContain(byFlag('notebook_playbook_enabled').label)
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('nothing armed: no preview list, the welcome reads as it did before', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    renderHome()
    expect(screen.queryByRole('list', { name: PREVIEW_COPY.heading })).toBeNull()
  })

  it('the onboarding flag off: no preview and no promotion, whatever else is armed', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: false, notebook_plan_grading_enabled: true })
    renderHome()
    expect(screen.queryByRole('list', { name: PREVIEW_COPY.heading })).toBeNull()
    expect(screen.queryByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeNull()
  })

  it('is not on the Home a member with notes sees', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_plan_grading_enabled: true })
    renderHome({ hasAnyNotes: true })
    expect(screen.queryByRole('list', { name: PREVIEW_COPY.heading })).toBeNull()
  })
})

describe('first-run welcome -- the sample notebook promotion', () => {
  it('a paid member with no sample: the promotion describes the sample button', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    renderHome()
    const add = screen.getByRole('button', { name: SAMPLE_COPY.add })
    const id = add.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    const promo = document.getElementById(id)
    expect(promo).toHaveTextContent(
      `${PREVIEW_COPY.sampleLead} ${PREVIEW_COPY.sampleButton} ${PREVIEW_COPY.sampleTail}`)
  })

  it('an unpaid member: no button, so no promotion of it', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    renderHome({ paid: false })
    expect(screen.queryByRole('button', { name: SAMPLE_COPY.add })).toBeNull()
    expect(screen.queryByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeNull()
  })

  it('a member who already had the sample: no button, so no promotion of it', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    renderHome({ prefs: { notebook_sample: JSON.stringify({ v: 1, ids: ['w1'], at: 'x' }) } })
    // the preference arrives asynchronously; once it has, the button (and the promotion) go
    await screen.findByRole('button', { name: SAMPLE_COPY.tour })
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: SAMPLE_COPY.add })).toBeNull())
    expect(screen.queryByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeNull()
  })
})

describe('W14-D mount point -- one line, every state', () => {
  const src = readFileSync(join(J2_DIR, 'components', 'notebook', 'ResearchHome.jsx'), 'utf8')

  it('exactly one assignment line, marked for W14-D', () => {
    const lines = src.split(/\r?\n/).filter((l) => /^\s*const gettingStartedSlot = /.test(l))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/W14-D/)
  })

  it('rendered in the first-run screen and in all three Home returns', () => {
    const uses = src.match(/\{gettingStartedSlot\}/g) || []
    expect(uses).toHaveLength(4)
  })
})
