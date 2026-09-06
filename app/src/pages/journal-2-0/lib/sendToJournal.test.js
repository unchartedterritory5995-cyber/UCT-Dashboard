import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Isolate sendCaptureToJournal's own orchestration (telemetry + target
// dispatch) from the real attrs-building/warm/target machinery.
vi.mock('./widgetEmbedCore', () => ({
  buildWidgetEmbedAttrs: (widgetId, capture, extra) => ({ widgetId, params: capture, ...extra }),
}))
vi.mock('./embedArchive', () => ({ kickSnapshotWarm: vi.fn() }))

const runMock = vi.fn(async () => 'Saved')
vi.mock('./captureTargets', () => ({
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
