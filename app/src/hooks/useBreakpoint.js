/* Typed breakpoint hooks — the single import every JS consumer uses for
 * responsive logic. Thin wrappers over the existing useMediaQuery (do NOT
 * reimplement matchMedia here).
 *
 *   const isPhone = useIsPhone()        // <= 640px
 *   const isTouch = useIsTouch()        // <= 1024px (phone + tablet)
 *   const coarse  = useHasCoarsePointer()
 *
 * Prefer these over ad-hoc `window.innerWidth <= 640` checks.
 */
import useMediaQuery from './useMediaQuery'
import { MQ } from '../styles/breakpoints'

export const useIsPhone = () => useMediaQuery(MQ.phone)
export const useIsTablet = () => useMediaQuery(MQ.tablet)
export const useIsDesktop = () => useMediaQuery(MQ.desktop)

/** Phone OR tablet — the "touch" set (<= 1024px). */
export const useIsTouch = () => useMediaQuery(MQ.touchDown)

/** Coarse pointer (finger / stylus) regardless of viewport width. */
export const useHasCoarsePointer = () => useMediaQuery(MQ.coarsePointer)

/** No hover capability — use to gate hover-only affordances. */
export const useHasNoHover = () => useMediaQuery(MQ.noHover)
