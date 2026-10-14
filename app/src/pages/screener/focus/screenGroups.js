export const GROUPS = [
  { key: 'momentum', label: 'Momentum leaders' },
  { key: 'breakouts', label: 'Breakouts & entries' },
  { key: 'bases', label: 'Bases & chart patterns' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'quality', label: 'Quality & value' },
]
const BY_LABEL = Object.fromEntries(GROUPS.map(g => [g.label.toLowerCase(), g.key]))
// Phase-1 fallback until starters() carries `group` (Task 13). Ids read from starters().
export const FALLBACK_GROUP = {
  starter_uct_50: 'momentum',
  starter_momentum_leaders: 'momentum',
  starter_pullback_20ema: 'momentum',
  starter_power_play: 'momentum',
  starter_gap_movers: 'momentum',
  starter_tight_base: 'bases',
  starter_three_weeks_tight: 'bases',
  starter_base_pocket_pivot: 'breakouts',
  starter_stage2_breakout: 'breakouts',
  starter_52w_breakout: 'breakouts',
  starter_earnings_momentum: 'earnings',
  starter_value_quality: 'quality',
}
export const DEFAULT_PINNED = ['starter_momentum_leaders', 'starter_power_play', 'starter_tight_base', 'starter_three_weeks_tight']

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
  return DEFAULT_PINNED.filter(id => known.has(id))
}
