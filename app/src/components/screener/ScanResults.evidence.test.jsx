// app/src/components/screener/ScanResults.evidence.test.jsx
//
// ─── THE SECOND DOOR, WIRE-CUT STYLE ────────────────────────────────────────
// A member on /screener opens a scan's hits and clicks "Evidence". The
// assertion is a HASH EQUALITY ACROSS THE HOP: the Evidence surface publishes
// the hash of the tree it was handed (`data-definition`), the POST it issues
// names the definition by id, and both are derived from the fixture — nothing
// here types a hash. Cut the button's handler, the import, or the prop, and
// only this file reds while every component stays correct.
//
// ⭐ AND EVERY AFFORDANCE IS TRUE OF THE DEFINITION IT SITS ON. A button that
// says "Evidence" for a definition that can never have any is the same defect as
// a spinner saying "Replaying…" when nothing was ever requested, one level up.
// The two states that cannot have evidence get NAMED SENTENCES here, not a
// silent gap and never a dead button.
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { parseFormula, astHash } from '../chart/engine/ast/parse'
import { lintRepaint } from '../chart/engine/ast/lint'
import { freshnessFor } from '../chart/engine/ast/freshness'
import { SCHEMA_VERSION } from '../chart/engine/defSchema'
import { AST_LANE_TIER, clearUserDefinitions } from '../chart/engine/nativeRegistry'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../chart/builder/builderInputs'
import { BACKTEST_ENDPOINT, RECORD_ENDPOINT } from '../chart/builder/EvidenceTab'

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
const LIVE_AS_OF = 1756132920   // an epoch, formatted by the SAME rule the chip uses
const EXPECTED_LIVE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(LIVE_AS_OF * 1000))

// ⛔ MEASURED AGAINST THE ROUTE, NOT THE BRIEF'S SKETCH.
// `api/routers/scan_results.py` answers an evaluated session with `hits` — an
// ARRAY of provenance rows built by `scan_store.hits_for`, whose own docstring
// pins the shape: `[{symbol, tier, in_nightly, live_as_of, value, src_price,
// live_cols}]`, `tier` one of `LIVE_TIERS = ("nightly", "live")`.
//
// There is NO `tiers` map on this payload, and the tick is `live_as_of`, not
// `as_of`. A component reading `payload.tiers[ticker].as_of` would find
// `undefined` on every real response and render a chip that can never appear —
// green here, invisible in production. So the fixture is the route's shape.
const hitRow = (symbol, over = {}) => ({
  symbol, tier: 'nightly', in_nightly: true,
  live_as_of: null, value: null, src_price: null, live_cols: 0, ...over,
})

const evaluated = (over = {}) => ({
  def_hash: DEF_HASH, tf: 'D', as_of: AS_OF, status: 'evaluated',
  coverage: { evaluated: 3742, answered: 3700, dropped: 1, not_computable: 41, dropped_symbols: [] },
  tickers: ['NVDA', 'AMD'],
  hits: [hitRow('NVDA'), hitRow('AMD')],
  live: null,
  truncated: false, ...over,
})

const H = { payload: null, posts: [] }
beforeEach(() => {
  H.payload = evaluated(); H.posts = []
  clearUserDefinitions()
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url)
    if ((init.method || 'GET') === 'POST') { H.posts.push({ url: u, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ job: 'j9', status: 'running' }) } }
    if (u.startsWith(RESULTS_ENDPOINT)) return { ok: true, status: 200, json: async () => H.payload }
    if (u.startsWith(`${BACKTEST_ENDPOINT}/`)) return { ok: true, status: 200, json: async () => ({ job: 'j9', status: 'running' }) }
    if (u.startsWith(RECORD_ENDPOINT)) return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, def_hash: DEF_HASH, rev: 1, tf: 'D', tf_label: '1D', window: null, claim: { coverage: 'unproven', refusal: 'no record yet', symbols: { requested: 0, proven: 0, unproven: [] }, evaluated: 0, hits: null, hit_rate: null, horizon: { retention_days: 540 } } }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ScanResults → Evidence', () => {
  it('the Evidence button opens the SAME EvidenceTab for THIS definition, by id and by hash', async () => {
    render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)
    await screen.findByTestId('scan-hits')
    await userEvent.click(screen.getByRole('button', { name: /evidence for above the 50/i }))
    const tab = await screen.findByTestId('evidence-tab')
    expect(tab.getAttribute('data-definition')).toBe(DEF_HASH)
    await waitFor(() => expect(H.posts).toHaveLength(1))
    expect(H.posts[0].url).toBe(`${BACKTEST_ENDPOINT}?background=1`)
    expect(H.posts[0].body.def_id).toBe(DEF_ID)
  })

  it('CONTROL: before the click nothing is asked, and a definition without an id offers no door', async () => {
    render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)
    await screen.findByTestId('scan-hits')
    expect(H.posts).toHaveLength(0)
    expect(screen.queryByTestId('evidence-tab')).toBeNull()
    cleanup()
    const { id, ...noId } = DEFINITION
    render(<ScanResults definition={noId} asOf={AS_OF} tf="D" />)
    await screen.findByTestId('scan-hits')
    expect(screen.queryByRole('button', { name: /evidence for/i })).toBeNull()
  })

  it('the open receipt belongs to the answer set being replaced — a new session shuts it', async () => {
    // The same doctrine this file's neighbour already applies to the open CHART:
    // a study is ABOUT the definition-and-session on screen, so leaving it open
    // across a switch would show one screen's receipt over another's hits.
    const { rerender } = render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)
    await screen.findByTestId('scan-hits')
    await userEvent.click(screen.getByRole('button', { name: /evidence for above the 50/i }))
    await screen.findByTestId('evidence-tab')
    rerender(<ScanResults definition={DEFINITION} asOf={20260808} tf="D" />)
    await waitFor(() => expect(screen.queryByTestId('evidence-tab')).toBeNull())
  })

  // ⭐ NOT A SILENT GAP. Both of these render hits, so the surface is plainly
  // alive — and a member who can see rows but no Evidence deserves the reason.
  // The sentence is asserted, not merely the testid: a named state whose words
  // are wrong passes every state-only rail.
  it('a definition that was never saved says so, and offers no button to press', async () => {
    const { id, ...noId } = DEFINITION
    render(<ScanResults definition={noId} asOf={AS_OF} tf="D" />)
    await screen.findByTestId('scan-hits')
    const said = screen.getByTestId('scan-evidence-unsaved')
    expect(said.textContent).toMatch(/saved/i)
    expect(said.tagName).not.toBe('BUTTON')
    expect(said.querySelector('button')).toBeNull()
    expect(H.posts).toHaveLength(0)
  })

  it('a definition carrying no hash says so — the receipt has nothing to be bound to', async () => {
    const noHash = { ...DEFINITION, compute: { ...DEFINITION.compute, fn: null } }
    // `payload` is handed in because without a hash this surface never fetches;
    // the hits are on screen and the missing affordance still needs its reason.
    render(<ScanResults definition={noHash} asOf={AS_OF} tf="D" payload={evaluated()} />)
    await screen.findByTestId('scan-hits')
    const said = screen.getByTestId('scan-evidence-no-hash')
    expect(said.textContent).toMatch(/hash/i)
    expect(screen.queryByRole('button', { name: /evidence for/i })).toBeNull()
    expect(H.posts).toHaveLength(0)
  })
})

describe('ScanResults — live vs nightly per hit (the route own `hits` rows)', () => {
  it('renders "live <ET time>" and "nightly" from the route rows, in the session timezone', async () => {
    H.payload = evaluated({ hits: [
      hitRow('NVDA', { tier: 'live', live_as_of: LIVE_AS_OF }),
      hitRow('AMD'),
    ] })
    render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)
    expect((await screen.findByTestId('scan-hit-tier-NVDA')).textContent).toBe(`live ${EXPECTED_LIVE} ET`)
    expect(screen.getByTestId('scan-hit-tier-AMD').textContent).toBe('nightly')
  })

  it('CONTROL: without the rows there is no chip — absence is not "nightly"', async () => {
    H.payload = evaluated({ hits: undefined })
    render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)
    await screen.findByTestId('scan-hits')
    expect(screen.queryByTestId('scan-hit-tier-NVDA')).toBeNull()
  })

  // ⛔ THE PHANTOM KEY, PINNED. `tiers` is what the lane brief assumed and what
  // `api/routers/scan_results.py` has never sent. Reading it would produce a chip
  // that is green in a fixture and absent for every member — so a payload
  // carrying ONLY that key must drive nothing, and this reds the day someone
  // re-wires the chip back to the shape the route does not speak.
  it('CONTROL: a `tiers` map — which this route never sends — drives nothing', async () => {
    H.payload = evaluated({ hits: undefined, tiers: { NVDA: { tier: 'live', as_of: LIVE_AS_OF } } })
    render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)
    await screen.findByTestId('scan-hits')
    expect(screen.queryByTestId('scan-hit-tier-NVDA')).toBeNull()
  })

  it('a live row with no usable tick reads bare "live", never a 1969 timestamp', async () => {
    // `Number('') === 0` and `Number(null) === 0` are both FINITE, so a naive
    // finite-check formats epoch 0 into a confident-looking ET time from 1969.
    H.payload = evaluated({ hits: [
      hitRow('NVDA', { tier: 'live', live_as_of: null }),
      hitRow('AMD', { tier: 'live', live_as_of: 0 }),
    ] })
    render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)
    expect((await screen.findByTestId('scan-hit-tier-NVDA')).textContent).toBe('live')
    expect(screen.getByTestId('scan-hit-tier-AMD').textContent).toBe('live')
    expect(screen.queryByText(/1969|Dec 31/i)).toBeNull()
  })

  it('tierLabel refuses a shape it does not know', () => {
    expect(tierLabel(null)).toBeNull()
    expect(tierLabel({ tier: 'on-demand' })).toBeNull()
    expect(tierLabel({ tier: 'live' })).toBe('live')
    expect(tierLabel({ tier: 'nightly' })).toBe('nightly')
    expect(tierLabel({ tier: 'live', live_as_of: LIVE_AS_OF })).toBe(`live ${EXPECTED_LIVE} ET`)
  })
})
