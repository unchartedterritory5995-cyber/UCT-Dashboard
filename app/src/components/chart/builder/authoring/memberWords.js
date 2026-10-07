// app/src/components/chart/builder/authoring/memberWords.js
//
// ─── ⭐ P3 UX — WHAT A MEMBER READS WHEN THE ENGINE SAYS NO ────────────────────
//
// The engine's refusals are written for engineers and for the model's retry
// (`authoring:unrepresentable` with schema paths, `patch:stale` with revision
// numbers, `"value#0.1" is not a slot id`). A member cannot act on those, and
// most of them describe a patch the MODEL got wrong, not anything the member
// did. So every conversation surface maps an engine error through ONE function,
// `memberError`, into a plain sentence — and keeps the machine code and the
// engine's own message as a secondary detail for support.
//
// ⛔ THIS NEVER CHANGES WHAT WAS DECIDED. A refusal is still a refusal and
// nothing was applied; only its words change. An error the map does not know
// gets the generic sentence, never the raw message as the headline.
//
// `conversationEditability` is the same honesty BEFORE the first turn: the
// sheet's opened definition is checked with the engine's own two guards
// (`modelOf`, `fidelityResidual`) — the exact checks a first change would hit —
// so the member is told up front, instead of on the first change.

import { modelOf, fidelityResidual, AuthoringError } from './model'

const GENERIC = 'UCT Intelligence proposed a change that does not fit this indicator, so nothing was applied. Try saying it another way.'

const KIND_TEXT = 'This indicator is built in a form UCT Intelligence cannot edit yet. You can still edit it manually.'
const UNREPRESENTABLE_TEXT = 'This indicator has parts UCT Intelligence cannot reproduce yet, so it cannot be changed by conversation. You can still edit it manually.'

/** code → member sentence. `n` names the output the error is about (its label). */
const BY_CODE = Object.freeze({
  'patch:stale': () => 'The indicator changed while that reply was on its way, so nothing was applied. Send it again.',
  'patch:empty': () => 'UCT Intelligence did not propose any change.',
  'authoring:kind': () => KIND_TEXT,
  'authoring:unrepresentable': () => UNREPRESENTABLE_TEXT,
  'authoring:no-output': () => 'This indicator has no line or condition UCT Intelligence can work with.',
  'authoring:no-source': () => 'This indicator was saved without its formula text, so UCT Intelligence cannot edit it. You can still edit it manually.',
  'definition:none': () => 'There is no indicator yet — describe the one you want first.',
  'definition:invalid': () => 'That change would not leave a valid indicator, so nothing was applied.',
  'create:exists': () => 'You are already working on an indicator — describe what to change in it.',
  'clause:numeric-operand': (n) => `${n ? `${n} is` : 'That is'} a number, not a yes/no — say what to compare it to (for example "above 70") before adding a condition.`,
  'tree:repaints': () => 'That formula would read future bars and repaint, so it cannot be saved.',
  'tree:unsupported-node': () => 'That needs something UCT Intelligence cannot build by conversation yet.',
  'output:last': () => 'An indicator needs at least one line or condition, so the last one cannot be removed.',
  'output:referenced': (n) => `${n || 'That output'} is used by another part of the indicator (a colouring or fill), so it cannot be removed here.`,
  'output:limit': () => 'This indicator already has as many lines as it can hold.',
  'style:has-marker': (n) => `${n || 'That output'} is drawn as markers — remove the marker before changing its line style.`,
  'marker:none': (n) => `${n || 'That output'} has no marker to remove.`,
  'paint:none': (n) => `${n || 'That output'} has no colouring to remove.`,
  'paint:foreign': (n) => `An imported colouring already reads ${n || 'that output'}; UCT Intelligence will not overwrite it.`,
  'request:none': () => 'There is no pending alert or header value like that to cancel.',
})

/** Code families that describe a patch the MODEL got wrong (a slot id that does
 *  not exist, a schema path, a tree that does not print) — nothing the member
 *  did or can act on. They get the generic sentence; the detail keeps the code. */
const MODEL_FAULT = /^(schema:|patch:|assumption:|slot:unknown|slot:kind|slot:series|clause:unknown|output:unknown|output:duplicate|output:reserved|create:key-required|tree:not-canonical|tree:unprintable|tree:round-trip|engine:error|info-value:)/

/** The engine's own message with the output's key said as its name. */
function named(message, key, n) {
  if (!key || !n || n === key) return message
  let m = message.startsWith(`${key}: `) ? `${n}: ${message.slice(key.length + 2)}` : message
  m = m.split(`"${key}"`).join(n)
  return m
}

/**
 * @param {{code?: string, message?: string, output?: string, paths?: string[]}} e an engine errors[] entry
 * @param {{nameOf?: (key: string) => string}} [opts]
 * @returns {{text: string, code: string, detail: string}}
 */
export function memberError(e, { nameOf = null } = {}) {
  const code = String((e && e.code) || 'engine:error')
  const message = String((e && e.message) || '')
  const key = e && typeof e.output === 'string' ? e.output : null
  const n = key ? (nameOf ? nameOf(key) : key) : null
  const paths = e && Array.isArray(e.paths) && e.paths.length && !message.includes(e.paths[0]) ? ` (${e.paths.join(', ')})` : ''
  const detail = `${code}: ${message}${paths}`
  let text
  if (BY_CODE[code]) text = BY_CODE[code](n)
  else if (MODEL_FAULT.test(code) || !message) text = GENERIC
  // a gate's own refusal (P0 sentences: "a number cannot be an alert …", a
  // control's title, a whole-number rule) is already member language
  else text = named(message, key, n)
  return Object.freeze({ text, code, detail })
}

/** A failed conversation save (`storeConversation`) in member words. */
export function memberSaveError(stored) {
  const stage = stored && stored.stage
  const detail = String((stored && stored.error) || '')
  if (stage === 'ack') return Object.freeze({ text: 'Tick the confirmation box first — this indicator reads a bar ahead, so its latest value can still change.', code: 'save:ack', detail })
  if (stage === 'validate') return Object.freeze({ text: 'This indicator is not valid yet, so it was not saved.', code: 'save:validate', detail })
  return Object.freeze({ text: detail || 'The server did not accept this indicator, so it was not saved.', code: `save:${stage || 'store'}`, detail })
}

/**
 * Can the conversation edit this stored definition? The engine's own first-turn
 * guards, run up front. Pure.
 * @returns {{editable: true} | {editable: false, code: string, text: string, detail: string}}
 */
export function conversationEditability(def) {
  if (!def) return Object.freeze({ editable: false, code: 'definition:none', text: '', detail: '' })
  let model
  try {
    model = modelOf(def)
  } catch (e) {
    if (!(e instanceof AuthoringError)) throw e
    const m = memberError({ code: e.code, message: e.message })
    const imported = !!(def.meta && (def.meta.recurrenceOrigin || def.meta.importedFrom || def.meta.import))
    const text = e.code === 'authoring:kind' && imported
      ? 'This indicator was imported in a form UCT Intelligence cannot edit yet. You can still edit it manually.'
      : m.text
    return Object.freeze({ editable: false, code: e.code, text, detail: m.detail })
  }
  const residual = fidelityResidual(def, model)
  if (residual.length) {
    const imported = !!(def.meta && (def.meta.recurrenceOrigin || def.meta.importedFrom || def.meta.import))
    return Object.freeze({
      editable: false, code: 'authoring:unrepresentable',
      text: imported
        ? 'This indicator was imported in a form UCT Intelligence cannot edit yet. You can still edit it manually.'
        : UNREPRESENTABLE_TEXT,
      detail: `authoring:unrepresentable: ${residual.slice(0, 8).join(', ')}`,
    })
  }
  return Object.freeze({ editable: true })
}

// ─── ⭐ ROLLOUT — a turn that could not run, in member words ─────────────────
//
// The conversation's refusals by GATE CODE. The server's own sentences for these
// are shared with `/propose` and speak about plumbing ("the formula assistant",
// "the change format"); an HTTP failure reached the member as "The assistant could
// not answer (502)". Each line here says what happened, that nothing changed where
// that is true, and what to do — never a status code, a provider, a ledger or a
// schema. ⛔ No promised times: the daily allowance renews with the market day,
// which this sentence does not try to pin to a clock.
const REFUSAL_BY_GATE = Object.freeze({
  'cost:user': "You've used today's UCT Intelligence allowance. It renews each day — your indicators are unaffected, and you can still edit them in the Formula tab.",
  'cost:global': 'UCT Intelligence is at capacity right now. Your indicators are unaffected — please try again later.',
  'http:429': "You're sending requests faster than UCT Intelligence can take them. Wait a minute, then try again.",
  // ⭐ one interactive AI call in flight per member: the same accepted sentence as 429
  'rate:busy': "You're sending requests faster than UCT Intelligence can take them. Wait a minute, then try again.",
  'http:402': 'Custom indicators require a paid plan.',
  'http:403': "UCT Intelligence isn't available on your account yet.",
  'http:401': 'Your session has ended. Sign in again to continue.',
})
const PLATFORM = 'UCT Intelligence is briefly unavailable. Try again in a moment.'
const MODEL = "UCT Intelligence couldn't produce a valid change for that. Try rephrasing it."

/**
 * The member sentence for a refused conversation turn, or the server's own reason
 * when that already is member language (an unknown concept, another symbol, a
 * scalar the chart cannot read …).
 * @param {string|null} gate  the turn's gate code (`cost:user`, `http:502`, `network`, …)
 * @param {string} reason     what the server said
 */
export function memberRefusal(gate, reason = '') {
  const g = String(gate || '')
  if (REFUSAL_BY_GATE[g]) return REFUSAL_BY_GATE[g]
  if (g === 'network' || g === 'model:transport' || /^http:(0|5\d\d)$/.test(g)) return PLATFORM
  if (/^(envelope|model|schema|converse|internal):/.test(g)) return MODEL
  return reason || MODEL
}
