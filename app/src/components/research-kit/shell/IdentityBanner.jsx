// app/src/components/research-kit/shell/IdentityBanner.jsx
import EyebrowLabel from '../EyebrowLabel'
import styles from './IdentityBanner.module.css'

/** The §4.5 report-night state machine, in order. */
export const LIFECYCLE_STATES = ['PRE', 'IMMINENT', 'PRINTED', 'CALL_LIVE', 'POST']

const VARIANT = {
  PRE: 'countdown',
  IMMINENT: 'awaiting',
  PRINTED: 'result',
  CALL_LIVE: 'result',
  POST: 'result',
}

/** Unknown input falls back to PRE — the least-claiming state. */
export function normalizeLifecycle(state) {
  const s = typeof state === 'string' ? state.trim().toUpperCase() : ''
  return LIFECYCLE_STATES.includes(s) ? s : 'PRE'
}

/** 'countdown' | 'awaiting' | 'result' — which line the banner shows. */
export function timingVariant(state) {
  return VARIANT[normalizeLifecycle(state)]
}

/**
 * The pinned identity banner (spec §4.2) — shared by the modal and the research
 * page header so "the modal is the page in miniature" is structural.
 *
 * PURE DISPLAY. It fetches nothing, polls nothing and owns no timer. `lifecycle`
 * is computed by the caller from data timestamps (§4.5: "states are pure
 * functions of data timestamps — no scheduled UI timers beyond the polling
 * cadence"), and `countdown` / `price` / `grade` / `guidance` are SLOTS.
 *
 * §4.5 line variants, enforced structurally:
 *   PRE       → timing line + the countdown slot
 *   IMMINENT  → "Awaiting numbers…", and the timing line AND countdown are
 *               suppressed, so no stale "Reports tonight" copy survives past T0
 *   PRINTED / CALL_LIVE / POST → the result line, pure data
 *
 * The guidance chip renders ONLY in POST — the state in which a source-labelled
 * recap exists. It is never inferred (§4.2).
 *
 * ONE TICKING ELEMENT (§3.1): the countdown slot renders in exactly one state.
 * Prices update without animation — do not add a transition to the price slot.
 *
 * `stepper` (I4) is an optional trailing slot for the §4.4 phone
 * reporter-stepping chevrons (prev/next name reporting today). It renders in
 * the banner's trailing area, after price/grade — that area is already the
 * "controls about THIS identity" region (price, then grade), and stepping to
 * a different reporter is one step further out from the current one, so it
 * reads left-to-right as price → grade → change-who. Renders nothing when
 * absent, same as every other slot here.
 */
export default function IdentityBanner({
  logo,
  sym,
  company,
  sector,
  lifecycle = 'PRE',
  timingText,
  resultText,
  countdown,
  price,
  grade,
  guidance,
  stepper,
  className = '',
}) {
  const state = normalizeLifecycle(lifecycle)
  const variant = timingVariant(state)

  const line = variant === 'awaiting'
    ? 'Awaiting numbers…'
    : variant === 'result'
      ? (resultText || 'Reported')
      : timingText

  return (
    <header className={`${styles.banner} ${className}`} data-lifecycle={state}>
      {logo && <div className={styles.logo}>{logo}</div>}

      <div className={styles.identity}>
        <div className={styles.symRow}>
          <span className={styles.sym}>{sym}</span>
          {company && <span className={styles.company}>{company}</span>}
        </div>
        {sector && <EyebrowLabel>{sector}</EyebrowLabel>}
      </div>

      <div className={styles.timing}>
        {line && (
          <span
            className={`${styles.line} ${variant === 'result' ? `${styles.lineResult} t-num` : ''}`}
            data-testid="rk-banner-line"
          >
            {line}
          </span>
        )}
        {variant === 'countdown' && countdown && (
          <span className={`${styles.countdown} t-num`}>{countdown}</span>
        )}
        {state === 'POST' && guidance && <span className={styles.guidance}>{guidance}</span>}
      </div>

      <div className={styles.right}>
        {price && <span className={`${styles.price} t-num`}>{price}</span>}
        {grade && <span className={styles.grade}>{grade}</span>}
        {stepper && (
          <span className={styles.stepper} data-testid="rk-banner-stepper">
            {stepper}
          </span>
        )}
      </div>
    </header>
  )
}
