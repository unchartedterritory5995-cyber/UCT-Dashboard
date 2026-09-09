import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import { objectTypeName, objectSummary, hiddenCount } from '../../../components/chart/drawingObjects'
import styles from './MobileObjectsSheet.module.css'

/* The RECOVERY SURFACE — every object on this chart, including the ones you
 * cannot see.
 *
 * ⛔ THIS EXISTS BEFORE PER-OBJECT HIDE, ON PURPOSE, and the ordering was the
 * owner's call rather than a preference. Hide without recovery produces an
 * object that is invisible, unselectable and unlistable — which is not
 * "hidden", it is "lost", and it is indistinguishable from one the user deleted
 * by accident. A phone makes it worse: there is no right-click, no Objects
 * panel docked beside the chart, and a mis-tap is cheap. So the manager ships
 * first and Hide becomes a safe control because of it.
 *
 * ⭐ THREE KINDS OF LOST, and this answers all three:
 *   • HIDDEN — you turned it off and cannot turn it back on. Every hidden row
 *     is still listed, marked, and one tap from returning; and "Show all N"
 *     is a single escape hatch that never needs you to find them individually.
 *   • LOCKED — it is there but will not respond, and nothing on a phone says
 *     why. The lock state is shown and toggled here.
 *   • FORGOTTEN — you do not remember what is on this chart at all. The list
 *     names every object and the level it sits at.
 *
 * ⛔ IT OWNS NO STATE. Every row acts through the same `updateDrawing` /
 * `removeDrawing` the canvas uses, on the same store. A local copy of the
 * object list would be a second authority over what exists — the one thing a
 * recovery surface can never be wrong about.
 */
export default function MobileObjectsSheet({
  open, onClose, sym = '',
  drawings = [],
  onToggleHidden,      // (id, hidden) => void
  onToggleLocked,      // (id, locked) => void
  onDelete,            // (id) => void
  onShowAll,           // () => void
  className = '',
}) {
  const hidden = hiddenCount(drawings)

  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet"
      title={sym ? `Objects on ${sym}` : 'Objects'} ariaLabel="Chart objects" className={className}>
      <div className={styles.list}>
        {/* ⛔ THE COUNT IS STATED EVEN WHEN IT IS ZERO-ADJACENT. "You have 3
            hidden objects" is the sentence that turns a confusing chart into an
            explained one, and it must not be something you have to notice by
            scanning rows. */}
        {hidden > 0 && (
          <div className={styles.banner}>
            <span className={styles.bannerText}>
              {hidden} hidden object{hidden === 1 ? '' : 's'}
            </span>
            <button type="button" className={styles.bannerBtn}
              onClick={() => { haptics.tap(); onShowAll?.() }}
              aria-label={`Show all ${hidden} hidden objects`}>
              Show all
            </button>
          </div>
        )}

        {drawings.length === 0 && (
          <div className={styles.empty}>Nothing drawn on {sym || 'this chart'} yet.</div>
        )}

        {drawings.map((d) => {
          const name = objectTypeName(d.type)
          const summary = objectSummary(d)
          const isHidden = !!d.hidden
          return (
            <div key={d.id} className={`${styles.row} ${isHidden ? styles.rowHidden : ''}`} data-testid="object-row">
              <span className={styles.swatch} aria-hidden="true" style={{ background: d.color || 'var(--color-text-dim, #8a8578)' }} />
              <span className={styles.name}>
                {name}
                {summary ? <span className={styles.summary}>{summary}</span> : null}
              </span>

              {/* The state a phone user cannot otherwise discover. */}
              {isHidden && <span className={styles.tag}>Hidden</span>}
              {d.locked && !isHidden && <span className={styles.tag}>Locked</span>}

              <button type="button" className={`${styles.ctl} ${isHidden ? styles.ctlOff : ''}`}
                onClick={() => { haptics.tap(); onToggleHidden?.(d.id, !isHidden) }}
                aria-label={isHidden ? `Show ${name}` : `Hide ${name}`}
                aria-pressed={isHidden}>
                <UIcon name={isHidden ? 'eyeOff' : 'eye'} size={16} gold={false} />
              </button>

              <button type="button" className={`${styles.ctl} ${d.locked ? styles.ctlOn : ''}`}
                onClick={() => { haptics.tap(); onToggleLocked?.(d.id, !d.locked) }}
                aria-label={d.locked ? `Unlock ${name}` : `Lock ${name}`}
                aria-pressed={!!d.locked}>
                <UIcon name={d.locked ? 'lock' : 'unlock'} size={15} gold={false} />
              </button>

              <button type="button" className={styles.ctl}
                onClick={() => { haptics.tap(); onDelete?.(d.id) }}
                aria-label={`Delete ${name}`}>
                <UIcon name="trash" size={15} gold={false} />
              </button>
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}
