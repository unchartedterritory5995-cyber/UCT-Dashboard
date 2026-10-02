// Research > Depth panels (lane gaps-research): one dark flag per surface.
//
// The server sends each key ONLY when that surface is on
// (api/routers/auth.py::_research_depth_flags), so absent and false mean the
// same thing here. Each value is read `=== true`: an enablement gate must never
// default to exposed while the payload is still loading.
//
// ⛔ This list mirrors `_RESEARCH_DEPTH_SURFACES` in auth.py. A key added there
// and not here is a surface the client never shows; the rail in
// researchDepthFlags.test.js reads the Python tuple rather than restating it.
export const RESEARCH_DEPTH_KEYS = [
  'filing_search_enabled',
  'earnings_reaction_panel_enabled',
  'events_timeline_enabled',
]

export function readResearchDepth(d) {
  const out = {}
  for (const k of RESEARCH_DEPTH_KEYS) out[k] = d?.[k] === true
  return out
}

export function anyResearchDepth(flags) {
  return !!flags && RESEARCH_DEPTH_KEYS.some(k => flags[k] === true)
}
