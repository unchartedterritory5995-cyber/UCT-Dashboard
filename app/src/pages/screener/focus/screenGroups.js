export const GROUPS = [
  { key: 'momentum', label: 'Momentum leaders' },
  // The UCT Relative Strength starters (`saved_screens.RS_STARTER_GROUP`). Without this row
  // the label matched nothing and `groupOf` filed all seven under Momentum leaders (review
  // finding #12, 2026-11-07). Shown only while RS_V2_ENABLED is on (the server gates them).
  { key: 'relative_strength', label: 'Relative strength' },
  { key: 'breakouts', label: 'Breakouts & entries' },
  { key: 'bases', label: 'Bases & chart patterns' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'quality', label: 'Quality & value' },
  // Shown only while pre-market mode is on for this user (the server gates the starters).
  { key: 'premarket', label: 'Extended hours' },
  // Shown only while the trader archive is on (the server gates the starter).
  { key: 'team', label: 'Team archive' },
]
const BY_LABEL = Object.fromEntries(GROUPS.map(g => [g.label.toLowerCase(), g.key]))
// Phase-1 fallback until starters() carries `group` (Task 13). Ids read from starters().
export const FALLBACK_GROUP = {
  starter_uct_50: 'momentum',
  starter_momentum_leaders: 'momentum',
  starter_pullback_20ema: 'momentum',
  starter_power_play: 'momentum',
  starter_anticipation: 'momentum',
  starter_gap_movers: 'momentum',
  starter_volume_surge_now: 'momentum',
  starter_gap_up_volume: 'momentum',
  starter_trend_template: 'momentum',
  starter_tight_base: 'bases',
  starter_three_weeks_tight: 'bases',
  starter_base_pocket_pivot: 'breakouts',
  starter_stage2_breakout: 'breakouts',
  starter_52w_breakout: 'breakouts',
  starter_near_20d_high_volume: 'breakouts',
  starter_earnings_momentum: 'earnings',
  starter_value_quality: 'quality',
}
export const DEFAULT_PINNED = ['starter_momentum_leaders', 'starter_power_play', 'starter_tight_base', 'starter_three_weeks_tight']
// RS screens (2026-11-14): while the payload carries `starter_rs_leaders` (the server gates it on
// RS_SCREENS_ENABLED) these four lead a new member's pins, so the first one is where a first
// open lands. A member's stored pins, favourites and last-used screen are never touched by this.
export const RS_DEFAULT_PINNED = ['starter_rs_leaders', 'starter_rs_new_high', 'starter_rs_nh_before_price', 'starter_rs_top_rating']

// The pins of a member who has stored none. Without the RS screens: today's defaults, unchanged.
// With them: the four RS screens, then today's defaults minus any the server marked `hidden`
// (a hidden starter is not offered by the picker, so it is not a default either).
export function defaultPinned(starters = []) {
  const byId = new Map(starters.map(s => [String(s.id), s]))
  const base = DEFAULT_PINNED.filter(id => byId.has(id))
  if (!byId.has(RS_DEFAULT_PINNED[0])) return base
  return [...RS_DEFAULT_PINNED.filter(id => byId.has(id)), ...base.filter(id => !byId.get(id).hidden)]
}

// The starters a list OFFERS (unit U6): everything but the ones the server marked `hidden`.
// A hidden starter is still served, so an id a member already chose (a favourite, a stored chip
// selection, a pin) keeps resolving: `kept` names those, and they stay in the list so the member
// can use them and can take them off. The Table mode's two lists read this; the Focus menu
// applies the same rule itself (ScreenMenu.jsx).
export function offeredStarters(starters = [], kept = null) {
  return (starters || []).filter(s => s && (!s.hidden || (kept ? kept.has(String(s.id)) : false)))
}

export function groupOf(starter) {
  const g = String(starter?.group || '').toLowerCase()
  if (g) return BY_LABEL[g] || (GROUPS.some(x => x.key === g) ? g : g === 'chart patterns' ? 'bases' : 'momentum')
  return FALLBACK_GROUP[starter?.id] || 'momentum'
}

export function migratePinned({ favorites = [], chipPrefs = [], starters = [] }) {
  const known = new Set(starters.map(s => String(s.id)))
  const out = []
  for (const id of [...favorites, ...chipPrefs].map(String)) if (known.has(id) && !out.includes(id)) out.push(id)
  if (out.length) return out
  return defaultPinned(starters)
}
