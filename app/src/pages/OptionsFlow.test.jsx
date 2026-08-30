/**
 * ⚰️ THIS FILE WAS A STUB UNTIL 2026-08-29.
 *
 * It contained exactly this:
 *
 *     describe('OptionsFlow', () => { it('renders', () => {}) })
 *
 * An empty body. It asserted nothing, passed always, and sat in the tree under
 * a name that reads as coverage — so a 9,221-line page with 127 useState, 21
 * useEffect and 35 fetch calls had ZERO component-level assertions while
 * appearing tested. That is why every change to this page has needed
 * source-scanning guards instead of behavioural ones.
 *
 * These tests cover the load path specifically, because that is where the
 * user-visible failures have actually been: a blank page, a spinner that never
 * clears, or numbers that change under the reader a second after they appear.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 't@t.dev', role: 'admin', plan: 'paid' } }),
  AuthContext: { Provider: ({ children }) => children },
}))
// TickerPopup pulls charts + live-price polling; irrelevant to the load path.
vi.mock('../components/TickerPopup', () => ({
  default: ({ children }) => <span>{children}</span>,
}))

import OptionsFlow from './OptionsFlow.jsx'
import { aggregateCsv } from './optionsFlow/flowFactsEntry.js'
import { _resetFlowWorker, forgetLoaded } from './optionsFlow/flowWorkerClient.js'
import { setErCache } from './optionsFlow/flowLoadPolicy.js'

const CSV = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/optionsFlow/__fixtures__/flow-sample.csv'), 'utf8')

// The numbers the page must end up showing — computed with the SAME functions
// the page uses, so this fixture cannot drift away from the assertion.
const EXPECTED = aggregateCsv(CSV, { dateFilter: 'Last1' })

class RO { observe() {} unobserve() {} disconnect() {} }

/** Route every fetch the page makes; `csv` may be a never-settling promise. */
function mockFetch({ aggregate = true, csv = CSV } = {}) {
  return vi.fn((url) => {
    const u = String(url)
    const json = (body, headers = {}) => Promise.resolve({
      ok: true, status: 200,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
    if (u.includes('/api/flow/aggregate')) {
      if (!aggregate) return Promise.resolve({ ok: false, status: 503 })
      return json({ ok: true, stats: EXPECTED.stats, D: EXPECTED.D }, { 'x-flow-version': '1' })
    }
    if (u.includes('/api/flow/version')) return json({ version: 1 })
    if (u.includes('/api/calendar')) return json({ week_start: '2026-08-24', days: {} })
    if (u.includes('/api/flow/data') || u.includes('-data')) {
      if (csv instanceof Promise) return csv
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'x-flow-version' ? '1' : null) },
        text: () => Promise.resolve(csv),
      })
    }
    return json({})
  })
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', RO)
  setErCache(new Set())
  forgetLoaded()
  _resetFlowWorker()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const totalTrades = EXPECTED.D.totalTrades

describe('OptionsFlow — the load path', () => {
  it('paints the server-computed dataset WITHOUT waiting for the 14 MB tape', async () => {
    // ⭐ THE WHOLE POINT OF PREHYDRATION, asserted behaviourally rather than by
    // scanning the source. The CSV never settles here, so if the page can show
    // the numbers it can only have got them from /api/flow/aggregate.
    const never = new Promise(() => {})
    vi.stubGlobal('fetch', mockFetch({ csv: never }))

    render(<OptionsFlow />)

    await waitFor(() => {
      expect(document.body.textContent).toContain(String(totalTrades))
    }, { timeout: 8000 })
  }, 20000)

  it('still renders from the CSV when the aggregate is unavailable', async () => {
    // A 503 means "not built" and must cost speed, never correctness — the page
    // has to reach the same numbers by its own path.
    vi.stubGlobal('fetch', mockFetch({ aggregate: false }))

    render(<OptionsFlow />)

    await waitFor(() => {
      expect(document.body.textContent).toContain(String(totalTrades))
    }, { timeout: 15000 })
  }, 30000)

  it('shows a loading state rather than a blank page before anything lands', () => {
    const never = new Promise(() => {})
    vi.stubGlobal('fetch', vi.fn(() => never))
    const { container } = render(<OptionsFlow />)
    // Not asserting exact copy — only that the user is told something is
    // happening. A blank <div> here is the failure this catches.
    expect(container.textContent.trim().length).toBeGreaterThan(0)
  })

  it('control: the fixture and the assertion cannot silently agree on nothing', () => {
    // If EXPECTED ever computed to an empty dataset, every waitFor above would
    // pass against the string "0" appearing somewhere on the page.
    expect(totalTrades).toBeGreaterThan(0)
    expect(String(totalTrades).length).toBeGreaterThan(1)
  })
})
