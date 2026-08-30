/**
 * Compare mode — four panes, one cursor (spec §3).
 *
 * ⭐ THIS FILE CONTAINS NO PER-STYLE KNOWLEDGE, AND THAT IS THE POINT. A pane
 * is "look up the component in `VIEW_COMPONENTS`, hand it the bundle its `kind`
 * calls for" — `propsForStyle` is the container's ONE assembly, called once per
 * pane instead of once. If a `switch (style)` ever appears below, the `kind`
 * contract has been broken somewhere upstream and that is the thing to fix.
 *
 * ⛔ NO SCRUBBER AND NO DATE HEADER LIVE HERE. Both stay above the grid, in the
 * container, because there is exactly one cursor and one window; a per-pane copy
 * would be four controls over one value — this repo's most repeated defect.
 *
 * ⛔ THE PICKER OWNS NO LIST. Its options, their labels, their order and their
 * Boards/Lenses grouping all come from `viewsByKind()`, the same registry read
 * `BreadthViewSwitcher` uses. A seventeenth style appears in both, or in
 * neither.
 */
import { viewsByKind, VIEW_COMPONENTS } from './views/viewRegistry'
import styles from './CompareGrid.module.css'

// The same two words the switcher shows, from the same registry kinds.
const GROUP_LABELS = { board: 'Boards', lens: 'Lenses' }

const SWAP_HINT = 'Pick this pane’s style. Choosing one already on screen swaps the two panes.'

export default function CompareGrid({ quad = [], propsForStyle, onPick }) {
  const groups = viewsByKind()
  return (
    <div className={styles.grid} data-testid="compare-grid">
      {quad.map((style, i) => {
        const View = VIEW_COMPONENTS[style]
        return (
          <section key={i} className={styles.pane}
                   data-testid={`compare-pane-${i}`} data-pane-style={style}>
            <header className={styles.head}>
              <select className={styles.pick} data-testid={`compare-pick-${i}`}
                      value={style} title={SWAP_HINT}
                      aria-label={`Pane ${i + 1} style`}
                      onChange={(e) => onPick?.(i, e.target.value)}>
                {['board', 'lens'].map(kind => (
                  groups[kind].length === 0 ? null : (
                    <optgroup key={kind} label={GROUP_LABELS[kind]}>
                      {groups[kind].map(o => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </optgroup>
                  )
                ))}
              </select>
            </header>
            <div className={styles.body}>
              {View && <View {...propsForStyle(style)} />}
            </div>
          </section>
        )
      })}
    </div>
  )
}
