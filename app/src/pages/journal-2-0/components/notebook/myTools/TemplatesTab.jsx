import { useState } from 'react'
import TemplateList from './TemplateList'
import { FILTERS } from './myToolsLib'
import styles from './myTools.module.css'

/**
 * My tools, the Templates tab (spec 5.8, wave 11 Task 11.19, ruling W11-R10): the member's OWN templates in three
 * lists, Active · Archived · Recently deleted, the Widgets tab's pattern. The list itself, its rows, actions and
 * panels are TemplateList's (follow-up C: one implementation, shared with the template manager); this tab owns only
 * which list is shown.
 *
 * ⛔ LAZY: mounted only by MyToolsSheet, and only while `widgetsWaveOn(11)` (the sheet says "coming soon" otherwise).
 */
export default function TemplatesTab({ phone, navigate = null, onCloseAll }) {
  const [filter, setFilter] = useState('live')
  const toolbar = (
    <div role="group" aria-label="Show" className={styles.filters}>
      {FILTERS.map(([key, label]) => (
        <button key={key} type="button" className={`${styles.filter} ${filter === key ? styles.filterOn : ''}`}
          aria-pressed={filter === key} onClick={() => setFilter(key)}>
          {label}
        </button>
      ))}
    </div>
  )
  return <TemplateList filter={filter} toolbar={toolbar} phone={phone} navigate={navigate} onCloseAll={onCloseAll} />

}
