// app/src/components/chart/legend/readoutPageHint.js
//
// ─── A READOUT AS ONE SENTENCE FOR AN ASSISTANT (UCT RS Phase 4, unit 4-05) ──
//
// PURE. No React, no registry, no assistant. A chip whose definition declares a
// `readout[]` carries its resolved rows (`readoutSchema.resolveRow`:
// `{key, label, text, muted}`); this turns the GLANCE rows into the short page
// hint an assistant is handed when a member asks about what they are looking at:
//
//   UCT RS for NVDA vs SPY: rating 94 IBD-style; RS line above its 21 EMA;
//   last RS high 3 bars ago, before price; regime persistence; checks 3 of 4
//
// ⭐ ANY ASSISTANT. Today the chip's "Ask Compass about this" passes it to
// `CompassAssistButton`; the UCT Agent that replaces Compass takes the same
// string. Nothing here names Compass, and nothing names an indicator: the
// caller says what the rows are about (`ctx`).
//
// ⛔ CAPPED AT `PAGE_HINT_MAX` (480) CHARACTERS, CUT AT A ROW BOUNDARY. A row is
// never cut in half, so a truncated hint still says only true things. Only the
// name itself, longer than the whole cap, is ever sliced.

/** The longest page hint, in characters (engineering map 4-05). */
export const PAGE_HINT_MAX = 480

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** "Rating" -> "rating", "Last RS high" -> "last RS high"; "RS line" stays (an acronym leads). */
function lowerLead(label) {
  if (!label) return label
  const second = label.charAt(1)
  if (second && second === second.toUpperCase() && second !== second.toLowerCase()) return label
  return label.charAt(0).toLowerCase() + label.slice(1)
}

/**
 * @param {object[]} rows the GLANCE rows, in menu order: `{key, label, text}`. A row with no text is left out.
 * @param {object} [ctx]
 * @param {string} [ctx.name]  what the rows read (the definition's short name), e.g. "UCT RS"
 * @param {string} [ctx.sym]   the chart's symbol, e.g. "NVDA"
 * @param {string} [ctx.vs]    what it is measured against, e.g. "SPY"
 * @param {string[]} [ctx.skip] row keys already said in the lead (the benchmark row when `vs` names it)
 * @param {number} [ctx.max]   a smaller cap; never above `PAGE_HINT_MAX`
 * @returns {string} the hint, at most `max` characters; '' when there is nothing to say
 */
export function readoutPageHint(rows, ctx = {}) {
  const c = ctx && typeof ctx === 'object' ? ctx : {}
  const max = Number.isInteger(c.max) && c.max > 0 ? Math.min(c.max, PAGE_HINT_MAX) : PAGE_HINT_MAX
  const name = clean(c.name)
  const sym = clean(c.sym)
  const vs = clean(c.vs)
  const skip = new Set(Array.isArray(c.skip) ? c.skip : [])
  const lead = [name, sym ? `for ${sym}` : '', vs && vs !== sym ? `vs ${vs}` : ''].filter(Boolean).join(' ')

  const parts = []
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object' || skip.has(r.key)) continue
    const text = clean(r.text)
    if (!text) continue
    const label = lowerLead(clean(r.label))
    parts.push(label ? `${label} ${text}` : text)
  }

  if (!parts.length) return lead.slice(0, max)
  let out = lead ? `${lead}: ` : ''
  if (out.length > max) return lead.slice(0, max)
  let added = 0
  for (const p of parts) {
    const next = added ? `${out}; ${p}` : `${out}${p}`
    if (next.length > max) break
    out = next
    added += 1
  }
  if (!added) return lead.slice(0, max)
  return out
}

export default readoutPageHint
