import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 12, lane 12B-2 -- the Position Tracker through the REAL NotebookTab create path
 * (`?new=position-tracker` -> createFromTemplate -> createNote -> createNoteViaApi), in
 * BOTH states of NOTEBOOK_FORMULAS_ENABLED. The network is a recording fake; the sidebar
 * and editor are stubbed, as in NotebookTab.templates.test.jsx.
 *
 * What it holds: the member's definitions are read, then created, THEN the note is made;
 * with formulas off not one formula create leaves the tab (the server would refuse it with
 * a 400); and in every case the note is ONE create with no property values, so nothing can
 * leave it half-applied.
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId }) => <div data-testid="note-editor" data-note-id={noteId} />,
}))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { __resetTemplateReveals, templateRevealFor } from '../lib/templatePropertyDefs'

const DEFS = '/api/j2/property-defs'
let calls
let defs
let defsReadFails
let serverFormulasOn

beforeEach(() => {
  vi.clearAllMocks()
  __resetNotebookFlags()
  __resetTemplateReveals()
  calls = []
  defs = []
  defsReadFails = false
  serverFormulasOn = true
  setCurrentAccountId('acct-A')
  let n = 0
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    const refuse = (status, detail) => ({ ok: false, status, json: async () => ({ detail }) })
    let res
    if (u === DEFS && method === 'GET') {
      res = defsReadFails ? refuse(500, 'boom') : ok({ propertyDefs: defs.filter((d) => serverFormulasOn || d.type !== 'formula') })
    } else if (u === DEFS && method === 'POST') {
      // The server's own rule (note_properties.create_property_def): a formula while the
      // gate is off is a 400.
      if (body.type === 'formula' && !serverFormulasOn) res = refuse(400, "Unsupported property type: 'formula'")
      else {
        const d = { id: `d${(n += 1)}`, name: body.name, type: body.type, source: 'user_set', ...(body.config ? { config: body.config } : {}) }
        defs.push(d)
        res = ok({ propertyDef: d })
      }
    } else if (u === '/api/j2/notes' && method === 'POST') {
      res = ok({ note: { id: 'new1', title: body.title, updatedAt: 'R0' } })
    } else if (u.startsWith('/api/j2/note-folders')) res = ok({ folders: [] })
    else res = ok({})
    calls.push({ url: u, method, body, status: res.status })
    return res
  })
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

const renderDeepLink = () => render(
  <MemoryRouter initialEntries={['/journal?new=position-tracker']}><NotebookTab /></MemoryRouter>,
)
// Every write but telemetry (the Notebook counts a template pick; that is not a note write).
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/j2/telemetry'))
const noteCreates = () => calls.filter((c) => c.url === '/api/j2/notes' && c.method === 'POST')

async function opened() {
  await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
}

describe('12B-2 -- flag ON', () => {
  beforeEach(() => latchNotebookFlags({ notebook_formulas_enabled: true }))

  it('reads the definitions, creates five numbers then three formulas, THEN creates the note -- one write, no values', async () => {
    renderDeepLink()
    await opened()
    expect(writes().map((c) => (c.url === DEFS ? `${c.body.type}:${c.body.name}` : `${c.method} ${c.url}`))).toEqual([
      'number:Entry', 'number:Stop', 'number:Exit', 'number:Shares', 'number:Account size',
      'formula:R-multiple', 'formula:Risk per share', 'formula:Position size %',
      'POST /api/j2/notes',
    ])
    const firstDefsRead = calls.findIndex((c) => c.url === DEFS && c.method === 'GET')
    const firstCreate = calls.findIndex((c) => c.url === DEFS && c.method === 'POST')
    expect(firstDefsRead).toBeGreaterThanOrEqual(0)
    expect(firstDefsRead).toBeLessThan(firstCreate)
    expect(noteCreates()).toHaveLength(1)
    expect(noteCreates()[0].body).toMatchObject({ title: 'Position Tracker', tags: ['position'] })
    expect(noteCreates()[0].body.properties).toBeUndefined()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(calls.every((c) => c.status === 200)).toBe(true)
    // A formula is stored by the ids of the numbers this apply made.
    const r = calls.find((c) => c.body?.name === 'R-multiple').body.config.expression
    const id = (name) => defs.find((d) => d.name === name).id
    expect(r).toBe(`({@${id('Exit')}} - {@${id('Entry')}}) / ({@${id('Entry')}} - {@${id('Stop')}})`)
    // The new note shows all eight while they are still empty.
    expect(templateRevealFor('new1')).toEqual(defs.map((d) => d.id))
  })

  it('a member who already has them: nothing is created, the note still is', async () => {
    defs = ['Entry', 'Stop', 'Exit', 'Shares', 'Account size'].map((name, i) => ({ id: `old${i}`, name, type: 'number', source: 'user_set' }))
      .concat(['R-multiple', 'Risk per share', 'Position size %'].map((name, i) => ({ id: `oldf${i}`, name, type: 'formula', source: 'user_set', config: { expression: '1' } })))
    renderDeepLink()
    await opened()
    expect(calls.some((c) => c.url === DEFS && c.method === 'POST')).toBe(false)
    expect(noteCreates()).toHaveLength(1)
    expect(templateRevealFor('new1')).toHaveLength(8)
  })

  it('the server\'s gate is off although the tab latched on: the formula refusals are absorbed and the note is still made', async () => {
    serverFormulasOn = false
    renderDeepLink()
    await opened()
    expect(noteCreates()).toHaveLength(1)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(templateRevealFor('new1')).toHaveLength(5)
  })

  it('the definitions cannot be read at all: the note is still made, with nothing revealed', async () => {
    defsReadFails = true
    renderDeepLink()
    await opened()
    expect(calls.some((c) => c.url === DEFS && c.method === 'POST')).toBe(false)
    expect(noteCreates()).toHaveLength(1)
    expect(templateRevealFor('new1')).toEqual([])
  })
})

describe('⛔ 12B-2 -- flag OFF', () => {
  beforeEach(() => {
    latchNotebookFlags({ notebook_formulas_enabled: false })
    serverFormulasOn = false
  })

  it('five number creates and the note: not one formula create, never a 400, never a half-applied write', async () => {
    renderDeepLink()
    await opened()
    const defCreates = calls.filter((c) => c.url === DEFS && c.method === 'POST')
    expect(defCreates.map((c) => c.body.name)).toEqual(['Entry', 'Stop', 'Exit', 'Shares', 'Account size'])
    expect(defCreates.some((c) => c.body.type === 'formula' || c.body.config)).toBe(false)
    expect(calls.filter((c) => c.status >= 400)).toEqual([])
    expect(noteCreates()).toHaveLength(1)
    expect(noteCreates()[0].body.properties).toBeUndefined()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(templateRevealFor('new1')).toHaveLength(5)
  })
})
