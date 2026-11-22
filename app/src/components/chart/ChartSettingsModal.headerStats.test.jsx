// app/src/components/chart/ChartSettingsModal.headerStats.test.jsx — Header & legend → the info row stat picker and
// rename (owner 11-16, Release 1). The picker is an inline sub-page of the section (never a portal / global modal).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { HEADER_STATS } from './headerStatCatalog'
import { _resetIndicatorHistoryForTests } from './indicatorHistoryStore'

beforeEach(() => { _resetIndicatorHistoryForTests(); try { window.sessionStorage.clear() } catch { /* jsdom */ } })

// A stateful host, so a sequence of edits lands like it does on /charts.
function Host({ initial, spy }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={(n) => { spy?.(n); setCs(n) }} />
}
const openHeader = () => fireEvent.click(screen.getByRole('tab', { name: 'Header & legend' }))
const openPicker = () => fireEvent.click(screen.getByRole('button', { name: /Choose stats/ }))
const picker = () => screen.getByRole('region', { name: 'Info row stats' })
const THREE = mergeChartSettings(JSON.stringify({ header: { fields: ['mcap', 'earn', 'pe'] } }))
const names = () => screen.getAllByRole('textbox', { name: /^Name for / }).map((i) => i.getAttribute('aria-label').replace('Name for ', ''))

describe('Header & legend → stats beside the ticker', () => {
  it('an untouched chart lists today\'s row and "2 shown" (UCT Rating retired 11-17)', () => {
    render(<Host initial={mergeChartSettings(null)} />)
    openHeader()
    expect(names()).toEqual(['Market Cap', 'Next Earnings'])
    expect(screen.getByText('2 shown')).toBeTruthy()
  })

  it('the picker opens inside the window: grouped, every stat, soft squares, count; search filters', () => {
    render(<Host initial={mergeChartSettings(null)} />)
    openHeader()
    openPicker()
    const p = picker()
    expect(document.querySelector('[data-chart-settings-popout]'), 'no portalled popout').toBeNull()
    const boxes = within(p).getAllByRole('checkbox')
    expect(boxes).toHaveLength(HEADER_STATS.length)
    expect(boxes.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent).sort()).toEqual(['Market Cap', 'Next Earnings'])
    expect(within(p).getByRole('group', { name: 'Fundamentals' })).toBeTruthy()
    expect(within(p).getByText('2 shown')).toBeTruthy()
    fireEvent.change(within(p).getByRole('textbox', { name: 'Find a stat' }), { target: { value: 'short' } })
    const hits = within(p).getAllByRole('checkbox').map((b) => b.textContent)
    expect(hits).toContain('Short % of Float')
    expect(hits).not.toContain('Market Cap')
    fireEvent.change(within(p).getByRole('textbox', { name: 'Find a stat' }), { target: { value: 'zzzz' } })
    expect(within(p).getByText(/No stat matches/)).toBeTruthy()
  })

  it('toggle adds to the end and removes; the count follows; Done returns to the list', () => {
    const spy = vi.fn()
    render(<Host initial={mergeChartSettings(null)} spy={spy} />)
    openHeader()
    openPicker()
    fireEvent.click(within(picker()).getByRole('checkbox', { name: 'P/E' }))
    expect(spy.mock.lastCall[0].header.fields).toEqual(['mcap', 'earn', 'pe'])
    expect(within(picker()).getByText('3 shown')).toBeTruthy()
    fireEvent.click(within(picker()).getByRole('checkbox', { name: 'Next Earnings' }))
    expect(spy.mock.lastCall[0].header.fields).toEqual(['mcap', 'pe'])
    fireEvent.click(within(picker()).getByRole('button', { name: 'Done' }))
    expect(names()).toEqual(['Market Cap', 'P/E'])
  })

  it('reorder with ↑ / ↓; remove with ✕', () => {
    const spy = vi.fn()
    render(<Host initial={THREE} spy={spy} />)
    openHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Move P/E up' }))
    expect(spy.mock.lastCall[0].header.fields).toEqual(['mcap', 'pe', 'earn'])
    fireEvent.click(screen.getByRole('button', { name: 'Move Market Cap down' }))
    expect(spy.mock.lastCall[0].header.fields).toEqual(['pe', 'mcap', 'earn'])
    expect(screen.getByRole('button', { name: 'Move P/E up' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Market Cap' }))
    expect(spy.mock.lastCall[0].header.fields).toEqual(['pe', 'earn'])
    expect(names()).toEqual(['P/E', 'Next Earnings'])
  })

  it('drag the grip onto another row moves it there', () => {
    const spy = vi.fn()
    render(<Host initial={THREE} spy={spy} />)
    const container = document.body   // the window is portalled to <body>
    openHeader()
    const grip = container.querySelector('[data-stat-row="pe"] [draggable="true"]')
    fireEvent.dragStart(grip)
    fireEvent.dragOver(container.querySelector('[data-stat-row="mcap"]'))
    fireEvent.drop(container.querySelector('[data-stat-row="mcap"]'))
    expect(spy.mock.lastCall[0].header.fields).toEqual(['pe', 'mcap', 'earn'])
  })

  it('rename: a short custom label (capped at 16); empty or the own name clears it', () => {
    const spy = vi.fn()
    render(<Host initial={mergeChartSettings(null)} spy={spy} />)
    openHeader()
    const input = screen.getByRole('textbox', { name: 'Name for Market Cap' })
    fireEvent.change(input, { target: { value: '  Cap  ' } })
    fireEvent.blur(input)
    expect(spy.mock.lastCall[0].header.statLabels).toEqual({ mcap: 'Cap' })
    expect(screen.getByRole('textbox', { name: 'Name for Market Cap' }).value).toBe('Cap')
    const again = screen.getByRole('textbox', { name: 'Name for Market Cap' })
    fireEvent.change(again, { target: { value: 'A very long custom name' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    fireEvent.blur(again)
    expect(spy.mock.lastCall[0].header.statLabels.mcap).toHaveLength(16)
    const third = screen.getByRole('textbox', { name: 'Name for Market Cap' })
    fireEvent.change(third, { target: { value: '' } })
    fireEvent.blur(third)
    expect(spy.mock.lastCall[0].header.statLabels).toEqual({})
    expect(screen.getByRole('textbox', { name: 'Name for Market Cap' }).value).toBe('Market Cap')
    const n = spy.mock.calls.length
    fireEvent.blur(screen.getByRole('textbox', { name: 'Name for Market Cap' }))
    expect(spy.mock.calls.length, 'a blur with no change writes nothing').toBe(n)
  })

  it('the picker\'s "Reset to UCT default" puts back today\'s row and drops renames', () => {
    const spy = vi.fn()
    const cs = mergeChartSettings(JSON.stringify({ header: { fields: ['pe', 'gap'], statLabels: { pe: 'PE' }, timeframes: ['D'] } }))
    render(<Host initial={cs} spy={spy} />)
    openHeader()
    expect(names()).toEqual(['P/E', 'Gap %'])
    openPicker()
    fireEvent.click(within(picker()).getByRole('button', { name: 'Reset to UCT default' }))
    const h = spy.mock.lastCall[0].header
    expect('fields' in h).toBe(false)
    expect('statLabels' in h).toBe(false)
    expect(h.timeframes).toEqual(['D'])
  })

  it('"Reset this section" resets selection, order and labels (timeframe favourites stay)', () => {
    const spy = vi.fn()
    const cs = mergeChartSettings(JSON.stringify({ header: { fields: ['pe', 'gap'], statLabels: { pe: 'PE' }, timeframes: ['D'] } }))
    render(<Host initial={cs} spy={spy} />)
    openHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Reset Header & legend to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Header & legend to UCT default' }))
    const h = spy.mock.lastCall[0].header
    expect(h.fields).toBeUndefined()
    expect(h.statLabels).toBeUndefined()
    expect(h.timeframes).toEqual(['D'])
    expect(names()).toEqual(['Market Cap', 'Next Earnings'])
  })

  it('leaving the section closes the picker', () => {
    render(<Host initial={mergeChartSettings(null)} />)
    openHeader()
    openPicker()
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }))
    openHeader()
    expect(screen.queryByRole('region', { name: 'Info row stats' })).toBeNull()
  })
})
