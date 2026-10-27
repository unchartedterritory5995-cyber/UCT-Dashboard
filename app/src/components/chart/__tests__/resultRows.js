// app/src/components/chart/__tests__/resultRows.js
//
// How a test reaches a catalogue result row — in the Add surface
// (`ChartSettingsIndicators`) and in the Indicator library dialog.
//
// ⛔ A RESULT ROW IS NOT AN `option` ANY MORE. It was a `role="option"` `<li>`
// holding buttons ("Add another", a user formula's Modify / Edit formula /
// Custom copy), which axe reports as `nested-interactive`; an option cannot
// contain a control. The row is a plain `<li>` now and its keyboard door is the
// `<button data-result-primary>` round its title line. These helpers find that
// button by its accessible name and hand back the ROW, because the row is what
// carries `data-def-id`, the "Active" word and the click handler a test drives.
import { screen, within, waitFor } from '@testing-library/react'

const PRIMARY = '[data-result-primary="true"]'

const scope = (container) => (container ? within(container) : screen)

/** Every result row under `container` (default: the document), in order. */
export function resultRows(container = document.body) {
  return [...container.querySelectorAll(PRIMARY)].map((b) => b.closest('li'))
}

/** The title buttons whose accessible name matches `name`. */
function primariesNamed(name, container) {
  return scope(container).queryAllByRole('button', { name })
    .filter((b) => b.matches(PRIMARY))
}

/** The one result row whose title matches `name`, or null. Throws on two. */
export function queryResultRow(name, container) {
  const hits = primariesNamed(name, container)
  if (hits.length > 1) throw new Error(`resultRows: ${hits.length} result rows match ${String(name)}`)
  return hits.length ? hits[0].closest('li') : null
}

/** The one result row whose title matches `name`. Throws when there is none. */
export function getResultRow(name, container) {
  const row = queryResultRow(name, container)
  if (!row) throw new Error(`resultRows: no result row matches ${String(name)}`)
  return row
}

/** `getResultRow`, retried until it appears. */
export function findResultRow(name, container, options) {
  return waitFor(() => getResultRow(name, container), options)
}

/** The title button inside a result row — the keyboard door. */
export function primaryOf(row) {
  return row.querySelector(PRIMARY)
}

/**
 * Is this Add-surface result ON the chart? Read the way a screen reader gets it:
 * the title button's `aria-describedby` resolves to the row's "Active" word.
 * (This was the option's `aria-selected`. The library DIALOG's rows are toggles
 * and say it with `aria-pressed` on the same button instead.)
 */
export function resultIsOn(row) {
  const ids = (primaryOf(row)?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
  return ids.some((id) => row.ownerDocument.getElementById(id)?.textContent === 'Active')
}

/**
 * Every interactive element that contains another focusable element — what axe
 * calls `nested-interactive`. Interactive = a native control, a link, an element
 * with a widget role, or anything with a `tabindex`. Focusable = the same set,
 * minus a `tabindex` below zero, which a person cannot Tab to.
 * Returns readable descriptions, so a red rail names the element.
 */
const NATIVE = 'button, a[href], input, select, textarea, summary, [contenteditable="true"]'
const WIDGET_ROLES = ['button', 'link', 'option', 'checkbox', 'radio', 'switch', 'tab',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'gridcell', 'slider',
  'spinbutton', 'combobox', 'textbox', 'searchbox']
const ROLE_SELECTOR = WIDGET_ROLES.map((r) => `[role="${r}"]`).join(', ')
const INTERACTIVE = `${NATIVE}, ${ROLE_SELECTOR}, [tabindex]`

const describe_ = (el) => {
  const id = el.getAttribute('data-def-id') || el.getAttribute('data-testid') || el.id || ''
  const role = el.getAttribute('role')
  return `<${el.tagName.toLowerCase()}${role ? ` role="${role}"` : ''}${id ? ` "${id}"` : ''}>`
}

export function nestedInteractive(container) {
  const out = []
  for (const outer of container.querySelectorAll(INTERACTIVE)) {
    if (outer.getAttribute('role') === 'none' || outer.getAttribute('role') === 'presentation') continue
    for (const inner of outer.querySelectorAll(INTERACTIVE)) {
      const t = inner.getAttribute('tabindex')
      if (t !== null && Number(t) < 0) continue
      if (inner.hasAttribute('disabled')) continue
      out.push(`${describe_(outer)} contains ${describe_(inner)}`)
    }
  }
  return out
}

// ─── THE "SERIES ON THIS CHART" STRUCTURE LIST ────────────────────────────
// ⛔ Its rows were `role="option"` in a `role="listbox"`, holding the reorder
// grip button — nested-interactive again, and a listbox may not own the grip as a
// sibling either. Each `[data-structure-row]` is a plain row now; its roving tab
// stop is `<button data-row-primary>`, and `aria-current` says what
// `aria-selected` said.

/** The structure list itself (the `onKeyDown` target for ↑/↓/Home/End). */
export function structureList(container = document.body) {
  return container.querySelector('[role="group"][aria-label="Series on this chart"]')
}

/** A structure row's name button — its roving tab stop. */
export function rowPrimaryOf(row) {
  return row.querySelector('[data-row-primary]')
}

/** Is this structure row the selected one? */
export function rowIsSelected(row) {
  return rowPrimaryOf(row)?.getAttribute('aria-current') === 'true'
}
