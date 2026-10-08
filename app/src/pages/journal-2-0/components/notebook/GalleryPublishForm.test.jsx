// GalleryPublishForm: "Share to the community gallery" for one of Your templates. The form
// tells the member, in words, what will and will not leave their account, then submits for
// review. Every server answer here is the REAL one (contract fixtures) through a fake `fetch`.
//
// ⛔ Feedback is asserted by RENDERED TEXT (the sentence in the alert, the sentence handed up
// for the status line), never by a state setter having been called.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import GalleryPublishForm from './GalleryPublishForm'
import { GALLERY_CATEGORIES, GALLERY_KEY, REPORT_REASONS } from '../../lib/templateGallery'
import { contract, contractBody, contractResponse, nonJsonResponse } from '../../__fixtures__/contract'

const TEMPLATE = { id: 'tg-template', name: 'My checklist' }
const SENT = contract('template-gallery.publish')._contract.requestBody

let calls
let server
let onDone
let onCancel
beforeEach(() => {
  calls = []
  onDone = vi.fn()
  onCancel = vi.fn()
  server = () => contractResponse('template-gallery.publish')
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, init }
    calls.push(call)
    return server(call)
  })
})
afterEach(() => vi.restoreAllMocks())

const renderForm = (template = TEMPLATE) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <GalleryPublishForm template={template} onDone={onDone} onCancel={onCancel} />
  </SWRConfig>,
)
const title = () => screen.getByLabelText('Title in the gallery')
const description = () => screen.getByLabelText("What it's for (optional)")
const category = () => screen.getByLabelText('Category')
const submit = () => screen.getByRole('button', { name: 'Submit for review' })
const posts = () => calls.filter((c) => c.method === 'POST')

async function fill(user, { titleText = SENT.title, descriptionText = SENT.description, categoryKey = SENT.category } = {}) {
  await user.clear(title())
  if (titleText) await user.type(title(), titleText)
  if (descriptionText) await user.type(description(), descriptionText)
  if (categoryKey) await user.selectOptions(category(), categoryKey)
}

describe('what the member sees before submitting', () => {
  it('names the template in the form\'s label and starts the title from its name', () => {
    renderForm()
    expect(screen.getByRole('form', { name: 'Share My checklist to the community gallery' })).toBeInTheDocument()
    expect(title()).toHaveValue('My checklist')
    expect(description()).toHaveValue('')
    expect(category()).toHaveValue('')
  })

  it('says what is shared, what is left out, and that a reviewer approves it first', () => {
    renderForm()
    const note = screen.getByText(/Shared under your display name/)
    expect(note).toHaveTextContent("Shared under your display name: the template's text and the names of its properties.")
    expect(note).toHaveTextContent(
      'Left out: links to your other notes, images and attachments, Ask answers, email addresses and every property value.')
    expect(note).toHaveTextContent(
      'A UCT reviewer approves it before other members can see it, and you can unpublish it at any time.')
    expect(submit()).toHaveAccessibleDescription(/Left out: links to your other notes/)
  })

  it('offers exactly the categories the server accepts, in the server\'s order', () => {
    renderForm()
    const { categories, reportReasons } = contractBody('constants.template-gallery')
    const offered = within(category()).getAllByRole('option').map((o) => o.value)
    expect(offered).toEqual(['', ...categories])
    expect(within(category()).getAllByRole('option')[0]).toHaveTextContent('Choose a category')
    expect(GALLERY_CATEGORIES.map((c) => c.key)).toEqual(categories)
    expect(REPORT_REASONS.map((r) => r.key)).toEqual(reportReasons)
    for (const c of GALLERY_CATEGORIES) expect(within(category()).getByRole('option', { name: c.label })).toBeInTheDocument()
  })

  it('caps the title and the description at the lengths it shows room for', () => {
    renderForm()
    expect(title()).toHaveAttribute('maxLength', '80')
    expect(description()).toHaveAttribute('maxLength', '280')
  })

  it('survives a template with no name', () => {
    renderForm({ id: 'x', name: '' })
    expect(title()).toHaveValue('')
    expect(submit()).toBeDisabled()
  })
})

describe('when Submit is allowed', () => {
  it('is disabled until a category is chosen, and nothing is sent by pressing Enter', async () => {
    const user = userEvent.setup()
    renderForm()
    expect(submit()).toBeDisabled()
    await user.type(title(), '{Enter}')
    expect(posts()).toHaveLength(0)
    await user.selectOptions(category(), 'journal')
    expect(submit()).toBeEnabled()
    await user.selectOptions(category(), '')
    expect(submit()).toBeDisabled()
  })

  it('is disabled for a title that is only spaces', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.selectOptions(category(), 'journal')
    await user.clear(title())
    expect(submit()).toBeDisabled()
    await user.type(title(), '   ')
    expect(submit()).toBeDisabled()
    fireEvent.submit(screen.getByRole('form'))                 // the handler refuses it too
    expect(posts()).toHaveLength(0)
    await user.type(title(), 'x')
    expect(submit()).toBeEnabled()
  })
})

describe('submitting', () => {
  it('sends exactly the four fields the server reads, to the gallery route', async () => {
    const user = userEvent.setup()
    renderForm()
    await fill(user)
    await user.click(submit())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(posts()).toHaveLength(1)
    expect(posts()[0].url).toBe(GALLERY_KEY)
    expect(posts()[0].url).toBe(contract('template-gallery.publish')._contract.path)
    expect(posts()[0].body).toEqual(SENT)                      // the body the fixture was recorded with
    expect(posts()[0].init.credentials).toBe('include')
    expect(posts()[0].init.headers['Content-Type']).toBe('application/json')
  })

  it('hands up the sentence the member reads, built from the title the SERVER stored', async () => {
    const user = userEvent.setup()
    renderForm()
    await fill(user)
    await user.click(submit())
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const stored = contractBody('template-gallery.publish').template.title
    expect(onDone).toHaveBeenCalledWith(
      `Submitted “${stored}” for review. You'll see it under Your submissions in the community gallery.`)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses the server\'s title in that sentence, not what was typed', async () => {
    const user = userEvent.setup()
    server = () => {
      const res = contractResponse('template-gallery.publish')
      return { ...res, json: async () => { const b = await res.json(); b.template.title = 'Cleaned title'; return b } }
    }
    renderForm()
    await fill(user, { titleText: '  messy   title ' })
    await user.click(submit())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone.mock.calls[0][0]).toContain('Submitted “Cleaned title” for review.')
  })

  it('sends an empty description as an empty string when the member leaves it blank', async () => {
    const user = userEvent.setup()
    renderForm()
    await fill(user, { descriptionText: '' })
    await user.click(submit())
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body.description).toBe('')
  })

  it('cannot be sent twice while the first request is still out', async () => {
    const user = userEvent.setup()
    let release
    server = () => new Promise((resolve) => { release = () => resolve(contractResponse('template-gallery.publish')) })
    renderForm()
    await fill(user)
    await user.click(submit())
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(submit()).toBeDisabled()
    await user.click(submit())
    await user.type(title(), '{Enter}')
    // The disabled button is one guard; the handler's own check is the other. A submit that
    // reaches the form anyway (requestSubmit, an extension, a second listener) sends nothing.
    fireEvent.submit(screen.getByRole('form'))
    expect(posts()).toHaveLength(1)
    expect(onDone).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('Cancel closes without sending anything', async () => {
    const user = userEvent.setup()
    renderForm()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(0)
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('when the server refuses', () => {
  async function refusedWith(name, user = userEvent.setup()) {
    server = () => contractResponse(name)
    renderForm()
    await fill(user)
    await user.click(submit())
    return screen.findByRole('alert')
  }

  it.each([
    ['a category it does not accept', 'template-gallery.publish.bad-category'],
    ['a blank title', 'template-gallery.publish.no-title'],
    ['a free plan', 'template-gallery.publish.free-plan'],
  ])('shows the server\'s own sentence for %s', async (_label, name) => {
    const sentence = contractBody(name).detail
    expect(sentence.length).toBeGreaterThan(20)                // non-vacuity: a real sentence
    const alert = await refusedWith(name)
    expect(alert).toHaveTextContent(sentence)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('keeps what was typed and lets the member try again', async () => {
    const user = userEvent.setup()
    await refusedWith('template-gallery.publish.bad-category', user)
    expect(title()).toHaveValue(SENT.title)
    expect(description()).toHaveValue(SENT.description)
    expect(category()).toHaveValue(SENT.category)
    expect(submit()).toBeEnabled()
    server = () => contractResponse('template-gallery.publish')
    await user.click(submit())
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(posts()).toHaveLength(2)
  })

  it('clears the old refusal as soon as the next attempt starts', async () => {
    const user = userEvent.setup()
    await refusedWith('template-gallery.publish.bad-category', user)
    let release
    server = () => new Promise((resolve) => { release = () => resolve(contractResponse('template-gallery.publish')) })
    await user.click(submit())
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    release()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('never says "Submitted" for a template that is gone', async () => {
    const alert = await refusedWith('template-gallery.publish.unknown-template')
    expect(alert).toHaveTextContent(contractBody('template-gallery.publish.unknown-template').detail)
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.queryByText(/Submitted/)).not.toBeInTheDocument()
  })

  // D4 (docs/notebook/fin-tests.md), fixed: a failure with no sentence from the server used to
  // show the client's own technical string. It now shows the plain sentence.
  const PLAIN = "Couldn't submit that template. Nothing was shared."

  it.each([
    ['a gateway error page (not JSON)', () => nonJsonResponse(502)],
    ['an error with a JSON body and no detail', () => ({ ok: false, status: 500, json: async () => ({}) })],
    ['an error whose detail is not a sentence', () => ({ ok: false, status: 422, json: async () => ({ detail: [{ msg: 'x' }] }) })],
    ['a dropped connection', () => { throw new TypeError('Failed to fetch') }],
    ['a failure with no message at all', () => { throw new Error('') }],
  ])('says the plain sentence for %s, never a technical string', async (_label, respond) => {
    const user = userEvent.setup()
    server = respond
    renderForm()
    await fill(user)
    await user.click(submit())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(PLAIN)
    expect(alert.textContent).not.toMatch(/request failed|Failed to fetch|502|object Object/)
    expect(submit()).toBeEnabled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('still prefers the server sentence whenever there is one, whatever the status', async () => {
    for (const name of ['template-gallery.publish.bad-category', 'template-gallery.publish.free-plan']) {
      const alert = await refusedWith(name)
      expect(alert.textContent).toBe(contractBody(name).detail)
      expect(alert.textContent).not.toBe(PLAIN)
      cleanup()
    }
  })
})
