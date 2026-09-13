import { useState, useRef, useEffect, useId } from 'react'
import UIcon from '../../components/ui/UIcon'
import styles from './PresetRow.module.css'

const slug = text => text.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

/**
 * Sixteen presets in one chrome band: one-click pills for the presets without a
 * `group`, and everything else behind More, grouped by `groupOrder`. Promoting a
 * preset between the two tiers is adding or removing its `group`.
 *
 * A-24 (D-032): More is a disclosure — a button that shows and hides lists of
 * buttons. It was a `listbox` of `option`s, which promises arrow-key selection the
 * list never had; V2 adds the keys and may then take a role that names them.
 * Escape closes the list and returns focus to More (02-design §3).
 */
export default function PresetRow({ presets, groupOrder, activePreset, onApply }) {
  const [open, setOpen] = useState(false)
  const moreRef = useRef(null)
  const triggerRef = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onKey = e => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
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

      {/* Only the pills scroll on touch. If the row itself were the scroll
          container, `overflow-x: auto` would compute `overflow-y` to auto as
          well and clip the More list that drops out of it. */}
      <div className={styles.pills}>
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
      </div>

      {grouped.length > 0 && (
        <div className={styles.more} ref={moreRef}>
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            className={`${styles.btn} ${activeInMore ? styles.btnActive : ''}`}
            onClick={() => setOpen(o => !o)}
          >
            {activeInMore ? `More: ${activeInMore.label}` : 'More'}
            <UIcon name="chevronDown" size={12} style={{ marginLeft: 4, verticalAlign: -1 }} />
          </button>

          {open && (
            <div id={panelId} className={styles.panel}>
              {groupOrder
                .filter(g => grouped.some(p => p.group === g))
                .map(g => {
                  const headingId = `${panelId}-${slug(g)}`
                  return (
                    <div key={g}>
                      <div id={headingId} className={styles.groupHeading}>{g}</div>
                      <ul className={styles.groupList} aria-labelledby={headingId}>
                        {grouped.filter(p => p.group === g).map(p => (
                          <li key={p.id}>
                            <button
                              type="button"
                              aria-pressed={activePreset === p.id}
                              className={`${styles.item} ${activePreset === p.id ? styles.itemActive : ''}`}
                              onClick={() => apply(p)}
                            >
                              <span className={styles.itemLabel}>{p.label}</span>
                              <span className={styles.itemHint}>{p.hint}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
