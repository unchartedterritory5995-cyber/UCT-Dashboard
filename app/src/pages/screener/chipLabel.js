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
    case 'eq': return `${def.label}: ${spec.value}`
    case 'contains': return `${def.label}: ${spec.value}`
    default: return def.label
  }
}
