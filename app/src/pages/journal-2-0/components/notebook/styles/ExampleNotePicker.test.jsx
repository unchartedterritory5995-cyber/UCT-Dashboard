// P3b Task 5 — the author's door to "Add an example note": in the Share form of a style already in the library,
// and on the author's own style in Your submissions; the picker of the author's notes of the style's kind; and
// the hand-off to the preview sheet. Through the REAL clients (lib/styleLibrary.js) with only the network faked.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
//
// CONTRACT: the author's Your submissions list AS THE SERVER LISTS IT (`template-gallery.examples.list.mine`: their
// shared style with its `sourceStyleId`, their pending example, and `capabilities`), the style item in full (its
// `payload.kindId`) and the example preview are the server's recorded answers (`__fixtures__/contract`). A
// variation (the capability off, a hidden or rejected row) is a spread + override of a fixture object; the field
// the Share form's door matches on is NEVER added by hand (P3b-T5-R7, review I-1).
// ⚠️ The notes list has NO recorded fixture (Task 7 owns new fixtures): its rows below carry only the fields the
// picker reads, in `notes._row_to_note_summary`'s names (id, title, createdAt, propertiesJson).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { contractBody } from '../../../__fixtures__/contract'
import { NOTE_KIND_PROPERTY } from '../../../lib/noteKinds'
import ShareStyleForm from './ShareStyleForm'
import TemplateGallery from '../TemplateGallery'
import { PICKER_TITLE } from './ExampleNotePicker'
import { ADD_EXAMPLE_LABEL } from './AddExampleNoteDoor'
import { EXAMPLE_SENT_SENTENCE, PREVIEW_TITLE } from './ExamplePreviewSheet'

// ── the server's answers ──
const LIST = contractBody('template-gallery.list')
const MINE = contractBody('template-gallery.examples.list.mine')          // the author's own list, recorded
const MINE_ROW = MINE.templates.find((t) => t.itemType === 'style')        // their shared style, as listed
const EXAMPLE_ROW = MINE.templates.find((t) => t.itemType === 'example_note')
// The member's own style row (the journal styles list's shape), the one MINE_ROW says it shares.
const MEMBER = { ...contractBody('journal-styles.list').styles.find((s) => !s.builtin), id: MINE_ROW.sourceStyleId }
// The style item in full, as a single read answers it, at the id the author's list names.
const STYLE_ITEM = { ...contractBody('template-gallery.styles.item').template, id: MINE_ROW.id }
const KIND = STYLE_ITEM.payload.kindId
const PREVIEW = contractBody('template-gallery.examples.preview')
const PUBLISHED = contractBody('template-gallery.examples.publish')
const note = (id, title, kind, createdAt) => ({ id, title, createdAt, updatedAt: createdAt, propertiesJson: kind ? { [NOTE_KIND_PROPERTY]: kind } : {} })
const NOTES = [
  note('n-new', 'Monday plan', KIND, '2026-10-12T13:00:00+00:00'),
  note('n-other', 'Thesis on NVDA', `${KIND}-not`, '2026-10-11T13:00:00+00:00'),
  note('n-old', 'Last week plan', KIND, '2026-10-05T13:00:00+00:00'),
  note('n-none', 'No kind at all', null, '2026-10-04T13:00:00+00:00'),
]

let calls
let mineAnswer
function installFetch() {
  calls = []
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : input.url
    const [path, search = ''] = url.split('?')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, search, body })
    let out = [404, { detail: 'Not found' }]
    if (method === 'GET' && path === '/api/j2/template-gallery') {
      out = new URLSearchParams(search).get('section') === 'mine' ? mineAnswer : LIST
    } else if (method === 'GET' && path === `/api/j2/template-gallery/${STYLE_ITEM.id}`) {
      out = { template: STYLE_ITEM }
    } else if (method === 'GET' && path === '/api/j2/notes') {
      out = { notes: NOTES, total: NOTES.length }
    } else if (method === 'POST' && path === '/api/j2/template-gallery/examples/preview') {
      out = PREVIEW
    } else if (method === 'POST' && path === '/api/j2/template-gallery/examples') {
      out = PUBLISHED
    } else if (method === 'GET' && path === '/api/j2/note-templates') {
      out = { templates: [] }
    } else if (method === 'GET' && path.startsWith('/api/j2/journal-styles/')) {
      out = { style: { ...MEMBER, outlineBodyJson: null } }
    }
    const [status, payload] = Array.isArray(out) && typeof out[0] === 'number' ? out : [200, out]
    return { ok: status >= 200 && status < 300, status, json: async () => payload }
  })
}
const got = (path) => calls.filter((c) => c.method === 'GET' && c.path === path)

const withCapability = (on, templates) => ({ ...MINE, templates, capabilities: { ...MINE.capabilities, exampleNotes: on } })

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({
    notebook_journal_styles_enabled: true,
    notebook_template_gallery_enabled: true,
    notebook_style_library_enabled: true,
  })
  Element.prototype.scrollIntoView = vi.fn()
  mineAnswer = MINE                                                       // the recorded answer, untouched
  installFetch()
})
afterEach(() => { __resetNotebookFlags() })

const tree = (node) => (
  <MemoryRouter>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{node}</SWRConfig>
  </MemoryRouter>
)
const shareForm = () => render(tree(<ShareStyleForm style={MEMBER} onShared={vi.fn()} onClose={vi.fn()} />))
const shareDialog = () => screen.findByRole('dialog', { name: `Share ${MEMBER.name} to community` })

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('the author\'s list carries the capability, a pending style naming the style it shares, and an example', () => {
    expect(typeof LIST.capabilities.exampleNotes).toBe('boolean')
    expect(MINE.capabilities.exampleNotes).toBe(true)
    expect([MINE_ROW.itemType, MINE_ROW.status, MINE_ROW.mine, MINE_ROW.hidden]).toEqual(['style', 'pending', true, false])
    expect(typeof MINE_ROW.sourceStyleId).toBe('string')                   // the SERVER's field (P3b-T5-R7)
    expect(MINE_ROW.sourceStyleId.length).toBeGreaterThan(0)
    expect(EXAMPLE_ROW.status).toBe('pending')
    expect(typeof KIND).toBe('string')
    expect(NOTES.filter((n) => n.propertiesJson[NOTE_KIND_PROPERTY] === KIND)).toHaveLength(2)
  })
})

describe('1. the door is the server\'s capability', () => {
  it('with capabilities.exampleNotes false, the Share form has no door', async () => {
    mineAnswer = withCapability(false, [MINE_ROW])
    shareForm()
    const dialog = await shareDialog()
    await waitFor(() => expect(got('/api/j2/template-gallery').length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    // the decision is made before the door's chunk loads: no door slot at all, so a late load cannot hide one
    expect(dialog.querySelector('[data-example-door]')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: ADD_EXAMPLE_LABEL })).toBeNull()
  })
  it('with the capability missing (a pod from before P3b), there is no door either', async () => {
    const { capabilities, ...noCaps } = withCapability(true, [MINE_ROW])
    expect(capabilities).toBeTruthy()
    mineAnswer = noCaps
    shareForm()
    const dialog = await shareDialog()
    await waitFor(() => expect(got('/api/j2/template-gallery').length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    // the decision is made before the door's chunk loads: no door slot at all, so a late load cannot hide one
    expect(dialog.querySelector('[data-example-door]')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: ADD_EXAMPLE_LABEL })).toBeNull()
  })
  it('with it on, the Share form of a style already in the library has the door', async () => {
    shareForm()
    const dialog = await shareDialog()
    expect(await within(dialog).findByRole('button', { name: ADD_EXAMPLE_LABEL })).toBeInTheDocument()
    expect(dialog.querySelector('[data-example-door]')).not.toBeNull()          // control for the slot checks below
  })
  it('with it on, a style not yet shared, or one hidden by a moderator, has no door', async () => {
    mineAnswer = withCapability(true, [{ ...MINE_ROW, sourceStyleId: `${MEMBER.id}-other` }, { ...MINE_ROW, id: 'h', hidden: true }])
    shareForm()
    const dialog = await shareDialog()
    await waitFor(() => expect(got('/api/j2/template-gallery').length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    // the decision is made before the door's chunk loads: no door slot at all, so a late load cannot hide one
    expect(dialog.querySelector('[data-example-door]')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: ADD_EXAMPLE_LABEL })).toBeNull()
  })
})

describe('2. the picker', () => {
  const openPicker = async () => {
    shareForm()
    const dialog = await shareDialog()
    fireEvent.click(await within(dialog).findByRole('button', { name: ADD_EXAMPLE_LABEL }))
    return screen.findByRole('dialog', { name: PICKER_TITLE })
  }

  it('lists only the author\'s notes of the style\'s kind, newest first, each a button named by its title and date', async () => {
    const picker = await openPicker()
    const rows = await within(picker).findAllByRole('button', { name: /plan, / })
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Monday plan'), expect.stringContaining('Last week plan'),
    ])
    expect(rows[0]).toHaveAccessibleName(expect.stringMatching(/^Monday plan, Oct 12, 2026$/))
    expect(within(picker).queryByText('Thesis on NVDA')).toBeNull()
    expect(within(picker).queryByText('No kind at all')).toBeNull()
    // the kind is the style ITEM's (the server checks the listed payload), and the server is asked to filter by it
    expect(got(`/api/j2/template-gallery/${STYLE_ITEM.id}`)).toHaveLength(1)
    const asked = new URLSearchParams(got('/api/j2/notes')[0].search)
    expect(asked.get('sort')).toBe('created')
    expect(JSON.parse(asked.get('propertyFilter'))).toEqual([{ propertyId: NOTE_KIND_PROPERTY, op: 'eq', value: KIND }])
  })

  it('the search box narrows the list by title', async () => {
    const picker = await openPicker()
    await within(picker).findByText('Monday plan')
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search your notes' }), { target: { value: 'last' } })
    expect(within(picker).queryByText('Monday plan')).toBeNull()
    expect(within(picker).getByText('Last week plan')).toBeInTheDocument()
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search your notes' }), { target: { value: 'zzz' } })
    expect(await within(picker).findByText('None of your notes of this kind match.')).toBeInTheDocument()
  })

  it('picking a note opens the preview of that note; Submit says it was sent, beside the door', async () => {
    const picker = await openPicker()
    fireEvent.click(await within(picker).findByRole('button', { name: /^Monday plan, / }))
    const preview = await screen.findByRole('dialog', { name: PREVIEW_TITLE })
    expect(screen.queryByRole('dialog', { name: PICKER_TITLE })).toBeNull()
    await waitFor(() => expect(calls.some((c) => c.path === '/api/j2/template-gallery/examples/preview')).toBe(true))
    expect(calls.find((c) => c.path === '/api/j2/template-gallery/examples/preview').body.noteId).toBe('n-new')
    await waitFor(() => expect(within(preview).getByLabelText('Title in the library')).toHaveValue(PREVIEW.title))
    fireEvent.click(within(preview).getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: PREVIEW_TITLE })).toBeNull())
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/j2/template-gallery/examples').body.styleItemId)
      .toBe(STYLE_ITEM.id)
    const share = await shareDialog()
    expect(within(share).getByRole('status')).toHaveTextContent(EXAMPLE_SENT_SENTENCE)
  })

  // P3b-T5-R8 (review I-2): every way the preview closes gives focus back to the door, never to <body>.
  const toPreview = async () => {
    const picker = await openPicker()
    fireEvent.click(await within(picker).findByRole('button', { name: /^Monday plan, / }))
    const preview = await screen.findByRole('dialog', { name: PREVIEW_TITLE })
    await waitFor(() => expect(within(preview).getByLabelText('Title in the library')).toHaveValue(PREVIEW.title))
    return preview
  }
  const door = async () => within(await shareDialog()).findByRole('button', { name: ADD_EXAMPLE_LABEL })
  it('Cancel in the preview gives focus back to the door', async () => {
    const preview = await toPreview()
    fireEvent.click(within(preview).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: PREVIEW_TITLE })).toBeNull())
    const button = await door()
    await waitFor(() => expect(document.activeElement).toBe(button))
  })
  it('Escape in the preview gives focus back to the door, and leaves the Share form open', async () => {
    await toPreview()
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: PREVIEW_TITLE })).toBeNull())
    expect(await shareDialog()).toBeInTheDocument()
    const button = await door()
    await waitFor(() => expect(document.activeElement).toBe(button))
  })
  it('a sent example gives focus back to the door, beside the sentence', async () => {
    const preview = await toPreview()
    fireEvent.click(within(preview).getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: PREVIEW_TITLE })).toBeNull())
    const button = await door()
    await waitFor(() => expect(document.activeElement).toBe(button))
    expect(within(await shareDialog()).getByRole('status')).toHaveTextContent(EXAMPLE_SENT_SENTENCE)
  })

  it('a style whose kind cannot be read says so, and lists nothing', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = vi.fn((input, init) => (String(input).startsWith(`/api/j2/template-gallery/${STYLE_ITEM.id}`)
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ template: { ...STYLE_ITEM, payload: {} } }) })
      : orig(input, init)))
    const picker = await openPicker()
    expect(await within(picker).findByRole('alert')).toHaveTextContent("This style has no kind of note, so it can't have an example.")
    expect(got('/api/j2/notes')).toHaveLength(0)
  })
})

describe('the door on the author\'s own listed style in Your submissions', () => {
  const submissions = async () => {
    render(tree(<TemplateGallery onBack={vi.fn()} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Your submissions' }))
    return screen.findByRole('list', { name: 'Your submissions' })
  }
  it('a pending or approved style of theirs has the door when the capability is on', async () => {
    mineAnswer = withCapability(true, [MINE_ROW, { ...MINE_ROW, id: 'rej', status: 'rejected', title: 'Turned down' }])
    const list = await submissions()
    const row = (await within(list).findByText(MINE_ROW.title)).closest('li')
    expect(await within(row).findByRole('button', { name: ADD_EXAMPLE_LABEL })).toBeInTheDocument()   // loaded on demand
    expect(row.querySelector('[data-example-door]')).not.toBeNull()
    const rejected = within(list).getByText('Turned down').closest('li')
    expect(rejected.querySelector('[data-example-door]')).toBeNull()
    expect(within(rejected).queryByRole('button', { name: ADD_EXAMPLE_LABEL })).toBeNull()
  })
  it('there is no door when the capability is off', async () => {
    mineAnswer = withCapability(false, [MINE_ROW])
    const list = await submissions()
    const row = (await within(list).findByText(MINE_ROW.title)).closest('li')
    expect(row.querySelector('[data-example-door]')).toBeNull()
    expect(within(row).queryByRole('button', { name: ADD_EXAMPLE_LABEL })).toBeNull()
  })
  it('an example of theirs is listed with its status and the reviewer\'s note (ruling P3b-R12), and has no door', async () => {
    const example = { ...EXAMPLE_ROW, status: 'rejected', reviewNote: 'Shows an account number.' }
    mineAnswer = withCapability(true, [MINE_ROW, example])
    const list = await submissions()
    const row = (await within(list).findByText(example.title)).closest('li')
    expect(within(row).getByText('Example note')).toBeInTheDocument()
    expect(within(row).getByText('Reviewer: Shows an account number.')).toBeInTheDocument()
    expect(row.querySelector('[data-example-door]')).toBeNull()
  })
  it('a sent example says so in the gallery\'s message line', async () => {
    const list = await submissions()
    const row = (await within(list).findByText(MINE_ROW.title)).closest('li')
    fireEvent.click(await within(row).findByRole('button', { name: ADD_EXAMPLE_LABEL }))
    const picker = await screen.findByRole('dialog', { name: PICKER_TITLE })
    fireEvent.click(await within(picker).findByRole('button', { name: /^Monday plan, / }))
    const preview = await screen.findByRole('dialog', { name: PREVIEW_TITLE })
    await waitFor(() => expect(within(preview).getByLabelText('Title in the library')).toHaveValue(PREVIEW.title))
    fireEvent.click(within(preview).getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText(EXAMPLE_SENT_SENTENCE)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: PREVIEW_TITLE })).toBeNull()
    // P3b-T5-R8: focus is back on THIS row's door, never on <body>
    await waitFor(() => expect(document.activeElement).toBe(within(row).getByRole('button', { name: ADD_EXAMPLE_LABEL })))
  })
  it('an example row\'s Unpublish asks about the style, not the gallery (review M-8)', async () => {
    mineAnswer = withCapability(true, [MINE_ROW, EXAMPLE_ROW])
    const list = await submissions()
    const row = (await within(list).findByText(EXAMPLE_ROW.title)).closest('li')
    fireEvent.click(within(row).getByRole('button', { name: `Unpublish ${EXAMPLE_ROW.title}` }))
    expect(within(row).getByText(`Withdraw the example “${EXAMPLE_ROW.title}”? It will no longer show on your style.`))
      .toBeInTheDocument()
    expect(within(row).queryByText(/out of the gallery/)).toBeNull()
  })
})

