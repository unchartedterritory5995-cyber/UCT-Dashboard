// Wave 11 lane 11C — "Ask Notebook to do something": the request box, the review list
// (grouped by note, before → after, a checkbox each), apply with progress and the
// partial-failure list, the one-click undo, hidden while the flag is off, and every step
// by keyboard with accessible names.
//
// ⛔ Every sentence is asserted as RENDERED TEXT. ⛔ Every request is read from
// `fetch.mock.calls`. ⛔ The settle (`settleNoteWrites`) is observed, not assumed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'

const settled = []
vi.mock('../../lib/offline/settleNoteWrite', () => ({
  settleNoteWrite: vi.fn(async () => null),
  settleNoteWrites: vi.fn(async (revs) => { settled.push(...(revs || [])); return revs || [] }),
}))
let unsent = new Set()
vi.mock('../../lib/noteBatch', async (importOriginal) => ({
  ...(await importOriginal()),
  checkUnsentWork: vi.fn(async (ids) => ({ unsent: new Set(ids.filter((i) => unsent.has(i))), unchecked: new Set() })),
}))

import AiActionsBox from './AiActionsPanel'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { BLOCKED_SENTENCE, UNSENT_BLOCK_SENTENCE } from '../../lib/aiActions'

const SET = {
  id: 'set12345abc',
  request: 'tag every note that mentions NVDA earnings with earnings-nvda',
  status: 'planned',
  summary: 'Tag two notes and add a line to one.',
  capped: null,
  skippedCount: 1,
  skipped: [{ noteTitle: 'Old note', op: 'delete_note', reason: "Notebook AI can't do that — it can only add or remove tags." }],
  changes: [
    { id: 'c1', noteId: 'nA', noteTitle: 'NVDA thesis', op: 'add_tag', label: 'Add tag “earnings-nvda”', before: 'semis', after: 'semis, earnings-nvda', status: 'planned', ai: true },
    { id: 'c2', noteId: 'nA', noteTitle: 'NVDA thesis', op: 'append', kind: 'text', label: 'Add a line at the end', before: '…Long into the print', after: 'Next earnings: Nov 19', status: 'planned', ai: true },
    { id: 'c3', noteId: 'nB', noteTitle: 'Semis basket', op: 'add_tag', label: 'Add tag “earnings-nvda”', before: '(no tags)', after: 'earnings-nvda', status: 'planned', ai: true },
  ],
}

let server
function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/j2/ai-actions/plan' && method === 'POST') return server.plan(JSON.parse(init.body))
    const m = url.match(/^\/api\/j2\/ai-actions\/([^/]+)\/(apply|undo)$/)
    if (m && method === 'POST') return server[m[2]](JSON.parse(init.body || '{}'))
    return json(404, { detail: 'Not Found' })
  })
}
const posts = (suffix) => global.fetch.mock.calls
  .filter(([u, init = {}]) => u.endsWith(suffix) && (init.method || 'GET') === 'POST')
  .map(([, init]) => JSON.parse(init.body || '{}'))

function defaultServer() {
  return {
    plan: () => json(200, SET),
    apply: ({ changeIds }) => json(200, {
      results: changeIds.map((id) => ({ id, noteId: SET.changes.find((c) => c.id === id).noteId,
        status: 'applied', message: null, updatedAt: `rev-${id}` })),
      revisions: changeIds.length ? [{ noteId: SET.changes.find((c) => c.id === changeIds[0]).noteId, updatedAt: `rev-${changeIds.at(-1)}` }] : [],
      changeSet: { ...SET, status: 'applied' },
    }),
    undo: () => json(200, {
      results: [{ id: 'c1', noteId: 'nA', status: 'undone' }, { id: 'c3', noteId: 'nB', status: 'undone' }],
      revisions: [{ noteId: 'nA', updatedAt: 'rev-u1' }, { noteId: 'nB', updatedAt: 'rev-u2' }],
      changeSet: { ...SET, status: 'undone' },
    }),
  }
}

function renderBox(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AiActionsBox {...props} />
    </SWRConfig>,
  )
}

// The note groups are the <fieldset>s (a <details> is a group too, and is not a note).
const noteGroups = () => screen.getAllByRole('group').filter((g) => g.tagName === 'FIELDSET')

async function openAndPlan(user, text = 'tag every note that mentions NVDA earnings with earnings-nvda') {
  await user.click(screen.getByRole('button', { name: 'Ask Notebook to do something' }))
  const box = screen.getByRole('textbox', { name: 'What should Notebook do?' })
  await user.type(box, text)
  await user.click(screen.getByRole('button', { name: 'Plan changes' }))
  await screen.findByRole('heading', { name: 'Review 3 proposed changes' })
}

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ai_actions_enabled: true })
  server = defaultServer()
  installFetch()
  settled.length = 0
  unsent = new Set()
})
afterEach(() => { __resetNotebookFlags() })

describe('Ask Notebook to do something — hidden while the flag is off', () => {
  it('renders nothing when the flag is off, and nothing before any payload latched', () => {
    __resetNotebookFlags()
    const { container } = renderBox()
    expect(container.textContent).toBe('')
    latchNotebookFlags({ notebook_ai_actions_enabled: false })
    renderBox()
    expect(screen.queryByRole('button', { name: 'Ask Notebook to do something' })).toBeNull()
  })
})

describe('the request box', () => {
  it('opens, focuses the box, and plans what was typed — writing nothing', async () => {
    const user = userEvent.setup()
    renderBox()
    const toggle = screen.getByRole('button', { name: 'Ask Notebook to do something' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const box = screen.getByRole('textbox', { name: 'What should Notebook do?' })
    expect(box).toHaveFocus()
    expect(screen.getByText(/writes nothing until you approve them/)).toBeInTheDocument()
    await user.type(box, 'tag my NVDA notes')
    await user.click(screen.getByRole('button', { name: 'Plan changes' }))
    await screen.findByRole('heading', { name: 'Review 3 proposed changes' })
    expect(posts('/plan')).toEqual([{ request: 'tag my NVDA notes' }])
    // ⛔ nothing applied by planning
    expect(posts('/apply')).toEqual([])
    expect(screen.getByText('Nothing has been written yet. Uncheck anything you don’t want.')).toBeInTheDocument()
  })

  it('an empty request is refused in words, and a server refusal is shown as said', async () => {
    const user = userEvent.setup()
    server.plan = () => json(429, { detail: "You've used today's AI change plans — they reset at midnight ET." })
    renderBox()
    await user.click(screen.getByRole('button', { name: 'Ask Notebook to do something' }))
    await user.click(screen.getByRole('button', { name: 'Plan changes' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Type what you’d like Notebook to do first.')
    expect(posts('/plan')).toEqual([])
    await user.type(screen.getByRole('textbox', { name: 'What should Notebook do?' }), 'x')
    await user.click(screen.getByRole('button', { name: 'Plan changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("You've used today's AI change plans — they reset at midnight ET.")
  })
})

describe('the review list', () => {
  it('groups changes by note, shows before → after, labels each AI, and checks all', async () => {
    const user = userEvent.setup()
    renderBox()
    await openAndPlan(user)
    const groups = noteGroups()
    expect(groups.map((g) => within(g).getByText(/thesis|basket/, { selector: 'legend' }).textContent))
      .toEqual(['NVDA thesis', 'Semis basket'])
    const a = within(groups[0])
    expect(a.getAllByRole('checkbox').map((c) => c.checked)).toEqual([true, true])
    expect(a.getByRole('checkbox', { name: 'Add a line at the end' })).toHaveAccessibleDescription(
      'Before: …Long into the print After: Next earnings: Nov 19')
    expect(a.getAllByText('AI')).toHaveLength(2)
    expect(within(groups[1]).getByRole('checkbox', { name: 'Add tag “earnings-nvda”' }))
      .toHaveAccessibleDescription('Before: (no tags) After: earnings-nvda')
    expect(screen.getByText(/You asked: “tag every note that mentions NVDA earnings with earnings-nvda”/)).toBeInTheDocument()
    expect(screen.getByText('Skipped (1) — not changed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply 3 changes' })).toBeEnabled()
  })

  it('unchecking a change updates the count, and only checked changes are sent', async () => {
    const user = userEvent.setup()
    renderBox()
    await openAndPlan(user)
    await user.click(within(noteGroups()[0]).getByRole('checkbox', { name: 'Add a line at the end' }))
    expect(screen.getByRole('button', { name: 'Apply 2 changes' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply 2 changes' }))
    await screen.findByRole('heading', { name: 'AI change set applied' })
    const sent = posts('/apply')
    expect(sent.map((b) => b.changeIds)).toEqual([['c1'], ['c3']])
    expect(sent[0].declinedIds).toEqual(['c2'])
    expect(sent[1].declinedIds).toEqual([])
  })

  it('says when the plan was capped', async () => {
    const user = userEvent.setup()
    server.plan = () => json(200, { ...SET, capped: { limit: 200, dropped: 37 } })
    renderBox()
    await openAndPlan(user)
    expect(screen.getByText(/The plan was capped at 200 changes; 37 more were not included./)).toBeInTheDocument()
  })
})

describe('apply: progress, partial failures, the settle', () => {
  it('applies note by note with progress, lists what failed, and lands every revision', async () => {
    const user = userEvent.setup()
    let release
    const gate = new Promise((r) => { release = r })
    server.apply = async ({ changeIds }) => {
      if (changeIds.includes('c3')) {
        await gate
        return json(200, { results: [{ id: 'c3', noteId: 'nB', status: 'conflict',
          message: 'This note changed after you reviewed the plan, so this change was skipped.' }], revisions: [] })
      }
      return json(200, { results: changeIds.map((id) => ({ id, noteId: 'nA', status: 'applied', updatedAt: `r-${id}` })),
        revisions: [{ noteId: 'nA', updatedAt: 'r-c2' }] })
    }
    renderBox()
    await openAndPlan(user)
    await user.click(screen.getByRole('button', { name: 'Apply 3 changes' }))
    expect(await screen.findByText('Applying… 1 of 2 notes')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Applying changes' })).toHaveAttribute('value', '1')
    release()
    await screen.findByRole('heading', { name: 'AI change set applied' })
    expect(screen.getByText('Applied 2 changes. 1 change could not be applied — listed below.')).toBeInTheDocument()
    const failed = screen.getByRole('list', { name: 'Changes that were not applied' })
    expect(failed).toHaveTextContent('Semis basket — Add tag “earnings-nvda”: Not applied. This note changed after you reviewed the plan, so this change was skipped.')
    expect(settled).toEqual([{ noteId: 'nA', updatedAt: 'r-c2' }])
  })

  it('holds back a blocked note entirely, and a block on a note with unsent words', async () => {
    const user = userEvent.setup()
    unsent = new Set(['nA'])
    renderBox({ blockedNoteIds: new Set(['nB']) })
    await openAndPlan(user)
    await user.click(screen.getByRole('button', { name: 'Apply 3 changes' }))
    await screen.findByRole('heading', { name: 'AI change set applied' })
    expect(posts('/apply').map((b) => b.changeIds)).toEqual([['c1']])     // the tag on nA only
    const failed = screen.getByRole('list', { name: 'Changes that were not applied' })
    expect(failed).toHaveTextContent(`Add a line at the end: Held back. ${UNSENT_BLOCK_SENTENCE}`)
    expect(failed).toHaveTextContent(`Semis basket — Add tag “earnings-nvda”: Held back. ${BLOCKED_SENTENCE}`)
  })
})

describe('undo', () => {
  it('offers one-click undo of the whole set, says what happened, and lands the revisions', async () => {
    const user = userEvent.setup()
    renderBox()
    await openAndPlan(user)
    await user.click(screen.getByRole('button', { name: 'Apply 3 changes' }))
    await screen.findByRole('heading', { name: 'AI change set applied' })
    settled.length = 0
    expect(screen.getByText(/change set set12345/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo this change set' }))
    await screen.findByRole('heading', { name: 'AI change set undone' })
    expect(screen.getByText('Undid 2 changes. Your notes are back as they were.')).toBeInTheDocument()
    expect(posts('/undo')).toHaveLength(1)
    expect(settled).toEqual([{ noteId: 'nA', updatedAt: 'rev-u1' }, { noteId: 'nB', updatedAt: 'rev-u2' }])
  })

  it('names a note an undo left alone, in the server’s own sentence', async () => {
    const user = userEvent.setup()
    server.undo = () => json(200, {
      results: [{ id: 'c1', noteId: 'nA', status: 'undo_refused',
        message: 'This note was edited after the change set was applied, so it was left as it is.' },
      { id: 'c3', noteId: 'nB', status: 'undone' }],
      revisions: [{ noteId: 'nB', updatedAt: 'rev-u2' }],
    })
    renderBox()
    await openAndPlan(user)
    await user.click(screen.getByRole('button', { name: 'Apply 3 changes' }))
    await screen.findByRole('heading', { name: 'AI change set applied' })
    await user.click(screen.getByRole('button', { name: 'Undo this change set' }))
    await screen.findByRole('heading', { name: 'AI change set undone' })
    expect(screen.getByText('Undid 1 change. 1 change was left as it is — listed below.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Changes that were left as they are' }))
      .toHaveTextContent('NVDA thesis — Add tag “earnings-nvda”: This note was edited after the change set was applied, so it was left as it is.')
  })
})

describe('keyboard only', () => {
  it('request, review, uncheck, apply and undo — without a pointer', async () => {
    const user = userEvent.setup()
    renderBox()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Ask Notebook to do something' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'What should Notebook do?' })).toHaveFocus()
    await user.keyboard('tag NVDA notes{Control>}{Enter}{/Control}')
    const heading = await screen.findByRole('heading', { name: 'Review 3 proposed changes' })
    expect(heading).toHaveFocus()
    // Tab to the first checkbox and uncheck it with Space.
    await user.tab()
    expect(document.activeElement).toBe(screen.getAllByRole('checkbox', { name: 'Add tag “earnings-nvda”' })[0])
    await user.keyboard(' ')
    expect(document.activeElement).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Apply 2 changes' })).toBeInTheDocument()
    screen.getByRole('button', { name: 'Apply 2 changes' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'AI change set applied' })).toHaveFocus()
    screen.getByRole('button', { name: 'Undo this change set' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'AI change set undone' })).toHaveFocus()
  })
})
