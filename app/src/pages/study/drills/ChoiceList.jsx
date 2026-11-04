/**
 * ChoiceList — the one choice control every choice drill uses (spec §13.7 D6, D17, D18).
 *
 * A radiogroup: 2-4 full-width 52px rows, or a 2x2 grid when every label is at
 * most 12 characters. Selected = ghost + gold border + check glyph, never green.
 * Keys 1-4 select, arrows move, Enter is left to the player (Check / Continue).
 * Nothing fires a haptic or a sound on choosing (D11: reveal only).
 */
import { useCallback, useRef } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from './drills.module.css'
import { answerWord } from '../revealCardHelpers'

export const GRID_MAX_CHARS = 12

export function useGridLayout(choices) {
  return choices.length >= 2 && choices.length <= 4 && choices.every((c) => String(c).length <= GRID_MAX_CHARS)
}

/** After the verdict: the bank's answer and, when the pick missed, the pick, so the cards can show green and red. */
/** A choice label and an answer are the same when they read the same: case, spacing and yes/true aside. */
export function sameAnswer(a, b) {
  if (a == null || b == null) return false
  const norm = (v) => String(v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/^true$/, 'yes').replace(/^false$/, 'no')
  return norm(a) === norm(b)
}

export function revealLabels(reveal, state) {
  if (!reveal) return {}
  const right = answerWord(reveal) || null
  const pick = state?.choice ?? null
  return { rightLabel: right, wrongLabel: right != null && pick != null && !sameAnswer(pick, right) ? pick : null }
}

export default function ChoiceList({ choices, value, onChange, disabled = false, label = 'Choices', showKeys = true, rightLabel = null, wrongLabel = null }) {
  const grid = useGridLayout(choices)
  const refs = useRef([])

  const onKeyDown = useCallback((e, idx) => {
    if (disabled) return
    const n = choices.length
    let next = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % n
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (idx - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === ' ') { e.preventDefault(); onChange(choices[idx]); return }
    if (next == null) return
    e.preventDefault()
    onChange(choices[next])
    refs.current[next]?.focus()
  }, [choices, disabled, onChange])

  return (
    <ul role="radiogroup" aria-label={label} className={grid ? styles.choicesGrid : styles.choices}>
      {choices.map((choice, i) => {
        const selected = value != null && value === choice
        return (
          <li key={`${i}-${choice}`}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${styles.choice} ${sameAnswer(choice, rightLabel) ? styles.choiceRight : ''} ${sameAnswer(choice, wrongLabel) ? styles.choiceWrong : ''}`}
              disabled={disabled}
              ref={(el) => { refs.current[i] = el }}
              tabIndex={selected || (value == null && i === 0) ? 0 : -1}
              onClick={() => { if (!disabled) onChange(choice) }}
              onKeyDown={(e) => onKeyDown(e, i)}
              data-choice-index={i + 1}
            >
              {showKeys && <span className={styles.choiceKey} aria-hidden="true">{i + 1}</span>}
              <span className={styles.choiceLabel}>{choice}</span>
              {selected
                ? <span className={styles.choiceCheck}><UIcon name="check" size={18} /></span>
                : <span className={styles.choiceGhost} aria-hidden="true" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
