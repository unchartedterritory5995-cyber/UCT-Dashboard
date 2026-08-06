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
          // Flex-center the chevron: the old "⌄" text glyph rendered low in its
          // line-box (owner: "arrow sits near the bottom"). An inline SVG centered by
          // flex sits dead-center regardless of which host's styles module is passed.
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          title="More timeframes"
          aria-label="More timeframes"
          onClick={(e) => { setAnchor(e.currentTarget.getBoundingClientRect()); setOpen(v => !v) }}
        >
          <svg width="9" height="6" viewBox="0 0 10 6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
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
