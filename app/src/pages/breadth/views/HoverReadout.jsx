/**
 * The one overlay element a hover readout writes into. `styleKey` keeps its test
 * id owned by exactly one view, per the `{styleKey}-{role}` convention.
 *
 * `aria-hidden` on purpose: it is a visual convenience over marks that already
 * carry their own `title`, and duplicating them into the accessibility tree
 * would read every value twice.
 */
import css from './hoverReadout.module.css'

export default function HoverReadout({ tipRef, styleKey }) {
  return (
    <div ref={tipRef} data-testid={`${styleKey}-readout`}
         className={css.tip} aria-hidden="true" />
  )
}
