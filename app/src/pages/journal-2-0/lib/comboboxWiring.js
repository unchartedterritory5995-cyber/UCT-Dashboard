/**
 * Shared ARIA combobox wiring for the two ProseMirror-Suggestion-driven
 * popups that turn typing into a live-filtered menu — `[[` note links
 * (`NoteLinkMenu.jsx`) and `/` slash commands (`SlashMenu.jsx`).
 *
 * ⛔ THE EDITOR IS THE FOCUSED ELEMENT, SO IT CARRIES THE COMBOBOX ROLE.
 * The popup itself is a `role="listbox"` the member never focuses — a
 * combobox/autocomplete pairing on an element nobody's focus ever reaches
 * announces nothing to a screen reader. `aria-controls` names the listbox,
 * `aria-activedescendant` tracks the highlighted option (both already
 * existed before this file — see NoteLinkMenu.jsx / SlashMenu.jsx's own
 * "ARIA combobox wiring" comments); `role="combobox"` + `aria-autocomplete`
 * + `aria-expanded` are the pairing that was missing (Notebook competitive
 * gap ledger, Wave D closure-pass residual debt, closed 2026-09-22).
 *
 * ⛔ APPLIED ONLY WHILE THE MENU IS ACTUALLY SHOWING. Both callers already
 * had this lifecycle for aria-controls/aria-activedescendant (an editor
 * that is ALWAYS a combobox, even with no `[[`/`/` menu open, would be a
 * false announcement the rest of the time); this function keeps every
 * attribute paired to the same `showing` condition rather than letting one
 * subset drift from the other.
 */
export function applyComboboxWiring(editorDom, { menuId, activeId, showing }) {
  if (!editorDom) return
  if (showing) {
    editorDom.setAttribute('role', 'combobox')
    editorDom.setAttribute('aria-autocomplete', 'list')
    editorDom.setAttribute('aria-expanded', 'true')
    editorDom.setAttribute('aria-controls', menuId)
    if (activeId) editorDom.setAttribute('aria-activedescendant', activeId)
    else editorDom.removeAttribute('aria-activedescendant')
  } else {
    editorDom.removeAttribute('role')
    editorDom.removeAttribute('aria-autocomplete')
    editorDom.removeAttribute('aria-expanded')
    editorDom.removeAttribute('aria-controls')
    editorDom.removeAttribute('aria-activedescendant')
  }
}
