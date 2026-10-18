// P3b Task 5 — the exact-public preview of an example note, with the per-image opt-in, through the REAL client
// (lib/styleLibrary.js) with only the network faked.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
//
// CONTRACT: the preview, the publish and its 400 are the server's recorded answers (`__fixtures__/contract`,
// written by tools/notebook_contract_fixtures.py and held current by tests/test_notebook_contract_fixtures.py).
// A variation (an image that is still being read, an image with OCR warnings, seven images) is a spread +
// override of the recorded preview, never a retyped shape.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { contract, contractBody } from '../../../__fixtures__/contract'
import {
  EXAMPLE_IMAGE_COUNT_SENTENCE, EXAMPLE_IMAGE_EXTENSIONS, EXAMPLE_IMAGE_SIZE_SENTENCE, EXAMPLE_IMAGE_TYPE_SENTENCE,
  EXAMPLE_MAX_IMAGES,
} from '../../../lib/styleLibrary'
import ExamplePreviewSheet, {
  CHANGE_KINDS, CONFIRM_SENTENCE, EXAMPLE_SENT_SENTENCE, NOT_AN_EXAMPLE_SENTENCE, OCR_UNREAD_SENTENCE, PREVIEW_TITLE,
  SHARE_IMAGE_LABEL, TITLE_PREVIEW_DELAY_MS, countsSentence, needsSecondConfirm, shownTitleSentence,
} from './ExamplePreviewSheet'

// ── the server's answers ──
const PREVIEW = contractBody('template-gallery.examples.preview')
const PUBLISHED = contractBody('template-gallery.examples.publish')
const OTHER_KIND = contract('template-gallery.examples.publish.other-kind')
const IMAGE = PREVIEW.images[0]
const NOTE = { id: contract('template-gallery.examples.preview')._contract.requestBody.noteId, title: PREVIEW.title }
const STYLE_ITEM_ID = contract('template-gallery.examples.publish')._contract.requestBody.styleItemId
// The preview while every image is off: the recorded one, without the image the recording had switched on.
const withoutImages = (p) => ({ ...p, bodyJson: { ...p.bodyJson, content: p.bodyJson.content.filter((n) => n.type !== 'image') } })
const readRepo = (rel) => readFileSync(resolve(process.cwd(), '..', rel), 'utf8')
/** A promise the test resolves by hand: a preview answer that is still on its way. */
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
/** The visible text of a node: its text without the visually hidden "(replaced: ...)" notes. */
const visibleText = (el) => {
  const copy = el.cloneNode(true)
  copy.querySelectorAll('[data-replaced-note]').forEach((n) => n.remove())
  return copy.textContent
}

let calls
let previewAnswer
let titleAnswer
let publishAnswer
function installFetch() {
  calls = []
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : input.url
    const path = url.split('?')[0]
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    let out = [404, { detail: 'Not found' }]
    if (method === 'POST' && path === '/api/j2/template-gallery/examples/preview' && body?.titleOnly === true) {
      out = typeof titleAnswer === 'function' ? titleAnswer(body) : titleAnswer           // P3b-F2-R2: {title}
    } else if (method === 'POST' && path === '/api/j2/template-gallery/examples/preview') {
      out = typeof previewAnswer === 'function' ? previewAnswer(body) : previewAnswer
    } else if (method === 'POST' && path === '/api/j2/template-gallery/examples') {
      out = publishAnswer
    } else if (method === 'GET' && path.startsWith('/api/j2/template-gallery')) {
      out = contractBody('template-gallery.list')
    }
    const [status, payload] = Array.isArray(out) && typeof out[0] === 'number' ? out : [200, out]
    return { ok: status >= 200 && status < 300, status, json: async () => payload }
  })
}
const posted = (path) => calls.filter((c) => c.method === 'POST' && c.path === path)
const PREVIEW_PATH = '/api/j2/template-gallery/examples/preview'
const TITLE_ONLY = contract('template-gallery.examples.preview.title-only')
/** The full preview's per-member limit sentence, read from the router that says it (one fact, one file). */
const PREVIEW_RATE_SENTENCE = (() => {
  const m = readRepo('api/routers/notebook_template_gallery.py').match(/^PREVIEW_RATE_SENTENCE = "([^"]+)"/m)
  return m ? m[1] : null
})()
const PUBLISH_PATH = '/api/j2/template-gallery/examples'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // Like the server: a switched-on image is in the body, a switched-off one is not.
  previewAnswer = (body) => ((body?.imagesOn || []).length ? PREVIEW : withoutImages(PREVIEW))
  titleAnswer = (body) => ({ title: body?.title })
  publishAnswer = PUBLISHED
  installFetch()
})
afterEach(() => { vi.restoreAllMocks() })

const tree = (node) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{node}</SWRConfig>
)
const open = (props = {}) => {
  const onSent = vi.fn()
  const onClose = vi.fn()
  render(tree(<ExamplePreviewSheet note={NOTE} styleItemId={STYLE_ITEM_ID} onSent={onSent} onClose={onClose} {...props} />))
  return { onSent, onClose }
}
const sheet = () => screen.findByRole('dialog', { name: PREVIEW_TITLE })

describe('the recorded answers hold what these rails read (non-vacuity)', () => {
  it('the preview carries changes, counts and one image; publish carries a template; the 400 a sentence', () => {
    expect(PREVIEW.changes.length).toBeGreaterThan(0)
    expect(Object.keys(PREVIEW.counts).length).toBeGreaterThan(0)
    expect(PREVIEW.images).toHaveLength(1)
    expect(PREVIEW.bodyJson.content.some((n) => n.type === 'image')).toBe(true)
    expect(withoutImages(PREVIEW).bodyJson.content.some((n) => n.type === 'image')).toBe(false)
    expect(PUBLISHED.template.itemType).toBe('example_note')
    expect(OTHER_KIND._contract.status).toBe(400)
    expect(typeof OTHER_KIND.body.detail).toBe('string')
  })
})

describe('one fact in two files: the client\'s copies of the server\'s lists', () => {
  it('CHANGE_KINDS names every change kind, in the order of example_sanitize.KINDS', () => {
    const src = readRepo('api/services/journal_two/example_sanitize.py')
    const m = /^KINDS: tuple\[str, \.\.\.\] = \(([\s\S]*?)\)\r?\n/m.exec(src)
    expect(m).not.toBeNull()
    const kinds = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])
    expect(kinds.length).toBeGreaterThan(5)
    expect(Object.keys(CHANGE_KINDS)).toEqual(kinds)
  })
  it('the image limits and their sentences equal template_gallery.py\'s', () => {
    const src = readRepo('api/services/journal_two/template_gallery.py')
    expect(Number(/^EXAMPLE_MAX_IMAGES = (\d+)$/m.exec(src)?.[1])).toBe(EXAMPLE_MAX_IMAGES)
    const exts = /^EXAMPLE_IMAGE_EXTENSIONS = \{(.*)\}$/m.exec(src)?.[1]
    expect(exts).toBeTruthy()
    expect([...exts.matchAll(/"(\.[a-z]+)": /g)].map((x) => x[1])).toEqual([...EXAMPLE_IMAGE_EXTENSIONS])
    const sentence = (name) => new RegExp(`^${name} = "(.*)"$`, 'm').exec(src)?.[1]
    expect(sentence('EXAMPLE_IMAGE_COUNT_SENTENCE')).toBe(EXAMPLE_IMAGE_COUNT_SENTENCE)
    expect(sentence('EXAMPLE_IMAGE_TYPE_SENTENCE')).toBe(EXAMPLE_IMAGE_TYPE_SENTENCE)
    expect(sentence('EXAMPLE_IMAGE_SIZE_SENTENCE')).toBe(EXAMPLE_IMAGE_SIZE_SENTENCE)
  })
})

describe('the counts sentence', () => {
  it('says the brief\'s own example word for word', () => {
    expect(countsSentence({ money: 3, broker: 1, block_reset: 2 }))
      .toBe('3 amounts, 1 broker name and 2 blocks were replaced. Here is exactly what other members will see.')
  })
  it('one replacement is "was", what was dropped is "left out", and nothing at all says so', () => {
    expect(countsSentence({ money: 1 })).toBe('1 amount was replaced. Here is exactly what other members will see.')
    expect(countsSentence({ money: 2, image_off: 1, dropped: 2 }))
      .toBe('2 amounts were replaced, and 1 image and 2 items were left out. Here is exactly what other members will see.')
    expect(countsSentence({})).toBe('Nothing was replaced. Here is exactly what other members will see.')
  })
})

describe('the preview sheet', () => {
  it('3. shows the counts sentence and every replaced span, in place, with its kind as its description', async () => {
    open()
    const dialog = await sheet()
    expect(await within(dialog).findByText(countsSentence(PREVIEW.counts))).toBeInTheDocument()
    // the first request is the note alone, every image off
    expect(posted(PREVIEW_PATH)[0].body).toEqual({ noteId: NOTE.id, imagesOn: [] })
    const spans = await waitFor(() => {
      const found = dialog.querySelectorAll('[data-replaced]')
      expect(found.length).toBe(PREVIEW.changes.length)
      return [...found]
    })
    expect(spans.map((s) => s.getAttribute('data-replaced'))).toEqual(PREVIEW.changes.map((c) => c.kind))
    spans.forEach((s, i) => {
      const words = CHANGE_KINDS[PREVIEW.changes[i].kind][2]
      expect(visibleText(s)).toBe(PREVIEW.changes[i].after)
      expect(s).toHaveAccessibleDescription(words)
      // review M-4: the kind is also SAID, as visually hidden text inside the span
      expect(s.querySelector('[data-replaced-note]').textContent).toBe(` (replaced: ${words})`)
    })
    // the replaced text is the reduced body's own: the paragraph still reads whole, word for word
    const text = PREVIEW.bodyJson.content[0].content[0].text
    const para = [...dialog.querySelectorAll('[data-template-preview-body] p')].find((el) => visibleText(el) === text)
    expect(para).toBeTruthy()
    // ⛔ the author's own words (`before`) are never on screen
    for (const c of PREVIEW.changes) expect(dialog.textContent).not.toContain(c.before)
  })

  it('4. every image switch starts off, and the author sees their own image and its OCR line', async () => {
    open()
    const dialog = await sheet()
    const switches = await within(dialog).findAllByRole('switch', { name: SHARE_IMAGE_LABEL })
    expect(switches).toHaveLength(PREVIEW.images.length)
    for (const s of switches) expect(s).toHaveAttribute('aria-checked', 'false')
    const thumb = within(dialog).getByRole('img', { name: `Your image ${IMAGE.name}` })
    expect(thumb).toHaveAttribute('src', IMAGE.src)
    expect(within(dialog).getByText(OCR_UNREAD_SENTENCE)).toBeInTheDocument()
    expect(dialog.querySelector('[data-template-preview-body] img')).toBeNull()      // off: not in the body
  })

  it('test_unread_image_needs_the_second_confirm: a processing image asks again, and Cancel leaves it off', async () => {
    previewAnswer = (body) => {
      const p = (body?.imagesOn || []).length ? PREVIEW : withoutImages(PREVIEW)
      return { ...p, images: p.images.map((i) => ({ ...i, ocr: 'processing' })) }
    }
    open()
    const dialog = await sheet()
    expect(await within(dialog).findByText(OCR_UNREAD_SENTENCE)).toBeInTheDocument()
    expect(OCR_UNREAD_SENTENCE).toBe("We couldn't read this image yet. Check it yourself before switching it on.")
    const sw = within(dialog).getByRole('switch', { name: SHARE_IMAGE_LABEL })
    fireEvent.click(sw)
    const ask = within(dialog).getByRole('group', { name: CONFIRM_SENTENCE })
    expect(within(ask).getByText(CONFIRM_SENTENCE)).toBeInTheDocument()
    expect(CONFIRM_SENTENCE).toBe('This image may show an account detail. Share it anyway?')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).queryByRole('group', { name: CONFIRM_SENTENCE })).toBeNull()
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(posted(PREVIEW_PATH)).toHaveLength(1)                                     // nothing was re-run
  })

  it('P3b-T8-R1: an UNAVAILABLE image (never read: no OCR engine) says it could not be read, asks again, and Cancel leaves it off', async () => {
    // The recorded preview's own image IS `unavailable` (no document row in the builder): no override.
    expect(IMAGE.ocr).toBe('unavailable')
    open()
    const dialog = await sheet()
    expect(await within(dialog).findByText(OCR_UNREAD_SENTENCE)).toBeInTheDocument()
    expect(within(dialog).queryByText('We found no text in this image.')).toBeNull()
    const sw = within(dialog).getByRole('switch', { name: SHARE_IMAGE_LABEL })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    const ask = within(dialog).getByRole('group', { name: CONFIRM_SENTENCE })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).queryByRole('group', { name: CONFIRM_SENTENCE })).toBeNull()
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(posted(PREVIEW_PATH)).toHaveLength(1)                                     // nothing was re-run
  })

  it('an image with OCR warnings names what it may show, asks again, and "Share it" re-runs the preview with it in place', async () => {
    previewAnswer = (body) => {
      const p = (body?.imagesOn || []).length ? PREVIEW : withoutImages(PREVIEW)
      return { ...p, images: p.images.map((i) => ({ ...i, ocr: 'ready', warnings: [{ kind: 'money', match: '$1,240' }] })) }
    }
    open()
    const dialog = await sheet()
    expect(await within(dialog).findByText(/It may show an account detail: \$1,240\./)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('switch', { name: SHARE_IMAGE_LABEL }))
    const ask = within(dialog).getByRole('group', { name: CONFIRM_SENTENCE })
    fireEvent.click(within(ask).getByRole('button', { name: 'Share it' }))
    await waitFor(() => expect(posted(PREVIEW_PATH)).toHaveLength(2))
    // P3b-F-R5: a re-run previews the title on screen too (the server's prefill, until the author types one)
    expect(posted(PREVIEW_PATH)[1].body).toEqual({ noteId: NOTE.id, imagesOn: [IMAGE.src], title: PREVIEW.title })
    await waitFor(() => expect(dialog.querySelector('[data-template-preview-body] img')).not.toBeNull())
    expect(within(dialog).getByRole('switch', { name: SHARE_IMAGE_LABEL })).toHaveAttribute('aria-checked', 'true')
  })

  it('an image read with nothing to warn about switches on with no second question', async () => {
    previewAnswer = (body) => {
      const p = (body?.imagesOn || []).length ? PREVIEW : withoutImages(PREVIEW)
      return { ...p, images: p.images.map((i) => ({ ...i, ocr: 'no_text', warnings: [] })) }
    }
    open()
    const dialog = await sheet()
    fireEvent.click(await within(dialog).findByRole('switch', { name: SHARE_IMAGE_LABEL }))
    expect(within(dialog).queryByRole('group', { name: CONFIRM_SENTENCE })).toBeNull()
    await waitFor(() => expect(posted(PREVIEW_PATH)).toHaveLength(2))
    expect(posted(PREVIEW_PATH)[1].body.imagesOn).toEqual([IMAGE.src])
  })

  it('says the server\'s image limits near the rows, and a 7th image cannot be switched on, with the reason', async () => {
    const seven = Array.from({ length: EXAMPLE_MAX_IMAGES + 1 }, (_, i) => ({
      ...IMAGE, ocr: 'no_text', warnings: [], name: `chart${i}.png`, src: IMAGE.src.replace('chart.png', `chart${i}.png`),
    }))
    previewAnswer = () => ({ ...withoutImages(PREVIEW), images: seven })
    open()
    const dialog = await sheet()
    for (const s of [EXAMPLE_IMAGE_COUNT_SENTENCE, EXAMPLE_IMAGE_TYPE_SENTENCE, EXAMPLE_IMAGE_SIZE_SENTENCE]) {
      expect(await within(dialog).findByText(s, { selector: '[data-example-limits] *' })).toBeInTheDocument()
    }
    const switches = within(dialog).getAllByRole('switch', { name: SHARE_IMAGE_LABEL })
    expect(switches).toHaveLength(7)
    for (let i = 0; i < EXAMPLE_MAX_IMAGES; i += 1) {
      fireEvent.click(switches[i])
      await waitFor(() => expect(switches[i]).toHaveAttribute('aria-checked', 'true'))
    }
    expect(switches[6]).toBeDisabled()
    expect(switches[6]).toHaveAccessibleDescription(expect.stringContaining(EXAMPLE_IMAGE_COUNT_SENTENCE))
    fireEvent.click(switches[0])                                                     // one off: the 7th is free again
    await waitFor(() => expect(switches[6]).not.toBeDisabled())
  })

  it('an image that is not PNG, JPEG or WebP cannot be switched on, and says why', async () => {
    previewAnswer = () => ({ ...withoutImages(PREVIEW), images: [{ ...IMAGE, name: 'loop.gif', src: IMAGE.src.replace('chart.png', 'loop.gif') }] })
    open()
    const dialog = await sheet()
    const sw = await within(dialog).findByRole('switch', { name: SHARE_IMAGE_LABEL })
    expect(sw).toBeDisabled()
    expect(sw).toHaveAccessibleDescription(expect.stringContaining(EXAMPLE_IMAGE_TYPE_SENTENCE))
  })

  it('6. Submit posts exactly {noteId, styleItemId, imagesOn, title} and never a body, then says it was sent', async () => {
    const { onSent } = open()
    const dialog = await sheet()
    const title = await within(dialog).findByLabelText('Title in the library')
    await waitFor(() => expect(title).toHaveValue(PREVIEW.title))                    // prefilled with the note title
    fireEvent.change(title, { target: { value: 'My Monday plan' } })
    // P3b-F-R5: Submit waits for the preview of the typed title, as it waits for an image switch
    const submit = within(dialog).getByRole('button', { name: 'Submit for review' })
    expect(submit).toBeDisabled()
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    await waitFor(() => expect(posted(PUBLISH_PATH)).toHaveLength(1))
    const sent = posted(PUBLISH_PATH)[0].body
    expect(sent).toEqual({ noteId: NOTE.id, styleItemId: STYLE_ITEM_ID, imagesOn: [], title: 'My Monday plan' })
    expect(Object.keys(sent).sort()).toEqual(['imagesOn', 'noteId', 'styleItemId', 'title'])
    // ⛔ never a body: no request of this sheet carries the note's text or a document
    for (const c of calls) {
      expect(JSON.stringify(c.body || {})).not.toMatch(/bodyJson|"type":"doc"/)
    }
    await waitFor(() => expect(onSent).toHaveBeenCalledWith(EXAMPLE_SENT_SENTENCE))
    expect(EXAMPLE_SENT_SENTENCE).toBe('Sent for review. It will show on your style once approved.')
  })

  it('F-R5: a typed title is previewed once the author pauses, and the SERVER\'s title is shown under the field', async () => {
    const TYPED = 'Made $1,240 at Schwab'
    const SERVER_TITLE = 'Made your value here at your broker (as the server scrubbed it)'   // no client could make this
    titleAnswer = (body) => ({ title: body?.title === TYPED ? SERVER_TITLE : PREVIEW.title })
    open()
    const dialog = await sheet()
    const field = await within(dialog).findByLabelText('Title in the library')
    await waitFor(() => expect(field).toHaveValue(PREVIEW.title))
    expect(within(dialog).getByText(shownTitleSentence(PREVIEW.title))).toBeInTheDocument()   // the prefill's own
    for (const v of ['M', 'Made $1', TYPED]) fireEvent.change(field, { target: { value: v } })  // typing, no pause
    const submit = within(dialog).getByRole('button', { name: 'Submit for review' })
    expect(submit).toBeDisabled()
    expect(posted(PREVIEW_PATH)).toHaveLength(1)                                   // nothing sent while typing
    await waitFor(() => expect(posted(PREVIEW_PATH)).toHaveLength(2), { timeout: TITLE_PREVIEW_DELAY_MS + 2000 })
    // P3b-F2-R2: one request, the last, and TITLE-ONLY: the note is not reduced again for a typed title
    expect(posted(PREVIEW_PATH)[1].body).toEqual({ noteId: NOTE.id, title: TYPED, titleOnly: true })
    expect(Object.keys(posted(PREVIEW_PATH)[1].body).sort()).toEqual(Object.keys(TITLE_ONLY._contract.requestBody).sort())
    const shown = await within(dialog).findByText(shownTitleSentence(SERVER_TITLE))
    expect(shown).toHaveAttribute('data-example-shown-title')
    expect(field).toHaveAccessibleDescription(shownTitleSentence(SERVER_TITLE))
    expect(within(dialog).queryByText(shownTitleSentence(TYPED))).toBeNull()       // never the typed text itself
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    await waitFor(() => expect(posted(PUBLISH_PATH)).toHaveLength(1))
    expect(posted(PUBLISH_PATH)[0].body.title).toBe(TYPED)
  })

  it('F2-R2: the recorded title-only answer is just the title, and a failed one keeps Submit off with a sentence', async () => {
    expect(Object.keys(TITLE_ONLY.body)).toEqual(['title'])                        // non-vacuity: the server's shape
    expect(TITLE_ONLY._contract.requestBody.titleOnly).toBe(true)
    titleAnswer = [400, { detail: 'A title can be at most 2,000 characters.' }]
    open()
    const dialog = await sheet()
    const field = await within(dialog).findByLabelText('Title in the library')
    await waitFor(() => expect(field).toHaveValue(PREVIEW.title))
    fireEvent.change(field, { target: { value: 'Another title' } })
    const alert = await within(dialog).findByRole('alert', {}, { timeout: TITLE_PREVIEW_DELAY_MS + 2000 })
    expect(alert).toHaveTextContent('A title can be at most 2,000 characters.')
    expect(within(dialog).getByRole('button', { name: 'Submit for review' })).toBeDisabled()
    expect(within(dialog).getByText(shownTitleSentence(PREVIEW.title))).toBeInTheDocument()   // the old one stands
  })

  it('F2-R2: a full preview the hourly limit refuses says so, puts the switch back, and Submit sends the preview on screen', async () => {
    expect(PREVIEW_RATE_SENTENCE).toBe("You've previewed a lot of example notes. Try again later.")   // read, not typed
    previewAnswer = (body) => {
      if ((body?.imagesOn || []).length) return [429, { detail: PREVIEW_RATE_SENTENCE }]
      return { ...withoutImages(PREVIEW), images: PREVIEW.images.map((i) => ({ ...i, ocr: 'no_text', warnings: [] })) }
    }
    open()
    const dialog = await sheet()
    const submit = within(dialog).getByRole('button', { name: 'Submit for review' })
    await waitFor(() => expect(submit).not.toBeDisabled())
    const sw = within(dialog).getByRole('switch', { name: SHARE_IMAGE_LABEL })
    fireEvent.click(sw)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(PREVIEW_RATE_SENTENCE)
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))       // back to the preview on screen
    expect(dialog.querySelector('[data-template-preview-body]')).not.toBeNull()    // the preview still stands
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    await waitFor(() => expect(posted(PUBLISH_PATH)).toHaveLength(1))
    expect(posted(PUBLISH_PATH)[0].body.imagesOn).toEqual([])
  })

  it('F2-R2: a FIRST preview the limit refuses shows the sentence and offers no Submit', async () => {
    previewAnswer = [429, { detail: PREVIEW_RATE_SENTENCE }]
    open()
    const dialog = await sheet()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(PREVIEW_RATE_SENTENCE)
    expect(within(dialog).getByRole('button', { name: 'Submit for review' })).toBeDisabled()
  })

  it('7. a failed submit keeps the sheet open with the server\'s sentence', async () => {
    publishAnswer = [OTHER_KIND._contract.status, OTHER_KIND.body]
    const { onSent, onClose } = open()
    const dialog = await sheet()
    await waitFor(() => expect(within(dialog).getByLabelText('Title in the library')).toHaveValue(PREVIEW.title))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(OTHER_KIND.body.detail)
    expect(screen.getByRole('dialog', { name: PREVIEW_TITLE })).toBeInTheDocument()
    expect(onSent).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a preview the server will not make (404) says so and offers no Submit', async () => {
    previewAnswer = [404, { detail: 'Not found' }]
    open()
    const dialog = await sheet()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NOT_AN_EXAMPLE_SENTENCE)
    expect(NOT_AN_EXAMPLE_SENTENCE).toBe("This note can't be shared as an example.")             // review M-8
    expect(within(dialog).getByRole('button', { name: 'Submit for review' })).toBeDisabled()
  })

  it('P3b-T5-R9: Submit waits while a re-run is in flight, and then sends the switches the preview was made from', async () => {
    const later = deferred()
    previewAnswer = (body) => {
      const p = (body?.imagesOn || []).length ? PREVIEW : withoutImages(PREVIEW)
      const out = { ...p, images: p.images.map((i) => ({ ...i, ocr: 'no_text', warnings: [] })) }
      return (body?.imagesOn || []).length ? later.promise.then(() => out) : out
    }
    open()
    const dialog = await sheet()
    const submit = within(dialog).getByRole('button', { name: 'Submit for review' })
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(within(dialog).getByRole('switch', { name: SHARE_IMAGE_LABEL }))
    await waitFor(() => expect(posted(PREVIEW_PATH)).toHaveLength(2))
    expect(submit).toBeDisabled()                                                  // the body on screen is the OLD one
    expect(within(dialog).getByText('Updating the preview…')).toHaveAttribute('role', 'status')       // review M-9
    later.resolve()
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    await waitFor(() => expect(posted(PUBLISH_PATH)).toHaveLength(1))
    expect(posted(PUBLISH_PATH)[0].body.imagesOn).toEqual([IMAGE.src])
  })

  it('P3b-T5-R9: after a failed re-run Submit stays off until a preview of the current switches is on screen', async () => {
    previewAnswer = (body) => {
      if ((body?.imagesOn || []).length) return [500, {}]
      return { ...withoutImages(PREVIEW), images: PREVIEW.images.map((i) => ({ ...i, ocr: 'no_text', warnings: [] })) }
    }
    open()
    const dialog = await sheet()
    const submit = within(dialog).getByRole('button', { name: 'Submit for review' })
    await waitFor(() => expect(submit).not.toBeDisabled())
    const sw = within(dialog).getByRole('switch', { name: SHARE_IMAGE_LABEL })
    fireEvent.click(sw)
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(posted(PUBLISH_PATH)).toHaveLength(0)
    fireEvent.click(sw)                                                            // back to what is on screen
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(submit)
    await waitFor(() => expect(posted(PUBLISH_PATH)).toHaveLength(1))
    expect(posted(PUBLISH_PATH)[0].body.imagesOn).toEqual([])
  })

  it('review M-1: an older answer that lands after a newer one never overwrites it', async () => {
    const first = deferred()
    const second = deferred()
    let n = 0
    previewAnswer = (body) => {
      n += 1
      const p = (body?.imagesOn || []).length ? PREVIEW : withoutImages(PREVIEW)
      const out = { ...p, images: p.images.map((i) => ({ ...i, ocr: 'no_text', warnings: [] })) }
      if (n === 1) return out                                                       // the opening answer
      return (n === 2 ? first : second).promise.then(() => out)
    }
    open()
    const dialog = await sheet()
    const sw = await within(dialog).findByRole('switch', { name: SHARE_IMAGE_LABEL })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Submit for review' })).not.toBeDisabled())
    fireEvent.click(sw)                                                            // on: answer 2, held
    fireEvent.click(sw)                                                            // off again: answer 3, held
    await waitFor(() => expect(posted(PREVIEW_PATH)).toHaveLength(3))
    second.resolve()                                                               // the NEWEST lands first
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Submit for review' })).not.toBeDisabled())
    first.resolve()                                                                // then the stale one
    await new Promise((r) => setTimeout(r, 20))
    expect(dialog.querySelector('[data-template-preview-body] img')).toBeNull()   // still the newest: image off
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(posted(PUBLISH_PATH)).toHaveLength(1))
    expect(posted(PUBLISH_PATH)[0].body.imagesOn).toEqual([])
  })

  it('review M-2: the second question is skipped ONLY for an image read clean or read and found to hold no text', () => {
    expect(needsSecondConfirm({ ocr: 'ready', warnings: [] })).toBe(false)
    expect(needsSecondConfirm({ ocr: 'no_text', warnings: [] })).toBe(false)
    expect(needsSecondConfirm({ ocr: 'ready', warnings: [{ kind: 'money', match: '$1' }] })).toBe(true)
    for (const ocr of ['processing', 'unavailable', undefined, '', 'some_state_added_later']) {
      expect(needsSecondConfirm({ ocr, warnings: [] })).toBe(true)
    }
  })

  it('8. every control has an accessible name', async () => {
    open()
    const dialog = await sheet()
    await within(dialog).findAllByRole('switch')
    const controls = [
      ...within(dialog).getAllByRole('button'),
      ...within(dialog).getAllByRole('switch'),
      ...within(dialog).getAllByRole('textbox'),
    ]
    expect(controls.length).toBeGreaterThan(3)
    for (const c of controls) expect(c).toHaveAccessibleName()
  })

  it('8. every control class reaches var(--tap-min) at the touch tier (<= 1024px)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/journal-2-0/components/notebook/styles/ExampleNote.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const touch = /@media \(max-width: 1024px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] || ''
    expect(touch).not.toBe('')
    const pinned = new Set()
    for (const [, sel, body] of touch.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/min-height:\s*var\(--tap-min\)/.test(body)) continue
      for (const part of sel.split(',')) pinned.add(part.trim().match(/\.[A-Za-z][\w-]*(?![\s\S]*\.)/)?.[0])
    }
    for (const cls of ['.btn', '.switch', '.noteRow', '.search', '.titleInput']) expect(pinned).toContain(cls)
  })
})
