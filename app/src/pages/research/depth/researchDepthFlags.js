// Research > Depth panels (lane gaps-research): one dark flag per surface.
//
// The server sends each key ONLY when that surface is on
// (api/routers/auth.py::_research_depth_flags), so absent and false mean the
// same thing here. Each value is read `=== true`: an enablement gate must never
// default to exposed while the payload is still loading.
//
// ⛔ This list mirrors `_RESEARCH_DEPTH_SURFACES` in auth.py. A key added there and not
// here is a surface the client never shows; the rail in researchDepthFlags.test.js reads
// the Python tuple rather than restating it. Every key gates its OWN /terminal function
// code (functions.rail.test.js) -- the last four were folded in by lane T4 (2026-10-03),
// when NVER / NIMP / NREAD / CRPL were added; the interim "awaiting a code" list is gone.
export const RESEARCH_DEPTH_KEYS = [
  'filing_search_enabled',
  'earnings_reaction_panel_enabled',
  'events_timeline_enabled',
  'ftd_dataset_enabled',
  'mention_series_enabled',
  'broker_estimates_enabled',
  'news_story_versions_enabled',
  'news_importance_enabled',
  'news_read_state_enabled',
  'call_replay_enabled',
]

// Lane R D-6/D-7/D-8: the News desk panel shows while ANY of its three flags is on;
// each annotation inside it rides only with its own flag.
export const NEWS_DESK_KEYS = ['news_story_versions_enabled', 'news_importance_enabled', 'news_read_state_enabled']

export function readResearchDepth(d) {
  const out = {}
  for (const k of RESEARCH_DEPTH_KEYS) out[k] = d?.[k] === true
  return out
}

export function anyResearchDepth(flags) {
  return !!flags && RESEARCH_DEPTH_KEYS.some(k => flags[k] === true)
}
