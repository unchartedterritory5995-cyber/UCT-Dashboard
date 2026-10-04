// app/src/pages/journal-2-0/a11y/gettingStarted.a11y.test.jsx
//
// Wave 14 lane W14-D: the "get started" checklist through 8A's axe harness. Its own
// recipe, never inherited from Research Home's (plan 5.4 / risk R9). Each recipe proves
// its state rendered before axe runs, so an empty screen can never pass as a clean one:
//   * getting-started-checklist          -- first run: every step open, the sample offered;
//   * getting-started-checklist-progress -- two steps ticked (the done marks and their
//                                           screen-reader "Done"), one tour armed beyond
//                                           the base tour is not needed: the base tour's
//                                           own seen-state ticks it.
import { describe, beforeEach, afterEach, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import GettingStartedChecklist from '../components/notebook/GettingStartedChecklist'
import { WALKTHROUGH_TITLE } from '../lib/templateBlocks'

const EMPTY_HOME = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }

describe('lane W14-D surface (the get started checklist)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  axeSurface('getting-started-checklist', async () => {
    installFetch([
      [/^\/api\/auth\/preferences$/, {}],
      [/^\/api\/j2\/notebook\/home$/, EMPTY_HOME],
    ])
    render(
      <Providers>
        <GettingStartedChecklist hasAnyNotes={false} onCreateNote={() => {}} onAddSample={async () => {}} />
      </Providers>,
    )
    await screen.findByRole('heading', { name: 'Get started' })
    screen.getByRole('button', { name: 'Open the sample notebook' })
    screen.getByRole('button', { name: 'Hide the get started list' })
  })

  axeSurface('getting-started-checklist-progress', async () => {
    installFetch([
      [/^\/api\/auth\/preferences$/, { notebook_tour: JSON.stringify({ v: 1, state: 'done', step: 'export' }) }],
      [/^\/api\/j2\/notebook\/home$/, { ...EMPTY_HOME, continueWorking: [{ id: 'n1', title: 'Mine', bodyPlain: 'my words' }] }],
    ])
    render(
      <Providers>
        <GettingStartedChecklist hasAnyNotes onCreateNote={() => {}} onAddSample={null} />
      </Providers>,
    )
    await screen.findByText('2 of 3 done')
    expect(screen.getAllByText('Done')).toHaveLength(2)
    expect(WALKTHROUGH_TITLE).toBeTruthy()
  })
})
