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

import { parameterSlots, outputTrees, nodeAt, parsePath } from './slots'
import { nameOfTree } from './derivedName'
import { PATCH_CONTRACT, PATCH_LIMITS } from './patchValidate'
import { collapseExpansions } from '../../engine/ast/callExpansions'

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

/** The plain words of the smallest expression a number sits in ("SMA 50 (Volume)"). */
function captionOf(parent, node) {
  try {
    const words = nameOfTree(isObj(parent) ? parent : node)
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
  const trees = new Map(outputTrees(def).map((o) => [o.key, collapseExpansions(o.tree)]))
  const groups = new Map()
  for (const slot of parameterSlots(def)) {
    if (slot.kind !== 'number' || typeof slot.value !== 'number' || !Number.isFinite(slot.value)) continue
    const tree = trees.get(slot.output)
    const segs = parsePath(slot.path)
    if (!tree || !segs) continue
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
  return [...groups.values()].map((g) => ({ ...g, id: g.slots.join('|') }))
}

/** How many tunable numbers `def` has (the Inputs count). */
export const settingsCount = (def) => settingsOf(def).length

/** Why `value` cannot be this setting's value, in a member's words; null when it can. */
export function settingRefusal(setting, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.'
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
