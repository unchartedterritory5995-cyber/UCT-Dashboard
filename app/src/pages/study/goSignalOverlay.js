/**
 * goSignalOverlay — the two lines every HOURLY Go Signal study chart carries,
 * both rays from the first bar of the flag: the FLAG LOW (gold, with the price
 * label: the level the first hour undercuts and then reclaims, owner ruling
 * 2026-10-27 — "notable hourly flags that undercut a slight range and quickly go
 * red to green in the first hour") and, fainter, the FLAG HIGH, so the "slight
 * range" is drawn rather than imagined. The HVE and Gap Support charts carry
 * their levels the same way: the setup IS the level.
 *
 * The flag comes from the item's facts, written by
 * scripts/study/find_go_signal_hourly.py: `flag_start_t` (the unix-seconds key
 * of the flag's first hourly bar), `flag_low` and `flag_high`. An item without
 * a flag start (the daily Go Signal drafts, the detector fixtures) carries no
 * layer — a daily chart cannot show an hourly flag. Pure: no React, no fetch.
 */

export const GO_SIGNAL_SKILL_ID = 'setup.intraday.go_signal'
export const GO_SIGNAL_SETUP_NAME = 'Go Signal'

const GOLD = '#dcbb5e'
const GOLD_SOFT = 'rgba(220, 187, 94, 0.55)'

/** Is this study item an HOURLY Go Signal example? The skill or the name, AND an hourly flag in the facts. */
export function isGoSignalHourlyItem(item) {
  if (!item) return false
  const facts = item.reveal_json?.facts || {}
  if (!(Number(facts.flag_start_t) > 0)) return false
  if (item.skill_id === GO_SIGNAL_SKILL_ID) return true
  const name = facts.setup || item.reveal_json?.setup || item.prompt_json?.setup
  return typeof name === 'string' && name.trim().toLowerCase().startsWith(GO_SIGNAL_SETUP_NAME.toLowerCase())
}

function sameKey(a, b) {
  return String(a) === String(b)
}

/** The flag's first bar from the chart's own bars (matched on the stored key), or null. */
export function flagStartBar(item, bars) {
  const list = Array.isArray(bars) ? bars : []
  const key = item?.reveal_json?.facts?.flag_start_t
  if (key == null || !list.length) return null
  const i = list.findIndex((b) => sameKey(b.t, key))
  return i < 0 ? null : list[i]
}

/**
 * The two rays for StockChart's `annotations` layer, or null without a flag.
 * Order is fixed (flag high first, flag low second); the emphasis is on the
 * flag low: gold, wider, and the only one with a price label.
 */
export function goSignalAnnotations(item, bars) {
  const start = flagStartBar(item, bars)
  if (!start) return null
  const facts = item?.reveal_json?.facts || {}
  const low = Number(facts.flag_low)
  const high = Number(facts.flag_high)
  if (!(low > 0) || !(high > 0)) return null
  return [
    {
      id: 'study-go-flag-high', type: 'hray', points: [{ time: start.t, price: high }],
      color: GOLD_SOFT, lineWidth: 1, lineStyle: 'dashed',
    },
    {
      id: 'study-go-flag-low', type: 'hray', points: [{ time: start.t, price: low }],
      color: GOLD, lineWidth: 2, lineStyle: 'dashed', showPriceLabel: true,
    },
  ]
}
