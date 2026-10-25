// The W10.4 walk fix: what an "Updated version available" actually changes, in plain words.
//
// The two summary sentences (the server's, one per revision) describe what a widget adds up: its measures, split,
// filters, range and accounts. They say nothing about how it is SHOWN, so revision 1 and 2 of the firm's Equity curve
// (a running total with each drawdown shaded) read as the same sentence twice. This file lists what differs between
// the plan a note runs and the newer one: the view, the wave 10 display settings, the member's own fields, the title,
// colour and the rest of the display. A difference no member can see (the plan's format version) is never listed.
//
// ⛔ Pure. It reads two plans and returns sentences; the view names are the builder's own (`VIEW_LABELS`), never a
// second table of them.
import { VIEW_LABELS } from '../../widgetBuilder/builderCatalog'

/** Said when the two revisions differ in nothing a member can see. */
export const NOTHING_VISIBLE = 'Nothing you can see changes in this update.'
/** Said when the note keeps no copy of its own plan to compare with (a plan over 4 KB is stored by reference). */
export const NO_COPY = "This note doesn't keep a copy of its settings to compare with."

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const VIEWS = new Map(VIEW_LABELS)
const viewName = (type) => (VIEWS.get(type) || 'Number').toLowerCase()
const str = (v) => (typeof v === 'string' ? v.trim() : '')
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const quoted = (name) => `“${name}”`

/** The wave 10 display settings, each as `[key, sentence when it is turned on, sentence when it is turned off]`. A
 *  stop rule's number is read from the newer plan. */
const DISPLAY_SWITCHES = [
  ['cumulative', 'Shows a running total, with each drawdown shaded.', 'Shows each period on its own, not a running total.'],
  ['targetGoal', 'Shows your progress toward your P&L goal.', 'No longer shows your P&L goal.'],
  ['quadrants', 'Marks the 1R lines on the scatter.', 'No longer marks the 1R lines.'],
]

function formulaLines(before, after) {
  const was = new Map((Array.isArray(before?.formulas) ? before.formulas : []).filter(isRecord).map((f) => [f.id, f]))
  const now = new Map((Array.isArray(after?.formulas) ? after.formulas : []).filter(isRecord).map((f) => [f.id, f]))
  const out = []
  for (const [id, f] of now) {
    const old = was.get(id)
    const name = str(f.name) || 'a field'
    if (!old) out.push(`Adds its own field ${quoted(name)}.`)
    else if (str(old.name) !== str(f.name)) out.push(`Renames the field ${quoted(str(old.name) || 'a field')} to ${quoted(name)}.`)
    else if (str(old.expr) !== str(f.expr)) out.push(`Works out ${quoted(name)} differently.`)
    else if (str(old.format) !== str(f.format)) out.push(`Shows ${quoted(name)} in a different format.`)
  }
  for (const [id, f] of was) if (!now.has(id)) out.push(`Removes the field ${quoted(str(f.name) || 'a field')}.`)
  return out
}

/**
 * The member-visible differences between the plan a note runs (`before`) and a newer revision (`after`), as plain
 * sentences, in a fixed order. `[]` when nothing visible differs or either plan is missing (the caller says which).
 */
export function planChanges(before, after) {
  if (!isRecord(before) || !isRecord(after)) return []
  const out = []
  const vBefore = isRecord(before.view) ? before.view.type : null
  const vAfter = isRecord(after.view) ? after.view.type : null
  if (vAfter && vBefore !== vAfter) out.push(`Shown as a ${viewName(vAfter)}, not a ${viewName(vBefore)}.`)
  const dBefore = isRecord(before.display) ? before.display : {}
  const dAfter = isRecord(after.display) ? after.display : {}
  for (const [key, on, off] of DISPLAY_SWITCHES) {
    const a = !!dBefore[key]
    const b = !!dAfter[key]
    if (a !== b) out.push(b ? on : off)
  }
  if (!same(dBefore.stopAfter, dAfter.stopAfter)) {
    const n = Number.isInteger(dAfter.stopAfter) ? dAfter.stopAfter : null
    out.push(n ? `Says when a losing streak reaches your stop rule of ${n} in a row.` : 'No longer says when to stop.')
  }
  out.push(...formulaLines(before, after))
  const tBefore = dBefore.titleAuto === false ? str(dBefore.title) : ''
  const tAfter = dAfter.titleAuto === false ? str(dAfter.title) : ''
  if (tBefore !== tAfter && tAfter) out.push(`Is titled ${quoted(tAfter)}.`)
  if (str(dBefore.subtitle) !== str(dAfter.subtitle)) out.push('Has a different subtitle.')
  if (!same(dBefore.target, dAfter.target)) {
    out.push(typeof dAfter.target === 'number' ? `Has a target of ${dAfter.target.toLocaleString('en-US')}.`
      : 'No longer has a target.')
  }
  if (str(dBefore.accent) !== str(dAfter.accent) && str(dAfter.accent)) out.push(`Is drawn in ${str(dAfter.accent)}.`)
  if (dBefore.showN !== dAfter.showN && typeof dAfter.showN === 'boolean') {
    out.push(dAfter.showN ? 'Shows the count behind each figure.' : 'Hides the count behind each figure.')
  }
  if (!same(before.sort, after.sort)) out.push('Sorts its rows differently.')
  return out
}
