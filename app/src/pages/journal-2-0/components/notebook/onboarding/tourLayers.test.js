// onboarding/tourLayers.js: which layer a tour card belongs to, and whether it is on top.
// GenericTourEngine asks `cardIsTopmost` before it answers Escape, and `dialogHost` to decide
// where the card mounts. A wrong answer means Escape closes the tour underneath an open sheet
// (the member loses the walkthrough while trying to close something else), or the card mounts
// behind a modal where it cannot be reached.
import { describe, it, expect, afterEach } from 'vitest'
import { cardIsTopmost, dialogHost } from './tourLayers'

afterEach(() => { document.body.innerHTML = '' })

function el(tag, attrs = {}, parent = document.body) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  parent.appendChild(node)
  return node
}

describe('dialogHost: the sheet or dialog an element sits in', () => {
  it('finds a sheet panel around the element', () => {
    const sheet = el('div', { 'data-sheet-panel': '' })
    const button = el('button', {}, el('div', {}, sheet))
    expect(dialogHost(button)).toBe(sheet)
  })

  it('finds a role=dialog around the element', () => {
    const dialog = el('div', { role: 'dialog' })
    expect(dialogHost(el('input', {}, dialog))).toBe(dialog)
  })

  it('finds an aria-modal container that is not marked as a dialog', () => {
    const modal = el('section', { 'aria-modal': 'true' })
    expect(dialogHost(el('span', {}, modal))).toBe(modal)
  })

  it('answers the NEAREST host when layers are nested', () => {
    const outer = el('div', { role: 'dialog' })
    const inner = el('div', { 'data-sheet-panel': '' }, outer)
    expect(dialogHost(el('button', {}, inner))).toBe(inner)
  })

  it('answers the element itself when it is the host', () => {
    const dialog = el('div', { role: 'dialog' })
    expect(dialogHost(dialog)).toBe(dialog)
  })

  it('is null for an element on the plain page', () => {
    expect(dialogHost(el('button'))).toBeNull()
  })

  it('does not treat aria-modal="false" as a modal', () => {
    const notModal = el('div', { 'aria-modal': 'false' })
    expect(dialogHost(el('button', {}, notModal))).toBeNull()
  })

  it.each([['null', null], ['undefined', undefined], ['a plain object', {}], ['a string', 'x']])(
    'is null for %s instead of throwing', (_label, v) => {
      expect(dialogHost(v)).toBeNull()
    })

  it('is null for a text node, which has no closest()', () => {
    const p = el('p')
    p.textContent = 'hello'
    expect(dialogHost(p.firstChild)).toBeNull()
  })
})

describe('cardIsTopmost: may the tour card answer Escape?', () => {
  it('is false with no card', () => {
    expect(cardIsTopmost(null)).toBe(false)
    expect(cardIsTopmost(undefined)).toBe(false)
  })

  it('is true when nothing else is open', () => {
    expect(cardIsTopmost(el('div', { 'data-tour-card': '' }))).toBe(true)
  })

  it('is FALSE when a sheet was opened after the card (it comes later in the document)', () => {
    const card = el('div', { 'data-tour-card': '' })
    el('div', { 'data-sheet-panel': '' })
    expect(cardIsTopmost(card)).toBe(false)
  })

  it('is FALSE when a modal dialog was opened after the card', () => {
    const card = el('div', { 'data-tour-card': '' })
    el('div', { role: 'dialog', 'aria-modal': 'true' })
    expect(cardIsTopmost(card)).toBe(false)
  })

  it('is true when the sheet was already open before the card mounted', () => {
    el('div', { 'data-sheet-panel': '' })
    expect(cardIsTopmost(el('div', { 'data-tour-card': '' }))).toBe(true)
  })

  it('is true when the card sits INSIDE the sheet it is explaining', () => {
    const sheet = el('div', { 'data-sheet-panel': '' })
    expect(cardIsTopmost(el('div', { 'data-tour-card': '' }, sheet))).toBe(true)
  })

  it('still yields to a second sheet opened over the one the card sits in', () => {
    const sheet = el('div', { 'data-sheet-panel': '' })
    const card = el('div', { 'data-tour-card': '' }, sheet)
    el('div', { 'data-sheet-panel': '' })
    expect(cardIsTopmost(card)).toBe(false)
  })

  it('is true when the card is itself the modal layer', () => {
    expect(cardIsTopmost(el('div', { role: 'dialog', 'aria-modal': 'true' }))).toBe(true)
  })

  it('does not yield to a layer nested inside the card', () => {
    const card = el('div', { 'data-tour-card': '' })
    el('div', { 'aria-modal': 'true' }, card)
    expect(cardIsTopmost(card)).toBe(true)
  })

  it('does not yield to a NON-modal dialog (a popover or the tour\'s own card) opened after it', () => {
    const card = el('div', { 'data-tour-card': '' })
    el('div', { role: 'dialog' })
    el('div', { role: 'dialog', 'aria-modal': 'false' })
    expect(cardIsTopmost(card)).toBe(true)
  })

  it('checks every layer: one earlier sheet does not hide a later one', () => {
    el('div', { 'data-sheet-panel': '' })
    const card = el('div', { 'data-tour-card': '' })
    el('div', { 'aria-modal': 'true' })
    expect(cardIsTopmost(card)).toBe(false)
  })

  it('goes back to true once the sheet above it closes', () => {
    const card = el('div', { 'data-tour-card': '' })
    const sheet = el('div', { 'data-sheet-panel': '' })
    expect(cardIsTopmost(card)).toBe(false)
    sheet.remove()
    expect(cardIsTopmost(card)).toBe(true)
  })
})
