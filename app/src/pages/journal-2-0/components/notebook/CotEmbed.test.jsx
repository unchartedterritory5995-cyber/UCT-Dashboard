// G-040 ruling 2 — the COT capture: its embed, its search line, and the
// locked-note refusal, all through the real modules.
//
// ⛔ THE LOAD-BEARING CASE IS "NEVER RE-FETCHES". The CFTC revises its data, so
// `fetch` is handed a REVISED answer for the very same report week; the embed must
// show the captured figures, none of the revised ones, and must not ask at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import CotEmbed, { cotHref } from './CotEmbed'
import { buildWidgetEmbedAttrs, resolveEmbedRender } from '../../lib/widgetEmbedCore'
import { sendCaptureToJournal } from '../../lib/sendToJournal'

const CAPTURE = {
  market: 'ES', marketName: 'E-mini S&P 500', reportDate: '2026-09-22',
  groups: {
    commercials: { net: -120000, wow: 5000, index: 12 },
    largeSpecs: { net: 150000, wow: -2000, index: 88 },
    smallSpecs: { net: -30000, wow: -3000, index: 40 },
  },
  openInterest: { value: 2100000, wow: 12000, index: 55 },
  bias: { label: 'Contrarian Bearish', tone: 'bear', strength: 'moderate' },
  crowding: { label: 'Crowded long', tone: 'bear', index: 88 },
}
const CAPTURED_AT = '2026-09-26T21:05:00.000Z'
const attrsOf = (cap) => buildWidgetEmbedAttrs('cot', cap, { capturedAt: CAPTURED_AT })

// `/api/cot/ES` AFTER a CFTC revision of that same week — every figure moved.
const REVISED = [{
  date: '2026-09-22', commercial_net: -777777, large_spec_net: 666666, small_spec_net: 555555, open_interest: 4444444,
}]

let fetchSpy
beforeEach(() => {
  localStorage.clear()
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => REVISED }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

describe('CotEmbed — a frozen report week that never re-fetches', () => {
  it('renders exactly the captured figures and verdicts, and never asks for the revised ones', async () => {
    const attrs = attrsOf(CAPTURE)
    expect(resolveEmbedRender(attrs).kind).toBe('live')
    render(<CotEmbed attrs={attrs} height={320} />)
    await settle()

    expect(screen.getByText('E-mini S&P 500 (ES)')).toBeInTheDocument()
    expect(screen.getByTestId('cot-embed-week')).toHaveTextContent('Report week Sep 22, 2026, captured Sep 26, 2026')
    expect(screen.getByTestId('cot-embed-bias')).toHaveTextContent('Contrarian Bearish')
    expect(screen.getByTestId('cot-embed-crowding')).toHaveTextContent('Crowded long')
    // Net · WoW · 3Y index — the rail's own formatting of the captured numbers.
    expect(screen.getByTestId('cot-embed-commercials')).toHaveTextContent('Commercials(120,000)▲ 5K12')
    expect(screen.getByTestId('cot-embed-largeSpecs')).toHaveTextContent('Large Specs150,000▼ 2K88')
    expect(screen.getByTestId('cot-embed-smallSpecs')).toHaveTextContent('Small Specs(30,000)▼ 3K40')
    expect(screen.getByTestId('cot-embed-oi')).toHaveTextContent('Open Interest2,100,000▲ 12K55')

    // ⛔ None of the revised figures reached the screen…
    for (const v of ['777,777', '(777,777)', '666,666', '555,555', '4,444,444']) {
      expect(screen.queryByText(v)).toBeNull()
    }
    expect(document.body.textContent).not.toMatch(/777,777|666,666|555,555|4,444,444/)
    // …because nothing asked for them.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('"Current COT for ES" opens the COT tab on that market — today’s report, said so', () => {
    render(<CotEmbed attrs={attrsOf(CAPTURE)} />)
    const link = screen.getByTestId('cot-embed-current')
    expect(link).toHaveTextContent('Current COT for ES')
    expect(link.getAttribute('href')).toBe('/breadth?tab=cot&cot=ES')
    expect(link.closest('p')).toHaveTextContent('the latest report, not this week')
    expect(cotHref('ES&x=1')).toBeNull()
  })
})

describe('the search line', () => {
  it('carries the market, its name, the report week and the verdicts', () => {
    expect(attrsOf(CAPTURE).searchText)
      .toBe('[cot: ES E-mini S&P 500 — report week 2026-09-22 · Contrarian Bearish · Crowded long]')
  })

  it('never files the CFTC code as a ticker (no `symbol` param for the embeds sidecar)', () => {
    expect(attrsOf(CAPTURE).params.symbol).toBeUndefined()
  })
})

describe('ruling 149 — a locked note refuses the capture, with the doors’ own words', () => {
  it('the toast names the lock and the frozen week waits in the inbox', async () => {
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'nL', ts: Date.now(), title: 'Plan' }))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), body: opts.body })
      if (String(url) === '/api/j2/notes/nL/embeds') return { ok: false, status: 423, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    const msg = await sendCaptureToJournal('cot', CAPTURE, { label: 'ES COT positioning' })
    expect(msg).toBe('“Plan” is locked — ES COT positioning captured to your inbox until you unlock it')
    const body = JSON.parse(calls.find((c) => c.url === '/api/j2/inbox').body)
    expect(body.widgetId).toBe('cot')
    expect(body.params.groups).toEqual(CAPTURE.groups)
  })
})
