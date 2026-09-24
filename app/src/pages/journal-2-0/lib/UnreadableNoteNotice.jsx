import { UNREADABLE_NOTE_MESSAGE } from './noteContentGuard'
import styles from './UnreadableNoteNotice.module.css'

/**
 * S1 / H14 — what every editor built from `buildExtensions()` shows, in words,
 * when it has locked a note it cannot read (noteContentGuard.js). One element,
 * one sentence, so no surface can drift into saying something else.
 */
export default function UnreadableNoteNotice() {
  return <div role="alert" className={styles.notice}>{UNREADABLE_NOTE_MESSAGE}</div>
}
