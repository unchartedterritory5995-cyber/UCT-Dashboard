// Final fix (C4): the empty list's standalone "Add a sample notebook" is not drawn while the get-started card is up
// with its sample step not yet done (that step is the door then); it is drawn when the card is hidden, closed, absent
// or could not load, and once the sample step is done. The real gate (makeChecklistGate) and the real door, over a
// preferences stub; the card's own chunk is a stand-in (the list's rules are railed in GettingStartedChecklist.test).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

vi.mock('../../../../../context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsPaid: () => true,
}))

import { makeChecklistGate } from '../GettingStartedChecklist'
import SampleNotebookDoor from './SampleNotebookDoor'
import { CHECKLIST_STATES, closedAs, withDone } from './gettingStartedPref'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'

const ADD = 'Add a sample notebook'
let prefs
beforeEach(() => {
  prefs = {}
  global.fetch = vi.fn(async (url) => ({
    ok: true, status: 200, json: async () => (String(url) === '/api/auth/preferences' ? prefs : {}),
  }))
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_task_reminders_enabled: false })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

async function screenWith(load = async () => ({ default: () => <p>card</p> })) {
  const Gate = makeChecklistGate(load, 0)
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <SampleNotebookDoor add={vi.fn()} />
        <Gate hasAnyNotes={false} onCreateNote={vi.fn()} onAddSample={vi.fn()} />
      </MemoryRouter>
    </SWRConfig>,
  )
  await settle()
}

describe('the standalone sample button and the get-started card (C4)', () => {
  it('card up, its sample step not done: the button is not drawn (the step is the door)', async () => {
    await screenWith()
    expect(screen.getByText('card')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ADD })).toBeNull()
  })

  it('card hidden (closed by Hide): the button is drawn', async () => {
    prefs = { notebook_getting_started: closedAs(null, CHECKLIST_STATES.dismissed) }
    await screenWith()
    expect(screen.queryByText('card')).toBeNull()
    expect(screen.getByRole('button', { name: ADD })).toBeInTheDocument()
  })

  it('card chunk could not load (the boundary draws nothing): the button is drawn', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await screenWith(async () => { throw new Error('chunk gone') })
    await settle()
    expect(screen.queryByText('card')).toBeNull()
    expect(screen.getByRole('button', { name: ADD })).toBeInTheDocument()
  })

  it('card up but its sample step is done: the button is drawn', async () => {
    prefs = { notebook_getting_started: withDone(null, ['sample']) }
    await screenWith()
    expect(screen.getByText('card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ADD })).toBeInTheDocument()
  })

  it('CONTROL: no card at all (its switch off): the button is drawn', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    await screenWith()
    expect(screen.queryByText('card')).toBeNull()
    expect(screen.getByRole('button', { name: ADD })).toBeInTheDocument()
  })
})
