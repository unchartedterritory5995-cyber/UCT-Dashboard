import useReadAloud from '../../hooks/useReadAloud'
import styles from './ReadAloudButton.module.css'

/**
 * <ReadAloudButton trackId="wire-2026-05-08" label="Morning Wire" textProvider={() => '...'} />
 *
 * - trackId: stable id so the same button reflects "playing now" state across re-renders
 * - label: shown in the AudioPlayerBar while this track plays
 * - textProvider: sync or async () => string. Called on click. May fetch.
 * - size: 'sm' (default) | 'md'
 */
export default function ReadAloudButton({ trackId, label, textProvider, size = 'sm', children }) {
  const { play, isPlayingTrack, isPausedTrack } = useReadAloud()
  const playingNow = isPlayingTrack(trackId)
  const pausedHere = isPausedTrack(trackId)

  const onClick = () => play({ trackId, label, textProvider })

  const icon = playingNow ? '❚❚' : pausedHere ? '▶' : '🔊'
  const aria = playingNow ? 'Pause read-aloud' : pausedHere ? 'Resume read-aloud' : 'Read aloud'

  return (
    <button
      type="button"
      className={`${styles.btn} ${size === 'md' ? styles.md : styles.sm} ${playingNow ? styles.playing : ''}`}
      onClick={onClick}
      aria-label={aria}
      title={aria}
    >
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      {children && <span className={styles.text}>{children}</span>}
    </button>
  )
}
