import styles from './FocusScreener.module.css'

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
      <div role="group" aria-label="View" className={styles.seg}>
        {['list', 'table'].map(m => (
          <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? styles.segOn : styles.segOff} onClick={() => onMode(m)}>
            {m === 'list' ? 'List' : 'Table'}
          </button>
        ))}
      </div>
      {saveMenu}
      {moreMenu}
      {helpMenu}
    </header>
  )
}
