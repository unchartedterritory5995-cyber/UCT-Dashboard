import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../../components/ui/UIcon'
import { DRILL_POPOVER_ATTR, GROUP_OPTIONS } from './scanFacets'
import styles from './ScanFilters.module.css'

// The drill's scan controls: a Filters button that opens the filter panel, the
// group-by switch, and the strip of what is currently applied. The rules live in
// scanFacets.js; this file only draws them.

/** All | Sector | Industry | Theme — how the list is grouped. */
export function GroupSwitch({ value, onChange }) {
  return (
    <div className={styles.group} role="group" aria-label="Group the list by">
      {GROUP_OPTIONS.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          title={k === 'none' ? 'No grouping' : `Group by ${label.toLowerCase()}`}>{label}</button>
      ))}
    </div>
  )
}

/** The Filters button; owns the panel's open state. */
export function FilterButton({ filters, total, shown }) {
  const [open, setOpen] = useState(false)
  // Where the button sits, read at click time (never during render).
  const [anchorRect, setAnchorRect] = useState(null)
  const btnRef = useRef(null)
  const n = filters?.count || 0
  return (
    <>
      <button ref={btnRef} type="button" className={styles.filterBtn} aria-expanded={open} aria-haspopup="dialog"
        data-active={n > 0 || undefined} onClick={() => { setAnchorRect(btnRef.current?.getBoundingClientRect() || null); setOpen(o => !o) }} title="Filter this list"
        aria-label={n > 0 ? `Filters, ${n} applied` : "Filters"}>
        <UIcon name="sliders" size={13} />
        <span>Filters</span>
        {n > 0 && <b className={styles.badge}>{n}</b>}
      </button>
      {open && (
        <FilterPanel anchorRect={anchorRect} anchorRef={btnRef} filters={filters} total={total} shown={shown}
          onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/** What is applied, as removable chips. Renders nothing when nothing is. */
export function FilterChips({ filters, className = '' }) {
  if (!filters?.chips?.length) return null
  return (
    <div className={`${styles.chips} ${className}`} role="group" aria-label="Applied filters">
      {filters.chips.map(c => (
        <button key={`${c.facet}:${c.value}`} type="button" className={styles.appliedChip}
          onClick={() => filters.toggle(c.facet, c.value)} aria-label={`Remove filter: ${c.label}`}>
          {c.label}<span aria-hidden="true">×</span>
        </button>
      ))}
      <button type="button" className={styles.clearLink} onClick={filters.clear}>Clear</button>
    </div>
  )
}

function Section({ title, hint, children, right }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{title}</span>
        {hint && <span className={styles.sectionHint}>{hint}</span>}
        {right}
      </header>
      {children}
    </section>
  )
}

function OptChips({ opts, onToggle, limit = Infinity }) {
  const [all, setAll] = useState(false)
  const list = all ? opts : opts.slice(0, limit)
  return (
    <div className={styles.optWrap}>
      {list.map(o => (
        <button key={o.key} type="button" className={styles.opt} aria-pressed={o.on}
          disabled={!o.on && o.count === 0} title={o.title} onClick={() => onToggle(o.key)}>
          <span>{o.label}</span><em>{o.count}</em>
        </button>
      ))}
      {opts.length > limit && (
        <button type="button" className={styles.more} onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `+${opts.length - limit} more`}
        </button>
      )}
    </div>
  )
}

function FilterPanel({ anchorRect, anchorRef, filters, total, shown, onClose }) {
  const ref = useRef(null)
  const [industryQ, setIndustryQ] = useState('')
  const m = filters.model
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onDown); clearTimeout(t) }
  }, [onClose, anchorRef])

  const industries = useMemo(() => {
    const q = industryQ.trim().toLowerCase()
    return q ? m.industry.filter(o => o.on || o.label.toLowerCase().includes(q)) : m.industry
  }, [m.industry, industryQ])

  const r = anchorRect
  const W = 460
  const left = r ? Math.max(8, Math.min(r.left, window.innerWidth - W - 8)) : 40
  const top = r ? r.bottom + 6 : 80
  const maxH = Math.max(240, window.innerHeight - top - 16)
  const t = (facet) => (key) => filters.toggle(facet, key)

  return createPortal(
    <div ref={ref} className={styles.panel} style={{ left, top, width: W, maxHeight: maxH }}
      role="dialog" aria-label="Filter this list" {...{ [DRILL_POPOVER_ATTR]: '' }}>
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>Filter</span>
        <span className={styles.panelCount}><b>{shown.toLocaleString()}</b> of {total.toLocaleString()} stocks</span>
        <span className={styles.spacer} />
        {filters.count > 0 && <button type="button" className={styles.clearLink} onClick={filters.clear}>Reset</button>}
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close filters"><UIcon name="x" size={13} /></button>
      </div>
      <div className={styles.panelBody}>
        {m.signals.length > 0 && (
          <Section title="Signals" hint="also true today — every one you pick must match">
            <OptChips opts={m.signals} onToggle={t('signals')} />
          </Section>
        )}
        {m.sector.length > 1 && (
          <Section title="Sector"><OptChips opts={m.sector} onToggle={t('sector')} /></Section>
        )}
        {m.theme.length > 1 && (
          <Section title="Theme"><OptChips opts={m.theme} onToggle={t('theme')} limit={14} /></Section>
        )}
        {m.industry.length > 1 && (
          <Section title="Industry" right={(
            <input className={styles.search} value={industryQ} onChange={e => setIndustryQ(e.target.value)}
              placeholder="Search industries" aria-label="Search industries" />
          )}>
            <OptChips opts={industries} onToggle={t('industry')} limit={industryQ ? Infinity : 12} />
          </Section>
        )}
        {m.mcap.length > 0 && (
          <Section title="Market cap">
            <div className={styles.capRow}>
              {m.mcap.map(o => (
                <button key={o.key} type="button" className={styles.cap} aria-pressed={o.on}
                  disabled={!o.on && o.count === 0} onClick={() => filters.toggle('mcap', o.key)}>
                  <b>{o.label}</b><small>{o.hint}</small><em>{o.count}</em>
                </button>
              ))}
            </div>
          </Section>
        )}
        {m.mins.length > 0 && (
          <Section title="At least">
            <div className={styles.mins}>
              {m.mins.map(f => (
                <div key={f.key} className={styles.minRow}>
                  <span className={styles.minLabel}>{f.label}</span>
                  <div className={styles.steps} role="group" aria-label={`${f.label}: at least`}>
                    <button type="button" aria-pressed={f.value == null} onClick={() => f.value != null && filters.toggle(f.key, f.value)}>Any</button>
                    {f.steps.map(s => (
                      <button key={s.value} type="button" aria-pressed={f.value === s.value}
                        disabled={f.value !== s.value && s.count === 0}
                        title={`${s.count} stock${s.count === 1 ? '' : 's'}`}
                        onClick={() => filters.toggle(f.key, s.value)}>{s.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
      <div className={styles.panelFoot}>
        <span>Within a section any match counts; across sections all must match.</span>
        <button type="button" className={styles.done} onClick={onClose}>Show {shown.toLocaleString()}</button>
      </div>
    </div>,
    document.body,
  )
}
