// Wave 8 (Task 8.15 fix 3): the second re-review's findings, each with a test that fails without its fix.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS, RESUME_OFFER, STALE_DRAFT, SAVED_NOT_IN_NOTE } from './WidgetBuilderSheet'
import { DRAFT_PREFIX } from './builderDraft'
import { openWidgetBuilder } from './openWidgetBuilder'
import { fitView, indexCatalog, CHECK_TESTS, thenViews } from './builderCatalog'
import { blankPlan } from './builderState'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { installFetch, answer, refusal, deferred, payload, SUMMARY, CATALOG } from './__fixtures__/builderFixtures'

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  ;({ routes } = installFetch())
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

function door(from = null) {
  const handlers = new Map()
  const editor = { isEditable: true, storage: { uctJournalWidgets: { uid: 'u1', noteId: 'n-1' } },
    on: (e, fn) => handlers.set(e, fn), off: (e) => handlers.delete(e),
    chain: () => ({ insertWidgetEmbed: () => ({ run: () => true }) }),
    state: { doc: { nodeAt: () => null, descendants: () => {} } }, view: { nodeDOM: () => null } }
  return { editor, handlers, open: async () => {
    act(() => { opened.push(openWidgetBuilder({ editor, from, uid: 'u1' })) })
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
  } }
}

describe('Task 8.15 fix 3', () => {
  it('I-1: leaving while a NEW widget is saving keeps no draft once the save lands', async () => {
    const post = deferred()
    route('POST', (u) => u === DEFS, () => post.promise)
    route('POST', (u) => u.endsWith('/run'), () => answer(payload()))
    const d = door()
    await d.open()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saving' } })
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    act(() => d.handlers.get('destroy')())                       // the member leaves while the POST is out
    await flush()
    expect(draft()).not.toBeNull()                               // kept while the save could still fail...
    await act(async () => { post.resolve({ ...SAVED, id: 'd-9', rev: 1, usedIn: 0 }) })
    await flush()
    expect(draft()).toBeNull()                                   // ...and gone once it is saved
    await door().open()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()          // no second widget offered
  })

  it('I-1: the same for an edit (PUT): no stale reopen', async () => {
    const put = deferred()
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), () => put.promise)
    const d = door({ defId: 'd-1', getPos: null })
    await d.open()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edited' } })
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    act(() => d.handlers.get('destroy')())
    await flush()
    await act(async () => { put.resolve({ ...SAVED, rev: 4, etag: 8 }) })
    await flush()
    expect(draft()).toBeNull()
    await door({ defId: 'd-1', getPos: null }).open()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
    expect(screen.queryByText(STALE_DRAFT)).toBeNull()
  })

  it('I-1: a widget saved with its placement still owed writes no draft on leave', async () => {
    route('POST', (u) => u === DEFS, () => answer({ ...SAVED, id: 'd-9', rev: 1, usedIn: 0 }))
    route('POST', (u) => u.endsWith('/run'), () => refusal(503, 'busy', 'x'))
    const d = door()
    await d.open()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Owed' } })
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('Your widget is saved')
    act(() => d.handlers.get('destroy')())
    await flush()
    expect(draft()).toBeNull()
  })

  it('I-1: Escape with the placement owed closes at once (no "Keep your changes?" for saved work)', async () => {
    route('POST', (u) => u === DEFS, () => answer({ ...SAVED, id: 'd-9', rev: 1, usedIn: 0 }))
    route('POST', (u) => u.endsWith('/run'), () => refusal(503, 'busy', 'x'))
    const onClose = vi.fn()
    render(<WidgetBuilderSheet uid="u1" onClose={onClose} editor={door().editor} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Owed' } })
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByText('Keep your changes?')).toBeNull()
    expect(onClose).toHaveBeenCalled()
    expect(draft()).toBeNull()
  })

  it('minor 4: once saved-but-gone, the sections are inert and no edit is taken', async () => {
    const editor = { isEditable: true, storage: {}, chain: () => ({}), state: { doc: { nodeAt: () => null } }, view: {} }
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...SAVED, rev: 4 }))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-1', defRev: 4 })))
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} editor={editor} from={{ defId: 'd-1', getPos: () => 3 }} />)
    await flush(); await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Before' } })
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(SAVED_NOT_IN_NOTE)
    const sections = screen.getByTestId('builder-sections')
    expect(sections).toHaveAttribute('inert')
    expect(sections).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'After' } })
    expect(screen.getByLabelText('Name')).toHaveValue('Before')            // nothing silently thrown away later
  })

  it('minor 1: fitView recovers when the suggestion itself cannot show the comparison', () => {
    const cat = indexCatalog(CATALOG)
    const all = fitView(cat, { ...blankPlan(), range: { token: 'all' }, view: { type: 'compare', auto: false }, compare: { mode: 'previous' } })
    expect(all.view.type).toBe('number')
    expect(all.compare).toBeNull()
    const pos = fitView(cat, { ...blankPlan(), source: 'open_positions', measures: [{ key: 'open_positions' }],
      view: { type: 'compare', auto: true }, compare: { mode: 'previous' } })
    expect(pos.view.type).toBe('number')
    expect(pos.compare).toBeNull()
  })

  it('minor 2: no dead client test, and the second-split views come only from the server', () => {
    expect(Object.hasOwn(CHECK_TESTS, 'no_then')).toBe(false)
    expect(thenViews(indexCatalog(CATALOG))).toEqual(CATALOG.viewRules.thenViews)
    expect(thenViews(indexCatalog({ ...CATALOG, viewRules: { checks: [], auto: CATALOG.viewRules.auto } }))).toEqual([])
  })
})
