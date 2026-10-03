// Research > Depth panels (lane gaps-research): one dark flag per surface.
//
// The server sends each key ONLY when that surface is on
// (api/routers/auth.py::_research_depth_flags), so absent and false mean the
// same thing here. Each value is read `=== true`: an enablement gate must never
// default to exposed while the payload is still loading.
//
// ⛔ These lists mirror `_RESEARCH_DEPTH_SURFACES` and
// `_RESEARCH_DEPTH_AWAITING_CODE_SURFACES` in auth.py. A key added there and not
// here is a surface the client never shows; the rail in researchDepthFlags.test.js
// reads the Python tuples rather than restating them.
export const RESEARCH_DEPTH_KEYS = [
  'filing_search_enabled',
  'earnings_reaction_panel_enabled',
  'events_timeline_enabled',
  'ftd_dataset_enabled',
  'mention_series_enabled',
  'broker_estimates_enabled',
]

// Lane R Depth panels the /terminal shell does not yet reach by a function code
// (adding one is Lane T1's file; audit V1b). Same tab, same payload form. HANDOFF:
// when T1 adds the codes, fold these into RESEARCH_DEPTH_KEYS and delete this list.
export const RESEARCH_DEPTH_AWAITING_CODE_KEYS = [
  'news_story_versions_enabled',
  'news_importance_enabled',
  'news_read_state_enabled',
  'call_replay_enabled',
]

const ALL_DEPTH_KEYS = [...RESEARCH_DEPTH_KEYS, ...RESEARCH_DEPTH_AWAITING_CODE_KEYS]

// Lane R D-6/D-7/D-8: the News desk panel shows while ANY of its three flags is on;
// each annotation inside it rides only with its own flag.
export const NEWS_DESK_KEYS = ['news_story_versions_enabled', 'news_importance_enabled', 'news_read_state_enabled']

export function readResearchDepth(d) {
  const out = {}
  for (const k of ALL_DEPTH_KEYS) out[k] = d?.[k] === true
  return out
}

export function anyResearchDepth(flags) {
  return !!flags && ALL_DEPTH_KEYS.some(k => flags[k] === true)
}
