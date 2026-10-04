// Wave 14 lane W14-A: the redesigned first-run welcome (plan 4.1, default D1).
//
//   * today's first-run buttons stay, in today's order, under the same tour anchor;
//   * a short text preview lists only the capabilities armed for this member;
//   * the sample notebook is promoted beside it, and only while its button is on screen;
//   * W14-D's "get started" checklist has ONE mount line, rendered in every Home state.
//
// ⛔ Copy contract: rendered text, never state.
// ⛔ The preview is a LAZY chunk, so every absence below is asserted only after something
//    proves the chunk has rendered (its list, or its promotion) -- never against a page that
//    simply has not loaded it yet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
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
// Integration ruling (wave 14): the preview and the promotion ride the checklist's gate,
// so "on" means BOTH flags (gettingStartedPref.checklistEnabled).
const WELCOME_ON = Object.freeze({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })

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
    latchNotebookFlags(WELCOME_ON)
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
  it('names only the capabilities armed for this member', async () => {
    latchNotebookFlags({
      ...WELCOME_ON,
      notebook_chart_plan_enabled: true,
      notebook_earnings_prep_enabled: true,
      notebook_playbook_enabled: false,
    })
    renderHome()
    const list = await screen.findByRole('list', { name: PREVIEW_COPY.heading })
    const text = list.textContent
    expect(text).toContain(byFlag('notebook_chart_plan_enabled').line)
    expect(text).toContain(byFlag('notebook_earnings_prep_enabled').line)
    expect(text).not.toContain(byFlag('notebook_playbook_enabled').label)
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('nothing armed: no preview list, the welcome reads as it did before', async () => {
    latchNotebookFlags(WELCOME_ON)
    renderHome()
    // the chunk HAS rendered (its promotion is there), and it rendered no list
    expect(await screen.findByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: PREVIEW_COPY.heading })).toBeNull()
  })

  it('the onboarding flag off: no preview and no promotion, whatever else is armed', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: false, notebook_getting_started_enabled: true, notebook_plan_grading_enabled: true })
    // ⛔ Preload the chunk's module, so a preview rendered by mistake would land within the
    // wait below (mutation M1 proves this test can see it).
    await import('./onboarding/CapabilityPreview')
    renderHome()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.getByRole('button', { name: 'Start a note' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: PREVIEW_COPY.heading })).toBeNull()
    expect(screen.queryByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeNull()
  })

  it('is not on the Home a member with notes sees', async () => {
    latchNotebookFlags({ ...WELCOME_ON, notebook_plan_grading_enabled: true })
    await import('./onboarding/CapabilityPreview')
    renderHome({ hasAnyNotes: true })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: PREVIEW_COPY.heading })).toBeNull()
  })
})

describe('first-run welcome -- the sample notebook promotion', () => {
  it('a paid member with no sample: the promotion describes the sample button', async () => {
    latchNotebookFlags(WELCOME_ON)
    renderHome()
    await screen.findByText(PREVIEW_COPY.sampleTail, { exact: false })
    const add = screen.getByRole('button', { name: SAMPLE_COPY.add })
    const id = add.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    const promo = document.getElementById(id)
    expect(promo).toHaveTextContent(
      `${PREVIEW_COPY.sampleLead} ${PREVIEW_COPY.sampleButton} ${PREVIEW_COPY.sampleTail}`)
  })

  it('an unpaid member: no button, so no promotion of it', async () => {
    latchNotebookFlags({ ...WELCOME_ON, notebook_plan_grading_enabled: true })
    renderHome({ paid: false })
    await screen.findByRole('list', { name: PREVIEW_COPY.heading })   // the chunk has rendered
    expect(screen.queryByRole('button', { name: SAMPLE_COPY.add })).toBeNull()
    expect(screen.queryByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeNull()
  })

  it('a member who already had the sample: no button, so no promotion of it', async () => {
    latchNotebookFlags({ ...WELCOME_ON, notebook_plan_grading_enabled: true })
    renderHome({ prefs: { notebook_sample: JSON.stringify({ v: 1, ids: ['w1'], at: 'x' }) } })
    await screen.findByRole('list', { name: PREVIEW_COPY.heading })   // the chunk has rendered
    // the preference arrives asynchronously; once it has, the button (and the promotion) go
    await screen.findByRole('button', { name: SAMPLE_COPY.tour })
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: SAMPLE_COPY.add })).toBeNull())
    expect(screen.queryByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeNull()
  })
})

describe('integration gate -- the welcome extras ride the checklist gate (not live on merge)', () => {
  // Every capability armed, so a preview rendered by mistake would have lines to show.
  const ALL_ARMED = Object.fromEntries(CAPABILITY_PREVIEW.map((c) => [c.flag, true]))

  it('onboarding on, getting-started off: the pre-wave-14 first-run screen', async () => {
    latchNotebookFlags({ ...ALL_ARMED, notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    // Preload the chunk so a preview rendered by mistake would land within the wait below.
    await import('./onboarding/CapabilityPreview')
    const { container } = renderHome()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    // today's doors are all there (the sample and tour doors ride onboarding, as before W14)
    const row = container.querySelector('[data-tour="first-run"]')
    expect(within(row).getAllByRole('button').map((b) => b.textContent.trim())).toEqual([
      'Start a note', 'Create a thesis', 'Import notes', 'Today', SAMPLE_COPY.add, SAMPLE_COPY.tour,
    ])
    // ... and nothing wave 14 added
    expect(screen.queryByRole('list', { name: PREVIEW_COPY.heading })).toBeNull()
    expect(screen.queryByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull()
    expect(screen.getByRole('button', { name: SAMPLE_COPY.add }).hasAttribute('aria-describedby')).toBe(false)
    // the first-run screen's children are exactly the pre-wave-14 ones: title, hint, door row
    const firstRun = container.querySelector('[data-tour="first-run"]').parentElement
    expect([...firstRun.children].map((el) => el.tagName)).toEqual(['H2', 'P', 'DIV'])
  })

  it('both flags on: the preview, the promotion and the checklist all render', async () => {
    latchNotebookFlags({ ...ALL_ARMED, ...WELCOME_ON })
    renderHome()
    const list = await screen.findByRole('list', { name: PREVIEW_COPY.heading })
    expect(within(list).getAllByRole('listitem')).toHaveLength(CAPABILITY_PREVIEW.length)
    expect(screen.getByText(PREVIEW_COPY.sampleTail, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SAMPLE_COPY.add }).getAttribute('aria-describedby')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument()
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
