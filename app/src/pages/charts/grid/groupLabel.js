// Last-resort readable label for a group id when its curated display name
// isn't known (e.g. a board persisted before names were stored, or a cold
// fetchGroups). "additive_manufacturing" -> "Additive Manufacturing". The
// stored group.name always wins over this; this only prevents ever showing a
// raw snake_case id in the heat header.

export function humanizeGroupId(id) {
  if (typeof id !== 'string' || !id) return ''
  return id
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
