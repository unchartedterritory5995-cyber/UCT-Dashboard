// Go-live wave 1 (A6): "What your Notebook can do" is a plain section on Help, beside the Notebook walkthroughs. One
// line per capability ARMED for this member, no sample promotion, nothing to press; with the wave-14 switch off, or
// nothing armed, it is not drawn at all.
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { NotebookCapabilitiesSection } from './Support'
import { CAPABILITY_PREVIEW, PREVIEW_COPY } from './journal-2-0/components/notebook/onboarding/capabilityList'
import { __resetNotebookFlags, latchNotebookFlags } from './journal-2-0/lib/offline/notebookFlags'

afterEach(() => { cleanup(); __resetNotebookFlags() })
const SWITCH = { notebook_onboarding_enabled: true, notebook_getting_started_enabled: true }
const renderSection = () => render(<MemoryRouter><NotebookCapabilitiesSection /></MemoryRouter>)
const byId = (id) => CAPABILITY_PREVIEW.find((c) => c.id === id)

describe('Help: What your Notebook can do', () => {
  it('lists exactly the armed capabilities, one line each, under its heading', () => {
    latchNotebookFlags({ ...SWITCH, notebook_chart_plan_enabled: true, notebook_review_drafts_enabled: true })
    renderSection()
    const section = screen.getByRole('region', { name: PREVIEW_COPY.heading })
    const items = within(section).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      `${byId('chart-plan').label}. ${byId('chart-plan').line}`,
      `${byId('review-drafts').label}. ${byId('review-drafts').line}`,
    ])
    // No promotion and nothing to press.
    expect(within(section).queryByRole('button')).toBeNull()
    expect(section.textContent).not.toContain(PREVIEW_COPY.sampleLead)
  })

  it('nothing armed: not drawn', () => {
    latchNotebookFlags(SWITCH)
    renderSection()
    expect(screen.queryByText(PREVIEW_COPY.heading)).toBeNull()
  })

  it('the wave-14 switch off: not drawn, even with capabilities armed', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_chart_plan_enabled: true })
    renderSection()
    expect(screen.queryByText(PREVIEW_COPY.heading)).toBeNull()
  })
})
