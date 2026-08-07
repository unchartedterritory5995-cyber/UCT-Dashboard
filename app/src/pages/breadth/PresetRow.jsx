import { useState, useRef, useEffect } from 'react'
import UIcon from '../../components/ui/UIcon'
import styles from './PresetRow.module.css'

/**
 * Sixteen presets in one chrome band: one-click pills for the presets without a
 * `group`, and everything else behind a More popover grouped by `groupOrder`.
 * Promoting a preset between the two tiers is adding or removing its `group`.
 */
export default function PresetRow({ presets, groupOrder, activePreset, onApply }) {
  const [open, setOpen] = useState(false)
  const moreRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    const onDown = e => { if (!moreRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const core = presets.filter(p => !p.group)
  const grouped = presets.filter(p => p.group)
  const activeInMore = grouped.find(p => p.id === activePreset)

  function apply(preset) {
    onApply(preset)
    setOpen(false)
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>Presets</span>

      {core.map(p => (
        <button
          key={p.id}
          type="button"
          title={p.hint}
          aria-pressed={activePreset === p.id}
          className={`${styles.btn} ${activePreset === p.id ? styles.btnActive : ''}`}
          onClick={() => apply(p)}
        >
          {p.label}
        </button>
      ))}

      {grouped.length > 0 && (
        <div className={styles.more} ref={moreRef}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            className={`${styles.btn} ${activeInMore ? styles.btnActive : ''}`}
            onClick={() => setOpen(o => !o)}
          >
            {activeInMore ? `More: ${activeInMore.label}` : 'More'}
            <UIcon name="chevronDown" size={12} style={{ marginLeft: 4, verticalAlign: -1 }} />
          </button>

          {open && (
            <ul className={styles.panel} role="listbox">
              {groupOrder
                .filter(g => grouped.some(p => p.group === g))
                .map(g => (
                  <li key={g}>
                    <div className={styles.groupHeading} role="presentation">{g}</div>
                    <ul className={styles.groupList}>
                      {grouped.filter(p => p.group === g).map(p => (
                        <li key={p.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={activePreset === p.id}
                            className={`${styles.item} ${activePreset === p.id ? styles.itemActive : ''}`}
                            onClick={() => apply(p)}
                          >
                            <span className={styles.itemLabel}>{p.label}</span>
                            <span className={styles.itemHint}>{p.hint}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
