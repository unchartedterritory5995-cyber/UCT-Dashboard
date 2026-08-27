// app/src/components/chart/builder/EvidenceTab.test.jsx
//
// The receipt is RENDERED, not re-derived: every number below is a fixture the
// server would send, and the assertions are that the two arms land in ONE row
// and that every state the job can be in has a sentence with a name.
//
// ⛔ EVERY STATE ASSERTS ITS WORDS, NOT ONLY ITS TESTID. A "Refused" branch that
// renders the string "Running" passes any state-only rail, and this component is
// almost entirely sentences — the words are what the member actually gets.
import { SWRConfig } from 'swr'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import EvidenceTab, {
  BACKTEST_ENDPOINT, RECORD_ENDPOINT, EVIDENCE_HORIZONS, symbolCoverage,
} from './EvidenceTab'

const DEF_ID = 'u_0123456789ab'
const DEF_HASH = `sha256:${'a'.repeat(64)}`

const stats = (over = {}) => ({
  n: 120, win_rate: 58.0, avg_pct: 1.25, median_pct: 0.9, best: 12.1, worst: -8.4,
  avg_pct_winsorised: 1.2, ...over,
})
const horizon = (h, over = {}) => ({
  horizon: h,
  strategy: stats(),
  baseline: stats({ n: 900, win_rate: 51.0, avg_pct: 0.4, avg_pct_winsorised: 0.38 }),
  below_floor: false,
  coverage: { evaluated: 900, signals: 120, no_forward_room: 0, unusable_fill_price: 0 },
  same_day: { n_matched: 118, n_unmatched: 2, excess_pct_winsorised: 0.31 },
  ...over,
})
/** Symbol AND bar coverage whose arithmetic closes — derived, so a change to
 *  one count breaks the sum out loud. */
const coverage = () => {
  const requested = 3742; const missing = 40; const noWindow = 2; const noAnswer = 1
  return {
    symbols_requested: requested,
    symbols_tested: requested - missing - noWindow - noAnswer,
    symbols_missing_bars: missing,
    symbols_no_bars_in_window: noWindow,
    symbols_no_answer_in_window: noAnswer,
    bars_in_window: 1000, bars_warmup: 100, bars_not_computable: 50, bars_answered: 850,
  }
}
const ready = (over = {}) => ({
  job: 'j1', status: 'ready', def_hash: DEF_HASH, tf: 'D', backtestable: true,
  universe: { membership: 'current', symbols_requested: 3742, survivorship_bias: true,
    caveat: "This tests today's names against yesterday's prices." },
  universe_request: { kind: 'current', matched: 3742, truncated: false },
  method: { fill: 'next_bar_open', exit: 'open_of_the_bar_horizon_bars_after_the_fill',
    min_signals: 30, horizons: [1, 5, 10, 20], winsorised: true, winsor_pct: 50,
    same_day_control: true, answers: 'did names matching this screen tend to go up?',
    observations: 'one per signal bar' },
  coverage: coverage(),
  window: { from: '2025-10-01', to: '2026-08-21' }, as_of: '2026-08-21',
  evaluated_dates: 220, symbols_tested: 3699, signals: 1234,
  horizons: [1, 5, 10, 20].map((h) => horizon(h)),
  ...over,
})

// ⛔ MEASURED AGAINST THE ROUTE, NOT RETYPED FROM THE DRAFT.
// `api/routers/definition_record.py` returns `hit_rate_means` at the TOP LEVEL of
// every response, beside `claim` and never inside it — and
// `tests/test_definition_record_route.py::test_the_hit_rate_SAYS_WHAT_IT_COUNTS_
// and_the_sentence_is_TRUE_of_the_store` pins `body["hit_rate_means"] ==
// mod.HIT_RATE_MEANS`. A fixture without it would let this suite go green over a
// component that drops the one sentence the route added FOR this tab.
const HIT_RATE_MEANS = (
  'the share of evaluated bars on which this definition was TRUE — an '
  + 'occurrence rate, not a win rate: the forward record stores whether the '
  + 'screen fired, never what happened next, so there is no return here and no '
  + 'baseline to put beside it')

const recordBody = (claim = {}) => ({
  def_id: DEF_ID, def_hash: DEF_HASH, rev: 1, tf: 'D', tf_label: '1D', window: null,
  claim: { coverage: 'unproven', refusal: 'no evaluation has been recorded for this definition yet — the record begins when the definition does',
    symbols: { requested: 0, proven: 0, unproven: [] }, evaluated: 0, hits: null, hit_rate: null,
    horizon: { retention_days: 540 }, ...claim },
  hit_rate_means: HIT_RATE_MEANS,
})

const H = { post: [], gets: [], poll: [], record: null, postResponse: null, pollResponse: null }
function stubFetch() {
  H.post = []; H.gets = []; H.poll = [ready()]
  H.record = { ok: true, status: 200, body: recordBody() }
  H.postResponse = { ok: true, status: 200, body: { job: 'j1', status: 'running' } }
  H.pollResponse = { ok: true, status: 200 }
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    if (method === 'POST') {
      H.post.push({ url: u, init }); const r = H.postResponse
      return { ok: r.ok, status: r.status, json: async () => r.body }
    }
    H.gets.push(u)
    if (u.startsWith(RECORD_ENDPOINT)) {
      const r = H.record; return { ok: r.ok, status: r.status, json: async () => r.body }
    }
    if (u.startsWith(`${BACKTEST_ENDPOINT}/`)) {
      const body = H.poll.length > 1 ? H.poll.shift() : H.poll[0]
      const r = H.pollResponse
      return { ok: r.ok, status: r.status, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
}

function mount(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <EvidenceTab defId={DEF_ID} defHash={DEF_HASH} tf="D" pollMs={20} {...props} />
    </SWRConfig>,
  )
}

beforeEach(stubFetch)
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('EvidenceTab — the retro study', () => {
  it('asks for the study by def_id, in the background, with the four horizons', async () => {
    mount()
    await waitFor(() => expect(H.post).toHaveLength(1))
    const { url, init } = H.post[0]
    expect(url).toBe(`${BACKTEST_ENDPOINT}?background=1`)
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body)).toEqual({ def_id: DEF_ID, tf: 'D', horizons: EVIDENCE_HORIZONS })
    expect(screen.getByTestId('evidence-tab').getAttribute('data-definition')).toBe(DEF_HASH)
  })

  it('polls while running, then renders BOTH arms in one row, the method, the caveat and both coverage lines', async () => {
    H.poll = [{ job: 'j1', status: 'running' }, ready()]
    mount()
    expect(await screen.findByTestId('evidence-running')).toBeTruthy()
    const row = await screen.findByTestId('evidence-horizon-5', {}, { timeout: 3000 })
    expect(row.textContent).toMatch(/58\.0% vs 51\.0%/)
    expect(row.textContent).toMatch(/\+1\.25% vs \+0\.40%/)
    expect(row.textContent).toMatch(/\+1\.20% vs \+0\.38%/)
    expect(row.textContent).toMatch(/\+0\.31%/)
    expect(screen.getByTestId('evidence-method').textContent).toMatch(/next_bar_open/)
    expect(screen.getByTestId('evidence-survivorship').textContent).toMatch(/today's names against yesterday's prices/)
    expect(screen.getByTestId('coverage-line').textContent).toMatch(/3,742 evaluated/)
    expect(screen.getByTestId('evidence-bars-coverage').textContent).toMatch(/1,000 bars in window/)
    expect(H.gets.filter((u) => u.startsWith(`${BACKTEST_ENDPOINT}/j1`)).length).toBeGreaterThanOrEqual(2)
  })

  it('⛔ a horizon without its baseline is REFUSED BY NAME and its numbers never render', async () => {
    const naked = ready()
    naked.horizons[1] = { horizon: 5, strategy: stats({ win_rate: 72.0 }), below_floor: false, coverage: {} }
    H.poll = [naked]
    mount()
    const r = await screen.findByTestId('evidence-horizon-5-naked')
    expect(r.textContent).toMatch(/without its baseline/)
    expect(screen.queryByText(/72\.0%/)).toBeNull()
    // CONTROL: the neighbour that carries a baseline renders both arms
    expect((await screen.findByTestId('evidence-horizon-10')).textContent).toMatch(/58\.0% vs 51\.0%/)
  })

  it('a below-floor horizon keeps n and withholds the rates', async () => {
    const low = ready()
    low.horizons[3] = horizon(20, { below_floor: true,
      strategy: { n: 12 }, baseline: { n: 400 }, same_day: { n_matched: 0, n_unmatched: 12, excess_pct_winsorised: null } })
    H.poll = [low]
    mount()
    const r = await screen.findByTestId('evidence-horizon-20-withheld')
    expect(r.textContent).toMatch(/12 \/ 400/)
    expect(r.textContent).toMatch(/floor of 30/)
  })

  it('a refused study shows the refusal sentence verbatim with the names', async () => {
    H.poll = [{ job: 'j1', status: 'ready', def_hash: DEF_HASH, backtestable: false,
      refused: 'scalar_no_history', names: ['rs_rank'],
      detail: 'this screen cannot be backtested: it reads values we hold no history of — it reads `rs_rank`.',
      universe: ready().universe, method: ready().method, coverage: {}, window: null }]
    mount()
    const r = await screen.findByTestId('evidence-refused')
    expect(r.textContent).toMatch(/it reads `rs_rank`/)
    expect(screen.getByTestId('evidence-refused-names').textContent).toMatch(/rs_rank/)
    expect(screen.queryByTestId('evidence-horizons')).toBeNull()
  })

  it('a receipt for a DIFFERENT hash is refused, not rendered', async () => {
    H.poll = [ready({ def_hash: `sha256:${'b'.repeat(64)}` })]
    mount()
    expect(await screen.findByTestId('evidence-hash-mismatch')).toBeTruthy()
    expect(screen.queryByTestId('evidence-horizons')).toBeNull()
  })

  it('a POST the server does not accept is reported with its status — never as "no evidence"', async () => {
    H.postResponse = { ok: false, status: 405, body: {} }
    mount()
    const r = await screen.findByTestId('evidence-request-refused')
    expect(r.textContent).toMatch(/405/)
    expect(screen.queryByTestId('evidence-running')).toBeNull()
  })

  it('a job the server no longer knows, and a job that broke, each get their own sentence', async () => {
    H.poll = [{ job: 'j1', status: 'unknown' }]
    mount()
    expect(await screen.findByTestId('evidence-job-unknown')).toBeTruthy()
    cleanup()
    H.poll = [{ job: 'j1', status: 'error', detail: 'RuntimeError: the sweep fell over' }]
    mount()
    expect((await screen.findByTestId('evidence-job-error')).textContent).toMatch(/the sweep fell over/)
  })

  it('a receipt the server will not hand over is reported by status, not as an empty study', async () => {
    H.pollResponse = { ok: false, status: 503 }
    mount()
    const r = await screen.findByTestId('evidence-poll-refused')
    expect(r.textContent).toMatch(/503/)
    expect(r.textContent).toMatch(/could not be read/i)
    expect(screen.queryByTestId('evidence-horizons')).toBeNull()
  })

  it('⛔ a receipt whose bar coverage does not add up has its counts WITHHELD', async () => {
    const bad = ready()
    // one part moved, the total left alone — the shape a silent loss takes
    bad.coverage = { ...coverage(), bars_answered: 849 }
    H.poll = [bad]
    mount()
    const r = await screen.findByTestId('evidence-bars-broken')
    expect(r.textContent).toMatch(/does not add up/i)
    expect(screen.queryByTestId('evidence-bars-coverage')).toBeNull()
    // CONTROL: the rest of the receipt still renders — one broken sum
    // withholds one line, it does not blank the study.
    expect(await screen.findByTestId('evidence-horizon-5')).toBeTruthy()
  })

  it('without a hash to bind the receipt to, it refuses to ask', async () => {
    mount({ defHash: null })
    expect(screen.getByTestId('evidence-no-hash')).toBeTruthy()
    expect(H.post).toHaveLength(0)
    // ⭐ The RECORD arm legitimately still reads without a hash — the route
    // derives `def_hash` from the saved tree server-side — so this waits for it
    // rather than tearing the tree down mid-update (that is what the act()
    // warning was), and in doing so proves the two arms gate SEPARATELY: no
    // study is ever asked for, and the record still answers.
    await screen.findByTestId('evidence-record-refusal')
    expect(H.post).toHaveLength(0)
  })

  it('the symbol coverage handed to CoverageLine closes by the engine own identity', () => {
    expect(symbolCoverage(coverage())).toEqual({ evaluated: 3742, answered: 3699, dropped: 40, not_computable: 3 })
  })
})

// ─── THE SENTENCE MUST BE TRUE OF THE STATE THAT PRODUCED IT ────────────────
//
// Every branch above has a testid AND its words asserted. These cover the state
// that had no words at all: a definition with a hash but no saved id.
// `EvidenceTab` gates the POST on `defId && defHash` and the record's SWR key on
// `defId`, so with `defId` null NOTHING is ever asked for — and a `RetroStudy`
// that only guards `!defHash` falls through to its `!job || !data` branch and
// tells the member "Replaying this definition over the current universe…"
// forever, beside "Reading the record…" forever. Two sentences, both flatly
// false, both behind a perfectly correct guard. That is the exact defect shape a
// state-only rail cannot see; it gets a name here instead.
describe('EvidenceTab — a definition that was never saved', () => {
  it('says so, and does not claim a study is running or a record is being read', () => {
    mount({ defId: null })
    const r = screen.getByTestId('evidence-not-saved')
    expect(r.textContent).toMatch(/has not been saved/i)
    expect(H.post).toHaveLength(0)
    expect(H.gets).toHaveLength(0)
    // ⛔ THE WORDS, not merely the absence of a testid.
    expect(screen.queryByText(/Replaying this definition/i)).toBeNull()
    expect(screen.queryByText(/Reading the record/i)).toBeNull()
    expect(screen.queryByTestId('evidence-running')).toBeNull()
    expect(screen.queryByTestId('evidence-record')).toBeNull()
  })
})

describe('EvidenceTab — the forward record', () => {
  it('renders the record own refusal sentence verbatim', async () => {
    mount()
    const r = await screen.findByTestId('evidence-record-refusal')
    expect(r.textContent).toBe(recordBody().claim.refusal)
  })

  it('a proven claim renders the raw fields with their names', async () => {
    H.record = { ok: true, status: 200, body: { ...recordBody({ coverage: 'proven', refusal: null,
      symbols: { requested: 2, proven: 2, unproven: [] }, evaluated: 44, hits: 13, hit_rate: 13 / 44 }),
      window: { first: 20260701, through: 20260731, anchor: 'AAA', symbols_at_through: 2, symbols_known: 2, derived: true } } }
    mount()
    const r = await screen.findByTestId('evidence-record')
    await screen.findByTestId('evidence-record-claim')
    expect(r.textContent).toMatch(/hit_rate/)
    expect(r.textContent).toMatch(/0\.295/)
    expect(r.textContent).toMatch(/20260701 → 20260731/)
    expect(r.textContent).toMatch(/2 proven of 2/)
  })

  // ⛔ NEVER A NAKED HIT RATE — the whole reason A8 exists, and the reason the
  // route grew `hit_rate_means` in the first place. The route's own docstring
  // says the field exists because "the Evidence tab renders this within inches of
  // the backtest's strategy/baseline pair and an unlabelled percentage there
  // reads as performance". A component that drops it re-opens exactly that hole.
  it('renders the route own hit_rate_means BESIDE the number, verbatim', async () => {
    H.record = { ok: true, status: 200, body: recordBody({ coverage: 'proven', refusal: null,
      symbols: { requested: 2, proven: 2, unproven: [] }, evaluated: 44, hits: 13, hit_rate: 13 / 44 }) }
    mount()
    const means = await screen.findByTestId('evidence-record-hit-rate-means')
    expect(means.textContent).toBe(HIT_RATE_MEANS)
    // and it is BESIDE the number, in the same receipt
    expect((await screen.findByTestId('evidence-record')).textContent).toMatch(/0\.295/)
  })

  it('⛔ a hit_rate that arrives WITHOUT its sentence is withheld, not rendered naked', async () => {
    const body = recordBody({ coverage: 'proven', refusal: null,
      symbols: { requested: 2, proven: 2, unproven: [] }, evaluated: 44, hits: 13, hit_rate: 13 / 44 })
    delete body.hit_rate_means
    H.record = { ok: true, status: 200, body }
    mount()
    const w = await screen.findByTestId('evidence-record-hit-rate-withheld')
    expect(w.textContent).toMatch(/what it counts/i)
    expect(screen.queryByText(/0\.295/)).toBeNull()
    expect(screen.queryByTestId('evidence-record-hit-rate-means')).toBeNull()
    // CONTROL: the rest of the claim still renders — this withholds ONE number,
    // it does not blank the receipt.
    expect((await screen.findByTestId('evidence-record')).textContent).toMatch(/2 proven of 2/)
  })

  it('a record that cannot be read is reported, never rendered as empty', async () => {
    H.record = { ok: false, status: 402, body: {} }
    mount()
    expect((await screen.findByTestId('evidence-record-error')).textContent).toMatch(/402/)
  })
})
