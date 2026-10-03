// Research notices under the header (lane R: D-9, D-11, D-12): one dark flag per surface.
//
// The server sends each key ONLY when that surface is on
// (api/routers/auth.py::_research_notice_flags), so absent and false mean the
// same thing here. Each value is read `=== true`: an enablement gate must never
// default to exposed while the payload is still loading.
//
// ⛔ These are NOT Research › Depth panels and never open the Depth tab.
// ⛔ This list mirrors `_RESEARCH_NOTICE_SURFACES` in auth.py; the rail in
// tests/test_research_notices.py reads the Python tuple rather than restating it.
export const RESEARCH_NOTICE_KEYS = [
  'member_interest_line_enabled',
  'entity_rename_notice_enabled',
  'metric_disagreement_enabled',
]

export function readResearchNotices(d) {
  const out = {}
  for (const k of RESEARCH_NOTICE_KEYS) out[k] = d?.[k] === true
  return out
}
