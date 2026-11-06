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
// Tier 4 fix round 2 (live scorecard, axe `aria-prohibited-attr` on `.tiptap`): the editor's OWN resting role and
// aria-multiline (NoteEditorPage's NOTE_BODY_ARIA: a named multi-line textbox) are saved when a menu takes the
// combobox role, and PUT BACK when it closes. This used to REMOVE the role on close, which left `aria-label` on a
// role-less div -- one of the two ways production lost it. aria-multiline is not allowed on a combobox, so it steps
// aside while the menu shows. ProseMirror applies its `attributes` as a node decoration that changes only when the
// props do, so it does not re-stamp them over this while the menu is open.
const resting = new WeakMap()

export function applyComboboxWiring(editorDom, { menuId, activeId, showing }) {
  if (!editorDom) return
  if (showing) {
    if (!resting.has(editorDom)) {
      resting.set(editorDom, { role: editorDom.getAttribute('role'), multiline: editorDom.getAttribute('aria-multiline') })
    }
    editorDom.removeAttribute('aria-multiline')
    editorDom.setAttribute('role', 'combobox')
    editorDom.setAttribute('aria-autocomplete', 'list')
    editorDom.setAttribute('aria-expanded', 'true')
    editorDom.setAttribute('aria-controls', menuId)
    if (activeId) editorDom.setAttribute('aria-activedescendant', activeId)
    else editorDom.removeAttribute('aria-activedescendant')
  } else {
    const rest = resting.get(editorDom)
    resting.delete(editorDom)
    if (rest?.role) editorDom.setAttribute('role', rest.role)
    else editorDom.removeAttribute('role')
    if (rest?.multiline) editorDom.setAttribute('aria-multiline', rest.multiline)
    editorDom.removeAttribute('aria-autocomplete')
    editorDom.removeAttribute('aria-expanded')
    editorDom.removeAttribute('aria-controls')
    editorDom.removeAttribute('aria-activedescendant')
  }
}
