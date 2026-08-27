// Shared header for the Watchlist + Scanner landing pickers, so the two look and lay
// out IDENTICALLY. Styled after the Theme Tracker header: a flat tab strip (no bubbly
// segmented box) + a squared search box on its own row. The "＋ New" button lives in
// the tab strip (right side) beside the ⚙ gear — the old gold dashed "New watchlist" /
// "Create your own scan" buttons are gone. All colors come from the picker's --wl-*
// theme vars so it matches whichever app/UCT theme is active.
import { forwardRef } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from './WatchlistPicker.module.css'

function PickerHeader({
  tabs, tab, onTab,
  query, onQuery, searchPlaceholder,
  onNew, newTitle, newDisabled = false, newHint = null,
  showSettings, settingsOpen, onToggleSettings, settingsTitle, gearRef,
  autoFocus = false,
}, _ref) {
  return (
    <div className={styles.header}>
      {/* Tab strip: flat tabs + New/⚙ on the right (Theme-Tracker period-bar layout). */}
      <div className={styles.tabBar} role="tablist">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`${styles.tabFlat}${tab === t.key ? ' ' + styles.tabFlatActive : ''}`}
            onClick={() => onTab(t.key)}
          >{t.label}</button>
        ))}
        <span className={styles.tabSpacer} />
        {onNew && (
          <button
            type="button"
            className={styles.newAction}
            onClick={onNew}
            disabled={newDisabled}
            title={newTitle}
            aria-label={newTitle}
          >
            <UIcon name="plus" size={13} gold={false} />
            <span>New</span>
            {newHint && <span className={styles.newHint}>{newHint}</span>}
          </button>
        )}
        {showSettings && (
          <button
            ref={gearRef}
            type="button"
            className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
            onClick={onToggleSettings}
            title={settingsTitle}
            aria-label={settingsTitle}
          ><UIcon name="gear" size={13} /></button>
        )}
      </div>

      {/* Search box — the exact Theme-Tracker style (squared, faint inset, thin border). */}
      <div className={styles.searchRow}>
        <input
          className={styles.searchBox}
          placeholder={searchPlaceholder}
          value={query}
          onChange={e => onQuery(e.target.value)}
          autoFocus={autoFocus}
        />
      </div>
    </div>
  )
}

export default forwardRef(PickerHeader)
