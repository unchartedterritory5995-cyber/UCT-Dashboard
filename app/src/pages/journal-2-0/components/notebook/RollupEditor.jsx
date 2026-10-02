import { useId } from 'react'
import {
  ROLLUP_AGGREGATES, ROLLUP_SOURCES, TRADE_FIELDS, TRADE_RESULTS, describeRollup,
} from '../../lib/formula/computed'
import styles from './FormulaEditor.module.css'

/**
 * Wave 11 (lane 11B): setting up a rollup — WHICH rows (linked notes, a saved
 * view's notes, or this note's trades), WHAT to read from each, and HOW to
 * summarise them. Native selects throughout, so every choice has a label, a
 * keyboard path and a screen-reader name for free. The sentence at the bottom
 * says, in words, what the rollup will compute.
 *
 * Controlled: `value` is the config object, `onChange` gets the next one.
 */
export default function RollupEditor({ value, onChange, defs, savedViews = [], selfId = null }) {
  const id = useId()
  const cfg = value || {}
  const set = (patch) => onChange({ ...cfg, ...patch })
  const isTrades = cfg.source === 'trades'
  const wantsValue = cfg.aggregate && cfg.aggregate !== 'count'
  const readable = (defs || []).filter((d) => d.id !== selfId && d.source !== 'financial_derived' && (
    d.type === 'number' || d.type === 'formula' || (cfg.aggregate === 'win_rate' && d.type === 'select')))
  const prop = (defs || []).find((d) => d.id === cfg.propertyId)
  const needsOption = cfg.aggregate === 'win_rate' && (isTrades ? cfg.tradeField === 'result' : prop?.type === 'select')
  const tradeFields = TRADE_FIELDS.filter((f) => f.value !== 'result' || cfg.aggregate === 'win_rate')

  return (
    <div className={styles.wrap}>
      <label className={styles.label} htmlFor={`${id}-source`}>Summarise</label>
      <select id={`${id}-source`} className={styles.select} value={cfg.source || ''}
        onChange={(e) => set({ source: e.target.value || undefined, propertyId: undefined, tradeField: undefined, optionId: undefined })}>
        <option value="">Choose which notes or trades…</option>
        {ROLLUP_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      {cfg.source === 'saved_view' && (
        <>
          <label className={styles.label} htmlFor={`${id}-view`}>Saved view</label>
          <select id={`${id}-view`} className={styles.select} value={cfg.savedViewId || ''}
            onChange={(e) => set({ savedViewId: e.target.value || undefined })}>
            <option value="">Choose a saved view…</option>
            {savedViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          {!savedViews.length && <p className={styles.help}>You have no saved views yet. Save a view from the notebook toolbar first.</p>}
        </>
      )}

      <label className={styles.label} htmlFor={`${id}-agg`}>Calculate</label>
      <select id={`${id}-agg`} className={styles.select} value={cfg.aggregate || ''}
        onChange={(e) => set({ aggregate: e.target.value || undefined, optionId: undefined })}>
        <option value="">Choose a calculation…</option>
        {ROLLUP_AGGREGATES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
      </select>

      {wantsValue && isTrades && (
        <>
          <label className={styles.label} htmlFor={`${id}-field`}>Of the trade's</label>
          <select id={`${id}-field`} className={styles.select} value={cfg.tradeField || ''}
            onChange={(e) => set({ tradeField: e.target.value || undefined, optionId: e.target.value === 'result' ? 'Win' : undefined })}>
            <option value="">Choose a trade number…</option>
            {tradeFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </>
      )}

      {wantsValue && !isTrades && cfg.source && (
        <>
          <label className={styles.label} htmlFor={`${id}-prop`}>Of the property</label>
          <select id={`${id}-prop`} className={styles.select} value={cfg.propertyId || ''}
            onChange={(e) => set({ propertyId: e.target.value || undefined, optionId: undefined })}>
            <option value="">Choose a property…</option>
            {readable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {!readable.length && <p className={styles.help}>Add a number or formula property first.</p>}
        </>
      )}

      {needsOption && (
        <>
          <label className={styles.label} htmlFor={`${id}-opt`}>Counts as a win</label>
          <select id={`${id}-opt`} className={styles.select} value={cfg.optionId || ''}
            onChange={(e) => set({ optionId: e.target.value || undefined })}>
            <option value="">Choose…</option>
            {isTrades
              ? TRADE_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)
              : (prop?.options || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </>
      )}

      {cfg.aggregate === 'win_rate' && !needsOption && (
        <p className={styles.help}>Win rate is the share of rows whose value is above 0.</p>
      )}
      <div className={styles.status} role="status" aria-live="polite">
        {cfg.source && cfg.aggregate ? describeRollup(cfg, defs, savedViews) : 'Choose what to summarise and how.'}
      </div>
    </div>
  )
}

/** Is a rollup config complete enough to send? (The server re-checks everything.) */
export function rollupReady(cfg) {
  if (!cfg?.source || !cfg?.aggregate) return false
  if (cfg.source === 'saved_view' && !cfg.savedViewId) return false
  if (cfg.aggregate === 'count') return true
  if (cfg.source === 'trades') return Boolean(cfg.tradeField) && (cfg.tradeField !== 'result' || Boolean(cfg.optionId))
  return Boolean(cfg.propertyId)
}
