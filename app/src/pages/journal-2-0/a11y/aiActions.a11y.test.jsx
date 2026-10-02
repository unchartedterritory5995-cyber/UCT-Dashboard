// app/src/pages/journal-2-0/a11y/aiActions.a11y.test.jsx
//
// Wave 11 lane 11C ("Ask Notebook to do something") through 8A's axe harness, in each state a
// member reaches: the request box, the review list (grouped by note, a checkbox per change, the
// skipped list), the applied view with a partial-failure list, and a note's history listing the
// AI change set with its Undo. Each recipe proves its state rendered before axe runs.
import { describe, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import AiActionsBox from '../components/notebook/AiActionsPanel'
import AiChangeSetHistory from '../components/notebook/AiChangeSetHistory'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

const SET = {
  id: 'set12345', request: 'tag every NVDA earnings note', status: 'planned', summary: 'Two notes.',
  capped: { limit: 200, dropped: 3 }, skippedCount: 1,
  skipped: [{ noteTitle: 'Old note', op: 'delete_note', reason: "Notebook AI can't do that." }],
  changes: [
    { id: 'c1', noteId: 'nA', noteTitle: 'NVDA thesis', op: 'add_tag', label: 'Add tag “earnings-nvda”', before: 'semis', after: 'semis, earnings-nvda', status: 'planned' },
    { id: 'c2', noteId: 'nB', noteTitle: 'Semis basket', op: 'append', kind: 'task', label: 'Add a task at the end', before: '…', after: '☐ Check the print', status: 'planned' },
  ],
}

describe('lane 11C surfaces', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ai_actions_enabled: true })
    installFetch([
      [/^\/api\/j2\/ai-actions\/plan$/, SET],
      [/^\/api\/j2\/ai-actions\/set12345\/apply$/, (url) => ({ results: [
        { id: 'c1', noteId: 'nA', status: 'applied', updatedAt: 'r1' },
        { id: 'c2', noteId: 'nB', status: 'conflict', message: 'This note changed after you reviewed the plan, so this change was skipped.' },
      ], revisions: [] })],
      [/^\/api\/j2\/ai-actions$/, { changeSets: [{ id: 'csA', request: 'tag my notes', status: 'applied',
        createdAt: '2026-10-01T14:00:00Z', appliedAt: '2026-10-01T14:01:00Z', appliedChanges: 2 }] }],
    ])
  })
  afterEach(() => __resetNotebookFlags())

  const box = () => render(<Providers><AiActionsBox /></Providers>)
  const plan = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ask Notebook to do something' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What should Notebook do?' }), { target: { value: 'tag NVDA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plan changes' }))
    await screen.findByRole('heading', { name: 'Review 2 proposed changes' })
  }

  axeSurface('ai-actions-request', async () => {
    box()
    fireEvent.click(screen.getByRole('button', { name: 'Ask Notebook to do something' }))
    screen.getByRole('textbox', { name: 'What should Notebook do?' })
    await settle()
  })

  axeSurface('ai-actions-review', async () => {
    box()
    await plan()
    screen.getByRole('checkbox', { name: 'Add a task at the end' })
    screen.getByRole('button', { name: 'Apply 2 changes' })
    await settle()
  })

  axeSurface('ai-actions-applied', async () => {
    box()
    await plan()
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 changes' }))
    await screen.findByRole('heading', { name: 'AI change set applied' })
    screen.getByRole('list', { name: 'Changes that were not applied' })
    screen.getByRole('button', { name: 'Undo this change set' })
    await settle()
  })

  axeSurface('ai-change-set-history', async () => {
    render(<Providers><AiChangeSetHistory noteId="nA" open /></Providers>)
    await screen.findByRole('button', { name: 'Undo AI change set “tag my notes”' })
    await settle()
  })
})
