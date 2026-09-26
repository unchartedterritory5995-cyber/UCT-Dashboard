import { normalizeTagPath, tagKey } from './tagTree'

/**
 * Wave 6 items 9 + 12 — a note's tags change by the member's DELTA, never by
 * resending a whole list.
 *
 * ⚰️ The editor's old tag field PUT the comma field's entire list on blur: a
 * list loaded when the note opened. A bulk tag change made meanwhile (another
 * tab, the Notebook's bulk bar) was undone by a field the member never
 * touched. Now each add or remove is applied to the list the SERVER holds at
 * that moment (read just before the write), so a change made elsewhere
 * survives, and nothing is sent when the delta changes nothing.
 *
 * Identity is the server's `tag_key` (tagTree.tagKey: normalised, lower-cased):
 * removing "Research" removes "research", adding "research/semis" beside an
 * existing "Research/Semis" adds nothing.
 */
export function mergeTagDelta(base, { add = [], remove = [] } = {}) {
  const drop = new Set(remove.map(tagKey).filter(Boolean))
  const out = []
  const seen = new Set()
  for (const t of base || []) {
    const k = tagKey(t)
    if (!k || drop.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  for (const t of add) {
    const path = normalizeTagPath(t)
    const k = path.toLowerCase()
    if (!k || drop.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(path)
  }
  return out
}

/** The same tags in the same order, by identity. */
export function sameTagList(a, b) {
  const ka = (a || []).map(tagKey)
  const kb = (b || []).map(tagKey)
  return ka.length === kb.length && ka.every((k, i) => k === kb[i])
}
