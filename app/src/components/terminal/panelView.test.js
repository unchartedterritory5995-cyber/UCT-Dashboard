// Customization pass 1: the panel view slot (panelView.js) and how the board record carries it
// (boardModel.js normalizePanel / setPanelView / share / pop-out / saved board).
import { describe, it, expect } from 'vitest'
import {
  VIEW_MAX_BYTES, VIEW_MAX_FILTERS, VIEW_MAX_HIDDEN, VIEW_MAX_STR, normalizeView, readView, storedView, sameView,
} from './panelView'
import {
  decodePopout, decodeShare, defaultLayout, encodeShare, normalizeLayout, openBoard, popoutHref, readLayout,
  saveBoard, emptyLibrary, normalizeLibrary, serializeLayout, setPanelView, duplicatePanel,
} from '../../pages/terminal/boardModel'

describe('normalizeView: well formed and small, or nothing', () => {
  it('keeps the three fields in their shapes', () => {
    const v = { sort: { key: 'pct', dir: 'desc' }, cols: { hidden: ['volume', 'ah'] }, filters: { minPrice: 5, q: 'nvda', on: true } }
    expect(normalizeView(v)).toEqual(v)
  })
  it('drops unknown fields and bad values', () => {
    expect(normalizeView({ sort: { key: 'pct', dir: 'up' } })).toBeUndefined()
    expect(normalizeView({ sort: { key: 'pct', dir: 'asc', extra: 1 }, junk: 1 })).toEqual({ sort: { key: 'pct', dir: 'asc' } })
    expect(normalizeView({ sort: { key: '<script>', dir: 'asc' } })).toBeUndefined()
    expect(normalizeView({ filters: { a: { deep: 1 }, b: [1], c: Infinity, d: null } })).toBeUndefined()
    expect(normalizeView({ cols: { hidden: 'volume' } })).toBeUndefined()
    expect(normalizeView(null)).toBeUndefined()
    expect(normalizeView([])).toBeUndefined()
    expect(normalizeView('x')).toBeUndefined()
    expect(normalizeView({})).toBeUndefined()
  })
  it('caps filters, hidden columns and string length', () => {
    const filters = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, i]))
    expect(Object.keys(normalizeView({ filters }).filters)).toHaveLength(VIEW_MAX_FILTERS)
    const hidden = Array.from({ length: 40 }, (_, i) => `c${i}`)
    expect(normalizeView({ cols: { hidden } }).cols.hidden).toHaveLength(VIEW_MAX_HIDDEN)
    expect(normalizeView({ filters: { q: 'x'.repeat(VIEW_MAX_STR) } }).filters.q).toHaveLength(VIEW_MAX_STR)
    expect(normalizeView({ filters: { q: 'x'.repeat(VIEW_MAX_STR + 1) } })).toBeUndefined()
    expect(normalizeView({ cols: { hidden: ['a', 'a', 'b'] } }).cols.hidden).toEqual(['a', 'b'])
  })
  it('drops the whole slot past the byte cap', () => {
    const key = (i) => `k${String(i).padStart(2, '0')}${'x'.repeat(36)}`
    const filters = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [key(i), 'y'.repeat(40)]))
    const hidden = Array.from({ length: 24 }, (_, i) => key(i))
    const big = { filters, cols: { hidden } }
    expect(JSON.stringify(big).length).toBeGreaterThan(VIEW_MAX_BYTES)
    expect(normalizeView(big)).toBeUndefined()
    expect(normalizeView({ filters })).toBeDefined()
  })
})

describe('readView / storedView: defaults are not stored', () => {
  const D = { sort: null, hidden: ['ah'], filters: { minPrice: 0 } }
  it('fills defaults in', () => {
    expect(readView(undefined, D)).toEqual({ sort: null, hidden: ['ah'], filters: { minPrice: 0 } })
    expect(readView({ filters: { minPrice: 5 } }, D).filters).toEqual({ minPrice: 5 })
  })
  it('stores only what differs', () => {
    expect(storedView({ sort: null, hidden: ['ah'], filters: { minPrice: 0 } }, D)).toBeUndefined()
    expect(storedView({ sort: { key: 'pct', dir: 'desc' }, hidden: [], filters: { minPrice: 0 } }, D))
      .toEqual({ sort: { key: 'pct', dir: 'desc' }, cols: { hidden: [] } })
  })
  it('an empty hidden list is kept when the default hides something', () => {
    const s = storedView({ sort: null, hidden: [], filters: { minPrice: 0 } }, D)
    expect(s).toEqual({ cols: { hidden: [] } })
    expect(readView(s, D).hidden).toEqual([])
  })
  it('sameView ignores order', () => {
    expect(sameView({ cols: { hidden: ['a', 'b'] }, filters: { x: 1, y: 2 } }, { filters: { y: 2, x: 1 }, cols: { hidden: ['b', 'a'] } })).toBe(true)
  })
})

describe('the board record carries the view', () => {
  const withView = (view) => {
    const l = defaultLayout()
    return setPanelView(l, l.panels[1].id, view)
  }
  it('an old board (no view) loads exactly as before', () => {
    const l = defaultLayout()
    const ser = serializeLayout(l)
    expect(ser).not.toContain('"view"')
    expect(readLayout(ser).layout.panels.map((p) => Object.keys(p).sort()))
      .toEqual(l.panels.map((p) => Object.keys(p).sort()))
  })
  it('round-trips through save and load', () => {
    const l = withView({ sort: { key: 'pct', dir: 'asc' }, cols: { hidden: ['volume'] } })
    const back = readLayout(serializeLayout(l)).layout
    expect(back.panels[1].view).toEqual({ sort: { key: 'pct', dir: 'asc' }, cols: { hidden: ['volume'] } })
    expect(back.panels[0].view).toBeUndefined()
  })
  it('a bad view in a stored blob is dropped, the panel kept', () => {
    const l = defaultLayout()
    const raw = JSON.parse(serializeLayout(l))
    raw.panels[0].view = { sort: { key: 'x', dir: 'sideways' }, filters: 'no' }
    const back = readLayout(JSON.stringify(raw)).layout
    expect(back.panels[0].code).toBe(l.panels[0].code)
    expect(back.panels[0]).not.toHaveProperty('view')
  })
  it('setPanelView: an empty view removes the key; unknown id is a no-op', () => {
    const l = withView({ sort: { key: 'pct', dir: 'asc' } })
    const id = l.panels[1].id
    expect(setPanelView(l, id, {}).panels[1]).not.toHaveProperty('view')
    expect(setPanelView(l, 'nope', { sort: { key: 'a', dir: 'asc' } })).toBe(l)
    expect(setPanelView(l, id, { sort: { key: 'pct', dir: 'desc' } }).panels[1].args).toEqual(l.panels[1].args)
  })
  it('a share link carries it', () => {
    const l = withView({ filters: { win: '3M' } })
    const shared = decodeShare(encodeShare('Mine', l, {}))
    expect(shared.layout.panels[1].view).toEqual({ filters: { win: '3M' } })
    expect(openBoard(shared.layout).layout.panels[1].view).toEqual({ filters: { win: '3M' } })
  })
  it('a saved board carries it', () => {
    const l = withView({ sort: { key: 'sym', dir: 'asc' } })
    const { library } = saveBoard(emptyLibrary(), 'Mine', l, {}, 1000)
    const again = normalizeLibrary(JSON.parse(JSON.stringify(library)))
    expect(again.boards[0].layout.panels[1].view).toEqual({ sort: { key: 'sym', dir: 'asc' } })
  })
  it('a pop-out carries it; a duplicate copies it', () => {
    const l = withView({ cols: { hidden: ['ah'] } })
    const token = popoutHref(l.panels[1], 'NVDA').split('popout=')[1]
    expect(decodePopout(token).view).toEqual({ cols: { hidden: ['ah'] } })
    const old = popoutHref(defaultLayout().panels[0], null).split('popout=')[1]
    expect(decodePopout(old)).not.toHaveProperty('view')
    const d = duplicatePanel(l, 1)
    expect(d.layout.panels[2].view).toEqual({ cols: { hidden: ['ah'] } })
  })
  it('the closed-panel undo stack keeps it', () => {
    const l = withView({ sort: { key: 'pct', dir: 'desc' } })
    const n = normalizeLayout({ ...l, closed: [{ panel: l.panels[1], index: 1 }] })
    expect(n.closed[0].panel.view).toEqual({ sort: { key: 'pct', dir: 'desc' } })
  })
})
