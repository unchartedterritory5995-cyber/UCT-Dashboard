import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useLazyCounts from './useLazyCounts'
import { GROUPS, groupOf } from './screenGroups'
import Input from '../../../components/ui/Input'
import styles from './FocusScreener.module.css'

const norm = s => String(s || '').toLowerCase()

function Item({ item, pinned, count, current, onApply, onTogglePin }) {
  return (
    <div className={`${styles.smItem} ${current ? styles.smCurrent : ''}`}>
      <button type="button" className={styles.smPin} aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${item.name}`} onClick={() => onTogglePin(String(item.id))}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 17v5M5 9l3-6h8l3 6-3 3v3H8v-3z" /></svg>
      </button>
      <button type="button" className={styles.smOpen} aria-label={`Open ${item.name}`} onClick={() => onApply(item)}>
        <span className={styles.smName}>{item.name}</span>
        {item.description && <span className={styles.smDesc}>{item.description}</span>}
      </button>
      <span className={styles.smCount}>{count === undefined ? '' : count === null ? '—' : count.toLocaleString('en-US')}</span>
    </div>
  )
}

export default function ScreenMenu({ currentName, currentId, isEdited, count, starters = [], saved = [], pinned = [], onTogglePin, onApply, onSaveChanges, onSaveAsNew, onRename, onNewScreen, myScans = [], onUseScan, apiRef }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const btn = useRef(null), box = useRef(null)
  const uid = useId()
  useEffect(() => {
    if (!open) return undefined
    // pointerdown, not mousedown: touch and pen fire pointer events first; no focus is stolen
    const onDown = e => { if (!box.current?.contains(e.target)) { setOpen(false); setQ('') } }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  const close = () => { setOpen(false); setQ(''); btn.current?.focus() }
  // Tabbing (or any focus move) out of the menu and its trigger closes it, as the Menu primitive
  // does; focus stays where the member sent it. A null relatedTarget (window blur) keeps it open.
  const onBlur = e => {
    const to = e.relatedTarget
    if (open && to && !box.current?.contains(to)) { setOpen(false); setQ('') }
  }
  // `apiRef.current.open()` opens the menu (never toggles): the joystick hub's screens door.
  useImperativeHandle(apiRef, () => ({ open: () => setOpen(true) }), [])

  const all = useMemo(() => [
    ...starters.map(s => ({ ...s, kind: 'starter' })),
    ...saved.map(s => ({ ...s, id: s.id, kind: 'saved', description: s.description || '' })),
  ], [starters, saved])
  const match = it => !q || norm(it.name).includes(norm(q)) || norm(it.description).includes(norm(q))
  const pinnedIds = [...new Set(pinned.map(String))]
  const pinnedItems = pinnedIds.map(id => all.find(it => String(it.id) === String(id))).filter(Boolean).filter(match)
  const groups = GROUPS.map(g => ({ ...g, items: starters.filter(s => groupOf(s) === g.key).map(s => ({ ...s, kind: 'starter' })).filter(match) }))
    .filter(g => g.items.length)
  const mine = saved.map(s => ({ ...s, kind: 'saved' })).filter(match)

  const specs = useMemo(() => Object.fromEntries(all.map(it => [String(it.id), it.spec || { filters: [] }])), [all])
  const counts = useLazyCounts(specs, open)
  const pick = it => { onApply(it.spec || { filters: [] }, it); close() }
  const label = `${currentName || 'Custom screen'}${isEdited ? ' (edited)' : ''}`
  const pinnedSet = pinnedIds
  const row = it => <Item key={`${it.kind}-${it.id}`} item={it} pinned={pinnedSet.includes(String(it.id))}
    count={counts[String(it.id)]} current={String(it.id) === String(currentId)} onApply={pick} onTogglePin={onTogglePin} />

  return (
    <span className={styles.menuWrap} ref={box} onBlur={onBlur}>
      <button ref={btn} type="button" className={styles.screenBtn} aria-haspopup="dialog" aria-expanded={open}
        aria-label={Number.isFinite(count) ? `${label}, ${count} matches. Change screen` : `${label}. Change screen`} onClick={() => setOpen(o => !o)}>
        <span>{label}</span>
        <span className={styles.screenCount}>{Number.isFinite(count) ? count.toLocaleString('en-US') : ''}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Screens" className={`${styles.menu} ${styles.screenMenu}`} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }}>
          <div className={styles.smSearch}>
            <Input type="search" aria-label="Search screens" placeholder="Search screens…" value={q} autoFocus onChange={e => setQ(e.target.value)} className={styles.smInput} />
          </div>
          <div className={styles.smBody}>
            {pinnedItems.length > 0 && <section aria-labelledby={`${uid}-pinned`}><h3 id={`${uid}-pinned`} className={styles.smHead}>Pinned</h3>{pinnedItems.map(row)}</section>}
            {groups.map(g => <section key={g.key} aria-labelledby={`${uid}-${g.key}`}><h3 id={`${uid}-${g.key}`} className={styles.smHead}>{g.label}</h3>{g.items.map(it => row(it))}</section>)}
            {mine.length > 0 && <section aria-labelledby={`${uid}-mine`}><h3 id={`${uid}-mine`} className={styles.smHead}>My screens</h3>{mine.map(it => row(it))}</section>}
            {myScans.length > 0 && (
              <section aria-labelledby={`${uid}-scans`}><h3 id={`${uid}-scans`} className={styles.smHead}>My scans</h3>
                {myScans.filter(s => !q || norm(s.name).includes(norm(q))).map(s => (
                  <div key={s.hash} className={styles.smItem}>
                    <button type="button" className={styles.smOpen} onClick={() => { onUseScan(s.hash, s.name); close() }}>
                      <span className={styles.smName}>{s.name}</span><span className={styles.smDesc}>Use as a filter</span>
                    </button>
                  </div>))}
              </section>)}
          </div>
          <div className={styles.smFoot}>
            {onSaveChanges && typeof currentName === 'string' && currentName && <button type="button" className={styles.btn} onClick={() => { onSaveChanges(); close() }}>Save changes to &ldquo;{currentName}&rdquo;</button>}
            {onSaveAsNew && <button type="button" className={styles.linkBtn} onClick={() => { onSaveAsNew(); close() }}>Save as new…</button>}
            {onRename && <button type="button" className={styles.linkBtn} onClick={() => { onRename(); close() }}>Rename</button>}
            <span className={styles.spacer} />
            <button type="button" className={styles.goldLink} onClick={() => { onNewScreen(); close() }}>+ New screen</button>
          </div>
        </div>
      )}
    </span>
  )
}
