// app/src/components/chart/ComparisonPicker.jsx
import { useState, useRef, useEffect } from 'react';
import styles from './ComparisonPicker.module.css';
import { pickComparisonColor } from './comparisonUtils';


const MAX_COMPARISONS = 5;
const POPULAR_TICKERS = ['QQQ', 'SPY', 'IWM', 'DIA', 'NDX', 'VIX', 'BTC-USD'];


export default function ComparisonPicker({ comparisons, onUpdate, onClose, currentSym = null }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);
  const ownSym = currentSym ? String(currentSym).toUpperCase() : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  const remaining = MAX_COMPARISONS - comparisons.length;

  return (
    <div className={styles.popover}>
      <div className={styles.header}>
        <span className={styles.title}>Compare Symbols</span>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          ref={inputRef}
          type="text"
          placeholder={remaining > 0 ? `Add ticker (${remaining} slots left)` : 'Max reached'}
          value={search}
          onChange={e => setSearch(e.target.value.toUpperCase())}
          disabled={remaining === 0}
          className={styles.input}
        />
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
