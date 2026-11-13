// Drawing-tool favourites across two mounted toolbars (#1162, AUDIT T1): a ★ in one toolbar shows in the other, the
// write and its event run outside any setState updater (no "Cannot update a component while rendering a different
// component"), and two toggles in one tick build on each other.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { AuthContext } from '../../context/AuthContext'
import { LS_FAV, readFavoriteTools } from './drawToolFavorites'

const props = {
  activeTool: 'cursor', setActiveTool: () => {}, color: '#c9a84c', setColor: () => {}, lineWidth: 1, setLineWidth: () => {},
  hasSelection: false, onDelete: () => {}, onClearAll: () => {}, onUndo: () => {}, onRedo: () => {}, drawingCount: 0,
  repeatMode: false, setRepeatMode: () => {}, chartSettings: mergeChartSettings({}), onUpdateSettings: () => {},
  magnet: false, setMagnet: () => {}, onReplayToggle: () => {}, setLineStyle: () => {}, setFontSize: () => {},
}
const two = () => render(
  <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
    <div data-testid="a"><ChartToolbar {...props} /></div>
    <div data-testid="b"><ChartToolbar {...props} /></div>
  </AuthContext.Provider>,
)
// each toolbar's menu is portaled to <body>; both are open, A's first (opened first), so the stars split in half
const all = () => screen.queryAllByTitle(/^(Add to|Remove from) favorites toolbar$/)
const stars = (which) => { const x = all(); const h = x.length / 2; return which === 'a' ? x.slice(0, h) : x.slice(h) }

describe('ChartToolbar favourites: two mounted toolbars', () => {
  let err
  beforeEach(() => { localStorage.removeItem(LS_FAV); err = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { err.mockRestore(); localStorage.removeItem(LS_FAV) })

  it('a ★ in one toolbar updates the other, with no console error; two toggles in one tick compose', () => {
    two()
    const a = screen.getByTestId('a'), b = screen.getByTestId('b')
    fireEvent.click(within(a).getByLabelText('Customize drawing tools'))
    fireEvent.click(within(b).getByLabelText('Customize drawing tools'))
    expect(all().length % 2).toBe(0)
    expect(all().length).toBeGreaterThan(4)
    const [s0] = stars('a')
    expect(stars('b').filter(s => s.title.startsWith('Remove')).length).toBe(0)
    fireEvent.click(s0)
    expect(readFavoriteTools().length).toBe(1)
    expect(stars('b').filter(s => s.title.startsWith('Remove')).length).toBe(1)   // the other toolbar shows the star
    // two toggles in one tick (one per toolbar): both land
    act(() => { stars('a')[1].click(); stars('b')[2].click() })
    expect(readFavoriteTools().length).toBe(3)
    expect(stars('a').filter(s => s.title.startsWith('Remove')).length).toBe(3)
    expect(stars('b').filter(s => s.title.startsWith('Remove')).length).toBe(3)
    expect(err.mock.calls.map(c => String(c[0])).filter(m => /Cannot update a component|while rendering/.test(m))).toEqual([])
    expect(err).not.toHaveBeenCalled()
  })
})
