// Spec §6.3. A ✓ only for a filter that reads one column with a plain
// comparison; pools read "In …"; everything that cannot be checked per row
// (scan joins, logic trees, ranks, field-to-field, structure contains) is a
// plain sentence. Never a ✓ we cannot back with the row's own value.
import { chipLabel } from '../chipLabel'
import { plainColumnLabel, structureSentence, patternEngineSentence, lowerOperator } from './plainWords'
import { sessionCloseLabel } from './dates'

export const NOT_CHECKABLE_KEYS = new Set([
  'universe', 'list', 'scan', 'tickers', 'arith', 'base_structure', 'pattern_engine_id',
])
const CHECK_OPS = new Set(['gte', 'lte', 'gt', 'lt', 'between', 'eq', 'in', 'not_in'])
const MAX = 5

const isCheckable = (key, spec) =>
  !NOT_CHECKABLE_KEYS.has(key) && CHECK_OPS.has(spec?.op) && !String(spec?.op || '').endsWith('_col')

export function whyColumns(filters) {
  return Object.entries(filters || {}).filter(([k, v]) => v && isCheckable(k, v)).map(([k]) => k)
}

// A row value we cannot read: absent, empty, or a non-finite number. Such a
// filter cannot be backed by the row, so it is a note, never a ✓.
const isMissing = v =>
  v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))

// Bool row value: only 1 / true / 'true' / '1' read Yes; 0 / false / '0' read No.
const isYes = v => Number(v) === 1 || v === true || v === 'true'

// A bool filter requires the state named by its spec value; falsy means "Not …".
const requiresFalse = v => v === 0 || v === false || v === '0'

// Compact only at |v| >= 10000. The unit is chosen AFTER rounding to one
// decimal, so 999999 steps up to 1M instead of reading 1000K.
export function compact(n) {
  if (Math.abs(n) < 10000) return null
  for (const [d, s] of [[1e3, 'K'], [1e6, 'M'], [1e9, 'B']]) {
    const x = Number((n / d).toFixed(1))
    if (Math.abs(x) < 1000 || d === 1e9) return `${x}${s}`
  }
  return null
}

// Labels from the shared chipLabel carry raw numbers; any run of 5+ digits reads compactly.
export const compactDigits = s => String(s).replace(/\d{5,}(?:\.\d+)?/g, m => compact(Number(m)) ?? m)

function fmtValue(def, v) {
  if (isMissing(v)) return '—'
  if (def?.type === 'bool') return isYes(v) ? 'Yes' : 'No'
  if (typeof v !== 'number') return String(v)
  const big = compact(v)
  const n = big ?? (Math.abs(v) >= 100 ? v.toFixed(2).replace(/\.00$/, '') : String(Math.round(v * 100) / 100))
  if (def?.unit === '$') return `$${n}`
  if (def?.unit === '%') return `${n}%`
  return n
}

// chipLabel says "RS Rank: ≥ 80"; the strip reads "RS Rank ≥ 80".
const stripColon = s => s.replace(/:\s*/, ' ').replace(/\s+/g, ' ').trim()

function checkLabel(def, spec) {
  // Mid-sentence after "Not" a word drops its capital ("Not above 50-day avg"); an acronym keeps it ("Not HVC").
  if (def.type === 'bool') return requiresFalse(spec.value) ? `Not ${/^[A-Z][a-z]/.test(def.label) ? def.label[0].toLowerCase() + def.label.slice(1) : def.label}` : def.label
  if ((spec.op === 'in' || spec.op === 'not_in') && Array.isArray(spec.values) && spec.values.length) {
    const list = spec.values.join(', ')
    return stripColon(spec.op === 'not_in' ? `${def.label}: not ${list}` : `${def.label}: ${list}`)
  }
  return compactDigits(stripColon(lowerOperator(chipLabel(def, spec))))
}

// Does `v` satisfy a plain comparison? Used only where the shown value is NOT the one the
// screen ran on (a live price): the scan's own answer already vouches for the snapshot value.
function satisfies(spec, v) {
  switch (spec.op) {
    case 'gte': return !Number.isFinite(spec.min) || v >= spec.min
    case 'lte': return !Number.isFinite(spec.max) || v <= spec.max
    case 'gt': return !Number.isFinite(spec.min) || v > spec.min
    case 'lt': return !Number.isFinite(spec.max) || v < spec.max
    case 'between': return (!Number.isFinite(spec.min) || v >= spec.min) && (!Number.isFinite(spec.max) || v <= spec.max)
    default: return true
  }
}

// The columns whose live value is shown instead of the snapshot's (livePrice.js decides it).
const LIVE_FIELDS = { price: 'price', chg_pct_1d: 'chg' }

// P10: a structure filter reads as what the stock has or is doing ("Has a short boxy base",
// "In a downtrend: lower highs and lows"), from the preset names in plain words (plainWords
// structureSentence); any other filter that cannot be checked per row reads its chip.
function noteLabel(key, def, spec) {
  const chip = stripColon(lowerOperator(chipLabel(def, spec) || ''))
  const preset = (def.presets || []).find(o => o.op === spec.op && o.value === spec.value && o.label && o.label !== 'Any')
  if (key === 'base_structure' && preset) {
    return structureSentence(preset.label)
  }
  // The engine's verdict, not the row's structure: the setup line beside this strip names the
  // base read, which can call the same stock something else (or nothing).
  if (key === 'pattern_engine_id' && spec.op === 'contains') {
    return patternEngineSentence(preset?.label, spec.value)
  }
  return chip && chip !== def.label ? compactDigits(chip) : `Matches ${def.label}`
}

// Trader archive (2026-10-16): ONE evidence item naming the team's newest call
// on the name. Always a 'note', never a ✓: it is context the screen did not
// test, so nothing here may read as a condition the row met. Present only when
// the row carries the archive columns (the Team Archive view, or a member who
// added them) and the team has actually called the name.
export function archiveNote(row) {
  const n = Number(row?.archive_calls_n)
  if (!Number.isFinite(n) || n < 1) return null
  const setup = row?.archive_last_setup ? String(row.archive_last_setup).replace(/_/g, ' ') : null
  const date = row?.archive_last_call_date ? String(row.archive_last_call_date).slice(0, 10) : null
  const r20 = Number(row?.archive_last_r20)
  const outcome = row?.archive_last_r20 != null && Number.isFinite(r20)
    ? ` (r20 ${r20 >= 0 ? '+' : ''}${r20.toFixed(1)}%)` : ''
  const head = setup && date ? `Team: ${setup} called ${date}${outcome}` : date ? `Team: called ${date}${outcome}` : 'Team: called'
  return { kind: 'note', label: `${head} · ${n} call${n === 1 ? '' : 's'}` }
}

export function whyItsHere({ filters = {}, logic = null, rank = null, metaFilters = [], row = {}, live = null, snapshotDate = null } = {}) {
  const defs = Object.fromEntries((metaFilters || []).map(f => [f.key, f]))
  const all = []
  // The close the row's numbers describe: its own bars_asof, else the session before the build.
  const asOfClose = sessionCloseLabel(snapshotDate, row?.bars_asof)
  for (const [key, spec] of Object.entries(filters || {})) {
    if (!spec) continue
    if (key === 'universe') { all.push({ kind: 'pool', label: `In ${spec.label || 'UCT Universe'}` }); continue }
    if (key === 'list') { all.push({ kind: 'pool', label: `In ${spec.label || 'your list'}` }); continue }
    if (key === 'scan') { all.push({ kind: 'note', label: `In My Scan ${spec.label || ''}`.trim() }); continue }
    const raw = defs[key] || { key, label: key, presets: [] }
    // Plain words (owner decision 5): the strip names a column as the list and sort menu do.
    const def = { ...raw, label: plainColumnLabel(key) || raw.label }
    if (!isCheckable(key, spec)) {
      all.push({ kind: 'note', label: noteLabel(key, def, spec) }); continue
    }
    const label = checkLabel(def, spec)
    const field = LIVE_FIELDS[key]
    if (field && live?.live) {
      // B5: the header shows the live price, so the strip checks the live price too.
      const v = live[field]
      if (isMissing(v)) { all.push({ kind: 'note', label, value: '—' }); continue }
      if (satisfies(spec, v)) { all.push({ kind: 'check', label, value: fmtValue(def, v) }); continue }
      // Moved out of range since the snapshot: say so, and say when it matched.
      all.push({ kind: 'note', label, value: `${fmtValue(def, v)} now${asOfClose ? ` (matched at ${asOfClose})` : ''}` })
      continue
    }
    if (isMissing(row[key])) { all.push({ kind: 'note', label, value: '—' }); continue }
    const value = fmtValue(def, row[key])
    // No live price: the value is the snapshot's, and says which close it is.
    all.push({ kind: 'check', label, value: field && asOfClose ? `${value} at ${asOfClose}` : value })
  }
  if (logic) all.push({ kind: 'note', label: 'Matches your custom criteria' })
  if (rank) all.push({ kind: 'note', label: rank.top_n ? `Ranked in the top ${rank.top_n} by your weights` : 'Ranked by your weights' })
  const team = archiveNote(row)
  if (team) all.push(team)
  return { items: all.slice(0, MAX), more: Math.max(0, all.length - MAX) }
}
