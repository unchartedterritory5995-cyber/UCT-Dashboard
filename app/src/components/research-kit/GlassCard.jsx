// app/src/components/research-kit/GlassCard.jsx
import styles from './GlassCard.module.css'

/**
 * The kit's surface primitive — the Glass Premium register (spec §2.1/§3.1).
 *
 * RESTRAINT RULES (§3.1, NORMATIVE — this is what protects "simple and clean"
 * from decoration creep):
 *   • `accent` (the gold border) appears ONLY on: the pinned banner, the ONE
 *     hero widget per canvas, and the active rail item. Nothing else.
 *   • Maximum ONE gold data-highlight per canvas.
 *   • Maximum ONE glow component per view.
 *   • No gradient text, no text-shadow, no glowing marks on data elements.
 *   • One ticking element per banner (the countdown); prices update without
 *     animation.
 * If you are about to pass `accent` to a second card in the same canvas, the
 * answer is that one of them is not the hero.
 *
 * NO backdrop-filter: §3.1 limits it to the modal backdrop (perf). The modal
 * shell itself is opaque; at most ONE translucency level inside it.
 *
 * NO `overflow: hidden` on this card — InfoTip popovers and future rail
 * flyouts are absolutely positioned children and must be able to escape.
 */
export default function GlassCard({
  children,
  accent = false,
  elevated = false,
  as: Tag = 'section',
  ariaLabel,
  className = '',
  ...rest
}) {
  const cls = [
    styles.card,
    elevated ? styles.elevated : '',
    accent ? styles.accent : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Tag className={cls} aria-label={ariaLabel} {...rest}>
      {children}
    </Tag>
  )
}
