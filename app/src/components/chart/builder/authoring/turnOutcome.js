// app/src/components/chart/builder/authoring/turnOutcome.js
//
// ─── ⭐⭐ SLICE 2 — WHAT ONE CONVERSATION TURN IS ─────────────────────────────
//
// A turn is NOT "change my indicator". The member asks; the assistant answers;
// the indicator changes only when the assistant actually proposes a change.
//
//   change       → the envelope goes to the deterministic engine (`applyTurn`)
//   clarify      → the engine records the questions; the definition is untouched
//   answer       → the assistant's reply, and NOTHING else happens
//   unsupported  → the assistant names the limit, and NOTHING else happens
//   refused      → a refusal / failure; NOTHING else happens
//
// ⛔ ONLY `change` EVER HANDS AN ENVELOPE ON. The server declares the
// disposition explicitly (`definition_conversation._check_disposition` holds it
// consistent with the payload); this re-checks the same rule, so a mismatched
// reply can never reach the engine as a change.

export const OUTCOMES = Object.freeze({
  CHANGE: 'change', ANSWER: 'answer', CLARIFY: 'clarify', UNSUPPORTED: 'unsupported', REFUSED: 'refused',
})

const MISMATCH = 'The assistant’s answer did not match what it said it was doing, so nothing was changed.'

/**
 * @param {object} res a `converseTurn` result
 * @returns {{outcome: string, reply?: string, envelope?: object, reason?: string, gate?: string, preflight?: boolean}}
 */
export function classifyTurn(res) {
  if (!res || res.ok !== true) {
    const unsupported = !!res && res.disposition === OUTCOMES.UNSUPPORTED
    return {
      outcome: unsupported ? OUTCOMES.UNSUPPORTED : OUTCOMES.REFUSED,
      reason: (res && res.reason) || 'UCT Intelligence could not answer that.',
      gate: (res && res.gate) || null,
      preflight: !!(res && res.preflight),
    }
  }
  const env = res.envelope && typeof res.envelope === 'object' ? res.envelope : {}
  const ops = Array.isArray(env.ops) ? env.ops : []
  const questions = Array.isArray(env.questions) ? env.questions : []
  const reply = typeof res.reply === 'string' ? res.reply.trim() : ''
  switch (res.disposition) {
    case OUTCOMES.CHANGE:
      if (ops.length && !questions.length) return { outcome: OUTCOMES.CHANGE, envelope: env, reply }
      break
    case OUTCOMES.CLARIFY:
      if (questions.length && !ops.length) return { outcome: OUTCOMES.CLARIFY, envelope: env, reply }
      break
    case OUTCOMES.ANSWER:
    case OUTCOMES.UNSUPPORTED:
      if (!ops.length && !questions.length && reply) return { outcome: res.disposition, reply }
      break
    default:
      break
  }
  return { outcome: OUTCOMES.REFUSED, reason: MISMATCH, gate: 'converse:disposition' }
}
