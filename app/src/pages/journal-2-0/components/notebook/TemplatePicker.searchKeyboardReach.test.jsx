// Wave 13 lane 13Q-5 (click-budget: Q2, "new note from a template"). Covers what
// THIS lane added to the gallery -- autoFocusSearch, the search box's virtual
// "Enter picks this" target, and Arrow/Home/End driving it. None of this
// replaces the existing card click/Enter/Space contract
// (TemplatePicker.gallery.test.jsx covers that, unmodified) or the existing
// filtering (TemplatePicker.gallerySearch.test.jsx, also unmodified) -- every
// assertion here is new behaviour.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import { getTemplate } from '../../lib/notebookTemplates'

function renderPicker(props = {}) {
  const onPick = vi.fn()
  render(
    <MemoryRouter>
      <TemplatePicker onPick={onPick} {...props} />
    </MemoryRouter>,
  )
  return { onPick }
}

const search = () => screen.getByRole('searchbox', { name: 'Search templates' })
const cards = () => [...document.querySelectorAll('[data-template-card]')]
const activeCard = () => document.querySelector("[data-active='true']")

describe('13Q-5 -- autoFocusSearch lands real focus on open', () => {
  it('focuses the search box when the caller opts in', () => {
    renderPicker({ autoFocusSearch: true })
    expect(document.activeElement).toBe(search())
  })

  it('does NOT focus it by default -- the inline empty-notebook mount must never steal focus', () => {
    renderPicker()
    expect(document.activeElement).not.toBe(search())
  })
})

describe('13Q-5 -- typing filters, Enter picks', () => {
  it('a unique match + Enter in the search box picks that template, via its OWN onClick', () => {
    const { onPick } = renderPicker({ autoFocusSearch: true })
    fireEvent.change(search(), { target: { value: 'mistake log' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(getTemplate('mistake-log'))
  })

  it('⛔ the target is the first REAL match, never Blank (data-template-anchor is excluded)', () => {
    renderPicker({ autoFocusSearch: true })
    fireEvent.change(search(), { target: { value: 'mistake log' } })
    expect(activeCard()?.getAttribute('data-template-key')).toBe('mistake-log')
  })

  it('with an empty query the default target is Blank (index 0) -- Enter picks null', () => {
    const { onPick } = renderPicker({ autoFocusSearch: true })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(null)
  })

  it('clearing the query resets the target back to Blank', () => {
    const { onPick } = renderPicker({ autoFocusSearch: true })
    fireEvent.change(search(), { target: { value: 'mistake log' } })
    fireEvent.change(search(), { target: { value: '' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(null)
  })

  it('⛔ CONTROL -- a query matching nothing never fires a phantom pick', () => {
    const { onPick } = renderPicker({ autoFocusSearch: true })
    fireEvent.change(search(), { target: { value: 'zzzznosuchtemplateword' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })
})

// ⛔ Lane FIN-A11Y (review R4, I-5) changed THIS block's key set, and only that. 13Q-5
// drove the target with all four arrows plus Home and End, which took Left, Right, Home
// and End away from the text caret: a member could not edit what they had typed. The
// target is now driven with ArrowUp and ArrowDown only. Type-to-search and Enter-to-pick
// (the block above) are untouched. The caret half is railed in
// TemplatePicker.searchCaret.test.jsx.
describe('13Q-5 -- ArrowUp/ArrowDown drive the virtual target from the search box', () => {
  it('ArrowDown moves the target forward WITHOUT moving real focus off the input', () => {
    renderPicker({ autoFocusSearch: true })
    const all = cards()
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    expect(activeCard()).toBe(all[1])
    expect(document.activeElement).toBe(search())
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    expect(activeCard()).toBe(all[2])
    expect(document.activeElement).toBe(search())
  })

  it('ArrowUp moves it back; the start holds rather than wrapping', () => {
    renderPicker({ autoFocusSearch: true })
    const all = cards()
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    fireEvent.keyDown(search(), { key: 'ArrowUp' })
    expect(activeCard()).toBe(all[0])
    fireEvent.keyDown(search(), { key: 'ArrowUp' })
    expect(activeCard()).toBe(all[0])
  })

  it('the end holds rather than wrapping', () => {
    renderPicker({ autoFocusSearch: true })
    const all = cards()
    for (let i = 0; i < all.length + 3; i += 1) fireEvent.keyDown(search(), { key: 'ArrowDown' })
    expect(activeCard()).toBe(all[all.length - 1])
  })

  it('the ring is painted only while the search box itself holds real focus', () => {
    renderPicker({ autoFocusSearch: true })
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    expect(activeCard()).not.toBeNull()
    fireEvent.blur(search())
    expect(activeCard()).toBeNull()
  })
})
