/**
 * ⭐ THE SEARCHABLE CHOOSER FOR A SERVER-OWNED LIST (2026-11-12).
 *
 * A `string` input that declares `optionsSource` (`engine/optionsSources.js`;
 * the first is the RS indicators' "Pick a theme" benchmark) renders as this on
 * every settings surface: the settings dialog, the Chart Settings inspector and
 * the phone sheet. One component, so the three cannot drift.
 *
 * What a member sees: a box showing the chosen entry's NAME. Focus or type and
 * the list opens under it, filtered as they type (`filterOptions`: a name that
 * starts with the text first). Arrow keys move, Enter or a tap picks, Escape
 * closes without a change. What is STORED is the entry's value (a stable ID),
 * written through `onPick` once, on the pick, never per keystroke.
 *
 * The list sits IN FLOW under the box, not in a floating layer: the dialog and
 * the phone sheet both scroll, and a floating list would be clipped by either.
 *
 * Honest states: "Loading themes…", "Couldn't load the themes" with a retry, "No
 * theme matches", and a stored ID the list no longer holds reads as words with
 * a muted line saying so (the server falls back too, and its note says the same).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  OPTIONS_SOURCES, peekOptionsSource, subscribeOptionsSource, filterOptions, humanizeOptionValue,
} from './engine/optionsSources'
import { loadOptionsSource } from './optionsSourceLoader'
import styles from './OptionsSourcePicker.module.css'

/** At most this many rows render; the filter narrows the rest. */
const MAX_ROWS = 150

function useOptionsSource(name) {
  const state = useSyncExternalStore(
    (fn) => subscribeOptionsSource(name, fn),
    () => peekOptionsSource(name),
    () => peekOptionsSource(name),
  )
  useEffect(() => { loadOptionsSource(name) }, [name])
  return state
}

/**
 * @param {object} props
 * @param {object} props.field     the field descriptor (`fieldFromInput`): label, optionsSource, placeholder
 * @param {string} props.value     the stored value (an ID) or ''
 * @param {(v: string) => void} props.onPick  called once with the chosen value
 * @param {string} [props.inputClassName]  the host surface's text-box class, so the box matches its row
 * @param {string} [props.idBase]  the input's id (a label's `htmlFor` points here)
 * @param {boolean} [props.disabled]
 * @param {object} [props.aria]    extra aria props for the box (`aria-describedby`, …)
 */
export default function OptionsSourcePicker({ field, value, onPick, inputClassName, idBase, disabled, aria }) {
  const name = field && field.optionsSource
  const source = OPTIONS_SOURCES[name] || { noun: 'option', plural: 'options' }
  const state = useOptionsSource(name)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  const listId = `${idBase || `pick-${name}`}-list`

  const stored = typeof value === 'string' ? value : ''
  const hit = state.status === 'ready' ? state.options.find((o) => o.value === stored) : null
  const storedLabel = hit ? hit.label : humanizeOptionValue(stored)
  const missing = !!stored && state.status === 'ready' && !hit
  const shown = useMemo(() => filterOptions(state.options, query).slice(0, MAX_ROWS), [state.options, query])

  // Keep the active row in view as the arrow keys move it.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector(`[data-index="${active}"]`)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const close = () => { setOpen(false); setQuery('') }
  const pick = (opt) => {
    close()
    if (opt && opt.value !== stored) onPick(opt.value)
  }
  const openList = () => {
    if (disabled) return
    if (!open) {
      setOpen(true)
      const at = shown.findIndex((o) => o.value === stored)
      setActive(at >= 0 ? at : 0)
    }
    if (state.status === 'error') loadOptionsSource(name, { force: true })
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { openList(); return }
      setActive((i) => Math.min(i + 1, Math.max(0, shown.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      if (shown[active]) pick(shown[active])
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); close() }
    }
  }

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined
  return (
    <span className={styles.wrap} data-options-source={name}>
      <input
        type="text" id={idBase}
        className={`${inputClassName || ''} ${styles.box}`.trim()}
        role="combobox" aria-label={field.label} aria-expanded={open ? 'true' : 'false'}
        aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeId}
        {...(aria || {})}
        placeholder={field.placeholder || `Search ${source.plural}`}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        disabled={disabled}
        value={open ? query : storedLabel}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => { if (!open) openList(); setQuery(e.target.value); setActive(0) }}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      {missing && !open && (
        <span className={styles.note} role="status">That {source.noun} is no longer listed</span>
      )}
      {open && (
        <ul className={styles.list} id={listId} role="listbox" aria-label={`${field.label} list`} ref={listRef}>
          {state.status === 'loading' || state.status === 'idle'
            ? <li className={styles.status} role="presentation">Loading {source.plural}…</li>
            : state.status === 'error'
              ? (
                <li className={styles.status} role="presentation">
                  Couldn&apos;t load the {source.plural}.{' '}
                  <button
                    type="button" className={styles.retry}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => loadOptionsSource(name, { force: true })}
                  >Try again</button>
                </li>
              )
              : shown.length === 0
                ? <li className={styles.status} role="presentation">No {source.noun} matches</li>
                : shown.map((o, i) => (
                  <li
                    key={o.value} id={`${listId}-${i}`} data-index={i}
                    role="option" aria-selected={o.value === stored ? 'true' : 'false'}
                    className={`${styles.option} ${i === active ? styles.optionActive : ''} ${o.value === stored ? styles.optionChosen : ''}`}
                    // mousedown, not click: the box's blur would close the list first
                    onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                    onMouseEnter={() => setActive(i)}
                  >{o.label}</li>
                ))}
        </ul>
      )}
    </span>
  )
}
