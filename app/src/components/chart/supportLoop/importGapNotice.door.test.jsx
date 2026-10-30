// Support loop A1/A2/A3 through the REAL import door (`ImportBox`, the box the
// Builder's Pine tab mounts). `docs/pine/support-loop/PHASE-A.md`.
//
// ⛔ The box is driven by pasting, exactly as a member does; the server is a
// fetch stub that records every request so the rails can read what LEFT the page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'

import { ImportBox } from '../builder/PineBox'
import { _resetForTests } from './supportApi'
import { isPineBuiltin } from './importGaps'

const H = { requests: [], reportsEnabled: false }

function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
    if (String(url).endsWith('/config')) {
      return { ok: true, status: 200, json: async () => ({ reports_enabled: H.reportsEnabled, max_source_bytes: 131072, max_note_chars: 1000 }) }
    }
    if (String(url).endsWith('/reports/mine')) return { ok: true, status: 200, json: async () => ({ reports: [] }) }
    if (String(url).endsWith('/reports') && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: 'a'.repeat(32), status: 'new', duplicate: false }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  })
}

const paste = (text) => fireEvent.change(
  screen.getByLabelText(/^(pine script|script or formula)$/i), { target: { value: text } })
const pine = (body) => `//@version=5\nindicator("My script")\n${body}\n`
const gapPosts = () => H.requests.filter((r) => r.url.endsWith('/api/indicator-support/gaps'))

beforeEach(() => { cleanup(); _resetForTests(); H.reportsEnabled = false; stubFetch() })
afterEach(() => { vi.restoreAllMocks() })

describe('A1 — the notice appears exactly when a gap exists', () => {
  it('a fully translated script shows NO notice', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste(pine('plot(ta.sma(close, 20))'))
    await screen.findByTestId('import-outcome')
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId('import-gap-notice')).toBeNull()
    expect(gapPosts()).toEqual([])
  })

  it('a partial translation shows the notice, naming the built-in in plain words', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste(pine('plot(ta.sma(close))\nplot(close)'))
    const n = await screen.findByTestId('import-gap-notice')
    expect(n.textContent).toMatch(/1 part of this script isn’t supported yet, so the chart may differ from TradingView: ta\.sma\./)
    expect(n.getAttribute('role')).toBe('status')
  })

  it('a refused script shows the notice too, without naming a member identifier', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste(pine('plot(mySecretThing + 1)'))
    const n = await screen.findByTestId('import-gap-notice')
    expect(n.textContent).not.toMatch(/mySecretThing/)
  })

  it('fixing the script makes the notice go away', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste(pine('plot(ta.sma(close))\nplot(close)'))
    await screen.findByTestId('import-gap-notice')
    paste(pine('plot(ta.sma(close, 14))\nplot(close)'))
    await waitFor(() => expect(screen.queryByTestId('import-gap-notice')).toBeNull())
  })
})

describe('A2 — what leaves the page is allowlisted names only', () => {
  it('posts the real built-in and a COUNT for the member identifier, once per gap set', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste(pine('secretLevel = 42\nplot(ta.sma(close))\nplot(myHelper(secretLevel))\nplot(close)'))
    await screen.findByTestId('import-gap-notice')
    await waitFor(() => expect(gapPosts().length).toBe(1))
    const body = gapPosts()[0].body
    expect(JSON.stringify(body)).not.toMatch(/secretLevel|myHelper|indicator|plot/)
    expect(body.gaps).toEqual([{ name: 'ta.sma', kind: 'call-unmapped' }])
    expect(body.unlisted).toBe(1)
    for (const g of body.gaps) expect(isPineBuiltin(g.name)).toBe(true)
    // the same gap set again (a re-render, a knob) is not re-sent
    paste(pine('secretLevel = 43\nplot(ta.sma(close))\nplot(myHelper(secretLevel))\nplot(close)'))
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(gapPosts().length).toBe(1)
  })
})

describe('A3 — the button, only while the server flag is on', () => {
  it('flag off: the notice is there and no button is offered', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste(pine('plot(ta.sma(close))\nplot(close)'))
    await screen.findByTestId('import-gap-notice')
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.queryByTestId('import-report-mismatch')).toBeNull()
  })

  it('flag on: a fully translated script still offers "Doesn’t match TradingView?"', async () => {
    H.reportsEnabled = true
    render(<ImportBox onPick={vi.fn()} />)
    paste(pine('plot(ta.sma(close, 20))'))
    expect(await screen.findByTestId('import-report-mismatch')).toBeTruthy()
    expect(screen.queryByTestId('import-gap-notice')).toBeNull()
  })

  it('flag on: the dialog sends ONLY after consent, with symbol, timeframe and the gap list', async () => {
    H.reportsEnabled = true
    const src = pine('plot(ta.sma(close))\nplot(close)')
    render(<ImportBox onPick={vi.fn()} sym="AAPL" tf="D" />)
    paste(src)
    fireEvent.click(await screen.findByTestId('import-report-mismatch'))
    const send = await screen.findByTestId('report-mismatch-send')
    expect(screen.getByTestId('report-mismatch-privacy').textContent).toMatch(/sends the script’s code to UCT/)
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    expect(H.requests.some((r) => r.url.endsWith('/reports') && r.method === 'POST')).toBe(false)
    fireEvent.change(screen.getByTestId('report-mismatch-note'), { target: { value: 'lines are higher' } })
    fireEvent.click(screen.getByTestId('report-mismatch-consent'))
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await screen.findByTestId('report-mismatch-done')
    const post = H.requests.find((r) => r.url.endsWith('/reports') && r.method === 'POST')
    expect(post.body).toEqual({
      consent: true, source: src, note: 'lines are higher', tradingview_link: null,
      symbol: 'AAPL', timeframe: 'D', gaps: [{ name: 'ta.sma', kind: 'call-unmapped' }],
    })
  })
})
