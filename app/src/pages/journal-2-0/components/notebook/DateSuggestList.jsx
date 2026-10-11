/**
 * P0.9 -- the list the `@` date suggestion shows (lib/dateSuggest.js builds the choices and owns
 * the one command that inserts one).
 *
 * The same listbox + ARIA-combobox pattern as the emoji and slash menus: the EDITOR holds focus
 * and carries the combobox role (applyComboboxWiring), the options are never focused.
 *
 * ⛔ NO ROW IS EVER PRE-SELECTED. Enter is the key a member presses to END A LINE ("Buy NVDA @",
 * a task line ending in "@", "ask @tom"), so Enter does nothing here until the member has
 * actually chosen a row:
 *   ↓/↑ select a row (the first ↓ the first row, the first ↑ the last; both wrap) ·
 *   MOVING the pointer over a row selects it (never a bare mouseenter: the list opens under the
 *   caret, and a mouse resting there gets boundary events from the layout change alone) · Enter inserts the SELECTED row, and with nothing selected it is
 *   NOT taken (it reaches the editor: a new line) ·
 *   Tab inserts the selected row, or the FIRST row when nothing is selected (a completion
 *   is an explicit act; Enter is not) · a tap inserts a row.
 * Escape is not taken (it belongs to the Suggestion plugin). With no choices the list renders
 * nothing and every key passes through. A short hint under the rows says how to choose.
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
import { DATE_SUGGEST_MENU_ID } from '../../lib/dateSuggestMenuId'
import styles from './DateSuggestList.module.css'

export { DATE_SUGGEST_MENU_ID }
/** The class of the fixed wrapper the plugin puts the list in (the CSS module is this chunk's). */
export const POPUP_WRAP_CLASS = styles.popupWrap
const MIN_YEAR = 1900

const DateSuggestList = forwardRef(function DateSuggestList(props, ref) {
  const { items, query, command, onActiveChange } = props
  const [selectedIndex, setSelectedIndex] = useState(-1) // -1: nothing chosen yet
  const [picking, setPicking] = useState(false)
  const inputRef = useRef(null)

  // A new query is a new question: nothing is chosen, and the date input belongs to the bare "@".
  // (Keyed on the query, not on `items`: Suggestion hands over a fresh array on every
  // transaction, and a choice must survive a transaction that did not change the query.)
  useEffect(() => { setSelectedIndex(-1); setPicking(false) }, [query])
  useEffect(() => {
    // The list is showing whenever it has rows; the active descendant exists only once a row is chosen.
    const chosen = items.length && selectedIndex >= 0 && selectedIndex < items.length
    onActiveChange?.(chosen ? `${DATE_SUGGEST_MENU_ID}-opt-${selectedIndex}` : null, items.length > 0)
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
      const at = selectedIndex < items.length ? selectedIndex : -1
      if (event.key === 'ArrowUp') { setSelectedIndex(at < 0 ? items.length - 1 : (at + items.length - 1) % items.length); return true }
      if (event.key === 'ArrowDown') { setSelectedIndex(at < 0 ? 0 : (at + 1) % items.length); return true }
      // Enter ends a line: with nothing chosen it is not ours.
      if (event.key === 'Enter') {
        if (at < 0) return false
        choose(items[at])
        return true
      }
      if (event.key === 'Tab') { choose(items[at < 0 ? 0 : at]); return true }
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
            onMouseMove={() => setSelectedIndex(i)}
          >
            <span className={styles.label} data-label>{item.label}</span>
            <span className={styles.desc}>
              {item.picker ? 'Choose from a calendar' : dateMentionLongLabel(item.date)}
            </span>
          </button>
        ))}
      </div>
      <div className={styles.hint}>Press the down arrow to choose, or Tab for the first</div>
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
