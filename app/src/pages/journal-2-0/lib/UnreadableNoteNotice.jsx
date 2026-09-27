import { unanimousUnreadableReason, unreadableMessageFor, unreadableReasonOf } from './noteContentGuard'
import styles from './UnreadableNoteNotice.module.css'

/**
 * S1 / H14 — what every editor built from `buildExtensions()` shows, in words,
 * when it has locked a note it cannot read (noteContentGuard.js). One element,
 * so no surface can drift into saying something else.
 *
 * ⛔ Wave 10 (lane 10C): TWO sentences, chosen by WHY the lock fired — a type a
 * newer bundle wrote ("newer version of the app", reload may fix it) or a body
 * that is merely malformed (reload fixes nothing, and saying "newer" sent members
 * to reload forever). Pass the `editor` for the exact answer; without it the
 * notice uses the reason every live locked editor agrees on, and the
 * newer-version sentence when they do not.
 */
export default function UnreadableNoteNotice({ editor } = {}) {
  const reason = editor ? unreadableReasonOf(editor) : unanimousUnreadableReason()
  return <div role="alert" className={styles.notice}>{unreadableMessageFor(reason)}</div>
}
