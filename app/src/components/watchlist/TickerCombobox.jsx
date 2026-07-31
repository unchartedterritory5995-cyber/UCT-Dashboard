// TickerCombobox — inline, always-visible predictive ticker input.
//
// Distinct from chart/SymbolSearch (a badge that OPENS a search to navigate to
// one symbol): this is a bare input that stays mounted, is built for adding
// SEVERAL tickers in a row, and knows which symbols the target already holds.
//
// Implements the ARIA 1.2 combobox-with-listbox pattern: the input owns
// aria-activedescendant, the popup is a listbox, the rows are options.
import { forwardRef, useId, useImperativeHandle, useRef, useState, useCallback, useEffect } from 'react'
import useTickerSuggest from '../../hooks/useTickerSuggest'
import UIcon from '../ui/UIcon'
import styles from './TickerCombobox.module.css'

const TickerCombobox = forwardRef(function TickerCombobox({
  onPick,
  onEscape,
  placeholder = 'Add symbol…',
  autoFocus = false,
  existingSyms = null,   // Set<string> — symbols already in the target list
  targetLabel = '',      // used in the "already in X" hint
  compact = false,
}, ref) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [rawActiveIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const blurTimer = useRef(null)
  const listboxId = useId()

  const { results, loading } = useTickerSuggest(query, { enabled: open })

  useImperativeHandle(ref, () => ({
    focus: () => { inputRef.current?.focus(); setOpen(true) },
  }), [])

  // Clamp during render rather than resetting from an effect on [results] — a
  // synchronous setState in an effect body cascades a second render pass. The
  // index is reset to 0 in onChange (an event handler), where it belongs.
  const activeIdx = Math.min(rawActiveIdx, Math.max(0, results.length - 1))

  useEffect(() => () => clearTimeout(blurTimer.current), [])

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.children?.[activeIdx]
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const has = useCallback(
    (t) => !!existingSyms && existingSyms.has(String(t).toUpperCase()),
    [existingSyms],
  )

  const pick = useCallback((ticker) => {
    const clean = String(ticker || '').trim().toUpperCase()
    if (!clean) return
    onPick(clean)
    // Clear but STAY focused + open so several tickers can be banked in a row.
    setQuery('')
    setActiveIdx(0)
    inputRef.current?.focus()
  }, [onPick])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setActiveIdx(i => Math.min(i + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[activeIdx]
      if (hit?.ticker) pick(hit.ticker)
      else if (query.trim()) pick(query)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (query) { setQuery('') }
      else { setOpen(false); onEscape?.() }
    }
  }, [open, results, activeIdx, query, pick, onEscape])

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`}>
      <span className={styles.icon} aria-hidden="true"><UIcon name="search" size={12} /></span>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined}
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        spellCheck={false}
        autoComplete="off"
        maxLength={10}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value.toUpperCase()); setOpen(true) }}
        onKeyDown={handleKeyDown}
        // Delay the close so a mousedown on a row still lands.
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120) }}
      />

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Ticker suggestions"
          className={styles.list}
        >
          {results.map((r, i) => {
            const already = has(r.ticker)
            return (
              <li
                key={`${r.ticker}-${i}`}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                className={[
                  styles.opt,
                  i === activeIdx ? styles.optActive : '',
                  already ? styles.optAlready : '',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={e => e.preventDefault()}  // keep focus in the input
                onClick={() => pick(r.ticker)}
              >
                <span className={styles.optSym}>{r.ticker}</span>
                {r._typed
                  ? <span className={styles.optName}>Add anyway</span>
                  : r.name && <span className={styles.optName}>{r.name}</span>}
                {already && (
                  <span className={styles.optAlreadyTag}>
                    <UIcon name="check" size={10} />
                    {targetLabel ? ` in ${targetLabel}` : ' added'}
                  </span>
                )}
              </li>
            )
          })}
          {results.length === 0 && (
            <li className={styles.optEmpty} role="presentation">
              {loading ? 'Searching…' : 'No matches'}
            </li>
          )}
        </ul>
      )}
    </div>
  )
})

export default TickerCombobox
