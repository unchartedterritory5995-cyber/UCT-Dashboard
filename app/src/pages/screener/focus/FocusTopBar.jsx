import styles from './FocusScreener.module.css'

// List | Table. Exported so Table mode, which renders today's page under a slim bar, shows the same control.
export function ModeSwitch({ mode, onMode }) {
  return (
    <div role="group" aria-label="View" className={styles.seg}>
      {['list', 'table'].map(m => (
        <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? styles.segOn : styles.segOff} onClick={() => onMode(m)}>
          {m === 'list' ? 'List' : 'Table'}
        </button>
      ))}
    </div>
  )
}

export default function FocusTopBar({ screenMenu, filterCount, onOpenFilters, dataReceipt, mode, onMode, saveMenu, moreMenu, helpMenu, optionsTab }) {
  return (
    <header className={styles.topBar}>
      {optionsTab}
      {screenMenu}
      <button type="button" className={styles.btn} onClick={onOpenFilters} aria-label={`Filters, ${filterCount} active`}>
        Filters {filterCount > 0 && <span className={styles.badge}>{filterCount}</span>}
      </button>
      <span className={styles.spacer} />
      {dataReceipt}
      <ModeSwitch mode={mode} onMode={onMode} />
      {saveMenu}
      {moreMenu}
      {helpMenu}
    </header>
  )
}
