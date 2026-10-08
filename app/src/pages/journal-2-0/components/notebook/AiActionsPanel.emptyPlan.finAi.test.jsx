// Finish program, lane AI-FE, K4. The keyed walk: a request the model planned as ZERO changes
// showed "Review 0 proposed changes", the line "Uncheck anything you don't want", and a
// (disabled) "Apply 0 changes" button. There is nothing to review and nothing to apply.
//
// Here: an empty plan is a plain message. The heading says nothing will change, the model's
// own explanation is shown as text, anything the plan skipped is still listed with its reason,
// and the only way on is back to the request, which is kept so it can be reworded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'

vi.mock('../../lib/offline/settleNoteWrite', () => ({
  settleNoteWrite: vi.fn(async () => null),
  settleNoteWrites: vi.fn(async (revs) => revs || []),
}))

import AiActionsBox from './AiActionsPanel'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

const WHY = 'The tag "security" doesn\'t exist in the workspace\'s allowed tag list, so no changes are proposed.'
const EMPTY = {
  id: 'set0empty000', request: 'Tag my two CRWD notes with "security".', status: 'planned',
  summary: WHY, capped: null, skippedCount: 0, skipped: [], changes: [],
}
const ONE = {
  ...EMPTY, id: 'set1one00000', summary: 'Tag one note.',
  changes: [{ id: 'c1', noteId: 'nA', noteTitle: 'CRWD plan', op: 'add_tag', label: 'Add tag “security”', before: '(no tags)', after: 'security', status: 'planned', ai: true }],
}

let planBody
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

async function plan(user, text = EMPTY.request) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AiActionsBox />
    </SWRConfig>,
  )
  await user.click(screen.getByRole('button', { name: 'Ask Notebook to do something' }))
  await user.type(screen.getByRole('textbox', { name: 'What should Notebook do?' }), text)
  await user.click(screen.getByRole('button', { name: 'Plan changes' }))
}

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ai_actions_enabled: true })
  planBody = EMPTY
  global.fetch = vi.fn(async (url) => (url === '/api/j2/ai-actions/plan' ? json(200, planBody) : json(404, {})))
})
afterEach(() => { __resetNotebookFlags() })

describe('AI actions: a plan with no changes is a message, not a review', () => {
  it('shows the model’s explanation as text, with no Apply button and no "0 changes"', async () => {
    const user = userEvent.setup()
    await plan(user)
    const heading = await screen.findByRole('heading', { name: 'Nothing to change' })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText(WHY)).toBeTruthy()
    expect(screen.getByText(/You asked: “Tag my two CRWD notes with "security"\.”/)).toBeTruthy()
    expect(screen.getByText('Nothing was written.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Review/ })).toBeNull()
    expect(document.body.textContent).not.toMatch(/0 (proposed )?changes/)
    expect(document.body.textContent).not.toContain('Uncheck anything')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('with no explanation from the model it says so in the product’s own words', async () => {
    planBody = { ...EMPTY, summary: '' }
    const user = userEvent.setup()
    await plan(user)
    await screen.findByRole('heading', { name: 'Nothing to change' })
    expect(screen.getByText('Notebook found nothing to change for that request.')).toBeTruthy()
  })

  it('what the plan skipped is still listed with its reason', async () => {
    planBody = { ...EMPTY, skippedCount: 1, skipped: [{ noteTitle: 'CRWD plan', op: 'add_tag', reason: '“CRWD plan” already has the tag security.' }] }
    const user = userEvent.setup()
    await plan(user)
    await screen.findByRole('heading', { name: 'Nothing to change' })
    expect(screen.getByText('“CRWD plan” already has the tag security.')).toBeTruthy()
  })

  it('"Change the request" goes back to the box with the words still in it', async () => {
    const user = userEvent.setup()
    await plan(user)
    await screen.findByRole('heading', { name: 'Nothing to change' })
    await user.click(screen.getByRole('button', { name: 'Change the request' }))
    const box = screen.getByRole('textbox', { name: 'What should Notebook do?' })
    expect(box.value).toBe(EMPTY.request)
    expect(screen.queryByRole('heading', { name: 'Nothing to change' })).toBeNull()
  })

  it('control: a plan with one change is still a review with its Apply button', async () => {
    planBody = ONE
    const user = userEvent.setup()
    await plan(user)
    await screen.findByRole('heading', { name: 'Review 1 proposed change' })
    expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Nothing to change' })).toBeNull()
  })

  it('control: a review with everything unchecked keeps its (disabled) Apply button', async () => {
    planBody = ONE
    const user = userEvent.setup()
    await plan(user)
    await screen.findByRole('heading', { name: 'Review 1 proposed change' })
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Apply 0 changes' }).disabled).toBe(true)
  })
})
