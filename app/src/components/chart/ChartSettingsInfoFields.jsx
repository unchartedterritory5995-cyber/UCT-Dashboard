import { useMemo, useState } from 'react'
import {
  infoFieldsOf, addInfoField, removeInfoField, setInfoField,
  setInfoFieldBinding, moveInfoRowField,
} from './engine/infoFieldControls'
import {
  validateInfoFormula, INFO_FORMATS, INFO_FORMAT_LABEL, MAX_DECIMALS, MAX_LABEL,
} from './engine/infoFields'
import { formatInfoValue } from './engine/infoFormat'
import { sourceOptions, parseSource } from './engine/sourceRef'
import UIcon from '../ui/UIcon'
import styles from './ChartSettingsModal.module.css'

// ─── CUSTOM INFO-ROW FORMULAS ───────────────────────────────────────────────
//
// ⭐ THE THIRD CONSUMER, AND THE EDITOR SAYS SO IN THE UI'S OWN WORDS. A member
// picks a LABEL, a FORMULA, a FORMAT and some decimals; they never meet
// "numeric column", "binding key" or "consumer".
//
// ⭐⭐ AND THE FORMAT PREVIEW IS LIVE, ON A SAMPLE NUMBER. Formatting is the one
// thing here that is hard to predict from a dropdown — `Percent` on `0.0684` is
// `6.84%` and on `6.84` is `684.00%` — so the editor shows what the choice does
// rather than asking the member to guess and then look at the header.

/** The starters. ⛔ ADR IS THE PLATFORM'S OWN DEFINITION, not a new one:
 *  `api/services/screener/technicals.py` computes `adr_pct` as the mean of
 *  `(high − low) / close` over 21 sessions × 100, and `screener/identities.py`
 *  states that same sentence as the column's non-negativity proof. This spelling
 *  reproduces it bar for bar (`infoFields.test.js`).
 *
 *  ⚠️ `discord_chart_render.py` computes a THIRD thing — `(h/l − 1) × 100` over
 *  20 bars — which disagrees with both. Reported, not silently reconciled. */
const STARTERS = [
  {
    label: 'ADR',
    formula: 'sma((high - low) / close, 21) * 100',
    format: 'number', decimals: 2, suffix: '%',
    hint: 'The platform’s own ADR: mean of (high − low) / close over 21 sessions.',
  },
  {
    label: 'ADR 1W',
    formula: 'sma((high - low) / close, 5) * 100',
    format: 'number', decimals: 2, suffix: '%',
    hint: 'The same mean over a 5-session window (`adr_pct_1w`).',
  },
  {
    label: 'ATR%',
    formula: 'atr(high, low, close, 14) / close * 100',
    format: 'number', decimals: 2, suffix: '%',
    hint: 'Wilder’s true range as a percentage of price — not a second name for ADR.',
  },
  {
    label: 'RVOL',
    formula: 'volume / sma(volume, 30)',
    format: 'number', decimals: 2, suffix: 'x',
    hint: 'Today’s volume against its 30-bar mean.',
  },
  {
    label: 'EMA20 Dist',
    formula: '(close - ema(close, 20)) / ema(close, 20) * 100',
    format: 'number', decimals: 2, suffix: '%',
    hint: 'How far price sits from its 20-bar exponential average.',
  },
]

/** The number the preview formats. Chosen so every format reads differently. */
const SAMPLE = 0.0684

const BINDING_KEYS = ['a', 'b', 'c']

export default function ChartSettingsInfoFields({
  settings, onChange, registry = null, creating = false, onCreatingChange = null,
  onBuild = null,
}) {
  const list = useMemo(() => infoFieldsOf(settings), [settings])
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState({})

  const commit = (next) => { if (next !== settings) onChange?.(next) }

  const bindable = useMemo(() => {
    if (!registry || typeof registry.getDefinition !== 'function') return []
    try {
      return sourceOptions(settings, (id) => registry.getDefinition(id), '__info__')
        .filter((g) => g.label !== 'Price data')
    } catch { return [] }
  }, [settings, registry])

  /**
   * Why this field shows nothing — derived HERE, from the blob.
   *
   * ⭐ THE SAME ANSWER THE ENGINE REACHES, ASKED OF THE SAME DATA. A binding whose
   * instance is gone is unresolvable whoever asks; plumbing the binder's verdict
   * up through the modal would be a second authority arriving one render late.
   */
  const problemOf = (f) => {
    const instances = Array.isArray(settings?.indicatorInstances) ? settings.indicatorInstances : []
    for (const [key, ref] of Object.entries(f.bindings || {})) {
      const parsed = parseSource(ref)
      if (!parsed) return `Series ${key} cannot be read`
      if (parsed.kind !== 'instance') continue
      if (!instances.some((i) => i && i.instanceId === parsed.instanceId && !i.deleted)) {
        return 'Source unavailable'
      }
    }
    const check = validateInfoFormula(f.formula, f.bindings)
    return check.ok ? null : check.reason
  }

  const formulaValue = (f) => (draft[f.id] !== undefined ? draft[f.id] : f.formula)
  const formulaProblem = (f) => {
    const text = formulaValue(f)
    if (text === f.formula) return null
    const check = validateInfoFormula(text, f.bindings)
    return check.ok ? null : check.reason
  }

  const renderField = (f) => {
    const isOpen = openId === f.id
    const err = problemOf(f)
    const typing = formulaProblem(f)
    const set = (patch) => commit(setInfoField(settings, f.id, patch))
    return (
      <div
        key={f.id}
        className={`${styles.actBlock} ${isOpen ? styles.actBlockOpen : ''}`}
        data-info-field-id={f.id}
      >
        <div className={styles.actHead}>
          <button
            type="button"
            className={styles.actName}
            aria-expanded={isOpen}
            onClick={() => setOpenId(isOpen ? null : f.id)}
          >
            <span className={styles.actLabel}>{f.label}</span>
            <span className={styles.actBadge}>
              {err || formatInfoValue(SAMPLE, f.format, f.decimals, f.suffix)}
            </span>
          </button>
          <button
            type="button" className={styles.actRowRemove} aria-label={`Move ${f.label} left`}
            onClick={() => commit(moveInfoRowField(settings, f.id, -1))}
          >←</button>
          <button
            type="button" className={styles.actRowRemove} aria-label={`Move ${f.label} right`}
            onClick={() => commit(moveInfoRowField(settings, f.id, 1))}
          >→</button>
          <button
            type="button" className={styles.actRowRemove} aria-label={`Remove ${f.label}`}
            onClick={() => commit(removeInfoField(settings, f.id))}
          ><UIcon name="close" size={12} /></button>
        </div>

        {isOpen && (
          <>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Label</span>
              <input
                type="text" className={styles.indNum} style={{ width: 150 }} maxLength={MAX_LABEL}
                aria-label={`${f.label} label`}
                value={f.label}
                onChange={(e) => set({ label: e.target.value })}
              />
            </div>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Formula</span>
              <input
                type="text" className={styles.indNum} style={{ width: 260 }}
                aria-label={`${f.label} formula`}
                value={formulaValue(f)}
                onChange={(e) => {
                  const text = e.target.value
                  setDraft((d) => ({ ...d, [f.id]: text }))
                  commit(setInfoField(settings, f.id, { formula: text }))
                }}
              />
            </div>
            {typing && (
              <div className={styles.indRow}>
                <span className={styles.indLabel} />
                <span role="alert" style={{ fontSize: 11, opacity: 0.8 }}>{typing}</span>
              </div>
            )}

            {bindable.length > 0 && BINDING_KEYS.map((key, idx) => {
              const prev = idx === 0 ? true : !!f.bindings[BINDING_KEYS[idx - 1]]
              if (!prev) return null
              return (
                <div key={key} className={styles.indRow}>
                  <span className={styles.indLabel}>{`Series ${key}`}</span>
                  <select
                    className={styles.indSelect}
                    aria-label={`${f.label} series ${key}`}
                    value={f.bindings[key] || ''}
                    onChange={(e) => commit(setInfoFieldBinding(settings, f.id, key, e.target.value))}
                  >
                    <option value="">— none —</option>
                    {bindable.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )
            })}

            {/* ⭐ NONE OF THE FOUR ROWS BELOW RUNS ANY MATHS. They are what the
                number LOOKS like, and the engine's memo key does not contain
                them — which is why switching Percent → Number is instant. */}
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Format</span>
              <select
                className={styles.indSelect}
                aria-label={`${f.label} format`}
                value={f.format}
                onChange={(e) => set({ format: e.target.value })}
              >
                {INFO_FORMATS.map((x) => <option key={x} value={x}>{INFO_FORMAT_LABEL[x]}</option>)}
              </select>
            </div>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Decimals</span>
              <input
                type="number" className={styles.indNum} min={0} max={MAX_DECIMALS} step={1}
                aria-label={`${f.label} decimals`}
                value={f.decimals}
                onChange={(e) => set({ decimals: Number(e.target.value) })}
              />
            </div>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Suffix</span>
              <input
                type="text" className={styles.indNum} style={{ width: 60 }} maxLength={4}
                aria-label={`${f.label} suffix`}
                value={f.suffix}
                onChange={(e) => set({ suffix: e.target.value })}
              />
            </div>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Colour</span>
              <input
                type="text" className={styles.indNum} style={{ width: 92 }}
                aria-label={`${f.label} colour`}
                placeholder="default"
                value={f.color || ''}
                onChange={(e) => set({ color: e.target.value })}
              />
            </div>
            <div className={styles.indRow}>
              <span className={styles.indLabel}>Preview</span>
              <span style={{ fontSize: 11, opacity: 0.85 }}>
                {`${SAMPLE} → ${formatInfoValue(SAMPLE, f.format, f.decimals, f.suffix)}`}
              </span>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      {list.map(renderField)}

      {creating && (
        <div className={styles.card} data-info-create>
          <div className={styles.indRow}>
            <span className={styles.indLabel}>Start from</span>
            <span style={{ fontSize: 11, opacity: 0.75 }}>
              A formula field shows one number from this chart’s own bars.
            </span>
          </div>
          {STARTERS.map((s) => (
            <div key={s.label} className={styles.indRow}>
              <span className={styles.indLabel}>{s.label}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, opacity: 0.7 }}>{s.hint}</span>
                <button
                  type="button"
                  className={styles.chip}
                  aria-label={`Add ${s.label} info field`}
                  onClick={() => {
                    commit(addInfoField(settings, s))
                    onCreatingChange?.(false)
                  }}
                >＋ Add</button>
              </span>
            </div>
          ))}
          <div className={styles.indRow}>
            <span className={styles.indLabel} />
            <span style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={styles.chip}
                aria-label="Add blank info field"
                onClick={() => {
                  commit(addInfoField(settings, { label: 'Value', formula: 'close' }))
                  onCreatingChange?.(false)
                }}
              >Blank</button>
              {/* ⭐⭐ THE UNIFIED BUILDER, OPENED FOR AN INFO VALUE. The same shell an
                  indicator and a condition are authored through — plain English, the
                  Library, the criteria picker, imports, a screenshot, the formula box
                  — refusing a boolean tree here for the reason it refuses a numeric
                  one there: an info field shows a NUMBER. */}
              {onBuild && (
                <button
                  type="button"
                  className={styles.chip}
                  aria-label="Build an info value"
                  onClick={() => { onBuild({}); onCreatingChange?.(false) }}
                >⊕ Build…</button>
              )}
            </span>
          </div>
        </div>
      )}
    </>
  )
}
