// Plain English for the decision record (DR). The Morning Wire engine stores its drop reasons as
// machine slugs (morning-wire swing_gate.py / universe.py) and the server passes them through
// untouched, so the live sweep 2026-10-05 showed members
//   "market-cap-0.00B-below-1.0B-floor (tier passed but mcap floor failed)"
//   "Dropped at stage 2 · gate"
// This module is the ONE translator. It knows every format the engine emits (listed per rule);
// a reason it does not recognise is shown as-is when it is already prose, and as a neutral
// sentence when it is a bare slug, never as raw engine text.

import { formatCompactTerminal } from '../../../lib/presentation/presentationPrimitives'

const STAGE_NAMES = { universe: 'the universe screen', gate: 'the swing-trade gate', lens: 'the final setup review' }

export function stageText(row) {
  if (row.outcome === 'passed') return 'Passed every stage'
  const n = row.dropped_at_stage
  const name = row.stage_label && STAGE_NAMES[row.stage_label]
  if (name) return `Dropped at ${name} (stage ${n})`
  // an unknown stage renders as its NUMBER, never a guessed label
  return `Dropped at stage ${n}`
}

// The engine states caps in $B; they read on the terminal compact ladder.
const fmtCapB = (b) => formatCompactTerminal(b * 1e9, { money: true })

function tierSentence(t) {
  let m
  if (t === 'tier-D-never-trade-list') return 'It is on the never-trade list.'
  if ((m = /^tier-B-not-leading-and-gap-(-?[\d.]+)<([\d.]+)$/.exec(t))) {
    return `A tier-B name whose sector was not leading, and its ${m[1]}% gap was under the ${m[2]}% needed.`
  }
  if (t === 'C-tier-no-gap-and-no-sector-lead-override') return 'A tier-C name with no gap and no leading sector to lift it.'
  if (/^tier-\w+-unrecognized-drop$/.test(t)) return 'It did not clear the tier check.'
  return null
}

/** Member sentence for a stored drop_reason, or null when there is nothing to say. */
export function dropReasonText(raw) {
  if (raw == null || raw === '') return null
  let s = String(raw).trim()
  let m
  if (/^compute_error:/.test(s)) return 'The engine could not evaluate this name that morning.'
  if ((m = /^exploration band:\s*(\d)\/5\b/.exec(s))) {
    return `Picked as an exploration name: ${m[1]} of 5 setup thresholds passed (a marginal read).`
  }
  if ((m = /^only (\d)\/5 thresholds passed \(need (\d)\)$/.exec(s))) {
    return `It passed only ${m[1]} of 5 setup thresholds; ${m[2]} were needed.`
  }
  let tail = ''
  if ((m = /\s*\(and (\d)\/5 thresholds passed\)$/.exec(s))) {
    tail = ` It passed ${m[1]} of 5 setup thresholds.`
    s = s.slice(0, m.index)
  }
  s = s.replace(/\s*\(tier passed but mcap floor failed\)$/, '')
  if ((m = /^market-cap-([\d.]+)B-below-([\d.]+)B-floor$/.exec(s))) {
    const cap = Number(m[1]); const floor = Number(m[2])
    return cap === 0
      ? `Its market cap could not be read that morning, so it did not clear the ${fmtCapB(floor)} minimum.`
      : `Its market cap of ${fmtCapB(cap)} is below the ${fmtCapB(floor)} minimum.`
  }
  const tier = tierSentence(s)
  if (tier) return `${tier}${tail}`
  // unknown: prose passes through; a bare slug is never shown raw
  if (!/\s/.test(s) || /[a-z]+_[a-z]+/.test(s)) return `It did not clear that morning's process.${tail}`
  return `${s}${tail}`
}
