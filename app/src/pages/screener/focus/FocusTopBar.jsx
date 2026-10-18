import styles from './FocusScreener.module.css'

// List | Charts | Map | Table. Exported so Table mode, which renders today's page under a slim bar, shows the same control.
// Charts is the screen's results on the /charts Multi-Chart grid (ScreenerChartGrid); Map is the
// same results as a market-cap treemap (ScreenerHeatMap).
export const MODES = [['list', 'List'], ['grid', 'Charts'], ['map', 'Map'], ['table', 'Table']]

export function ModeSwitch({ mode, onMode }) {
  return (
    <div role="group" aria-label="View" className={styles.seg}>
      {MODES.map(([m, label]) => (
        <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? styles.segOn : styles.segOff} onClick={() => onMode(m)}>
          {label}
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
