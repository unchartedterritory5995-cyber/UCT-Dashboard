// Chart Settings → Header & legend → "Stats beside the ticker" (owner 11-16, Release 1: the header stats picker + rename).
//
// Two pieces, both INSIDE the Chart Settings window (no new global modal, no portal):
//   • HeaderStatList   — the chosen stats in header order: drag grip (or ↑ / ↓), the name (click to rename, ≤16
//                        characters, empty = the stat's own name), the colour swatch(es) from the host, remove.
//   • HeaderStatPicker — an inline sub-page that replaces the section's body: search, the catalog grouped like the
//                        Watchlist column library, a soft square per stat (left of the label), "N shown", a
//                        description strip, "Reset to UCT default" and "Done".
// UCT Signature: soft squares stay grey/white (no gold — a long list never turns gold, §2b); sentence case; the
// catalog and every writer live in headerStatCatalog.js, this file only draws and calls back.
import { useMemo, useRef, useState } from 'react'
import UIcon from '../ui/UIcon'
import { HEADER_STAT_BY_KEY, HEADER_STAT_GROUPS, STAT_LABEL_MAX } from './headerStatCatalog'

const shownWord = (n) => `${n} shown`

/** The chosen stats, in order, each renameable and movable. */
export function HeaderStatList({ styles, keys, labels, onRename, onMove, onRemove, renderColors }) {
  const [dragFrom, setDragFrom] = useState(null)
  const [over, setOver] = useState(null)
  if (!keys.length) {
    return <div className={styles.statEmpty}>No stats: the header shows just the title.</div>
  }
  const commit = (key, el) => {
    const v = el.value
    onRename(key, v)
    // a cleared or default name shows the stat's own name again
    const s = HEADER_STAT_BY_KEY[key]
    const clean = v.replace(/\s+/g, ' ').trim()
    if (!clean) el.value = s.label
  }
  return (
    <div className={styles.card} role="list" aria-label="Stats beside the ticker, in order">
      {keys.map((key, i) => {
        const s = HEADER_STAT_BY_KEY[key]
        if (!s) return null
        const own = labels[key]
        const name = own || s.label
        return (
          <div
            key={key}
            role="listitem"
            data-stat-row={key}
            className={`${styles.field} ${styles.statRow} ${over === i && dragFrom !== null && dragFrom !== i ? styles.statRowOver : ''} ${dragFrom === i ? styles.statRowDrag : ''}`}
            onDragOver={(e) => { if (dragFrom === null) return; e.preventDefault(); if (over !== i) setOver(i) }}
            onDrop={(e) => { if (dragFrom === null) return; e.preventDefault(); onMove(dragFrom, i); setDragFrom(null); setOver(null) }}
          >
            <span
              className={styles.statGrip}
              draggable
              aria-hidden="true"
              title="Drag to reorder"
              onDragStart={(e) => { setDragFrom(i); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key) } catch { /* jsdom */ } }}
              onDragEnd={() => { setDragFrom(null); setOver(null) }}
            >⋮⋮</span>
            <input
              key={`${key}:${own || ''}`}
              className={styles.statName}
              defaultValue={name}
              maxLength={Math.max(STAT_LABEL_MAX, name.length)}
              spellCheck={false}
              aria-label={`Name for ${s.label}`}
              title={own ? `${s.label} (renamed): click to rename, clear to use the stat's own name` : 'Click to rename'}
              onBlur={(e) => commit(key, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.value = name; e.currentTarget.blur() }
              }}
            />
            {own && <span className={styles.statOrig} title={s.desc || s.label}>{s.label}</span>}
            <div className={styles.hdrRowCtl}>
              {renderColors(s)}
              <span className={styles.statActs}>
                <button type="button" className={styles.statIconBtn} disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label={`Move ${name} up`} title="Move up (left on the header)">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
                </button>
                <button type="button" className={styles.statIconBtn} disabled={i === keys.length - 1} onClick={() => onMove(i, i + 1)} aria-label={`Move ${name} down`} title="Move down (right on the header)">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
                </button>
                <button type="button" className={styles.statIconBtn} onClick={() => onRemove(key)} aria-label={`Remove ${name}`} title="Remove">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                </button>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The inline "choose from many" page: the whole catalog, grouped, searchable, a soft square per stat. */
export function HeaderStatPicker({ styles, keys, onToggle, onReset, onDone }) {
  const [q, setQ] = useState('')
  const [hover, setHover] = useState(null)
  const searchRef = useRef(null)
  const on = useMemo(() => new Set(keys), [keys])
  const query = q.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return null
    const out = []
    for (const g of HEADER_STAT_GROUPS) {
      for (const s of g.stats) {
        if (`${s.label} ${s.short} ${s.desc} ${g.label}`.toLowerCase().includes(query)) out.push(s)
      }
    }
    return out
  }, [query])
  const row = (s) => (
    <button
      key={s.key}
      type="button"
      role="checkbox"
      aria-checked={on.has(s.key)}
      data-stat-pick={s.key}
      className={`${styles.softItem} ${styles.statPickItem}`}
      onClick={() => onToggle(s.key)}
      onMouseEnter={() => setHover(s.key)}
      onFocus={() => setHover(s.key)}
    >
      <span className={`${styles.softBox} ${on.has(s.key) ? styles.softBoxOn : ''}`} aria-hidden="true" />
      <span className={styles.statPickLabel}>{s.label}</span>
    </button>
  )
  const h = hover && HEADER_STAT_BY_KEY[hover]
  return (
    <section className={styles.statPicker} aria-label="Info row stats">
      <div className={styles.statPickHead}>
        <button type="button" className={styles.statBack} onClick={onDone} aria-label="Back to Header & legend">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
          Header &amp; legend
        </button>
        <span className={styles.statPickTitle}>Info row stats</span>
        <span className={styles.statCount} aria-live="polite">{shownWord(keys.length)}</span>
      </div>
      <label className={styles.fieldFind}>
        <UIcon name="search" size={13} gold={false} aria-hidden="true" />
        <input
          ref={searchRef}
          aria-label="Find a stat"
          className={styles.fieldSearch}
          placeholder="Find a stat…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ('') } }}
          autoFocus
        />
      </label>
      <div className={styles.statPickList}>
        {matches ? (
          matches.length ? (<>
            <div className={styles.statGroupLabel}>{matches.length} {matches.length === 1 ? 'match' : 'matches'}</div>
            <div className={`${styles.card} ${styles.statPickCard}`}>{matches.map(row)}</div>
          </>) : (
            <div className={styles.statEmpty}>No stat matches “{q.trim()}”. Try earnings, short, RS or volume.</div>
          )
        ) : HEADER_STAT_GROUPS.map((g) => {
          const used = g.stats.filter((s) => on.has(s.key)).length
          return (
            <div key={g.key} role="group" aria-label={g.label}>
              <div className={styles.statGroupLabel}>{g.label}<span className={styles.statGroupCount}>{used ? `${used} / ` : ''}{g.stats.length}</span></div>
              <div className={`${styles.card} ${styles.statPickCard}`}>{g.stats.map(row)}</div>
            </div>
          )
        })}
      </div>
      <div className={styles.statDesc} aria-live="polite">
        {h ? (<><b>{h.label}</b>{h.desc ? ` · ${h.desc}` : ''}</>) : 'Hover a stat to see what it shows.'}
      </div>
      <div className={styles.statPickFoot}>
        <button type="button" className={styles.statFootBtn} onClick={onReset}>Reset to UCT default</button>
        <span style={{ flex: 1 }} />
        <button type="button" className={styles.statFootBtn} onClick={onDone}>Done</button>
      </div>
    </section>
  )
}
