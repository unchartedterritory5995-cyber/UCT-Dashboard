// FT-046: per-surface "how to trade with this" checklists (SpotGamma's numbered
// checklist per analytic surface). ONE registry, keyed by surface id.
//
// ⛔⛔ THE COPY NEEDS THE OWNER'S VOICE SIGN-OFF. Every entry ships as
//      status: 'draft-awaiting-owner-voice', and a draft renders NOTHING to a member,
//      even with HOW_TO_CHECKLISTS_ENABLED on. The steps below are an agent's
//      placeholder drafts for the owner to rewrite or approve; they are not UCT's
//      voice and must never be shown as if they were.
//
// To publish one entry: rewrite its steps in the owner's words, then set
//   status: 'approved', approved_by: '<who>', approved_on: 'YYYY-MM-DD'.
// An 'approved' entry missing either field still renders nothing (approvedChecklist).

export const HOW_TO_DRAFT = 'draft-awaiting-owner-voice'
export const HOW_TO_APPROVED = 'approved'
export const HOW_TO_STATUSES = Object.freeze([HOW_TO_DRAFT, HOW_TO_APPROVED])

const draft = (title, steps) => Object.freeze({ title, status: HOW_TO_DRAFT, steps: Object.freeze(steps) })
const approved = (title, steps) => Object.freeze({
  title, status: HOW_TO_APPROVED, approved_by: 'Patrick Gosz', approved_on: '2026-10-07',
  steps: Object.freeze(steps),
})

export const HOW_TO_CHECKLISTS = Object.freeze({
  'screener.stocks': approved('Screener: how to trade with this', [
    'Start from the market: check exposure and breadth before acting on any list.',
    'Run one saved screen you trust, not five new ones.',
    'Open each name on a chart; the screen finds candidates, the chart decides.',
    'Write the entry, stop and size before the order, not after.',
  ]),
  'screener.options': approved('Options screener: how to trade with this', [
    'Read the as-of time first; a ranked list is only as fresh as its last read.',
    'Check the underlying chart before the contract.',
    'Size from the premium you can lose, not from the notional.',
  ]),
  'research.depth.earnings_reaction': approved('Earnings reaction: how to trade with this', [
    'Compare the implied move with the past reactions and note each sample size.',
    'Look at the drift after the gap, not only the gap.',
    'Decide before the print whether you hold through it.',
  ]),
  'research.depth.events': approved('Events around the print: how to trade with this', [
    'Find where today sits relative to the next print (T-n).',
    'Note any source that could not be read; a gap is not a quiet tape.',
  ]),
  'research.depth.broker_estimates': approved('Broker estimates: how to trade with this', [
    'Watch the direction of revisions more than the level.',
    'Treat a consensus with few contributors as thin.',
  ]),
  'research.depth.ftd': approved('Fails to deliver: how to trade with this', [
    'Read balances as of their settlement date; they arrive weeks late.',
    'A spike is context for a squeeze thesis, never the trigger.',
  ]),
  'research.depth.mention_series': approved('Room attention: how to trade with this', [
    'Rising attention with a flat chart is a watch, not a buy.',
    'Compare the share of room mentions, not the raw count.',
  ]),
  'research.depth.filing_search': approved('Filing search: how to trade with this', [
    'Search the risk factors for what changed, then read the paragraph in full.',
    'Cite the filing date when you write the idea down.',
  ]),
})

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The entry a member may see for `surface`, or null. Null for: an unknown surface, a
 *  draft, an 'approved' entry without approved_by / approved_on, or no usable steps. */
export function approvedChecklist(surface, registry = HOW_TO_CHECKLISTS) {
  const e = registry?.[surface]
  if (!e || e.status !== HOW_TO_APPROVED) return null
  if (typeof e.approved_by !== 'string' || !e.approved_by.trim()) return null
  if (typeof e.approved_on !== 'string' || !ISO_DAY.test(e.approved_on)) return null
  const steps = Array.isArray(e.steps) ? e.steps.filter((s) => typeof s === 'string' && s.trim()) : []
  if (steps.length === 0) return null
  return { title: String(e.title || 'How to trade with this'), steps }
}

/** Research > Depth: the surface id for each Depth panel's auth key. */
export const DEPTH_HOW_TO_SURFACES = Object.freeze({
  earnings_reaction_panel_enabled: 'research.depth.earnings_reaction',
  events_timeline_enabled: 'research.depth.events',
  broker_estimates_enabled: 'research.depth.broker_estimates',
  ftd_dataset_enabled: 'research.depth.ftd',
  mention_series_enabled: 'research.depth.mention_series',
  filing_search_enabled: 'research.depth.filing_search',
})
