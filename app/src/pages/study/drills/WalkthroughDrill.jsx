/**
 * WalkthroughDrill — the unscored walk-through (spec §13.9 #1; VOICE.md §4
 * "A walk-through"; owner ruling 2026-10-17: the Presenter's Brief is
 * teaching, not a quiz).
 *
 * The mentor narrates in 2-4 short sentences and the member taps Next. The
 * prompt (`prompt_json.q`, a station or a term) is a small label above; the
 * steps show one at a time, the ones already read staying up, muted; a
 * progress dot per step; Next advances. On the last step there is no Next:
 * the player's ONE sticky button reads Continue and posts the attempt as
 * seen. Nothing is checked, nothing is scored, no choices, no reveal card.
 *
 * prompt_json: { q, steps: [2-4 strings], order, subject?, part?, parts? }
 * State: {shown: n}   Answer: {seen: n}   (the server records it unscored)
 *
 * A walk-through may carry a chart like any other item (bars / has_chart):
 * the player's ONE StockChart shows it; this body never mounts a second one.
 */
import UIcon from '../../../components/ui/UIcon'
import { questionOf } from './types'
import styles from './drills.module.css'

export const unscored = true

export function stepsOf(item) {
  const raw = item?.prompt_json?.steps
  return Array.isArray(raw) ? raw.map((s) => String(s)).filter((s) => s.trim()) : []
}

/** How many steps are on screen for this state (always at least the first). */
export function shownCount(state, item) {
  const n = stepsOf(item).length
  if (!n) return 0
  const shown = Number(state?.shown)
  return Math.min(n, Math.max(1, Number.isFinite(shown) ? shown : 1))
}

export function Body({ item, state, setState, locked }) {
  const steps = stepsOf(item)
  const shown = shownCount(state, item)
  const label = questionOf(item)
  const part = item?.prompt_json?.part
  const parts = item?.prompt_json?.parts
  const last = shown >= steps.length
  const next = () => { if (!locked && !last) setState({ shown: shown + 1 }) }
  return (
    <div className={styles.walk} data-testid="walkthrough">
      {label && (
        <p className={styles.walkLabel}>
          <UIcon name="play" size={12} />
          <span>{label}</span>
          {parts > 1 && <span className={styles.walkPart}>{part} of {parts}</span>}
        </p>
      )}
      <ol className={styles.walkSteps} aria-label="Walk-through" aria-live="polite">
        {steps.slice(0, shown).map((s, i) => (
          <li
            key={i}
            className={i === shown - 1 ? styles.walkStepCurrent : styles.walkStep}
            data-testid="walk-step"
            aria-current={i === shown - 1 ? 'step' : undefined}
          >
            {s}
          </li>
        ))}
      </ol>
      <div className={styles.walkFoot}>
        <ol className={styles.walkDots} aria-label={`Step ${shown} of ${steps.length}`} data-testid="walk-dots">
          {steps.map((_, i) => (
            <li key={i} className={i < shown ? styles.walkDotDone : styles.walkDot} aria-hidden="true" />
          ))}
        </ol>
        {!last && (
          <button type="button" className={styles.walkNext} onClick={next} disabled={locked} data-testid="walk-next">
            <span>Next</span>
            <UIcon name="chevronRight" size={16} gold={false} />
          </button>
        )}
      </div>
    </div>
  )
}

export function answerFromState(state, item) {
  return { seen: shownCount(state, item) }
}

export function isAnswerable(state, item) {
  const n = stepsOf(item).length
  return n > 0 && shownCount(state, item) >= n
}

export function choicesOf() {
  return []
}

export default { Body, answerFromState, isAnswerable, choicesOf, unscored }
