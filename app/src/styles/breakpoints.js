/* Centralized responsive breakpoints — single source of truth.
 *
 * Three tiers, two boundaries (what TradingView / Robinhood / Webull use):
 *   phone:   <= 640px
 *   tablet:  641px – 1024px
 *   desktop: >= 1025px
 *
 * Use these instead of hardcoding pixel literals in components.
 * - JS:  import { MQ } from 'styles/breakpoints' then useMediaQuery(MQ.phone)
 *        (or the typed hooks in hooks/useBreakpoint.js)
 * - CSS: copy the canonical @media strings documented in styles/breakpoints.css
 *
 * Migration note: many legacy CSS files still hardcode 640/768/900/720/480.
 * Snap them to the canonical 640 / 1024 boundaries opportunistically when a
 * file is touched. Never introduce a NEW non-canonical literal.
 */

export const BP = {
  phone: 640,
  tablet: 1024,
}

export const MQ = {
  // Single tiers
  phone: `(max-width: ${BP.phone}px)`,
  tablet: `(min-width: ${BP.phone + 1}px) and (max-width: ${BP.tablet}px)`,
  desktop: `(min-width: ${BP.tablet + 1}px)`,

  // Cumulative "and-smaller" sets
  tabletDown: `(max-width: ${BP.tablet}px)`, // phone + tablet — the "touch" set
  touchDown: `(max-width: ${BP.tablet}px)`, // alias used by mobile primitives

  // Input modality (orthogonal to width — e.g. a touchscreen laptop)
  coarsePointer: '(pointer: coarse)',
  noHover: '(hover: none)',
}

export default MQ
