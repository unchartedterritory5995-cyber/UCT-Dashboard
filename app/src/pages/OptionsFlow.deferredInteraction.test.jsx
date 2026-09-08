/**
 * TICKER_DB + CONV leave first paint — the CLIENT half.
 *
 * These two keys are ~77% of what the bootstrap used to weigh and NOTHING on the
 * render path reads either: every consumer is a button handler, a
 * selection-gated branch, or a non-default tab. They now arrive immediately
 * AFTER first paint.
 *
 * ⛔ THIS FILE SHIPS A DEPLOY BEFORE THE SERVER-SIDE SPLIT, DELIBERATELY. web and
 * flow-worker deploy independently, and a member holding a cached OLD chunk when
 * flow-worker stopped sending the keys would hit a TypeError on their next
 * drilldown. So the client learns to tolerate their absence first, and only then
 * does the server stop sending them. Every test below therefore runs against a
 * bootstrap with the keys MISSING — the state the next deploy creates.
 *
 * ⛔ AND THEY RENDER THE REAL COMPONENT. Three production defects this session
 * were invisible to helper-level tests; a guard that is only proven by scanning
 * source is not proven.
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
import { _resetFlowWorker, forgetLoaded } from './optionsFlow/flowWorkerClient.js'
import { _resetErCache } from './optionsFlow/flowLoadPolicy.js'

const CSV = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/optionsFlow/__fixtures__/flow-sample.csv'), 'utf8')
const EXPECTED = aggregateCsv(CSV, { dateFilter: 'Last1' })

class RO { observe() {} unobserve() {} disconnect() {} }

/** The bootstrap the NEXT deploy will send: everything except the two keys. */
function bootstrapWithoutInteractionKeys() {
  const { TICKER_DB, CONV, ...rest } = EXPECTED.D   // eslint-disable-line no-unused-vars
  return rest
}

/**
 * @param partsBehaviour 'ok' | 'fail' | 'never'
 */
function mockFetch({ partsBehaviour = 'ok', onPartsUrl = () => {} } = {}) {
  return vi.fn((url) => {
    const u = String(url)
    const json = (body, headers = {}) => Promise.resolve({
      ok: true, status: 200,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
    if (u.includes('/api/flow/aggregate')) {
      const m = /[?&]part=([A-Za-z_]+)/.exec(u)
      if (m) {
        onPartsUrl(u)
        const part = m[1]
        if (partsBehaviour === 'never') return new Promise(() => {})
        if (partsBehaviour === 'fail') return Promise.resolve({ ok: false, status: 503 })
        const body = part === 'bootstrap'
          ? bootstrapWithoutInteractionKeys()
          : { [part]: EXPECTED.D[part] }
        return json({ ok: true, stats: EXPECTED.stats, D: body }, { 'x-flow-version': '1' })
      }
      return json({ ok: true, stats: EXPECTED.stats, D: bootstrapWithoutInteractionKeys() },
        { 'x-flow-version': '1' })
    }
    if (u.includes('/api/flow/version')) return json({ version: 1 })
    if (u.includes('/api/calendar')) return json({ week_start: '2026-08-24', days: {} })
    if (u.includes('/api/flow/data') || u.includes('-data')) {
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'x-flow-version' ? '1' : null) },
        text: () => Promise.resolve(CSV),
      })
    }
    return json({})
  })
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', RO)
  _resetErCache(); forgetLoaded(); _resetFlowWorker()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const totalTrades = EXPECTED.D.totalTrades

describe('first paint without TICKER_DB / CONV', () => {
  it('CONTROL: the fixture really does exercise both keys', () => {
    // Without this the whole file could pass against a fixture where the keys
    // were empty anyway, proving nothing about deferring them.
    expect(EXPECTED.D.TICKER_DB.length).toBeGreaterThan(0)
    expect(EXPECTED.D.CONV.length).toBeGreaterThan(0)
    expect(bootstrapWithoutInteractionKeys().TICKER_DB).toBeUndefined()
    expect(bootstrapWithoutInteractionKeys().CONV).toBeUndefined()
  })

  it('renders the page, and the SAME first-paint numbers, with both keys absent', async () => {
    const { default: OptionsFlow } = await import('./OptionsFlow.jsx')
    vi.stubGlobal('fetch', mockFetch())

    render(<OptionsFlow />)

    // The identical assertion the baseline load-path test makes. If deferring
    // these keys changed first paint at all, this number moves or never appears.
    await waitFor(() => {
      expect(document.body.textContent).toContain(String(totalTrades))
    }, { timeout: 8000 })
  }, 20000)

  it('⛔ does not throw — an unguarded `.find` on a missing array is the whole risk', async () => {
    const { default: OptionsFlow } = await import('./OptionsFlow.jsx')
    const errors = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(String(a[0])))
    vi.stubGlobal('fetch', mockFetch())

    render(<OptionsFlow />)
    await waitFor(() => {
      expect(document.body.textContent).toContain(String(totalTrades))
    }, { timeout: 8000 })

    const crashes = errors.filter(e => /TypeError|undefined is not|Cannot read/i.test(e))
    expect(crashes, `render errors:\n${crashes.join('\n')}`).toHaveLength(0)
    spy.mockRestore()
  }, 20000)

  it('stays stable when the deferred fetch FAILS', async () => {
    // A 503 on the interaction parts must not blank the page or strand it — the
    // member keeps the fully-working first paint they already had.
    const { default: OptionsFlow } = await import('./OptionsFlow.jsx')
    vi.stubGlobal('fetch', mockFetch({ partsBehaviour: 'fail' }))

    render(<OptionsFlow />)
    await waitFor(() => {
      expect(document.body.textContent).toContain(String(totalTrades))
    }, { timeout: 8000 })
  }, 20000)

  it('stays stable while the deferred fetch NEVER settles', async () => {
    // The race a member can actually create: click something before it lands.
    const { default: OptionsFlow } = await import('./OptionsFlow.jsx')
    vi.stubGlobal('fetch', mockFetch({ partsBehaviour: 'never' }))

    render(<OptionsFlow />)
    await waitFor(() => {
      expect(document.body.textContent).toContain(String(totalTrades))
    }, { timeout: 8000 })
  }, 20000)
})
