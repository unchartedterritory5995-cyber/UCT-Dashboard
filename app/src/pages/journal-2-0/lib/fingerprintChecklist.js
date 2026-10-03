/**
 * Wave 13 lane 13I-2 — the fingerprint fills the setup checklist (plan A.13I "Checklist
 * autofill"), and the one place the fingerprint's fields are labelled and formatted.
 *
 * The 12B setup trade-plan templates (`notebookTemplates.js` SETUP_PLANS) each carry a
 * Checklist of five plain bullets. Creating a setup plan FROM A CHART marks every item with
 * what the chart's frozen fingerprint says about it:
 *
 *   * an item the fingerprint measures shows the VALUES (with their as-of), and a yes/no only
 *     where the fingerprint itself states a yes/no fact (the MA stack, the EMA stack, the RS-line
 *     trend, a volume N-week low) — never a threshold invented here. "Prior run 48%" is
 *     evidence; whether 48% is "a real advance" is the member's call. (Plan: "no new indicator
 *     maths".)
 *   * a missing value is labelled with the fingerprint's own reason sentence;
 *   * an item the fingerprint does not measure (a catalyst, the group, borrow) says so.
 *
 * ONE mapping module: CHECKLIST_EVIDENCE is aligned, item by item, with each template's
 * checklist, and the rail builds the real templates and fails if a list moves.
 *
 * PURE: no fetch, no React. The doc it returns is an ordinary TipTap doc the note-create path
 * saves like any template body.
 */

// ── field labels and formatting (the panel and the playbook cards read these) ─────────────

export const FIELD_LABELS = Object.freeze({
  adr_pct: 'ADR %',
  pct_vs_sma10: 'vs 10-day',
  pct_vs_sma20: 'vs 20-day',
  pct_vs_sma50: 'vs 50-day',
  pct_vs_sma200: 'vs 200-day',
  ma_stack: 'MA stack',
  ema_stack_intact: 'EMA stack',
  rs_rank: 'RS rank',
  rs_line_trend: 'RS line',
  base_length_bars: 'Base length',
  base_depth_pct: 'Base depth',
  pullback_depth_pct: 'Pullback depth',
  vol_nweek_low: 'Volume dry-up',
  close_cv_pct: 'Tightness (close CV)',
  pole_pct: 'Prior run (pole)',
  patterns: 'Confirmed patterns',
})

const PCT_FIELDS = new Set(['adr_pct', 'base_depth_pct', 'pullback_depth_pct', 'close_cv_pct', 'pole_pct'])
const SIGNED_PCT_FIELDS = new Set(['pct_vs_sma10', 'pct_vs_sma20', 'pct_vs_sma50', 'pct_vs_sma200'])
const NWEEK = { 20: '4-week low', 15: '3-week low', 10: '2-week low' }

/** A field's value as words, or null when there is no value. */
export function formatFingerprintValue(field, value) {
  if (value == null) return null
  if (field === 'patterns') {
    const list = Array.isArray(value) ? value : []
    if (!list.length) return 'none confirmed'
    return list.map((p) => `${p.setup}${typeof p.confidence === 'number' ? ` (${Math.round(p.confidence)}%)` : ''}`).join(', ')
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (PCT_FIELDS.has(field)) return `${value.toFixed(1)}%`
    if (SIGNED_PCT_FIELDS.has(field)) return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
    if (field === 'rs_rank') return String(Math.round(value))
    if (field === 'base_length_bars') return `${Math.round(value)} bars`
    if (field === 'vol_nweek_low') return NWEEK[value] || (value === 0 ? 'not at a 2-4 week low' : String(value))
    return String(value)
  }
  if (typeof value === 'boolean') {
    if (field === 'ema_stack_intact') return value ? 'intact (close > 10 > 20, rising)' : 'not intact'
    return value ? 'yes' : 'no'
  }
  return String(value)
}

// ── checklist evidence, item by item ─────────────────────────────────────────────────────

/** A yes/no the fingerprint states itself, or null. */
const FACTS = {
  ma_stack: (v) => (v === 'full-bull' ? 'yes' : v === 'bear' ? 'no' : null),
  ema_stack_intact: (v) => (v === true ? 'yes' : v === false ? 'no' : null),
  rs_line_trend: (v) => (v === 'up' ? 'yes' : v === 'down' ? 'no' : null),
  vol_nweek_low: (v) => (v === 20 || v === 15 || v === 10 ? 'yes' : v === 0 ? 'no' : null),
}

/** Each entry: `null` (the fingerprint does not measure this item), or
 *  `{ fields: [...], fact: '<field>' | undefined }` — `fact` names the field whose own
 *  yes/no answers the item. */
const ev = (fields, fact) => Object.freeze({ fields: Object.freeze(fields), fact })

export const CHECKLIST_EVIDENCE = Object.freeze({
  'breakout-plan': Object.freeze([
    ev(['pole_pct', 'ma_stack'], 'ma_stack'),          // prior uptrend into the base
    ev(['base_depth_pct', 'base_length_bars', 'close_cv_pct']), // pullbacks get smaller
    ev(['vol_nweek_low'], 'vol_nweek_low'),            // volume dries up
    ev(['rs_line_trend', 'rs_rank'], 'rs_line_trend'), // RS line at or near new highs
    null,                                              // the group is acting well
  ]),
  'pullback-plan': Object.freeze([
    ev(['ma_stack', 'pct_vs_sma50'], 'ma_stack'),      // established uptrend
    ev(['vol_nweek_low'], 'vol_nweek_low'),            // pullback on lighter volume
    ev(['close_cv_pct', 'pct_vs_sma10', 'pct_vs_sma20']), // tight candles near the average
    ev(['ema_stack_intact'], 'ema_stack_intact'),      // the average is rising
    ev(['rs_rank', 'rs_line_trend']),                  // still leads its group
  ]),
  'episodic-pivot-plan': Object.freeze([
    null,                                              // a real catalyst
    null,                                              // a gap of ~10%+
    null,                                              // volume far above normal
    ev(['pct_vs_sma50', 'pole_pct']),                  // not already extended
    null,                                              // holds the gap
  ]),
  'undercut-rally-plan': Object.freeze([
    null,                                              // the level is obvious
    ev(['ma_stack', 'pole_pct'], 'ma_stack'),          // uptrend before the undercut
    null,                                              // the undercut is brief
    null,                                              // the reclaim on rising volume
    null,                                              // the market is not breaking down
  ]),
  'parabolic-short-plan': Object.freeze([
    ev(['pct_vs_sma10', 'pole_pct']),                  // several up days far above the 10-day
    null,                                              // exhaustion
    null,                                              // the first crack
    null,                                              // borrow
    ev(['pct_vs_sma10', 'pct_vs_sma20']),              // the support it falls back to
  ]),
})

const NOT_MEASURED = 'not measured by the fingerprint'

/**
 * The evidence for every checklist item of `templateKey`, from a frozen fingerprint:
 * `[{ state: 'yes' | 'no' | 'shown' | 'missing' | 'not_measured', text }]`, or null when the
 * template has no mapping. `missingReasons` is the server's sentence table (`GET .../meta`).
 */
export function checklistEvidence(templateKey, fingerprint, missingReasons = {}) {
  const map = CHECKLIST_EVIDENCE[templateKey]
  if (!map) return null
  const fields = fingerprint?.fields || {}
  return map.map((item) => {
    if (!item) return { state: 'not_measured', text: NOT_MEASURED }
    const parts = []
    const missing = []
    for (const f of item.fields) {
      const cell = fields[f] || {}
      const shown = formatFingerprintValue(f, cell.value)
      if (shown == null) missing.push(`${FIELD_LABELS[f]}: ${missingReasons[cell.missing] || cell.missing || 'not available'}`)
      else parts.push(`${FIELD_LABELS[f]} ${shown}`)
    }
    if (!parts.length) return { state: 'missing', text: `not available (${missing.join('; ')})` }
    const fact = item.fact ? FACTS[item.fact]?.(fields[item.fact]?.value) ?? null : null
    const text = parts.join(', ') + (missing.length ? ` (${missing.join('; ')})` : '')
    return { state: fact || 'shown', text }
  })
}

const STATE_WORD = { yes: 'Yes', no: 'No' }

/** The words appended to one checklist item. */
export function evidenceSuffix(e, asOf) {
  const when = asOf ? ` as of ${asOf}` : ''
  if (e.state === 'not_measured') return ` — Fingerprint: ${NOT_MEASURED}.`
  const word = STATE_WORD[e.state] ? `${STATE_WORD[e.state]}. ` : ''
  return ` — Fingerprint${when}: ${word}${e.text}.`
}

const textOf = (node) => (node?.content || []).map((c) => c.text || '').join('')

/**
 * A copy of a setup-plan doc with every Checklist item marked with its fingerprint evidence.
 * The doc is not mutated. A doc with no "Checklist" heading, or a template with no mapping, is
 * returned unchanged (as a copy), so a template that changes shape degrades to the plain plan.
 */
export function annotateSetupPlanDoc(docJson, templateKey, fingerprint, missingReasons = {}) {
  const out = JSON.parse(JSON.stringify(docJson || { type: 'doc', content: [] }))
  const evidence = checklistEvidence(templateKey, fingerprint, missingReasons)
  if (!evidence) return out
  const content = out.content || []
  const at = content.findIndex((n) => n.type === 'heading' && textOf(n) === 'Checklist')
  const list = at >= 0 ? content.slice(at + 1).find((n) => n.type === 'bulletList') : null
  if (!list) return out
  const asOf = fingerprint?.as_of || null
  ;(list.content || []).forEach((li, i) => {
    const e = evidence[i]
    const para = (li.content || []).find((n) => n.type === 'paragraph')
    if (!e || !para) return
    para.content = [...(para.content || []), { type: 'text', marks: [{ type: 'italic' }], text: evidenceSuffix(e, asOf) }]
  })
  return out
}

/** The checklist items of a built template doc (the rail aligns CHECKLIST_EVIDENCE to it). */
export function checklistItems(docJson) {
  const content = docJson?.content || []
  const at = content.findIndex((n) => n.type === 'heading' && textOf(n) === 'Checklist')
  const list = at >= 0 ? content.slice(at + 1).find((n) => n.type === 'bulletList') : null
  return list ? list.content.map((li) => textOf((li.content || [])[0])) : []
}
