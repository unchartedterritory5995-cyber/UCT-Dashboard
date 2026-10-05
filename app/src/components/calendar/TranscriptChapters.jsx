// app/src/components/calendar/TranscriptChapters.jsx
//
// D-4 (Lane R) — the transcript's chapters as a click-to-jump list. DARK: the
// server attaches `chapters` to the transcript payload only while
// TRANSCRIPT_CHAPTERS_ENABLED is on (api/services/transcript_chapters.py), so
// with the flag off this renders nothing and the panel is unchanged.
//
// ⛔ When the transcript never states where the Q&A begins, the server sends no
//    Q&A chapter at all (`qa_boundary: 'not_stated'`), and this list SAYS so,
//    rather than letting a reader assume the speaker runs cover the questions.
import styles from './TranscriptChapters.module.css'

function turns(c) {
  const n = c.end - c.start + 1
  return `${n} turn${n === 1 ? '' : 's'}`
}

export default function TranscriptChapters({ tree, onJump }) {
  const top = Array.isArray(tree?.chapters) ? tree.chapters : []
  if (!top.length) return null
  return (
    <nav className={styles.chapters} aria-label="Transcript chapters" data-testid="transcript-chapters">
      {top.map(c => (
        <div key={`${c.kind}-${c.start}`} className={styles.group}>
          <button type="button" className={styles.top} onClick={() => onJump?.(c.start)}
                  data-testid="chapter" data-start={c.start}>
            {c.title} <span className={styles.meta}>{turns(c)}</span>
          </button>
          {(c.children || []).length > 0 && (
            <ul className={styles.children}>
              {c.children.map(ch => (
                <li key={`${ch.kind}-${ch.start}`}>
                  <button type="button" className={styles.child} onClick={() => onJump?.(ch.start)}
                          data-testid="chapter" data-start={ch.start}>
                    {ch.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {tree.qa_boundary === 'not_stated' && (
        <p className={styles.note} data-testid="chapters-no-qa">
          This transcript never says where the Q&amp;A begins, so it is not split into
          prepared remarks and questions. The chapters above are runs of one speaker.
        </p>
      )}
    </nav>
  )
}
