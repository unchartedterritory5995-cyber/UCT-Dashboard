/* global process */
// Wave 8 (Task 8.16): "Start from an example", the widget builder's start screen, end to end through its own fetches
// (the server is the fetch router in __fixtures__/builderFixtures.js) over the REAL ready-made widgets (shelf.json).
// Asserted by RENDERED TEXT and by the requests on the wire; an IntersectionObserver stand-in says what is in view.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Profiler } from 'react'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import WidgetBuilderSheet, {
  PREVIEW_DEBOUNCE_MS, BACK_TO_EXAMPLES, BACK_HELD_SAVED, KEEP_QUESTION, RESUME_OFFER,
} from './WidgetBuilderSheet'
import {
  GALLERY_TITLE, SAMPLE_BANNER, LINK_BROKER_HREF, LOG_TRADE_HREF, BATCH, BUSY_RETRY_MS, NO_MATCH, CARDS_FAILED,
  COALESCE_MS, COUNT_DELAY_MS,
} from './ExamplesGallery'
import { rankExamples, examplesFailureText } from './examplesModel'
import { SAMPLE_RIBBON } from './ExampleCard'
import { writeDraft } from './builderDraft'
import galleryStyles from './ExamplesGallery.module.css'
import BuiltWidgetEmbed from '../widgets/BuiltWidgetEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { __resetBuiltCaches, FAILURE_COPY } from '../../../lib/builtWidgets'
import { installFetch, answer, refusal, payload, callsTo, bodyOf, deferred } from './__fixtures__/builderFixtures'
import { openWidgetBuilder } from './openWidgetBuilder'
import { openRoutineEditor } from '../routines/openRoutineEditor'
import { FIRST_STEP } from './ExamplesGallery'

// Wave 8 on; wave 9 only where a test turns it on (Task 9.19's first step).
const waves = vi.hoisted(() => ({ nine: false }))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 8 || (w === 9 && waves.nine) }))
// The routine editor is its own rail (routines/RoutineEditorSheet.test.jsx): here only WHAT the first step asks of it.
vi.mock('../routines/openRoutineEditor', () => ({ openRoutineEditor: vi.fn(() => () => {}) }))

/** The ready-made widgets the server serves, read from the server's own file (never a copy). */
const SHELF = JSON.parse(readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'widget_engine',
  'shelf.json'), 'utf8')).examples
const IDS = SHELF.map((e) => e.id)
const DEFS = '/api/j2/widget-definitions'
const EMPTY_CLOSED = 'No closed trades in this range. Widen the range, or log a trade.'

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

/** An IntersectionObserver stand-in: `inView(ids)` reports every observed card, in view or not, as one callback. */
class FakeIO {
  static last = null
  static disconnected = 0
  constructor(cb, options) { this.cb = cb; this.options = options; this.els = new Set(); FakeIO.last = this }
  observe(el) { this.els.add(el) }
  unobserve(el) { this.els.delete(el) }
  disconnect() { this.els.clear(); FakeIO.disconnected += 1 }
  takeRecords() { return [] }
}
/** Report what is in view, then let the coalescing window pass and the answers land. */
async function inView(ids, settle = COALESCE_MS) {
  const io = FakeIO.last
  const entries = [...io.els].map((target) => ({ target, isIntersecting: ids.includes(target.getAttribute('data-example-id')) }))
  await act(async () => { io.cb(entries, io) })
  await flush(settle)
  await flush()
}

/** A card's payload in the server's shape: a Number card. */
const cardPayload = (id, over = {}) => {
  const ex = SHELF.find((e) => e.id === id)
  return payload({ title: ex?.name || id, rangeLabel: 'Last 90 days', ...over })
}
const examplesAnswer = (ids, { sample = false, over = {} } = {}) => answer({
  sample, cards: Object.fromEntries(ids.map((id) => [id, cardPayload(id, { sample, ...over })])),
})
const answerIds = (u, init) => examplesAnswer(JSON.parse(init.body).ids)

let fetchSpy
let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  FakeIO.disconnected = 0
  vi.stubGlobal('IntersectionObserver', FakeIO)
  ;({ spy: fetchSpy, routes } = installFetch())
  route('GET', (u) => u === `${DEFS}/shelf`, () => answer({ examples: SHELF }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  document.querySelectorAll('style[data-t816]').forEach((n) => n.remove())
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
const examplesCalls = () => callsTo(fetchSpy, 'POST', (u) => u === `${DEFS}/examples`)
const sentBatches = () => examplesCalls().map((c) => bodyOf(c).ids)
const shelfCalls = () => callsTo(fetchSpy, 'GET', (u) => u === `${DEFS}/shelf`)
const previews = () => callsTo(fetchSpy, 'POST', (u) => u.endsWith('/preview'))
const card = (id) => screen.getByTestId(`example-card-${id}`)
const cardNames = () => within(screen.getByRole('list', { name: 'Examples' })).getAllByRole('listitem')
  .map((li) => within(li).getByRole('button').getAttribute('aria-labelledby'))
  .map((id) => document.getElementById(id).textContent)
const describedText = (el) => (el.getAttribute('aria-describedby') || '').split(' ')
  .map((id) => document.getElementById(id)?.textContent || '').join(' ')
const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })

async function openGallery(props = {}) {
  const onClose = vi.fn()
  let renders = 0
  const utils = render(
    <Profiler id="builder" onRender={() => { renders += 1 }}>
      <WidgetBuilderSheet uid="u1" onClose={onClose} start="examples" {...props} />
    </Profiler>,
  )
  await flush()              // the catalog and accounts
  await flush()              // the shelf
  return { ...utils, onClose, renders: () => renders }
}

/** A note editor that records inserts (`chain().insertWidgetEmbed(...).run()`). */
function fakeEditor() {
  const run = vi.fn(() => true)
  const insertWidgetEmbed = vi.fn(() => ({ run }))
  return {
    editor: { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n-1', uid: 'u1' } }, chain: () => ({ insertWidgetEmbed }) },
    insertWidgetEmbed, run,
  }
}

describe('ExamplesGallery: Start from an example', () => {
  it('cards_batched_by_8_on_scroll_never_refetched', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, answerIds)
    const { renders } = await openGallery()
    expect(screen.getByRole('heading', { name: GALLERY_TITLE })).toBeInTheDocument()
    // A real list (role spelled out: list-style none drops it in Safari), one item per ready-made widget.
    const list = screen.getByRole('list', { name: 'Examples' })
    expect(list).toHaveAttribute('role', 'list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(SHELF.length)
    expect(screen.getByRole('button', { name: 'Start blank' })).toBeInTheDocument()
    expect(SHELF.length).toBeGreaterThan(2 * BATCH)                            // non-vacuity: three batches exist
    expect(examplesCalls()).toHaveLength(0)                                     // nothing in view, nothing asked
    expect(previews()).toHaveLength(0)

    // Ten cards scroll into view: a batch of 8, then the other 2 TOPPED UP to 8 with the next cards in order.
    await inView(IDS.slice(0, 10))
    expect(sentBatches()).toEqual([IDS.slice(0, 8), IDS.slice(8, 16)])
    expect(within(card(IDS[0])).getByText('+$2,140.00')).toBeInTheDocument()
    expect(within(card(IDS[0])).getByText('Last 90 days')).toBeInTheDocument()

    // Scrolling on to cards already asked for asks nothing; the first new one starts the next batch; back, nothing.
    await inView(IDS.slice(0, 16))
    expect(examplesCalls()).toHaveLength(2)
    await inView(IDS.slice(0, 17))
    expect(sentBatches()[2]).toEqual(IDS.slice(16, 16 + BATCH))
    await inView(IDS.slice(0, 4))
    expect(examplesCalls()).toHaveLength(3)

    // A search hides and shows cards again: nothing is asked for twice.
    fireEvent.change(screen.getByLabelText('Search examples'), { target: { value: 'drawdown' } })
    await inView(IDS)
    fireEvent.change(screen.getByLabelText('Search examples'), { target: { value: '' } })
    await inView(IDS)
    const sent = sentBatches().flat()
    expect(new Set(sent).size).toBe(sent.length)                                // every id at most once
    expect(new Set(sent)).toEqual(new Set(IDS))                                 // and every card has been asked for

    // Into the builder and back: the list is not read again and no card is asked for again.
    fireEvent.click(card(IDS[1]))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(previews()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: BACK_TO_EXAMPLES }))
    await inView(IDS.slice(0, 16))
    expect(shelfCalls()).toHaveLength(1)
    expect(sentBatches().flat()).toEqual(sent)
    expect(within(card(IDS[0])).getByText('+$2,140.00')).toBeInTheDocument()  // still shown, from the first answer

    // H14: nothing re-renders on its own. A long idle stretch commits nothing, and the whole walk stays bounded.
    const settled = renders()
    await flush(60000)
    expect(renders()).toBe(settled)
    expect(settled).toBeLessThan(90)
    expect(sentBatches().flat()).toEqual(sent)
  })

  it('I-3: with 17+ cards in view, never more than ONE batch in flight, and every card is answered', async () => {
    const pending = []
    let open = 0
    let most = 0
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => {
      open += 1
      most = Math.max(most, open)
      const d = deferred()
      pending.push({ d, ids: JSON.parse(init.body).ids })
      return d.promise
    })
    await openGallery()
    await inView(IDS.slice(0, 20))
    expect(examplesCalls()).toHaveLength(1)
    await flush(5000)
    expect(examplesCalls()).toHaveLength(1)                                     // the next waits for this one
    while (pending.length) {
      const { d, ids } = pending.shift()
      open -= 1
      await act(async () => {
        d.resolve({ sample: false, cards: Object.fromEntries(ids.map((id) => [id, cardPayload(id)])) })
      })
      await flush()
      await flush()
    }
    expect(most).toBe(1)
    expect(sentBatches().every((b) => b.length <= BATCH)).toBe(true)
    // After the batches settle, no card in view is left a skeleton or a bare shape.
    for (const id of IDS.slice(0, 20)) {
      expect(within(card(id)).queryByTestId('example-skeleton')).toBeNull()
      expect(within(card(id)).getByText('+$2,140.00')).toBeInTheDocument()
    }
  })

  it('I-3: a slow phone scroll (one row at a time) still sends batches of 8, never one request per row', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, answerIds)
    await openGallery()
    for (let n = 1; n <= 16; n += 1) await inView(IDS.slice(0, n), 300)
    expect(sentBatches()).toEqual([IDS.slice(0, 8), IDS.slice(8, 16)])
  })

  it('I-3: cards coming into view within the coalescing window go in ONE batch', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, answerIds)
    await openGallery()
    await inView([IDS[0]], COALESCE_MS - 100)
    expect(examplesCalls()).toHaveLength(0)                                     // still gathering
    await inView([IDS[0], IDS[12]])
    expect(sentBatches()[0]).toEqual([IDS[0], ...IDS.slice(12, 12 + BATCH - 1)])
  })

  it('I-3: the observer is rooted on the sheet’s own scroller, and disconnected on unmount (m-9)', async () => {
    const style = document.createElement('style')
    style.setAttribute('data-t816', '')
    style.textContent = '[data-builder-controls] { overflow-y: auto; }'
    document.head.appendChild(style)
    const { unmount } = await openGallery()
    expect(FakeIO.last.options.root).toBe(document.querySelector('[data-builder-controls]'))
    expect(FakeIO.last.options.rootMargin).toMatch(/px/)
    const before = FakeIO.disconnected
    unmount()
    expect(FakeIO.disconnected).toBeGreaterThan(before)
  })

  it('N5: crossing the 641 px boundary finds the scroller again (a new observer on the new root; the old one gone)', async () => {
    const listeners = new Set()
    let phone = false
    vi.stubGlobal('matchMedia', (q) => ({
      get matches() { return q === '(max-width: 640px)' ? phone : false }, media: q,
      addEventListener: (_t, fn) => { if (q === '(max-width: 640px)') listeners.add(fn) },
      removeEventListener: (_t, fn) => listeners.delete(fn),
    }))
    const style = document.createElement('style')
    style.setAttribute('data-t816', '')
    style.textContent = '[data-builder-controls] { overflow-y: auto; }'
    document.head.appendChild(style)
    await openGallery()
    const controls = document.querySelector('[data-builder-controls]')
    expect(FakeIO.last.options.root).toBe(controls)
    const first = FakeIO.last
    // At phone width the builder's own column stops scrolling and the sheet's body scrolls instead.
    style.textContent = '[data-builder-controls] { overflow-y: visible; }'
    const body = screen.getByTestId('widget-builder').parentElement
    body.style.overflowY = 'auto'
    phone = true
    await act(async () => { for (const fn of listeners) fn({ matches: true }) })
    expect(FakeIO.last).not.toBe(first)
    expect(FakeIO.last.options.root).toBe(body)
    expect(first.els.size).toBe(0)                                              // the old one was disconnected
    expect(FakeIO.last.els.size).toBe(SHELF.length)                              // and every card is watched again
  })

  it('busy_card_keeps_skeleton_retries_once', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, () => refusal(503, 'busy', 'Busy right now. Try again in a moment.'))
    await openGallery()
    await inView(IDS.slice(0, 3))
    expect(sentBatches()).toEqual([IDS.slice(0, BATCH)])
    const gallery = screen.getByTestId('examples-gallery')
    // The skeleton stays, and "busy" is never shown on a card (nor anywhere in the gallery).
    for (const id of IDS.slice(0, 3)) expect(within(card(id)).getByTestId('example-skeleton')).toBeInTheDocument()
    expect(within(gallery).queryByText(/busy/i)).toBeNull()
    // More cards in view during the wait: the held slot sends nothing new.
    await inView(IDS.slice(0, 12), 0)
    await flush(BUSY_RETRY_MS - 1)
    expect(examplesCalls()).toHaveLength(1)
    await flush(1)
    expect(bodyOf(examplesCalls()[1]).ids).toEqual(IDS.slice(0, BATCH))       // ONE retry, the same cards
    // Only once that slot is free does the next batch (the cards that came into view meanwhile) go out.
    expect(sentBatches().slice(2)).toEqual([IDS.slice(BATCH, 2 * BATCH)])
    // Busy again: the bare shape, nothing said, and no further retry of those cards however long it waits.
    await flush(30000)
    const retried = sentBatches().filter((b) => b[0] === IDS[0])
    expect(retried).toHaveLength(2)
    for (const id of IDS.slice(0, 3)) expect(within(card(id)).queryByTestId('example-skeleton')).toBeNull()
    expect(within(gallery).queryByText(/busy/i)).toBeNull()
    expect(screen.getByTestId('examples-note')).toBeEmptyDOMElement()
  })

  it('a busy card whose one retry answers shows its result', async () => {
    let n = 0
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => {
      n += 1
      return n === 1 ? refusal(503, 'busy') : examplesAnswer(JSON.parse(init.body).ids)
    })
    await openGallery()
    await inView(IDS.slice(0, 2))
    expect(within(card(IDS[0])).getByTestId('example-skeleton')).toBeInTheDocument()
    await flush(BUSY_RETRY_MS)
    expect(examplesCalls()).toHaveLength(2)
    expect(within(card(IDS[0])).getByText('+$2,140.00')).toBeInTheDocument()
    expect(within(card(IDS[0])).queryByTestId('example-skeleton')).toBeNull()
  })

  it('any other refusal says ONE line above the list (always-mounted region); Try again asks once more', async () => {
    let n = 0
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => {
      n += 1
      return n === 1 ? refusal(429, 'rate_preview', 'x') : examplesAnswer(JSON.parse(init.body).ids)
    })
    await openGallery()
    const region = screen.getByTestId('examples-note')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toBeEmptyDOMElement()
    await inView(IDS.slice(0, 2))
    // m-3: the builder's own preview sentence is not the gallery's: the gallery says its own.
    expect(screen.getByTestId('examples-note')).toBe(region)
    expect(region).toHaveTextContent(CARDS_FAILED)
    expect(within(card(IDS[0])).queryByText(CARDS_FAILED)).toBeNull()           // never on a card
    await flush(30000)
    expect(examplesCalls()).toHaveLength(1)                                     // no timer retries it
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush(COALESCE_MS)
    await flush()
    expect(examplesCalls()).toHaveLength(2)
    expect(within(card(IDS[0])).getByText('+$2,140.00')).toBeInTheDocument()
    expect(region).toBeEmptyDOMElement()
  })

  it('m-3/m-8: the gallery sentence per code comes from the shared lookup, never builder-context copy', () => {
    expect(examplesFailureText('rate_preview', CARDS_FAILED)).toBe(CARDS_FAILED)
    expect(examplesFailureText('too_long', CARDS_FAILED)).toBe(CARDS_FAILED)
    expect(examplesFailureText('busy', CARDS_FAILED)).toBe(CARDS_FAILED)
    expect(examplesFailureText('offline', CARDS_FAILED)).toBe(FAILURE_COPY.offline)
    expect(examplesFailureText('unavailable', CARDS_FAILED)).toBe(FAILURE_COPY.unavailable)
    expect(examplesFailureText('failed', CARDS_FAILED)).toBe(CARDS_FAILED)
    expect(examplesFailureText(undefined, CARDS_FAILED)).toBe(CARDS_FAILED)
  })

  it('sample_ribbon_and_banner_with_two_buttons', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => examplesAnswer(JSON.parse(init.body).ids, { sample: true }))
    const navigate = vi.fn()
    const { onClose } = await openGallery({ navigate })
    expect(screen.queryByText(SAMPLE_BANNER)).toBeNull()                        // nothing said before any answer
    await inView(IDS.slice(0, 3))
    expect(screen.getByText(SAMPLE_BANNER)).toBeInTheDocument()
    const banner = screen.getByTestId('sample-banner')
    const broker = within(banner).getByRole('link', { name: 'Link broker' })
    const log = within(banner).getByRole('link', { name: 'Log a trade' })
    expect(broker).toHaveAttribute('href', LINK_BROKER_HREF)
    expect(log).toHaveAttribute('href', LOG_TRADE_HREF)
    expect(LINK_BROKER_HREF).toBe('/journal/accounts')
    expect(LOG_TRADE_HREF).toBe('/journal/trades')
    // Every answered card on sample data says so, right beside its range label.
    for (const id of IDS.slice(0, 3)) {
      const ribbon = within(card(id)).getByText(SAMPLE_RIBBON)
      expect(ribbon.previousElementSibling).toHaveTextContent('Last 90 days')
    }
    // A card not yet answered has no range, so no ribbon is attached to nothing.
    expect(within(card(IDS[12])).queryByText(SAMPLE_RIBBON)).toBeNull()
    // R-45: with the router's navigate, the builder closes and the app navigates; no history is faked.
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(broker)
    expect(onClose).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/journal/accounts')
    expect(push).not.toHaveBeenCalled()
  })

  it('R-45: with no navigate, a link closes the builder and follows its own href (no pushState, no popstate)', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => examplesAnswer(JSON.parse(init.body).ids, { sample: true }))
    const { onClose } = await openGallery()
    await inView(IDS.slice(0, 2))
    const push = vi.spyOn(window.history, 'pushState')
    const pops = vi.fn()
    window.addEventListener('popstate', pops)
    const link = within(screen.getByTestId('sample-banner')).getByRole('link', { name: 'Log a trade' })
    // jsdom does not navigate; what matters is that the click is NOT prevented, so the browser would follow href.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const followed = fireEvent.click(link)
    consoleError.mockRestore()
    expect(followed).toBe(true)
    expect(onClose).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(pops).not.toHaveBeenCalled()
    window.removeEventListener('popstate', pops)
    // A modified click is the browser's: the builder stays open.
    onClose.mockClear()
    fireEvent.click(link, { ctrlKey: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('search_name_above_keyword', async () => {
    await openGallery()
    const search = screen.getByLabelText('Search examples')
    // "hit rate" is one of Win rate's keywords.
    fireEvent.change(search, { target: { value: 'hit rate' } })
    expect(cardNames()).toEqual(['Win rate'])
    // A NAME match ranks above a keyword match, even one earlier on the shelf: "P&L by hold time" (keyword
    // "day trades vs swing") sits before both "trades" names on the shelf, and after them here.
    fireEvent.change(search, { target: { value: 'trades' } })
    expect(cardNames()).toEqual(['Best trades', 'Recent trades', 'P&L by hold time'])
    expect(SHELF.findIndex((e) => e.name === 'P&L by hold time')).toBeLessThan(SHELF.findIndex((e) => e.name === 'Best trades'))
    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(screen.getByText(NO_MATCH)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start blank' })).toBeInTheDocument()
  })

  it('m-2: the search count is an always-mounted region, read once typing stops', async () => {
    await openGallery()
    const count = screen.getByTestId('examples-count')
    expect(count).toHaveAttribute('role', 'status')
    expect(count).toBeEmptyDOMElement()
    fireEvent.change(screen.getByLabelText('Search examples'), { target: { value: 'win' } })
    await flush(COUNT_DELAY_MS - 1)
    fireEvent.change(screen.getByLabelText('Search examples'), { target: { value: 'hit rate' } })
    await flush(COUNT_DELAY_MS - 1)
    expect(count).toBeEmptyDOMElement()                                         // still typing: nothing said
    await flush(1)
    expect(screen.getByTestId('examples-count')).toBe(count)
    expect(count).toHaveTextContent('1 example')
  })

  it('m-4: Escape in the search clears it first; the next Escape closes the sheet', async () => {
    const { onClose } = await openGallery()
    const search = screen.getByLabelText('Search examples')
    search.focus()
    fireEvent.change(search, { target: { value: 'drawdown' } })
    expect(cardNames()).toEqual(['Max drawdown'])
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(cardNames()).toHaveLength(SHELF.length)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('rankExamples CONTROL: a keyword-only match never outranks a name match, and order within a tier holds', () => {
    const list = [
      { id: 'a', name: 'Alpha', keywords: ['zeta'] },
      { id: 'b', name: 'Zeta two', keywords: [] },
      { id: 'c', name: 'Gamma', keywords: ['ZETA beta'] },
      { id: 'd', name: 'Zeta one', keywords: [] },
    ]
    expect(rankExamples(list, 'zeta').map((e) => e.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(rankExamples(list, '  ').map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(rankExamples(list, 'omega')).toEqual([])
  })

  it('m-7: a card’s figure, or its empty sentence, is part of its accessible description', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => {
      const ids = JSON.parse(init.body).ids
      return answer({ sample: false, cards: Object.fromEntries(ids.map((id, i) => [id, i === 1
        ? cardPayload(id, { count: 0, empty: EMPTY_CLOSED }) : cardPayload(id)])) })
    })
    await openGallery()
    await inView(IDS.slice(0, 2))
    expect(describedText(card(IDS[0]))).toMatch(/\+\$2,140\.00/)
    expect(describedText(card(IDS[1]))).toMatch(/No closed trades in this range/)
    // Not yet answered: the description and range only, never a guessed figure.
    expect(describedText(card(IDS[20]))).not.toMatch(/\$/)
  })

  it('N4 (failureStates "Not enough", gallery card): a figure under its minimum reads "Not enough trades yet (3)", never a zero', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => {
      const ids = JSON.parse(init.body).ids
      return answer({ sample: true, cards: Object.fromEntries(ids.map((id, i) => [id, i === 0
        ? cardPayload(id, {
          sample: true, measures: [{ label: 'Win rate', unit: 'decisive', kind: 'rate', fmt: 'pct' }],
          value: { v1: null, n1: 3, s1: 'hide', n: 3 },
        })
        : i === 1
          ? cardPayload(id, {
            sample: true, measures: [{ label: 'Day P&L', unit: 'days', kind: 'average', fmt: 'money' }],
            value: { v1: null, n1: 2, s1: 'hide', n: 2 },
          })
          : cardPayload(id, { sample: true })])) })
    })
    await openGallery()
    await inView(IDS.slice(0, 2))
    expect(within(card(IDS[0])).getByText('Not enough trades yet (3)')).toBeInTheDocument()
    expect(within(card(IDS[1])).getByText('Not enough days yet (2)')).toBeInTheDocument()
    for (const id of IDS.slice(0, 2)) expect(within(card(id)).queryByText(/^[+-]?\$?0(\.0+)?%?$/)).toBeNull()
    expect(describedText(card(IDS[0]))).toMatch(/Not enough trades yet \(3\)/)
  })

  it('insert_from_sample_inserts_real_widget', async () => {
    const { editor, insertWidgetEmbed } = fakeEditor()
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => examplesAnswer(JSON.parse(init.body).ids, { sample: true }))
    route('POST', (u) => u.endsWith('/preview'), () => answer(payload({ sample: true, title: 'Win rate' })))
    route('POST', (u) => u === DEFS, () => answer({ id: 'd-9', rev: 1, placedRev: 1, etag: 1, usedIn: 0 }))
    const REAL = payload({ defId: 'd-9', defRev: 1, title: 'Win rate', sample: false, count: 0, empty: EMPTY_CLOSED,
      value: { v1: null, n1: 0, s1: '' } })
    route('POST', (u) => u.endsWith('/run'), () => answer(REAL))
    const { onClose } = await openGallery({ editor })
    await inView(IDS.slice(0, 8))
    expect(screen.getByText(SAMPLE_BANNER)).toBeInTheDocument()
    fireEvent.click(card('shelf:win-rate'))
    await flush(PREVIEW_DEBOUNCE_MS)
    // The builder holds the card's plan, says which one opened, and its preview is labelled sample data.
    expect(screen.getByTestId('builder-opened')).toHaveTextContent('Opened Win rate.')
    expect(screen.getByLabelText('Name')).toHaveValue('Win rate')
    expect(bodyOf(previews()[0]).plan.measures).toEqual(SHELF.find((e) => e.id === 'shelf:win-rate').plan.measures)
    expect(within(screen.getByTestId('builder-preview')).getByText(SAMPLE_RIBBON)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    // Saved as the member's OWN widget (no sample in what is saved), then run for real and inserted.
    const create = bodyOf(callsTo(fetchSpy, 'POST', (u) => u === DEFS)[0])
    expect(create.plan.source).toBe('closed_trades')
    expect(JSON.stringify(create)).not.toMatch(/sample/i)
    expect(bodyOf(callsTo(fetchSpy, 'POST', (u) => u.endsWith('/run'))[0])).toMatchObject({ defId: 'd-9', defRev: 1 })
    expect(insertWidgetEmbed).toHaveBeenCalledTimes(1)
    const [kind, inserted] = insertWidgetEmbed.mock.calls[0]
    expect(kind).toBe('builtWidget')
    expect(inserted.sample).toBe(false)
    expect(onClose).toHaveBeenCalled()
    // ...and the real widget in the note shows its spec 5.9 empty sentence, never a zero.
    const placed = render(<BuiltWidgetEmbed attrs={widgetEmbedNode('builtWidget', inserted).attrs} />).container
    expect(within(placed).getByText(/No closed trades in this range\. Widen the range, or log a trade\./)).toBeInTheDocument()
    expect(within(placed).queryByText(SAMPLE_RIBBON)).toBeNull()
  })

  it('reduced_motion_no_animation_class', async () => {
    const reduce = (on) => vi.stubGlobal('matchMedia', (q) => ({
      matches: on && q === '(prefers-reduced-motion: reduce)', media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    }))
    reduce(true)
    const first = await openGallery()
    const still = within(card(IDS[0])).getByTestId('example-skeleton')
    expect(still).toHaveClass(galleryStyles.skeleton)
    expect(still).not.toHaveClass(galleryStyles.shimmer)
    first.unmount()
    // CONTROL: with motion allowed, the same skeleton shimmers.
    reduce(false)
    await openGallery()
    expect(within(card(IDS[0])).getByTestId('example-skeleton')).toHaveClass(galleryStyles.shimmer)
    // And the stylesheet stops the animation under the media query too.
    const css = readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'widgetBuilder',
      'ExamplesGallery.module.css'), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.shimmer\s*\{\s*animation:\s*none;/)
  })

  it('focus moves from a card into the builder and back to that card; Escape there is one level back', async () => {
    await openGallery()
    const opened = card('shelf:profit-factor')
    opened.focus()
    fireEvent.click(opened)
    await flush()
    expect(document.activeElement).toHaveTextContent('What to look at')
    expect(screen.getByTestId('examples-gallery')).not.toBeVisible()
    expect(screen.getByTestId('builder-opened')).toHaveTextContent('Opened Profit factor.')
    // Clean: Back returns to the gallery, focus on the card that opened the builder.
    fireEvent.click(screen.getByRole('button', { name: BACK_TO_EXAMPLES }))
    await flush()
    expect(screen.getByTestId('examples-gallery')).toBeVisible()
    expect(document.activeElement).toBe(card('shelf:profit-factor'))
    expect(screen.getByTestId('builder-opened')).toBeEmptyDOMElement()
    // m-4: Escape in a clean builder opened from a card is the same one level back.
    fireEvent.click(card('shelf:expectancy'))
    await flush()
    escape()
    await flush()
    expect(screen.getByTestId('examples-gallery')).toBeVisible()
    expect(document.activeElement).toBe(card('shelf:expectancy'))
    // Start blank: the default new widget, focus in the builder.
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(document.activeElement).toHaveTextContent('What to look at')
    expect(bodyOf(previews().at(-1)).plan.measures).toEqual([{ key: 'net_pnl' }])
  })

  it('I-2: edited, Back asks; "Keep my changes" goes to the gallery with Resume offered and focused', async () => {
    await openGallery()
    fireEvent.click(card('shelf:profit-factor'))
    await flush()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My PF' } })
    const back = screen.getByRole('button', { name: BACK_TO_EXAMPLES })
    expect(back).not.toHaveAttribute('aria-disabled')                           // never a dead end
    fireEvent.click(back)
    expect(screen.getByText(KEEP_QUESTION)).toBeInTheDocument()
    expect(document.activeElement).toHaveTextContent(KEEP_QUESTION)
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    await flush()
    const gallery = screen.getByTestId('examples-gallery')
    expect(gallery).toBeVisible()
    expect(within(gallery).getByText(RESUME_OFFER)).toBeInTheDocument()
    expect(document.activeElement).toBe(within(gallery).getByRole('button', { name: 'Resume' }))
    // Resume: the kept edits, in the builder; edited (history empty), Back asks again, never strands.
    fireEvent.click(within(gallery).getByRole('button', { name: 'Resume' }))
    await flush()
    expect(screen.getByLabelText('Name')).toHaveValue('My PF')
    fireEvent.click(screen.getByRole('button', { name: BACK_TO_EXAMPLES }))
    expect(screen.getByText(KEEP_QUESTION)).toBeInTheDocument()
  })

  it('I-2: edited, Back then "Discard them" goes to the gallery (focus on the card); "Keep editing" stays', async () => {
    const { onClose } = await openGallery()
    fireEvent.click(card('shelf:profit-factor'))
    await flush()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My PF' } })
    const back = screen.getByRole('button', { name: BACK_TO_EXAMPLES })
    fireEvent.click(back)
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await flush()
    expect(screen.getByLabelText('Name')).toHaveValue('My PF')
    expect(document.activeElement).toBe(back)                                   // focus back where it was
    fireEvent.click(back)
    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }))
    await flush()
    expect(screen.getByTestId('examples-gallery')).toBeVisible()
    expect(document.activeElement).toBe(card('shelf:profit-factor'))
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
    expect(window.localStorage.getItem('uct.nb.widgetDraft.u1')).toBeNull()
    // The edits are gone: a close from here asks nothing.
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('I-2: once saved with its place owed, Back is held with its own reason', async () => {
    const { editor } = fakeEditor()
    route('POST', (u) => u === DEFS, () => answer({ id: 'd-9', rev: 1, placedRev: 1, etag: 1, usedIn: 0 }))
    route('POST', (u) => u.endsWith('/run'), () => refusal(503, 'busy'))
    await openGallery({ editor })
    fireEvent.click(card('shelf:profit-factor'))
    await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    const back = screen.getByRole('button', { name: BACK_TO_EXAMPLES })
    expect(back).toHaveAttribute('aria-disabled', 'true')
    expect(describedText(back)).toBe(BACK_HELD_SAVED)
    fireEvent.click(back)
    escape()
    await flush()
    expect(screen.getByTestId('examples-gallery')).not.toBeVisible()
  })

  it('no save and no preview while the gallery shows; Ctrl+Enter there saves nothing', async () => {
    const { onClose } = await openGallery()
    expect(screen.queryByTestId('builder-save')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
    await flush(PREVIEW_DEBOUNCE_MS * 3)
    expect(callsTo(fetchSpy, 'POST', (u) => u === DEFS)).toHaveLength(0)
    expect(previews()).toHaveLength(0)
    // Escape closes straight away: nothing was edited.
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a kept draft is offered on the gallery, and Resume opens it in the builder', async () => {
    writeDraft('u1', {
      target: null, nameTouched: true,
      plan: { v: 1, source: 'closed_trades', range: { token: 'last_30d' }, measures: [{ key: 'net_pnl' }],
        display: { title: 'Half built', titleAuto: false } },
    }, Date.now() - 60000)
    await openGallery()
    const gallery = screen.getByTestId('examples-gallery')
    expect(within(gallery).getByText(RESUME_OFFER)).toBeInTheDocument()
    expect(document.activeElement).toHaveTextContent('Resume')
    fireEvent.click(within(gallery).getByRole('button', { name: 'Resume' }))
    await flush()
    expect(screen.getByLabelText('Name')).toHaveValue('Half built')
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
  })

  it('the list failing says so in member words, keeps Start blank, and Try again (or back online) reads it again', async () => {
    let n = 0
    route('GET', (u) => u === `${DEFS}/shelf`, () => { n += 1; return n <= 2 ? refusal(500, 'failed') : answer({ examples: SHELF }) })
    await openGallery()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the examples. Try again, or start blank.")
    expect(screen.getByRole('button', { name: 'Start blank' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    // m-5: the browser coming back online reads it again on its own.
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await flush()
    expect(shelfCalls()).toHaveLength(3)
    expect(within(screen.getByRole('list', { name: 'Examples' })).getAllByRole('listitem')).toHaveLength(SHELF.length)
  })
})

// Task 9.19 (spec 5.2 step 1): a member on sample data is offered a first step that needs no trades, the pre-market
// routine, above the cards, while wave 9 is on. From a note's builder, saving that routine puts it at the caret.
describe('ExamplesGallery: the first step on sample data', () => {
  afterEach(() => { waves.nine = false; vi.mocked(openRoutineEditor).mockClear() })
  const sampleAnswers = (sample) => route('POST', (u) => u === `${DEFS}/examples`,
    (u, init) => examplesAnswer(JSON.parse(init.body).ids, { sample }))
  /** A note editor that records the chain an insert runs. */
  function noteEditor() {
    const calls = []
    const chain = {
      focus: () => chain, deleteRange: () => chain,
      insertWidgetEmbed: (...args) => { calls.push(args); return chain },
      run: () => true,
    }
    const ed = { isEditable: true, isDestroyed: false, on: () => {}, off: () => {}, chain: () => chain,
      storage: { uctJournalWidgets: { noteId: 'n-1', uid: 'u1', noteDay: () => '2026-10-27' } } }
    return { ed, calls }
  }

  it('first_run_card_only_on_sample_and_w9_on', async () => {
    // Wave 9 off, on sample data: no first step.
    sampleAnswers(true)
    let view = await openGallery()
    await inView(IDS.slice(0, 2))
    expect(screen.getByText(SAMPLE_BANNER)).toBeInTheDocument()            // non-vacuity: this IS sample data
    expect(screen.queryByText(FIRST_STEP)).toBeNull()
    view.unmount()
    // Wave 9 on, the member's own trades (no sample): no first step either.
    waves.nine = true
    routes.splice(0, 1)
    sampleAnswers(false)
    view = await openGallery()
    await inView(IDS.slice(0, 2))
    expect(screen.queryByText(SAMPLE_BANNER)).toBeNull()
    expect(screen.queryByText(FIRST_STEP)).toBeNull()
    view.unmount()
    // Wave 9 on, on sample data: the step, above the cards, before any card is opened.
    routes.splice(0, 1)
    sampleAnswers(true)
    view = await openGallery()
    await inView(IDS.slice(0, 2))
    const step = screen.getByRole('button', { name: FIRST_STEP })
    expect(FIRST_STEP).toBe('Set up your pre-market routine (1 minute)')
    const list = screen.getByRole('list', { name: 'Examples' })
    expect(step.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(step)
    await flush()
    expect(openRoutineEditor).toHaveBeenCalledTimes(1)
    expect(vi.mocked(openRoutineEditor).mock.calls[0][0]).toMatchObject({ starter: 'premarket' })
    view.unmount()
  })

  it('from a note: the builder gives way to the routine editor, and saving puts the routine at the caret', async () => {
    waves.nine = true
    sampleAnswers(true)
    const { ed, calls } = noteEditor()
    await act(async () => { openWidgetBuilder({ editor: ed, start: 'examples', uid: 'u1' }) })
    await flush()
    await flush()
    await inView(IDS.slice(0, 2))
    fireEvent.click(screen.getByRole('button', { name: FIRST_STEP }))
    await flush()
    await flush()
    // One sheet at a time: the builder closed, and the editor opened from a ready-made pre-market routine.
    expect(document.querySelector('[data-widget-builder-root]')).toBeNull()
    expect(openRoutineEditor).toHaveBeenCalledTimes(1)
    const args = vi.mocked(openRoutineEditor).mock.calls[0][0]
    expect(args).toMatchObject({ starter: 'premarket', editor: ed })
    expect(calls).toHaveLength(0)                                          // nothing goes in before the save
    args.onSaved({ id: 'r-new', name: 'Pre-market routine' })
    expect(calls).toEqual([['routine', { routineId: 'r-new', day: '2026-10-27', bind: 'note-day', display: 'items' },
      { searchText: '[routine: Pre-market routine · For Tue Oct 27]' }]])
  })
})
