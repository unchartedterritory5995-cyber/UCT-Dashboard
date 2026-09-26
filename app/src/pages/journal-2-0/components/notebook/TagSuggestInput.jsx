import { useId, useMemo, useState } from 'react'
import { suggestTags } from '../../lib/tagTree'
import styles from './TagSuggestInput.module.css'

/**
 * A tag field that suggests the member's OWN tags, hierarchy first (wave 5
 * nested tags): "res" offers research, research/semis, research/semis/nvda;
 * "research/" offers what sits below research. See `lib/tagTree.suggestTags`
 * for the ranking — this component only presents it.
 *
 * ARIA combobox + listbox, keyboard-first: ↓/↑ move through suggestions,
 * Enter takes the highlighted one (and only then — with nothing highlighted,
 * Enter submits the surrounding form as typed), Esc closes the list. A
 * suggestion is taken on pointer-DOWN so the input keeps focus (a click would
 * blur it first and the list would close under the finger).
 *
 * It is a plain controlled input: `value` / `onChange(text)`. Reusable
 * wherever a tag is typed — the note editor's own tag field is the obvious
 * next home (that file belongs to the editor workstream).
 */
export default function TagSuggestInput({
  value,
  onChange,
  nodes,
  disabled = false,
  ariaLabel = 'Tag',
  placeholder = 'Add a tag, e.g. research/semis',
  className = '',
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const suggestions = useMemo(() => suggestTags(value, nodes), [value, nodes])
  const showList = open && !disabled && suggestions.length > 0

  const pick = (path) => {
    onChange(path)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(suggestions.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(-1, i - 1))
    } else if (e.key === 'Enter') {
      if (showList && active >= 0 && suggestions[active]) {
        e.preventDefault()          // take the suggestion, do not submit yet
        pick(suggestions[active])
      }
    } else if (e.key === 'Escape') {
      if (showList) {
        e.preventDefault()
        setOpen(false)
        setActive(-1)
      }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className={`${styles.wrap} ${className}`}>
      <input
        className={styles.input}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1) }}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Your tags" className={styles.list}>
          {suggestions.map((path, i) => {
            const segs = path.split('/')
            return (
              <li
                key={path}
                id={`${listId}-${i}`}
                role="option"
                // An explicit name: computed from the two spans it read
                // "research / semis /nvda" — the separator's space was lost.
                aria-label={segs.join(' / ')}
                aria-selected={i === active}
                className={`${styles.option} ${i === active ? styles.optionActive : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(path) }}
                onMouseEnter={() => setActive(i)}
              >
                {segs.length > 1 && (
                  <span className={styles.parents}>{segs.slice(0, -1).join(' / ')} / </span>
                )}
                <span className={styles.leaf}>{segs[segs.length - 1]}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
