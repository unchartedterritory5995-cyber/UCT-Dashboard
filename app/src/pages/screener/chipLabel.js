// Human-readable label for an active filter spec, for the removable chips row.
export function chipLabel(def, spec) {
  if (!def || !spec) return ''
  const preset = (def.presets || []).find(o =>
    o.op === spec.op && o.value === spec.value && o.min === spec.min && o.max === spec.max)
  if (preset && preset.label && preset.label !== 'Any') {
    return `${def.label}: ${preset.label}`
  }
  const isMoney = def.unit === '$'
  const unit = def.unit && !isMoney ? def.unit : ''
  const pfx = isMoney ? '$' : ''
  const n = v => `${pfx}${v}${unit}`
  switch (spec.op) {
    case 'between': return `${def.label}: ${n(spec.min)}–${n(spec.max)}`
    case 'gte': return `${def.label}: ≥ ${n(spec.min)}`
    case 'lte': return `${def.label}: ≤ ${n(spec.max)}`
    // ⚠️ STRICT, and the chip must say so. `gt`/`lt` reach here only from the
    // factual presets (`dividend_yield > 0`, `beta < 1`), which normally match
    // the preset branch above and render their own label — this is the fallback
    // for a spec restored from a saved screen whose preset was since reworded.
    // Printing ≥/≤ for them would state a different filter than the one running.
    case 'gt': return `${def.label}: > ${n(spec.min)}`
    case 'lt': return `${def.label}: < ${n(spec.max)}`
    case 'eq': return `${def.label}: ${spec.value}`
    case 'contains': return `${def.label}: ${spec.value}`
    // Fallback only (SharedScreen and any surface without the scan chip):
    // the filter object may carry the scan's name as `label`.
    case 'in': return spec.label || def.label
    default: return def.label
  }
}
