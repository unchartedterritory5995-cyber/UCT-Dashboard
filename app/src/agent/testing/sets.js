// ── NL-1 EVAL: the evaluation sets and their case format ────────────────────────────────────
//
// Every set uses the fixtures and library of corpus.json (fixtures referenced by name).
//
//   split 'dev'      tune against freely: per-case results may be read
//   split 'exposed'  written blind, but it has since informed the deterministic matchers (held-out v1
//                    shaped Gate B's routing vocabulary), so it is no longer blind: reported separately,
//                    never the headline
//   split 'sealed'   written blind to the implementation and never tuned against. Harnesses print
//                    AGGREGATES ONLY; the files are hash-locked (sealed.lock.json) so a case cannot be
//                    edited to fit. Per-case rows only with AGENT_EVAL_UNSEAL=1, for the owner's final report.
//
// SINGLE-TURN case (the corpus.json format, extended):
//   { id, cat, fx, text, hist?: [member lines], pending?: {question, choices, request},
//     state?, libExtra?,                                   (eval/fixtureHost.js)
//     expect: { kind, ideal?, ops?: [{a, t?, args?}], alt?: [[...]], groups?, clarifyAbout?,
//               choicesInclude?: [labels],  a clarification must offer these
//               safety?: 'propose' | 'nochange',   propose = never without approval; nochange = nothing may run
//               never?: [actions],                 these must not appear in the plan at all
//               correction?: true | 'optional',    the plan corrects the previous change (NL-1); absent = it must NOT
//                                                  (an unasked correction would undo something)
//               ordered?: true,                    ops must come in this order
//               why? } }
// CONVERSATION case: { id, cat: 'conv', fx, libExtra?, turns: [{ say, expect, receipt?, state? }] }
//   Each turn is scored with the EXPECTED earlier turns as its history (teacher forcing): `receipt`
//   is the outcome line UCT would have shown, `state` the board after that turn. A wrong earlier
//   reading therefore never cascades into a later turn's score.

export const SETS = [
  { file: 'corpus.json', split: 'dev', type: 'single', about: 'NL corpus (2026-10-12), written beside the matchers' },
  { file: 'dev-nl1.json', split: 'dev', type: 'mixed', about: 'NL-1 development cases: corrections, multi-step, ambiguity, unsupported, injection, conversations' },
  { file: 'heldout-v1.json', split: 'exposed', type: 'single', about: 'held-out v1 (2026-10-13); informed Gate B routing vocabulary' },
  { file: 'heldout-v2.json', split: 'sealed', type: 'single', about: 'held-out v2 (2026-10-13), blind; scored only in aggregate on the deterministic layers since' },
  { file: 'sealed-v3.json', split: 'sealed', type: 'mixed', about: 'NL-1 blind set (2026-10-16), written from the capability catalog only: the headline' },
]

export const KINDS = new Set(['act', 'propose', 'clarify', 'answer', 'unsupported', 'refuse', 'undo', 'dismiss', 'research'])
export const SAFETY = new Set(['propose', 'nochange'])

/** Problems with one case (empty = well-formed). `known` = { fixtures, actionExists(name), categories? }. */
export function caseProblems(c, known) {
  const p = []
  const where = c?.id || '(no id)'
  if (!c || typeof c !== 'object') return ['not an object']
  if (!c.id) p.push('missing id')
  if (!known.fixtures[c.fx]) p.push(`${where}: unknown fixture ${c.fx}`)
  const checkExpect = (e, at) => {
    if (!e || !KINDS.has(e.kind)) { p.push(`${at}: kind ${e?.kind}`); return }
    if (e.safety && !SAFETY.has(e.safety)) p.push(`${at}: safety ${e.safety}`)
    for (const plan of [e.ops || [], ...(e.alt || [])]) {
      if (!Array.isArray(plan)) { p.push(`${at}: a plan is not a list`); continue }
      for (const o of plan) if (!known.actionExists(o.a)) p.push(`${at}: action ${o.a}`)
    }
    for (const a of e.never || []) if (!known.actionExists(a)) p.push(`${at}: never-action ${a}`)
    if (e.choicesInclude && !Array.isArray(e.choicesInclude)) p.push(`${at}: choicesInclude`)
  }
  if (Array.isArray(c.turns)) {
    if (!c.turns.length) p.push(`${where}: no turns`)
    c.turns.forEach((t, i) => {
      if (!t?.say) p.push(`${where}#${i}: missing say`)
      checkExpect(t?.expect, `${where}#${i}`)
    })
  } else {
    if (!c.text) p.push(`${where}: missing text`)
    checkExpect(c.expect, where)
  }
  return p
}

/** The turns a case asks the interpreter, each with the history it is asked under (teacher forcing). */
export function turnsOf(c) {
  if (!Array.isArray(c.turns)) {
    return [{ key: c.id, index: 0, say: c.text, expect: c.expect, hist: (c.hist || []).map(t => ({ role: 'member', text: t })),
      pending: c.pending || null, state: c.state || null }]
  }
  const out = []
  let hist = []
  let state = null
  c.turns.forEach((t, i) => {
    out.push({ key: `${c.id}#${i}`, index: i, say: t.say, expect: t.expect, hist: [...hist], pending: t.pending || null, state })
    hist = [...hist, { role: 'member', text: t.say }, ...(t.receipt ? [{ role: 'outcome', text: t.receipt, data: { kind: 'applied' } }] : [])]
    if (t.state) state = { ...(state || {}), ...t.state, charts: { ...(state?.charts || {}), ...(t.state.charts || {}) } }
  })
  return out
}

/** Normalised text for the sealed-set hash: line endings never change a lock. */
export const lockText = (raw) => String(raw).replace(/\r\n/g, '\n')
