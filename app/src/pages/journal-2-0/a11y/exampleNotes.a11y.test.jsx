// app/src/pages/journal-2-0/a11y/exampleNotes.a11y.test.jsx
//
// P3b Task 8: the example notes surfaces through 8A's axe harness (the ONE way a Notebook rail asks axe-core). All of
// them live under components/notebook/styles/, outside the derived population, so notebookSurfaces.js names them in
// OUTSIDE_POPULATION_SURFACES with this file as their rail. Each recipe proves the state it is about PAINTED before axe
// runs, so an empty screen cannot pass, and every wait for effect-driven state is a `waitFor`/`findBy`, never a read
// on first paint:
//   * example-note-picker          -- "Add an example note" opened: the picker of the author's notes of the style's
//                                     kind, with its search box and one note row;
//   * example-preview-sheet        -- "Preview your example": the counts sentence, the reduced body with its replaced
//                                     spans marked in place, and the image row with its OCR line and switch (off);
//   * example-preview-confirm      -- the same sheet with an UNREAD image's second confirm open (R-P3b-5);
//   * example-in-use               -- a library style's Preview with its "In use" section: one approved example, its
//                                     title, its stored reduced body, its image on the gallery route, and its own
//                                     Report control (P3b-F-R8);
//   * example-in-use-report        -- the same, with that card's Report form OPEN (the gallery's ReportForm).
// P3b-F-R5: example-preview-sheet also proves the line under the title field -- the server's title for what is typed.
// The fake server answers with the recorded contract fixtures (`__fixtures__/contract`). Two answers are DERIVED from a
// recorded one, never retyped: the preview while every image is off is the recorded preview without its image node
// (as the server answers it), and the picker's notes list -- which has no recorded fixture -- is the recorded styled
// note (`notes.create.styled`) re-pointed at the style item's kind, beside the recorded kind-created note left at its
// own kind, which the picker must NOT offer.
import { describe, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import AddExampleNoteDoor, { ADD_EXAMPLE_LABEL } from '../components/notebook/styles/AddExampleNoteDoor'
import { PICKER_TITLE, noteDate } from '../components/notebook/styles/ExampleNotePicker'
import ExamplePreviewSheet, {
  CONFIRM_SENTENCE, OCR_UNREAD_SENTENCE, PREVIEW_TITLE, SHARE_IMAGE_LABEL, countsSentence, shownTitleSentence,
} from '../components/notebook/styles/ExamplePreviewSheet'
import StyleItemPreview from '../components/notebook/styles/StyleItemPreview'
import { IN_USE_HEADING } from '../components/notebook/styles/ExamplesInUse'
import { styleExamples } from '../lib/styleLibrary'
import { NOTE_KIND_PROPERTY } from '../lib/noteKinds'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contract, contractBody } from '../__fixtures__/contract'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

// ── the server's answers ──
const STYLE_ITEM = contractBody('template-gallery.examples.style-item').template   // a listed style with one example
const KIND = STYLE_ITEM.payload.kindId
const PREVIEW = contractBody('template-gallery.examples.preview')
const PREVIEW_NOTE_ID = contract('template-gallery.examples.preview')._contract.requestBody.noteId
const IMAGE = PREVIEW.images[0]
const withoutImages = (p) => ({ ...p, bodyJson: { ...p.bodyJson, content: p.bodyJson.content.filter((n) => n.type !== 'image') } })
// The notes list (no recorded fixture): recorded notes, one re-pointed at the style's kind, one left at its own.
const STYLED_NOTE = contractBody('notes.create.styled').note
const KIND_NOTE = contractBody('notes.create.kind').note
const OFFERED = { ...STYLED_NOTE, propertiesJson: { ...STYLED_NOTE.propertiesJson, [NOTE_KIND_PROPERTY]: KIND } }
const NOT_OFFERED = KIND_NOTE    // its own kind, which is not the style's (asserted below)

function stub() {
  global.fetch = vi.fn((url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    const method = (init.method || 'GET').toUpperCase()
    if (method === 'GET' && u.pathname === `/api/j2/template-gallery/${STYLE_ITEM.id}`) return json({ template: STYLE_ITEM })
    if (method === 'GET' && u.pathname === '/api/j2/notes') return json({ notes: [OFFERED, NOT_OFFERED], total: 2 })
    if (method === 'POST' && u.pathname === '/api/j2/template-gallery/examples/preview') {
      const body = init.body ? JSON.parse(init.body) : {}
      // Like the server: a switched-on image is in the body, a switched-off one is not.
      return json((body.imagesOn || []).length ? PREVIEW : withoutImages(PREVIEW))
    }
    return json({ detail: 'Not found' }, 404)
  })
}

function openSheet() {
  render(
    <Providers>
      <ExamplePreviewSheet note={{ id: PREVIEW_NOTE_ID, title: PREVIEW.title }} styleItemId={STYLE_ITEM.id}
        onSent={() => {}} onClose={() => {}} />
    </Providers>,
  )
}

/** The sheet once its preview answer is ON SCREEN: the counts sentence, every replaced span marked (the marking is a
 *  layout effect after the answer lands, so it is waited for), and the image row with its switch off. */
async function sheetPainted() {
  const dialog = await screen.findByRole('dialog', { name: PREVIEW_TITLE })
  await within(dialog).findByText(countsSentence(PREVIEW.counts))
  const frame = within(dialog).getByRole('region', { name: 'What other members will see' })
  await waitFor(() => {
    const marked = frame.querySelectorAll('[data-replaced]')
    if (marked.length !== PREVIEW.changes.length) throw new Error(`marked ${marked.length} of ${PREVIEW.changes.length}`)
  })
  if (frame.querySelector('img')) throw new Error('the body shows an image while every image is off')
  const row = dialog.querySelector(`[data-example-image="${IMAGE.src}"]`)
  if (!row) throw new Error('no image row for the recorded image')
  within(row).getByText(OCR_UNREAD_SENTENCE)
  const sw = within(row).getByRole('switch', { name: new RegExp(SHARE_IMAGE_LABEL) })
  if (sw.getAttribute('aria-checked') !== 'false') throw new Error('the image switch starts on')
  return { dialog, row, sw }
}

describe('P3b surfaces (example notes)', () => {
  beforeEach(() => {
    stub()
    Element.prototype.scrollIntoView = vi.fn()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_template_gallery_enabled: true, notebook_style_library_enabled: true,
      notebook_journal_styles_enabled: true })
  })
  afterEach(() => { __resetNotebookFlags() })

  axeSurface('example-note-picker', async () => {
    // The fixtures this recipe leans on say what it needs (non-vacuity): the re-pointed note is of the style's kind,
    // the other recorded note is not.
    if (OFFERED.propertiesJson[NOTE_KIND_PROPERTY] !== KIND) throw new Error('the offered note is not of the kind')
    if (NOT_OFFERED.propertiesJson?.[NOTE_KIND_PROPERTY] === KIND) throw new Error('the control note is of the kind')
    const user = userEvent.setup()
    render(<Providers><AddExampleNoteDoor styleItemId={STYLE_ITEM.id} /></Providers>)
    await user.click(screen.getByRole('button', { name: ADD_EXAMPLE_LABEL }))
    const picker = await screen.findByRole('dialog', { name: PICKER_TITLE })
    within(picker).getByRole('searchbox', { name: 'Search your notes' })
    const label = `${OFFERED.title || 'Untitled note'}, ${noteDate(OFFERED.createdAt)}`
    await within(picker).findByRole('button', { name: label })
    if (picker.querySelector(`[data-example-note="${NOT_OFFERED.id}"]`)) throw new Error('a note of another kind is offered')
    await settle()
  })

  axeSurface('example-preview-sheet', async () => {
    openSheet()
    const { dialog } = await sheetPainted()
    const field = within(dialog).getByRole('textbox', { name: 'Title in the library' })
    // P3b-F-R5: the server's title for what the field holds, under it and describing it (an effect-set state)
    const shown = await within(dialog).findByText(shownTitleSentence(PREVIEW.title))
    await waitFor(() => {
      if (field.getAttribute('aria-describedby') !== shown.id) throw new Error('the title field is not described by it')
    })
    within(dialog).getByRole('button', { name: 'Submit for review' })
    await settle()
  })

  axeSurface('example-preview-confirm', async () => {
    const user = userEvent.setup()
    openSheet()
    const { row, sw } = await sheetPainted()
    await user.click(sw)
    const ask = await within(row).findByRole('group', { name: CONFIRM_SENTENCE })
    within(ask).getByRole('button', { name: 'Cancel' })
    within(ask).getByRole('button', { name: 'Share it' })
    if (sw.getAttribute('aria-checked') !== 'false') throw new Error('the switch turned on before the second confirm')
    await settle()
  })

  axeSurface('example-in-use', async () => {
    const examples = styleExamples(STYLE_ITEM)
    if (examples.length < 1) throw new Error('the recorded style item carries no example')
    const example = examples[0]
    const image = (example.bodyJson.content || []).find((n) => n.type === 'image')
    if (!image) throw new Error('the recorded example carries no image')
    render(
      <Providers>
        <StyleItemPreview open onClose={() => {}} title={STYLE_ITEM.title} subtitle="Style"
          body={STYLE_ITEM.payload.outlineBodyJson} examples={examples} examplesReportable />
      </Providers>,
    )
    const dialog = await screen.findByRole('dialog', { name: STYLE_ITEM.title })
    const section = await within(dialog).findByRole('region', { name: IN_USE_HEADING })
    within(section).getByRole('heading', { name: example.title })
    const img = within(section).getByRole('img', { name: image.attrs.alt })
    if (img.getAttribute('src') !== image.attrs.src) throw new Error(`the image is not on its stored route: ${img.getAttribute('src')}`)
    if (!/^\/api\/j2\/template-gallery\/[^/]+\/images\/\d+$/.test(img.getAttribute('src'))) {
      throw new Error('the In use image is not on the gallery image route')
    }
    within(section).getByText(/your value here/)
    within(section).getByRole('button', { name: `Report ${example.title}` })            // P3b-F-R8
    await settle()
  })

  axeSurface('example-in-use-report', async () => {
    const [example] = styleExamples(STYLE_ITEM)
    if (!example) throw new Error('the recorded style item carries no example')
    const user = userEvent.setup()
    render(
      <Providers>
        <StyleItemPreview open onClose={() => {}} title={STYLE_ITEM.title} subtitle="Style"
          body={STYLE_ITEM.payload.outlineBodyJson} examples={[example]} examplesReportable />
      </Providers>,
    )
    const dialog = await screen.findByRole('dialog', { name: STYLE_ITEM.title })
    const section = await within(dialog).findByRole('region', { name: IN_USE_HEADING })
    const button = within(section).getByRole('button', { name: `Report ${example.title}` })
    await user.click(button)
    const form = await within(section).findByRole('form', { name: `Report ${example.title}` })
    within(form).getByRole('combobox', { name: 'Why are you reporting it?' })
    within(form).getByRole('button', { name: 'Send report' })
    await waitFor(() => {
      if (button.getAttribute('aria-expanded') !== 'true') throw new Error('the Report button does not say it is open')
    })
    await settle()
  })
})
