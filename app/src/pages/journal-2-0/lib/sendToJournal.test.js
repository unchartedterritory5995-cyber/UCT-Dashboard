import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Isolate sendCaptureToJournal's own orchestration (telemetry + target
// dispatch) from the real attrs-building/warm/target machinery.
vi.mock('./widgetEmbedCore', () => ({
  buildWidgetEmbedAttrs: (widgetId, capture, extra) => ({ widgetId, params: capture, ...extra }),
}))
vi.mock('./embedArchive', () => ({ kickSnapshotWarm: vi.fn() }))

const runMock = vi.fn(async () => 'Saved')
// ⛔ PARTIAL MOCK, SPREAD FROM THE ORIGINAL — not a hand-written stand-in.
// This block used to return ONLY `CAPTURE_TARGETS`, which made it a second authority
// over this module's export surface: the moment `sendToJournal.js` began calling
// `freshLastNote` (the Q1 door guard), every `target: 'note'` case here died with
// "No \"freshLastNote\" export is defined on the ./captureTargets mock" — two gate
// regressions for a product change that was correct. The `inbox` case never failed,
// which is what made it read as a door-guard bug rather than a fixture gap.
// ⭐ The intent stated at the top of this file is to isolate TARGET DISPATCH; it was
// never to stub id resolution. Spreading the original keeps that true, and keeps it
// true for the next export a consumer reaches for.
vi.mock('./captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: (...a) => runMock(...a) }, inbox: { run: (...a) => runMock(...a) } },
}))

import { sendCaptureToJournal } from './sendToJournal'

describe('sendCaptureToJournal — Stage A member-validation instrumentation', () => {
  beforeEach(() => {
    runMock.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })))
  })
  afterEach(() => vi.unstubAllGlobals())

  function telemetryCall() {
    return fetch.mock.calls.find(([u]) => String(u) === '/api/j2/telemetry')
  }

  it('fires notebook_capture_saved with widgetId/target/hasTradeRef after a successful send', async () => {
    await sendCaptureToJournal('chart', { symbol: 'NVDA' }, { target: 'inbox', tradeRef: '123', tradeRefType: 'equity_trade' })
    const call = telemetryCall()
    expect(call).toBeTruthy()
    const body = JSON.parse(call[1].body)
    expect(body.event).toBe('notebook_capture_saved')
    expect(body.props).toEqual({ widgetId: 'chart', target: 'inbox', hasTradeRef: true })
  })

  it('hasTradeRef is false when no trade link was attached', async () => {
    await sendCaptureToJournal('chart', { symbol: 'NVDA' }, { target: 'note' })
    const body = JSON.parse(telemetryCall()[1].body)
    expect(body.props.hasTradeRef).toBe(false)
  })

  it('never fires telemetry when the capture itself fails', async () => {
    runMock.mockRejectedValueOnce(new Error('network down'))
    const result = await sendCaptureToJournal('chart', { symbol: 'NVDA' }, { target: 'note' })
    expect(result).toBe('Capture failed — try again')
    expect(telemetryCall()).toBeUndefined()
  })
})

// ⭐ Wave 10 (10D, R-16, study tasks T2/T6): `capture_used` was declared in wave 6 and fired
// from no door. It now fires from the ONE function every capture door funnels through,
// on success only, with a destination word and a kind word — never the capture.
describe('capture_used — the capture door counts a capture, and nothing of it', () => {
  beforeEach(() => {
    runMock.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })))
  })
  afterEach(() => vi.unstubAllGlobals())
  const bodies = () => fetch.mock.calls
    .filter(([u]) => String(u) === '/api/j2/telemetry')
    .map(([, init]) => JSON.parse(init.body))
    .filter((b) => b.event === 'capture_used')

  it('a chart sent to the inbox sends ONE capture_used {inbox, chart}', async () => {
    await sendCaptureToJournal('chart', { symbol: 'NVDA' }, { target: 'inbox', comment: 'my secret thesis' })
    expect(bodies()).toEqual([{ event: 'capture_used', props: { target: 'inbox', widget: 'chart' } }])
    expect(JSON.stringify(bodies())).not.toMatch(/NVDA|secret/)
  })

  it('any other widget is a widget; a failed capture sends nothing', async () => {
    await sendCaptureToJournal('breadth', { date: '2026-09-25' }, { target: 'inbox' })
    runMock.mockRejectedValueOnce(new Error('network down'))
    await sendCaptureToJournal('chart', { symbol: 'AMD' }, { target: 'inbox' })
    expect(bodies().map((b) => b.props)).toEqual([{ target: 'inbox', widget: 'widget' }])
  })
})
