// CUSTOM HEADER STATS (owner 11-16): "add a button where users can display custom data points in the header, not
// just stuff in the list". A member picks an indicator they could put on the chart (EMA 21, RSI 14, ATR, % From MA 50,
// one of their own saved formulas), with the parameters they choose and the output they want, and the info row
// prints that output's value on the newest bar beside the catalog stats.
//
// THIS FILE IS STORAGE ONLY: pure, no registry, no React. It is imported by headerStatCatalog.js, which the chart
// header and the settings window both read, so it must stay tiny and dependency-free. The compute lives in
// engine/customStatCompute.js (the registry's own `computeFor`, the same call the binder makes for a drawn line).
//
// STORAGE (under `header`, absent by default, so an untouched chart keeps today's exact row and blob):
//   header.customStats: [{ id: 'c1', defId: 'movingAverage', plotKey: 'ma', inputs: { period: 21, maType: 'ema' },
//                          name: 'EMA 21' }]
//   header.fields:      the custom stat's place in the row is its key `cx:<id>`, ordered with the catalog stats.
//   header.statLabels:  a rename works on `cx:<id>` exactly like a catalog stat.
// `name` is a snapshot of the stat's label when it was added: what the header prints before the compute answers and
// what a member sees if the indicator later goes away (a deleted saved formula). The live label is recomputed.
//
// Sanitised on read (the same discipline as `header.fields` / `statLabels`): an entry is rebuilt field by field from
// an allow-list (an AST, a source string or a cached value smuggled into a stored entry is dropped), input values are
// primitives only, ids are unique, and the list is capped. Whether the definition EXISTS and its inputs are VALID is
// the compute's question, asked again on every read (a saved formula can be deleted after it was added).

export const CUSTOM_STAT_PREFIX = 'cx:'
/** A header strip, not a dashboard: at most this many custom stats per chart. */
export const MAX_CUSTOM_STATS = 8
const ID_RE = /^c[0-9]{1,4}$/
const DEF_ID_MAX = 128
const NAME_MAX = 32
const MAX_INPUTS = 24

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max

/** Is `key` a custom stat key (`cx:<id>`)? */
export const isCustomStatKey = (key) => typeof key === 'string' && key.startsWith(CUSTOM_STAT_PREFIX)
export const customStatKey = (id) => `${CUSTOM_STAT_PREFIX}${id}`
export const customStatIdOf = (key) => (isCustomStatKey(key) ? key.slice(CUSTOM_STAT_PREFIX.length) : null)

/** One stored input map, primitives only (numbers finite, strings short). */
function cleanInputs(raw) {
  const out = {}
  if (!isObj(raw)) return out
  let n = 0
  for (const [k, v] of Object.entries(raw)) {
    if (n >= MAX_INPUTS) break
    if (!isStr(k, 64) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'boolean' || (typeof v === 'string' && v.length <= 64))) {
      out[k] = v
      n += 1
    }
  }
  return out
}

/** ONE stored entry, rebuilt from the allow-list, or null when it is not a custom stat. Never spreads the input. */
export function sanitizeCustomStat(entry) {
  if (!isObj(entry)) return null
  let id, defId, plotKey, inputs, name
  try { ({ id, defId, plotKey, inputs, name } = entry) } catch { return null }   // a booby-trapped getter
  if (typeof id !== 'string' || !ID_RE.test(id)) return null
  if (!isStr(defId, DEF_ID_MAX) || !isStr(plotKey, 64)) return null
  const out = { id, defId, plotKey, inputs: cleanInputs(inputs) }
  const nm = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim() : ''
  if (nm) out.name = nm
  return out
}

/** The custom stats a header carries — sanitised, unique ids, capped. Always a fresh array. */
export function customStatsOf(header) {
  const raw = header && Array.isArray(header.customStats) ? header.customStats : []
  const out = []
  const seen = new Set()
  for (const e of raw) {
    const s = sanitizeCustomStat(e)
    if (!s || seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
    if (out.length >= MAX_CUSTOM_STATS) break
  }
  return out
}

/** The stored entry for a `cx:<id>` key, or null. */
export function customStatFor(header, key) {
  const id = customStatIdOf(key)
  if (!id) return null
  return customStatsOf(header).find((s) => s.id === id) || null
}

/** The next free id (`c1`, `c2`, …): never a live id. A freed id can come back, so removing a custom stat also drops
 *  its rename and color (headerStatTogglePatch): nothing keyed on the old stat can leak onto a new one. */
export function nextCustomStatId(header) {
  const used = new Set(customStatsOf(header).map((s) => s.id))
  for (let i = 1; i < 10000; i++) if (!used.has(`c${i}`)) return `c${i}`
  return null
}

const sameStat = (a, b) => a.defId === b.defId && a.plotKey === b.plotKey
  && JSON.stringify(Object.entries(a.inputs).sort()) === JSON.stringify(Object.entries(b.inputs).sort())

/** Why `entry` cannot be added to `header` (a sentence), or null when it can. */
export function customStatAddRefusal(header, entry) {
  const list = customStatsOf(header)
  if (list.length >= MAX_CUSTOM_STATS) return `The header holds at most ${MAX_CUSTOM_STATS} custom stats.`
  const probe = sanitizeCustomStat({ ...(isObj(entry) ? entry : {}), id: 'c1' })
  if (!probe) return 'That is not a stat the header can show.'
  if (list.some((s) => sameStat(s, probe))) return 'That stat is already in the header.'
  return null
}

/** The `header` patch that adds one custom stat at the END of the row: `{customStats, fields}`. `{}` when refused.
 *  `currentKeys` is the row as it reads now (headerStatKeys), so a legacy blob with no `fields` keeps its stats. */
export function addCustomStatPatch(header, entry, currentKeys) {
  if (customStatAddRefusal(header, entry)) return {}
  const id = nextCustomStatId(header)
  const s = id && sanitizeCustomStat({ ...entry, id })
  if (!s) return {}
  return {
    customStats: [...customStatsOf(header), s],
    fields: [...(Array.isArray(currentKeys) ? currentKeys : []), customStatKey(id)],
  }
}

/** `customStats` without the entry behind `key` (its row place, rename and colour are dropped by the caller). */
export function customStatsWithout(header, key) {
  const id = customStatIdOf(key)
  return customStatsOf(header).filter((s) => s.id !== id)
}
