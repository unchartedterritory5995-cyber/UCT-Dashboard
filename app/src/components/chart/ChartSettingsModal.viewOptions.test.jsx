// The seven Chart Settings rows that were "Soon" (owner 11-15, turn 7), now real: each control writes its key,
// shows today's look when the key is absent, and "Reset this section" puts it back.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

const base = () => mergeChartSettings(JSON.stringify({}))
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }))
const last = (fn) => fn.mock.calls.at(-1)[0]
const pick = (menu, option) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${menu}:`) }))
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${option}`) }))
}
const sw = (name) => screen.getByRole('switch', { name })

describe('Chart Settings — the rows that were Soon are live', () => {
  it('no Price style or Canvas control is Soon any more (11-16: shading and time zone became real too)', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    const soon = () => [...document.body.querySelectorAll('[aria-label$="(coming soon)"]')].map(el => el.getAttribute('aria-label')).filter(l => !/Apply to all/.test(l))
    expect(soon()).toEqual([])
    openTab('Canvas')
    expect(soon()).toEqual([])
  })

  it('an untouched chart shows today\'s look on every new control', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    for (const n of ['Show body', 'Show borders', 'Show wick', 'Price label on the scale']) {
      expect(sw(n).getAttribute('aria-checked'), n).toBe('true')
    }
    // /charts panes never drew the last-price line (PANE_LOOK.hidePriceLine), so untouched = OFF (owner test 11-16)
    expect(sw('Last price line').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('button', { name: /^Last price line style:/ })).toBeNull()
    openTab('Canvas')
    expect(screen.getByRole('button', { name: /^Grid lines:/ }).getAttribute('aria-label')).toBe('Grid lines: Both')
    expect(screen.getByRole('button', { name: /^Time format:/ }).getAttribute('aria-label')).toBe('Time format: 12-hour')
    expect(screen.getByRole('button', { name: /^Price decimals:/ }).getAttribute('aria-label')).toBe('Price decimals: Auto')
    expect(screen.getByRole('slider', { name: 'Right margin' }).getAttribute('aria-valuetext')).toBe('Auto')
    expect(screen.queryByRole('button', { name: 'Auto' }), 'no "back to Auto" while already Auto').toBeNull()
  })

  it('Body / Borders / Wick write candles.showBody / showBorders / showWick', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    fireEvent.click(sw('Show body')); expect(last(onChange).candles.showBody).toBe(false)
    fireEvent.click(sw('Show borders')); expect(last(onChange).candles.showBorders).toBe(false)
    fireEvent.click(sw('Show wick')); expect(last(onChange).candles.showWick).toBe(false)
    // the colours beside them are untouched
    expect(last(onChange).candles.upColor).toBe(CHART_DEFAULTS.candles.upColor)
  })

  it('an off part reads off, and turning it back on writes true', () => {
    const onChange = vi.fn()
    const cs = mergeChartSettings(JSON.stringify({ candles: { showWick: false } }))
    render(<ChartSettingsModal open settings={cs} onChange={onChange} />)
    expect(sw('Show wick').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw('Show wick'))
    expect(last(onChange).candles.showWick).toBe(true)
  })

  it('Last price line: on/off + style; Price label on the scale writes showPriceLabels', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    fireEvent.click(sw('Last price line'))
    expect(last(onChange).candles.priceLine).toBe(true)
    rerender(<ChartSettingsModal open settings={last(onChange)} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /^Last price line style:/ }).getAttribute('aria-label')).toBe('Last price line style: Dashed')
    pick('Last price line style', 'Dotted')
    expect(last(onChange).candles.priceLineStyle).toBe('dotted')
    rerender(<ChartSettingsModal open settings={last(onChange)} onChange={onChange} />)
    fireEvent.click(sw('Last price line'))
    expect(last(onChange).candles.priceLine).toBe(false)
    fireEvent.click(sw('Price label on the scale'))
    expect(last(onChange).showPriceLabels).toBe(false)
  })

  it('the line style hides while the price line is off', () => {
    render(<ChartSettingsModal open settings={mergeChartSettings(JSON.stringify({ candles: { priceLine: false } }))} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Last price line style:/ })).toBeNull()
  })

  it('Grid → Lines: Off writes visible:false; Horizontal / Vertical keep it on with grid.lines; Both drops the key', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Canvas')
    pick('Grid lines', 'Horizontal')
    expect(last(onChange).grid).toMatchObject({ visible: true, lines: 'horizontal' })
    rerender(<ChartSettingsModal open settings={last(onChange)} onChange={onChange} />)
    pick('Grid lines', 'Off')
    expect(last(onChange).grid.visible).toBe(false)
    // an old blob's grid.visible:false reads as Off; picking Both turns it on with no `lines` key
    rerender(<ChartSettingsModal open settings={mergeChartSettings(JSON.stringify({ grid: { visible: false } }))} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /^Grid lines:/ }).getAttribute('aria-label')).toBe('Grid lines: Off')
    expect(screen.queryByTitle('Grid')).toBeNull()       // no line colour while Off
    pick('Grid lines', 'Both')
    expect(last(onChange).grid.visible).toBe(true)
    expect('lines' in last(onChange).grid).toBe(false)
  })

  it('Right margin slider writes scaleTime.rightMargin; Auto removes it', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.change(screen.getByRole('slider', { name: 'Right margin' }), { target: { value: '12' } })
    expect(last(onChange).scaleTime).toEqual({ rightMargin: 12 })
    rerender(<ChartSettingsModal open settings={mergeChartSettings(JSON.stringify(last(onChange)))} onChange={onChange} />)
    expect(screen.getByText('12 bars')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    expect(last(onChange).scaleTime).toEqual({})
    expect(mergeChartSettings(JSON.stringify(last(onChange))).scaleTime).toBeUndefined()
  })

  it('Time format and Price decimals write scaleTime; 12-hour and Auto remove their field', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Canvas')
    pick('Time format', '24-hour')
    expect(last(onChange).scaleTime).toEqual({ timeFormat: '24' })
    rerender(<ChartSettingsModal open settings={last(onChange)} onChange={onChange} />)
    pick('Price decimals', '3')
    expect(last(onChange).scaleTime).toEqual({ timeFormat: '24', priceDecimals: 3 })
    rerender(<ChartSettingsModal open settings={last(onChange)} onChange={onChange} />)
    pick('Price decimals', 'Auto')
    expect(last(onChange).scaleTime).toEqual({ timeFormat: '24' })
    rerender(<ChartSettingsModal open settings={last(onChange)} onChange={onChange} />)
    pick('Time format', '12-hour')
    expect(last(onChange).scaleTime).toEqual({})
  })

  it('Reset this section puts the new keys back (Price style: candles + price label; Canvas: grid + scaleTime)', () => {
    const member = mergeChartSettings(JSON.stringify({
      candles: { showBody: false, showWick: false, priceLine: false, priceLineStyle: 'solid' },
      showPriceLabels: false,
      grid: { visible: true, lines: 'vertical' },
      scaleTime: { rightMargin: 2, priceDecimals: 0, timeFormat: '24' },
    }))
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={member} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset Price style to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Price style to UCT default' }))
    const p = last(onChange)
    expect(p.candles).toEqual(CHART_DEFAULTS.candles)
    expect(p.showPriceLabels).toBe(CHART_DEFAULTS.showPriceLabels)
    expect(p.scaleTime, 'Canvas was touched').toEqual(member.scaleTime)
    rerender(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Canvas to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Canvas to UCT default' }))
    const c = last(onChange)
    expect(c.grid).toEqual(CHART_DEFAULTS.grid)
    expect('scaleTime' in c).toBe(false)
    expect(c.candles.showBody, 'Price style was touched').toBe(false)
  })
})

// The next two Soon rows (owner 11-15): Session breaks (Canvas → Grid) and Pre-market high & low (Markers →
// Previous-day levels). Top-level booleans, absent = OFF = today's look.
describe('Chart Settings — Session breaks + Pre-market high & low are live', () => {
  it('an untouched chart shows both OFF, as real switches (no Soon tag)', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openTab('Canvas')
    expect(sw('Session breaks').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByLabelText('Session breaks (coming soon)')).toBeNull()
    openTab('Markers')
    expect(sw('Pre-market high & low').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByLabelText('Pre-market high & low (coming soon)')).toBeNull()
  })

  it('Session breaks writes sessionBreaks; off drops it from the merged blob', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(sw('Session breaks'))
    expect(last(onChange).sessionBreaks).toBe(true)
    expect(last(onChange).preset).toBe('custom')
    const on = mergeChartSettings(JSON.stringify(last(onChange)))
    expect(on.sessionBreaks).toBe(true)
    rerender(<ChartSettingsModal open settings={on} onChange={onChange} />)
    expect(sw('Session breaks').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw('Session breaks'))
    expect(last(onChange).sessionBreaks).toBe(false)
    expect('sessionBreaks' in mergeChartSettings(JSON.stringify(last(onChange)))).toBe(false)
  })

  it('Pre-market high & low writes preMarketLevels; off drops it from the merged blob', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Markers')
    fireEvent.click(sw('Pre-market high & low'))
    expect(last(onChange).preMarketLevels).toBe(true)
    const on = mergeChartSettings(JSON.stringify(last(onChange)))
    expect(on.preMarketLevels).toBe(true)
    rerender(<ChartSettingsModal open settings={on} onChange={onChange} />)
    expect(sw('Pre-market high & low').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw('Pre-market high & low'))
    expect(last(onChange).preMarketLevels).toBe(false)
    expect('preMarketLevels' in mergeChartSettings(JSON.stringify(last(onChange)))).toBe(false)
  })

  it('Reset this section clears them (Canvas: sessionBreaks; Markers: preMarketLevels), and only in their section', () => {
    const member = mergeChartSettings(JSON.stringify({ sessionBreaks: true, preMarketLevels: true }))
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Canvas to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Canvas to UCT default' }))
    expect('sessionBreaks' in last(onChange)).toBe(false)
    expect(last(onChange).preMarketLevels, 'Markers was touched').toBe(true)
    rerender(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Markers')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Markers to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Markers to UCT default' }))
    expect('preMarketLevels' in last(onChange)).toBe(false)
    expect(last(onChange).sessionBreaks, 'Canvas was touched').toBe(true)
  })
})

// The next Soon row (owner 11-16): Markers → Events → Next earnings date. Top-level boolean `nextEarningsMarker`,
// absent = OFF = today's look. The chip itself: nextEarningsMark.test.js.
describe('Chart Settings — Next earnings date is live', () => {
  it('an untouched chart shows it OFF, as a real switch (no Soon tag)', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openTab('Markers')
    expect(sw('Next earnings date').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByLabelText('Next earnings date (coming soon)')).toBeNull()
    expect('nextEarningsMarker' in CHART_DEFAULTS).toBe(false)
    expect('nextEarningsMarker' in base()).toBe(false)
  })

  it('writes nextEarningsMarker; off drops it from the merged blob', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Markers')
    fireEvent.click(sw('Next earnings date'))
    expect(last(onChange).nextEarningsMarker).toBe(true)
    expect(last(onChange).preset).toBe('custom')
    const on = mergeChartSettings(JSON.stringify(last(onChange)))
    expect(on.nextEarningsMarker).toBe(true)
    rerender(<ChartSettingsModal open settings={on} onChange={onChange} />)
    expect(sw('Next earnings date').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw('Next earnings date'))
    expect(last(onChange).nextEarningsMarker).toBe(false)
    expect('nextEarningsMarker' in mergeChartSettings(JSON.stringify(last(onChange)))).toBe(false)
    for (const v of ['yes', 1, null, {}]) expect('nextEarningsMarker' in mergeChartSettings(JSON.stringify({ nextEarningsMarker: v })), String(v)).toBe(false)
  })

  it('Reset Markers clears it; Reset Canvas does not', () => {
    const member = mergeChartSettings(JSON.stringify({ nextEarningsMarker: true }))
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Canvas to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Canvas to UCT default' }))
    expect(last(onChange).nextEarningsMarker, 'Canvas reset touched Markers').toBe(true)
    rerender(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Markers')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Markers to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Markers to UCT default' }))
    expect('nextEarningsMarker' in last(onChange)).toBe(false)
  })
})

// (owner 11-16) Markers → Your activity → Price alerts. Top-level boolean `priceAlertLines`, absent = OFF = today's look
// (the chart drew no alert lines before). The lines themselves: priceAlertLines.test.js.
describe('Chart Settings — Price alerts is live', () => {
  it('an untouched chart shows it OFF, as a real switch (no Soon tag)', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openTab('Markers')
    expect(sw('Price alerts').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByLabelText('Price alerts (coming soon)')).toBeNull()
    expect('priceAlertLines' in CHART_DEFAULTS).toBe(false)
    expect('priceAlertLines' in base()).toBe(false)
  })

  it('writes priceAlertLines; off drops it from the merged blob', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Markers')
    fireEvent.click(sw('Price alerts'))
    expect(last(onChange).priceAlertLines).toBe(true)
    expect(last(onChange).preset).toBe('custom')
    const on = mergeChartSettings(JSON.stringify(last(onChange)))
    expect(on.priceAlertLines).toBe(true)
    rerender(<ChartSettingsModal open settings={on} onChange={onChange} />)
    expect(sw('Price alerts').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw('Price alerts'))
    expect(last(onChange).priceAlertLines).toBe(false)
    expect('priceAlertLines' in mergeChartSettings(JSON.stringify(last(onChange)))).toBe(false)
    for (const v of ['yes', 1, null, {}]) expect('priceAlertLines' in mergeChartSettings(JSON.stringify({ priceAlertLines: v })), String(v)).toBe(false)
  })

  it('Reset Markers clears it; Reset Canvas does not', () => {
    const member = mergeChartSettings(JSON.stringify({ priceAlertLines: true }))
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Canvas to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Canvas to UCT default' }))
    expect(last(onChange).priceAlertLines, 'Canvas reset touched Markers').toBe(true)
    rerender(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Markers')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Markers to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Markers to UCT default' }))
    expect('priceAlertLines' in last(onChange)).toBe(false)
  })
})

// (owner 11-16) The last two Canvas Soon rows. Shade pre / post-market is the EXISTING per-chart
// `extendedHoursShading` (the toolbar's "Extended hours"); Time zone is `scaleTime.timeZone`, absent = New York.
describe('Chart Settings — Shade pre / post-market is the existing Extended hours switch', () => {
  it('reads the merged default (ON) as a real switch, no Soon tag, and no new key', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openTab('Canvas')
    expect(sw('Shade pre / post-market').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByLabelText('Shade pre / post-market (coming soon)')).toBeNull()
  })

  it('writes extendedHoursShading both ways, and reads a chart whose toolbar turned it off', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(sw('Shade pre / post-market'))
    expect(last(onChange).extendedHoursShading).toBe(false)
    expect(last(onChange).preset).toBe('custom')
    const off = mergeChartSettings(JSON.stringify(last(onChange)))
    expect(off.extendedHoursShading).toBe(false)
    rerender(<ChartSettingsModal open settings={off} onChange={onChange} />)
    expect(sw('Shade pre / post-market').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw('Shade pre / post-market'))
    expect(last(onChange).extendedHoursShading).toBe(true)
  })

  it('is per-chart: Reset Canvas leaves it alone', () => {
    const member = mergeChartSettings(JSON.stringify({ extendedHoursShading: false }))
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Canvas to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Canvas to UCT default' }))
    expect(last(onChange).extendedHoursShading).toBe(false)
  })
})

describe('Chart Settings — Time zone is live', () => {
  it('an untouched chart reads Exchange (New York), as a real menu', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openTab('Canvas')
    expect(screen.getByRole('button', { name: /^Time zone:/ }).getAttribute('aria-label')).toBe('Time zone: Exchange (New York)')
  })

  it('offers the ten zones; a pick writes scaleTime.timeZone beside the time format; Exchange removes it', () => {
    const onChange = vi.fn()
    const member = mergeChartSettings(JSON.stringify({ scaleTime: { timeFormat: '24' } }))
    const { rerender } = render(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('button', { name: /^Time zone:/ }))
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    for (const z of ['Exchange (New York)', 'Local (browser)', 'UTC', 'Chicago', 'Los Angeles', 'London', 'Frankfurt', 'Tokyo', 'Hong Kong', 'Sydney']) {
      expect(names.some((n) => n.startsWith(z)), z).toBe(true)
    }
    fireEvent.click(screen.getByRole('option', { name: /^London/ }))
    expect(last(onChange).scaleTime).toEqual({ timeFormat: '24', timeZone: 'london' })
    const set = mergeChartSettings(JSON.stringify(last(onChange)))
    expect(set.scaleTime).toEqual({ timeFormat: '24', timeZone: 'london' })
    rerender(<ChartSettingsModal open settings={set} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /^Time zone:/ }).getAttribute('aria-label')).toBe('Time zone: London')
    pick('Time zone', 'Exchange')
    expect(last(onChange).scaleTime).toEqual({ timeFormat: '24' })
  })

  it('Reset Canvas removes it with the rest of scaleTime', () => {
    const member = mergeChartSettings(JSON.stringify({ scaleTime: { timeZone: 'tokyo' } }))
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Canvas to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Canvas to UCT default' }))
    expect('scaleTime' in last(onChange)).toBe(false)
  })
})

// (owner 11-16) Markers → Your activity → My trades — the LAST Markers Soon row. Top-level boolean `myTradeMarkers`,
// absent = OFF = today's look (a /charts chart drew no trades before). The markers themselves: myTradeMarkers.test.jsx.
describe('Chart Settings — My trades is live', () => {
  it('an untouched chart shows it OFF, as a real switch (no Soon tag), and Markers has no Soon row left', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openTab('Markers')
    expect(sw('My trades').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByLabelText('My trades (coming soon)')).toBeNull()
    expect(document.body.querySelectorAll('[aria-label$="(coming soon)"]').length).toBe(0)
    expect(document.body.querySelectorAll('[data-soon]').length).toBe(0)
    expect('myTradeMarkers' in CHART_DEFAULTS).toBe(false)
    expect('myTradeMarkers' in base()).toBe(false)
  })

  it('writes myTradeMarkers; off drops it from the merged blob', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Markers')
    fireEvent.click(sw('My trades'))
    expect(last(onChange).myTradeMarkers).toBe(true)
    expect(last(onChange).preset).toBe('custom')
    const on = mergeChartSettings(JSON.stringify(last(onChange)))
    expect(on.myTradeMarkers).toBe(true)
    rerender(<ChartSettingsModal open settings={on} onChange={onChange} />)
    expect(sw('My trades').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw('My trades'))
    expect(last(onChange).myTradeMarkers).toBe(false)
    expect('myTradeMarkers' in mergeChartSettings(JSON.stringify(last(onChange)))).toBe(false)
    for (const v of ['yes', 1, null, {}]) expect('myTradeMarkers' in mergeChartSettings(JSON.stringify({ myTradeMarkers: v })), String(v)).toBe(false)
  })

  it('Reset Markers clears it; Reset Canvas does not', () => {
    const member = mergeChartSettings(JSON.stringify({ myTradeMarkers: true }))
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Canvas to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Canvas to UCT default' }))
    expect(last(onChange).myTradeMarkers, 'Canvas reset touched Markers').toBe(true)
    rerender(<ChartSettingsModal open settings={member} onChange={onChange} />)
    openTab('Markers')
    fireEvent.click(screen.getByRole('button', { name: 'Reset Markers to UCT default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: reset Markers to UCT default' }))
    expect('myTradeMarkers' in last(onChange)).toBe(false)
  })
})
