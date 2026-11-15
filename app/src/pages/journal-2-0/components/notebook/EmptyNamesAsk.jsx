// Audit 2026-11-05, spec S17 (M7): an empty widget asks for what it needs. THE RULE, for every embed with no data:
//   1. one sentence on what it needs;
//   2. an inline input (and its button);
//   3. three suggestions -- and "Import from Charts watchlist" when the member has a Charts watchlist to import.
// ⛔ It reserves no blank space: it is as tall as what it says (EmptyNamesAsk.module.css), and the widgets that
// render it drop their fixed height while they are empty.
//
// Every write goes through the existing watchlist API, into the member's "My names" list (lib/myNames.js). After a
// write, `onAdded` lets the host refresh what it shows (a snapshot widget re-asks its payload; a box re-reads).
// ⛔ It never takes focus by itself (it renders inside notes and on Home), and its status line is mounted empty and
// filled when there is something to say.
import { useEffect, useId, useState } from 'react'
import { SUGGESTED_NAMES, addMyNames, chartsWatchlistNames, cleanSymbols } from '../../lib/myNames'
import styles from './EmptyNamesAsk.module.css'

/** M7's sentence, verbatim: the My names / watchlist widget's ask. */
export const NAMES_ASK = 'Add the tickers you watch. This list, your earnings and your daily plan will follow them.'
export const IMPORT_LABEL = 'Import from Charts watchlist'

export default function EmptyNamesAsk({
  sentence = NAMES_ASK, suggestions = SUGGESTED_NAMES, onAdded, canImport = true, testId = 'empty-names-ask',
}) {
  const uid = useId()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [added, setAdded] = useState([])
  const [importable, setImportable] = useState([])

  // "Import from Charts watchlist" is offered only when there is a Charts watchlist with names to import.
  useEffect(() => {
    if (!canImport) return undefined
    let alive = true
    chartsWatchlistNames().then((names) => { if (alive) setImportable(names) }, () => {})
    return () => { alive = false }
  }, [canImport])

  const add = async (symbols, { importing = false } = {}) => {
    const names = cleanSymbols(symbols)
    if (busy) return
    if (!names.length) { setStatus('Type a ticker, like NVDA.'); return }
    setBusy(true)
    setStatus('')
    try {
      const out = await addMyNames(names)
      setAdded((prev) => [...prev, ...names.filter((n) => !prev.includes(n))])
      if (importing) setImportable([])
      setValue('')
      setStatus(importing
        ? `Imported ${names.length} ${names.length === 1 ? 'name' : 'names'} into My names.`
        : `Added ${names.join(', ')} to My names.`)
      onAdded?.({ ...out, symbols: names })
    } catch (e) {
      setStatus(e?.status >= 400 && e?.status < 500 && e?.message && !/^\d+$/.test(e.message)
        ? e.message : "Couldn't add that. Nothing was saved. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const left = suggestions.filter((s) => !added.includes(s)).slice(0, 3)
  return (
    <div className={styles.ask} data-testid={testId} data-empty-ask="">
      <p className={styles.line}>{sentence}</p>
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); add(value.split(/[\s,]+/)) }}>
        <label htmlFor={`${uid}-ticker`} className="sr-only">Ticker to add</label>
        <input id={`${uid}-ticker`} className={styles.input} value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="Add a ticker" autoComplete="off" spellCheck={false} disabled={busy} />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !value.trim()}>Add</button>
      </form>
      {/* Simplify pass 2 (B3): a host may ask for the line and the field only (the Daily brief's compact ask); then
          there is no empty group to announce. */}
      {(left.length > 0 || importable.length > 0) && (
        <div className={styles.suggestions} role="group" aria-label="Suggestions">
          {left.map((s) => (
            <button key={s} type="button" className={styles.chip} aria-label={`Add ${s}`} disabled={busy}
              onClick={() => add([s])}>{`+ ${s}`}</button>
          ))}
          {importable.length > 0 && (
            <button type="button" className={styles.chip} disabled={busy}
              onClick={() => add(importable, { importing: true })}>{IMPORT_LABEL}</button>
          )}
        </div>
      )}
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </div>
  )
}
