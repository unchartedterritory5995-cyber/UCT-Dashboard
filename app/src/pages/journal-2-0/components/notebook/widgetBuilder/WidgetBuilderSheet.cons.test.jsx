/* global process */
// Wave 8 consolidation (part A): the last lost-work and accuracy findings of 8.15 (M-1, M-2, M-4, M-5) and 8.16 (N1, N2),
// each with a test that fails without its fix. Asserted by rendered text, focus and the requests on the wire.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import WidgetBuilderSheet, {
  PREVIEW_DEBOUNCE_MS, RESUME_OFFER, KEEP_QUESTION, BACK_TO_EXAMPLES, STALE_DRAFT, SAVED_NOT_PLACED,
  SAVED_EDITS_KEPT,
} from './WidgetBuilderSheet'
import { DRAFT_PREFIX, writeDraft, __forgetSavesInFlight } from './builderDraft'
import { openWidgetBuilder } from './openWidgetBuilder'
import { blankPlan } from './builderState'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import {
  installFetch, answer, refusal, deferred, payload, callsTo, SUMMARY, CATALOG,
} from './__fixtures__/builderFixtures'

vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 8 }))

const SHELF = JSON.parse(readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'widget_engine',
  'shelf.json'), 'utf8')).examples
const DEFS = '/api/j2/widget-definitions'
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

let routes
let spy
const opened = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  ;({ routes, spy } = installFetch())
  routes.unshift(['GET', (u) => u === `${DEFS}/shelf`, () => answer({ examples: SHELF })])
})
afterEach(async () => {
  for (const close of opened.splice(0)) act(() => close())
  await flush()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.querySelectorAll('[data-widget-builder-root]').forEach((n) => n.remove())
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
const draft = () => JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}u1`) || 'null')
const SAVED = { id: 'd-1', name: 'Mine', rev: 3, placedRev: 3, etag: 7, archived: false, usedIn: 1, lastAnswer: null,
  summary: SUMMARY, plan: { ...blankPlan(), measures: [{ key: 'net_pnl' }] } }
const NEW_SAVED = { ...SAVED, id: 'd-9', name: 'First', rev: 1, usedIn: 0 }
const name = (v) => fireEvent.change(screen.getByLabelText('Name'), { target: { value: v } })
const clickSave = () => fireEvent.click(screen.getByTestId('builder-save'))
const posts = () => callsTo(spy, 'POST', (u) => u === DEFS)
const keyOf = (call) => call[1].headers['Idempotency-Key']
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const gets = (id) => callsTo(spy, 'GET', (u) => u.endsWith(`${DEFS}/${id}`)).length

/** A note editor and its door (openWidgetBuilder), which can be left (the editor destroyed). */
function door(from = null, start = undefined) {
  const handlers = new Map()
  const editor = { isEditable: true, storage: { uctJournalWidgets: { uid: 'u1', noteId: 'n-1' } },
    on: (e, fn) => handlers.set(e, fn), off: (e) => handlers.delete(e),
    chain: () => ({ insertWidgetEmbed: () => ({ run: () => true }) }),
    state: { doc: { nodeAt: () => null, descendants: () => {} } }, view: { nodeDOM: () => null } }
  return {
    editor, leave: () => act(() => handlers.get('destroy')()),
    open: async () => {
      act(() => { opened.push(openWidgetBuilder({ editor, from, uid: 'u1', ...(start ? { start } : {}) })) })
      await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    },
  }
}

async function openGallery(props = {}) {
  const onClose = vi.fn()
  render(<WidgetBuilderSheet uid="u1" onClose={onClose} start="examples" {...props} />)
  await flush()
  await flush()
  return { onClose }
}

/** Draft A: a new widget's kept work, from another open (session "s-A"). */
function keepDraftA() {
  writeDraft('u1', {
    target: null, nameTouched: true, session: 's-A',
    plan: { v: 1, source: 'closed_trades', range: { token: 'last_30d' }, measures: [{ key: 'net_pnl' }],
      display: { title: 'Draft A', titleAuto: false } },
  }, Date.now() - 60000)
}

describe('8.16 N1: "Discard them" never deletes a draft the member did not choose', () => {
  it('draft A offered; open a card, edit, Back, Discard: draft A is still stored AND still offered', async () => {
    keepDraftA()
    await openGallery()
    const gallery = screen.getByTestId('examples-gallery')
    expect(within(gallery).getByText(RESUME_OFFER)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('example-card-shelf:profit-factor'))      // not Resume: a card
    await flush()
    name('My PF')
    fireEvent.click(screen.getByRole('button', { name: BACK_TO_EXAMPLES }))
    expect(screen.getByText(KEEP_QUESTION)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    await flush()
    expect(draft()).toMatchObject({ session: 's-A', target: null })
    expect(draft().plan.display.title).toBe('Draft A')
    expect(within(screen.getByTestId('examples-gallery')).getByText(RESUME_OFFER)).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('examples-gallery')).getByRole('button', { name: 'Resume' }))
    await flush()
    expect(screen.getByLabelText('Name')).toHaveValue('Draft A')                 // the very draft A, intact
  })

  it('control: the member RESUMED draft A, edited, and discarded: then it is theirs, and it goes', async () => {
    keepDraftA()
    await openGallery()
    fireEvent.click(within(screen.getByTestId('examples-gallery')).getByRole('button', { name: 'Resume' }))
    await flush()
    name('Draft A, more')
    fireEvent.click(screen.getByRole('button', { name: BACK_TO_EXAMPLES }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    await flush()
    expect(draft()).toBeNull()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
  })

  it('the closing "Discard them" keeps an unchosen draft too (one button, one meaning)', async () => {
    keepDraftA()
    const { onClose } = await openGallery()
    fireEvent.click(screen.getByTestId('example-card-shelf:profit-factor'))
    await flush()
    name('My PF')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))              // the sheet's X
    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    expect(onClose).toHaveBeenCalled()
    expect(draft()).toMatchObject({ session: 's-A' })
  })
})

describe('8.16 N2: X or the backdrop while "Back to examples" asks', () => {
  async function onBackQuestion() {
    const res = await openGallery()
    fireEvent.click(screen.getByTestId('example-card-shelf:profit-factor'))
    await flush()
    name('My PF')
    fireEvent.click(screen.getByRole('button', { name: BACK_TO_EXAMPLES }))
    expect(screen.getByText(KEEP_QUESTION)).toBeInTheDocument()
    return res
  }

  it('X switches to the closing question, whose "Keep my changes" CLOSES the sheet (and keeps the draft)', async () => {
    const { onClose } = await onBackQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText(KEEP_QUESTION)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(onClose).toHaveBeenCalledTimes(1)                                     // closed, not a trip to the gallery
    expect(draft().plan.display.title).toBe('My PF')
  })

  it('the backdrop does the same', async () => {
    const { onClose } = await onBackQuestion()
    const backdrop = document.querySelector('[data-sheet-panel]').parentElement
    fireEvent.mouseDown(backdrop, { target: backdrop })
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('examples-gallery')).not.toBeVisible()
  })

  it('control: with no X, the Back question\'s "Keep my changes" still goes to the gallery, not closed', async () => {
    const { onClose } = await onBackQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    await flush()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('examples-gallery')).toBeVisible()
  })
})

describe('8.15 M-1 / M-2: a held offer never reloads or steals focus from a member at work', () => {
  /** Open A edits d-1 and leaves while its PUT is out; open B (the same widget) then waits on that PUT. */
  async function heldOnEdit() {
    const put = deferred()
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), () => put.promise)
    const a = door({ defId: 'd-1', getPos: null })
    await a.open()
    name('Edited')
    clickSave()
    await flush()
    a.leave()
    await flush()
    await door({ defId: 'd-1', getPos: null }).open()
    expect(gets('d-1')).toBe(2)
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer({ ...SAVED, name: 'Edited', rev: 4, etag: 8 }))
    return put
  }

  it('M-1: edited in the reopen, the newer version lands: no reload, and their words survive', async () => {
    const put = await heldOnEdit()
    name('Typed while waiting')
    await act(async () => { put.resolve({ ...SAVED, rev: 4, etag: 8 }) })
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    expect(gets('d-1')).toBe(2)                                                  // never reread under them
    expect(screen.getByLabelText('Name')).toHaveValue('Typed while waiting')
  })

  it('M-2: nothing edited, but focus moved into the sheet (a radio, arrowed): no reload either', async () => {
    const put = await heldOnEdit()
    const radio = screen.getByRole('radio', { name: 'Trading days' })
    act(() => { radio.focus() })
    await act(async () => { put.resolve({ ...SAVED, rev: 4, etag: 8 }) })
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    expect(gets('d-1')).toBe(2)
    expect(document.activeElement).toBe(radio)
  })

  it('M-2: a half-typed box that is not dispatched yet (the open date field) counts as work', async () => {
    const put = await heldOnEdit()
    const field = screen.getByLabelText('Name')
    act(() => { field.focus() })                                                 // in the field, nothing typed
    await act(async () => { put.resolve({ ...SAVED, rev: 4, etag: 8 }) })
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    expect(gets('d-1')).toBe(2)
    expect(document.activeElement).toBe(field)
  })

  it('control: untouched (focus where it was at open), the newer version lands and the builder rereads it', async () => {
    const put = await heldOnEdit()
    await act(async () => { put.resolve({ ...SAVED, rev: 4, etag: 8 }) })
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    expect(gets('d-1')).toBe(3)
  })

  it('M-2: "at work" is measured from where focus was at open (there: the X), so the offer shown at open still takes it', async () => {
    keepDraftA()
    const cat = deferred()
    route('GET', (u) => u.endsWith('/vocabulary'), () => cat.promise)
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
    await flush()
    const x = screen.getByRole('button', { name: 'Close' })
    act(() => { x.focus() })                                                     // focus was here as it opened
    await act(async () => { cat.resolve(CATALOG) })
    await flush()
    expect(screen.getByText(RESUME_OFFER)).toBeInTheDocument()
    expect(document.activeElement).toHaveTextContent('Resume')
  })

  it('M-2: a late offer (the held save failed) never takes focus from a control the member moved to', async () => {
    const post = deferred()
    route('POST', (u) => u === DEFS, () => post.promise)
    const a = door()
    await a.open()
    name('First')
    clickSave()
    await flush()
    a.leave()
    await flush()
    await door().open()
    const radio = screen.getByRole('radio', { name: 'Trading days' })
    act(() => { radio.focus() })                                                 // at work, nothing dispatched
    await act(async () => { post.resolve({ detail: { code: 'failed', message: '' } }, 500) })
    await flush()
    expect(screen.getByText(RESUME_OFFER)).toBeInTheDocument()
    expect(document.activeElement).toBe(radio)
  })
})

describe('8.15 M-4: asked to resume, the held save landed as a new widget: the member is told where it is', () => {
  async function leaveWhilePosting({ more = false } = {}) {
    const post = deferred()
    route('POST', (u) => u === DEFS, () => post.promise)
    route('POST', (u) => u.endsWith('/run'), () => answer(payload()))
    const a = door()
    await a.open()
    name('First')
    clickSave()
    await flush()
    if (more) name('More')
    a.leave()
    await flush()
    return post
  }

  it('says "Saved in My tools" with the widget\'s name, never a blank builder with nothing said', async () => {
    const post = await leaveWhilePosting()
    await door(null, 'resume').open()
    expect(screen.getByTestId('builder-notice')).toHaveTextContent('')
    await act(async () => { post.resolve(NEW_SAVED) })
    await flush()
    expect(screen.getByTestId('builder-notice')).toHaveTextContent('Saved in My tools as “First”.')
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
  })

  it('edits made after it went out were kept for it: the sentence says where they are', async () => {
    const post = await leaveWhilePosting({ more: true })
    await door(null, 'resume').open()
    await act(async () => { post.resolve(NEW_SAVED) })
    await flush()
    expect(draft()).toMatchObject({ target: 'd-9' })
    expect(screen.getByTestId('builder-notice')).toHaveTextContent(`Saved in My tools as “First”. ${SAVED_EDITS_KEPT}`)
  })

  it('control: opened without asking to resume, the same landing says nothing', async () => {
    const post = await leaveWhilePosting()
    await door().open()
    await act(async () => { post.resolve(NEW_SAVED) })
    await flush()
    expect(screen.getByTestId('builder-notice')).toHaveTextContent('')
  })
})

describe('8.15 M-5: a stale draft saved as a new widget, its place in the note still owed', () => {
  it('the stale banner goes and Save stops saying "Save as a new widget"', async () => {
    const node = { type: { name: 'widgetEmbed' }, attrs: { widgetId: 'builtWidget', params: { defId: 'd-1' } } }
    const editor = { isEditable: true, storage: { uctJournalWidgets: { uid: 'u1', noteId: 'n-1' } },
      state: { doc: { nodeAt: () => node, descendants: () => {} } }, view: { nodeDOM: () => null } }
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...SAVED, id: 'd-2', rev: 1, etag: 1, usedIn: 0 }))
    route('POST', (u) => u.endsWith('/run'), () => refusal(503, 'busy', 'Busy right now. Try again in a moment.'))
    window.localStorage.setItem(`${DRAFT_PREFIX}u1`, JSON.stringify({ v: 1, at: Date.now() - 60000,
      plan: { ...SAVED.plan, display: { ...SAVED.plan.display, title: 'Kept', titleAuto: false } }, nameTouched: true,
      target: 'd-1', etag: 5 }))
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} editor={editor} from={{ defId: 'd-1', getPos: () => 1 }} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByText(STALE_DRAFT)).toBeInTheDocument()
    expect(screen.getByTestId('builder-save')).toHaveTextContent('Save as a new widget')
    clickSave()
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(SAVED_NOT_PLACED)       // saved; its placement is owed
    expect(screen.queryByText(STALE_DRAFT)).toBeNull()
    expect(screen.getByTestId('builder-save')).toHaveTextContent(/^Save$/)
  })
})

describe('ruling R-43: the create POST carries one idempotency key, and a reload mid-POST never makes a second widget', () => {
  it('every create POST sends Idempotency-Key (a uuid4); a retry after a failure re-sends the SAME key', async () => {
    let n = 0
    route('POST', (u) => u === DEFS, () => { n += 1; return n === 1 ? refusal(500, 'failed') : answer(NEW_SAVED) })
    route('POST', (u) => u.endsWith('/run'), () => answer(payload()))
    await door().open()
    name('First')
    clickSave()
    await flush()
    clickSave()                                                                  // the first may have landed (a timeout)
    await flush()
    expect(posts()).toHaveLength(2)
    expect(keyOf(posts()[0])).toMatch(UUID4)
    expect(keyOf(posts()[1])).toBe(keyOf(posts()[0]))
    expect(callsTo(spy, 'POST', (u) => u.endsWith('/preview')).every((c) => !('Idempotency-Key' in c[1].headers))).toBe(true)
  })

  it('a reload mid-POST: resuming the draft re-sends the stored key and gets the SAME widget', async () => {
    route('POST', (u) => u === DEFS, () => new Promise(() => {}))                // the first POST never answers here
    route('POST', (u) => u.endsWith('/run'), () => answer(payload()))
    const a = door()
    await a.open()
    name('First')
    clickSave()
    await flush()
    a.leave()
    await flush()
    const sentKey = keyOf(posts()[0])
    expect(draft()).toMatchObject({ target: null, key: sentKey })               // the key is kept with the draft
    __forgetSavesInFlight()                                                      // the page reloads
    route('POST', (u) => u === DEFS, () => answer({ ...NEW_SAVED, replayed: true, samePlan: true, createdEtag: 7 }))
    await door().open()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    clickSave()
    await flush()
    expect(posts()).toHaveLength(2)
    expect(keyOf(posts()[1])).toBe(sentKey)                                      // the same key, so the same widget
    expect(callsTo(spy, 'PUT', () => true)).toHaveLength(0)                     // nothing newer to save to it
    const runs = callsTo(spy, 'POST', (u) => u.endsWith('/run'))
    expect(JSON.parse(runs[runs.length - 1][1].body).defId).toBe('d-9')          // and that widget is the one placed
    expect(draft()).toBeNull()
  })

  it('resumed, then edited further: the edits are saved to that same widget, If-Match the etag the key made it at', async () => {
    route('POST', (u) => u === DEFS, () => new Promise(() => {}))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload()))
    const a = door()
    await a.open()
    name('First')
    clickSave()
    await flush()
    a.leave()
    await flush()
    __forgetSavesInFlight()
    route('POST', (u) => u === DEFS, () => answer({ ...NEW_SAVED, etag: 9, replayed: true, samePlan: false, createdEtag: 7 }))
    route('PUT', (u) => u.endsWith('/d-9'), () => answer({ ...NEW_SAVED, rev: 2, etag: 10 }))
    await door().open()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    name('Later')
    clickSave()
    await flush()
    const put = callsTo(spy, 'PUT', (u) => u.endsWith('/d-9'))
    expect(put).toHaveLength(1)
    expect(put[0][1].headers['If-Match']).toBe('7')                             // a change since elsewhere conflicts
    expect(JSON.parse(put[0][1].body).plan.display.title).toBe('Later')
    expect(posts().map(keyOf)).toEqual([keyOf(posts()[0]), keyOf(posts()[0])])
  })

  it("a builder that has gone keeps those newer edits as that widget's draft, never drops them", async () => {
    const post = deferred()
    route('POST', (u) => u === DEFS, () => post.promise)
    const a = door()
    await a.open()
    name('Newer')
    clickSave()
    await flush()
    a.leave()
    await flush()
    await act(async () => { post.resolve({ ...NEW_SAVED, replayed: true, samePlan: false, createdEtag: 7 }) })
    await flush()
    expect(draft()).toMatchObject({ target: 'd-9', etag: 7, key: null })          // an edit of d-9 now, at etag 7
    expect(draft().plan.display.title).toBe('Newer')
  })

  it('a copy (a ready-made widget placed in the note) keeps its key too: a reload mid-POST never makes two copies', async () => {
    const from = { shelfId: 'shelf:profit-factor', getPos: null }
    route('POST', (u) => u === DEFS, () => new Promise(() => {}))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload()))
    const a = door(from)
    await a.open()
    name('My copy')
    clickSave()
    await flush()
    a.leave()
    await flush()
    const sentKey = keyOf(posts()[0])
    expect(draft()).toMatchObject({ target: 'shelf:profit-factor', key: sentKey })
    __forgetSavesInFlight()
    route('POST', (u) => u === DEFS, () => answer({ ...NEW_SAVED, replayed: true, samePlan: true, createdEtag: 7 }))
    await door(from).open()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    clickSave()
    await flush()
    expect(posts().map(keyOf)).toEqual([sentKey, sentKey])
  })

  it('a draft of a saved widget carries no create key (it is resumed as an edit)', async () => {
    route('POST', (u) => u === DEFS, () => answer(NEW_SAVED))
    route('POST', (u) => u.endsWith('/run'), () => refusal(503, 'busy', 'x'))
    const onClose = vi.fn()
    render(<WidgetBuilderSheet uid="u1" onClose={onClose} editor={door().editor} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    name('Owed')
    clickSave()
    await flush()
    name('Since')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(draft()).toMatchObject({ target: 'd-9', key: null })
  })
})
