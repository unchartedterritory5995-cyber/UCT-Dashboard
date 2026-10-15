import { chipLabel } from '../chipLabel'

// Plain words for the Focus layout (owner decision 5, 2026-10-14). ONE place: the list's setup
// line, the chart pane's facts and the sort menu all read it, so a column or a structure never
// carries two names on one screen. A column with no entry keeps the label the server's meta gives
// it; a structure with no entry keeps its textbook name.

// "ADR" collides with the "ADRs" type filter, so the range is spelled out.
export const PLAIN_COLUMN_LABELS = {
  vol_ratio: 'Volume vs avg',
  adr_pct: 'Avg daily range',
  adr_pct_1w: 'Avg daily range (5-day)',
  atr_pct: 'Avg true range',
  pct_vs_sma20: 'vs 20-day avg',
  pct_vs_sma50: 'vs 50-day avg',
  pct_vs_sma200: 'vs 200-day avg',
  pct_vs_ema20: 'vs 20-day exp. avg',
  chg_pct_1d: 'Change today',
}

export const plainColumnLabel = key => PLAIN_COLUMN_LABELS[key] || null

// Preset labels are written to stand alone ("Over 4%"); mid-sentence the operator word reads
// lowercase ("Avg daily range over 4%"). Only these words: a name, a ticker or an acronym keeps
// its capitals.
const OPERATOR_WORDS = /^(Over|Under|Above|Below|At least|At most|More than|Less than|Between|Within|Up|Down|Near|Rising|Falling|Positive|Negative)\b/
export const lowerOperator = s => String(s ?? '').replace(/^(.*?:\s*)(.*)$/, (m, head, rest) => head + rest.replace(OPERATOR_WORDS, w => w.toLowerCase()))

// The Focus layout's label for an active filter: the shared chip label (the old page's, unchanged)
// with the plain column name and the operator word lowercased. "Avg daily range: over 4%".
export function focusChipLabel(def, spec) {
  if (!def) return ''
  const plain = plainColumnLabel(def.key) || plainColumnLabel(def.column) || def.label
  return lowerOperator(chipLabel({ ...def, label: plain }, spec))
}

// The server's meta with each filter's label said plainly, for the Filters drawer's headings.
// Only labels change; keys, presets and order are the server's. Same object back when nothing moves.
export function plainMeta(meta) {
  if (!Array.isArray(meta?.filters)) return meta
  let moved = false
  const filters = meta.filters.map(f => {
    const plain = plainColumnLabel(f.key) || plainColumnLabel(f.column)
    if (!plain || plain === f.label) return f
    moved = true
    return { ...f, label: plain }
  })
  return moved ? { ...meta, filters } : meta
}

// One short fact per column, for the chart pane's fact line.
const FACTS = {
  vol_ratio: v => `Volume ${v.toFixed(1)}× avg`,
  adr_pct: v => `Avg daily range ${v.toFixed(1)}%`,
}

export function plainFact(key, v) {
  const f = FACTS[key]
  return f && typeof v === 'number' && Number.isFinite(v) ? f(v) : null
}

// Structure names that are trader shorthand, said plainly. The textbook name stays in the tooltip.
export const PLAIN_STRUCTURE_NAMES = {
  'Cheat (3-C)': 'Early entry inside a cup (3-C)',
  'Low Cheat': 'Early entry low in a base',
  'EMA Crossback': 'Pullback through the 9- and 20-day avgs',
  'Wyckoff Spring': 'Dip below the range floor, then reclaimed',
}

export const plainStructure = name => PLAIN_STRUCTURE_NAMES[name] || name
