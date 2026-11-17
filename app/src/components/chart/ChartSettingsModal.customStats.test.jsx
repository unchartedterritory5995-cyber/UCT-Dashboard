// Header & legend → Info row stats → "+ Custom stat" (owner 11-16): a member adds an indicator value (EMA 21, RSI 14,
// their own formula) to the header with the parameters they pick. Inline pages inside the window, never a portal.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { _resetIndicatorHistoryForTests } from './indicatorHistoryStore'

beforeEach(() => { _resetIndicatorHistoryForTests(); try { window.sessionStorage.clear() } catch { /* jsdom */ } })

function Host({ initial, spy }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={(n) => { spy?.(n); setCs(n) }} />
}
const openHeader = () => fireEvent.click(screen.getByRole('tab', { name: 'Header & legend' }))
const openPicker = () => fireEvent.click(screen.getByRole('button', { name: /Choose stats/ }))
const names = () => screen.getAllByRole('textbox', { name: /^Name for / }).map((i) => i.getAttribute('aria-label').replace('Name for ', ''))

describe('custom header stats', () => {
  it('quick pick EMA 21 → Add to header: stored, placed last, listed by its chart name', async () => {
    const spy = vi.fn()
    render(<Host initial={mergeChartSettings(null)} spy={spy} />)
    openHeader()
    openPicker()
    const picker = screen.getByRole('region', { name: 'Info row stats' })
    fireEvent.click(within(within(picker).getByRole('group', { name: 'Custom' })).getByRole('button', { name: /Custom stat/ }))
    const builder = await screen.findByRole('region', { name: 'Custom stat' })
    expect(document.querySelector('[data-chart-settings-popout]'), 'no portalled popout').toBeNull()
    fireEvent.click(within(builder).getByRole('button', { name: 'EMA 21' }))
    const setup = screen.getByRole('region', { name: 'Custom stat' })
    expect(within(setup).getAllByRole('spinbutton')[0].value).toBe('21')
    expect(within(setup).getByText('EMA 21', { selector: 'b' })).toBeTruthy()
    fireEvent.click(within(setup).getByRole('button', { name: /Add to header/ }))
    const h = spy.mock.lastCall[0].header
    expect(h.fields).toEqual(['mcap', 'earn', 'cx:c1'])
    expect(h.customStats).toEqual([{ id: 'c1', defId: 'movingAverage', plotKey: 'ma', inputs: { maType: 'ema', period: 21 }, name: 'EMA 21' }])
    // back on the picker: the Custom group lists it, ticked; untick removes it
    const p2 = screen.getByRole('region', { name: 'Info row stats' })
    const box = within(p2).getByRole('checkbox', { name: 'EMA 21' })
    expect(box.getAttribute('aria-checked')).toBe('true')
    expect(within(p2).getByText('3 shown')).toBeTruthy()
    fireEvent.click(within(p2).getByRole('button', { name: 'Done' }))
    expect(names()).toEqual(['Market Cap', 'Next Earnings', 'EMA 21'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove EMA 21' }))
    const h2 = spy.mock.lastCall[0].header
    expect(h2.fields).toEqual(['mcap', 'earn'])
    expect(h2.customStats).toEqual([])
  })

  it('choose any indicator, change its period: the name follows; an out-of-range period cannot be added', async () => {
    const spy = vi.fn()
    render(<Host initial={mergeChartSettings(JSON.stringify({ header: { fields: ['mcap'] } }))} spy={spy} />)
    openHeader()
    openPicker()
    fireEvent.click(within(screen.getByRole('group', { name: 'Custom' })).getByRole('button', { name: /Custom stat/ }))
    const builder = await screen.findByRole('region', { name: 'Custom stat' })
    fireEvent.change(within(builder).getByRole('textbox', { name: 'Find an indicator' }), { target: { value: 'average true' } })
    fireEvent.click(within(builder).getByRole('button', { name: 'Average True Range' }))
    const setup = screen.getByRole('region', { name: 'Custom stat' })
    const len = within(setup).getAllByRole('spinbutton')[0]
    fireEvent.change(len, { target: { value: '0' } })
    expect(within(setup).getByRole('button', { name: /Add to header/ }).disabled).toBe(true)
    fireEvent.change(len, { target: { value: '10' } })
    expect(within(setup).getByText(/ATR 10/, { selector: 'b' })).toBeTruthy()
    fireEvent.click(within(setup).getByRole('button', { name: /Add to header/ }))
    expect(spy.mock.lastCall[0].header.customStats[0]).toMatchObject({ defId: 'atr', plotKey: 'atr', inputs: { period: 10 } })
    expect(spy.mock.lastCall[0].header.fields).toEqual(['mcap', 'cx:c1'])
  })

  it('indicators that are not one number per bar are not offered (server RS, data series)', async () => {
    render(<Host initial={mergeChartSettings(null)} />)
    openHeader()
    openPicker()
    fireEvent.click(within(screen.getByRole('group', { name: 'Custom' })).getByRole('button', { name: /Custom stat/ }))
    const builder = await screen.findByRole('region', { name: 'Custom stat' })
    expect(builder.querySelector('[data-custom-def="rsLine"]')).toBeNull()
    expect(builder.querySelector('[data-custom-def="dataSeries"]')).toBeNull()
    expect(builder.querySelector('[data-custom-def="rsi"]')).toBeTruthy()
  })

  it('Reset to UCT default drops custom stats with the rest', () => {
    const spy = vi.fn()
    const h = { fields: ['mcap', 'cx:c1'], customStats: [{ id: 'c1', defId: 'rsi', plotKey: 'rsi', inputs: { period: 14 }, name: 'RSI 14' }], colors: { 'cx:c1': '#abcdef' } }
    render(<Host initial={mergeChartSettings(JSON.stringify({ header: h }))} spy={spy} />)
    openHeader()
    expect(names()).toEqual(['Market Cap', 'RSI 14'])
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to UCT default' }))
    const next = spy.mock.lastCall[0].header
    expect('customStats' in next).toBe(false)
    expect(next.colors && next.colors['cx:c1']).toBeUndefined()
  })

  it('a stat row Aa button edits the same look the header menu edits: size, box', () => {
    const spy = vi.fn()
    render(<Host initial={mergeChartSettings(JSON.stringify({ header: { fields: ['mcap', 'earn'] } }))} spy={spy} />)
    openHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Style Market Cap' }))
    const line = screen.getByRole('group', { name: 'Market Cap style' })
    fireEvent.click(within(line).getByRole('button', { name: 'Market Cap size L' }))
    expect(spy.mock.lastCall[0].header.statStyle).toEqual({ mcap: { size: 'l' } })
    fireEvent.click(within(line).getByRole('switch', { name: 'Market Cap shaded box' }))
    expect(spy.mock.lastCall[0].header.statStyle).toEqual({ mcap: { size: 'l', box: true } })
    fireEvent.click(within(line).getByRole('button', { name: 'Market Cap size M' }))
    expect(spy.mock.lastCall[0].header.statStyle).toEqual({ mcap: { box: true } })
  })

  it('opened from a header stat menu (Add an indicator value): Header & legend, on the custom-stat page', async () => {
    render(<ChartSettingsModal open settings={mergeChartSettings(null)} onChange={() => {}} scrollTo="header:custom" />)
    expect(await screen.findByRole('textbox', { name: 'Find an indicator' })).toBeTruthy()
  })
})

