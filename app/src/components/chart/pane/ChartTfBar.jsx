import { useState } from 'react'
import TimeframeMenu from '../../../pages/charts/widgets/TimeframeMenu'

// Timeframe buttons + the more-timeframes chevron. Owns only the menu's
// open/anchor state; favorites and custom intervals are the host's.
export default function ChartTfBar({ tf, visibleTfs, onTf, menu = {}, styles, children }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  return (
    <div className={styles.tfBar}>
      {visibleTfs.map(([code, label]) => (
        <button
          key={code}
          type="button"
          className={`${styles.tfBtn} ${tf === code ? styles.tfBtnActive : ''}`}
          onClick={() => onTf(code)}
        >{label}</button>
      ))}
      <button
        type="button"
        className={styles.tfBtn}
        title="More timeframes"
        aria-label="More timeframes"
        onClick={(e) => { setAnchor(e.currentTarget.getBoundingClientRect()); setOpen(v => !v) }}
      >⌄</button>
      {open && (
        <TimeframeMenu
          tf={tf}
          onSelect={(code) => { onTf(code); setOpen(false) }}
          favorites={menu.favorites || []}
          onToggleFav={menu.onToggleFav}
          customCodes={menu.customCodes || []}
          onAddCustom={menu.onAddCustom}
          onRemoveCustom={menu.onRemoveCustom}
          anchor={anchor}
          onClose={() => setOpen(false)}
          themeVars={menu.themeVars}
        />
      )}
      {children}
    </div>
  )
}
