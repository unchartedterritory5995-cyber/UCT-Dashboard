// app/src/components/chart/builder/authoring/derivedSettings.js
//
// ─── ⭐ THE NUMBERS OF A BUILT INDICATOR, AS SETTINGS (Studio track, 2026-11-17) ───────────
//
// ⚰️ THE GAP (seen in the owner's own browser): an indicator built from a description showed
// "Inputs 0". Its "25 sessions" or "1.5 times" could be changed only by another turn of the
// conversation or by editing the formula. Declared inputs cannot close it: a declared input
// works as a threshold or a multiplier and is REFUSED as a length (`resolve:window`, "a window
// must be a whole-number literal"), so the assistant declaring inputs would give a knob for 70
// and none for 14.
//
// THE RULE (the engine owner's, 2026-11-17): STORE NOTHING. The settings are a pure function of
// the tree being shown, derived at read time from its own parameter slots (`slots.js`). A change
// is an ORDINARY TREE EDIT, the existing `set_slot` op through `applyPatch`: the literal is
// replaced, the formula re-printed and round-tripped, the window validators run, the name follows
// the maths, and Undo holds the step. No parameter identity is minted, so `param_manifest.py` and
// its rule that a saved manifest never changes are not involved.
//
// ⛔ A SETTING IS VALID ONLY FOR THE TREE IT WAS DERIVED FROM. `settingPatch` re-derives and
// refuses unless the setting still names the same slots at the value the control displayed
// (compare-and-set); the caller re-derives after every change.
//
// ⛔ NOT EVERY LITERAL IS A SETTING. A member tunes a length, a threshold, a multiple. They do not
// tune the 100 that makes a ratio a percent, the 1 and 0 a yes/no is counted with, the 1 / 2 / 3
// that pick a colour state, the two zeros that spell "no value", or "the bar before" and "two bars
// before" of a pattern over neighbouring bars (`[1]`, `[2]`). Those stay in the formula, where
// the formula editor shows them. (Checked against the fourteen house indicators, 2026-11-17: these
// rules leave their lengths, levels and multiples and nothing else.)

import { slotsOfTree, outputTrees, nodeAt, parsePath } from './slots'
import { nameOfTree } from './derivedName'
import { PATCH_CONTRACT, PATCH_LIMITS } from './patchValidate'
import { collapseExpansions } from '../../engine/ast/callExpansions'
import { MULTI_STATES } from '../../engine/ast/parse'
import { libraryParts } from './checkedLibrary'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isOp = (n, name) => isObj(n) && n.type === 'op' && n.name === name
const isNum = (n, v) => isObj(n) && n.type === 'num' && n.value === v

/** The member's word for what a number does in its place. */
const ROLE_WORDS = Object.freeze({
  threshold: 'level', multiplier: 'multiple', length: 'length', period: 'length', window: 'length',
  'bars-ago': 'bars back', constant: 'number',
})
const CONSTANT_ROLE = Object.freeze({ '*': 'multiple', '/': 'divisor', '+': 'amount', '-': 'amount' })

/** Is this literal structure rather than something a member tunes? */
function structural(slot, node, parent) {
  if (slot.role === 'bars-ago') return slot.value <= 2                        // neighbouring bars
  if (!isObj(parent)) return false
  // an arm of a choice that is a small whole number: a 1 / 0 count, or a colour state's index
  if (isOp(parent, '?:')) return parent.args.indexOf(node) > 0 && Number.isInteger(node.value) && node.value >= 0 && node.value <= 9
  if ((isOp(parent, '*') || isOp(parent, '/')) && node.value === 100) return true   // a percent
  if (isOp(parent, '/') && parent.args.every((a) => isNum(a, 0))) return true       // 0 / 0: "no value"
  if ((isOp(parent, '-') || isOp(parent, '+')) && node.value === 1) return true     // ratio - 1
  return false
}

function roleWord(slot, parent) {
  if (slot.window && slot.role !== 'bars-ago') return 'length'
  if (isObj(parent) && parent.type === 'op' && CONSTANT_ROLE[parent.name]) return CONSTANT_ROLE[parent.name]
  return ROLE_WORDS[slot.role] || 'number'
}

/** The longest caption shown whole; a longer one keeps its start and its end. */
export const CAPTION_MAX = 72
const clipMiddle = (s) => (s.length <= CAPTION_MAX ? s : `${s.slice(0, 38).trimEnd()} … ${s.slice(-28).trimStart()}`)

/** The plain words of the smallest expression a number sits in ("SMA 50 (Volume)", "Williams %R 9 (High, Low)").
 *  ⭐ 2026-11-20: in the settings row's own wording (`derivedName.CAPTION_CALL_WORDS`), which a NAME never uses. */
function captionOf(parent, node) {
  try {
    const words = nameOfTree(isObj(parent) ? parent : node, 0, 'caption')
    return typeof words === 'string' && words.trim() ? words.trim() : null
  } catch { return null }
}

/**
 * Every tunable number of `def`, in plot order.
 * Numbers that are THE SAME NUMBER IN THE SAME PLACE (an identical enclosing expression, which is
 * how one condition comes to sit in two outputs: the count and its marker) are ONE setting, so a
 * change moves them together.
 * @returns {Array<{id, caption, role, value, whole, min, slots: string[]}>}
 */
export function settingsOf(def) {
  if (!isObj(def)) return []
  return settingsOfTrees(outputTrees(def), { inputs: (Array.isArray(def.inputs) ? def.inputs : []).map((x) => x && x.key) })
}

// ⭐ 2026-11-18 — A CHECKED LIBRARY INDICATOR'S SETTINGS ARE THE ENTRY'S OWN (`checkedLibrary.js`).
// Where a formula holds a library output, the numbers inside it are not read one by one. Each
// DECLARED setting of the entry is one setting here, holding every place it sits, in every output
// of that indicator that has the same value: KAMA's efficiency length is one field for its two
// places, and the Directional Movement Index's length moves +DI, -DI and ADX together. A change is
// one patch with one edit per place, applied whole or not at all, so one place can never move
// alone. A number of the formula that is NOT a declared setting (the 2 in 2 / (n + 1), the 0 in
// 0 - volume) is not a setting: changing it would make a different indicator.
const pathKey = (segs) => segs.join('.')

/** `{slot path → {part, param}}` for every setting place, and the paths of the parts themselves. */
function libraryPlaces(tree, inputs) {
  const sites = new Map()
  const roots = []
  for (const part of libraryParts(tree, inputs)) {
    roots.push(pathKey(part.at))
    const params = new Map(part.entry.params.map((p) => [p.key, p]))
    for (const place of part.places) {
      sites.set(pathKey(place.offset ? [...place.path, 'n'] : place.path), { part, param: params.get(place.key) })
    }
  }
  const inside = (segs) => roots.some((r) => r === '' || pathKey(segs) === r || pathKey(segs).startsWith(`${r}.`))
  return { sites, inside }
}

const isSelf = (n) => isObj(n) && n.type === 'series' && n.name === 'self'
function readsSelf(n) {
  const stack = [n]
  while (stack.length) {
    const x = stack.pop()
    if (isSelf(x)) return true
    if (isObj(x) && Array.isArray(x.args)) stack.push(...x.args)
  }
  return false
}
const twoArgs = (n, name) => (isOp(n, name) && Array.isArray(n.args) && n.args.length === 2 ? n.args : null)

/** Where the gain `k` sits when a one-value update has the shape `self + k * (x - self)` with a
 *  plain-number k (either order of the sum and of the product): its two `args` indices from the
 *  update, or null. The door's `_settled_gain_path`, ported. */
function settledGainPath(update) {
  const plus = twoArgs(update, '+')
  if (!plus) return null
  for (const i of [0, 1]) {
    const times = twoArgs(plus[1 - i], '*')
    if (!isSelf(plus[i]) || !times) continue
    for (const j of [0, 1]) {
      const k = times[j]
      const minus = twoArgs(times[1 - j], '-')
      if (isObj(k) && k.type === 'num' && typeof k.value === 'number' && minus && isSelf(minus[1]) && !readsSelf(minus[0])) return [1 - i, j]
    }
  }
  return null
}

/**
 * IS THE NUMBER AT `segs` ONE OF A RUNNING VALUE'S OWN? The name of the function that owns it, or
 * null. (`segs`: the `args` indices from the formula's root.)
 *
 * ⛔ THOSE NUMBERS ARE THE FORMULA'S OWN, NOT SETTINGS.
 *  - EVERY number inside several linked running values (`accum2`..`accum4`). Create Indicator
 *    accepts such a formula only after checking, from its coefficients, that its starting values
 *    stop mattering inside its window, and tells the member after how many bars. One coefficient
 *    changed alone would be a different filter that nothing checked (and may never settle), under
 *    a sentence that still says it does. A value that needs another on the same bar also repeats
 *    that value's update, so one length sits in several places that must move together. Measured
 *    before this rule: a two-pole smoother showed 10 inputs and a stretched range position 14, each
 *    captioned with the whole formula.
 *  - Of a one-value running value (`accum`): its warm-up, and its gain `k` when the update is the
 *    shape that can settle. The sentence about where the value starts is written from exactly
 *    those two. Any other number inside it (the length of an average it reads, the multiple of a
 *    stop) is a setting as ever.
 * The member changes one by asking for it in words, which goes back through the check.
 * The door holds the same rule (`definition_conversation.running_value_owns`);
 * `tests/fixtures/authoring/running_value_own_numbers.json` holds the two equal, case by case.
 */
export function runningValueOwns(tree, segs) {
  let node = tree
  for (let i = 0; i < segs.length; i += 1) {
    const args = isObj(node) && Array.isArray(node.args) ? node.args : null
    if (isObj(node) && node.type === 'call') {
      if (Object.prototype.hasOwnProperty.call(MULTI_STATES, node.name)) return node.name
      if (node.name === 'accum' && args && args.length === 3) {
        const rest = segs.slice(i).join('.')
        const gain = settledGainPath(args[1])
        if (rest === '2' || (gain && rest === `1.${gain[0]}.${gain[1]}`)) return 'accum'
      }
    }
    if (!args || !Number.isInteger(segs[i]) || segs[i] >= args.length) return null
    node = args[segs[i]]
  }
  return null
}

/** Why `value` is outside what a library setting can be, in a member's words; null when it can. */
function libraryRefusal(setting, value) {
  const { min, max, integer } = setting.library
  if (integer && !Number.isInteger(value)) return `This is a count of bars: a whole number from ${min} to ${max}.`
  if (value < min || value > max) {
    return integer
      ? `This is a count of bars: a whole number from ${min} to ${max} (a chart holds ${max} bars, so a longer one could never have a value).`
      : `Enter a number from ${min} to ${max}.`
  }
  return null
}

/**
 * The same, over bare trees: `[{key, tree}]` in plot order. The New formula window's form holds
 * formulas, not a definition, and derives its Inputs from them with this.
 */
export function settingsOfTrees(list, { inputs = [] } = {}) {
  const outputs = (Array.isArray(list) ? list : []).filter((o) => o && typeof o.key === 'string' && isObj(o.tree))
  const trees = new Map(outputs.map((o) => [o.key, collapseExpansions(o.tree)]))
  const library = new Map([...trees].map(([key, tree]) => [key, libraryPlaces(tree, inputs)]))
  const groups = new Map()
  for (const slot of outputs.flatMap((o) => slotsOfTree(o.key, o.tree))) {
    if (slot.kind !== 'number' || typeof slot.value !== 'number' || !Number.isFinite(slot.value)) continue
    const tree = trees.get(slot.output)
    const segs = parsePath(slot.path)
    if (!tree || !segs) continue
    const lib = library.get(slot.output)
    const site = lib.sites.get(slot.path)
    if (site) {
      // one setting per declared parameter of the entry, at one value, across its outputs
      const { part, param } = site
      const sign = `library|${part.entry.id}|${param.key}|${slot.value}`
      const had = groups.get(sign)
      if (had) { had.slots.push(slot.id); continue }
      groups.set(sign, {
        caption: param.label, captionFull: param.label, role: param.integer ? 'length' : 'multiple',
        value: slot.value, whole: !!param.integer, min: param.min, negated: false, slots: [slot.id],
        library: { id: part.entry.id, name: part.entry.name, param: param.key, label: param.label,
          min: param.min, max: param.max, integer: !!param.integer },
      })
      continue
    }
    if (lib.inside(segs.filter((x) => x !== 'n'))) continue                // the formula's own number, not a setting
    if (runningValueOwns(tree, segs)) continue                             // a running value's own number: checked with it
    const offset = segs[segs.length - 1] === 'n'
    const at = offset ? segs.slice(0, -1) : segs
    const node = nodeAt(tree, at)
    const parent = offset ? node : (at.length ? nodeAt(tree, at.slice(0, -1)) : null)
    if (!isObj(node) || structural(slot, node, parent)) continue
    const whole = !!slot.window || slot.role === 'bars-ago'
    const role = roleWord(slot, parent)
    const index = !offset && isObj(parent) && Array.isArray(parent.args) ? parent.args.indexOf(node) : -1
    const sign = `${role}|${slot.negated ? '-' : ''}${slot.value}|${index}|${JSON.stringify(isObj(parent) ? parent : node)}`
    const had = groups.get(sign)
    if (had) { had.slots.push(slot.id); continue }
    const full = captionOf(parent, node) || slot.label
    groups.set(sign, {
      // a number written negative ("down 3% or more": `<= -3`) is shown negative; the tree holds
      // its size under a minus sign, and that is what an edit writes
      caption: clipMiddle(full), captionFull: full, role, value: slot.negated ? -slot.value : slot.value, whole,
      min: whole ? 1 : null, negated: !!slot.negated, slots: [slot.id],
    })
  }
  const all = [...groups.values()]
  // The bare label ("Efficiency length") when every setting belongs to ONE library indicator. The
  // indicator's name goes in front when the caption has to tell settings apart: two library
  // indicators, or a library setting beside a number of the member's own formula.
  const held = new Set(all.filter((g) => g.library).map((g) => g.library.id))
  const prefix = held.size > 1 || (held.size === 1 && all.some((g) => !g.library))
  return all.map((g) => {
    const caption = g.library && prefix ? `${g.library.name}: ${g.library.label}` : g.caption
    return { ...g, caption: g.library ? caption : g.caption, captionFull: g.library ? caption : g.captionFull, id: g.slots.join('|') }
  })
}

/** How many tunable numbers `def` has (the Inputs count). */
export const settingsCount = (def) => settingsOf(def).length

/** Why `value` cannot be this setting's value, in a member's words; null when it can. */
export function settingRefusal(setting, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.'
  if (setting.library) return libraryRefusal(setting, value)
  if (setting.whole && (!Number.isInteger(value) || value < 1)) return 'This is a count of bars: a whole number of at least 1.'
  // ⛔ A NUMBER KEEPS ITS SIGN HERE. Crossing zero changes the formula's shape (a minus sign appears
  // or goes), which is a change to describe, not a value to type.
  if (!setting.whole && setting.negated && value > 0) return 'This number is negative in the formula. Keep it at or below zero, or describe the change instead.'
  if (!setting.whole && !setting.negated && value < 0) return 'This number cannot go below zero here. Describe the change instead.'
  return null
}

/**
 * The patch that sets `setting` to `value` on `state.working`: one `set_slot` per place the number
 * sits. ⛔ COMPARE-AND-SET: null unless the working indicator still derives this exact setting (the
 * same places, at the value the control displayed). The caller re-derives and tries again.
 */
export function settingPatch(state, setting, value) {
  if (!state || !isObj(state.working) || !setting || settingRefusal(setting, value)) return null
  const now = settingsOf(state.working).find((s) => s.id === setting.id)
  if (!now || now.value !== setting.value || now.slots.length > PATCH_LIMITS.maxOpsPerPatch) return null
  if (now.value === value) return null
  return {
    contract: PATCH_CONTRACT, baseRevision: state.revision, disposition: 'change',
    ops: now.slots.map((slot) => ({ op: 'set_slot', slot, value: now.negated ? Math.abs(value) : value })), assumptions: [],
  }
}
