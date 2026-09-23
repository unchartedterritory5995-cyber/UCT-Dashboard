/**
 * ⛔ Notebook UX audit residual debt, closed 2026-09-22 (Wave D closure-pass
 * note: "the `[[`/SlashMenu popups' editable root lacks an explicit
 * `role="combobox"`/`aria-autocomplete` pairing (a pre-existing pattern
 * shared by both menus, not a Wave D regression) — left as recorded debt").
 *
 * `NoteLinkMenu.jsx` and `SlashMenu.jsx` each carried an IDENTICAL inline
 * closure wiring `aria-controls`/`aria-activedescendant` onto the editor's
 * contentEditable DOM node — the editor is the focused element, so it must
 * carry the combobox role; an unfocused listbox cannot. Extracted to one
 * shared, directly-testable function rather than adding a third copy of the
 * same logic (`lesson_a_guard_repeated_is_a_guard_unproved` — two identical
 * copies were already one too many).
 *
 * ⭐ Verified before writing this: ProseMirror sets no `role` on its own
 * contentEditable root (grepped `prosemirror-view`'s dist bundle), and
 * neither does `NoteEditorPage.jsx`'s `<EditorContent>` wrapper — nothing
 * here overwrites an existing role.
 */
import { describe, it, expect } from 'vitest'
import { applyComboboxWiring } from './comboboxWiring'

function fakeEditorDom() {
  return document.createElement('div')
}

describe('applyComboboxWiring — the editor root becomes a combobox while a suggestion menu is live', () => {
  it('does nothing when handed no dom node (the extension can be torn down before it ever started)', () => {
    expect(() => applyComboboxWiring(null, { menuId: 'm', activeId: null, showing: true })).not.toThrow()
  })

  it('sets the full combobox pairing when the menu is showing, with an active option', () => {
    const dom = fakeEditorDom()
    applyComboboxWiring(dom, { menuId: 'uct-slash-menu', activeId: 'uct-slash-menu-opt-2', showing: true })
    expect(dom.getAttribute('role')).toBe('combobox')
    expect(dom.getAttribute('aria-autocomplete')).toBe('list')
    expect(dom.getAttribute('aria-expanded')).toBe('true')
    expect(dom.getAttribute('aria-controls')).toBe('uct-slash-menu')
    expect(dom.getAttribute('aria-activedescendant')).toBe('uct-slash-menu-opt-2')
  })

  it('sets the pairing WITHOUT aria-activedescendant when the menu is showing but nothing is active yet', () => {
    const dom = fakeEditorDom()
    applyComboboxWiring(dom, { menuId: 'uct-slash-menu', activeId: null, showing: true })
    expect(dom.getAttribute('role')).toBe('combobox')
    expect(dom.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('strips every combobox attribute once the menu stops showing (dismissed, or an empty item list)', () => {
    const dom = fakeEditorDom()
    applyComboboxWiring(dom, { menuId: 'uct-slash-menu', activeId: 'uct-slash-menu-opt-0', showing: true })
    applyComboboxWiring(dom, { menuId: 'uct-slash-menu', activeId: null, showing: false })
    for (const attr of ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant']) {
      expect(dom.hasAttribute(attr)).toBe(false)
    }
  })

  it('control: a DOM node untouched by this function carries none of these attributes to start with', () => {
    // Non-vacuity for the "strips" case above — if jsdom's createElement
    // pre-populated any of these, the strip test would pass for a reason
    // that has nothing to do with the function under test.
    const dom = fakeEditorDom()
    for (const attr of ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant']) {
      expect(dom.hasAttribute(attr)).toBe(false)
    }
  })

  it('re-showing after a dismiss re-applies the full pairing (not stuck stripped)', () => {
    const dom = fakeEditorDom()
    applyComboboxWiring(dom, { menuId: 'uct-note-link-menu', activeId: 'x', showing: true })
    applyComboboxWiring(dom, { menuId: 'uct-note-link-menu', activeId: null, showing: false })
    applyComboboxWiring(dom, { menuId: 'uct-note-link-menu', activeId: 'uct-note-link-menu-opt-0', showing: true })
    expect(dom.getAttribute('role')).toBe('combobox')
    expect(dom.getAttribute('aria-controls')).toBe('uct-note-link-menu')
    expect(dom.getAttribute('aria-activedescendant')).toBe('uct-note-link-menu-opt-0')
  })
})
