// app/src/testing/builder/builderStart.testkit.js
//
// ⭐ DIRECTION A (owner 2026-11-16) — how a test walks the formula window the way a
// member does. A new formula with no door opens on the START VIEW (describe it, or
// start from a script / a picture / conditions / a UCT setup, or write it yourself);
// every start lands in the EDITOR (Formula · Source · Inputs · Plots · Ask tabs). The
// Formula, Inputs and Plots panels stay mounted but `hidden` off their tab.
//
// Test-only helpers: nothing in the product imports this file.
import { screen, fireEvent, within } from '@testing-library/react'

const START_ID = Object.freeze({
  formula: 'start-formula', pine: 'start-pine', image: 'start-image', picker: 'start-picker', library: 'start-library',
})
const SOURCE_TAB = Object.freeze({ pine: 'Script', image: 'Picture', picker: 'Conditions', library: 'Setup' })
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** From the start view, "Write the formula myself →" — a no-op once the editor is open. */
export function writeMyself() {
  const link = screen.queryByTestId(START_ID.formula)
  if (link) fireEvent.click(link)
}

/** Back to the start view ("‹ Back to start" — a new formula only). */
export function toStart() {
  const back = screen.queryByTestId('builder-back')
  if (back) fireEvent.click(back)
}

/** Start a NEW formula from one of the four sources (or 'formula'): goes back to the start
 *  view first when the editor is open, exactly as a member would with "‹ Back to start". */
export function startFrom(kind) {
  const id = START_ID[kind]
  if (!id) throw new Error(`startFrom: no start called ${kind}`)
  if (!screen.queryByTestId(id)) {
    // an edit has no "back to start": its Source tab carries the same four starts
    const source = screen.queryByRole('tab', { name: 'Source' })
    if (source) fireEvent.click(source)
    else toStart()
  }
  fireEvent.click(screen.getByTestId(id))
}

/** Open a source's panel: its editor tab when this formula already came from it, else
 *  a new start from it (the editor keeps the formula, inputs and plots across that). */
export function openSource(kind) {
  const t = screen.queryByRole('tab', { name: SOURCE_TAB[kind] })
  if (t) { fireEvent.click(t); return }
  startFrom(kind)
}

/** Click an editor tab by its accessible name (string or RegExp). */
export function openTab(name) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

/** The formula box (plot 1), in the editor — entering it from the start view first. */
export function formulaBox() {
  writeMyself()
  return screen.getByLabelText('Formula')
}

/** Bring the editor tab that holds `el` on screen (its panel is mounted but `hidden`
 *  off its tab), the way a member clicks Inputs / Plots before using what is there. */
export function reveal(el) {
  const panel = el && el.closest && el.closest('[data-panel][hidden]')
  if (panel) openTab(new RegExp(`^${esc(panel.getAttribute('data-panel'))}`))
  return el
}

function openNamedTab(re) {
  writeMyself()
  const t = screen.getByRole('tab', { name: re })
  if (t.getAttribute('aria-selected') !== 'true') fireEvent.click(t)
}
/** Open the Plots tab (from the start view too). */
export const openPlots = () => openNamedTab(/^Plots/)
/** Open the Inputs tab (from the start view too). */
export const openInputs = () => openNamedTab(/^Inputs/)

/** Pick `optionLabel` (exact) in the `ChoiceMenu` whose aria label starts with `label`. */
export function pickChoice(label, optionLabel) {
  const name = new RegExp(`^${esc(label)}:`)
  reveal(screen.getByRole('button', { name, hidden: true }))
  fireEvent.click(screen.getByRole('button', { name }))
  const list = screen.getByRole('listbox', { name: label })
  fireEvent.click(within(list).getByRole('option', { name: optionLabel }))
}

/** The label a `ChoiceMenu` currently shows, read off its accessible name. */
export function choiceValue(label) {
  const btn = screen.getByRole('button', { name: new RegExp(`^${esc(label)}:`), hidden: true })
  return btn.getAttribute('aria-label').slice(String(label).length + 2)
}

/** The sheet's own option words for the values a test speaks in (a ChoiceMenu shows the
 *  label, not the value). A renamed label fails here, loudly. */
const CHOICE_LABEL = Object.freeze({
  line: 'Line', stepline: 'Step line', histogram: 'Histogram / columns', area: 'Area', baseline: 'Baseline',
  markers: 'Circles', pane: 'Own pane', price: 'Overlay on price',
})

/** Choose `value` in the ChoiceMenu labelled `label` (e.g. ('Plot 2 style', 'histogram')). */
export function chooseValue(label, value) {
  const option = CHOICE_LABEL[value]
  if (!option) throw new Error(`chooseValue: no label known for ${value}`)
  if (choiceValue(label) === option) return
  pickChoice(label, option)
}

/** The VALUE a ChoiceMenu holds (the inverse of `CHOICE_LABEL`). */
export function choiceOf(label) {
  const shown = choiceValue(label)
  const hit = Object.entries(CHOICE_LABEL).find(([, l]) => l === shown)
  return hit ? hit[0] : shown
}
