// UCT Agent scans — the LAST SCREEN as server-persisted refinement state (W1-C C-01, builder-c). SC-2 §3.
//
// capabilities/screener.js remembers the last screen it ran so "now only technology", "exclude anything under $10",
// "sort them by three-month performance", "add the top five to a watchlist" compose onto it. Until now that memory
// was the session's only (lost on reload / chat switch). This module:
//   * persists it per CONVERSATION through PUT /api/agent/conversations/{id}/state/lastScreen (fire-and-forget,
//     never blocks an answer) and restores it with the matching GET when the screener has no last screen for the
//     conversation the member is in (a reload, a chat switch);
//   * composes a refinement with the SC-2 §3 rules (mirrored from api/services/uct_agent/scan/refine.py);
//   * F-16: a refinement that adds a HIDDEN UCT field is refused with the owner's sentence (scanHidden.js, the
//     generated mirror of scan/hidden.py — one authority) AND one public alternative: a public field's name only,
//     never a formula, a weight or an input-by-input reconstruction (F-16-R, owner decision 2026-11-02).
// memory.js (result sets for "the third one") stays session-only by design; this is the screen's SPEC + result ids.

import { activeConversationId, agentConversationState, agentConversationStateSet } from '../agentClient'
import { RATING_FIELDS, FLOW_FIELDS, RATINGS_REFUSAL, FLOW_REFUSAL, hiddenPhraseIn } from './scanHidden'

export const STATE_KEY = 'lastScreen'
export const ROW_CAP = 50
export const UNIVERSE_KEYS = ['sector', 'industry']
export { RATINGS_REFUSAL, FLOW_REFUSAL }

const SETUP_KEYS = new Set(['candle_score', 'earnings_setup_grade', 'pattern_engine_id', 'pattern_engine_conf', 'pattern_engine_dir',
  'pattern_engine_vcp', 'pattern_engine_flat_base', 'pattern_expectancy_r', 'pattern_entry_dist_pct', 'pattern_stop_dist_pct',
  'base_structure', 'base_relation_count', 'base_pivot_px', 'hvc_52w'])
export const ALT_STRENGTH = { key: 'chg_pct_3m', label: '3-month price change' }
export const ALT_SETUP = { key: 'dist_52w_high_pct', label: 'distance from the 52-week high' }
export const ALT_FLOW = { key: 'vol_ratio', label: 'volume vs its 30-day average' }

/** The hidden keys (scanHidden.js: ratings + proprietary + flow). */
export const hiddenKeys = () => new Set([...RATING_FIELDS, ...FLOW_FIELDS])
const isFlow = (k) => FLOW_FIELDS.has(k)

/** One public field a member can use instead of the hidden `key`. */
export function publicAlternative(key) {
  return isFlow(key) ? ALT_FLOW : SETUP_KEYS.has(key) ? ALT_SETUP : ALT_STRENGTH
}

/** The F-16 sentence (+ one public alternative) for the first hidden key among `keys`, or null. */
export function refineRefusal(keys) {
  for (const k of keys || []) {
    if (!RATING_FIELDS.has(k) && !FLOW_FIELDS.has(k)) continue
    const alt = publicAlternative(k)
    return `${isFlow(k) ? FLOW_REFUSAL : RATINGS_REFUSAL}. A public alternative: ${alt.label} (${alt.key}).`
  }
  return null
}

/** W1.1 R-05 (live LT-8): the F-16 sentence + the public alternative when the member's own WORDS name a hidden field
 *  ("rs rank", "uct composite", "dark pool"…) — checked BEFORE any catalog or look-alike matching, so a hidden field is
 *  never re-mapped to a public look-alike (rs_rank → rs_line_trend) and run in its place. Null when no hidden phrase is
 *  present. The phrase list is scan/hidden.py's (one authority, generated into scanHidden.js). Mirror: refine.refusal_for_text. */
export function refineRefusalForText(text) {
  const hit = hiddenPhraseIn(text)
  return hit ? refineRefusal([hit.key]) : null
}

/**
 * SC-2 §3: the refined wire spec from the last one and the follow-up's parts. Pure (the server mirror is
 * refine.compose). `add` / `post` replace by key (add, narrow); a list filter on sector/industry replaces the whole
 * universe slot; `sort` replaces only the sort. A group stays: a new one is ANDed onto it, so a refinement can only narrow
 * the group, never lose it. One order at a time: a `sort` clears a rank and a `rank` clears the sort. → { spec } | { error }
 */
export function composeRefine(last, { wire = [], post = [], sort = null, logic = null, rank = null } = {}) {
  const why = refineRefusal([...wire.flatMap(f => [f.key, f.other]), ...post.map(f => f.key), ...(sort ? [sort.key] : []), ...(rank?.criteria || []).map(c => c.key)])
  if (why) return { error: why }
  const universe = wire.filter(f => UNIVERSE_KEYS.includes(f.key))
  const mine = new Set([...wire, ...post].map(f => f.key))
  let filters = (last?.filters || []).filter(f => !mine.has(f.key))
  if (universe.length) filters = filters.filter(f => !UNIVERSE_KEYS.includes(f.key))
  filters = [...filters, ...wire]
  const measures = [...(last?.post || []).filter(f => !mine.has(f.key)), ...post]
  const group = last?.logic && logic ? { all: [last.logic, logic] } : (logic || last?.logic || null)
  const keptRank = !sort && !rank ? last?.rank : null
  return { spec: { filters, post: measures, sort: rank ? null : (sort || last?.sort || null), ...(rank || keptRank ? { rank: rank || keptRank } : {}), ...(group ? { logic: group } : {}) } }
}

// ── persistence (fire-and-forget writes; one read per conversation switch) ──
const slim = (last) => ({
  // ⛔ the group and the rank are the screen: a restored spec without them would refine a LOOSER screen than the one shown
  spec: { filters: (last.spec?.filters || []).map(f => { const o = { ...f }; delete o.pending; return o }), post: last.spec?.post || [], sort: last.spec?.sort || null,
    ...(last.spec?.logic ? { logic: last.spec.logic } : {}), ...(last.spec?.rank ? { rank: last.spec.rank } : {}) },
  symbols: (last.symbols || []).slice(0, ROW_CAP), total: Number.isFinite(last.total) ? last.total : null,
  asOf: last.asOf || null, name: last.name || null, savedId: last.savedId != null ? String(last.savedId) : null,
})
// TERM-033: the write and the read used to end in `.catch(() => null)` and ignore a failed result, so an UNREADABLE last
// screen read exactly like NO last screen, and a failed write was dropped without a word (a chat switched away and back
// then refined the OLDER server copy). Both are logged now; a read that fails, or that would return a copy this session
// failed to overwrite, is LAST_SCREEN_FAILED, and the refinement says it is starting fresh (LAST_SCREEN_UNREAD).
export const LAST_SCREEN_FAILED = Object.freeze({ lastScreenFailed: true })
/** conversations whose newest screen this session could NOT save: the server holds an older one (or none) */
const unsaved = new Set()
export function _forgetUnsavedScreens() { unsaved.clear() }
const causeOf = (r) => (r?.status ? `HTTP ${r.status}` : (r?.error || r?.message || 'error'))
const warnScreen = (msg) => console.warn(`[uct-agent] screener: ${msg}`)
/** Persist the screener's last screen for the member's current conversation. Never throws, never awaited by answers. */
export function persistLastScreen(last) {
  const id = activeConversationId()
  if (!id || !last?.spec) return null
  const failed = (cause) => {
    unsaved.add(id)
    warnScreen(`this chat's last screen was not saved (${cause}); a chat switch or reload starts fresh`)
    return { ok: false, error: cause }
  }
  return agentConversationStateSet(id, STATE_KEY, slim(last))
    .then(r => { if (!r?.ok) return failed(causeOf(r)); unsaved.delete(id); return r }, e => failed(causeOf(e)))
}
/** The last screen stored for the current conversation → the screener's `last` shape; null when there is none;
 *  LAST_SCREEN_FAILED when it could not be read (or the stored copy is older than a screen this session failed to save). */
export async function restoreLastScreen() {
  const id = activeConversationId()
  if (!id) return null
  if (unsaved.has(id)) { warnScreen("this chat's last screen could not be read back (its newest save failed; the stored copy is older)"); return LAST_SCREEN_FAILED }
  const r = await agentConversationState(id, STATE_KEY)          // never rejects: a failure is { ok: false, … }
  if (!r?.ok) { warnScreen(`this chat's last screen could not be read back (${causeOf(r)})`); return LAST_SCREEN_FAILED }
  const v = r.data?.value
  if (!v || typeof v !== 'object' || !v.spec || !Array.isArray(v.spec.filters)) return null
  return { spec: { filters: v.spec.filters, post: Array.isArray(v.spec.post) ? v.spec.post : [], sort: v.spec.sort || null,
    ...(v.spec.logic ? { logic: v.spec.logic } : {}), ...(v.spec.rank ? { rank: v.spec.rank } : {}) },
    name: v.name || null, savedId: v.savedId || null, total: Number.isFinite(v.total) ? v.total : 0, asOf: v.asOf || null,
    live: null, symbols: Array.isArray(v.symbols) ? v.symbols : [], ms: 0, restored: true, conversation: id }
}
export const LAST_SCREEN_UNREAD = "I couldn't read this chat's last screen back from UCT, so I'm starting fresh: run the screen again first, e.g. “stocks above their 20-day EMA with volume at least twice average”."
export const NO_LAST_SCREEN = "Which screen should I narrow? Run one first, e.g. “stocks above their 20-day EMA with volume at least twice average”."
