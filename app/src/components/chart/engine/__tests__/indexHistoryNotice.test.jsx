// ⭐⭐ THE INDEX-HISTORY DISCLOSURE (coordinator ruling 2026-11-23): one sentence when a chart's indicator reads SPX / NDX
// intraday history from our data vendor's older sessions (the route's `deep` record, `api/index_bars.py`), EXACTLY then.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import {
  INDEX_HISTORY_NOTE, readsVendorPrefix, setIndexHistoryNote, indexHistoryNotesFor, onIndexHistoryChange,
  _resetIndexHistoryNotes, etSessionOf,
} from '../indexHistoryNotice'
import { fetchSecondaryBars, clearSecondaryBars } from '../secondaryBars'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'

// ET wall clock -> unix seconds (November: EST, UTC-5)
const at = (day, h, m = 0) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + (h + 5) * 3600 + m * 60
const JOINED = { indexDeep: { src: 'fmp', joined: true, from: '2020-11-23', through: '2026-08-27' }, status: 'available', bars: [] }

beforeEach(() => { _resetIndexHistoryNotes() })
afterEach(() => { cleanup(); _resetIndexHistoryNotes() })

describe('the decision is the served provenance and this chart’s bars, nothing else', () => {
  it('a joined vendor prefix, and a chart whose oldest bar is on or before its last session: the sentence', () => {
    expect(readsVendorPrefix(JOINED, at('2026-08-27', 15, 55))).toBe(true)   // the prefix's own last session
    expect(readsVendorPrefix(JOINED, at('2024-01-02', 9, 30))).toBe(true)
  })

  it('⛔ CONTROLS: no deep record, a prefix not joined, a chart starting after the prefix, a daily (ISO) chart: none', () => {
    expect(readsVendorPrefix({ status: 'available', bars: [] }, at('2024-01-02', 9, 30))).toBe(false)
    expect(readsVendorPrefix({ indexDeep: { ...JOINED.indexDeep, joined: false } }, at('2024-01-02', 9, 30))).toBe(false)
    expect(readsVendorPrefix(JOINED, at('2026-08-28', 9, 30))).toBe(false)   // Yahoo's own window only
    expect(readsVendorPrefix(JOINED, '2024-01-02')).toBe(false)
    expect(readsVendorPrefix(null, at('2024-01-02', 9, 30))).toBe(false)
  })

  it('the session is the ET date (a 19:00 ET bar is that day, not the next UTC day)', () => {
    expect(etSessionOf(at('2026-08-27', 19, 0))).toBe('2026-08-27')
    expect(readsVendorPrefix(JOINED, at('2026-08-27', 19, 0))).toBe(true)
  })
})

describe('the store: scoped by chart, keyed by instance, emits only on a change', () => {
  it('one chart’s note does not speak for another chart; clearing it clears it', () => {
    let fired = 0; const off = onIndexHistoryChange(() => { fired += 1 })
    setIndexHistoryNote('i1', true, 'chartA')
    setIndexHistoryNote('i1', true, 'chartA')            // no change, no emit
    expect(fired).toBe(1)
    expect(indexHistoryNotesFor(['i1'], 'chartA')).toEqual([{ code: 'index-history:vendor-prefix', reason: INDEX_HISTORY_NOTE }])
    expect(indexHistoryNotesFor(['i1'], 'chartB')).toEqual([])
    expect(indexHistoryNotesFor(['i2'], 'chartA')).toEqual([])
    setIndexHistoryNote('i1', false, 'chartA')
    expect(indexHistoryNotesFor(['i1'], 'chartA')).toEqual([])
    expect(fired).toBe(2)
    off()
  })
})

describe('the strip renders the sentence, once, for this pane’s instances', () => {
  it('shown when set for an attached instance; gone when cleared', () => {
    const settings = { indicatorInstances: [{ instanceId: 'fred-1', defId: 'seed-fred' }] }
    render(<AttachedPineDisclosures settings={settings} barsLoaded={300} noticeScope="s1" />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    act(() => { setIndexHistoryNote('fred-1', true, 's1') })
    expect(screen.getByTestId('pine-attached-disclosures').textContent).toContain(INDEX_HISTORY_NOTE)
    act(() => { setIndexHistoryNote('fred-1', false, 's1') })
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
  })

  it('⛔ another pane’s instance does not speak here', () => {
    act(() => { setIndexHistoryNote('someone-else', true, 's1') })
    render(<AttachedPineDisclosures settings={{ indicatorInstances: [{ instanceId: 'fred-1', defId: 'seed-fred' }] }} barsLoaded={300} noticeScope="s1" />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
  })
})

describe('the served entry keeps the route’s `deep` record', () => {
  it('a payload with `deep` -> `indexDeep` on the entry; without it, none', async () => {
    clearSecondaryBars()
    const bars = [{ t: at('2026-11-20', 9, 30), o: 1, h: 1, l: 1, c: 1, v: 0 }]
    const e = await fetchSecondaryBars('SPX', '5', 40000, async () => ({ bars, deep: { src: 'fmp', joined: true, from: '2020-11-23', through: '2026-08-27', sessions: 776 } }))
    expect(e.indexDeep).toEqual({ src: 'fmp', joined: true, from: '2020-11-23', through: '2026-08-27' })
    const f = await fetchSecondaryBars('SPY', '5', 40000, async () => ({ bars }))
    expect(f.indexDeep).toBeUndefined()
    clearSecondaryBars()
  })
})

describe('the chart wires it (code, not prose)', () => {
  it('StockChart sets the note per instance from the served entries and its oldest loaded bar, in its binder scope', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../StockChart.jsx'), 'utf8')
    expect(src).toMatch(/readsVendorPrefix\(secondarySources\.get\(k\), _spanFirstT\)/)
    expect(src).toMatch(/setIndexHistoryNote\(inst\.instanceId, on, binderNoticeScope\)/)
  })
})
