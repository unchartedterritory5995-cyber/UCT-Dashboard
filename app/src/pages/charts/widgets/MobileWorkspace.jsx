import { useMemo, useState } from 'react'
import WidgetHost from '../WidgetHost'
import styles from '../ChartsWorkspace.module.css'

const TYPE_LABEL = { chart: 'Chart', watchlist: 'Watchlist', themes: 'Themes', scanner: 'Scanner', fundamentals: 'Fundamentals' }
const ADD_TYPES = ['chart', 'watchlist', 'themes', 'scanner', 'fundamentals']

/* MobileWorkspace — phone replacement for the react-grid-layout workspace.
 *
 * RGL drag/resize doesn't translate to a 375px screen, so instead of the
 * single-chart fallback we show the user's saved widgets as a tab strip with
 * the active widget full-height. This makes Watchlist / Themes / Scanner
 * reachable on phone (they were previously unreachable from /charts).
 * Widgets still link tickers via their color group (WorkspaceContext), so a
 * Chart and a Watchlist on the same color stay in sync just like on desktop.
 */
/** Index of the widget this workspace should OPEN on: the first chart, else the
 *  first widget. Exported so the ordering rail can test the rule itself. */
export function defaultActiveIndex(widgets) {
  const ci = (widgets || []).findIndex(w => w.type === 'chart')
  return ci >= 0 ? ci : 0
}

export default function MobileWorkspace({ widgets, onRemove, onColorChange, onOptsChange, onAddWidget }) {
  // RESOLVE, THEN DEFAULT. `widgets` arrives EMPTY on first render — the saved
  // layout only lands once `usePreferences` resolves — so a `useState`
  // initializer computed the landing tab against `[]`, got 0, and never
  // recomputed: /charts opened on whatever widget happened to be first (Themes),
  // not on a chart. Deriving it every render instead means the default follows
  // the widgets as they hydrate, with no effect, no timeout, and no dependence
  // on whether prefs were warm.
  //
  // `chosen` is null until the user picks a tab; an explicit choice then wins
  // over the derived default forever (including across later widget changes).
  const [chosen, setChosen] = useState(null)
  const [addOpen, setAddOpen] = useState(false)

  const fallback = useMemo(() => defaultActiveIndex(widgets), [widgets])
  const active = chosen == null ? fallback : chosen

  const safeActive = Math.min(active, Math.max(0, widgets.length - 1))
  const widget = widgets[safeActive]

  return (
    <div className={styles.mobileWorkspace}>
      <div className={styles.mobileTabs} role="tablist" aria-label="Chart widgets">
        {widgets.map((w, i) => (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={i === safeActive}
            className={`${styles.mobileTab} ${i === safeActive ? styles.mobileTabActive : ''}`}
            onClick={() => setChosen(i)}
          >
            <span className={`${styles.mobileTabDot} ${styles[`colorDot${w.color}`]}`} />
            {TYPE_LABEL[w.type] || w.type}
          </button>
        ))}
        <button
          type="button"
          className={styles.mobileAddTab}
          aria-label="Add widget"
          onClick={() => setAddOpen(o => !o)}
        >
          ＋
        </button>
        {addOpen && (
          <div className={styles.mobileAddMenu}>
            {ADD_TYPES.map(t => (
              <button
                key={t}
                type="button"
                className={styles.mobileAddItem}
                onClick={() => { onAddWidget(t); setAddOpen(false); setChosen(widgets.length) }}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.mobileWidgetWrap}>
        {widget ? (
          <WidgetHost
            key={widget.id}
            widget={widget}
            /* Clear the explicit choice rather than pinning index 0 — removing a
               widget should hand the user back to the derived default (a chart),
               not to whatever now happens to sit first. */
            onRemove={() => { onRemove(widget.id); setChosen(null) }}
            onColorChange={(c) => onColorChange(widget.id, c)}
            onOptsChange={(opts) => onOptsChange(widget.id, opts)}
          />
        ) : (
          <div className={styles.mobileEmpty}>No widgets — tap ＋ to add one.</div>
        )}
      </div>
    </div>
  )
}
