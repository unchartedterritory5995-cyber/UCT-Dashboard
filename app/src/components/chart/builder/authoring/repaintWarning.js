// ── THE REPAINT WARNING: one sentence builder for every place a member is asked to acknowledge ──
//
// ⛔ S6 (2026-10-10): every surface said "reads a bar ahead", whatever the formula. `pivothigh(high,
// 5, 5)` is final only after FIVE more bars close, so the acknowledgement a member approved
// understated the window five-fold. The engine already measured it — `lintRepaint(tree).forward`
// (`engine/ast/lint.js`, the same reach that decides `preview-repaints`) — and the readback kept
// only the mode. This module is the ONE place that turns that measurement into words; the readback
// line (the Agent's `ackText`), the Create Indicator / Converse checkboxes and the save refusals all
// call it, so the warning a member reads, approves and saves under can never disagree.
//
// It MEASURES NOTHING itself: `forward` comes from the caller's `lintRepaint`, and a value that is not
// a whole number of bars (`unknown` / `unbounded`, or anything unrecognised) is said WITHOUT a count
// rather than with a guessed one. (Those trees measure `repaints` and are refused at Save anyway.)

/** A whole, positive bar count, or null when the reach is not a countable window. */
export function barsAhead(forward) {
  return Number.isInteger(forward) && forward > 0 ? forward : null
}

const bars = (n) => `${n} bar${n === 1 ? '' : 's'}`

/** "until the next bar closes" / "until 5 more bars close" — the finality clause, by count. */
function untilClose(n) {
  return n === 1 ? 'until the next bar closes' : `until ${n} more bars close`
}

/**
 * The acknowledgement items for a readback's repainting outputs.
 * @param outputs readback outputs (`{key, name, mode, forward}`)
 * @param keys    the keys needing acknowledgement (`needsAck`), in order
 * @param formingOf `(key) => boolean` — the output reads a period still forming (weekly/monthly)
 * @returns `[{key, name, forward, forming, sentence}]` — `sentence` is the readback line, verbatim
 */
export function repaintWarningItems(outputs, keys, formingOf = () => false) {
  return (keys || []).map((key) => {
    const o = (outputs || []).find((x) => x.key === key) || { key, name: key }
    const forming = !!formingOf(key)
    const forward = forming ? null : barsAhead(o.forward)
    return Object.freeze({ key, name: o.name || key, forward, forming, sentence: ackSentence(o.name || key, forward, forming) })
  })
}

/** The readback / approval line for ONE output. Ends with "confirm below before saving". */
export function ackSentence(name, forward, forming = false) {
  if (forming) {
    return `${name} reads the period still forming (so far this week or month), so it changes until that period closes — it repaints; confirm below before saving`
  }
  const n = barsAhead(forward)
  if (n === null) {
    return `${name} reads bars after the one it draws on, so its latest values can change after they appear — confirm below before saving`
  }
  return n === 1
    ? `${name} reads 1 bar ahead, so its latest value can change until the next bar closes — confirm below before saving`
    : `${name} reads ${bars(n)} ahead, so its latest ${n} values can change until ${n} more bars close — confirm below before saving`
}

/** One clause per item: "PIVOTHIGH isn't final until 5 more bars close". */
function finalityClause(item) {
  if (item.forming) return `${item.name} isn't final until the week or month it reads closes`
  const n = barsAhead(item.forward)
  return n === null ? `${item.name} isn't final when it first appears` : `${item.name} isn't final ${untilClose(n)}`
}

/** The checkbox label (Create Indicator, Converse). */
export function ackCheckboxText(items) {
  const list = items || []
  if (!list.length) return ''
  return `I understand ${list.map(finalityClause).join('; ')}.`
}

/** The save refusal when the acknowledgement was not given (storeConversation / memberSaveError). */
export function ackRequiredText(items) {
  const list = items || []
  if (!list.length) return 'Tick the confirmation box first — this indicator repaints, so its latest values can still change.'
  return `Tick the confirmation box first — ${list.map(finalityClause).join('; ')}.`
}
