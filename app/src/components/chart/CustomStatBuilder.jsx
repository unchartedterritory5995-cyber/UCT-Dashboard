// Chart Settings → Header & legend → Info row stats → "+ Custom stat" (owner 11-16): "add a button where users can
// display custom data points in the header, not just stuff in the list".
//
// An inline page inside the stat picker (no portal, no global modal). Two steps:
//   1. choose an indicator: search, a few quick picks, then every indicator that can be a header stat, grouped like
//      the indicator library, the member's own saved formulas first ("My indicators");
//   2. set it up: the output (when it has several), its calculation inputs (period, type, source, …; never colors or
//      line styles, which do not change the value), a preview of the name, then "Add to header".
// What is offered and how it is computed is engine/customStatCompute.js's (only outputs that are one number per bar
// on this chart's own bars). This file draws and calls back; the write is headerCustomStats.addCustomStatPatch.
// Lazy-loaded by HeaderStatPicker, so none of it ships until a member opens it.
// UCT Signature: grey/white, sentence case, one primary ("Add to header", a soft button, no gold).
import { useMemo, useState } from 'react'
import UIcon from '../ui/UIcon'
import ChoiceMenu from './ChoiceMenu'
import * as engineRegistry from './engine/nativeRegistry'
import { customStatChoices, customStatOutputs, customStatLabel, sanitizeStatInputs } from './engine/customStatCompute'
import { fieldsForInstance } from './indicatorRegistry'
import { SOURCE_BAR_FIELDS } from './engine/defSchema'

const SOURCE_LABELS = { open: 'Open', high: 'High', low: 'Low', close: 'Close', hl2: 'HL2', hlc3: 'HLC3', ohlc4: 'OHLC4', volume: 'Volume' }

// A few common starting points; each opens step 2 already filled in (the member can still change anything).
const QUICK_PICKS = [
  { defId: 'movingAverage', plotKey: 'ma', inputs: { maType: 'ema', period: 21 }, label: 'EMA 21' },
  { defId: 'movingAverage', plotKey: 'ma', inputs: { maType: 'sma', period: 50 }, label: 'SMA 50' },
  { defId: 'rsi', plotKey: 'rsi', inputs: { period: 14 }, label: 'RSI 14' },
  { defId: 'atr', plotKey: 'atr', inputs: { period: 14 }, label: 'ATR 14' },
  { defId: 'atrPercent', plotKey: 'atrPct', inputs: { period: 14 }, label: 'ATR % 14' },
  { defId: 'percentFromMa', plotKey: 'pct', inputs: { period: 50, maType: 'sma' }, label: '% from 50-day MA' },
  { defId: 'adrPercent', plotKey: 'adrPct', inputs: { period: 20 }, label: 'ADR % 20' },
  { defId: 'relativeVolume', plotKey: 'rvol', inputs: { period: 50 }, label: 'Relative volume 50' },
]

/** The calculation inputs step 2 offers for `def`: numbers, choices, on/off and a bar-field source. */
function calcFieldsOf(def) {
  let f
  try { f = fieldsForInstance(def, { inputs: {} }) } catch { return [] }
  return (f.inputs || []).filter((x) => x && ['number', 'select', 'toggle', 'source'].includes(x.type))
}

function NumberField({ styles, field, value, onChange }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const n = Number(draft)
  const bad = draft.trim() === '' || !Number.isFinite(n) || (field.isInt && !Number.isInteger(n))
    || (field.min != null && n < field.min) || (field.max != null && n > field.max)
  const range = field.min != null && field.max != null ? `${field.min} to ${field.max}` : null
  return (
    <span className={styles.csNumWrap}>
      <input
        type="number"
        inputMode={field.isInt ? 'numeric' : 'decimal'}
        className={styles.csNum}
        aria-label={field.label}
        aria-invalid={bad || undefined}
        value={draft}
        min={field.min} max={field.max} step={field.step}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          const v = Number(raw)
          const ok = raw.trim() !== '' && Number.isFinite(v) && (!field.isInt || Number.isInteger(v))
            && (field.min == null || v >= field.min) && (field.max == null || v <= field.max)
          onChange(ok ? v : undefined, !ok)
        }}
      />
      {bad && range && <span className={styles.csHint}>{range}</span>}
    </span>
  )
}

export default function CustomStatBuilder({ styles, addRefusal, onAdd, onCancel }) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)   // { defId, plotKey, inputs }
  const [invalid, setInvalid] = useState({})
  const choices = useMemo(() => customStatChoices(engineRegistry), [])
  const byId = useMemo(() => new Map(choices.map((c) => [c.defId, c])), [choices])
  const quick = useMemo(() => QUICK_PICKS.filter((p) => byId.get(p.defId)?.outputs.some((o) => o.key === p.plotKey)), [byId])

  const query = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const list = query ? choices.filter((c) => `${c.name} ${c.category}`.toLowerCase().includes(query)) : choices
    const out = []
    for (const c of list) {
      const g = c.mine ? 'My indicators' : c.category
      let at = out.find((x) => x.label === g)
      if (!at) { at = { label: g, items: [] }; out.push(at) }
      at.items.push(c)
    }
    return out
  }, [choices, query])

  const open = (defId, plotKey, inputs) => {
    const c = byId.get(defId)
    if (!c) return
    setInvalid({})
    setPick({ defId, plotKey: plotKey && c.outputs.some((o) => o.key === plotKey) ? plotKey : c.outputs[0].key, inputs: inputs || {} })
  }

  const head = (title, back) => (
    <div className={styles.statPickHead}>
      <button type="button" className={styles.statBack} onClick={back} aria-label={back === onCancel ? 'Back to Info row stats' : 'Back to all indicators'}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
        {back === onCancel ? 'Info row stats' : 'All indicators'}
      </button>
      <span className={styles.statPickTitle}>{title}</span>
    </div>
  )

  // ── step 1: choose an indicator ──
  if (!pick) {
    return (
      <section className={styles.statPicker} aria-label="Custom stat">
        {head('Custom stat', onCancel)}
        <div className={styles.csIntro}>Show an indicator&apos;s value on the newest bar beside the ticker, with the settings you choose.</div>
        <label className={styles.fieldFind}>
          <UIcon name="search" size={13} gold={false} aria-hidden="true" />
          <input
            aria-label="Find an indicator"
            className={styles.fieldSearch}
            placeholder="Find an indicator…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ('') } }}
            autoFocus
          />
        </label>
        <div className={styles.statPickList}>
          {!query && quick.length > 0 && (
            <div role="group" aria-label="Quick picks">
              <div className={styles.statGroupLabel}>Quick picks</div>
              <div className={styles.csChips}>
                {quick.map((p) => (
                  <button key={p.label} type="button" className={styles.csChip} onClick={() => open(p.defId, p.plotKey, p.inputs)}>{p.label}</button>
                ))}
              </div>
            </div>
          )}
          {groups.length ? groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <div className={styles.statGroupLabel}>{g.label}</div>
              <div className={`${styles.card} ${styles.statPickCard}`}>
                {g.items.map((c) => (
                  <button key={c.defId} type="button" data-custom-def={c.defId} className={`${styles.softItem} ${styles.statPickItem} ${styles.csDefItem}`} onClick={() => open(c.defId)}>
                    <span className={styles.statPickLabel}>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )) : (
            <div className={styles.statEmpty}>No indicator matches “{q.trim()}”. Try average, RSI, ATR or volume.</div>
          )}
        </div>
        <div className={styles.statPickFoot}>
          <span style={{ flex: 1 }} />
          <button type="button" className={styles.statFootBtn} onClick={onCancel}>Cancel</button>
        </div>
      </section>
    )
  }

  // ── step 2: set it up ──
  const def = engineRegistry.getDefinition(pick.defId)
  const choice = byId.get(pick.defId)
  const outputs = def ? customStatOutputs(def, engineRegistry) : []
  const fields = def ? calcFieldsOf(def) : []
  const values = def ? { ...fieldsForInstance(def, { inputs: {} }).values, ...pick.inputs } : {}
  const entry = def ? {
    defId: pick.defId, plotKey: pick.plotKey, inputs: sanitizeStatInputs(def, pick.inputs),
  } : null
  const names = def && entry ? customStatLabel(def, entry) : null
  if (entry && names) entry.name = names.label
  const hasInvalid = Object.values(invalid).some(Boolean)
  const refusal = !def ? 'This indicator is no longer available.' : (hasInvalid ? null : (addRefusal ? addRefusal(entry) : null))
  const setInput = (key, v, bad) => {
    setInvalid((m) => ({ ...m, [key]: !!bad }))
    setPick((p) => {
      const inputs = { ...p.inputs }
      if (v === undefined) delete inputs[key]
      else inputs[key] = v
      return { ...p, inputs }
    })
  }

  return (
    <section className={styles.statPicker} aria-label="Custom stat">
      {head(choice ? choice.name : 'Custom stat', () => setPick(null))}
      <div className={styles.card}>
        {outputs.length > 1 && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Value</span>
            <ChoiceMenu ariaLabel="Value" value={pick.plotKey}
              options={outputs.map((o) => ({ value: o.key, label: o.label }))}
              onChange={(v) => setPick((p) => ({ ...p, plotKey: v }))} />
          </div>
        )}
        {fields.map((f) => (
          <div className={styles.field} key={f.key}>
            <span className={styles.fieldLabel}>{f.label}</span>
            {f.type === 'number' && (
              <NumberField key={`${pick.defId}:${f.key}`} styles={styles} field={f} value={values[f.key]} onChange={(v, bad) => setInput(f.key, v, bad)} />
            )}
            {f.type === 'select' && (
              <ChoiceMenu ariaLabel={f.label} value={values[f.key]}
                options={(f.options || []).filter((o) => !(o[2] && o[2].disabled)).map(([v, l]) => ({ value: v, label: l }))}
                onChange={(v) => {
                  const opt = (f.options || []).find(([ov]) => String(ov) === String(v))
                  setInput(f.key, opt ? opt[0] : v)
                }} />
            )}
            {f.type === 'source' && (
              <ChoiceMenu ariaLabel={f.label} value={SOURCE_BAR_FIELDS.includes(values[f.key]) ? values[f.key] : 'close'}
                options={SOURCE_BAR_FIELDS.map((v) => ({ value: v, label: SOURCE_LABELS[v] || v }))}
                onChange={(v) => setInput(f.key, v)} />
            )}
            {f.type === 'toggle' && (
              <button type="button" role="checkbox" aria-checked={!!values[f.key]} aria-label={f.label}
                className={styles.softItem} onClick={() => setInput(f.key, !values[f.key])}>
                <span className={`${styles.softBox} ${values[f.key] ? styles.softBoxOn : ''}`} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {!fields.length && outputs.length <= 1 && (
          <div className={styles.field}><span className={styles.fieldLabel}>No settings to choose</span></div>
        )}
      </div>
      <div className={styles.statDesc} aria-live="polite">
        {hasInvalid ? 'Fix the highlighted setting to add this stat.'
          : refusal ? refusal
            : names ? (<>Shows as <b>{names.label}</b> · its value on the newest bar of this chart</>) : null}
      </div>
      <div className={styles.statPickFoot}>
        <button type="button" className={styles.statFootBtn} onClick={onCancel}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button type="button" className={styles.addFieldBtn} disabled={!!refusal || hasInvalid || !entry}
          onClick={() => { if (entry && !refusal && !hasInvalid) onAdd(entry) }}>
          <UIcon name="plus" size={12} gold={false} aria-hidden="true" />Add to header
        </button>
      </div>
    </section>
  )
}
