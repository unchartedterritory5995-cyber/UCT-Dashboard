// app/src/pages/journal-2-0/components/notebook/TextAlertSheet.test.jsx
// Tier 2 part A, item 8 / R-T2A-4: the sheet the "Set alert" chip opens, FILLED IN from the sentence.
// It holds no create logic of its own, so this file pins the ROUTING (a close is a closed-bar indicator
// alert, everything else goes through alertCommand.setAlert), the typo guard on BOTH paths, and that every
// refusal reaches the screen as words -- with nothing sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../terminal/alertCommand', async (orig) => ({
  ...(await orig()),
  setAlert: vi.fn(),
  currentPrice: vi.fn(),
}))
vi.mock('../../../../hooks/useIndicatorAlerts', () => ({
  createIndicatorAlert: vi.fn(),
  useIndicatorAlertCatalog: vi.fn(),
}))

import { currentPrice, setAlert } from '../../../terminal/alertCommand'
import { createIndicatorAlert, useIndicatorAlertCatalog } from '../../../../hooks/useIndicatorAlerts'
import TextAlertSheet from './TextAlertSheet'

// The catalog as V12 shapes it: an entry per indicator with its `plots`, each plot's `conditions` objects
// carrying `value`. `close` is the price address, and it lists below / above (and the two crossings).
const COND = (...v) => v.map((value) => ({ value, label: value, needs_threshold: true }))
const CLOSE_CATALOG = [
  { indicator: 'close', label: 'Price (Close)', conditions: COND('above', 'below', 'cross_above', 'cross_below'),
    plots: [{ value: 'close', label: 'Price (Close)', conditions: COND('above', 'below', 'cross_above', 'cross_below') }] },
]
const catalog = (entries, extra = {}) => useIndicatorAlertCatalog.mockReturnValue({
  catalog: entries, refusals: [], isLoading: false, error: null, ...extra,
})

const NVDA_BELOW = { symbol: 'NVDA', mode: 'close', direction: 'below', price: 120, tf: 'D' }
let onClose; let onDone
const mount = (initial = NVDA_BELOW) => {
  onClose = vi.fn(); onDone = vi.fn()
  return render(<TextAlertSheet open initial={initial} onClose={onClose} onDone={onDone} />)
}
const press = () => fireEvent.click(screen.getByRole('button', { name: 'Set alert' }))
const field = (name) => screen.getByLabelText(name)

beforeEach(() => {
  vi.clearAllMocks()
  catalog(CLOSE_CATALOG)
  currentPrice.mockResolvedValue(125)
  createIndicatorAlert.mockResolvedValue({ ok: true, id: 7 })
  setAlert.mockResolvedValue({ text: 'Alert set: NVDA above $130.00 (now $125.00).' })
})
afterEach(() => { cleanup() })

describe('the prefilled alert sheet', () => {
  it('is filled in from the sentence', () => {
    mount()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Set an alert')).toBeTruthy()
    expect(field('Ticker').value).toBe('NVDA')
    const when = field('When')
    expect(when.options[when.selectedIndex].textContent).toBe('Closes below')
    expect(field('Price').value).toBe('120')
    const chart = field('Chart')
    expect(chart.options[chart.selectedIndex].textContent).toBe('Daily')
  })

  it('a weekly close opens on Weekly', () => {
    mount({ ...NVDA_BELOW, tf: 'W' })
    const chart = field('Chart')
    expect(chart.options[chart.selectedIndex].textContent).toBe('Weekly')
  })

  it('a close becomes a closed-bar indicator alert, and says so in words', async () => {
    mount()
    press()
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(createIndicatorAlert).toHaveBeenCalledWith({ sym: 'NVDA', indicator: 'close', condition: 'below', threshold: 120, tf: 'D' })
    expect(setAlert).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith('Alert set: NVDA closes below $120.00 on the daily chart. It rings the bell, and sends email or Discord if you have those on.')
  })

  it('a weekly close goes out with tf W and says "weekly"', async () => {
    mount({ ...NVDA_BELOW, direction: 'above', price: 150, tf: 'W' })
    press()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(createIndicatorAlert).toHaveBeenCalledWith({ sym: 'NVDA', indicator: 'close', condition: 'above', threshold: 150, tf: 'W' })
    expect(onDone.mock.calls[0][0]).toContain('closes above $150.00 on the weekly chart')
  })

  it('intraday goes through setAlert, and hands on its text', async () => {
    mount({ symbol: 'NVDA', mode: 'intraday', direction: 'above', price: 130, tf: 'D' })
    expect(field('When').options[field('When').selectedIndex].textContent).toBe('Trades above')
    expect(screen.queryByLabelText('Chart')).toBeNull() // a chart (daily/weekly) means nothing to a live price
    press()
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(setAlert).toHaveBeenCalledWith({ sym: 'NVDA', price: 130, direction: 'above' })
    expect(createIndicatorAlert).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith('Alert set: NVDA above $130.00 (now $125.00).')
  })

  it('every field stays editable: a changed price, ticker and mode are what is sent', async () => {
    mount()
    fireEvent.change(field('Ticker'), { target: { value: '$amd' } })
    fireEvent.change(field('Price'), { target: { value: '121.5' } })
    fireEvent.change(field('When'), { target: { value: 'close-above' } })
    press()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(createIndicatorAlert).toHaveBeenCalledWith({ sym: 'AMD', indicator: 'close', condition: 'above', threshold: 121.5, tf: 'D' })
  })

  it('switching to an intraday choice sends it through setAlert', async () => {
    mount()
    fireEvent.change(field('When'), { target: { value: 'trade-reach' } })
    press()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(setAlert).toHaveBeenCalledWith({ sym: 'NVDA', price: 120, direction: null })
    expect(createIndicatorAlert).not.toHaveBeenCalled()
  })

  it("the typo guard stops a close more than 10x away: its sentence is shown, nothing is sent", async () => {
    // $11 (not $12): the shared guard is `price > current * MAX_DISTANCE`, so 120 against 12 is EXACTLY 10x and passes.
    currentPrice.mockResolvedValue(11)
    mount()
    press()
    expect(await screen.findByText("$120.00 is more than 10 times away from NVDA's price ($11.00), so it looks like a typo. Nothing was set.")).toBeTruthy()
    expect(createIndicatorAlert).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it("the intraday path shows setAlert's own rejection sentence, verbatim", async () => {
    const e = new Error('raw'); e.memberText = "$130.00 is more than 10 times away from NVDA's price ($12.00), so it looks like a typo. Nothing was set."
    setAlert.mockRejectedValue(e)
    mount({ symbol: 'NVDA', mode: 'intraday', direction: 'above', price: 130, tf: 'D' })
    press()
    expect(await screen.findByText(e.memberText)).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('no direction and no price: the setAlert sentence is shown and nothing is reported done', async () => {
    const e = new Error('raw'); e.memberText = 'No current price for NVDA right now, so above or below cannot be worked out.'
    setAlert.mockRejectedValue(e)
    mount({ symbol: 'NVDA', mode: 'intraday', direction: null, price: 130, tf: 'D' })
    expect(field('When').options[field('When').selectedIndex].textContent).toBe('Reaches (above or below)')
    press()
    expect(await screen.findByText(e.memberText)).toBeTruthy()
    expect(setAlert).toHaveBeenCalledWith({ sym: 'NVDA', price: 130, direction: null })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('an error with no member sentence still shows a fixed one, never the raw text', async () => {
    setAlert.mockRejectedValue(new Error('TypeError: x is not a function at foo.js:12'))
    mount({ symbol: 'NVDA', mode: 'intraday', direction: 'above', price: 130, tf: 'D' })
    press()
    expect(await screen.findByText('The alert for NVDA could not be saved just now. Nothing was set; try again.')).toBeTruthy()
    expect(screen.queryByText(/foo\.js/)).toBeNull()
  })

  it("a refusal from the indicator route is shown as the route's own sentence; nothing is done", async () => {
    createIndicatorAlert.mockResolvedValue({ ok: false, error: 'Price alerts need a paid plan.' })
    mount()
    press()
    expect(await screen.findByText('Price alerts need a paid plan.')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('the catalog has no close address: only intraday choices, and a line says so', () => {
    catalog([])
    mount()
    const labels = Array.from(field('When').options).map((o) => o.textContent)
    expect(labels).toEqual(['Trades below', 'Trades above', 'Reaches (above or below)'])
    expect(field('When').options[field('When').selectedIndex].textContent).toBe('Trades below')
    expect(screen.getByText('Close alerts are not available right now.')).toBeTruthy()
  })

  it('a close that cannot be created falls back to intraday and still sends nothing as a close', async () => {
    catalog([])
    mount()
    press()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(createIndicatorAlert).not.toHaveBeenCalled()
    expect(setAlert).toHaveBeenCalledWith({ sym: 'NVDA', price: 120, direction: 'below' })
  })

  it('while the catalog is still loading the close choices are offered, and no "not available" line shows', () => {
    catalog([], { isLoading: true })
    mount()
    expect(Array.from(field('When').options).map((o) => o.textContent)).toContain('Closes below')
    expect(screen.queryByText('Close alerts are not available right now.')).toBeNull()
  })

  it('a close with no direction in the sentence asks which, and sends nothing', async () => {
    mount({ ...NVDA_BELOW, direction: null })
    const when = field('When')
    expect(when.value).toBe('') // never a silent "below"
    press()
    expect(await screen.findByText('Choose when the alert should ring: Closes above or Closes below.')).toBeTruthy()
    expect(createIndicatorAlert).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('a blank ticker or a price of zero is refused before anything is sent', async () => {
    mount()
    fireEvent.change(field('Ticker'), { target: { value: '  ' } })
    press()
    expect(await screen.findByText('Type a ticker.')).toBeTruthy()
    fireEvent.change(field('Ticker'), { target: { value: 'NVDA' } })
    fireEvent.change(field('Price'), { target: { value: '0' } })
    press()
    expect(await screen.findByText('Type a price above zero.')).toBeTruthy()
    expect(createIndicatorAlert).not.toHaveBeenCalled()
    expect(setAlert).not.toHaveBeenCalled()
  })

  it('the closing sentence tells the truth about what a close alert does next', () => {
    mount()
    // The indicator-alert machine is NOT fire-once: it goes quiet after a fire and re-arms when a bar closes
    // back on the other side (indicator_alert_service.py, _rearm). "Rings once" would be false here.
    expect(screen.getByText(/after a bar closes beyond your price/i)).toBeTruthy()
    expect(screen.getByText(/can ring again after that/i)).toBeTruthy()
    expect(screen.queryByText(/rings once/i)).toBeNull()
  })

  it('an intraday alert is fire-once, and says so', () => {
    mount({ symbol: 'NVDA', mode: 'intraday', direction: 'above', price: 130, tf: 'D' })
    expect(screen.getByText('Rings once, the first time the live price crosses your price.')).toBeTruthy()
  })

  it('Cancel sets nothing', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(createIndicatorAlert).not.toHaveBeenCalled()
    expect(setAlert).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('the button is disabled while a create is out, so a double press creates one alert', async () => {
    let release
    createIndicatorAlert.mockReturnValue(new Promise((r) => { release = r }))
    mount()
    press()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Set alert' }).disabled).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Set alert' }))
    release({ ok: true, id: 1 })
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(createIndicatorAlert).toHaveBeenCalledTimes(1)
  })
})
