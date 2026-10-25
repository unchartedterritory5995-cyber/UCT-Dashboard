// Wave 8 (Task 8.16): "Start from an example", the widget builder's start screen, end to end through its own fetches
// (the server is the fetch router in __fixtures__/builderFixtures.js) over the REAL ready-made widgets (shelf.json).
// Asserted by RENDERED TEXT and by the requests on the wire; an IntersectionObserver stand-in says what is in view.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Profiler } from 'react'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS, BACK_TO_EXAMPLES, BACK_TO_EXAMPLES_HELD } from './WidgetBuilderSheet'
import {
  GALLERY_TITLE, SAMPLE_BANNER, LINK_BROKER_HREF, LOG_TRADE_HREF, BATCH, BUSY_RETRY_MS, NO_MATCH, CARDS_FAILED,
} from './ExamplesGallery'
import { rankExamples } from './examplesModel'
import { SAMPLE_RIBBON } from './ExampleCard'
import galleryStyles from './ExamplesGallery.module.css'
import BuiltWidgetEmbed from '../widgets/BuiltWidgetEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { __resetBuiltCaches, FAILURE_COPY } from '../../../lib/builtWidgets'
import { writeDraft } from './builderDraft'
import { installFetch, answer, refusal, payload, callsTo, bodyOf } from './__fixtures__/builderFixtures'

vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 8 }))

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
  constructor(cb) { this.cb = cb; this.els = new Set(); FakeIO.last = this }
  observe(el) { this.els.add(el) }
  unobserve(el) { this.els.delete(el) }
  disconnect() { this.els.clear() }
  takeRecords() { return [] }
}
async function inView(ids) {
  const io = FakeIO.last
  const entries = [...io.els].map((target) => ({ target, isIntersecting: ids.includes(target.getAttribute('data-example-id')) }))
  await act(async () => { io.cb(entries, io) })
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

let fetchSpy
let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  vi.stubGlobal('IntersectionObserver', FakeIO)
  ;({ spy: fetchSpy, routes } = installFetch())
  route('GET', (u) => u === `${DEFS}/shelf`, () => answer({ examples: SHELF }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
const examplesCalls = () => callsTo(fetchSpy, 'POST', (u) => u === `${DEFS}/examples`)
const shelfCalls = () => callsTo(fetchSpy, 'GET', (u) => u === `${DEFS}/shelf`)
const previews = () => callsTo(fetchSpy, 'POST', (u) => u.endsWith('/preview'))
const card = (id) => screen.getByTestId(`example-card-${id}`)
const cardNames = () => within(screen.getByRole('list', { name: 'Examples' })).getAllByRole('listitem')
  .map((li) => within(li).getByRole('button').getAttribute('aria-labelledby'))
  .map((id) => document.getElementById(id).textContent)

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
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => examplesAnswer(JSON.parse(init.body).ids))
    const { renders } = await openGallery()
    expect(screen.getByRole('heading', { name: GALLERY_TITLE })).toBeInTheDocument()
    // A real list, one item per ready-made widget, plus Start blank; nothing previews while the gallery shows.
    expect(within(screen.getByRole('list', { name: 'Examples' })).getAllByRole('listitem')).toHaveLength(SHELF.length)
    expect(screen.getByRole('button', { name: 'Start blank' })).toBeInTheDocument()
    expect(SHELF.length).toBeGreaterThan(2 * BATCH)                            // non-vacuity: three batches exist
    expect(examplesCalls()).toHaveLength(0)                                     // nothing in view, nothing asked
    expect(previews()).toHaveLength(0)

    // Ten cards scroll into view: ONE batch of 8 and one of 2, in shelf order.
    await inView(IDS.slice(0, 10))
    expect(examplesCalls().map((c) => bodyOf(c).ids)).toEqual([IDS.slice(0, 8), IDS.slice(8, 10)])
    expect(within(card(IDS[0])).getByText('+$2,140.00')).toBeInTheDocument()
    expect(within(card(IDS[0])).getByText('Last 90 days')).toBeInTheDocument()

    // Scrolling on asks only for the new ones; scrolling back asks for nothing.
    await inView(IDS.slice(0, 16))
    expect(examplesCalls().map((c) => bodyOf(c).ids)).toEqual([IDS.slice(0, 8), IDS.slice(8, 10), IDS.slice(10, 16)])
    await inView(IDS.slice(0, 4))
    expect(examplesCalls()).toHaveLength(3)

    // A search hides and shows cards again: nothing is asked for twice.
    fireEvent.change(screen.getByLabelText('Search examples'), { target: { value: 'drawdown' } })
    await inView(IDS)
    fireEvent.change(screen.getByLabelText('Search examples'), { target: { value: '' } })
    await inView(IDS.slice(0, 16))
    const sent = examplesCalls().flatMap((c) => bodyOf(c).ids)
    expect(new Set(sent).size).toBe(sent.length)                                // every id at most once
    expect(sent).toContain('shelf:max-drawdown')

    // Into the builder and back: the shelf is not read again and no card is asked for again.
    fireEvent.click(card(IDS[1]))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(previews()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: BACK_TO_EXAMPLES }))
    await inView(IDS.slice(0, 16))
    expect(shelfCalls()).toHaveLength(1)
    expect(examplesCalls().flatMap((c) => bodyOf(c).ids)).toEqual(sent)
    expect(within(card(IDS[0])).getByText('+$2,140.00')).toBeInTheDocument()  // still shown, from the first answer

    // H14: nothing re-renders on its own. A long idle stretch commits nothing, and the whole walk stays bounded.
    const settled = renders()
    await flush(60000)
    expect(renders()).toBe(settled)
    expect(settled).toBeLessThan(80)
    expect(examplesCalls().flatMap((c) => bodyOf(c).ids)).toEqual(sent)
  })

  it('busy_card_keeps_skeleton_retries_once', async () => {
    route('POST', (u) => u === `${DEFS}/examples`, () => refusal(503, 'busy', 'Busy right now. Try again in a moment.'))
    await openGallery()
    await inView(IDS.slice(0, 3))
    expect(examplesCalls()).toHaveLength(1)
    const gallery = screen.getByTestId('examples-gallery')
    // The skeleton stays, and "busy" is never shown on a card (nor anywhere in the gallery).
    for (const id of IDS.slice(0, 3)) expect(within(card(id)).getByTestId('example-skeleton')).toBeInTheDocument()
    expect(within(gallery).queryByText(/busy/i)).toBeNull()
    await flush(BUSY_RETRY_MS - 1)
    expect(examplesCalls()).toHaveLength(1)
    await flush(1)
    expect(examplesCalls()).toHaveLength(2)                                     // ONE retry, the same cards
    expect(bodyOf(examplesCalls()[1]).ids).toEqual(IDS.slice(0, 3))
    // Busy again: the bare shape, nothing said, and no further retry however long it waits.
    await flush(30000)
    expect(examplesCalls()).toHaveLength(2)
    for (const id of IDS.slice(0, 3)) expect(within(card(id)).queryByTestId('example-skeleton')).toBeNull()
    expect(within(gallery).queryByText(/busy/i)).toBeNull()
    expect(within(gallery).queryByText(CARDS_FAILED)).toBeNull()
    expect(within(gallery).queryByRole('status')).toBeNull()
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

  it('any other refusal says its spec 5.10 sentence once above the list; Try again asks once more', async () => {
    let n = 0
    route('POST', (u) => u === `${DEFS}/examples`, (u, init) => {
      n += 1
      return n === 1 ? refusal(429, 'rate_preview', 'x') : examplesAnswer(JSON.parse(init.body).ids)
    })
    await openGallery()
    await inView(IDS.slice(0, 2))
    expect(screen.getByRole('status')).toHaveTextContent(FAILURE_COPY.rate_preview)
    expect(within(card(IDS[0])).queryByText(FAILURE_COPY.rate_preview)).toBeNull()   // never on a card
    await flush(30000)
    expect(examplesCalls()).toHaveLength(1)                                     // no timer retries it
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()
    expect(examplesCalls()).toHaveLength(2)
    expect(within(card(IDS[0])).getByText('+$2,140.00')).toBeInTheDocument()
    expect(screen.queryByText(FAILURE_COPY.rate_preview)).toBeNull()
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
    // Every card on sample data says so, right beside its range label.
    for (const id of IDS.slice(0, 3)) {
      const ribbon = within(card(id)).getByText(SAMPLE_RIBBON)
      expect(ribbon.previousElementSibling).toHaveTextContent('Last 90 days')
    }
    // A card not yet answered has no range, so no ribbon is attached to nothing.
    expect(within(card(IDS[5])).queryByText(SAMPLE_RIBBON)).toBeNull()
    // A button goes there: the builder closes, and the app navigates.
    fireEvent.click(broker)
    expect(onClose).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/journal/accounts')
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
    // The builder holds the card's plan, and its preview is labelled sample data.
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

  it('focus moves from a card into the builder and back to that card; Back waits while edited', async () => {
    await openGallery()
    const opened = card('shelf:profit-factor')
    opened.focus()
    fireEvent.click(opened)
    await flush()
    expect(document.activeElement).toHaveTextContent('What to look at')
    expect(screen.getByTestId('examples-gallery')).not.toBeVisible()
    const back = screen.getByRole('button', { name: BACK_TO_EXAMPLES })
    // Edited: going back would drop the edit, so it waits and says why.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My PF' } })
    expect(back).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(BACK_TO_EXAMPLES_HELD)).toBeInTheDocument()
    fireEvent.click(back)
    expect(screen.getByLabelText('Name')).toHaveValue('My PF')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(back).not.toHaveAttribute('aria-disabled')
    fireEvent.click(back)
    await flush()
    expect(screen.getByTestId('examples-gallery')).toBeVisible()
    expect(document.activeElement).toBe(card('shelf:profit-factor'))
    // Start blank: the default new widget, focus in the builder.
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(document.activeElement).toHaveTextContent('What to look at')
    expect(bodyOf(previews().at(-1)).plan.measures).toEqual([{ key: 'net_pnl' }])
  })

  it('no save and no preview while the gallery shows; Ctrl+Enter there saves nothing', async () => {
    const { onClose } = await openGallery()
    expect(screen.queryByTestId('builder-save')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
    await flush(PREVIEW_DEBOUNCE_MS * 3)
    expect(callsTo(fetchSpy, 'POST', (u) => u === DEFS)).toHaveLength(0)
    expect(previews()).toHaveLength(0)
    // Escape closes straight away: nothing was edited.
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
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
    expect(within(gallery).getByText('Resume your unsaved widget')).toBeInTheDocument()
    expect(document.activeElement).toHaveTextContent('Resume')
    fireEvent.click(within(gallery).getByRole('button', { name: 'Resume' }))
    await flush()
    expect(screen.getByLabelText('Name')).toHaveValue('Half built')
    expect(screen.queryByText('Resume your unsaved widget')).toBeNull()
  })

  it('the shelf failing says so in member words, keeps Start blank, and Try again reads it again', async () => {
    let n = 0
    route('GET', (u) => u === `${DEFS}/shelf`, () => { n += 1; return n === 1 ? refusal(500, 'failed') : answer({ examples: SHELF }) })
    await openGallery()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the examples. Try again, or start blank.")
    expect(screen.getByRole('button', { name: 'Start blank' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await flush()
    expect(within(screen.getByRole('list', { name: 'Examples' })).getAllByRole('listitem')).toHaveLength(SHELF.length)
  })
})
