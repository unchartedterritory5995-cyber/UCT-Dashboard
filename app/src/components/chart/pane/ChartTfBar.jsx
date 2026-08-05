import { useState } from 'react'
import TimeframeMenu from '../../../pages/charts/widgets/TimeframeMenu'

// Timeframe buttons + the more-timeframes chevron. Owns only the menu's
// open/anchor state; favorites and custom intervals are the host's.
// `showMenu={false}` drops the ⌄ overflow entirely. A host that hands us an
// explicit timeframe set has decided which intervals it supports — leaving the
// chevron would let the user pick one the host never offered, silently
// defeating the lock (Journal is Daily/Weekly by design, for example).
export default function ChartTfBar({ tf, visibleTfs, onTf, menu = {}, showMenu = true, styles, children }) {
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
      {showMenu && (
        <button
          type="button"
          className={styles.tfBtn}
          title="More timeframes"
          aria-label="More timeframes"
          onClick={(e) => { setAnchor(e.currentTarget.getBoundingClientRect()); setOpen(v => !v) }}
        >⌄</button>
      )}
      {showMenu && open && (
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
