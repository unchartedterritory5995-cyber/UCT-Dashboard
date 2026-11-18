// app/src/components/chart/builder/authoring/settingsOnFormulas.js
//
// ONE SETTING CHANGED ON A FORM'S FORMULAS (the New formula window's Inputs tab).
//
// The conversation dock changes a setting through `applyPatch` (`settingTurn`). The form has no
// authoring state: it holds formula TEXT per output. So here the number is replaced in each tree
// it sits in, the tree is printed back to formula text, and the form takes that text through the
// same door a typed edit uses (its own debounced re-translate).
//
// ⛔ PRINT, RE-PARSE, COMPARE. Text that does not read back to the tree it was printed from is
// refused here, before the form ever holds it (the same check `paramEdit.js` makes).
// ⛔ COMPARE-AND-SET, as in `settingPatch`: nothing is written unless the formulas still derive
// this setting at the value the field displayed.
import { printFormula } from '../../engine/ast/pine'
import { parseFormula, astHash } from '../../engine/ast/parse'
import { collapseExpansions } from '../../engine/ast/callExpansions'
import { parseSlotId, replaceAt, nodeAt } from './slots'
import { settingsOfTrees, settingRefusal } from './derivedSettings'

/**
 * @param list `[{key, tree}]`, the form's formulas as parsed
 * @returns `{ok: true, sources: {[key]: text}}` | `{ok: false, message?, stale?}`
 */
export function formulasWithSetting(list, setting, value) {
  const refusal = settingRefusal(setting, value)
  if (refusal) return { ok: false, message: refusal }
  const now = settingsOfTrees(list).find((s) => s.id === (setting && setting.id))
  if (!now || now.value !== setting.value) return { ok: false, stale: true }
  if (now.value === value) return { ok: false, stale: true }
  const write = now.negated ? Math.abs(value) : value
  const next = new Map()
  for (const id of now.slots) {
    const at = parseSlotId(id)
    const entry = at && list.find((o) => o && o.key === at.output)
    if (!entry) return { ok: false, stale: true }
    const tree = next.get(at.output) || collapseExpansions(entry.tree)
    const offset = at.segs[at.segs.length - 1] === 'n'
    try {
      next.set(at.output, replaceAt(tree, at.segs, offset ? write : { ...nodeAt(tree, at.segs), value: write }))
    } catch { return { ok: false, stale: true } }
  }
  const sources = {}
  for (const [key, tree] of next) {
    let text
    try { text = printFormula(tree) } catch { return { ok: false, message: 'That value could not be written into the formula.' } }
    // print -> parse -> print is a fixed point, and the tree read back holds the same maths
    const back = parseFormula(text)
    let again = null
    try { again = back.ok ? printFormula(collapseExpansions(back.ast)) : null } catch { again = null }
    const same = back.ok && again === text
      && astHash(collapseExpansions(back.ast)) === astHash(tree)
    if (!same) return { ok: false, message: 'That value could not be written into the formula.' }
    sources[key] = text
  }
  return { ok: true, sources }
}
