// app/src/components/chart/SourceField.jsx
//
// ─── THE CONTROL FOR AN INPUT OF TYPE `source` ──────────────────────────────
//
// ⭐⭐ ONE SOURCE LANGUAGE, ONE CONTROL. A source is a bar field (`close`),
// another instance's output (`@ind-x:rsi`) or a canonical symbol
// (`sym:QQQ:close`) — three families that every consumer already handles
// blind. This control edits all three through the SAME stored string, so
// nothing downstream learns that a symbol was picked in a different widget than
// a price field.
//
// ⛔ IT IS NOT AN ENUM. An enum's choices are declared by the definition and are
// identical on every chart; a source's depend on what else is ON this chart and
// on what the member searches for. That is why `fieldFromInput` returns a bare
// `{type:'source'}` descriptor and the list is built here, live, from settings.
//
// ⛔⛔ A STORED SOURCE THAT IS NO LONGER OFFERED STILL SHOWS — as "Source
// unavailable" — because silently snapping the select back to Close would change
// what the instance COMPUTES without the member asking. A severed source
// (`!@inst:…`) does not parse, takes no option, and lands there by construction.

import { useState, useRef, useEffect, useCallback } from 'react'
import { sourceOptions, symbolSource, parseSource } from './engine/sourceRef'
import useSymbolDiscovery from './useSymbolDiscovery'

/** The sentinel that opens the symbol search. ⛔ It is never a stored value —
 *  `onPick` is not called for it, so it cannot reach an instance's inputs. */
const SEARCH = '__search__'
const UNAVAILABLE = '__unavailable__'

export default function SourceField({
  row, field, value, settings, registry, inert = {}, styles = {}, onPick,
  /** Injected in tests so no case depends on the network. */
  fetcher = undefined,
}) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  // The picker opens EMPTY rather than pre-filled with the current symbol: the
  // member opened it to change the instrument, and a pre-filled box makes the
  // first keystroke an edit of the old answer instead of the start of a new one.
  useEffect(() => { if (searching) inputRef.current?.focus() }, [searching])

  const defOf = useCallback(
    (id) => (registry && registry.getDefinition ? registry.getDefinition(id) : null),
    [registry],
  )

  // ⭐⭐ THE CURRENT VALUE IS PASSED, WHICH IS WHY THAT PARAMETER EXISTS.
  // `sourceOptions` emits its "Symbol" group only for the value it is SHOWN —
  // there is no symbol catalogue in it by design — so omitting this argument
  // makes every symbol source read "Source unavailable" over a perfectly good
  // `sym:SPY:close`. Its own header states the rule: a value must be
  // representable in the control that edits it.
  const groups = sourceOptions(settings, defOf, row?.instanceId, value)
  const known = groups.some((g) => g.options.some((o) => o.value === value))

  const { results, loading, error } = useSymbolDiscovery(query, searching, { fetcher })

  const pick = (sym) => {
    // ⛔ STORED CANONICALLY, ALWAYS. The control never invents a second shape —
    // `symbolSource` is the one writer of `sym:<TICKER>:<field>`, so what the
    // binder parses is what this wrote.
    onPick?.(symbolSource(sym, 'close'))
    setSearching(false)
    setQuery('')
  }

  return (
    <div className={styles.sourceField || undefined}>
      <select
        className={styles.indSelect}
        {...inert}
        value={known ? value : UNAVAILABLE}
        aria-label={`${row?.label || ''} ${field?.label || 'Source'}`.trim()}
        onChange={(e) => {
          const next = e.target.value
          if (next === SEARCH) { setSearching(true); return }
          if (next === UNAVAILABLE) return
          onPick?.(next)
        }}
      >
        {!known && <option value={UNAVAILABLE}>Source unavailable</option>}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        ))}
        {/* ⭐ THE DOOR TO EVERY OTHER INSTRUMENT. `sourceOptions` cannot list the
            whole market, so the catalogue arrives as a search rather than as
            30,000 options — and it is one row of this same control, not a modal
            on top of a modal. */}
        <optgroup label="Symbol">
          <option value={SEARCH}>Search symbol…</option>
        </optgroup>
      </select>

      {searching && (
        <div className={styles.sourceSearch || undefined}>
          <input
            ref={inputRef}
            type="text"
            className={styles.indNum}
            placeholder="Ticker or name"
            aria-label="Search symbol"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setSearching(false); setQuery('') }
              // ⭐ ENTER TAKES THE TOP RESULT, which is the exact ticker match
              // when there is one — `useSymbolDiscovery` partitions for that.
              if (e.key === 'Enter' && results.length) pick(results[0].id)
            }}
          />
          {loading && <span className={styles.sourceHint || undefined}>Searching…</span>}
          {error && <span className={styles.sourceHint || undefined}>Search unavailable</span>}
          {!loading && !error && query && !results.length && (
            <span className={styles.sourceHint || undefined}>No match</span>
          )}
          <ul className={styles.sourceResults || undefined} role="listbox" aria-label="Symbol results">
            {results.slice(0, 8).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.sourceResult || undefined}
                  onClick={() => pick(r.id)}
                >
                  <strong>{r.shortName || r.id}</strong>
                  {r.name && r.name !== r.id ? <span> · {r.name}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** What the collapsed control says, for a caller that needs the words without
 *  the widget. Exported for the row summary and for tests. */
export function sourceFieldLabel(value, settings, defOf, selfInstanceId) {
  const groups = sourceOptions(settings, defOf, selfInstanceId, value)
  for (const g of groups) {
    for (const o of g.options) if (o.value === value) return o.label
  }
  return parseSource(value) ? '' : 'Source unavailable'
}
