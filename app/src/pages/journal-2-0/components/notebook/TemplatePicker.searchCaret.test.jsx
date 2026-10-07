// Lane FIN-A11Y (review R4, I-5). The template search box used to take ArrowLeft,
// ArrowRight, Home and End away from the text caret whenever a card was listed, so a
// member could not edit what they had typed. Those four keys belong to the text field.
// The list is driven with ArrowUp and ArrowDown only, and the card Enter will pick is
// exposed to assistive technology (aria-activedescendant) and said in a polite status.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import { getTemplate } from '../../lib/notebookTemplates'

function renderPicker(props = {}) {
  const onPick = vi.fn()
  render(
    <MemoryRouter>
      <TemplatePicker onPick={onPick} autoFocusSearch {...props} />
    </MemoryRouter>,
  )
  return { onPick }
}

const search = () => screen.getByRole('searchbox', { name: 'Search templates' })
const cards = () => [...document.querySelectorAll('[data-template-card]')]
const activeCard = () => document.querySelector("[data-active='true']")

/** True when the handler left the key to the browser (so the caret moves). */
const leftToTheField = (key) => fireEvent.keyDown(search(), { key })

describe('I-5 -- Left, Right, Home and End belong to the text field', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    it(key + ' is not prevented and does not move the list target', () => {
      renderPicker()
      fireEvent.change(search(), { target: { value: 'log' } })
      const before = activeCard()
      expect(before).not.toBeNull()
      expect(leftToTheField(key)).toBe(true)
      expect(activeCard()).toBe(before)
    })
  }

  it('a member can move the caret and fix a typo in the middle of the query', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.type(search(), 'mistke log')
    // back over " log" and "ke", then put the missing letter in
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}a')
    expect(search()).toHaveValue('mistake log')
    await user.keyboard('{Home}x{End}y')
    expect(search()).toHaveValue('xmistake logy')
  })
})

describe('I-5 -- Up and Down drive the list, Enter picks', () => {
  it('ArrowDown and ArrowUp move the target, are prevented, and keep focus in the field', () => {
    renderPicker()
    const all = cards()
    expect(fireEvent.keyDown(search(), { key: 'ArrowDown' })).toBe(false)
    expect(activeCard()).toBe(all[1])
    expect(document.activeElement).toBe(search())
    expect(fireEvent.keyDown(search(), { key: 'ArrowUp' })).toBe(false)
    expect(activeCard()).toBe(all[0])
  })

  it('type, ArrowDown, Enter picks the second match through its own click', async () => {
    const user = userEvent.setup()
    const { onPick } = renderPicker()
    await user.type(search(), 'mistake log')
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(getTemplate('mistake-log'))
  })
})

describe('I-5 -- the target is exposed to assistive technology', () => {
  it('the field points at the card Enter will pick', () => {
    renderPicker()
    const box = search()
    expect(box).toHaveAttribute('aria-autocomplete', 'list')
    const controlled = document.getElementById(box.getAttribute('aria-controls'))
    expect(controlled).not.toBeNull()
    const active = activeCard()
    expect(active.id).toBeTruthy()
    expect(box).toHaveAttribute('aria-activedescendant', active.id)
    expect(controlled.contains(active)).toBe(true)

    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box).toHaveAttribute('aria-activedescendant', activeCard().id)
    expect(activeCard()).toBe(cards()[1])
  })

  it('every card that can become the target has a unique id', () => {
    renderPicker()
    const box = search()
    const seen = new Set()
    for (let i = 0; i < cards().length; i += 1) {
      const id = box.getAttribute('aria-activedescendant')
      expect(id).toBeTruthy()
      expect(seen.has(id)).toBe(false)
      seen.add(id)
      fireEvent.keyDown(box, { key: 'ArrowDown' })
    }
  })

  it('a query that matches nothing points at nothing', () => {
    renderPicker()
    fireEvent.change(search(), { target: { value: 'zzzznosuchtemplateword' } })
    expect(search()).not.toHaveAttribute('aria-activedescendant')
  })

  it('a polite status says which template Enter opens, and changes as the target moves', () => {
    renderPicker()
    const status = document.querySelector('[data-template-search-status]')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(/Enter opens Blank note/)
    fireEvent.change(search(), { target: { value: 'mistake log' } })
    expect(status).toHaveTextContent(/Enter opens Mistake log/i)
    fireEvent.change(search(), { target: { value: 'zzzznosuchtemplateword' } })
    expect(status).toHaveTextContent(/No template matches/)
  })

  it('the field says how to use the keys', () => {
    renderPicker()
    const hint = document.getElementById(search().getAttribute('aria-describedby'))
    expect(hint).toHaveTextContent(/Up and Down/)
    expect(hint).toHaveTextContent(/Enter/)
  })

  it('when the field loses focus it stops pointing at a card', () => {
    renderPicker()
    expect(search()).toHaveAttribute('aria-activedescendant')
    fireEvent.blur(search())
    expect(search()).not.toHaveAttribute('aria-activedescendant')
  })
})
