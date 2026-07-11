/**
 * Journal surface — groups the existing Calendar + Notebook tabs as two
 * segments of ONE surface. Not merged — the segment toggle picks which existing
 * tab renders. Segment state in the URL (`?seg=calendar|notebook`, default
 * calendar).
 */

import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import CalendarTab from '../tabs/CalendarTab'
import NotebookTab from '../tabs/NotebookTab'
import styles from '../JournalLayout.module.css'

export default function JournalSurface() {
  const [searchParams, setSearchParams] = useSearchParams()
  const seg = searchParams.get('seg') === 'notebook' ? 'notebook' : 'calendar'

  const setSeg = useCallback(
    (next) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === 'calendar') p.delete('seg')
          else p.set('seg', next)
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return (
    <div>
      <div className={styles.segBar} role="tablist" aria-label="Journal view">
        <button
          type="button"
          role="tab"
          aria-selected={seg === 'calendar'}
          className={`${styles.segBtn} ${seg === 'calendar' ? styles.segBtnActive : ''}`}
          onClick={() => setSeg('calendar')}
        >
          Calendar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={seg === 'notebook'}
          className={`${styles.segBtn} ${seg === 'notebook' ? styles.segBtnActive : ''}`}
          onClick={() => setSeg('notebook')}
        >
          Notebook
        </button>
      </div>

      {seg === 'calendar' ? <CalendarTab /> : <NotebookTab />}
    </div>
  )
}
