// app/src/components/screener/ScanResults.liveonly.test.jsx
//
// ─── THE LIVE SWEEP'S WHOLE POINT, ON SCREEN (X43 · A6) ─────────────────────
//
// `api/routers/scan_results.py` assembles a LIVE-ONLY TAIL on every request —
// every fresh `scan_hits_live` row for this definition that the nightly scan did
// NOT return — appends it to `hits` with `in_nightly: false`, bounds it by the
// page limit and reports the cut under `truncated`. `tickers` is the NIGHTLY
// half, and this surface used to iterate exactly that. The tail was built,
// capped and discarded for an audience of nobody.
//
// ⭐ AND THAT IS WHY ARMING THE SWEEP WOULD HAVE LOOKED LIKE A NO-OP.
// `SCAN_LIVE_SWEEP_ENABLED` is unset, so `scan_hits_live` is empty, so the tail
// is empty — the surface is byte-identical either way. The env flip would have
// filled the tail and changed nothing a member could read. Every case below is
// therefore written against what a member can READ, never against a prop that
// was passed: a chip whose words are wrong passes every state-only rail.
//
// ⛔ BOTH DIRECTIONS, EVERY TIME. A live-only hit must APPEAR and be
// DISTINGUISHABLE; with no live-only rows the surface must look exactly as it
// does today. The controls are not decoration — without them these cases are
// satisfied by a component that renders the second block unconditionally, which
// would caption every ordinary nightly screen with a live sweep that never ran.

import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { parseFormula, astHash } from '../chart/engine/ast/parse'
import { lintRepaint } from '../chart/engine/ast/lint'
import { freshnessFor } from '../chart/engine/ast/freshness'
import { SCHEMA_VERSION } from '../chart/engine/defSchema'
import { AST_LANE_TIER, clearUserDefinitions } from '../chart/engine/nativeRegistry'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../chart/builder/builderInputs'

vi.mock('../chart/pane/ChartPane', () => ({
  default: ({ sym, tf }) => <div data-testid={`pane-inner-${sym}-${tf}`}>pane</div>,
}))

const ScanResults = (await import('./ScanResults')).default
const { tierLabel, RESULTS_ENDPOINT } = await import('./ScanResults')

const SCAN_SOURCE = 'close > sma(close, 50)'
const PARSED = parseFormula(SCAN_SOURCE)
if (!PARSED.ok) throw new Error(`fixture does not parse: ${PARSED.error}`)
const AST = PARSED.ast
const DEF_HASH = astHash(AST)
const DEF_ID = 'u_0123456789ab'
const DEFINITION = Object.freeze({
  schemaVersion: SCHEMA_VERSION, id: DEF_ID, version: 1,
  meta: { name: 'Above the 50', shortName: 'A50', category: 'Custom', tier: AST_LANE_TIER,
    repaint: lintRepaint(AST, { inputs: BUILDER_INPUT_SCOPE }).mode, freshness: freshnessFor(AST).mode },
  compute: { kind: 'ast', fn: DEF_HASH, rev: 1, ast: AST, source: SCAN_SOURCE },
  placement: { target: 'pane', pane: { height: 0.15 } },
  inputs: BUILDER_INPUTS,
  plots: [{ key: 'value', label: 'A50', style: 'line', color: '$color', width: 1, role: 'primary' }],
})

const AS_OF = 20260807
const LIVE_AS_OF = 1756132920      // an epoch, formatted by the SAME rule the chip uses
const EXPECTED_LIVE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
}).format(new Date(LIVE_AS_OF * 1000))

// ⛔ THE ROUTE'S ROW SHAPE, NOT A SKETCH. `scan_store.hits_for` pins it:
// `{symbol, tier, in_nightly, live_as_of, value, src_price, live_cols}`, `tier`
// one of `LIVE_TIERS = ("nightly", "live")`. A live-only row is the one the
// route appends with `in_nightly: false` — and `tier` is `live` by construction
// there, because a row only reaches the tail by having a fresh live row.
const nightlyRow = (symbol, over = {}) => ({
  symbol, tier: 'nightly', in_nightly: true,
  live_as_of: null, value: null, src_price: null, live_cols: 0, ...over,
})
const liveOnlyRow = (symbol, over = {}) => ({
  symbol, tier: 'live', in_nightly: false,
  live_as_of: LIVE_AS_OF, value: 1, src_price: 10.5, live_cols: 4, ...over,
})

// ⛔ A RECEIPT WHOSE ARITHMETIC CLOSES. `CoverageLine` refuses to present one
// that does not, and a fixture that tripped that refusal would be measuring it
// instead of this file's subject.
const RECEIPT = { evaluated: 3742, answered: 3700, dropped: 1, not_computable: 41,
  dropped_symbols: [] }

const evaluated = (over = {}) => ({
  def_hash: DEF_HASH, tf: 'D', as_of: AS_OF, status: 'evaluated',
  coverage: RECEIPT,
  tickers: ['NVDA'],
  hits: [nightlyRow('NVDA')],
  live: null,
  truncated: false, ...over,
})

const H = { payload: null }
beforeEach(() => {
  H.payload = evaluated()
  clearUserDefinitions()
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith(RESULTS_ENDPOINT)) return { ok: true, status: 200, json: async () => H.payload }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearUserDefinitions() })

const surface = () => render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)

describe('the live-only tail reaches the member', () => {
  it('a live-only hit is ON SCREEN, in its own block, and the block SAYS what it is', async () => {
    H.payload = evaluated({
      tickers: ['NVDA'],
      hits: [nightlyRow('NVDA'), liveOnlyRow('TSLA')],
    })
    surface()

    // The words, not the testid: a named block whose sentence is wrong passes
    // every state-only rail.
    const note = await screen.findByTestId('scan-live-only-note')
    expect(note.textContent).toMatch(/found by the live sweep only/i)
    expect(note.textContent).toMatch(/were not hits in the nightly scan/i)

    // The symbol itself, in the second list and not the first.
    expect(screen.getByTestId('scan-live-only-hits')).toHaveTextContent('TSLA')
    expect(screen.getByTestId('scan-hits')).not.toHaveTextContent('TSLA')
    expect(screen.getByTestId('scan-hits')).toHaveTextContent('NVDA')
  })

  it('and the ROW ITSELF says it — "live only <ET>" beside a nightly hit that says "nightly"', async () => {
    H.payload = evaluated({
      tickers: ['NVDA'],
      hits: [nightlyRow('NVDA'), liveOnlyRow('TSLA')],
    })
    surface()
    // ⭐ THE ROW READ OUT OF CONTEXT IS STILL HONEST. A screen reader meets one
    // <li> at a time, so the block caption alone would leave "TSLA live 9:42 AM
    // ET" indistinguishable from a nightly hit that also has a live row.
    expect((await screen.findByTestId('scan-hit-tier-TSLA')).textContent)
      .toBe(`live only ${EXPECTED_LIVE} ET`)
    expect(screen.getByTestId('scan-hit-tier-NVDA').textContent).toBe('nightly')
  })

  it('CONTROL: with no live-only rows the surface is exactly what it is today', async () => {
    // The state production is in RIGHT NOW — `SCAN_LIVE_SWEEP_ENABLED` unset, so
    // `scan_hits_live` is empty and the tail is empty with it. Nothing new may
    // appear on this screen, or every ordinary member gets a caption about a
    // sweep that never ran.
    H.payload = evaluated({
      tickers: ['NVDA', 'AMD'],
      hits: [nightlyRow('NVDA'), nightlyRow('AMD')],
    })
    surface()
    await screen.findByTestId('scan-hits')
    expect(screen.queryByTestId('scan-live-only-note')).toBeNull()
    expect(screen.queryByTestId('scan-live-only-hits')).toBeNull()
    expect(screen.getByTestId('scan-hits')).toHaveTextContent('NVDA')
    expect(screen.getByTestId('scan-hits')).toHaveTextContent('AMD')
    expect(screen.queryByText(/found by the live sweep only/i)).toBeNull()
  })

  it('CONTROL: hits carrying no `in_nightly` at all — the on-demand door — grow no second block', async () => {
    // `RunNowButton.toScanResultsPayload` derives `tickers` from the job's hits
    // and forwards no provenance, so those rows have no `in_nightly` key.
    // Reading a MISSING key as `false` would invent a live-only block for an
    // answer set that has no live half at all.
    H.payload = evaluated({ tickers: ['NVDA'], hits: [{ symbol: 'NVDA', value: 1, bar_time: 20260821 }] })
    surface()
    await screen.findByTestId('scan-hits')
    expect(screen.queryByTestId('scan-live-only-hits')).toBeNull()
    expect(screen.queryByTestId('scan-live-only-note')).toBeNull()
  })
})

describe('a live-only hit is a MATCH, and the empty line knows it', () => {
  it('"no symbol matched" does NOT appear above a block of live-only hits', async () => {
    // The nightly scan returned nothing and the live sweep returned two. Saying
    // "this screen ran and no symbol matched" over them would be false on the
    // face of one screen.
    H.payload = evaluated({ tickers: [], hits: [liveOnlyRow('TSLA'), liveOnlyRow('PLTR')] })
    surface()
    expect(await screen.findByTestId('scan-live-only-hits')).toHaveTextContent('TSLA')
    expect(screen.getByTestId('scan-live-only-hits')).toHaveTextContent('PLTR')
    expect(screen.queryByTestId('scan-results-empty')).toBeNull()
  })

  it('CONTROL: a genuinely empty answer still says so, in those words', async () => {
    H.payload = evaluated({ tickers: [], hits: [] })
    surface()
    const said = await screen.findByTestId('scan-results-empty')
    expect(said.textContent).toMatch(/this screen ran and no symbol matched/i)
  })

  it('a live-only hit carries the chart button, and it charts WITH the definition', async () => {
    // ⛔ A ROW WITHOUT A BUTTON IS A SECOND CLASS OF HIT. The live-only set is
    // the live sweep's whole answer; handing it a list a member cannot act on
    // would rebuild the discard one layer up.
    H.payload = evaluated({ tickers: [], hits: [liveOnlyRow('TSLA')] })
    surface()
    await userEvent.click(await screen.findByRole('button', { name: /chart TSLA/i }))
    const pane = screen.getByTestId('chart-pane')
    expect(pane.getAttribute('data-symbol')).toBe('TSLA')
    expect(pane.getAttribute('data-definition')).toBe(DEF_HASH)
  })
})

describe('a cut page admits it', () => {
  it('`truncated` is SAID — a short list that hides its cap reads as a quiet market', async () => {
    H.payload = evaluated({
      tickers: ['NVDA'],
      hits: [nightlyRow('NVDA'), liveOnlyRow('TSLA'), liveOnlyRow('PLTR'), liveOnlyRow('SOFI')],
      truncated: true,
    })
    surface()
    const said = await screen.findByTestId('scan-results-truncated')
    expect(said.textContent).toMatch(/this page is short of the hits/i)
    expect(said.textContent).toMatch(/row cap/i)
    // …and every row the route DID send is still on screen. A page that both
    // hides rows and admits the cut would be two failures, not one.
    for (const sym of ['TSLA', 'PLTR', 'SOFI']) {
      expect(screen.getByTestId('scan-live-only-hits')).toHaveTextContent(sym)
    }
  })

  it('CONTROL: an uncut page says nothing about a cap', async () => {
    H.payload = evaluated({ tickers: ['NVDA'], hits: [nightlyRow('NVDA'), liveOnlyRow('TSLA')] })
    surface()
    await screen.findByTestId('scan-live-only-hits')
    expect(screen.queryByTestId('scan-results-truncated')).toBeNull()
    expect(screen.queryByText(/short of the hits/i)).toBeNull()
  })
})

describe('tierLabel — "only" is the ROW\'s word, never an inference', () => {
  it('`in_nightly: false` makes it "only"; true and MISSING do not', () => {
    expect(tierLabel({ tier: 'live', in_nightly: false })).toBe('live only')
    expect(tierLabel({ tier: 'live', in_nightly: false, live_as_of: LIVE_AS_OF }))
      .toBe(`live only ${EXPECTED_LIVE} ET`)
    // ⛔ THE TWO NON-CLAIMS. A row that says it IS in the nightly set, and a row
    // that says nothing at all, must both read plain "live" — a falsy check
    // (`!row.in_nightly`) would fail this second one and print "only" for every
    // on-demand hit in the app.
    expect(tierLabel({ tier: 'live', in_nightly: true })).toBe('live')
    expect(tierLabel({ tier: 'live' })).toBe('live')
    expect(tierLabel({ tier: 'nightly', in_nightly: false })).toBe('nightly')
  })
})
