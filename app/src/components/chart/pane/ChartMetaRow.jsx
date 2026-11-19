// The chart header's info strip. The host (ChartPane) resolves which fields to show and
// their values/colors from `header.fields`; this is presentational only.
// `styles` is injected so this renders with the caller's CSS-module classes (CSS-module
// names are hashed per source file; a local copy of the rules would silently drift).

// `abbrev` (set by ChartPane's width fit) swaps each label for its terse form
// (MARKET CAP → MC) once the row would collide with the timeframe bar. The full
// label is kept in `title` so a hover still reads it (or the field's own `title` when it
// has one, e.g. RVOL's "Volume vs usual by this time of day"). Values are never abbreviated.
//
// CLICKABLE STATS (owner 11-17): with `onItemClick`, each stat is a control like the timeframes beside it — a click
// (or Enter / Space) opens its quick-edit menu (HeaderStatMenu.jsx). Per-stat looks ride `item.style`
// (headerStatStyle.js): a label color, a shaded box, a size. An item with no `style` renders exactly as before.
import { safeCssColour } from '../engine/objectColour'
import { STAT_SIZE_SCALE, STAT_WEIGHT_VALUE, DEFAULT_BOX_COLOR } from '../headerStatStyle'

// The item's own inline style for its look, or undefined (no attribute at all) when it has none.
function itemLook(st) {
  if (!st) return undefined
  const out = {}
  if (st.box) {
    // a pill that hugs the text at every size: padding and radius in em (they grow with the stat's size), and the
    // text inside keeps its full line box (ChartsWorkspace.module.css `[data-stat-box]`) so descenders stay inside
    out.background = safeCssColour(st.boxColor) || DEFAULT_BOX_COLOR
    out.padding = '0.22em 0.62em'
    out.borderRadius = '0.5em'
  }
  const k = st.size ? STAT_SIZE_SCALE[st.size] : null
  if (k && k !== 1) out.zoom = k
  return Object.keys(out).length ? out : undefined
}

// ⛔ a colour reaches CSS only through `safeCssColour` — a shared layout may carry anything.
export default function ChartMetaRow({ items = [], abbrev = false, tight = false, styles, onItemClick = null, openKey = null }) {
  if (!items.length) return null
  const clickable = typeof onItemClick === 'function'
  return (
    <div className={`${styles.chartMeta} ${tight ? styles.chartMetaTight : ''}`}>
      {items.map((it) => {
        const label = abbrev ? (it.short || it.label) : it.label
        const st = it.style || null
        const labelInk = st ? safeCssColour(st.labelColor) : null
        const weight = st && st.weight ? STAT_WEIGHT_VALUE[st.weight] : null
        const labelStyle = (labelInk || weight) ? { ...(labelInk ? { color: labelInk } : null), ...(weight ? { fontWeight: weight } : null) } : undefined
        const valInk = safeCssColour(it.color)
        const valStyle = (valInk || weight) ? { ...(valInk ? { color: valInk } : null), ...(weight ? { fontWeight: weight } : null) } : undefined
        const ctl = clickable ? {
          role: 'button',
          tabIndex: 0,
          'aria-haspopup': 'dialog',
          'aria-expanded': openKey === it.key,
          'data-stat-item': it.key,
          title: `${it.title || it.label}: click to edit`,
          onClick: (e) => onItemClick(it.key, e.currentTarget),
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onItemClick(it.key, e.currentTarget) }
          },
        } : {}
        return (
          <span key={it.key}
            className={`${styles.chartMetaItem}${clickable ? ' ' + (styles.chartMetaItemBtn || '') + ' charts-no-drag' : ''}${openKey === it.key ? ' ' + (styles.chartMetaItemOpen || '') : ''}`}
            style={itemLook(st)} data-stat-size={st?.size || undefined} data-stat-box={st?.box ? '' : undefined} {...ctl}>
            <span className={styles.chartMetaLabel} title={clickable ? undefined : (it.title || it.label)}
              style={labelStyle}>{label}</span>
            {/* `data-meta-key` + `data-sign` (signed fields only) let a host on an APP surface re-ink the value by its
                meaning -- the TickerPopup header, ChartsWorkspace.module.css -- without reading colours. */}
            <span className={styles.chartMetaVal} data-meta-key={it.key} data-sign={it.sign || undefined} style={valStyle}>
              {it.value != null && it.value !== '' ? it.value : '—'}
            </span>
          </span>
        )
      })}
    </div>
  )
}
