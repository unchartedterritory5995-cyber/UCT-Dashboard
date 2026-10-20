// Notebook widgets (Task 7): the embed host's half of See it now and the share switch.
//
// The five snapshot kinds are bound in EMBED_COMPONENTS, and the host hands each one `editable`
// and an `onUpdateParams`. ⛔ That callback is ONE updateAttributes call (one editor transaction,
// the note's normal save path) carrying the params AND a searchText derived from them. No fetch of
// its own: the only request on this path is the widget payload GET the embed makes.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))

const { seen, stub } = vi.hoisted(() => {
  const seen = []
  const stub = (name) => () => ({ default: (props) => { seen.push({ name, props }); return <div data-testid={`${name}-stub`} /> } })
  return { seen, stub }
})
vi.mock('./widgets/MyWatchlistTodayEmbed', stub('myWatchlistToday'))
vi.mock('./widgets/MyNamesReportingEmbed', stub('myNamesReporting'))
vi.mock('./widgets/TickerCardEmbed', stub('tickerCard'))
vi.mock('./widgets/MyPnlStatsEmbed', stub('myPnlStats'))
vi.mock('./widgets/MyPositionsRiskEmbed', stub('myPositionsRisk'))
vi.mock('./widgets/MyRulesCheckEmbed', stub('myRulesCheck'))
vi.mock('./widgets/MyMistakesEmbed', stub('myMistakes'))

import WidgetEmbedView from './WidgetEmbedView'
import { kickSnapshotWarm } from '../../lib/embedArchive'
import { widgetEmbedNode } from '../../lib/notebookWidgets'

const PAYLOADS = {
  myWatchlistToday: { asOf: '2026-10-20T13:14:00Z', source: 'market', listLabel: 'Watchlist', rows: [] },
  myNamesReporting: { asOf: '2026-10-20T13:14:00Z', source: 'market', rows: [], partial: false },
  tickerCard: { asOf: '2026-10-20T13:14:00Z', source: 'mixed', symbol: 'NVDA', history: null },
  myPnlStats: { asOf: '2026-10-20T13:14:00Z', source: 'broker', range: { from: '2026-10-13', to: '2026-10-17' }, netPnl: 5, tradeCount: 1 },
  myPositionsRisk: { asOf: '2026-10-20T13:14:00Z', source: 'broker', accountSize: null, rows: [] },
  myRulesCheck: { asOf: '2026-10-20T13:14:00Z', source: 'manual', range: { from: '2026-10-13', to: '2026-10-17' }, kept: 3, total: 4, rules: [] },
  myMistakes: { asOf: '2026-10-20T13:14:00Z', source: 'manual', rows: [] },
}
const editor = (isEditable = true) => ({ isEditable, storage: { uctJournalWidgets: { noteId: 'note-1' } }, on() {}, off() {} })

let RealIO
let fetchSpy
beforeAll(() => {
  RealIO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }], this) }
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => { globalThis.IntersectionObserver = RealIO })
beforeEach(() => {
  __resetNotebookFlags()
  seen.length = 0
  kickSnapshotWarm.mockClear()
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { __resetNotebookFlags(); vi.unstubAllGlobals() })

const last = (name) => [...seen].reverse().find((s) => s.name === name)?.props

describe('WidgetEmbedView -> the seven snapshot embeds', () => {
  for (const kind of Object.keys(PAYLOADS)) {
    it(`${kind} mounts its own embed with editable and onUpdateParams`, async () => {
      const { attrs } = widgetEmbedNode(kind, PAYLOADS[kind])
      render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
      await screen.findByTestId(`${kind}-stub`)
      const props = last(kind)
      expect(props.attrs.params.asOf).toBe('2026-10-20T13:14:00Z')
      expect(props.editable).toBe(true)
      expect(typeof props.onUpdateParams).toBe('function')
    })
  }

  it('a read-only editor hands the embed editable=false', async () => {
    const { attrs } = widgetEmbedNode('myPnlStats', PAYLOADS.myPnlStats)
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor(false)} updateAttributes={vi.fn()} />)
    await screen.findByTestId('myPnlStats-stub')
    expect(last('myPnlStats').editable).toBe(false)
  })

  it('onUpdateParams is ONE updateAttributes with the params, their searchText and the refreshed capturedAt', async () => {
    const { attrs } = widgetEmbedNode('myPositionsRisk', PAYLOADS.myPositionsRisk)
    const updateAttributes = vi.fn()
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={updateAttributes} />)
    await screen.findByTestId('myPositionsRisk-stub')
    updateAttributes.mockClear()
    const next = { ...attrs.params, asOf: '2026-10-21T14:00:00Z', rows: [{ symbol: 'NVDA' }, { symbol: 'AVGO' }], share: true }
    last('myPositionsRisk').onUpdateParams(next)
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    const write = updateAttributes.mock.calls[0][0]
    expect(write.params).toEqual(next)
    expect(write.searchText).toBe('[my open positions and risk: 2 positions · as of 2026-10-21]')
    expect(write.capturedAt).toBe('2026-10-21T14:00:00Z')
    expect(write.fallback).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a share flip with the same asOf leaves capturedAt alone', async () => {
    const { attrs } = widgetEmbedNode('myPnlStats', PAYLOADS.myPnlStats)
    const updateAttributes = vi.fn()
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={updateAttributes} />)
    await screen.findByTestId('myPnlStats-stub')
    updateAttributes.mockClear()
    last('myPnlStats').onUpdateParams({ ...attrs.params, share: true })
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0].params.share).toBe(true)
    expect('capturedAt' in updateAttributes.mock.calls[0][0]).toBe(false)
  })

  it('a read-only editor writes nothing', async () => {
    const { attrs } = widgetEmbedNode('myPnlStats', PAYLOADS.myPnlStats)
    const updateAttributes = vi.fn()
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor(false)} updateAttributes={updateAttributes} />)
    await screen.findByTestId('myPnlStats-stub')
    updateAttributes.mockClear()
    last('myPnlStats').onUpdateParams({ ...attrs.params, share: true })
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('a write that arrives after the editor turned read-only is dropped (read live, not captured)', async () => {
    const { attrs } = widgetEmbedNode('myPnlStats', PAYLOADS.myPnlStats)
    const updateAttributes = vi.fn()
    const ed = editor(true)
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={ed} updateAttributes={updateAttributes} />)
    await screen.findByTestId('myPnlStats-stub')
    const write = last('myPnlStats').onUpdateParams
    updateAttributes.mockClear()
    ed.isEditable = false
    expect(write({ ...attrs.params, asOf: '2026-10-21T14:00:00Z' })).toBe(false)
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('a write that arrives inside a share view is dropped', async () => {
    const { attrs } = widgetEmbedNode('myPnlStats', PAYLOADS.myPnlStats)
    const updateAttributes = vi.fn()
    const ed = editor(true)
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={ed} updateAttributes={updateAttributes} />)
    await screen.findByTestId('myPnlStats-stub')
    const write = last('myPnlStats').onUpdateParams
    updateAttributes.mockClear()
    ed.storage.uctJournalWidgets.shareView = true
    expect(write({ ...attrs.params, share: true })).toBe(false)
    expect(updateAttributes).not.toHaveBeenCalled()
  })
})

// Public pages render a widgetEmbed from its archived image only (shareView), so a private
// account widget must never be archived. The archive arming calls kickSnapshotWarm synchronously,
// which is the signal read here.
describe('WidgetEmbedView -> snapshot archive and privacy', () => {
  const mount = async (kind, payload) => {
    const { attrs } = widgetEmbedNode(kind, payload)
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId(`${kind}-stub`)
  }

  it('a private account widget is never armed for the archive', async () => {
    await mount('myPnlStats', PAYLOADS.myPnlStats)
    expect(kickSnapshotWarm).not.toHaveBeenCalled()
  })

  it('a shared account widget is armed', async () => {
    await mount('myPositionsRisk', { ...PAYLOADS.myPositionsRisk, share: true })
    expect(kickSnapshotWarm).toHaveBeenCalledTimes(1)
  })

  it('a market snapshot kind is armed as before', async () => {
    await mount('myWatchlistToday', PAYLOADS.myWatchlistToday)
    expect(kickSnapshotWarm).toHaveBeenCalledTimes(1)
  })

  it('switching share off clears the archived image in the same write', async () => {
    const { attrs } = widgetEmbedNode('myPnlStats', { ...PAYLOADS.myPnlStats, share: true })
    attrs.fallback = { url: '/api/j2/notes/n1/images/0123456789abcdef0123456789abcdef.png', w: 10, h: 10 }
    const updateAttributes = vi.fn()
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={updateAttributes} />)
    await screen.findByTestId('myPnlStats-stub')
    updateAttributes.mockClear()
    last('myPnlStats').onUpdateParams({ ...attrs.params, share: false })
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0]).toMatchObject({ fallback: null, params: { share: false } })
  })
})
