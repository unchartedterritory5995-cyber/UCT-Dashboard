import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'

// "Soon" rows (owner 11-15, the approved Chart Settings Lab): settings the chart cannot do yet are
// shown visible-but-disabled with a small "Soon" tag. They must write NOTHING — not from the control,
// not from a whole-row click, not from a swatch — and must stay out of UCT Agent's reach.

const base = () => mergeChartSettings(JSON.stringify({}))
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }))

// Every Soon control, by the accessible name it carries (each ends "(coming soon)").
const SOON = {
  'Price style': [
    'Show body (coming soon)', 'Show borders (coming soon)', 'Show wick (coming soon)',
    'Last price line (coming soon)', 'Last price line style: Dashed (coming soon)',
    'Price label on the scale (coming soon)',
  ],
  Canvas: [
    'Shade pre / post-market (coming soon)', 'Grid lines: Both (coming soon)', 'Session breaks (coming soon)',
    'Right margin (coming soon)', 'Time zone: Exchange (New York) (coming soon)',
    'Time format: 12-hour (coming soon)', 'Price decimals: Auto (coming soon)',
  ],
  Markers: [
    'Next earnings date (coming soon)', 'Pre-market high & low (coming soon)',
    'My trades (coming soon)', 'Price alerts (coming soon)',
  ],
}
const SIDEBAR = 'Apply to all charts (coming soon)'

const soonControls = () => [...document.body.querySelectorAll('[aria-label$="(coming soon)"]')]

const expectInert = (el) => {
  const name = el.getAttribute('aria-label')
  expect(el.disabled, `${name}: not disabled`).toBe(true)
  expect(el.getAttribute('aria-disabled'), `${name}: no aria-disabled`).toBe('true')
  expect(el.title, `${name}: no tooltip`).toBe('Coming soon')
  expect(el.getAttribute('role'), `${name}: a Soon control must not be a switch`).not.toBe('switch')
  expect(el.hasAttribute('data-guide'), `${name}: a Soon control must not be an Agent target`).toBe(false)
}

describe('ChartSettingsModal — Soon rows', () => {
  for (const [tab, names] of Object.entries(SOON)) {
    it(`${tab}: every Soon control renders, tagged, disabled, and with no Agent handle`, () => {
      render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
      openTab(tab)
      const found = soonControls().map((el) => el.getAttribute('aria-label')).sort()
      expect(found).toEqual([...names, SIDEBAR].sort())
      for (const el of soonControls()) {
        expectInert(el)
        const desc = document.getElementById(el.getAttribute('aria-describedby') || '')
        if (el.getAttribute('aria-haspopup') !== 'listbox') expect(desc?.textContent).toBe('Coming soon')
        // the row it sits in carries the tag
        const row = el.closest('[data-soon], [data-soon-part]')
        expect(row, `${el.getAttribute('aria-label')}: not inside a Soon row`).toBeTruthy()
        expect(within(row).getByText('Soon')).toBeTruthy()
      }
      for (const row of document.body.querySelectorAll('[data-soon]')) {
        expect(row.title).toBe('Coming soon')
        expect(row.querySelector('[role="switch"], [data-guide], [data-color-swatch]')).toBeNull()
      }
    })

    it(`${tab}: clicking a Soon control, its row, its label or its swatch writes nothing`, () => {
      const onChange = vi.fn()
      render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
      openTab(tab)
      for (const el of soonControls()) fireEvent.click(el)
      for (const row of document.body.querySelectorAll('[data-soon], [data-soon-part]')) {
        fireEvent.click(row)
        fireEvent.click(row.firstElementChild)        // the label
        for (const sw of row.querySelectorAll('[class*="soonSwatch"]')) fireEvent.click(sw)
      }
      expect(onChange).not.toHaveBeenCalled()
      expect(document.body.querySelector('[data-color-panel]')).toBeNull()
      expect(screen.queryByRole('listbox')).toBeNull()
    })
  }

  it('Body / Borders / Wick keep their live colour swatches beside the Soon square', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openTab('Price style')
    fireEvent.click(screen.getByTitle('Body Up'))
    expect(document.body.querySelector('[data-color-panel]')).toBeTruthy()
  })

  it('the working rows beside the Soon rows still write (countdown, show grid lines)', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openTab('Price style')
    fireEvent.click(screen.getByRole('switch', { name: /Countdown to bar close/i }))
    expect(onChange.mock.calls.at(-1)[0].countdown).toBe(true)
    openTab('Canvas')
    fireEvent.click(screen.getByRole('switch', { name: 'Show grid lines' }))
    expect(onChange.mock.calls.at(-1)[0].grid.visible).toBe(false)
  })

  it('the sidebar "Apply to all charts" row is a Soon checkbox that writes nothing', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    const box = screen.getByRole('button', { name: SIDEBAR })
    expectInert(box)
    const row = box.closest('[data-soon]')
    expect(within(row).getByText('Soon')).toBeTruthy()
    fireEvent.click(box); fireEvent.click(row)
    expect(onChange).not.toHaveBeenCalled()
  })
})
