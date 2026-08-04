// app/src/components/research-kit/InfoTip.jsx
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import UIcon from '../ui/UIcon'
import styles from './InfoTip.module.css'

/** Minimum gap (px) the popover must keep from the viewport's right edge
 *  before it flips alignment (M4). */
const VIEWPORT_EDGE_GAP_PX = 8

/**
 * The kit's ONE learnability affordance (spec §3.4). `EyebrowLabel` and
 * `VerdictChip` accept an optional ⓘ that opens a one-line plain-English
 * explanation plus a "How this is computed →" link to the methodology page
 * (§12). Both surfaces inherit it from here — no per-surface tooltip forks.
 *
 * CLICK-TOGGLED, NOT HOVER. On touch, the mouseenter→click ordering cancels a
 * hover-opened tip (the house already hit this in OptionsFlow's `of-tip`, which
 * needed a `data-pin` flag to survive). One interaction model, both pointers.
 *
 * NOT tippy.js: tippy is in package.json but has zero usage anywhere in
 * app/src — there is no house idiom, theme or CSS import to inherit, so this
 * is a self-contained popover. Zero new dependencies (§3.4).
 *
 * The popover paints on --glass-chrome (>= .92 alpha) so its text never sits on
 * translucency (§3.2 contrast floor).
 */
export default function InfoTip({
  label,
  text,
  href,
  hrefLabel = 'How this is computed →',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const wrapRef = useRef(null)
  const popRef = useRef(null)
  const tipId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // M4 — viewport collision: the popover defaults to left-aligned (opens
  // toward the right of the trigger). On open, measure its actual rendered
  // edge; if it would run past the viewport's right edge, flip it to
  // right-aligned (right:0 / left:auto, see .alignRight) instead. Re-measures
  // on every open so it's correct at whatever scroll/resize state the trigger
  // is in when clicked. No explicit reset on close: `alignRight` only ever
  // affects rendering while `open` (the popover span isn't mounted otherwise),
  // and the next open recomputes it fresh from the current rect regardless of
  // its stale prior value.
  useLayoutEffect(() => {
    if (!open) return
    const el = popRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    setAlignRight(rect.right > viewportWidth - VIEWPORT_EDGE_GAP_PX)
  }, [open])

  if (!text) return null

  return (
    <span className={`${styles.wrap} ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label || 'What is this?'}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <UIcon name="info" size={12} gold={false} />
      </button>
      {open && (
        <span
          ref={popRef}
          className={`${styles.pop} ${alignRight ? styles.alignRight : ''}`}
          role="tooltip"
          id={tipId}
        >
          <span className={styles.popText}>{text}</span>
          {href && (
            <a className={styles.popLink} href={href} target="_blank" rel="noopener noreferrer">
              {hrefLabel}
            </a>
          )}
        </span>
      )}
    </span>
  )
}
