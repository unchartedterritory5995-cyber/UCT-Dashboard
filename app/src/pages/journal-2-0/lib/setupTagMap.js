/**
 * Wave 13 lane 13I-2 — the ONE alias map between UCT's setup vocabularies (plan risk R-14).
 *
 * There are two setup lists in this app and they do not agree (CLAUDE.md measured a partial
 * overlap): the Model Book catalog (`pages/modelbook/setupCatalog.js` SETUP_CATALOG, its
 * field-guide names) and the trade-labelling taxonomy (`constants/setupGroups.js` SETUPS).
 * A chart's setup tag (`ta.setupTag`) is ALWAYS a canonical tag from this file:
 *
 *   * a catalog name is canonical as written;
 *   * a taxonomy name that is the same setup under another name (GROUP_TO_CATALOG) resolves to
 *     the catalog's name; every other taxonomy name is canonical as written.
 *
 * Both lists are READ, never retyped: `SETUP_TAGS` is derived from them, so a setup added to
 * either list is a tag the day it lands (and the rail fails if it has no family).
 *
 * The pattern engine's CONFIRMED detections (the fingerprint's `patterns` field, `confirmed_only`
 * by construction, 13I-1) map to a tag through PATTERN_TO_TAG. A mapped detection is only ever
 * OFFERED: `suggestTags` returns suggestions and this file has no way to apply one. Applying a
 * tag is the member's click (FingerprintPanel), never this module (plan A.13I "Not: auto-tagging").
 *
 * PURE: no fetch, no React.
 */
import { SETUP_CATALOG, SETUP_FAMILIES } from '../../modelbook/setupCatalog'
import { SETUPS } from '../../../constants/setupGroups'

/** Taxonomy names that are a catalog setup under another name. Only exact equivalences —
 *  a taxonomy setup with no catalog twin stays its own tag rather than being forced into one. */
export const GROUP_TO_CATALOG = Object.freeze({
  'Classic U&R': 'U&R (Undercut & Rally)',
  'Failed H&S/Rounded Top': 'Failed H&S / Rounded Top',
  'Opening Range Breakout': 'ORB (Opening Range Break)',
  '30min Pivot': '30-Minute Pivot',
  'News Gappers': 'News/Earnings Gapper',
})

/** The family of each taxonomy-only tag (catalog tags carry their own `family`). */
export const TAXONOMY_ONLY_FAMILY = Object.freeze({
  'High Tight Flag (Powerplay)': 'Bases & Breakouts',
  VCP: 'Bases & Breakouts',
  '4B Setup (Stan Weinstein)': 'Bases & Breakouts',
  'Classic Flag/Pullback': 'Momentum & Trend',
  HVC: 'Gaps & Catalysts',
  'Wick Play': 'Reversals & Reclaims',
  'News Failure': 'Reversals & Reclaims',
  'Red to Green': 'Reversals & Reclaims',
  'Opening Range Breakdown': 'Intraday',
  'Red to Green (Intraday)': 'Intraday',
  'Green to Red': 'Intraday',
  'Mean Reversion L/S': 'Intraday',
})

const CATALOG_NAMES = SETUP_CATALOG.map((s) => s.name)
const CATALOG_FAMILY = Object.fromEntries(SETUP_CATALOG.map((s) => [s.name, s.family]))

/** Every canonical tag, catalog first (in catalog order), then the taxonomy-only ones. */
export const SETUP_TAGS = Object.freeze([
  ...CATALOG_NAMES,
  ...SETUPS.filter((n) => !CATALOG_NAMES.includes(n) && !(n in GROUP_TO_CATALOG)),
])

const BY_LOWER = new Map()
for (const tag of SETUP_TAGS) BY_LOWER.set(tag.toLowerCase(), tag)
for (const [alias, tag] of Object.entries(GROUP_TO_CATALOG)) BY_LOWER.set(alias.toLowerCase(), tag)

/** The canonical tag for a name from either list (case-insensitive), or null. */
export function canonicalSetupTag(name) {
  if (typeof name !== 'string') return null
  return BY_LOWER.get(name.trim().toLowerCase()) ?? null
}

/** The field-guide family of a canonical tag, or null. */
export function setupFamily(tag) {
  const t = canonicalSetupTag(tag)
  if (!t) return null
  return CATALOG_FAMILY[t] || TAXONOMY_ONLY_FAMILY[t] || null
}

/** Every canonical tag in one family (a playbook filter such as "my breakouts"). */
export function tagsInFamily(family) {
  return SETUP_TAGS.filter((t) => setupFamily(t) === family)
}

export { SETUP_FAMILIES }

// ── the pattern engine's confirmed detections ─────────────────────────────────

/**
 * pattern_engine detector id → canonical tag, for every id the confirmed-verdict store judges
 * (`api/services/pattern_vision/rubrics.py` FOCUSED_SETUPS — the rail reads that list from the
 * file). `null` = a candle, not a setup: never suggested as a tag.
 */
export const PATTERN_TO_TAG = Object.freeze({
  vcp: 'VCP',
  flat_base: 'Flat Base Breakout',
  high_tight_flag: 'High Tight Flag (Powerplay)',
  cup_handle_uct: 'Cup & Handle',
  bull_flag: 'Bull Flag',
  pullback_to_10ema: 'Classic Flag/Pullback',
  pullback_to_21ema: '20 EMA Pullback',
  pullback_to_50sma: 'Classic Flag/Pullback',
  episodic_pivot: 'Episodic Pivot',
  power_earnings_gap: 'Power Earnings Gap',
  u_and_r: 'U&R (Undercut & Rally)',
  remount: 'Remount',
  hammer: null,
  bullish_engulfing: null,
})

/**
 * Suggested tags from a frozen fingerprint: the confirmed detections that map to a tag, one
 * per tag (the most confident), most confident first. NEVER applies anything — a suggestion
 * the member has not clicked is only a suggestion.
 */
export function suggestTags(fingerprint) {
  const field = fingerprint?.fields?.patterns
  const list = Array.isArray(field?.value) ? field.value : []
  const best = new Map()
  for (const d of list) {
    const tag = PATTERN_TO_TAG[d?.setup]
    if (!tag) continue
    const conf = typeof d.confidence === 'number' ? d.confidence : null
    const prev = best.get(tag)
    if (!prev || (conf ?? -1) > (prev.confidence ?? -1)) {
      best.set(tag, { tag, patternId: d.setup, confidence: conf, asOf: d.asof_date || null })
    }
  }
  return [...best.values()].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))
}

// ── the setup-plan template a tag starts from (12B's trade plans) ──────────────

/** Family → the 12B setup trade-plan template its tags start from (`notebookTemplates.js`
 *  SETUP_PLANS keys). Per-tag overrides below; `null` = no template fits (short setups other
 *  than the parabolic short, intraday). */
const FAMILY_TEMPLATE = Object.freeze({
  'Bases & Breakouts': 'breakout-plan',
  'Momentum & Trend': 'pullback-plan',
  'Gaps & Catalysts': 'episodic-pivot-plan',
  'Reversals & Reclaims': 'undercut-rally-plan',
  Intraday: null,
})
const TAG_TEMPLATE_OVERRIDE = Object.freeze({
  'Bull Flag': 'pullback-plan',
  'Wedge Drop': null,
  'Parabolic Short': 'parabolic-short-plan',
  'Parabolic Long': null,
  'Failed H&S / Rounded Top': null,
})

/** The setup-plan template key a tag's checklist comes from, or null. */
export function planTemplateForTag(tag) {
  const t = canonicalSetupTag(tag)
  if (!t) return null
  if (t in TAG_TEMPLATE_OVERRIDE) return TAG_TEMPLATE_OVERRIDE[t]
  return FAMILY_TEMPLATE[setupFamily(t)] ?? null
}
