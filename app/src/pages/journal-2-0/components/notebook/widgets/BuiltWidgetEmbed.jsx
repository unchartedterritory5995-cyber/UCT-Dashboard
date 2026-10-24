import { useState } from 'react'
import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import { BUILT_KIND } from '../../../lib/builtWidgets'
import SnapshotFrame, { useSnapshotFrame, accountSourceLine, snapshotStyles as s } from './SnapshotFrame'
import NumberView from './builtViews/NumberView'
import TableView from './builtViews/TableView'
import TableAlt from './builtViews/TableAlt'
import styles from './BuiltWidgetEmbed.module.css'

/**
 * Notebook widgets phase 2 (wave 8, Task 8.13): a widget the member BUILT, placed in a note.
 *
 * ⛔ A SNAPSHOT, like every phase 1 kind: it renders from `attrs.params` alone and never fetches on mount. See it
 * now and Change re-run it through the frame (`useSnapshotFrame('builtWidget')` -> lib/builtWidgets.js), and the
 * server echoes every key the note keeps.
 *
 * This task draws `number` with NumberView and every other view with TableView; Task 8.14 adds the chart views.
 * "Show as table" (TableAlt) lays out the same rows as a plain HTML table, for every view that is not one already.
 * ⛔ The scope label can be an account NAME, so it is not drawn while the widget is shared: a shared widget's body
 * is the one rasterised into the public archive image (ruling R-25).
 */
export default function BuiltWidgetEmbed({ attrs, height = 260, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame(BUILT_KIND, attrs, { editable, onUpdateParams, uid })
  const [asTable, setAsTable] = useState(false)
  const view = typeof p.view === 'string' ? p.view : 'number'
  const empty = typeof p.empty === 'string' && p.empty && !p.tooLarge ? p.empty : null
  const shared = p.share === true
  const labels = [shared ? null : p.scopeLabel, p.rangeLabel].filter((x) => typeof x === 'string' && x).join(' · ')
  const extra = Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''
  const sourceLine = [accountSourceLine(p), extra].filter(Boolean).join(' · ') || null
  const canToggle = !empty && view !== 'table'

  let body
  if (empty) body = <p className={s.empty}>{empty}</p>
  else if (asTable && canToggle) body = <TableAlt params={p} />
  else if (view === 'number') body = <NumberView params={p} />
  else body = <TableView params={p} />

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="built-widget-embed">
      <SnapshotFrame {...frame} sourceLine={sourceLine}>
        <div className={styles.wrap}>
          {labels && <p className={styles.labels}>{labels}</p>}
          {body}
          {typeof p.notice === 'string' && p.notice && <p className={styles.notice}>{p.notice}</p>}
          {canToggle && (
            <div className={styles.tools}>
              <button type="button" className={s.btn} aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
                {asTable ? 'Show as widget' : 'Show as table'}
              </button>
            </div>
          )}
        </div>
      </SnapshotFrame>
    </div>
  )
}
