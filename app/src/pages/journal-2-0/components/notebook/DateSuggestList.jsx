/**
 * P0.9 -- the list the `@` date suggestion shows (lib/dateSuggest.js builds the choices and owns
 * the one command that inserts one).
 *
 * The same listbox + ARIA-combobox pattern as the emoji and slash menus: the EDITOR holds focus
 * and carries the combobox role (applyComboboxWiring), the options are never focused.
 *   ↑/↓ move (and wrap) · Enter inserts the selected row · a tap inserts a row.
 * Tab and Escape are NOT taken: Tab indents a list item, and Escape belongs to the Suggestion
 * plugin. With no choices the list renders nothing and EVERY key passes through, so "@john" then
 * Enter is a newline, never a swallowed key.
 *
 * "Pick a date…" is the last row. Choosing it does not insert anything: it reveals a native
 * date input underneath the list, focused, and the date picked there is inserted. ⛔ The input is
 * a sibling of the listbox, never a child of an option: an interactive control inside an option
 * (whose children are presentational) is the nested-interactive axe violation.
 * ⛔ A date input fires `change` on every keystroke that makes a valid date, so typing the year
 * "2026" passes through year 0002 and 0020; a date before 1900 is not taken as the member's
 * answer.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { dateMentionLongLabel, isIsoDate } from '../../lib/dateMentionNode'
import styles from './DateSuggestList.module.css'

export const DATE_SUGGEST_MENU_ID = 'uct-date-suggest'
const MIN_YEAR = 1900

const DateSuggestList = forwardRef(function DateSuggestList(props, ref) {
  const { items, query, command, onActiveChange } = props
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [picking, setPicking] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => setSelectedIndex(0), [items])
  // A new query is a new question: the date input belongs to the bare "@" only.
  useEffect(() => setPicking(false), [query])
  useEffect(() => {
    onActiveChange?.(items.length ? `${DATE_SUGGEST_MENU_ID}-opt-${selectedIndex}` : null)
  }, [selectedIndex, items]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (picking) inputRef.current?.focus()
  }, [picking])

  const choose = (item) => {
    if (!item) return
    if (item.picker) { setPicking(true); return }
    command(item)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowUp') { setSelectedIndex((selectedIndex + items.length - 1) % items.length); return true }
      if (event.key === 'ArrowDown') { setSelectedIndex((selectedIndex + 1) % items.length); return true }
      if (event.key === 'Enter') { choose(items[selectedIndex]); return true }
      return false
    },
  }))

  if (!items.length) return null

  const onPicked = (event) => {
    const value = event.target.value
    if (!isIsoDate(value) || Number(value.slice(0, 4)) < MIN_YEAR) return
    command({ label: value, date: value })
  }

  return (
    <div className={styles.menu}>
      <div className={styles.list} role="listbox" id={DATE_SUGGEST_MENU_ID} aria-label="Insert a date">
        {items.map((item, i) => (
          <button
            key={item.label}
            type="button"
            role="option"
            id={`${DATE_SUGGEST_MENU_ID}-opt-${i}`}
            aria-selected={i === selectedIndex}
            className={`${styles.item} ${i === selectedIndex ? styles.itemActive : ''}`}
            onMouseDown={(e) => { e.preventDefault(); choose(item) }}
            onMouseEnter={() => setSelectedIndex(i)}
          >
            <span className={styles.label} data-label>{item.label}</span>
            <span className={styles.desc}>
              {item.picker ? 'Choose from a calendar' : dateMentionLongLabel(item.date)}
            </span>
          </button>
        ))}
      </div>
      {picking ? (
        <div className={styles.pick}>
          <input
            ref={inputRef}
            type="date"
            className={styles.dateInput}
            aria-label="Pick a date"
            min={`${MIN_YEAR}-01-01`}
            onChange={onPicked}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); props.editor?.view?.focus() }
            }}
          />
        </div>
      ) : null}
    </div>
  )
})

export default DateSuggestList
