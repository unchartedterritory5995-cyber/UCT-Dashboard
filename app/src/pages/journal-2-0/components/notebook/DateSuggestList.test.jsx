// @vitest-environment jsdom
// P0.9 -- the `@` date list: rows you can read, a keyboard that works, and a date picker that
// inserts the date you pick. Rendered with the choices dateChoices really produces.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import DateSuggestList, { DATE_SUGGEST_MENU_ID } from './DateSuggestList'
import { dateChoices } from '../../lib/dateSuggest'

afterEach(() => cleanup())

const TODAY = '2026-10-14'
const ALL = dateChoices('', TODAY)

function mount(extra = {}) {
  const ref = createRef()
  const command = vi.fn()
  const onActiveChange = vi.fn()
  const view = render(<DateSuggestList ref={ref} items={ALL} query="" command={command} onActiveChange={onActiveChange} {...extra} />)
  return { ref, command, onActiveChange, ...view }
}
const key = (ref, k) => { let out; act(() => { out = ref.current.onKeyDown({ event: { key: k, preventDefault() {} } }) }); return out }

describe('DateSuggestList', () => {
  it('lists every choice as an option, each with its date underneath', () => {
    mount()
    const listbox = screen.getByRole('listbox', { name: 'Insert a date' })
    expect(listbox.id).toBe(DATE_SUGGEST_MENU_ID)
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.querySelector('[data-label]').textContent)).toEqual(ALL.map((c) => c.label))
    // Tomorrow carries the weekday date a member would otherwise have to work out.
    expect(options[1].textContent).toContain('Thursday, October 15, 2026')
  })

  it('the first option is selected and reported as the active descendant', () => {
    const { onActiveChange } = mount()
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
    expect(onActiveChange).toHaveBeenLastCalledWith(`${DATE_SUGGEST_MENU_ID}-opt-0`)
  })

  it('ArrowDown / ArrowUp move (and wrap), Enter takes the selected row', () => {
    const { ref, command } = mount()
    expect(key(ref, 'ArrowDown')).toBe(true)
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    expect(key(ref, 'ArrowUp')).toBe(true)
    expect(key(ref, 'ArrowUp')).toBe(true) // wraps to the last (the picker)
    expect(screen.getAllByRole('option').at(-1).getAttribute('aria-selected')).toBe('true')
    expect(key(ref, 'ArrowDown')).toBe(true)
    expect(key(ref, 'Enter')).toBe(true)
    expect(command).toHaveBeenCalledWith(ALL[0])
  })

  it('a tap on a row inserts it', () => {
    const { command } = mount()
    fireEvent.mouseDown(screen.getByRole('option', { name: /Tomorrow/ }))
    expect(command).toHaveBeenCalledWith(ALL[1])
  })

  it('⛔ with no choices it renders nothing and passes EVERY key through', () => {
    const { ref, container } = mount({ items: [], query: 'john' })
    expect(container.firstChild).toBeNull()
    for (const k of ['Enter', 'ArrowDown', 'ArrowUp', 'Tab', 'Escape']) expect(key(ref, k), k).toBe(false)
  })

  it('Tab and Escape are not taken (Tab indents a list item, Escape is the Suggestion plugin\'s)', () => {
    const { ref } = mount()
    expect(key(ref, 'Tab')).toBe(false)
    expect(key(ref, 'Escape')).toBe(false)
  })

  describe('Pick a date…', () => {
    const pickerIndex = ALL.length - 1

    function openPicker(ctx) {
      for (let i = 0; i < pickerIndex; i += 1) key(ctx.ref, 'ArrowDown')
      key(ctx.ref, 'Enter')
    }

    it('choosing the picker row does NOT insert; it shows a date input named "Pick a date"', () => {
      const ctx = mount()
      expect(screen.queryByLabelText('Pick a date')).toBeNull()
      openPicker(ctx)
      expect(ctx.command).not.toHaveBeenCalled()
      const input = screen.getByLabelText('Pick a date')
      expect(input.tagName).toBe('INPUT')
      expect(input.getAttribute('type')).toBe('date')
    })

    it('the input is NOT inside an option (an interactive control in an option fails axe)', () => {
      const ctx = mount()
      openPicker(ctx)
      expect(screen.getByLabelText('Pick a date').closest('[role="option"]')).toBeNull()
    })

    it('a picked date inserts exactly that date', () => {
      const ctx = mount()
      openPicker(ctx)
      fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-11-03' } })
      expect(ctx.command).toHaveBeenCalledTimes(1)
      expect(ctx.command).toHaveBeenCalledWith({ label: '2026-11-03', date: '2026-11-03' })
    })

    it('⛔ a half-typed year ("0002-11-03") inserts nothing (Chrome fires change on every valid keystroke)', () => {
      const ctx = mount()
      openPicker(ctx)
      fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '0002-11-03' } })
      expect(ctx.command).not.toHaveBeenCalled()
    })

    it('tapping the picker row shows the input too', () => {
      mount()
      fireEvent.mouseDown(screen.getByRole('option', { name: /Pick a date/ }))
      expect(screen.getByLabelText('Pick a date')).toBeTruthy()
    })
  })
})
