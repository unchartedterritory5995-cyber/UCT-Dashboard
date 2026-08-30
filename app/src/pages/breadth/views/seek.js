/**
 * The date cursor's ONE resolver.
 *
 * `BreadthViews` owns `rowIdx`; every view that puts a date on screen asks to
 * move it. Two questions get asked about the same target — "can I offer this as
 * a link?" (`canSeek`, before paint) and "move there" (`onSeek`, on click) — and
 * they MUST agree, or a view renders a live-looking affordance that does
 * nothing. So both are derived from this one function rather than each carrying
 * its own idea of reachable (`lesson_a_second_authority_over_one_value`).
 *
 * ⛔ A DATE OUTSIDE THE LOADED WINDOW RESOLVES TO `null`, IT DOES NOT CLAMP.
 *
 * Clamping a 2025 analogue to the oldest loaded row would move the cursor to a
 * session the user never asked for and label it with the date they clicked —
 * the exact dishonesty the lenses' "could not evaluate" vocabulary exists to
 * avoid. A NUMERIC index does clamp, because a numeric index is the scrubber
 * asking for a position in a range it already knows, not a claim about a date.
 */

/**
 * date string → newest-first row index. Built once per window in the container.
 * Duplicate dates keep the FIRST occurrence, i.e. the newest row carrying it.
 */
export function buildDateIndex(rows = []) {
  const index = new Map()
  rows.forEach((row, i) => {
    const d = row?.date
    if (d == null) return
    const key = String(d)
    if (!index.has(key)) index.set(key, i)
  })
  return index
}

/**
 * @param {string|number} target   a session date ('2026-08-04') or a row index
 * @param {Map<string,number>} dateIndex  from `buildDateIndex`
 * @param {number} length         rows.length
 * @returns {number|null}         the index to move to, or null = unreachable
 */
export function resolveSeekIndex(target, dateIndex, length) {
  if (!Number.isFinite(length) || length <= 0) return null

  if (typeof target === 'number') {
    if (!Number.isFinite(target)) return null
    return Math.max(0, Math.min(length - 1, Math.trunc(target)))
  }
  if (typeof target !== 'string') return null

  const hit = dateIndex?.get(target.trim())
  if (hit == null) return null
  // A stale index handed a row number past the end is still unreachable — say
  // so rather than clamping a date the way a numeric target is clamped.
  return hit >= 0 && hit < length ? hit : null
}
