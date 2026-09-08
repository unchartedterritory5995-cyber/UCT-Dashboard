// app/src/components/chart/ComparisonPicker.jsx
import { useState, useRef, useEffect, useId, useMemo } from 'react';
import styles from './ComparisonPicker.module.css';
import { pickComparisonColor } from './comparisonUtils';
import useTickerSuggest from '../../hooks/useTickerSuggest';


const MAX_COMPARISONS = 5;
const POPULAR_TICKERS = ['QQQ', 'SPY', 'IWM', 'DIA', 'NDX', 'VIX', 'BTC-USD'];


export default function ComparisonPicker({ comparisons, onUpdate, onClose, currentSym = null }) {
  const [search, setSearch] = useState('');
  const [rawActiveIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listboxId = useId();
  const ownSym = currentSym ? String(currentSym).toUpperCase() : null;
  const trimmed = search.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Canonical search (Seam 14's own /api/ticker-search + useTickerSuggest.js
  // discipline) -- queried only once the member has typed something, so the
  // hook's OWN empty-query fallback list never shows up here and competes
  // with this picker's distinct, product-curated POPULAR_TICKERS row below
  // (a deliberately different, index/macro-oriented set -- Chart Comparison
  // Picker Convergence V1 Phase A found reusing the full TickerCombobox
  // component would visually double the "browse without typing" list, so
  // this reuses the HOOK directly instead, same discipline already applied
  // to SwitchTickerBox/MobileSymbolSheet in Seam 14).
  const { results: rawResults, loading } = useTickerSuggest(search, { enabled: !!trimmed });
  const results = useMemo(
    () => (trimmed
      ? rawResults.filter(r => r.ticker !== ownSym && !comparisons.some(c => c.sym === r.ticker))
      : []),
    [rawResults, trimmed, ownSym, comparisons],
  );
  const showDrop = !!trimmed;
  // Clamp during render (not from an effect on [results], which would cascade
  // a second render pass) -- mirrors TickerCombobox.jsx's own established
  // pattern for the same reason.
  const activeIdx = Math.min(rawActiveIdx, Math.max(0, results.length - 1));

  useEffect(() => {
    const el = listRef.current?.children?.[activeIdx];
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  function addComparison(sym) {
    const clean = String(sym || '').trim().toUpperCase();
    if (!clean) return;
    if (ownSym && clean === ownSym) return; // can't compare a symbol against itself
    if (comparisons.length >= MAX_COMPARISONS) return;
    if (comparisons.some(c => c.sym === clean)) return; // dedup
    const color = pickComparisonColor(comparisons.length);
    onUpdate([...comparisons, { sym: clean, color, enabled: true }]);
    setSearch('');
  }

  function removeComparison(sym) {
    onUpdate(comparisons.filter(c => c.sym !== sym));
  }

  function toggleComparison(sym) {
    onUpdate(comparisons.map(c => c.sym === sym ? { ...c, enabled: !c.enabled } : c));
  }

  function updateColor(sym, color) {
    onUpdate(comparisons.map(c => c.sym === sym ? { ...c, color } : c));
  }

  function handleSubmit(e) {
    e.preventDefault();
    addComparison(search);
  }

  function handleKeyDown(e) {
    if (!showDrop) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = results[activeIdx];
      if (hit?.ticker) {
        // A highlighted canonical search result wins over the raw typed
        // value -- the form's own onSubmit (raw `search`) is the fallback
        // for when nothing in the dropdown matches (e.g. it was filtered
        // out as already-added/self, or the fetch hasn't landed yet).
        e.preventDefault();
        addComparison(hit.ticker);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setSearch('');
    }
  }

  const remaining = MAX_COMPARISONS - comparisons.length;

  return (
    <div className={styles.popover}>
      <div className={styles.header}>
        <span className={styles.title}>Compare Symbols</span>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.searchWrap}>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={showDrop}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={showDrop && results[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined}
            placeholder={remaining > 0 ? `Add ticker (${remaining} slots left)` : 'Max reached'}
            value={search}
            onChange={e => { setSearch(e.target.value.toUpperCase()); setActiveIdx(0) }}
            onKeyDown={handleKeyDown}
            disabled={remaining === 0}
            className={styles.input}
            spellCheck={false}
            autoComplete="off"
          />
          {showDrop && (
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="Ticker suggestions"
              className={styles.searchList}
            >
              {results.length === 0 ? (
                <li className={styles.searchEmpty} role="presentation">
                  {loading ? 'Searching…' : 'No matches'}
                </li>
              ) : (
                results.map((r, i) => (
                  <li
                    key={`${r.ticker}-${i}`}
                    id={`${listboxId}-opt-${i}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    className={`${styles.searchOpt} ${i === activeIdx ? styles.searchOptActive : ''}`}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => addComparison(r.ticker)}
                  >
                    <span className={styles.searchOptSym}>{r.ticker}</span>
                    {r._typed
                      ? <span className={styles.searchOptName}>Add anyway</span>
                      : r.name && <span className={styles.searchOptName}>{r.name}</span>}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <button type="submit" disabled={remaining === 0 || !search.trim()} className={styles.addBtn}>
          Add
        </button>
      </form>

      {remaining > 0 && (
        <div className={styles.popular}>
          {POPULAR_TICKERS.filter(t => !comparisons.some(c => c.sym === t) && t !== ownSym).slice(0, 6).map(t => (
            <button key={t} className={styles.popularBtn} onClick={() => addComparison(t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      <div className={styles.list}>
        {comparisons.length === 0 ? (
          <div className={styles.empty}>No comparisons yet. Add a ticker above.</div>
        ) : (
          comparisons.map(c => (
            <div key={c.sym} className={styles.row}>
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={() => toggleComparison(c.sym)}
              />
              <input
                type="color"
                value={c.color}
                onChange={e => updateColor(c.sym, e.target.value)}
                className={styles.colorPicker}
              />
              <span className={styles.sym}>{c.sym}</span>
              <button className={styles.remove} onClick={() => removeComparison(c.sym)} aria-label={`Remove ${c.sym}`}>
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
