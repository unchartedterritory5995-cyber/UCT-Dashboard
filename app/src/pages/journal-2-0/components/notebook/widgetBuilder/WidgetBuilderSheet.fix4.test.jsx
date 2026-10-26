// Wave 8 (Task 8.15 fix 4): the third re-review's findings, each with a test that fails without its fix.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS, RESUME_OFFER, SAVED_NOT_IN_NOTE, KEEP_QUESTION } from './WidgetBuilderSheet'
import { DRAFT_PREFIX } from './builderDraft'
import { openWidgetBuilder } from './openWidgetBuilder'
import { blankPlan } from './builderState'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { installFetch, answer, refusal, deferred, payload, callsTo, bodyOf, SUMMARY } from './__fixtures__/builderFixtures'

// The breakpoint hooks, per test: a phone width for the keyboard tests (NEW-3), with a fine or a coarse pointer.
const bp = vi.hoisted(() => ({ phone: false, coarse: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.phone, useIsTablet: () => false, useIsDesktop: () => !bp.phone,
  useHasCoarsePointer: () => bp.coarse, useHasNoHover: () => bp.coarse,
}))

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

let routes
let spy
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  bp.phone = false
  bp.coarse = false
  ;({ routes, spy } = installFetch())
})
const opened = []
afterEach(async () => {
  // Every door this file opened is closed, so the next test's door is its own (one builder at a time).
  for (const close of opened.splice(0)) act(() => close())
  await flush()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.querySelectorAll('[data-widget-builder-root]').forEach((n) => n.remove())
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
const DEFS = '/api/j2/widget-definitions'
const draft = () => JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}u1`) || 'null')
const SAVED = { id: 'd-1', name: 'Mine', rev: 3, placedRev: 3, etag: 7, archived: false, usedIn: 1, lastAnswer: null,
  summary: SUMMARY, plan: { ...blankPlan(), measures: [{ key: 'net_pnl' }] } }
/** The new widget a POST saves: d-9, etag 7. */
const NEW_SAVED = { ...SAVED, id: 'd-9', rev: 1, usedIn: 0 }
const posts = () => callsTo(spy, 'POST', (u) => u === DEFS)
const puts = (id) => callsTo(spy, 'PUT', (u) => u.endsWith(`/${id}`))
const name = (v) => fireEvent.change(screen.getByLabelText('Name'), { target: { value: v } })
const clickSave = () => fireEvent.click(screen.getByTestId('builder-save'))

function door(from = null) {
  const handlers = new Map()
  const editor = { isEditable: true, storage: { uctJournalWidgets: { uid: 'u1', noteId: 'n-1' } },
    on: (e, fn) => handlers.set(e, fn), off: (e) => handlers.delete(e),
    chain: () => ({ insertWidgetEmbed: () => ({ run: () => true }) }),
    state: { doc: { nodeAt: () => null, descendants: () => {} } }, view: { nodeDOM: () => null } }
  return { editor, handlers, leave: () => act(() => handlers.get('destroy')()), open: async () => {
    act(() => { opened.push(openWidgetBuilder({ editor, from, uid: 'u1' })) })
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
  } }
}

/** A new widget saved, but its placement owed (the run failed): the state NEW-1 is about. */
async function savedButOwed(d) {
  route('POST', (u) => u === DEFS, () => answer(NEW_SAVED))
  route('POST', (u) => u.endsWith('/run'), () => refusal(503, 'busy', 'x'))
  name('Owed')
  clickSave()
  await flush()
  expect(screen.getByRole('alert')).toHaveTextContent('Your widget is saved')
  expect(posts()).toHaveLength(1)
  return d
}

describe('Task 8.15 fix 4, NEW-1: edits after a save whose placement is owed', () => {
  it('owed, then edit, then Escape: the keep question appears, and Keep stores a draft for that widget', async () => {
    const onClose = vi.fn()
    render(<WidgetBuilderSheet uid="u1" onClose={onClose} editor={door().editor} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    await savedButOwed()
    name('Since')                                                     // edited after the save
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByText(KEEP_QUESTION)).toBeInTheDocument()       // never closed with the edit lost
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(onClose).toHaveBeenCalled()
    const d = draft()
    expect(d.target).toBe('d-9')                                      // that saved widget's draft, not a new one
    expect(d.etag).toBe(7)
    expect(d.plan.display.title).toBe('Since')
  })

  it('owed, then edit, then leave: a draft for that widget is kept, and resuming it PUTs (no second POST)', async () => {
    const d = door()
    await d.open()
    await savedButOwed(d)
    name('Since')
    d.leave()
    await flush()
    expect(draft()).toMatchObject({ target: 'd-9', etag: 7 })
    expect(draft().plan.display.title).toBe('Since')
    // Reopened from that widget (My tools' Edit): the kept edits are offered, and saving them edits d-9.
    route('GET', (u) => u.endsWith(`${DEFS}/d-9`), () => answer(NEW_SAVED))
    route('PUT', (u) => u.endsWith('/d-9'), () => answer({ ...NEW_SAVED, rev: 2, etag: 8 }))
    await door({ defId: 'd-9', getPos: null }).open()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Since')
    clickSave()
    await flush()
    const put = puts('d-9')
    expect(put).toHaveLength(1)
    expect(put[0][1].headers['If-Match']).toBe('7')
    expect(bodyOf(put[0]).plan.display.title).toBe('Since')
    expect(posts()).toHaveLength(1)                                   // the first save only: no duplicate widget
    expect(draft()).toBeNull()
  })

  it('edits made while the first save is out, then a leave: once it lands, they are kept for the saved widget', async () => {
    const post = deferred()
    route('POST', (u) => u === DEFS, () => post.promise)
    const d = door()
    await d.open()
    name('First')
    clickSave()
    await flush()
    name('More')                                                      // typed while the POST is out
    d.leave()
    await flush()
    expect(draft()).toMatchObject({ target: null })
    await act(async () => { post.resolve(NEW_SAVED) })
    await flush()
    expect(draft()).toMatchObject({ target: 'd-9', etag: 7 })        // the saved widget's now: resuming PUTs
    expect(draft().plan.display.title).toBe('More')
    await door().open()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()               // never offered as a new widget again
  })

  it('the edits-since PUT fails after a leave: the draft for that widget is kept', async () => {
    const d = door()
    await d.open()
    await savedButOwed(d)
    const put = deferred()
    route('PUT', (u) => u.endsWith('/d-9'), () => put.promise)
    name('Since')
    clickSave()                                                       // saves the edits since, first
    await flush()
    d.leave()                                                         // ...and the member leaves while it is out
    await flush()
    await act(async () => { put.resolve({ detail: { code: 'failed', message: '' } }, 500) })
    await flush()
    expect(draft()).toMatchObject({ target: 'd-9', etag: 7 })
    expect(draft().plan.display.title).toBe('Since')
  })

  it('the edits-since PUT lands after a leave: nothing is kept (it is saved)', async () => {
    const d = door()
    await d.open()
    await savedButOwed(d)
    const put = deferred()
    route('PUT', (u) => u.endsWith('/d-9'), () => put.promise)
    name('Since')
    clickSave()
    await flush()
    d.leave()
    await flush()
    expect(draft()).not.toBeNull()
    await act(async () => { put.resolve({ ...NEW_SAVED, rev: 2, etag: 8 }) })
    await flush()
    expect(draft()).toBeNull()
  })

  it('owed with no further edits: Escape closes at once and nothing is stored', async () => {
    const onClose = vi.fn()
    render(<WidgetBuilderSheet uid="u1" onClose={onClose} editor={door().editor} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    await savedButOwed()
    name('Changed')
    name('Owed')                                                      // back to exactly what was saved
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByText(KEEP_QUESTION)).toBeNull()
    expect(onClose).toHaveBeenCalled()
    expect(draft()).toBeNull()
  })
})

describe('Task 8.15 fix 4, NEW-2: the saved-but-gone state', () => {
  it('Undo, Redo and the range suggestion are aria-disabled, and focus moves to Close', async () => {
    const editor = { isEditable: true, storage: {}, chain: () => ({}), state: { doc: { nodeAt: () => null } }, view: {} }
    const allTime = { ...SAVED, plan: { ...SAVED.plan, range: { token: 'all' } } }
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(allTime))
    route('POST', (u) => u.endsWith('/preview'), () => refusal(400, 'too_long'))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...allTime, rev: 4 }))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-1', defRev: 4 })))
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} editor={editor} from={{ defId: 'd-1', getPos: () => 3 }} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    const suggest = screen.getByRole('button', { name: 'Last 90 days' })
    expect(suggest).not.toHaveAttribute('aria-disabled')
    const field = screen.getByLabelText('Name')
    name('Before')
    act(() => { field.focus() })                                      // focus is inside the sections
    expect(screen.getByRole('button', { name: 'Undo' })).not.toHaveAttribute('aria-disabled')
    clickSave()
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(SAVED_NOT_IN_NOTE)
    const closeBtn = screen.getByTestId('builder-save')
    expect(closeBtn).toHaveTextContent('Close')
    expect(document.activeElement).toBe(closeBtn)                     // never left inside the inert sections
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute('aria-disabled', 'true')
    const after = screen.getByRole('button', { name: 'Last 90 days' })
    expect(after).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(after)
    expect(screen.getByLabelText('Name')).toHaveValue('Before')       // neither takes anything
  })
})

describe('Task 8.15 fix 4, NEW-3: the screen seeds the keyboard baseline only where a soft keyboard can exist', () => {
  function installViewport(height) {
    const vv = { height, addEventListener: () => {}, removeEventListener: () => {} }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
  }
  const SCREEN_KEYS = ['orientation', 'width', 'height']
  let note
  beforeEach(() => {
    bp.phone = true
    // A narrow desktop window on a 1920 x 1080 screen, the window and the visual viewport the same height.
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { type: 'landscape-primary' } })
    Object.defineProperty(window.screen, 'width', { configurable: true, value: 1920 })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 1080 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 780 })
    installViewport(780)
    // Opened from the note itself: a focused contenteditable.
    note = document.createElement('div')
    note.setAttribute('contenteditable', 'true')
    note.tabIndex = 0
    document.body.appendChild(note)
    note.focus()
  })
  afterEach(() => {
    note.remove()
    delete window.visualViewport
    for (const k of SCREEN_KEYS) delete window.screen[k]
  })
  async function openFocused() {
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    act(() => { screen.getByLabelText('Name').focus() })
  }

  it('a fine pointer keeps the preview (no phantom keyboard from the screen)', async () => {
    bp.coarse = false
    await openFocused()
    expect(screen.getByTestId('builder-summary-bar')).toBeInTheDocument()
  })

  it('control: the same window with a coarse pointer reads the keyboard as up (the contenteditable counts)', async () => {
    bp.coarse = true
    await openFocused()
    expect(screen.queryByTestId('builder-summary-bar')).toBeNull()
  })
})

describe('Task 8.15 fix 4, NEW-4: a save that fails after a leave keeps the draft', () => {
  it('POST: leave during the save, the save fails, and the draft is kept (and offered)', async () => {
    const post = deferred()
    route('POST', (u) => u === DEFS, () => post.promise)
    const d = door()
    await d.open()
    name('Unsaved')
    clickSave()
    await flush()
    d.leave()
    await flush()
    await act(async () => { post.resolve({ detail: { code: 'failed', message: '' } }, 500) })
    await flush()
    expect(draft()).toMatchObject({ target: null })
    expect(draft().plan.display.title).toBe('Unsaved')
    await door().open()
    expect(screen.getByText(RESUME_OFFER)).toBeInTheDocument()
  })

  it('PUT: leave during the save, the save fails, and the draft is kept', async () => {
    const put = deferred()
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), () => put.promise)
    const d = door({ defId: 'd-1', getPos: null })
    await d.open()
    name('Unsaved edit')
    clickSave()
    await flush()
    d.leave()
    await flush()
    await act(async () => { put.resolve({ detail: { code: 'failed', message: '' } }, 500) })
    await flush()
    expect(draft()).toMatchObject({ target: 'd-1', etag: 7 })
    expect(draft().plan.display.title).toBe('Unsaved edit')
  })
})

describe('Task 8.15 fix 4, NEW-5: drafts carry their open, and a reopen waits for a save still out', () => {
  async function leaveWhilePosting() {
    const post = deferred()
    route('POST', (u) => u === DEFS, () => post.promise)
    route('POST', (u) => u.endsWith('/run'), () => answer(payload()))
    const a = door()
    await a.open()
    name('First')
    clickSave()
    await flush()
    a.leave()
    await flush()
    expect(draft().session).toEqual(expect.any(String))
    return post
  }

  it('a reopen while the save is out holds the offer; the save lands, and none is ever offered', async () => {
    const post = await leaveWhilePosting()
    await door().open()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()               // held: resuming now could save twice
    await act(async () => { post.resolve(NEW_SAVED) })
    await flush()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
    expect(draft()).toBeNull()
    expect(posts()).toHaveLength(1)
  })

  it('a reopen while the save is out holds the offer; the save fails, and then it is offered', async () => {
    const post = await leaveWhilePosting()
    await door().open()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
    const field = screen.getByLabelText('Name')
    act(() => { field.focus() })
    name('Typing')                                                    // the member has started meanwhile
    await act(async () => { post.resolve({ detail: { code: 'failed', message: '' } }, 500) })
    await flush()
    expect(screen.getByText(RESUME_OFFER)).toBeInTheDocument()
    expect(document.activeElement).toBe(field)                        // the late offer never takes their focus
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByLabelText('Name')).toHaveValue('First')
  })

  it('the late settle of the first open clears only its own draft, never one a later open kept', async () => {
    const post = await leaveWhilePosting()
    const b = door()
    await b.open()
    name('Second')                                                    // the later open's own work...
    b.leave()                                                         // ...kept as ITS draft
    await flush()
    const mine = draft().session
    await act(async () => { post.resolve(NEW_SAVED) })                // the first open's save lands late
    await flush()
    expect(draft()).toMatchObject({ session: mine, target: null })    // untouched: not cleared, not retargeted
    expect(draft().plan.display.title).toBe('Second')
  })

  it('an edit saved while the reopen waits: the builder reopens on the newer version, nothing offered', async () => {
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
    const gets = () => callsTo(spy, 'GET', (u) => u.endsWith(`${DEFS}/d-1`)).length
    await door({ defId: 'd-1', getPos: null }).open()
    expect(gets()).toBe(2)
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer({ ...SAVED, name: 'Edited', rev: 4, etag: 8 }))
    await act(async () => { put.resolve({ ...SAVED, rev: 4, etag: 8 }) })
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    expect(gets()).toBe(3)                                            // reread, so it edits etag 8, never 7
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
    expect(draft()).toBeNull()
  })
})
