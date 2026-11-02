/**
 * The file importer's `importNotice` blocks: what a media item becomes when it could not be
 * stored, written IN ITS PLACE so nothing an export carried vanishes in silence
 * (connector fidelity Plan B, Task 4).
 *
 * ⛔⛔ NO SECOND VOCABULARY (controller ruling R2). Every reason code and the retry ceiling come
 * from `../importNoticeText.js`, the copy table `tests/test_import_notice.py` pins against the
 * server's `import_notice.py`. The named map below is only spelling: each value is checked
 * against that list at load, and `importNotice.test.js` asserts every reason this module can
 * write is in it.
 *
 * ⛔ A FILE-IMPORT NOTICE IS FINAL (controller ruling R3). Nothing retries a file import on a
 * schedule, so:
 *   · `attempts` is written as `MEDIA_RETRY_MAX_ATTEMPTS`: a `fetch_failed` notice never reads
 *     "retrying on the next sync";
 *   · a door's `storage_limit` ("will be copied once space frees up") is written as the
 *     client's `storage_full` ("Free up space and import again"), and the note is PUT with
 *     `importMediaPending: true` (commit.js) so that re-import really does retry it.
 */
import { NOTICE_REASONS as COPY_REASONS, MEDIA_RETRY_MAX_ATTEMPTS } from '../importNoticeText'

const named = {
  uploadFailed: 'upload_failed',
  tooLarge: 'too_large',
  typeRefused: 'type_refused',
  storageLimit: 'storage_limit',
  storageFull: 'storage_full',
  fetchFailed: 'fetch_failed',
  unresolvableSrc: 'unresolvable_src',
  decodeFailed: 'decode_failed',
  missingResource: 'missing_resource',
}
for (const code of Object.values(named)) {
  if (!COPY_REASONS.includes(code)) throw new Error(`importNotice: "${code}" is not in importNoticeText's NOTICE_REASONS`)
}
/** Spelling only: the vocabulary itself is `importNoticeText.NOTICE_REASONS`. */
export const NOTICE_REASONS = Object.freeze(named)

/** The reason a notice is WRITTEN with: a door's `storage_limit` becomes the final `storage_full`. */
export function noticeReasonFor(reason) {
  const code = typeof reason === 'string' && reason.trim() ? reason.trim() : NOTICE_REASONS.missingResource
  return code === NOTICE_REASONS.storageLimit ? NOTICE_REASONS.storageFull : code
}

/** A usable display name, or `null` (blank and non-strings are no name). */
export const nameOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null)
const httpOrNull = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null)

/**
 * `{type:'importNotice', attrs:{reason, name, sourceUrl, ref, attempts}}`. A blank or missing
 * name is `null` (the copy table's "this item" fallback reads it), never an empty string; a
 * `sourceUrl` is kept only when it is http(s).
 */
export function importNoticeNode({ reason, name = null, sourceUrl = null, ref = null } = {}) {
  return {
    type: 'importNotice',
    attrs: {
      reason: noticeReasonFor(reason),
      name: nameOrNull(name),
      sourceUrl: httpOrNull(sourceUrl),
      ref: nameOrNull(ref),
      attempts: MEDIA_RETRY_MAX_ATTEMPTS,
    },
  }
}

/**
 * The reason an upload refusal is recorded with. The server's own `reason` wins, passed through
 * UNCHANGED (R2: the server's vocabulary is the copy table's; an unknown code still renders, as
 * `unsupported`). Only a legacy or proxy answer with no reason falls back on its status.
 */
export function reasonForUploadFailure(status, body) {
  if (body && typeof body.reason === 'string' && body.reason.trim()) return body.reason.trim()
  if (status === 413) return NOTICE_REASONS.tooLarge
  if (status === 400 || status === 415) return NOTICE_REASONS.typeRefused
  if (status === 507) return NOTICE_REASONS.storageLimit
  return NOTICE_REASONS.uploadFailed
}
