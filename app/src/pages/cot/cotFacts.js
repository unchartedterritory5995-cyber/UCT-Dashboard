// app/src/pages/cot/cotFacts.js — the facts the written weekly read may cite.
//
// The server's grounding gate rejects any number in the model's prose that is
// not present here, so this is deliberately the ONLY bridge between the
// deterministic read and the narrative: rounded, labelled, nothing derived
// on the other side.
import { HORIZONS, MIN_EPISODES } from './cotAnalogs'

// Round half AWAY from zero (JS's Math.round sends -2.15 to -2.1).
const rnd = (v, k) => Math.sign(v) * Math.round(Math.abs(v) * k) / k
const r1 = v => (v == null || !Number.isFinite(v) ? null : rnd(v, 10))
const r0 = v => (v == null || !Number.isFinite(v) ? null : rnd(v, 1))

export function narrativeFacts({ symbol, name, snap, read, analogs, divergences, proxy }) {
  const g = key => {
    const x = snap.groups[key]
    return {
      net: x.net, wow: x.wow, pct_of_oi: r1(x.pctOi),
      index_3y: r0(x.index), index_26w: r0(x.index26), zone: x.zone,
      streak_weeks: x.streak, weeks_in_zone: x.weeksInZone ?? null, move_6w: r0(x.move6),
    }
  }
  const stats = analogs && analogs.n >= MIN_EPISODES ? analogs.stats : null
  return {
    symbol, name, report_date: snap.date, window_weeks: snap.windowWeeks,
    bias: { label: read.bias.label, strength: read.bias.strength },
    crowding: { label: read.crowding.label, index: read.crowding.index },
    groups: { commercials: g('commercials'), large_speculators: g('largeSpecs'), small_speculators: g('smallSpecs') },
    open_interest: { value: snap.oi.value, wow: snap.oi.wow, index_3y: r0(snap.oi.index), streak_weeks: snap.oi.streak },
    signals: (read.signals || []).map(s => s.label),
    price_check: (divergences || []).map(d => d.label),
    precedents: stats ? {
      episodes: analogs.n, proxy: proxy?.ticker || null, direction: analogs.direction,
      horizons: Object.fromEntries(HORIZONS.map(h => [`${h}w`, {
        n: stats[h]?.n ?? 0, hits: stats[h]?.hits ?? null, hit_rate: r0(stats[h]?.hitRate),
        median_pct: r1(stats[h]?.median), best_pct: r1(stats[h]?.best), worst_pct: r1(stats[h]?.worst),
      }])),
    } : null,
    who_is_who: read.classNote || null,
  }
}
