// G-040 ruling 3 — the Model Book capture: a REFERENCE that re-renders from the
// store, a plain tombstone when the entry is gone, its search line, and the
// locked-note refusal — all through the real modules, `fetch` the only seam.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModelBookEmbed from './ModelBookEmbed'
import { buildWidgetEmbedAttrs, resolveEmbedRender } from '../../lib/widgetEmbedCore'
import { sendCaptureToJournal } from '../../lib/sendToJournal'

const CAPTURE = {
  year: 2023, symbol: 'NVDA', setupId: 7, setupType: 'High Tight Flag (Powerplay)',
  setupDate: '2023-05-25', title: 'NVDA 2023 — High Tight Flag (Powerplay) 2023-05-25',
  annotation: 'the gap that started it',
}
const attrsOf = (cap) => buildWidgetEmbedAttrs('modelbook', cap, { capturedAt: '2026-09-30T14:00:00.000Z' })

const STOCK = {
  id: 5, year: 2023, symbol: 'NVDA', company: 'NVIDIA Corp', gain_pct: 239.2, thesis: 'AI capex',
  setups: [
    { id: 6, setup_type: 'VCP', label_date: '2023-01-10', grade: 'B' },
    { id: 7, setup_type: 'High Tight Flag (Powerplay)', label_date: '2023-05-25', grade: 'A+',
      entry_price: 305.38, stop_price: 285, target_price: 420, notes: 'the earnings gap held' },
  ],
}

/** A store that answers the two reads the embed makes, per test. */
function store({ list = [{ id: 5, year: 2023, symbol: 'NVDA' }], detail = STOCK, listStatus = 200, detailStatus = 200 } = {}) {
  const fn = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/modelbook/stocks?year=2023')) {
      return { ok: listStatus < 400, status: listStatus, json: async () => ({ year: 2023, stocks: list }) }
    }
    if (u === '/api/modelbook/stock/5') {
      return { ok: detailStatus < 400, status: detailStatus, json: async () => detail }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => localStorage.clear())
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('ModelBookEmbed — a reference that re-renders from the store', () => {
  it('shows the stock and the referenced setup from the store, plus the member’s own words', async () => {
    const fetchSpy = store()
    const attrs = attrsOf(CAPTURE)
    expect(resolveEmbedRender(attrs).kind).toBe('live')
    render(<ModelBookEmbed attrs={attrs} />)
    expect(await screen.findByTestId('modelbook-embed-title')).toHaveTextContent('NVDA (NVIDIA Corp) · 2023')
    const setup = screen.getByTestId('modelbook-embed-setup')
    expect(setup).toHaveTextContent('High Tight Flag (Powerplay)')
    expect(setup).toHaveTextContent('May 25, 2023')
    expect(setup).toHaveTextContent('A+')
    expect(setup).toHaveTextContent('$305.38')
    expect(screen.getByText('the earnings gap held')).toBeInTheDocument()     // the STORE's notes (a reference)
    expect(screen.getByTestId('modelbook-embed-annotation')).toHaveTextContent('the gap that started it')
    expect(screen.queryByText('VCP')).toBeNull()                               // only the referenced setup
    expect(fetchSpy.mock.calls.map(([u]) => String(u))).toEqual(['/api/modelbook/stocks?year=2023', '/api/modelbook/stock/5'])
  })

  it('a setup the firm re-saved under a NEW id still resolves by its canonical identity', async () => {
    store({ detail: { ...STOCK, setups: [{ ...STOCK.setups[1], id: 99 }] } })
    render(<ModelBookEmbed attrs={attrsOf(CAPTURE)} />)
    expect(await screen.findByTestId('modelbook-embed-setup')).toHaveTextContent('High Tight Flag (Powerplay)')
  })

  it('a stock-only reference shows the stock and its thesis', async () => {
    store()
    render(<ModelBookEmbed attrs={attrsOf({ year: 2023, symbol: 'NVDA', title: 'NVDA 2023' })} />)
    expect(await screen.findByTestId('modelbook-embed-title')).toHaveTextContent('NVDA (NVIDIA Corp) · 2023')
    expect(screen.getByText('AI capex')).toBeInTheDocument()
    expect(screen.queryByTestId('modelbook-embed-setup')).toBeNull()
  })
})

describe('ModelBookEmbed — the tombstone, never an error', () => {
  const expectTombstone = async () => {
    expect(await screen.findByTestId('modelbook-embed-tombstone')).toHaveTextContent('This Model Book entry was removed')
    expect(screen.getByText(`Captured as: ${CAPTURE.title}`)).toBeInTheDocument()
    // The member's own words outlive the entry they were about.
    expect(screen.getByTestId('modelbook-embed-annotation')).toHaveTextContent('the gap that started it')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/error|failed|could not/i)
  }

  it('the stock is no longer in that year', async () => {
    store({ list: [] })
    render(<ModelBookEmbed attrs={attrsOf(CAPTURE)} />)
    await expectTombstone()
  })

  it('the stock row is gone (404)', async () => {
    store({ detailStatus: 404 })
    render(<ModelBookEmbed attrs={attrsOf(CAPTURE)} />)
    await expectTombstone()
  })

  it('the selected setup was removed while the stock stayed', async () => {
    store({ detail: { ...STOCK, setups: [STOCK.setups[0]] } })
    render(<ModelBookEmbed attrs={attrsOf(CAPTURE)} />)
    await expectTombstone()
  })

  it('⛔ CONTROL — a store that could not be READ is not a store that is EMPTY', async () => {
    store({ listStatus: 500 })
    render(<ModelBookEmbed attrs={attrsOf(CAPTURE)} />)
    expect(await screen.findByTestId('modelbook-embed-unreachable')).toHaveTextContent('could not be reached')
    expect(screen.queryByTestId('modelbook-embed-tombstone')).toBeNull()
  })
})

describe('the search line', () => {
  it('carries the stock, the setup and the member’s annotation', () => {
    expect(attrsOf(CAPTURE).searchText)
      .toBe('[model book: NVDA 2023 — High Tight Flag (Powerplay) 2023-05-25 — the gap that started it]')
  })
})

describe('ruling 149 — a locked note refuses the capture, with the doors’ own words', () => {
  it('the toast names the lock and the reference waits in the inbox', async () => {
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'nL', ts: Date.now(), title: 'Plan' }))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), body: opts.body })
      if (String(url) === '/api/j2/notes/nL/embeds') return { ok: false, status: 423, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    const msg = await sendCaptureToJournal('modelbook', CAPTURE, { label: 'NVDA 2023 (Model Book)' })
    expect(msg).toBe('“Plan” is locked — NVDA 2023 (Model Book) captured to your inbox until you unlock it')
    const body = JSON.parse(calls.find((c) => c.url === '/api/j2/inbox').body)
    expect(body.widgetId).toBe('modelbook')
    expect(body.params).toMatchObject({ year: 2023, symbol: 'NVDA', setupId: 7, annotation: 'the gap that started it' })
  })
})
