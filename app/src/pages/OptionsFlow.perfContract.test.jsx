/**
 * THE OPTIONS FLOW MEMBER PERFORMANCE CONTRACT — one coherent behavioural rail.
 *
 * ⛔ WHY THIS FILE EXISTS BESIDE THE ONES THAT ALREADY PASS.
 *
 * The whole speed programme is gated on four BUILD-TIME env flags
 * (VITE_FLOW_DEFER_TAPE / _PARTS / _SERVER_SEARCH / _SERVER_TOPPICKS). Every
 * rail guarding them today asserts on SOURCE TEXT:
 *
 *     expect(src).toContain('VITE_FLOW_DEFER_TAPE === "1"')
 *
 * That string is present whether or not the flag is honoured, whether or not
 * the call site consults the decision, and whether or not a member ever stops
 * paying for the 3.4 MB tape. It is the `lesson_a_measured_knob_is_inert_if_
 * the_consumer_skips_its_stage` shape: the knob is measured, the consumer is
 * not. `shouldFetchTape` also has good unit coverage — of the pure function,
 * which can be perfectly correct while line 1684 ignores what it returns.
 *
 * So these tests render the REAL component and assert on what the member's
 * browser actually asks the network for. Every one of them is derived from a
 * production observation made 2026-09-08 against commit 42daef020.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 't@t.dev', role: 'admin', plan: 'paid' } }),
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../components/TickerPopup', () => ({
  default: ({ children }) => <span>{children}</span>,
}))

import { aggregateCsv } from './optionsFlow/flowFactsEntry.js'
import { SERVER_TOPPICKS_PARTS, INTERACTION_PARTS } from './optionsFlow/flowParts.js'
import { _resetFlowWorker, forgetLoaded } from './optionsFlow/flowWorkerClient.js'
import { _resetErCache } from './optionsFlow/flowLoadPolicy.js'

const CSV = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/optionsFlow/__fixtures__/flow-sample.csv'), 'utf8')
const EXPECTED = aggregateCsv(CSV, { dateFilter: 'Last1' })
const totalTrades = EXPECTED.D.totalTrades

class RO { observe() {} unobserve() {} disconnect() {} }

/**
 * ⛔ THESE FLAGS CANNOT BE STUBBED FROM INSIDE THE TEST.
 *
 * Vite inlines `import.meta.env.VITE_*` at TRANSFORM time, and the modules
 * under test read theirs at module scope, which runs on this file's own static
 * imports -- before any `beforeEach`. `vi.stubEnv` therefore changes nothing and
 * the rail silently measures the flags-OFF build while reading as a pass. That
 * is the failure this whole file exists to prevent, so it must not be the
 * failure this file ships with.
 *
 * They come from the process environment instead (npm run test:flowperf), and
 * a missing one FAILS LOUDLY rather than skipping: a rail that opts itself out
 * when unconfigured reads as "verified" -- `lesson_a_rails_important_half_can_
 * be_opt_in`.
 */
const PROD_FLAGS = ['VITE_FLOW_DEFER_TAPE', 'VITE_FLOW_PARTS', 'VITE_FLOW_SERVER_TOPPICKS']
const MISSING = PROD_FLAGS.filter(k => import.meta.env[k] !== '1')

function bootstrapBody() {
  const { TICKER_DB, CONV, ...rest } = EXPECTED.D   // eslint-disable-line no-unused-vars
  return rest
}

/**
 * Records every URL the page asks for, so assertions are about the WIRE.
 *
 * ⛔ THE `X-Flow-Part` HEADER IS LOAD-BEARING. `fetchPart` rejects any part
 * response that does not echo it (`not-a-part-response`) -- it is what
 * distinguishes one part from the whole-D fall-through. A mock that omits it
 * has every part fail, the bundle decline, and the page fall back to the raw
 * tape -- which then renders correctly and reads as a pass while testing the
 * OPPOSITE transport from the one named in the test.
 *
 * A non-bootstrap part's body is the BARE value (array for a deferred part,
 * object for a derived one), not an {ok, stats, D} envelope.
 */
function makeFetch({ partsOk = true } = {}) {
  const urls = []
  const fn = vi.fn((url) => {
    const u = String(url)
    urls.push(u)
    const reply = (body, headers = {}) => Promise.resolve({
      ok: true, status: 200,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
    if (u.includes('/api/flow/aggregate')) {
      const m = /[?&]part=([A-Za-z_]+)/.exec(u)
      if (m) {
        if (!partsOk) return Promise.resolve({ ok: false, status: 503 })
        const part = m[1]
        const hdr = { 'x-flow-part': part, 'x-flow-version': '1' }
        if (part === 'bootstrap') {
          return reply({ ok: true, stats: EXPECTED.stats, D: bootstrapBody() }, hdr)
        }
        // TOP_PICKS is DERIVED server-side, so the CSV fixture has none. A
        // minimal object of the declared shape is enough for the transport
        // contract under test here; what it CONTAINS is flowTopPicksProduct's.
        if (part === 'TOP_PICKS') return reply({ picks: [], meta: { derived: true } }, hdr)
        return reply(EXPECTED.D[part] ?? [], hdr)
      }
      if (!partsOk) return Promise.resolve({ ok: false, status: 503 })
      return reply({ ok: true, stats: EXPECTED.stats, D: bootstrapBody() },
        { 'x-flow-version': '1' })
    }
    if (u.includes('/api/flow/version')) return reply({ version: 1 })
    if (u.includes('/api/calendar')) return reply({ week_start: '2026-08-24', days: {} })
    if (u.includes('/api/flow/data') || u.includes('-data')) {
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'x-flow-version' ? '1' : null) },
        text: () => Promise.resolve(CSV),
      })
    }
    return reply({})
  })
  fn.urls = urls
  return fn
}

const tape = (urls) => urls.filter(u => /\/api\/flow\/(indexes-)?data\b/.test(u))
const partsAsked = (urls) => urls
  .map(u => (/[?&]part=([A-Za-z_]+)/.exec(u) || [])[1])
  .filter(Boolean)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', RO)
  _resetErCache(); forgetLoaded(); _resetFlowWorker()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function mountAndPaint() {
  const { default: OptionsFlow } = await import('./OptionsFlow.jsx')
  const f = makeFetch()
  vi.stubGlobal('fetch', f)
  const view = render(<OptionsFlow />)
  await waitFor(() => {
    expect(document.body.textContent).toContain(String(totalTrades))
  }, { timeout: 8000 })
  return { view, f }
}

describe('the member performance contract', () => {
  it('⛔ runs against the PRODUCTION flag set, or not at all', () => {
    expect(MISSING, `These are =1 on Railway web (read 2026-09-08) but are not set here, `
      + `so this file would measure a build no member runs. Run it with:
`
      + `  npm run test:flowperf
`
      + `missing: ${MISSING.join(', ')}`).toEqual([])
  })

  it('CONTROL: the fixture exercises both deferred keys and a real tape', () => {
    // Without this every assertion below could pass against an empty fixture.
    expect(EXPECTED.D.TICKER_DB.length).toBeGreaterThan(0)
    expect(EXPECTED.D.CONV.length).toBeGreaterThan(0)
    expect(CSV.length).toBeGreaterThan(10000)
  })

  it('⛔ a PREPARED load never fetches the raw tape', async () => {
    // Production 2026-09-08: three clean loads, 0/3 fetched /api/flow/data.
    // The contaminated fourth DID -- so this is a live path, not a dead one.
    const { f } = await mountAndPaint()
    expect(tape(f.urls), `tape fetched on a prepared load:\n${tape(f.urls).join('\n')}`)
      .toHaveLength(0)
  })

  it('⛔ CONTROL: with NO prepared parts the tape IS fetched', async () => {
    // The rail must be able to fail. Without this, a build that never fetches
    // anything at all would read as a pass.
    const { default: OptionsFlow } = await import('./OptionsFlow.jsx')
    const f = makeFetch({ partsOk: false })
    vi.stubGlobal('fetch', f)
    render(<OptionsFlow />)
    await waitFor(() => {
      expect(tape(f.urls).length).toBeGreaterThan(0)
    }, { timeout: 8000 })
  }, 20000)

  it('⛔ first paint asks for the first-paint parts and NEVER the interaction parts', async () => {
    const { f } = await mountAndPaint()
    const asked = partsAsked(f.urls)
    for (const p of SERVER_TOPPICKS_PARTS) expect(asked).toContain(p)
    // The order matters only in that the interaction parts must not be in the
    // set the page blocks its first paint on.
    const beforePaint = asked.slice(0, SERVER_TOPPICKS_PARTS.length)
    for (const k of INTERACTION_PARTS) {
      expect(beforePaint, `${k} is back in the first-paint set`).not.toContain(k)
    }
  }, 20000)

  it('the deferred interaction parts DO arrive after paint', async () => {
    // The complement of the test above: deferring must not become dropping.
    const { f } = await mountAndPaint()
    await waitFor(() => {
      const asked = partsAsked(f.urls)
      for (const k of INTERACTION_PARTS) expect(asked).toContain(k)
    }, { timeout: 8000 })
  }, 20000)
})
