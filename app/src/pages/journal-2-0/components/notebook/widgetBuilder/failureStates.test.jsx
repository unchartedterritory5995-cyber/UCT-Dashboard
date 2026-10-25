// Wave 8 (Task 8.16): every spec 5.10 failure state a member can reach in wave 8, each with its EXACT copy and what
// stays on screen. Routines and trackers (live read, tick, logging window, market calendar) are wave 9 and are not
// here. The builder states run through the real sheet and its fetches; the placed-widget states (See it now) run
// through the real BuiltWidgetEmbed and its frame. Asserted by RENDERED TEXT, never by state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS } from './WidgetBuilderSheet'
import { DRAFT_PREFIX } from './builderDraft'
import BuiltWidgetEmbed from '../widgets/BuiltWidgetEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { installFetch, answer, refusal, payload, callsTo, bodyOf, SUMMARY } from './__fixtures__/builderFixtures'

vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 8 }))

/** Spec 5.10, verbatim. Typed here ON PURPOSE (never imported from the code under test), so a drifted sentence in
 *  the product fails this file instead of agreeing with itself. */
const COPY = {
  busy: 'Busy right now. Try again in a moment.',
  tooLong: 'This is a lot of data to add up. Try a shorter range or fewer splits.',
  over5000: 'Based on your newest 5,000 trades. Narrow the range to include all trades.',
  ratePreview: 'Pausing the preview for a moment; your changes are kept.',
  rateWidget: 'Too many refreshes in a minute. Try again shortly.',
  dailyCap: 'You have refreshed widgets a lot today. Snapshots stay; refreshing resumes tomorrow.',
  countCap: 'You have 100 widgets. Archive one in My tools to make room.',
  offline: "Offline. The preview updates when you're back.",
  flagOff: 'Not available right now.',
  missing: 'Running from the saved copy in this note.',
  tooNew: 'This widget was made with a newer version of the app. Reload to use it.',
  conflict: 'Changed in another tab. Reload to see the newer version.',
}

const DEFS = '/api/j2/widget-definitions'
const SHELF = JSON.parse(readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'widget_engine',
  'shelf.json'), 'utf8')).examples

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

let fetchSpy
let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  ;({ spy: fetchSpy, routes } = installFetch())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
const previews = () => callsTo(fetchSpy, 'POST', (u) => u.endsWith('/preview'))
const saveButton = () => screen.getByTestId('builder-save')
const previewPane = () => screen.getByTestId('builder-preview')

async function openBuilder(props = {}) {
  const onClose = vi.fn()
  const utils = render(<WidgetBuilderSheet uid="u1" onClose={onClose} {...props} />)
  await flush()
  await flush(PREVIEW_DEBOUNCE_MS)
  return { ...utils, onClose }
}

/** One edit that changes what is counted (so a new preview runs), then the debounce. */
async function editAndPreview() {
  fireEvent.change(screen.getByLabelText('Target for a progress bar'), { target: { value: '25' } })
  await flush(PREVIEW_DEBOUNCE_MS)
}

/** The first preview answers +$2,140.00; the next answers `reply`. The last good result must stay, dimmed. */
async function lastGoodThen(reply) {
  let n = 0
  route('POST', (u) => u.endsWith('/preview'), () => { n += 1; return n === 1 ? answer(payload()) : reply() })
  await openBuilder()
  expect(within(previewPane()).getByText('+$2,140.00')).toBeInTheDocument()
  await editAndPreview()
}

const keptResult = () => {
  const view = within(previewPane()).getByTestId('builder-preview-view')
  expect(within(view).getByText('+$2,140.00')).toBeInTheDocument()
  return view
}

// ── the placed widget (See it now) ──────────────────────────────────────────────────────────────
const SNAP = {
  asOf: '2026-10-20T14:00:00Z', source: 'manual', sourceKey: 'closed_trades', view: 'number', title: 'Net P&L',
  summary: SUMMARY, defId: 'd-1', defRev: 2, def: { v: 1, source: 'closed_trades', range: { token: 'last_90d' },
    measures: [{ key: 'net_pnl' }] },
  scopeLabel: 'All my accounts', rangeLabel: 'Last 90 days', count: 12,
  measures: [{ label: 'Net P&L', unit: 'trades', kind: 'sum', fmt: 'money' }],
  value: { v1: 1250, n1: 12, s1: '', n: 12 }, share: false,
}
function Host({ params, writes = [] }) {
  const [p, setP] = useState(params)
  return (
    <BuiltWidgetEmbed attrs={widgetEmbedNode('builtWidget', p).attrs} editable
      onUpdateParams={(next) => { writes.push(next); setP(next); return true }} />
  )
}
async function seeItNow(reply, params = SNAP) {
  vi.useRealTimers()
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => reply(String(url), init)))
  const writes = []
  render(<Host params={params} writes={writes} />)
  fireEvent.click(screen.getByRole('button', { name: 'See it now' }))
  return writes
}
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('spec 5.10: every failure state reachable in wave 8', () => {
  it('1. Busy (preview): the phase 1 sentence; the last result stays, dimmed; Save stays enabled', async () => {
    await lastGoodThen(() => refusal(503, 'busy', COPY.busy))
    expect(within(previewPane()).getByText(COPY.busy)).toBeInTheDocument()
    expect(keptResult().className).toMatch(/dimmed/)
    expect(saveButton()).toBeEnabled()
    expect(within(previewPane()).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('2. Took too long: the sentence, a one-tap "Last 90 days", the last result stays; Save enabled', async () => {
    // Opened from a card whose range is "all time" (Max drawdown), so "Last 90 days" is a real suggestion.
    route('GET', (u) => u === `${DEFS}/shelf`, () => answer({ examples: SHELF }))
    let n = 0
    route('POST', (u) => u.endsWith('/preview'), () => { n += 1; return n === 1 ? answer(payload()) : refusal(503, 'too_long', COPY.tooLong) })
    render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} start="examples" />)
    await flush()
    await flush()
    fireEvent.click(screen.getByTestId('example-card-shelf:max-drawdown'))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(bodyOf(previews()[0]).plan.range).toEqual({ token: 'all' })
    await editAndPreview()
    expect(within(previewPane()).getByText(COPY.tooLong)).toBeInTheDocument()
    keptResult()
    expect(saveButton()).toBeEnabled()
    fireEvent.click(within(previewPane()).getByRole('button', { name: 'Last 90 days' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(bodyOf(previews().at(-1)).plan.range).toEqual({ token: 'last_90d' })
  })

  it('3. Over 5,000 rows: the result shows, labelled with the newest-5,000 sentence', async () => {
    route('POST', (u) => u.endsWith('/preview'), () => answer(payload({ capped: true, notice: COPY.over5000 })))
    await openBuilder()
    expect(within(previewPane()).getByText(COPY.over5000)).toBeInTheDocument()
    expect(within(previewPane()).getByText('+$2,140.00')).toBeInTheDocument()
    // The same label on a placed widget.
    vi.useRealTimers()
    render(<BuiltWidgetEmbed attrs={widgetEmbedNode('builtWidget', { ...SNAP, capped: true, notice: COPY.over5000 }).attrs} />)
    expect(screen.getAllByText(COPY.over5000).length).toBeGreaterThanOrEqual(2)
  })

  it('4. Rate limit (preview): "Pausing the preview"; the last preview stays; Save enabled', async () => {
    await lastGoodThen(() => refusal(429, 'rate_preview', COPY.ratePreview))
    expect(within(previewPane()).getByText(COPY.ratePreview)).toBeInTheDocument()
    keptResult()
    expect(saveButton()).toBeEnabled()
  })

  it('5. Rate limit (widget): See it now says so and the snapshot stays', async () => {
    const writes = await seeItNow(() => reply(429, { detail: { code: 'rate', message: COPY.rateWidget } }))
    expect(await screen.findByText(COPY.rateWidget)).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    expect(screen.getByText('+$1,250.00')).toBeInTheDocument()
  })

  it('6. Daily cap: See it now says snapshots stay, and the snapshot stays', async () => {
    const writes = await seeItNow(() => reply(429, { detail: { code: 'daily_cap', message: COPY.dailyCap } }))
    expect(await screen.findByText(COPY.dailyCap)).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    expect(screen.getByText('+$1,250.00')).toBeInTheDocument()
  })

  it('7. Count cap (save): the sentence; the draft stays in the open builder', async () => {
    route('POST', (u) => u === DEFS, () => refusal(409, 'count_cap', 'x'))
    const { onClose } = await openBuilder()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'One too many' } })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.countCap)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Name')).toHaveValue('One too many')
    expect(saveButton()).toBeEnabled()
  })

  it('8. Offline (builder): the sentence, no request, the last result stays', async () => {
    await openBuilder()
    const before = previews().length
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    await editAndPreview()
    expect(within(previewPane()).getByText(COPY.offline)).toBeInTheDocument()
    expect(previews()).toHaveLength(before)                       // offline makes no request at all
    keptResult()
    expect(saveButton()).toBeEnabled()
  })

  it('9. Flag off (wave dark): a placed widget says "Not available right now." and keeps its snapshot', async () => {
    const writes = await seeItNow(() => reply(404, { detail: 'Not Found' }))
    expect(await screen.findByText(COPY.flagOff)).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    expect(screen.getByText('+$1,250.00')).toBeInTheDocument()
  })

  it('10. Definition missing: See it now runs the frozen copy, and the ⋯ menu says so', async () => {
    const FROZEN = { ...SNAP, defId: null, defRev: null, asOf: '2026-10-24T15:00:00Z', notice: COPY.missing,
      value: { v1: 1900, n1: 14, s1: '', n: 14 }, count: 14 }
    const writes = await seeItNow((url) => (url.endsWith('/run') ? reply(200, FROZEN) : reply(404, { detail: 'Not Found' })),
      { ...SNAP, defId: 'd-gone' })
    expect(await screen.findByText('+$1,900.00')).toBeInTheDocument()     // the result, from the saved copy
    expect(screen.getByText(COPY.missing)).toBeInTheDocument()
    expect(bodyOf([null, globalThis.fetch.mock.calls[0][1]]).def).toEqual(SNAP.def)
    expect(writes).toHaveLength(1)
    // A widget whose saved copy is gone, with its own id: the menu reads it and says the same.
    render(<Host params={{ ...SNAP, defId: 'd-gone' }} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'More for this widget' }).at(-1))
    await waitFor(() => expect(within(screen.getByTestId('built-menu')).getByText(COPY.missing)).toBeInTheDocument())
  })

  it('11. Newer plan version: the builder says reload and shows the stored summary, nothing else', async () => {
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer({ id: 'd-1', tooNew: true, summary: 'Net P&L by setup.' }))
    await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.tooNew)
    expect(screen.getByText('Net P&L by setup.')).toBeInTheDocument()
    expect(screen.queryByTestId('builder-save')).toBeNull()
    expect(previews()).toHaveLength(0)
  })

  it('12. Not enough data: "Not enough trades yet (3)" / "Not enough days yet (2)", never a zero', async () => {
    route('POST', (u) => u.endsWith('/preview'), () => answer(payload({
      measures: [{ label: 'Win rate', unit: 'decisive', kind: 'rate', fmt: 'pct' }, { label: 'Day P&L', unit: 'days', kind: 'average', fmt: 'money' }],
      value: { v1: null, n1: 3, s1: 'hide', v2: null, n2: 2, s2: 'hide', n: 3 },
    })))
    await openBuilder()
    expect(within(previewPane()).getByText('Not enough trades yet (3)')).toBeInTheDocument()
    expect(within(previewPane()).getByText('Not enough days yet (2)')).toBeInTheDocument()
    expect(within(previewPane()).queryByText(/^\+?\$?0(\.00)?%?$/)).toBeNull()
  })

  it('13. Changed in another tab (save): the sentence; the draft is kept and stays on screen', async () => {
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer({
      id: 'd-1', name: 'Mine', rev: 3, placedRev: 3, etag: 7, archived: false, usedIn: 1, lastAnswer: null,
      summary: SUMMARY, plan: { v: 1, source: 'closed_trades', range: { token: 'last_90d' }, measures: [{ key: 'net_pnl' }] },
    }))
    route('PUT', (u) => u.endsWith('/d-1'), () => refusal(409, 'conflict', COPY.conflict))
    const { onClose } = await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edited here' } })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.conflict)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Name')).toHaveValue('Edited here')
    expect(JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}u1`))).toMatchObject({ plan: { display: { title: 'Edited here' } } })
  })
})
