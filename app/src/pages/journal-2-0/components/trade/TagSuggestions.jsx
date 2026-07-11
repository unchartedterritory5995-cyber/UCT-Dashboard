/**
 * TagSuggestions (Journal 2.0 P6-4) — deterministic "Compass suggests" chip row.
 *
 * A compact, one-tap-accept row of suggested mistake/emotion tags for a closed
 * trade. Each chip is individually acceptable — clicking it calls the matching
 * onAccept (mistake vs emotion) with that tag; a `title` tooltip carries the
 * heuristic reason. A ✕ dismisses the whole row locally (this mount only). The
 * accept itself flows through the caller's EXISTING optimistic tag write, so
 * there is one tag-write path.
 *
 * Renders nothing when: the `tagSuggest` feature flag is off, there are no
 * suggestions, or every suggested tag is already applied / has been dismissed.
 * NO emoji — the lightbulb is a UIcon glyph.
 *
 * Props:
 *   suggestions:     {mistakes: [str], emotions: [str], reasons: {tag: reason}}
 *   currentMistakes: string[] — tags already on the trade (belt-and-suspenders;
 *   currentEmotions: string[]   the BE already filters these out)
 *   onAcceptMistake(tag): void
 *   onAcceptEmotion(tag): void
 */

import { useMemo, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { useFeatureFlag } from '../../featureFlags'
import styles from './TagSuggestions.module.css'

export default function TagSuggestions({
  suggestions,
  currentMistakes,
  currentEmotions,
  onAcceptMistake,
  onAcceptEmotion,
}) {
  const flagOn = useFeatureFlag('tagSuggest')
  const [dismissed, setDismissed] = useState(false)

  const appliedM = useMemo(() => new Set(currentMistakes || []), [currentMistakes])
  const appliedE = useMemo(() => new Set(currentEmotions || []), [currentEmotions])
  const reasons = suggestions?.reasons || {}

  // Build the visible chip list (mistakes then emotions), dropping any tag
  // already applied to the trade.
  const chips = useMemo(() => {
    const out = []
    for (const tag of suggestions?.mistakes || []) {
      if (!appliedM.has(tag)) out.push({ tag, kind: 'mistake' })
    }
    for (const tag of suggestions?.emotions || []) {
      if (!appliedE.has(tag)) out.push({ tag, kind: 'emotion' })
    }
    return out
  }, [suggestions, appliedM, appliedE])

  if (!flagOn || dismissed || chips.length === 0) return null

  return (
    <div className={styles.row} role="group" aria-label="Suggested tags">
      <span className={styles.label}>
        <UIcon name="sparkle" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
        Suggested
      </span>
      <div className={styles.chips}>
        {chips.map(({ tag, kind }) => (
          <button
            key={`${kind}:${tag}`}
            type="button"
            className={styles.chip}
            title={reasons[tag] || 'Suggested from this trade’s pattern.'}
            onClick={() =>
              kind === 'mistake' ? onAcceptMistake?.(tag) : onAcceptEmotion?.(tag)
            }
          >
            <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            {tag}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={styles.dismiss}
        aria-label="Dismiss suggestions"
        title="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <UIcon name="x" size={13} />
      </button>
    </div>
  )
}
