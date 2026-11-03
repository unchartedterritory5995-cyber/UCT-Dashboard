// UCT Agent scans — the LAST SCREEN as server-persisted refinement state (W1-C C-01, builder-c). SC-2 §3.
//
// capabilities/screener.js remembers the last screen it ran so "now only technology", "exclude anything under $10",
// "sort them by three-month performance", "add the top five to a watchlist" compose onto it. Until now that memory
// was the session's only (lost on reload / chat switch). This module:
//   * persists it per CONVERSATION through PUT /api/agent/conversations/{id}/state/lastScreen (fire-and-forget,
//     never blocks an answer) and restores it with the matching GET when the screener has no last screen for the
//     conversation the member is in (a reload, a chat switch);
//   * composes a refinement with the SC-2 §3 rules (mirrored from api/services/uct_agent/scan/refine.py);
//   * F-16: a refinement that adds a HIDDEN UCT field is refused with the owner's sentence AND one public alternative
//     (a public field's name only — never a formula, a weight or an input-by-input reconstruction).
// memory.js (result sets for "the third one") stays session-only by design; this is the screen's SPEC + result ids.
// The hidden set: scanHidden.js when W1-SEC's mirror is present (PR #657), else the owner's F-16 FINAL RULING set.

import { activeConversationId, agentConversationState, agentConversationStateSet } from '../agentClient'

export const STATE_KEY = 'lastScreen'
export const ROW_CAP = 50
export const UNIVERSE_KEYS = ['sector', 'industry']
export const RATINGS_REFUSAL = "UCT Agent can't screen on UCT's proprietary ratings and scores. You can use them on the Screener page"
export const FLOW_REFUSAL = "UCT Agent can't screen on options-flow or dark-pool data. You can use it on the Screener page"

// the owner's F-16 FINAL RULING set (26 + B1 + B2 + archive_calls_n), used only until scanHidden.js lands
export const HIDDEN_FALLBACK = new Set([
  'uct_composite', 'rating_eps', 'rating_growth', 'rating_value', 'rating_smr', 'sponsorship', 'accdis',
  'rs_rank', 'rs_return', 'sector_rs_pct',
  'dp_net_flow', 'dp_net_flow_pct', 'dp_trades', 'dp_dollar_vol', 'opt_call_prem', 'opt_put_prem', 'opt_pc_ratio',
  'candle_score', 'earnings_setup_grade', 'in_uct20', 'archive_calls_n',
  'pattern_engine_id', 'pattern_engine_conf', 'pattern_engine_dir', 'pattern_engine_vcp', 'pattern_engine_flat_base',
  'pattern_expectancy_r', 'pattern_entry_dist_pct', 'pattern_stop_dist_pct',
])
const SETUP_KEYS = new Set(['candle_score', 'earnings_setup_grade', 'pattern_engine_id', 'pattern_engine_conf', 'pattern_engine_dir',
  'pattern_engine_vcp', 'pattern_engine_flat_base', 'pattern_expectancy_r', 'pattern_entry_dist_pct', 'pattern_stop_dist_pct',
  'base_structure', 'base_relation_count', 'base_pivot_px', 'hvc_52w'])
export const ALT_STRENGTH = { key: 'chg_pct_3m', label: '3-month price change' }
export const ALT_SETUP = { key: 'dist_52w_high_pct', label: 'distance from the 52-week high' }
export const ALT_FLOW = { key: 'vol_ratio', label: 'volume vs its 30-day average' }

let hiddenSet = null
/** The hidden keys: W1-SEC's generated mirror when present (set by `useHiddenSet`), else the ruling set. */
export const hiddenKeys = () => hiddenSet || HIDDEN_FALLBACK
/** scanHidden.js (PR #657) registers its own set here once merged; tests may inject one. */
export const useHiddenSet = (set) => { hiddenSet = set instanceof Set && set.size ? set : null }
const isFlow = (k) => /^(dp_|opt_)/.test(k)

/** One public field a member can use instead of the hidden `key`. */
export function publicAlternative(key) {
  return isFlow(key) ? ALT_FLOW : SETUP_KEYS.has(key) ? ALT_SETUP : ALT_STRENGTH
}

/** The F-16 sentence (+ one public alternative) for the first hidden key among `keys`, or null. */
export function refusalFor(keys) {
  const hidden = hiddenKeys()
  for (const k of keys || []) {
    if (!hidden.has(k)) continue
    const alt = publicAlternative(k)
    return `${isFlow(k) ? FLOW_REFUSAL : RATINGS_REFUSAL}. A public alternative: ${alt.label} (${alt.key}).`
  }
  return null
}

/**
 * SC-2 §3: the refined wire spec from the last one and the follow-up's parts. Pure (the server mirror is
 * refine.compose). `add` / `post` replace by key (add, narrow); a list filter on sector/industry replaces the whole
 * universe slot; `sort` replaces only the sort. → { spec } | { error }
 */
export function composeRefine(last, { wire = [], post = [], sort = null } = {}) {
  const why = refusalFor([...wire.map(f => f.key), ...post.map(f => f.key), ...(sort ? [sort.key] : [])])
  if (why) return { error: why }
  const universe = wire.filter(f => UNIVERSE_KEYS.includes(f.key))
  const mine = new Set([...wire, ...post].map(f => f.key))
  let filters = (last?.filters || []).filter(f => !mine.has(f.key))
  if (universe.length) filters = filters.filter(f => !UNIVERSE_KEYS.includes(f.key))
  filters = [...filters, ...wire]
  const measures = [...(last?.post || []).filter(f => !mine.has(f.key)), ...post]
  return { spec: { filters, post: measures, sort: sort || last?.sort || null } }
}

// ── persistence (fire-and-forget writes; one read per conversation switch) ──
const slim = (last) => ({
  spec: { filters: (last.spec?.filters || []).map(f => { const o = { ...f }; delete o.pending; return o }), post: last.spec?.post || [], sort: last.spec?.sort || null },
  symbols: (last.symbols || []).slice(0, ROW_CAP), total: Number.isFinite(last.total) ? last.total : null,
  asOf: last.asOf || null, name: last.name || null, savedId: last.savedId != null ? String(last.savedId) : null,
})
/** Persist the screener's last screen for the member's current conversation. Never throws, never awaited by answers. */
export function persistLastScreen(last) {
  const id = activeConversationId()
  if (!id || !last?.spec) return null
  return agentConversationStateSet(id, STATE_KEY, slim(last)).catch(() => null)
}
/** The last screen stored for the current conversation → the screener's `last` shape, or null. */
export async function restoreLastScreen() {
  const id = activeConversationId()
  if (!id) return null
  const r = await agentConversationState(id, STATE_KEY).catch(() => null)
  const v = r && r.ok ? r.data?.value : null
  if (!v || typeof v !== 'object' || !v.spec || !Array.isArray(v.spec.filters)) return null
  return { spec: { filters: v.spec.filters, post: Array.isArray(v.spec.post) ? v.spec.post : [], sort: v.spec.sort || null },
    name: v.name || null, savedId: v.savedId || null, total: Number.isFinite(v.total) ? v.total : 0, asOf: v.asOf || null,
    live: null, symbols: Array.isArray(v.symbols) ? v.symbols : [], ms: 0, restored: true, conversation: id }
}
export const NO_LAST_SCREEN = "Which screen should I narrow? Run one first, e.g. “stocks above their 20-day EMA with volume at least twice average”."
