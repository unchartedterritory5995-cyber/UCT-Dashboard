/**
 * Compare mode — four panes, one cursor (spec §3).
 *
 * ⭐ THIS FILE CONTAINS NO PER-STYLE KNOWLEDGE, AND THAT IS THE POINT. A pane
 * is "look up the component in `VIEW_COMPONENTS`, hand it the bundle its `kind`
 * calls for" — `propsForStyle` is the container's ONE assembly, called once per
 * pane instead of once. If a `switch (style)` ever appears below, the `kind`
 * contract has been broken somewhere upstream and that is the thing to fix.
 * `customizeForStyle` is the same shape for the same reason: the container
 * resolves a style's panel props, this file only decides which pane's panel is
 * open.
 *
 * ⛔ NO SCRUBBER AND NO DATE HEADER LIVE HERE. Both stay above the grid, in the
 * container, because there is exactly one cursor and one window; a per-pane copy
 * would be four controls over one value — this repo's most repeated defect.
 *
 * ⭐ CUSTOMIZE, HOWEVER, IS PER PANE — because per-style options are per STYLE.
 * The panel was hidden in compare mode for a real reason (it acted on the single
 * active style, and there is no single active style here), but the consequence
 * was that a reader in compare mode could not change ANY pane's options at all.
 * `useBreadthViews`'s writes take a style now, the way its reads always did, so
 * the gear beside a pane's picker edits that pane's style — the same panel, the
 * same presets, the same blob — and switching back to Single shows exactly what
 * the pane was edited to.
 *
 * ⛔ THE PICKER OWNS NO LIST. Its options, their labels, their order and their
 * Boards/Lenses grouping all come from `viewsByKind()`, the same registry read
 * `BreadthViewSwitcher` uses. A seventeenth style appears in both, or in
 * neither.
 */
import { useState } from 'react'
import { viewsByKind, VIEW_COMPONENTS } from './views/viewRegistry'
import BreadthViewsCustomizePanel from './BreadthViewsCustomizePanel'
import { anchorProps } from './customizeAnchor'
import UIcon from '../../components/ui/UIcon'
import customizeStyles from './CustomizePanel.module.css'
import styles from './CompareGrid.module.css'

// The same two words the switcher shows, from the same registry kinds.
const GROUP_LABELS = { board: 'Boards', lens: 'Lenses' }

const SWAP_HINT = 'Pick this pane’s style. Choosing one already on screen swaps the two panes.'

// The grid is 2×2, so panes 2 and 3 sit on the bottom row and their panel has to
// open upward. Derived from the pane index rather than declared per pane.
const COLUMNS = 2

export default function CompareGrid({ quad = [], propsForStyle, customizeForStyle, onPick }) {
  const groups = viewsByKind()
  // One open panel at a time: four 340px panels over four panes would cover the
  // grid they exist to configure.
  const [openPane, setOpenPane] = useState(null)

  return (
    <div className={styles.grid} data-testid="compare-grid">
      {quad.map((style, i) => {
        const View = VIEW_COMPONENTS[style]
        const custom = customizeForStyle ? customizeForStyle(style) : null
        const onBottomRow = i >= COLUMNS
        return (
          <section key={i} className={styles.pane}
                   data-testid={`compare-pane-${i}`} data-pane-style={style}>
            <header className={styles.head}>
              <select className={styles.pick} data-testid={`compare-pick-${i}`}
                      value={style} title={SWAP_HINT}
                      aria-label={`Pane ${i + 1} style`}
                      onChange={(e) => { setOpenPane(null); onPick?.(i, e.target.value) }}>
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
              {custom && (
                <div className={`${customizeStyles.anchor} ${styles.gearAnchor}`} {...anchorProps()}>
                  <button type="button" className={styles.gear}
                          data-testid={`compare-customize-${i}`}
                          aria-expanded={openPane === i}
                          aria-label={`Customize ${custom.viewLabel}`}
                          title={`Customize ${custom.viewLabel}${custom.isDefaultActive ? '' : ` · ${custom.activePreset}`}`}
                          onClick={() => setOpenPane(p => (p === i ? null : i))}>
                    <UIcon name="gear" size={12} />
                    {!custom.isDefaultActive && (
                      <span className={styles.gearPreset}>{custom.activePreset}</span>
                    )}
                  </button>
                  {openPane === i && (
                    <BreadthViewsCustomizePanel {...custom}
                      placement={onBottomRow ? 'up' : 'down'}
                      onClose={() => setOpenPane(null)} />
                  )}
                </div>
              )}
            </header>
            {/* ⭐ `data-compare-pane` IS THE PANE'S ONE PUBLIC FACT ABOUT
                ITSELF: "the view below me is rendering at a quarter of a
                screen". A lens whose fixed chrome does not fit that box reads
                it from its OWN stylesheet (see `RotationView.module.css`), so
                the trim lives beside the numbers it trims and this file still
                holds no per-style knowledge. */}
            <div className={styles.body} data-compare-pane>
              {View && <View {...propsForStyle(style)} />}
            </div>
          </section>
        )
      })}
    </div>
  )
}
