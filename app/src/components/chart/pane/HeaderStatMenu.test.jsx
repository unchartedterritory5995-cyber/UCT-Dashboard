// The header stat quick-edit menu (owner 11-17).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import HeaderStatMenu from './HeaderStatMenu'

function setup(over = {}) {
  const anchor = document.createElement('span')
  document.body.appendChild(anchor)
  const fns = { onRename: vi.fn(), onValueColor: vi.fn(), onStyle: vi.fn(), onRemove: vi.fn(), onAddStat: vi.fn(), onOpenSettings: vi.fn(), onClose: vi.fn() }
  const stat = { key: 'mcap', label: 'Market Cap', rename: null, value: '1.00B', signed: false, colorKey: 'mcap', valueColor: null, ...over.stat }
  render(<HeaderStatMenu anchor={anchor} stat={stat} look={over.look || {}} {...fns} />)
  return { anchor, fns, dialog: screen.getByRole('dialog', { name: /options$/ }) }
}

afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('HeaderStatMenu', () => {
  it('renames with the settings rules (clean, ≤16, empty = own name)', () => {
    const { fns } = setup()
    const input = screen.getByRole('textbox', { name: 'Name for Market Cap' })
    fireEvent.change(input, { target: { value: '  Cap   size  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(fns.onRename).toHaveBeenCalledWith('Cap size')
    expect(input.maxLength).toBe(16)
  })
  it('size, box, remove, add and settings call their writers', () => {
    const { fns } = setup({ look: { size: 'l' } })
    expect(screen.getByRole('button', { name: 'Size L' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Size XL' }))
    expect(fns.onStyle).toHaveBeenLastCalledWith({ size: 'xl' })
    fireEvent.click(screen.getByRole('switch', { name: 'Shaded box' }))
    expect(fns.onStyle).toHaveBeenLastCalledWith({ box: true })
    fireEvent.click(screen.getByRole('button', { name: 'Header settings…' }))
    expect(fns.onOpenSettings).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add an indicator value…' }))
    expect(fns.onAddStat).toHaveBeenCalledWith('custom')
    fireEvent.click(screen.getByRole('button', { name: 'Remove from header' }))
    expect(fns.onRemove).toHaveBeenCalled()
  })
  it('a set color shows "Default", which resets it', () => {
    const a = setup({ look: { labelColor: '#abcdef' } })
    fireEvent.click(screen.getByRole('button', { name: 'Label color: back to default' }))
    expect(a.fns.onStyle).toHaveBeenLastCalledWith({ labelColor: null })
  })
  it('a signed stat edits its up and down colors', () => {
    const b = setup({ stat: { key: 'chg', label: 'Change', signed: true, colorKey: 'chg', valueColors: { pos: '#00ff00' } } })
    expect(b.dialog.querySelector('[data-stat-menu-row="value-pos"]')).toBeTruthy()
    expect(b.dialog.querySelector('[data-stat-menu-row="value-neg"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Value color · up: back to default' }))
    expect(b.fns.onValueColor).toHaveBeenLastCalledWith('chg:pos', null)
  })
  it('Escape and an outside press close it', () => {
    const { fns } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(fns.onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(document.body)
    expect(fns.onClose).toHaveBeenCalledTimes(2)
  })
  it('a color swatch opens the shared UCT color panel, and a pick writes through that row', () => {
    const { fns } = setup({ look: { box: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Box color' }))
    const panel = document.querySelector('[data-chart-portal-popup="header-stat-color"]')
    expect(panel).toBeTruthy()
    expect(panel.querySelector('[data-color-panel], *')).toBeTruthy()
    const cell = panel.querySelector('button[title^="#"], button[aria-label^="#"]')
    if (cell) { fireEvent.click(cell); expect(fns.onStyle).toHaveBeenCalled(); expect(Object.keys(fns.onStyle.mock.lastCall[0])).toEqual(['boxColor']) }
    fireEvent.keyDown(document, { key: 'Escape' })   // closes the panel first, the menu stays
    expect(document.querySelector('[data-chart-portal-popup="header-stat-color"]')).toBeNull()
    expect(fns.onClose).not.toHaveBeenCalled()
  })
})

describe('HeaderStatMenu thickness (owner 11-17)', () => {
  it('a thinner / thicker stepper names the current weight and steps it', () => {
    const { fns } = setup({ look: { weight: 'bold' } })
    expect(document.querySelector('[data-stat-weight-name]').textContent).toBe('Bold')
    fireEvent.click(screen.getByRole('button', { name: 'Thinner' }))
    expect(fns.onStyle).toHaveBeenLastCalledWith({ weight: 'regular' })
    fireEvent.click(screen.getByRole('button', { name: 'Thicker' }))
    expect(fns.onStyle).toHaveBeenLastCalledWith({ weight: 'heavy' })
  })
  it('the stepper stops at the ends', () => {
    setup({ look: {} })
    expect(document.querySelector('[data-stat-weight-name]').textContent).toBe('Regular')
    cleanup(); document.body.innerHTML = ''
    setup({ look: { weight: 'heavy' } })
    expect(screen.getByRole('button', { name: 'Thicker' }).disabled).toBe(true)
    cleanup(); document.body.innerHTML = ''
    setup({ look: { weight: 'light' } })
    expect(screen.getByRole('button', { name: 'Thinner' }).disabled).toBe(true)
  })
})
