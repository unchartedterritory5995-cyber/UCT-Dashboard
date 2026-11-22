// RS screens, unit U6: the EXACT scan request the Focus page sends for each of the five RS
// screens, as it opens and with each quick-control option chosen, captured so the server's
// end-to-end test (tests/test_rs_screens_u6_e2e.py) replays what a member's browser sends
// instead of re-deriving the columns, the clause shapes or the sort in Python (a second copy
// would drift, which is how the two halves came to disagree in the first place).
//
// For each request: a fresh page (rsHarness), the starters and the filter registry the SERVER
// serves (rsScreensFixture reads the server suite's goldens), the screen pinned so the page lands
// on it. An option is chosen the way a returning member's is: through the remembered-choice
// preference, which the page lays over the starter in ONE scan (rsGolden.test.jsx holds that a
// click through the editor sends the same clauses).
//
// The file is a measurement: it changes only with UPDATE_RS_SCAN_REQUESTS=1, otherwise the last
// test asserts it is current. Same idiom as agentScanSat1Requests.test.jsx.
import { screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { controlsOf, specWithOption, RS_CONTROLS_PREF, RS_NOTE_PREF } from '../rsScreens'
import { rowColumns, rowConfigOf } from '../rsRows'
import { net, resetNet, installFetch, mount, scanBodies, pin } from './rsHarness'
import { RS_STARTERS, SERVED, SERVER_FIXTURES } from './rsScreensFixture'

const OUT = path.join(SERVER_FIXTURES, 'rs_screens_scan_requests.json')
// One case per screen as it opens, then one per option that is not a control's default.
const CASES = RS_STARTERS.flatMap(st => [
  { st, control: null, option: null },
  ...controlsOf(st).flatMap(control => control.options.filter(o => !o.default).map(option => ({ st, control, option }))),
])
const idOf = c => `${c.st.id}${c.control ? `/${c.control.id}=${c.option.id}` : ''}`
const captured = new Map()
// The clauses a request carries, as a set (the editor's order is its own; the server ANDs them).
const asSet = list => list.map(f => JSON.stringify(Object.fromEntries(Object.entries(f).sort()))).sort()

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  // the registry and views the server serves for these screens, not the harness's two entries
  net.meta = { filters: SERVED.meta.filters, categories: [{ key: 'relative_strength', label: 'Relative strength' }], views: SERVED.meta.views }
  installFetch()
})

describe('the scan request the page sends', () => {
  test.each(CASES.map(c => [idOf(c), c]))('%s', async (_id, c) => {
    net.prefs = { [RS_NOTE_PREF]: '1', ...(c.control ? { [RS_CONTROLS_PREF]: JSON.stringify({ [c.st.id]: { [c.control.id]: c.option.id } }) } : {}) }
    pin([c.st.id])
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${c.st.name}.*Change screen`) })).toBeInTheDocument())
    const want = c.control ? specWithOption(c.st.spec, c.control, c.option) : c.st.spec
    await waitFor(() => expect(asSet(scanBodies().at(-1)?.filters || [])).toEqual(asSet(want.filters)))
    // ONE scan for the screen: the choice is laid over the starter before anything is asked
    expect(scanBodies()).toHaveLength(1)
    const body = scanBodies()[0]
    // the sort and the rank are the screen's (or the option's), and nothing else rides along
    if (want.sort) expect(body.sort).toEqual(want.sort)
    expect(body.rank ?? null).toEqual(want.rank ?? null)
    expect(body.view).toBe(c.st.spec.view)
    expect(Object.keys(body).sort()).toEqual(['columns', 'filters', 'page', 'page_size', 'sort', 'view', ...(want.rank ? ['rank'] : [])].sort())
    // every column the row, the caption, the tags and the header read is asked for
    for (const col of rowColumns(rowConfigOf(c.st))) expect(body.columns, col).toContain(col)
    expect(new Set(body.columns).size).toBe(body.columns.length)
    captured.set(idOf(c), { starter: c.st.id, choices: c.control ? { [c.control.id]: c.option.id } : {}, body })
  })

  test('the captured requests are the file the server replays', () => {
    // A filtered run (-t) captures only some: it neither rewrites nor judges the file.
    if (captured.size !== CASES.length) return
    const text = JSON.stringify({
      about: 'Captured by app/src/pages/screener/focus/__tests__/rsScanRequests.test.jsx (UPDATE_RS_SCAN_REQUESTS=1 rewrites): '
        + 'the body of POST /api/screener/scan the Focus page sends for each RS screen as it opens and with each quick-control option '
        + 'chosen. Replayed by tests/test_rs_screens_u6_e2e.py.',
      requests: CASES.map(c => captured.get(idOf(c))),
    }, null, 1) + '\n'
    if (process.env.UPDATE_RS_SCAN_REQUESTS === '1') { fs.writeFileSync(OUT, text); return }
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : ''
    if (have !== text) throw new Error('the scan requests the page sends moved: review the diff, then rerun with UPDATE_RS_SCAN_REQUESTS=1')
  })
})
