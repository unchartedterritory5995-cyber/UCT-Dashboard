/**
 * deskVideoHref — the ONE builder for a Desk video deep link.
 *
 * The Desk videos section reads two URL params (VideosSection.jsx, the
 * `?v=` effect): `v` is the 11-char YouTube id to auto-play once the catalog
 * loads, and `t` is an optional seek in whole seconds, applied ONLY when
 * `Math.floor(Number(t)) > 0`. `section=videos` is mandatory because Desk.jsx
 * otherwise falls back to the `desk_section` localStorage value.
 *
 * Why `t=0` is OMITTED here: the consumer treats 0 and "absent" identically
 * (both mean "start at the top"), so emitting `&t=0` is dead weight in the URL
 * and makes two links to the same moment compare unequal. StockChart's
 * `deskMentionHref` still emits `&t=0` for a mention at the very top of a
 * session; that builder is left alone (its tests pin the behaviour) — this one
 * is for the RS indicator's Learn links (plan 2026-11-06 engineering map §2.8),
 * where "no timestamp" and "timestamp 0" are the same intent.
 *
 * Nothing here imports react-router: it is a pure string builder so it can be
 * used from IndicatorChip/About copy, tests and the Python rail alike.
 */

// A YouTube id is exactly 11 characters from the URL-safe base64 alphabet.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * @param {string} youtubeId  11-char YouTube id (refused otherwise → null)
 * @param {number} [seconds]  seek target; emitted as `&t=<int>` only when it is
 *                            a finite number ≥ 1 (floored). 0, negatives, NaN,
 *                            null, undefined and strings are all "no seek".
 * @returns {string|null}
 */
export function deskVideoHref(youtubeId, seconds) {
  if (typeof youtubeId !== 'string' || !YOUTUBE_ID_RE.test(youtubeId)) return null
  let seek = ''
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    const t = Math.floor(seconds)
    if (t >= 1) seek = `&t=${t}`
  }
  // The id is already URL-safe by the regex above, so no encoding is needed.
  return `/desk?section=videos&v=${youtubeId}${seek}`
}

/**
 * The lessons the RS indicator's cards and markers link to (design spec
 * 2026-11-05 §6.11; which lesson per card came with the 2a-16 brief). Keys are
 * what the About readout (unit 2a-10) will look up; `t` is seconds into the
 * video, or undefined when the card points at the whole workshop.
 *
 * Mirrored by `tests/fixtures/indicators/rs_learn_videos.json`, which the
 * Python rail (`tests/test_rs_learn_seed.py`) checks against the Desk seed so
 * a regenerated seed sheet cannot drop a target silently. Keep the two in sync.
 *
 * START SECONDS, decision D6 (2026-11-07): a lesson starts at the chapter that
 * covers relative strength where the video has chapter data in the repo, and
 * otherwise at 1 s. Why 1 and not "no t": without a seek the player resumes
 * wherever this member last stopped (GlobalVideoLayer's `resumeSeconds`), so a
 * Learn link could open mid-workshop on an unrelated topic; `t=1` always opens
 * the lesson at its top. What the repo holds for each video (checked against
 * api/services/education_seed.py, the only Desk video data in the tree; the
 * generated `chapters` live in the education DB, not the repo):
 *   rsLine, phase  sM-aFdyOps4  no chapter data (description has no timestamps) -> 1
 *   newHigh        QCTOJgCQmjw  no chapter data (description has no timestamps) -> 1
 *   beforePrice    _0ZvKLYznLo  1814 kept: the 2a-16 brief's seek to the exact
 *                               "RS before price" passage, finer than a chapter
 *   redDay         mfswYu5UlX8  341 kept: the brief's seek to the red-day passage
 *   fourChecks     mfswYu5UlX8  726 kept: the brief's seek to the four checks
 * No video here had repo chapter data, so no row starts at a chapter today.
 */
export const RS_LEARN_VIDEOS = Object.freeze({
  rsLine: Object.freeze({
    youtubeId: 'sM-aFdyOps4',
    t: 1, // D6: no chapter data in the repo; open at the top, not a resume point
    label: 'Manrav on the RS line: Relative Strength Workshop',
  }),
  phase: Object.freeze({
    youtubeId: 'sM-aFdyOps4',
    t: 1, // D6: same workshop, same reason
    label: 'Manrav on the RS line and its 21 EMA',
  }),
  newHigh: Object.freeze({
    youtubeId: 'QCTOJgCQmjw',
    t: 1, // D6: no chapter data in the repo; open at the top, not a resume point
    label: 'Chartmaster on tracking relative strength',
  }),
  beforePrice: Object.freeze({
    youtubeId: '_0ZvKLYznLo',
    t: 1814, // 30:14
    label: 'Chartmaster: RS shows before price confirms',
  }),
  redDay: Object.freeze({
    youtubeId: 'mfswYu5UlX8',
    t: 341, // 5:41
    label: 'Chartmaster: RS highs on red market days',
  }),
  fourChecks: Object.freeze({
    youtubeId: 'mfswYu5UlX8',
    t: 726, // 12:06
    label: 'Chartmaster: the four RS checks',
  }),
})

/**
 * Compose a Learn link for one lesson key. Unknown key → null, so a card with
 * a typo renders no link rather than a broken one.
 * @param {keyof typeof RS_LEARN_VIDEOS} key
 * @returns {string|null}
 */
export function learnHref(key) {
  const entry = Object.prototype.hasOwnProperty.call(RS_LEARN_VIDEOS, key)
    ? RS_LEARN_VIDEOS[key]
    : null
  if (!entry) return null
  return deskVideoHref(entry.youtubeId, entry.t)
}
