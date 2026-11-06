// S13 (audit 2026-11-05): the quick-capture box teaches the natural-language alert phrasing. The example must be a
// sentence the alert parser REALLY reads (lib/alertPhrase.js), so it is parsed here, not trusted.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CaptureDialog from './CaptureDialog'
import { AuthContext } from '../../../../context/AuthContext'
import { captureDestination } from '../../lib/capture'
import { __clearTickerCacheForTests } from '../../lib/smartChipsApi'
import { ALERT_EXAMPLE, thoughtPlaceholder } from './CaptureDialog'
import { parseAlertPhrase } from '../../lib/alertPhrase'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

afterEach(() => __resetNotebookFlags())

describe('the quick thought placeholder', () => {
  it('with the alert chip on, it reads "Try: alert me if NVDA closes below 190"', () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: true })
    expect(thoughtPlaceholder()).toBe('Try: alert me if NVDA closes below 190')
  })

  it('the example is a sentence the parser reads: NVDA, a closing alert, below 190', () => {
    const got = parseAlertPhrase(ALERT_EXAMPLE)
    expect(got).toMatchObject({ symbol: 'NVDA', mode: 'close', direction: 'below', price: 190 })
  })

  it('with the chip off, it keeps the plain prompt (CONTROL: it never teaches a sentence nothing reads)', () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: false })
    expect(thoughtPlaceholder()).toBe('What are you thinking?')
  })
})

// Tier 2 fix round 1 (review Important 2): the dialog itself offers what the placeholder teaches. Typed, the sentence
// is read by the one parser, its word confirmed by the server, and "Set alert…" opens the SAME sheet the note's chip
// opens, filled in. Nothing is set until the member presses there.
describe('the quick thought offers "Set alert" (review Important 2)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch; __clearTickerCacheForTests() })
  const mount = () => render(
    <AuthContext.Provider value={{ user: { id: 'u1' }, isPaid: true }}>
      <CaptureDialog open onClose={() => {}} destination={captureDestination({})} />
    </AuthContext.Provider>,
  )

  it('an alert sentence with a confirmed ticker offers Set alert; it opens the alert sheet filled with NVDA, below, 190', async () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: true })
    globalThis.fetch = vi.fn(async (url) => (String(url).includes('smart-chips/tickers')
      ? { ok: true, json: async () => ({ tickers: [{ symbol: 'NVDA' }] }) }
      : { ok: true, json: async () => ({}) }))
    mount()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: ALERT_EXAMPLE } })
    const set = await screen.findByRole('button', { name: 'Set alert…' }, { timeout: 3000 })
    expect(document.querySelector('[data-capture-alert-offer="ready"]').textContent).toMatch(/NVDA/)
    expect(globalThis.fetch.mock.calls.some(([u, i]) => /alerts/.test(String(u)) && i?.method === 'POST' && !/smart-chips/.test(String(u)))).toBe(false)
    fireEvent.click(set)
    const sheet = await screen.findByRole('dialog', { name: 'Set an alert' }, { timeout: 3000 })
    expect(within(sheet).getByDisplayValue('NVDA')).toBeInTheDocument()
    expect(within(sheet).getByDisplayValue('190')).toBeInTheDocument()
  })

  // Tier 2 re-review R1-2: the alert sheet opens ON TOP of the capture dialog. Esc closes the top one only: the sheet
  // goes, focus returns to "Set alert…", and the capture dialog (and the sentence in it) stays.
  it('R1-2: Esc closes only the alert sheet, focus returns to Set alert…, the capture dialog stays open', async () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: true })
    globalThis.fetch = vi.fn(async (url) => (String(url).includes('smart-chips/tickers')
      ? { ok: true, json: async () => ({ tickers: [{ symbol: 'NVDA' }] }) }
      : { ok: true, json: async () => ({}) }))
    mount()
    const capture = screen.getByLabelText('Quick thought').closest('[role="dialog"]')
    expect(capture).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: ALERT_EXAMPLE } })
    const set = await screen.findByRole('button', { name: 'Set alert…' }, { timeout: 3000 })
    set.focus()
    fireEvent.click(set)
    const sheet = await screen.findByRole('dialog', { name: 'Set an alert' }, { timeout: 3000 })
    fireEvent.keyDown(document.activeElement && sheet.contains(document.activeElement) ? document.activeElement : sheet,
      { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set an alert' })).toBeNull())
    expect(capture.isConnected).toBe(true)
    expect(screen.getByLabelText('Quick thought')).toHaveValue(ALERT_EXAMPLE)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Set alert…' })))
  })

  it('CONTROL: a word the server does not confirm as a ticker is never offered', async () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: true })
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ tickers: [] }) }))
    mount()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: 'alert me if RS closes below 190' } })
    await new Promise((r) => setTimeout(r, 900))
    expect(screen.queryByRole('button', { name: 'Set alert…' })).toBeNull()
  })

  it('with the chip off nothing is offered and no ticker check is asked', async () => {
    latchNotebookFlags({ notebook_smart_chips_enabled: false })
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ tickers: [{ symbol: 'NVDA' }] }) }))
    mount()
    fireEvent.change(screen.getByLabelText('Quick thought'), { target: { value: ALERT_EXAMPLE } })
    await new Promise((r) => setTimeout(r, 900))
    expect(screen.queryByRole('button', { name: 'Set alert…' })).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
