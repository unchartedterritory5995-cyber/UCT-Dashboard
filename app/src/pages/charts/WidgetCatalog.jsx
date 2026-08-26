import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../components/ui/UIcon'
import { menuGroups, labelMap, catalogMeta } from '../../widgets/registry'
import styles from './WidgetCatalog.module.css'

const LABELS = labelMap('menu')
const GROUPS = menuGroups('workspace')   // [{key, label, items:[id]}] — grouped, workspace-only

/**
 * The Widget Catalog — a big, blurred gallery for adding a widget to the /charts
 * board. A sibling of the Chart Themes gallery (ChartThemesModal): same portal +
 * blurred backdrop + --menu-* palette so it feels native, but laid out as grouped
 * cards (icon · name · one-line blurb · LIVE tag) instead of a flat menu list.
 *
 * `onAdd(type)` hands the id to the workspace's normal add flow (smart placement +
 * ghost-preview); the parent closes the modal so the ghost is visible behind it.
 * `onBoard` is an optional Map(type → count already on the board) for a subtle badge.
 */
export default function WidgetCatalog({ open, onClose, onAdd, onBoard }) {
  const [cat, setCat] = useState('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset the filter + search each open.
  useEffect(() => { if (open) { setCat('all'); setQuery('') } }, [open])

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    return GROUPS
      .filter(g => cat === 'all' || g.key === cat)
      .map(g => ({
        key: g.key,
        label: g.label,
        items: g.items.filter(id => {
          if (!q) return true
          const meta = catalogMeta(id)
          return (LABELS[id] || '').toLowerCase().includes(q)
            || (meta.blurb || '').toLowerCase().includes(q)
            || g.label.toLowerCase().includes(q)
            || id.toLowerCase().includes(q)
        }),
      }))
      .filter(g => g.items.length > 0)
  }, [cat, query])

  if (!open) return null

  const total = sections.reduce((n, g) => n + g.items.length, 0)
  const catLabel = cat === 'all' ? '' : ` · ${(GROUPS.find(g => g.key === cat) || {}).label || ''}`

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Add a widget">
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            <span className={styles.title}>Add a Widget</span>
            <span className={styles.subtitle}>Charts, watchlists, live market internals &amp; research — pick one to drop on your board.</span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.controls}>
          <div className={styles.pills}>
            <button type="button" className={`${styles.pill} ${cat === 'all' ? styles.pillOn : ''}`} onClick={() => setCat('all')}>All</button>
            {GROUPS.map(g => (
              <button key={g.key} type="button" className={`${styles.pill} ${cat === g.key ? styles.pillOn : ''}`} onClick={() => setCat(g.key)}>{g.label}</button>
            ))}
          </div>
          <input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search widgets…"
            aria-label="Search widgets"
            autoFocus
          />
        </div>

        <div className={styles.body}>
          {sections.map(g => (
            <section key={g.key} className={styles.section}>
              <div className={styles.sectionLabel}>{g.label}</div>
              <div className={styles.grid}>
                {g.items.map(id => {
                  const meta = catalogMeta(id)
                  const count = onBoard?.get?.(id) || 0
                  return (
                    <button
                      key={id}
                      type="button"
                      className={styles.card}
                      onClick={() => onAdd?.(id)}
                      title={`Add ${LABELS[id]}`}
                    >
                      <span className={styles.cardIcon}><UIcon name={meta.icon} size={19} /></span>
                      <span className={styles.cardText}>
                        <span className={styles.cardName}>
                          <span className={styles.cardNameText}>{LABELS[id]}</span>
                          {meta.live && <span className={styles.liveTag}><span className={styles.liveDot} aria-hidden="true" />LIVE</span>}
                        </span>
                        <span className={styles.cardBlurb}>{meta.blurb}</span>
                      </span>
                      {count > 0 && <span className={styles.onBoard} title={`${count} on your board`}>{count}</span>}
                      <span className={styles.cardAdd} aria-hidden="true"><UIcon name="plus" size={13} gold={false} /></span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          {total === 0 && <div className={styles.empty}>No widgets match “{query}”.</div>}
        </div>

        <div className={styles.footer}>
          <span className={styles.footHint}>{total} widget{total === 1 ? '' : 's'}{catLabel}</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
