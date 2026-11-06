// Audit 2026-11-05, S20 (Tier 3a fix round 1, review minor 9): the "first aha" is recorded once per ACCOUNT, in the
// per-account one-time preference, and sent once.
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setFirstLiveWidgetForTests } from './notebookTelemetry'
import { __resetFirstLiveWidgetForTests } from './firstLiveWidget'
import MyWatchlistTodayEmbed from '../components/notebook/widgets/MyWatchlistTodayEmbed'

const P = vi.hoisted(() => ({ prefs: {}, writes: [] }))
vi.mock('../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({
    prefs: P.prefs, loading: false, readFailed: false,
    setPrefMerged: (key, updater) => {
      const next = updater(P.prefs[key])
      if (next !== undefined) { P.prefs = { ...P.prefs, [key]: next }; P.writes.push([key, next]) }
      return Promise.resolve({ ok: true })
    },
  }),
}))

let sent = []
beforeEach(() => {
  __setFirstLiveWidgetForTests(true)
  __resetFirstLiveWidgetForTests()
  P.prefs = {}
  P.writes = []
  sent = []
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    if (String(url) === '/api/j2/telemetry') sent.push(JSON.parse(opts.body))
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const full = { widgetId: 'myWatchlistToday', params: { rows: [{ symbol: 'NVDA' }, { symbol: 'AMD' }], asOf: 'x' } }

describe('the first live widget', () => {
  it('is recorded on the ACCOUNT and sent once, however many widgets show names', () => {
    render(<><MyWatchlistTodayEmbed attrs={full} /><MyWatchlistTodayEmbed attrs={full} /></>)
    expect(sent).toEqual([{ event: 'first_live_widget', props: { source: 'watchlist', names: 2 } }])
    expect(P.prefs.notebook_tips.seen).toContain('first-live-widget')
  })
  it('an account that already has the mark sends nothing (a second browser, a reload)', () => {
    P.prefs = { notebook_tips: { v: 1, seen: ['first-live-widget'] } }
    render(<MyWatchlistTodayEmbed attrs={full} />)
    expect(sent).toEqual([])
  })
  it('a DIFFERENT account on the same browser still gets its own first aha (the mark is not per browser)', () => {
    P.prefs = { notebook_tips: { v: 1, seen: ['first-live-widget'] } }
    render(<MyWatchlistTodayEmbed attrs={full} />)
    cleanup()
    __resetFirstLiveWidgetForTests()        // a fresh page for the next member
    P.prefs = {}
    render(<MyWatchlistTodayEmbed attrs={full} />)
    expect(sent).toHaveLength(1)
  })
  it('CONTROL: an empty widget sends nothing', () => {
    render(<MyWatchlistTodayEmbed attrs={{ widgetId: 'myWatchlistToday', params: { rows: [] } }} />)
    expect(sent).toEqual([])
  })
})
