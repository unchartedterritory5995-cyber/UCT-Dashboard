/**
 * SizeDrill — type 3 (spec §4.3, §4.11 house sizing rule, §13.7 D8).
 *
 * Forward variant: account, risk %, entry, stop are given; the member types
 * shares and dollars at risk. Reverse variant: account, entry, stop and shares
 * are given; the member types the dollars at risk (and the risk %).
 *
 * prompt_json: { question, variant: 'forward' | 'reverse',
 *                account, risk_pct, entry, stop, shares?, facts?: [{label, value}] }
 * Answer (forward): {shares, dollars, risk_dollars}  — `dollars` mirrors the
 *   dollars-at-risk field so study_scoring.score_size reads it; `risk_dollars`
 *   is carried for a key that names it that way.
 * Answer (reverse): {dollars, risk_dollars, risk_pct?}
 *
 * Numeric inputs are real inputs at 16px with inputmode="decimal" and the
 * visualViewport guard, so the Check button is never under the iOS keyboard.
 */
import { useEffect, useRef } from 'react'
import styles from './drills.module.css'

export function variantOf(item) {
  const p = item?.prompt_json || {}
  if (p.variant) return p.variant
  return p.shares != null ? 'reverse' : 'forward'
}

const money = (v) => (v == null || v === '' ? '' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
const pct = (v) => (v == null || v === '' ? '' : `${Number(v)}%`)

function factsFor(item) {
  const p = item?.prompt_json || {}
  if (Array.isArray(p.facts) && p.facts.length) return p.facts
  const rows = []
  if (p.account != null) rows.push({ label: 'Account', value: money(p.account) })
  if (variantOf(item) === 'forward' && p.risk_pct != null) rows.push({ label: 'Risk per trade', value: pct(p.risk_pct) })
  if (p.entry != null) rows.push({ label: 'Entry', value: money(p.entry) })
  if (p.stop != null) rows.push({ label: 'Stop', value: money(p.stop) })
  if (variantOf(item) === 'reverse' && p.shares != null) rows.push({ label: 'Shares', value: String(p.shares) })
  return rows
}

function useVisualViewportGuard(refs) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return undefined
    const onResize = () => {
      const el = refs.current.find((r) => r && document.activeElement === r)
      if (!el) return
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* jsdom */ }
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [refs])
}

const clean = (s) => String(s ?? '').replace(/[^0-9.]/g, '')

function NumberField({ label, prefix, suffix, value, onChange, disabled, inputRef, name }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.inputWrap}>
        {prefix && <span className={styles.inputPrefix}>{prefix}</span>}
        <input
          ref={inputRef}
          name={name}
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={value ?? ''}
          onChange={(e) => onChange(clean(e.target.value))}
          aria-label={label}
        />
        {suffix && <span className={styles.inputSuffix}>{suffix}</span>}
      </span>
    </label>
  )
}

export function Body({ item, state, setState, locked }) {
  const variant = variantOf(item)
  const refs = useRef([])
  useVisualViewportGuard(refs)
  const s = state || {}
  const set = (k) => (v) => setState({ ...s, [k]: v })
  return (
    <div>
      <dl className={styles.facts}>
        {factsFor(item).map((f, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.fields}>
        {variant === 'forward' && (
          <NumberField
            label="Shares"
            name="shares"
            value={s.shares}
            onChange={set('shares')}
            disabled={locked}
            inputRef={(el) => { refs.current[0] = el }}
          />
        )}
        <NumberField
          label="Dollars at risk"
          name="risk_dollars"
          prefix="$"
          value={s.risk_dollars}
          onChange={set('risk_dollars')}
          disabled={locked}
          inputRef={(el) => { refs.current[1] = el }}
        />
        {variant === 'reverse' && (
          <NumberField
            label="Risk as a percent of the account"
            name="risk_pct"
            suffix="%"
            value={s.risk_pct}
            onChange={set('risk_pct')}
            disabled={locked}
            inputRef={(el) => { refs.current[2] = el }}
          />
        )}
      </div>
      <p className={styles.hint}>Whole shares. Round the dollars to the nearest dollar.</p>
    </div>
  )
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null }

export function answerFromState(state, item) {
  const variant = variantOf(item)
  const risk = num(state?.risk_dollars)
  const out = { dollars: risk, risk_dollars: risk }
  if (variant === 'forward') out.shares = num(state?.shares)
  else {
    out.shares = num(item?.prompt_json?.shares)
    const rp = num(state?.risk_pct)
    if (rp != null) out.risk_pct = rp
  }
  return out
}

export function isAnswerable(state, item) {
  const variant = variantOf(item)
  if (num(state?.risk_dollars) == null) return false
  if (variant === 'forward') return num(state?.shares) != null
  return true
}

export default { Body, answerFromState, isAnswerable }
