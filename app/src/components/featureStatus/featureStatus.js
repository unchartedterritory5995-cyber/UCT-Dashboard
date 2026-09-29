/**
 * TERM-039 (FB-S12-02) — member-facing feature status, read off the auth payload.
 *
 * ⛔ THE CLIENT NAMES NOTHING. Which capabilities are member-facing, and what a member
 * calls them, is declared once in `docs/feature_flags.json` (`member_facing`); whether
 * each is on for this member is the server's per-request answer. Both arrive together in
 * the payload's `feature_status` field (`api/services/feature_status.py`), and this module
 * only reads it. A capability name typed here would be a second list beside the flags —
 * `tests/test_feature_status.py::test_labels_live_only_in_the_ledger` holds that out.
 *
 * ⛔ THREE STATES, AND SILENCE IS NOT ONE OF THEM:
 *   released — on for everyone it is on for;
 *   preview  — on early for THIS account only (the Beta mark);
 *   unknown  — the server could not vouch either way; rendered as "not measured".
 * An OFF capability is not in the list at all. And a payload that carries no
 * `feature_status` (an older server, a failed read) is NOT an empty list: it reads as
 * `null`, which every surface renders as "not available" — never as "nothing here".
 */

export const STATE_RELEASED = 'released'
export const STATE_PREVIEW = 'preview'
export const STATE_UNKNOWN = 'unknown'

const STATES = new Set([STATE_RELEASED, STATE_PREVIEW, STATE_UNKNOWN])

/** The strip's anchor on the Support page, and the Beta mark's destination. */
export const FEATURE_STATUS_ANCHOR = 'feature-status'
export const FEATURE_STATUS_HREF = `/support#${FEATURE_STATUS_ANCHOR}`

function isText(v) {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * The payload's `feature_status`, validated, or `null` when the server did not measure it.
 * A malformed entry is dropped rather than shown under a made-up name; a malformed field
 * as a whole is `null` (not measured), never an empty "measured" answer.
 */
export function readFeatureStatus(payload) {
  const fs = payload?.feature_status
  if (!fs || typeof fs !== 'object' || fs.measured !== true || !Array.isArray(fs.features)) {
    return null
  }
  const features = fs.features.filter(
    (f) => f && isText(f.id) && isText(f.label) && isText(f.where) && STATES.has(f.state),
  )
  return { measured: true, features }
}

/** Is any of `ids` (payload keys) an early preview for this member right now? */
export function isPreview(status, ids) {
  if (!status?.measured) return false
  const want = new Set(Array.isArray(ids) ? ids : [ids])
  return status.features.some((f) => want.has(f.id) && f.state === STATE_PREVIEW)
}

/** The strip's two columns plus the not-measured line, in the server's order. */
export function stripView(status) {
  if (!status?.measured) return { measured: false, released: [], preview: [], unknown: [] }
  const by = (state) => status.features.filter((f) => f.state === state)
  return {
    measured: true,
    released: by(STATE_RELEASED),
    preview: by(STATE_PREVIEW),
    unknown: by(STATE_UNKNOWN),
  }
}
