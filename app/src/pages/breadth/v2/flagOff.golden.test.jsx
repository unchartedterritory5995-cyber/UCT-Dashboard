// app/src/pages/breadth/v2/flagOff.golden.test.jsx
//
// V2-1 ACCEPTANCE: with the V2 gate off, Data Charts renders EXACTLY what it rendered
// before V2 existed. Not "looks the same", not "the tests still pass" — the same DOM,
// byte for byte, against a golden recorded on this tree.
//
// ⭐⭐ THE GATE IS NOW RUNTIME (DC-2 §2) AND THIS GOLDEN DID NOT MOVE. That is the
// load-bearing fact of the conversion: `flagOff.golden.html` is unchanged, so a member
// with both increments off sees the identical bytes they saw under the build flag. The
// golden was the instrument that could have caught a silent regression in the swap, and
// it is worth more here than it was when it was written.
//
// ⛔ THE DEFAULT IS NOW ALSO A CRASH TEST. The gate reads `useContext(AuthContext)`
// DEFENSIVELY — these renders mount `<BreadthCharts />` with NO provider, so a gate
// written with `useAuth()` (which throws outside one) would fail here rather than fall
// back to V1. "Off" must be calm, not merely false.
//
// ⛔ THE GOLDEN IS GENERATED ONCE, with WRITE_V2_GOLDEN=1. Regenerating it to turn a red
// run green deletes the only evidence that V2 was invisible — the same rule as
// `heatmapRegistry.golden.test.js`, and the same reason.
//
// ⚠️ Two things are normalised before comparison, and ONLY two, because a normaliser that
// erases too much is a golden that cannot fail: React's generated ids (`useId` and UIcon's per-render
// gradient counter, both position-dependent and neither a product fact) and ISO dates (the window is built on TODAY,
// so an un-normalised golden would rot at the next midnight and be regenerated out of
// existence within a day).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import BreadthCharts from '../../BreadthCharts'
import { AuthContext } from '../../../context/AuthContext'
import { todayET, shiftISO } from '../sessionDates'

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="echart" />,
}))

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'flagOff.golden.html')

const isoDaysAgo = n => shiftISO(todayET(), -n)
const ROWS = Array.from({ length: 30 }, (_, i) => ({
  date: isoDaysAgo(29 - i),
  breadth_score: 60 + i,
  pct_above_50sma: 45 + i,
  uct_exposure: 50 + i,
  sp500_close: 6800 + i * 10,
}))

/** Volatile-but-not-product bits out; everything else stays. */
function normalise(html) {
  return html
    .replace(/\d{4}-\d{2}-\d{2}/g, '<DATE>')
    .replace(/(\b(?:id|for|aria-controls|aria-labelledby|aria-describedby|name)=")[^"]*(")/g, '$1<ID>$2')
    .replace(/url\(#[^)]*\)/g, 'url(#<ID>)')   // UIcon's gradient id counts UP per render
    .replace(/«[^»]*»/g, '<ID>')
}

/**
 * Render Data Charts under a given auth payload.
 *
 * ⛔ `ctx === null` (the default) is NOT a convenience — it is the case a gate built on
 * `useAuth()` would throw in, and it is the one a reader is most likely to write. Passing
 * no provider at all must land on V1, calmly.
 */
async function renderDataCharts(ctx = null) {
  const tree = ctx === null
    ? <BreadthCharts />
    : <AuthContext.Provider value={ctx}><BreadthCharts /></AuthContext.Provider>
  const { container } = render(tree)
  await waitFor(() => expect(screen.getByTestId('echart')).toBeInTheDocument())
  return normalise(container.innerHTML)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    if (String(url).includes('/api/breadth-monitor')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: ROWS }) })
    }
    if (String(url).includes('/api/auth/preferences')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts?.method === 'POST' ? { ok: true } : {}) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('flag off, V2 is invisible', () => {
  it('renders the golden DOM exactly', async () => {
    const html = await renderDataCharts()
    if (process.env.WRITE_V2_GOLDEN === '1') fs.writeFileSync(GOLDEN, html + '\n')
    expect(html).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd())
  })

  // ⛔ THE OFF STATES MUST BE ONE DOM. A payload that says `false`, a payload that omits
  // the keys (a backend older than DC-2), and no payload at all are different facts about
  // WHY the gate is off and must be identical on screen.
  //
  // ⛔ ONE RENDER PER CASE, via `it.each`. Written first as a loop inside a single test,
  // which FAILED for a reason worth keeping: Testing Library cleans up between TESTS, not
  // within one, so the second render left two trees mounted and `getByTestId` matched
  // both. A rail that renders twice in one body is testing the harness, not the product.
  it.each([
    ['the server says false', { breadthDcV22Enabled: false, breadthDcV23Enabled: false }],
    ['the server omits the keys', {}],
    // The build flag's own trap, carried forward: `'0'` is a string and therefore truthy,
    // so a gate written `if (flag)` reads a deliberate off as an on. `=== true` is what
    // makes every one of these land on V1.
    ["the string '0'", { breadthDcV22Enabled: '0' }],
    ["the string 'false'", { breadthDcV22Enabled: 'false' }],
    ['the number 0', { breadthDcV22Enabled: 0 }],
    ['null', { breadthDcV22Enabled: null }],
    ['the empty string', { breadthDcV22Enabled: '' }],
  ])('renders the golden DOM when %s', async (_label, ctx) => {
    expect(await renderDataCharts(ctx)).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd())
  })
})

describe('the golden could actually fail', () => {
  it.each([
    ['V2-2 alone', { breadthDcV22Enabled: true, breadthDcV23Enabled: false }],
    ['V2-3 alone', { breadthDcV23Enabled: true, breadthDcV22Enabled: false }],
    ['both', { breadthDcV22Enabled: true, breadthDcV23Enabled: true }],
  ])('%s renders something DIFFERENT — so the comparison is not vacuous', async (_label, ctx) => {
    // ⭐ EITHER increment opens the tab, and that is the design: the V2-1 shell is a
    // diagnostic list, not a chart, so a member reaching it with BOTH off would lose
    // V1's charts and get text — a regression dressed as a release. Driving all three
    // on-states also proves the two flags are independent at the RENDER boundary, not
    // just inside the helper that reads them.
    const { container } = render(<AuthContext.Provider value={ctx}><BreadthCharts /></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByTestId('breadth-charts-v2')).toBeInTheDocument())
    const html = normalise(container.innerHTML)
    expect(html).not.toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd())
    // …and V1 is genuinely gone, not merely accompanied.
    expect(screen.queryByTestId('echart')).toBeNull()
  })

  it('would notice a one-character change to the V1 DOM', async () => {
    const html = await renderDataCharts()
    expect(html.replace('<div', '<div ')).not.toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd())
  })

  it('the golden holds real markup, so the normaliser has not erased the page', () => {
    const g = fs.readFileSync(GOLDEN, 'utf8')
    expect(g.length, 'a near-empty golden matches almost anything').toBeGreaterThan(2000)
    expect(g).toContain('data-testid="echart"')
    // The normaliser must not have flattened the whole document into placeholders.
    expect(g.split('<DATE>').length - 1).toBeLessThan(g.length / 50)
  })
})
