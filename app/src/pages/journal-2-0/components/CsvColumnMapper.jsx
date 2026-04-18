/**
 * CSV Column Mapper — Journal 2.0.
 * Spec §13 "Interactive column mapping" (promoted to Must this build).
 *
 * Shown when the backend returns format=unknown from /import/preview.
 * User maps each required pre-matched field to a source CSV header via
 * a select. Optional fields can be left unmapped. On submit, parent
 * re-posts to /import/preview-mapped with the JSON mapping.
 */

import { useCallback, useMemo, useState } from 'react'
import styles from './CsvColumnMapper.module.css'

const REQUIRED_FIELDS = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'side', label: 'Side (Long / Short)' },
  { key: 'shares', label: 'Shares' },
  { key: 'entry_price', label: 'Entry Price' },
  { key: 'entry_date', label: 'Entry Date (YYYY-MM-DD)' },
  { key: 'exit_price', label: 'Exit Price' },
  { key: 'exit_date', label: 'Exit Date (YYYY-MM-DD)' },
]

const OPTIONAL_FIELDS = [
  { key: 'setup', label: 'Setup' },
  { key: 'notes', label: 'Notes' },
  { key: 'original_stop', label: 'Original Stop' },
]

function guessMapping(headers) {
  const pairs = {}
  const lower = (s) => s.toLowerCase().replace(/[\s_-]/g, '')
  const looksLike = (header, needles) =>
    needles.some((n) => lower(header).includes(n))

  for (const h of headers) {
    if (!pairs.symbol && looksLike(h, ['symbol', 'ticker'])) pairs.symbol = h
    else if (!pairs.side && looksLike(h, ['side', 'direction', 'action'])) pairs.side = h
    else if (!pairs.shares && looksLike(h, ['shares', 'quantity', 'qty', 'count'])) pairs.shares = h
    else if (!pairs.entry_price && looksLike(h, ['entryprice', 'buyprice', 'buy'])) pairs.entry_price = h
    else if (!pairs.entry_date && looksLike(h, ['entrydate', 'buydate', 'opendate'])) pairs.entry_date = h
    else if (!pairs.exit_price && looksLike(h, ['exitprice', 'sellprice', 'sell'])) pairs.exit_price = h
    else if (!pairs.exit_date && looksLike(h, ['exitdate', 'selldate', 'closedate'])) pairs.exit_date = h
    else if (!pairs.setup && looksLike(h, ['setup', 'strategy', 'pattern'])) pairs.setup = h
    else if (!pairs.notes && looksLike(h, ['notes', 'comment', 'memo'])) pairs.notes = h
    else if (!pairs.original_stop && looksLike(h, ['stop', 'originalstop', 'stoploss'])) pairs.original_stop = h
  }
  return pairs
}

export default function CsvColumnMapper({
  headers,
  rawRows,
  onMap,
  onCancel,
}) {
  const [mapping, setMapping] = useState(() => guessMapping(headers))

  const missing = useMemo(
    () => REQUIRED_FIELDS.filter((f) => !mapping[f.key]),
    [mapping],
  )

  const setField = useCallback((key, value) => {
    setMapping((prev) => {
      const next = { ...prev }
      if (!value) delete next[key]
      else next[key] = value
      return next
    })
  }, [])

  const handleSubmit = useCallback(() => {
    if (missing.length > 0) return
    // Strip empty optional fields so the payload is tight
    const clean = {}
    for (const [k, v] of Object.entries(mapping)) {
      if (v) clean[k] = v
    }
    onMap(clean)
  }, [mapping, missing, onMap])

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <p>
          Map each required Journal 2.0 field to one of your CSV's columns.
          Dates must be <strong>YYYY-MM-DD</strong> format in your CSV.
        </p>
      </div>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Required</h4>
        {REQUIRED_FIELDS.map((f) => (
          <MapRow
            key={f.key}
            field={f}
            headers={headers}
            value={mapping[f.key] || ''}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Optional</h4>
        {OPTIONAL_FIELDS.map((f) => (
          <MapRow
            key={f.key}
            field={f}
            headers={headers}
            value={mapping[f.key] || ''}
            onChange={(v) => setField(f.key, v)}
            optional
          />
        ))}
      </section>

      {rawRows?.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>First rows of your CSV</h4>
          <div className={styles.rawTable}>
            <table>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawRows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    {headers.map((_, j) => (
                      <td key={j}>{r[j] || ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {missing.length > 0 && (
        <div className={styles.warning}>
          Still to map: {missing.map((m) => m.label).join(', ')}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel}>
          Back
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleSubmit}
          disabled={missing.length > 0}
        >
          Parse with mapping
        </button>
      </div>
    </div>
  )
}

function MapRow({ field, headers, value, onChange, optional }) {
  return (
    <label className={styles.row}>
      <span className={styles.fieldLabel}>
        {field.label}
        {optional && <span className={styles.optionalTag}>optional</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={styles.select}
      >
        <option value="">— none —</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  )
}
