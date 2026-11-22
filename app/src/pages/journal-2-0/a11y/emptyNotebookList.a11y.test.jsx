// app/src/pages/journal-2-0/a11y/emptyNotebookList.a11y.test.jsx
//
// Go-live wave 1 (D7): the notes list with ZERO notes, through 8A's axe harness, like its neighbours. Since Notebook
// simplify Task 5 this is a member's first screen: the empty line, Import notes and the get-started list
// (GettingStartedChecklist, whose sample step is the sample door; final fix C4), above the template picker. Real children,
// only the network faked (fixtures.jsx). The recipe proves each of those rendered before axe runs, so an empty or wrong
// screen cannot pass as a clean one.
import { describe, beforeEach, afterEach, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AUTH, installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from '../tabs/NotebookTab'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const EMPTY_HOME = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }

describe('the empty notes list (zero notes): sample door and get-started list', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    // task reminders reads ON when a payload omits it (a kill switch): pinned OFF so the list's steps are fixed.
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_task_reminders_enabled: false })
    installFetch([
      [/mapping-offer$/, { offer: null }],
      [/^\/api\/j2\/notes\/folder-counts$/, { counts: {}, unfiled: 0, total: 0 }],
      [/^\/api\/j2\/notes\/favorites$/, { notes: [] }],
      [/^\/api\/j2\/notes\/recents$/, { notes: [] }],
      [/^\/api\/j2\/notes\/by-folders$/, { byFolder: {} }],
      [/^\/api\/j2\/notes$/, { notes: [], total: 0 }],
      [/^\/api\/j2\/note-folders$/, { folders: [] }],
      [/^\/api\/j2\/notebook\/home$/, EMPTY_HOME],
      [/^\/api\/auth\/preferences$/, {}],
    ])
  })
  afterEach(() => __resetNotebookFlags())

  axeSurface('tab-list-empty', async () => {
    render(<Providers auth={AUTH} route="/journal/notebook?view=all"><NotebookTab /></Providers>)
    await screen.findByText('Your notebook is empty.')
    expect(screen.getByRole('button', { name: /Import notes/ })).toBeInTheDocument()
    // Final fix (C5): the empty line, with no em dash.
    expect(screen.getByText('Start from a template, or a blank page.')).toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Get started' })
    // Final fix (C4): with the card up, its "Open the sample notebook" step is the sample door; the standalone
    // "Add a sample notebook" is not drawn beside it.
    await screen.findByRole('button', { name: 'Open the sample notebook' })
    await settle()
    expect(screen.queryByRole('button', { name: 'Add a sample notebook' })).toBeNull()
  }, { level: 'page' })
})
