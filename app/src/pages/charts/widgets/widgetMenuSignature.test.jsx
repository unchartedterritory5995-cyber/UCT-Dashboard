// UCT Signature widget settings menus (owner 11-15): choices are ChoiceMenu dropdowns, on/off is
// the soft-square switch and the WHOLE ROW toggles it — without changing any setting's key/value.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'

vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {} }) }))

import WatchlistSettingsPanel from '../../watchlist/WatchlistSettingsPanel'
import { WATCHLIST_DEFAULTS } from '../../watchlist/watchlistSettings'
import NewsSettingsPanel from './NewsSettingsPanel'
import NhnlSettingsPanel from './NhnlSettingsPanel'
import BreadthSettingsPanel from './BreadthSettingsPanel'

afterEach(cleanup)

// a widget frame to sit beside — without one the menu stays hidden until it is placed
const host = () => { const el = document.createElement('div'); document.body.appendChild(el); return el }

const NEWS_SETTINGS = { bgMode: 'solid', bg: '#111111', bgGradient: { top: '#111111', bottom: '#222222' }, textColor: '#eeeeee', density: 'comfortable', highlightNew: 'off' }
const NEWS_SECTIONS = [{ label: 'Display', rows: [
  { key: 'density', label: 'Density', type: 'segmented', options: [{ key: 'compact', label: 'Compact' }, { key: 'comfortable', label: 'Comfortable' }] },
  { key: 'highlightNew', label: 'Highlight new', type: 'segmented', options: [{ key: 'on', label: 'On' }, { key: 'off', label: 'Off' }] },
] }]

describe('Watchlist settings — UCT Signature', () => {
  const mount = (over = {}) => {
    const onChange = vi.fn(); const onClose = vi.fn()
    render(<WatchlistSettingsPanel settings={{ ...WATCHLIST_DEFAULTS, tintEnabled: false, ...over }} onChange={onChange} onReset={() => {}} onClose={onClose} hostEl={host()} />)
    return { onChange, onClose }
  }

  it('sentence-case title; the close button is named', () => {
    mount()
    expect(screen.getByText('Watchlist settings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('a click on the row label flips the row\'s switch (the same patch the switch sends)', () => {
    const { onChange } = mount()
    fireEvent.click(screen.getByText('Background tint'))
    expect(onChange).toHaveBeenLastCalledWith({ tintEnabled: true })
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle company logos' }))
    expect(onChange).toHaveBeenCalledTimes(2)                       // the switch's own click, once — not twice
  })

  it('a click on a swatch row opens nothing but the colour (no switch on that row is touched)', () => {
    const { onChange } = mount()
    fireEvent.click(screen.getByText('all columns except % change'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Background and Text size are dropdowns; picking keeps the saved value shape and the menu open', () => {
    const { onChange, onClose } = mount({ bgMode: 'solid', fontSize: 12 })
    fireEvent.click(screen.getByRole('button', { name: 'Background: Solid' }))
    const opt = screen.getByRole('option', { name: 'Gradient' })
    fireEvent.mouseDown(opt)                                       // the panel's outside-click must ignore the portalled list
    fireEvent.click(opt)
    expect(onChange).toHaveBeenLastCalledWith({ bgMode: 'gradient' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Watchlist text size: 12' }))
    fireEvent.click(screen.getByRole('option', { name: '14' }))
    expect(onChange).toHaveBeenLastCalledWith({ fontSize: 14 })
    expect(screen.queryByRole('combobox')).toBeNull()               // no native <select> left
  })

  it('template buttons are sentence case', () => {
    mount()
    expect(screen.getByRole('button', { name: '+ Save as template' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Templates' })).toBeInTheDocument()
  })
})

describe('the shared News settings menu (most widgets) — UCT Signature', () => {
  it('an On/Off pick is a switch (same on/off values); a wider pick is a dropdown', () => {
    const onChange = vi.fn()
    render(<NewsSettingsPanel settings={NEWS_SETTINGS} extraSections={NEWS_SECTIONS} onChange={onChange} onReset={() => {}} onClose={() => {}} hostEl={host()} />)
    const sw = screen.getByRole('switch', { name: 'Highlight new' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByText('Highlight new'))              // the row toggles
    expect(onChange).toHaveBeenLastCalledWith({ highlightNew: 'on' })
    fireEvent.click(screen.getByRole('button', { name: 'Density: Comfortable' }))
    fireEvent.click(screen.getByRole('option', { name: 'Compact' }))
    expect(onChange).toHaveBeenLastCalledWith({ density: 'compact' })
    expect(screen.queryByRole('button', { name: 'On' })).toBeNull()
  })
})

describe('Highs / lows and Breadth settings — UCT Signature', () => {
  it('the Logos On/Off pick is a switch that sends the same boolean', () => {
    const onToggleLogos = vi.fn()
    render(<NhnlSettingsPanel settings={{ ...NEWS_SETTINGS, fontSize: 11 }} showLogos onToggleLogos={onToggleLogos} onChange={() => {}} onReset={() => {}} onClose={() => {}} hostEl={host()} />)
    expect(screen.getByText('Highs / lows settings')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Logos' }))
    expect(onToggleLogos).toHaveBeenLastCalledWith(false)
  })

  it('Breadth\'s three native selects are dropdowns with the same values', () => {
    const onChange = vi.fn()
    render(<BreadthSettingsPanel settings={{ ...NEWS_SETTINGS, palette: 'classic', intensity: 'normal', tileStyle: 'values' }} onChange={onChange} onReset={() => {}} onClose={() => {}} hostEl={host()} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View color palette: Classic (green/red)' }))
    fireEvent.click(screen.getByRole('option', { name: 'Ocean (cyan/rose)' }))
    expect(onChange).toHaveBeenLastCalledWith({ palette: 'ocean' })
  })
})
