// app/src/components/screener/RunNowButton.test.jsx
//
// The component half of run-now. ⛔ THE WIRE (the payload reaching the real
// `ScanResults` mount on the real page) is `ScreensManager.test.jsx`'s job;
// this file asserts what the component SENDS, how it WATCHES, and what it
// HANDS BACK.
//
// ─── 🔴 THE BRIEF'S FIXTURE WAS A DIFFERENT PRODUCT ─────────────────────────
//
// W4a.4's brief spelled a `RUN` fixture with `hits` and `coverage` on it and had
// the component read that straight off the POST. The SHIPPED route does not do
// that and cannot: `POST /api/scans/run` answers **202 with a JOB** — W4a.1/.2
// put the evaluator behind a single-worker pool precisely so a 0.7–5.7 s
// GIL-bound run never sits on the request thread (the 2026-07-01 outage class),
// and `tests/test_scan_evaluator_off_request_path.py` is now a standing rail
// that no handler can reach the sweep. So the answer arrives on
// `GET /api/scans/run/{job}`, which is **gated too** — a client written against
// the brief would have rendered `undefined` hits for every run.
//
// ⛔ AND `position` IS ONLY THERE WHILE `queued` (`scan_run._public`). A client
// that read it unconditionally would render `#undefined` on every running job.
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const META = vi.hoisted(() => ({ meta: null, isLoading: false }))
vi.mock('../../pages/screener/hooks/useScreenerMeta', () => ({
  default: () => META, META_KEY: '/api/screener/meta',
}))

import RunNowButton, {
  parseSymbols, toScanResultsPayload, jobUrl,
  RUN_SYMBOL_CAP, RUN_ENDPOINT, RUN_TFS, RUN_TERMINAL_STATES, POLL_MS,
} from './RunNowButton'

const LIST_FILTER = {
  key: 'list', label: 'My Lists', category: 'my_lists', type: 'enum',
  presets: [{ label: 'Any' }, { label: 'Momentum (2)', op: 'in', value: 'wl:4b9b2122-ddc' }],
}

const JOB_ID = 'r_7f3a9c21'

/** `scan_run._public(job, position)` for a QUEUED job — what the 202 carries
 *  when the one worker is busy. ⛔ `position` appears HERE and nowhere else. */
const QUEUED = {
  job: JOB_ID, state: 'queued', tier: 'on-demand', def_id: 'u_0000000000aa',
  tf: 'D', as_of: 20260821, submitted_at: 1_724_600_000.0, position: 2,
  universe: { source: 'symbols', label: null, requested: 3, resolved: 3 },
}

/** The same job once the pool picked it up — ⛔ NO `position` KEY AT ALL. */
const RUNNING = { ...QUEUED, state: 'running', started_at: 1_724_600_001.0 }
delete RUNNING.position

/** …and once it finished: the evaluator's own envelope, flattened by `_public`. */
const DONE = {
  job: JOB_ID, state: 'done', tier: 'on-demand', def_id: 'u_0000000000aa',
  tf: 'D', as_of: 20260821, submitted_at: 1_724_600_000.0,
  started_at: 1_724_600_001.0, finished_at: 1_724_600_002.0,
  universe: { source: 'symbols', label: null, requested: 3, resolved: 3 },
  def_hash: 'sha256:' + 'a'.repeat(64), rev: 1, freshness: 'fresh', cadence: null,
  mode: 'on-demand', persisted: false,
  hits: [{ symbol: 'NVDA', value: 1, bar_time: 20260821 }],
  coverage: {
    evaluated: 3, answered: 2, dropped: 1, not_computable: 0, withheld: 0,
    withheld_reason: null, dropped_symbols: [{ ticker: 'ZZZZ', reason: 'no-bars' }],
    dropped_listed: 1, truncated: false,
  },
}

/** A gate the SWEEP raised — it lands on the JOB, never on an HTTP status,
 *  because the submit had already answered (`api/routers/scan_run.py` header). */
const REFUSED = {
  job: JOB_ID, state: 'refused', tier: 'on-demand', def_id: 'u_0000000000aa',
  tf: 'D', as_of: 20260821, submitted_at: 1_724_600_000.0,
  finished_at: 1_724_600_002.0,
  universe: { source: 'symbols', label: null, requested: 1, resolved: 1 },
  gate: 'gate:snapshot-stale',
  detail: "[gate:snapshot-stale] the newest screener snapshot is 20260819, "
    + 'four sessions behind the session you asked for (20260821).',
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

const H = { requests: [], replies: [] }
/** The queue of answers this run will be given, in order. */
const answer = (...replies) => { H.replies = replies.slice() }

beforeEach(() => {
  META.meta = { filters: [LIST_FILTER] }
  H.requests = []
  answer({ ok: true, status: 202, json: async () => DONE })
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    H.requests.push({
      url: String(url), method: init.method || 'GET',
      credentials: init.credentials,
      body: init.body ? JSON.parse(init.body) : null,
    })
    // The LAST reply repeats, so a poll loop cannot run off the end of the queue.
    return H.replies.length > 1 ? H.replies.shift() : H.replies[0]
  }))
})
afterEach(() => vi.unstubAllGlobals())

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Run Above the 50 now' }))
const mount = (onResult = vi.fn()) => {
  render(<RunNowButton defId="u_0000000000aa" name="Above the 50" session="2026-08-21" onResult={onResult} />)
  return onResult
}
const type = (value) => fireEvent.change(screen.getByLabelText('Symbols to run'), { target: { value } })
const clickRun = () => fireEvent.click(screen.getByRole('button', { name: 'Run' }))
const posts = () => H.requests.filter((r) => r.method === 'POST')
const gets = () => H.requests.filter((r) => r.method === 'GET')

describe('parseSymbols', () => {
  it('splits on commas, spaces and newlines, uppercases, de-dupes, keeps order', () => {
    expect(parseSymbols(' nvda, AMD\nintc  nvda;amd ')).toEqual(['NVDA', 'AMD', 'INTC'])
    expect(parseSymbols('')).toEqual([])
    expect(parseSymbols(null)).toEqual([])
  })

  it('de-dupes BEFORE the count, because the server caps the DE-DUPED universe', () => {
    // `scan_run.MAX_RUN_SYMBOLS` is applied after the de-dupe on purpose — a
    // member who pasted a spreadsheet column of 600 rows carrying 50 tickers was
    // refused `gate:universe` for a run of FIFTY. The client counts the same way
    // or it re-invents that refusal on this side of the wire.
    expect(parseSymbols(Array(40).fill('nvda').join(' '))).toEqual(['NVDA'])
  })
})

describe('toScanResultsPayload', () => {
  it('derives tickers from hits and carries the tier — the shape ScanResults renders', () => {
    expect(toScanResultsPayload(DONE)).toEqual({
      def_hash: DONE.def_hash, tf: 'D', as_of: 20260821, status: 'evaluated',
      coverage: DONE.coverage, tickers: ['NVDA'], truncated: false, tier: 'on-demand',
    })
  })

  it('⛔ `truncated` is DERIVED from the receipt, never a typed false', () => {
    // The brief spelled `truncated: false` as a literal. The run's own receipt
    // carries the fact (`_COVERAGE_KEYS`), and a surface that hard-codes it is a
    // second authority over a value the server already answered.
    const cut = { ...DONE, coverage: { ...DONE.coverage, truncated: true } }
    expect(toScanResultsPayload(cut).truncated).toBe(true)
  })

  it('a run with no hits is an EMPTY list, never undefined', () => {
    const none = { ...DONE }
    delete none.hits
    expect(toScanResultsPayload(none).tickers).toEqual([])
  })
})

describe('the request', () => {
  it('pasted symbols POST {def_id, tf, as_of, symbols}, and the JOB is polled to done', async () => {
    answer({ ok: true, status: 202, json: async () => QUEUED }, ok(RUNNING), ok(DONE))
    const onResult = mount()
    open()
    type('nvda, amd\nINTC nvda')
    expect(screen.getByTestId('run-now-count')).toHaveTextContent('3 symbols')
    fireEvent.change(screen.getByLabelText('Timeframe'), { target: { value: 'W' } })
    clickRun()

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 5000 })
    const write = posts()[0]
    expect(write.url).toBe(RUN_ENDPOINT)
    expect(write.body).toEqual({ def_id: 'u_0000000000aa', tf: 'W', as_of: '2026-08-21', symbols: ['NVDA', 'AMD', 'INTC'] })
    // ⭐ THE ANSWER CAME OFF THE POLL, NOT THE SUBMIT.
    expect(gets().map((r) => r.url)).toEqual([jobUrl(JOB_ID), jobUrl(JOB_ID)])
    expect(onResult.mock.calls[0][0]).toEqual(toScanResultsPayload(DONE))
    expect(onResult.mock.calls[0][1]).toEqual(DONE)
  })

  it('⛔ THE POLL IS A GATED READ — both hops send the session cookie', async () => {
    answer({ ok: true, status: 202, json: async () => QUEUED }, ok(DONE))
    const onResult = mount()
    open()
    type('NVDA')
    clickRun()
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 5000 })
    // An open read beside a gated submit would hand every hit list on this pod
    // to whoever guessed a job id; the route carries `require_paid`, so a client
    // that dropped credentials on the poll would 401 on every run.
    expect(H.requests.map((r) => r.credentials)).toEqual(['include', 'include'])
  })

  it('a chosen list POSTs list_id — the server-minted selector, never a spelled prefix — and no symbols', async () => {
    const onResult = mount()
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'From a list' }))
    fireEvent.change(screen.getByLabelText('List to run'), { target: { value: 'wl:4b9b2122-ddc' } })
    clickRun()
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 5000 })
    const write = posts()[0]
    expect(write.body).toEqual({ def_id: 'u_0000000000aa', tf: 'D', as_of: '2026-08-21', list_id: 'wl:4b9b2122-ddc' })
    expect(write.body).not.toHaveProperty('symbols')
  })

  it('a job that comes back ALREADY DONE is not polled at all', async () => {
    // The pool is a real thread: it can finish before the submit serialises its
    // answer, and `submit_scan_run` returns `job_status(...)` whatever state that
    // is. A client that always polled once would burn a request per run.
    const onResult = mount()
    open()
    type('NVDA')
    clickRun()
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 5000 })
    expect(gets()).toHaveLength(0)
  })
})

describe('the cap, at the boundary', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => `S${String(i).padStart(4, '0')}`).join(' ')

  it('a 501st symbol is refused CLIENT-SIDE with the count, and nothing is sent', () => {
    const onResult = mount()
    open()
    type(many(RUN_SYMBOL_CAP + 1))
    expect(screen.getByTestId('run-now-count')).toHaveTextContent(`${RUN_SYMBOL_CAP + 1} symbols`)
    expect(screen.getByTestId('run-now-over-cap')).toHaveTextContent(String(RUN_SYMBOL_CAP))
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(posts()).toHaveLength(0)
    expect(onResult).not.toHaveBeenCalled()
  })

  it('and EXACTLY the cap is allowed — the boundary is `>`, the same one the server uses', () => {
    mount()
    open()
    type(many(RUN_SYMBOL_CAP))
    expect(screen.queryByTestId('run-now-over-cap')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' })).not.toBeDisabled()
  })
})

describe('refusals', () => {
  it("the SUBMIT's refusal is shown VERBATIM, never rewritten, and onResult is not called", async () => {
    answer({
      ok: false, status: 400,
      json: async () => ({ detail: "[gate:universe] 612 symbols for a run of 'wl:x'; the cap is 500." }),
    })
    const onResult = mount()
    open()
    type('NVDA')
    clickRun()
    const alert = await screen.findByTestId('run-now-error')
    expect(alert).toHaveTextContent('[gate:universe] 612 symbols')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('a gate the SWEEP raised arrives on the JOB — a 200 — and is shown just as verbatim', async () => {
    // ⛔ The one a member is most likely to meet (`snapshot-stale`) can never be
    // an HTTP status: the submit already answered 202. A client that only looked
    // at `r.ok` would render this refused run as an empty screen.
    answer({ ok: true, status: 202, json: async () => QUEUED }, ok(REFUSED))
    const onResult = mount()
    open()
    type('NVDA')
    clickRun()
    const alert = await screen.findByTestId('run-now-error', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent('[gate:snapshot-stale] the newest screener snapshot is 20260819')
    expect(onResult).not.toHaveBeenCalled()
  })

  it('⛔ a throw from the PARENT is never dressed up as a network failure', async () => {
    // The `try` used to enclose `onResult`, so a parent handler that threw
    // produced "Could not reach the server — check your connection" about a run
    // that had already SUCCEEDED. This component composes only two sentences of
    // its own; both must be true whenever they appear.
    const boom = vi.fn(() => { throw new Error('the parent blew up') })
    render(<RunNowButton defId="u_0000000000aa" name="Above the 50" session="2026-08-21" onResult={boom} />)
    open()
    type('NVDA')
    clickRun()
    await waitFor(() => expect(boom).toHaveBeenCalledTimes(1), { timeout: 5000 })

    const alert = await screen.findByTestId('run-now-error')
    expect(alert.textContent, 'the run reached the server — saying otherwise is false')
      .not.toMatch(/could not reach the server/i)
    expect(alert).toHaveTextContent('could not be displayed')
    // ⛔ AND NO CAPTION. The parent never took the payload, so the set below is
    // still the nightly one; "Showing on-demand results" would be the identity
    // lie FINDING 1 closed, arriving from the other side.
    expect(screen.queryByTestId('run-now-done')).toBeNull()
  })

  it('a poll that 404s stops the loop and says so — an expired job is not polled forever', async () => {
    answer(
      { ok: true, status: 202, json: async () => QUEUED },
      { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) },
    )
    const onResult = mount()
    open()
    type('NVDA')
    clickRun()
    expect(await screen.findByTestId('run-now-error', {}, { timeout: 5000 })).toHaveTextContent('Not found')
    const seen = gets().length
    await new Promise((r) => { setTimeout(r, POLL_MS * 2) })
    expect(gets().length, 'the loop kept polling a job that is gone').toBe(seen)
    expect(onResult).not.toHaveBeenCalled()
  })
})

describe('while it runs', () => {
  it('a QUEUED job shows its place in the line', async () => {
    answer({ ok: true, status: 202, json: async () => QUEUED }, ok(RUNNING), ok(DONE))
    mount()
    open()
    type('NVDA')
    clickRun()
    expect(await screen.findByTestId('run-now-state')).toHaveTextContent('2 ahead')
  })

  it('⛔ and a RUNNING job — which carries NO `position` key — renders without inventing one', async () => {
    answer({ ok: true, status: 202, json: async () => RUNNING }, ok(DONE))
    mount()
    open()
    type('NVDA')
    clickRun()
    const line = await screen.findByTestId('run-now-state')
    expect(line).toHaveTextContent('Running')
    expect(line.textContent).not.toMatch(/undefined|NaN|ahead|next up/)
  })

  it('and when it lands, the panel SAYS what was run — the results below are not the nightly ones', async () => {
    // ⭐ The receipt beside the hits says `evaluated/answered/dropped`; nothing in
    // it says the answer came from a universe THE MEMBER chose rather than the
    // 3,742-name sweep. Without this line the two are indistinguishable on screen.
    const onResult = mount()
    open()
    type('NVDA')
    clickRun()
    const done = await screen.findByTestId('run-now-done', {}, { timeout: 5000 })
    expect(done).toHaveTextContent('on-demand')
    expect(done).toHaveTextContent('3 symbols')
    expect(onResult).toHaveBeenCalledTimes(1)
    // and a refusal on the NEXT run clears it — a stale "it ran" beside an error
    // would tell a member their list is on screen when it is not
    H.replies = [{ ok: false, status: 429, json: async () => ({ detail: '[gate:busy] one at a time' }) }]
    clickRun()
    await screen.findByTestId('run-now-error')
    expect(screen.queryByTestId('run-now-done')).toBeNull()
  })

  it('a LIST run names the list the server resolved, never the selector the client sent', async () => {
    answer({
      ok: true,
      status: 202,
      json: async () => ({
        ...DONE,
        universe: { source: 'wl:4b9b2122-ddc', label: 'Momentum', requested: 2, resolved: 2 },
      }),
    })
    mount()
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'From a list' }))
    fireEvent.change(screen.getByLabelText('List to run'), { target: { value: 'wl:4b9b2122-ddc' } })
    clickRun()
    const done = await screen.findByTestId('run-now-done', {}, { timeout: 5000 })
    expect(done).toHaveTextContent('Momentum')
    expect(done.textContent).not.toContain('wl:4b9b2122-ddc')
  })
})

// ─── 🔴 A RUN OUTLIVES THE FORM THAT STARTED IT (review round 1, FINDING 1) ──
//
// The trigger toggles the CONTROLS. It does not stop the run: the loop is
// cancelled only by the ticket (a second Run, or unmount). So a member who
// clicks Run and then collapses the panel still gets `onResult` — the set below
// SWAPS from the nightly receipt to an on-demand one — and if the caption lived
// inside `{open && …}` that swap would happen with NOTHING on screen saying the
// results changed identity. That is the confusion the caption was added to
// prevent, arriving through the one door the caption could not reach.
//
// ⛔ SO THE THREE STATUS LINES ARE NOT PART OF THE PANEL. They describe the RUN
// and the answer set below it; only the form is behind the toggle.

describe('the run keeps speaking when its panel is collapsed', () => {
  const collapse = () => fireEvent.click(screen.getByRole('button', { name: 'Run Above the 50 now' }))

  it('⛔ the caption is rendered even though the panel was collapsed mid-flight', async () => {
    answer({ ok: true, status: 202, json: async () => QUEUED }, ok(RUNNING), ok(DONE))
    const onResult = mount()
    open()
    type('NVDA')
    clickRun()
    collapse()
    // the form is gone…
    expect(screen.queryByLabelText('Symbols to run')).toBeNull()
    // …and the answer still lands, so it must still be captioned
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 5000 })
    expect(screen.getByTestId('run-now-done')).toHaveTextContent('on-demand')
  })

  it('and so is the progress, so a collapsed run is not a silent one', async () => {
    answer({ ok: true, status: 202, json: async () => QUEUED }, ok(RUNNING), ok(DONE))
    mount()
    open()
    type('NVDA')
    clickRun()
    collapse()
    expect(await screen.findByTestId('run-now-state')).toHaveTextContent('2 ahead')
  })

  it('and so is a refusal — it is not held back until the panel is reopened', async () => {
    answer({ ok: false, status: 429, json: async () => ({ detail: '[gate:busy] one at a time' }) })
    mount()
    open()
    type('NVDA')
    clickRun()
    collapse()
    expect(await screen.findByTestId('run-now-error')).toHaveTextContent('[gate:busy]')
  })
})

describe('the lists come from the screener\'s own meta', () => {
  it('with no lists in meta the list mode is not offered, and paste still works', () => {
    META.meta = { filters: [] }
    mount()
    open()
    expect(screen.queryByRole('radio', { name: 'From a list' })).toBeNull()
    expect(screen.getByLabelText('Symbols to run')).toBeInTheDocument()
  })

  it('the `Any` preset — which carries no selector — is not offered as a list', () => {
    mount()
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'From a list' }))
    const options = [...screen.getByLabelText('List to run').querySelectorAll('option')]
    expect(options.map((o) => o.value)).toEqual(['', 'wl:4b9b2122-ddc'])
  })
})

// ─── ⭐ THE SOURCE RAILS ─────────────────────────────────────────────────────
//
// ⚠️ `styles.anything` IS TRUTHY IN VITEST — the CSS-module Proxy fabricates a
// class for every key, so `expect(el).toHaveClass(styles.over)` cannot fail and
// is not a rail. The only thing that can disagree with the JSX is the REAL
// stylesheet on disk, so that is what these read.

describe('⭐ the stylesheet actually declares every class the component uses', () => {
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    throw new Error(`RunNowButton.test: could not find the repo root from ${process.cwd()}`)
  })()
  /** ⚠️ CRLF NORMALISED AT THE DOOR — every file in this checkout is CRLF. */
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  const JSX_REL = 'app/src/components/screener/RunNowButton.jsx'
  const CSS_REL = 'app/src/components/screener/RunNowButton.module.css'

  const used = () => new Set([...read(JSX_REL).matchAll(/\bstyles\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]))
  const declared = () => new Set([...read(CSS_REL).matchAll(/^\.([A-Za-z_][\w-]*)/gm)].map((m) => m[1]))

  it('every `styles.x` in the JSX is a real selector in the module', () => {
    const u = used()
    expect(u.size, 'the walk found no `styles.` uses at all — this rail would pass on anything')
      .toBeGreaterThan(3)
    const d = declared()
    expect([...u].filter((k) => !d.has(k)),
      'these classes are used and never declared — in vitest they are TRUTHY and '
      + 'silently render as nothing').toEqual([])
  })

  it('and the rail is NOT vacuous — a class the stylesheet does not have is caught', () => {
    expect(declared().has('thisClassIsNotInTheStylesheet')).toBe(false)
  })

  // ⛔ THE ONE ASSERTION NO BEHAVIOURAL CASE CAN MAKE, and it was measured:
  // dropping the `typeof` guard on `position` is an EQUIVALENT MUTANT today —
  // the key is only read inside the `queued` branch, where `_public` always
  // supplies it, so every rendered string is identical either way. The guard is
  // still load-bearing, because the day someone lifts that read out of the
  // branch (a shared "N ahead" line above the state words, say) a RUNNING job
  // — which carries NO `position` key at all — starts rendering `undefined`.
  // A source rail is the only thing that can fail for that.
  /**
   * Every `.position` read in `src` that is NOT guarded.
   *
   * ⛔ ONE GRAMMAR, ONE COPY (review round 1, FINDING 2). This started as an
   * inline regex pair in the rail and a RE-TYPED pair in its control — which
   * means loosening the real filter left the control green, and the control is
   * the only thing standing between this rail and silence. That is
   * `lesson_one_grammar_four_hand_written_copies`, landing in the one rail that
   * exists precisely BECAUSE no behavioural test can fire here. Both cases below
   * now call this function, so a loosened filter takes the control down with it.
   *
   * `progress.position` is exempt because it is the ALREADY-NORMALISED value
   * this component put in its own state (`null` when the key was absent); the
   * guard being asserted is on the raw `job.position` off the wire.
   */
  const unguardedPositionReads = (src) => [...src.matchAll(/(.{0,60})\.position\b/g)]
    .map((m) => m[0])
    .filter((snippet) => !/typeof\s+[\w.]+\.position\s*===\s*'number'/.test(snippet)
      && !/progress\.position/.test(snippet))

  it('every read of `position` is guarded — the key exists ONLY while queued', () => {
    const src = read(JSX_REL)
    expect([...src.matchAll(/\.position\b/g)].length,
      'the walk found no `.position` read — this rail would pass on anything')
      .toBeGreaterThan(0)
    expect(unguardedPositionReads(src),
      'a `job.position` read outside a `typeof … === \'number\'` guard — a running '
      + 'job has no such key and would render `undefined`').toEqual([])
  })

  it('and THAT rail is not vacuous either — a planted unguarded read is caught', () => {
    // ⭐ THE SAME FUNCTION the assertion above calls. A filter loosened to let an
    // unguarded read through fails HERE too, which is the whole point.
    expect(unguardedPositionReads('const p = { position: job.position }\n')).toHaveLength(1)
    // …and the guarded form is still recognised, so the control is discriminating
    // rather than merely counting matches.
    expect(unguardedPositionReads(
      "position: typeof job.position === 'number' ? job.position : null,\n")).toEqual([])
  })
})

describe('⭐ the constants this file publishes are the ones the server pins', () => {
  it('the cap is an integer literal the backend test can read', () => {
    // `tests/test_scan_run.py::test_the_CLIENT_cap_is_PINNED_EQUAL_to_the_servers…`
    // reads this very line out of the file and compares it to
    // `scan_run.MAX_RUN_SYMBOLS`. This half only checks it is a usable number.
    expect(Number.isInteger(RUN_SYMBOL_CAP) && RUN_SYMBOL_CAP > 0).toBe(true)
  })

  it('the terminal states and the timeframe codes are closed sets', () => {
    expect(RUN_TERMINAL_STATES).toEqual(['done', 'refused'])
    expect(RUN_TFS.map(([code]) => code)).toEqual(['D', 'W', 'M'])
    expect(jobUrl('a b/c')).toBe(`${RUN_ENDPOINT}/a%20b%2Fc`)
  })
})

// ─── THE RESTORE (W4a.5) ────────────────────────────────────────────────────
//
// The caption says the set BELOW this component is the on-demand one. The
// control that makes that sentence false is rendered beside it, and it must
// clear BOTH — the parent's payload and this caption — or one of the two is
// left lying about what is on screen.
describe('the way back out of an on-demand answer', () => {
  const RESTORE = 'Back to the nightly results'

  const runToDone = async () => {
    open()
    type('NVDA')
    clickRun()
    await screen.findByTestId('run-now-done')
  }

  it('⛔ is not offered at all when no parent can take the answer back', async () => {
    mount()
    await runToDone()
    // A control that cleared this caption without clearing the payload would be
    // the same identity lie with the labels swapped, so it is not rendered at
    // all unless the caller passed something that can do both.
    expect(screen.queryByRole('button', { name: RESTORE })).toBeNull()
  })

  it('clears the caption AND tells the parent, in one click', async () => {
    const onClear = vi.fn()
    render(<RunNowButton defId="u_0000000000aa" name="Above the 50" session="2026-08-21"
      onResult={vi.fn()} onClear={onClear} />)
    await runToDone()
    expect(screen.getByRole('button', { name: RESTORE })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: RESTORE }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('run-now-done')).toBeNull()
    expect(screen.queryByRole('button', { name: RESTORE })).toBeNull()
  })

  // ⭐ WCAG 2.5.3 LABEL-IN-NAME (review round 1). This button carried
  // `aria-label="Back to the nightly results"` over the visible words "Back to
  // nightly", so a member using voice control said what they could read and
  // nothing happened. Asserted as a PROPERTY of the rendered node — the
  // accessible name must contain the visible text — rather than by re-typing
  // either string, because a test that spelled both would go green on any pair.
  it('⭐ its accessible name CONTAINS its visible text', async () => {
    render(<RunNowButton defId="u_0000000000aa" name="Above the 50" session="2026-08-21"
      onResult={vi.fn()} onClear={vi.fn()} />)
    await runToDone()
    const [btn] = screen.getAllByRole('button')
      .filter((b) => /nightly/i.test(b.textContent || ''))
    expect(btn, 'no restore control on screen — this rail would pass on nothing').toBeTruthy()
    const visible = (btn.textContent || '').trim().toLowerCase()
    const accessible = (btn.getAttribute('aria-label') || btn.textContent || '').trim().toLowerCase()
    expect(visible.length).toBeGreaterThan(0)
    expect(accessible).toContain(visible)
  })

  it('and a SECOND run re-offers it — the caption and its retraction move together', async () => {
    const onClear = vi.fn()
    render(<RunNowButton defId="u_0000000000aa" name="Above the 50" session="2026-08-21"
      onResult={vi.fn()} onClear={onClear} />)
    await runToDone()
    fireEvent.click(screen.getByRole('button', { name: RESTORE }))
    expect(screen.queryByRole('button', { name: RESTORE })).toBeNull()

    clickRun()
    await screen.findByTestId('run-now-done')
    expect(screen.getByRole('button', { name: RESTORE })).toBeInTheDocument()
  })
})
