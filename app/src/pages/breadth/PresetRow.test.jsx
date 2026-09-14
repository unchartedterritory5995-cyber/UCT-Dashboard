// app/src/pages/breadth/PresetRow.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import PresetRow from './PresetRow'

const PRESETS = [
  { id: 'health', label: 'Market Health', hint: 'the daily read', metrics: ['a'] },
  { id: 'thrust', label: 'Breadth Thrust', hint: 'ignition', metrics: ['b'] },
  { id: 'froth', label: 'Froth', group: 'Momentum', hint: 'late-move heat', metrics: ['c'] },
  { id: 'risk', label: 'Risk Appetite', group: 'Leadership', hint: 'who is bought', metrics: ['d'] },
]
const ORDER = ['Leadership', 'Momentum']

const setup = (props = {}) =>
  render(<PresetRow presets={PRESETS} groupOrder={ORDER} activePreset={null} onApply={() => {}} {...props} />)

const panelOf = trigger => document.getElementById(trigger.getAttribute('aria-controls'))
const listName = list => document.getElementById(list.getAttribute('aria-labelledby'))?.textContent

describe('PresetRow', () => {
  it('shows ungrouped presets as pills and keeps grouped ones closed behind More', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Market Health' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Breadth Thrust' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Froth/ })).toBeNull()
  })

  it('applies a preset from a pill', () => {
    const onApply = vi.fn()
    setup({ onApply })
    fireEvent.click(screen.getByRole('button', { name: 'Market Health' }))
    expect(onApply).toHaveBeenCalledWith(PRESETS[0])
  })

  it('opens a disclosure in declared group order and applies from it', () => {
    const onApply = vi.fn()
    setup({ onApply })
    const trigger = screen.getByRole('button', { name: /^More/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const panel = panelOf(trigger)
    expect(within(panel).getAllByRole('list').map(listName)).toEqual(['Leadership', 'Momentum'])

    fireEvent.click(within(panel).getByRole('button', { name: /^Risk Appetite/ }))
    expect(onApply).toHaveBeenCalledWith(PRESETS[3])
    expect(panelOf(trigger)).toBeNull()
  })

  // A-24: the list was a `listbox` of `option`s, promising arrow-key selection it never had.
  it('claims no listbox or option role it cannot honour', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByRole('button', { name: /^More/ }).hasAttribute('aria-haspopup')).toBe(false)
  })

  it('shows each hint so the list explains what it is offering', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    expect(screen.getByText('who is bought')).toBeTruthy()
  })

  // 02-design §3: Escape closes a popover and returns focus to its button.
  it('closes on Escape and returns focus to More; closes on an outside click', () => {
    setup()
    const trigger = screen.getByRole('button', { name: /^More/ })

    fireEvent.click(trigger)
    within(panelOf(trigger)).getByRole('button', { name: /^Froth/ }).focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panelOf(trigger)).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(panelOf(trigger)).toBeNull()
  })

  // The band must never look like nothing is selected just because the active
  // preset lives behind More.
  it('names the active preset on the trigger, and marks it pressed in the list', () => {
    setup({ activePreset: 'risk' })
    const trigger = screen.getByRole('button', { name: 'More: Risk Appetite' })
    fireEvent.click(trigger)
    expect(within(panelOf(trigger)).getByRole('button', { name: /^Risk Appetite/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(panelOf(trigger)).getByRole('button', { name: /^Froth/ }).getAttribute('aria-pressed')).toBe('false')
  })

  // On touch the pills scroll horizontally. If the list lived inside that scroll
  // container, `overflow-x: auto` would compute `overflow-y` to auto too and clip it.
  it('keeps the More trigger and its list out of the scrolling pill track', () => {
    setup()
    const trigger = screen.getByRole('button', { name: /^More/ })
    const pillTrack = screen.getByRole('button', { name: 'Market Health' }).parentElement
    expect(pillTrack.contains(trigger)).toBe(false)
    fireEvent.click(trigger)
    expect(pillTrack.contains(panelOf(trigger))).toBe(false)
  })

  it('marks the active pill and leaves the trigger plain', () => {
    setup({ activePreset: 'health' })
    expect(screen.getByRole('button', { name: 'Market Health' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })
})
