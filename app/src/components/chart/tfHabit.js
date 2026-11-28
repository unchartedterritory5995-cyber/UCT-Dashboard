// app/src/components/chart/tfHabit.js
//
// ─── ⭐ THE TIMEFRAMES A MEMBER GOES TO NEXT (2026-11-28, zero-network plan PR 1.5, goal A4) ──────────────────────────
//
// Every timeframe press on a chart's own bar is recorded as a TRANSITION (from -> to), each one weighted by its age
// (a 14-day half-life), on this device. `habitualTfs(from)` names the timeframes most likely pressed next from `from`:
// the ones the member has gone to from there, most weight first; with no history (a new member, a timeframe never left
// before), the neighbours of `from` on the chart's bar (the next longer, then the next shorter). What it names is what
// the chart prepares before the press: the data (ChartWidget's dwell warm), the derived arrays (useNeighborFrames) and,
// with no list beside the chart, the hidden layer (useDoubleBuffer: a press there FLIPS).
//
// Pure apart from localStorage (`uct.tfHabit.v1`, a few hundred bytes; refused storage: in-memory only). Nothing here
// makes a request.

import { tfSortKey } from './timeframes'

export const TF_HABIT_KEY = 'uct.tfHabit.v1'
export const TF_HABIT_HALF_LIFE_MS = 14 * 24 * 3600 * 1000
/** The most `from` rows kept, and the most targets per row (the oldest weights go first). */
const MAX_FROM = 24
const MAX_TO = 8

let _mem = null   // { [from]: { [to]: { w, at } } }
let _now = () => Date.now()

function _load() {
  if (_mem) return _mem
  _mem = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TF_HABIT_KEY) : null
    const o = raw ? JSON.parse(raw) : null
    if (o && typeof o === 'object' && !Array.isArray(o)) _mem = o
  } catch { _mem = {} }
  return _mem
}
function _save() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(TF_HABIT_KEY, JSON.stringify(_mem)) } catch { /* storage refused: memory only */ }
}
const _decayed = (e, t) => (e && Number.isFinite(e.w) && Number.isFinite(e.at) ? e.w * Math.pow(0.5, Math.max(0, t - e.at) / TF_HABIT_HALF_LIFE_MS) : 0)

/** Record a press from timeframe `from` to `to` (both codes; a no-op when either is empty or they are the same). */
export function noteTfPress(from, to) {
  const a = from == null ? '' : String(from)
  const b = to == null ? '' : String(to)
  if (!a || !b || a === b) return
  const m = _load()
  const t = _now()
  const row = m[a] && typeof m[a] === 'object' ? m[a] : (m[a] = {})
  row[b] = { w: _decayed(row[b], t) + 1, at: t }
  const tos = Object.keys(row)
  if (tos.length > MAX_TO) {
    tos.sort((x, y) => _decayed(row[x], t) - _decayed(row[y], t))
    for (const k of tos.slice(0, tos.length - MAX_TO)) delete row[k]
  }
  const froms = Object.keys(m)
  if (froms.length > MAX_FROM) {
    const last = (r) => Math.max(0, ...Object.values(r || {}).map((e) => (e && e.at) || 0))
    froms.sort((x, y) => last(m[x]) - last(m[y]))
    for (const k of froms.slice(0, froms.length - MAX_FROM)) delete m[k]
  }
  _save()
}

/**
 * The `k` timeframes most likely pressed next from `from`, never `from` itself. With `available` (the codes the chart's
 * bar shows), only those, and the bar's neighbours fill what history does not name. Without it, history alone.
 * @param {string} from
 * @param {{k?: number, available?: string[]|null}} [o]
 * @returns {string[]}
 */
export function habitualTfs(from, { k = 2, available = null } = {}) {
  const a = from == null ? '' : String(from)
  if (!a || !(k > 0)) return []
  const avail = Array.isArray(available) && available.length ? available.map(String) : null
  const ok = (c) => c !== a && (!avail || avail.includes(c))
  const m = _load()
  const t = _now()
  const row = m[a] && typeof m[a] === 'object' ? m[a] : {}
  const out = Object.keys(row).filter(ok).map((c) => [c, _decayed(row[c], t)]).filter(([, w]) => w > 0.05)
    .sort((x, y) => y[1] - x[1] || tfSortKey(x[0]) - tfSortKey(y[0])).map(([c]) => c)
  if (out.length < k && avail) {
    // the bar's neighbours of `from`: next longer first, then next shorter, then outward
    const bar = [...new Set(avail)].sort((x, y) => tfSortKey(x) - tfSortKey(y))
    let i = bar.indexOf(a)
    if (i < 0) { const ka = tfSortKey(a); i = bar.findIndex((c) => tfSortKey(c) > ka); if (i < 0) i = bar.length; bar.splice(i, 0, a) }
    for (let d = 1; out.length < k && (i + d < bar.length || i - d >= 0); d++) {
      for (const j of [i + d, i - d]) {
        const c = bar[j]
        if (c != null && ok(c) && !out.includes(c) && out.length < k) out.push(c)
      }
    }
  }
  return out.slice(0, k)
}

/** Tests: forget everything (memory and storage) and use this clock (null restores Date.now). */
export function __resetTfHabitForTests(now = null) {
  _mem = null
  _now = typeof now === 'function' ? now : () => Date.now()
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(TF_HABIT_KEY) } catch { /* none */ }
}
