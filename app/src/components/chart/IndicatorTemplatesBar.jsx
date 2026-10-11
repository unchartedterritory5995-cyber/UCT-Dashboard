// app/src/components/chart/IndicatorTemplatesBar.jsx
//
// ─── CHART SETTINGS → INDICATORS: "Indicator templates" ─────────────────────────
//
// FT-070 / COV-11. Save the indicators on this chart as a named template, and put a
// saved template's indicators on this chart in one click. Mounted at the foot of the
// Indicators column, beside "Add to Chart", because both answer the same question —
// "what goes on this chart" — and Chart Settings → Indicators is the one home for it.
//
// ⛔ BEHIND `VITE_INDICATOR_TEMPLATES_ENABLED` (default OFF). With the flag off this
// renders nothing, subscribes to nothing and writes nothing.
//
// ⛔ NO WRITER OF ITS OWN. The chart write is `applyIndicatorTemplate`'s result handed
// to Chart Settings' `onChange` (the surface's one persist path); the template list is
// written with `setPrefMerged` (never `setPref`: a list is a structured document, and a
// merged write cannot drop a template another tab saved a second ago).

import { useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../hooks/usePreferences'
import {
  indicatorTemplatesEnabled, captureIndicatorTemplate, applyIndicatorTemplate,
  parseIndicatorTemplates, withTemplateSaved, withoutTemplate, applySummary,
  TEMPLATE_NAME_MAX,
} from './builder/indicatorTemplates'
import styles from './ChartSettingsModal.module.css'

export default function IndicatorTemplatesBar(props) {
  if (!indicatorTemplatesEnabled()) return null
  return <IndicatorTemplatesBarInner {...props} />
}

function IndicatorTemplatesBarInner({ settings, onChange, registry }) {
  const { prefs, setPrefMerged } = usePreferences()
  const templates = useMemo(() => parseIndicatorTemplates(prefs?.indicator_templates), [prefs])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [status, setStatus] = useState(null)
  const inputRef = useRef(null)
  useEffect(() => { if (saving && inputRef.current) inputRef.current.focus() }, [saving])

  const save = async () => {
    const res = captureIndicatorTemplate(settings, registry, { name })
    if (!res.ok) {
      setStatus(res.reason === 'empty'
        ? 'There are no indicators on this chart to save.'
        : 'Give the template a name first.')
      return
    }
    const tpl = res.template
    try {
      await setPrefMerged('indicator_templates', (current) => withTemplateSaved(current, tpl))
      setStatus(`Saved “${tpl.name}” (${tpl.instances.length} indicator${tpl.instances.length === 1 ? '' : 's'}).`)
      setSaving(false); setName('')
    } catch {
      setStatus(`Couldn’t save “${tpl.name}”. Nothing was changed; try again.`)
    }
  }

  const apply = (tpl) => {
    const res = applyIndicatorTemplate(settings, tpl, registry)
    if (res.ok && res.changed) onChange?.(res.cs)
    setStatus(applySummary(tpl.name, res))
  }

  const remove = async (tpl) => {
    try {
      await setPrefMerged('indicator_templates', (current) => withoutTemplate(current, tpl.id))
      setStatus(`Deleted “${tpl.name}”.`)
    } catch {
      setStatus(`Couldn’t delete “${tpl.name}”. Try again.`)
    }
  }

  return (
    <div className={styles.indTplBox} data-testid="indicator-templates">
      <button
        type="button"
        className={styles.indTplToggle}
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setStatus(null) }}
      >
        Indicator templates{templates.length ? ` (${templates.length})` : ''} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className={styles.indTplPanel}>
          {templates.length === 0 && (
            <div className={styles.tplEmpty}>
              No indicator templates yet. Set up this chart’s indicators, then save them as a template.
            </div>
          )}
          {templates.length > 0 && (
            <ul className={styles.indTplList} aria-label="Saved indicator templates">
              {templates.map((t) => (
                <li key={t.id} className={styles.tplRow}>
                  <button
                    type="button"
                    className={styles.tplApply}
                    onClick={() => apply(t)}
                    title={`Add the indicators in “${t.name}” to this chart`}
                  >
                    {t.name}
                    <span className={styles.indTplCount}> · {t.instances.length}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.tplDelete}
                    onClick={() => remove(t)}
                    aria-label={`Delete indicator template ${t.name}`}
                    title="Delete template"
                  >✕</button>
                </li>
              ))}
            </ul>
          )}
          {saving ? (
            <div className={styles.tplSaveRow}>
              <input
                ref={inputRef}
                aria-label="Indicator template name"
                className={styles.tplInput}
                value={name}
                maxLength={TEMPLATE_NAME_MAX}
                placeholder="Template name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); save() }
                  else if (e.key === 'Escape') { e.preventDefault(); setSaving(false); setName('') }
                }}
              />
              <button type="button" className={styles.tplSaveBtn} onClick={save}>Save</button>
              <button type="button" className={styles.tplCancelBtn} onClick={() => { setSaving(false); setName('') }}>Cancel</button>
            </div>
          ) : (
            <button type="button" className={styles.tplSaveBtn} onClick={() => { setSaving(true); setStatus(null) }}>
              Save this chart’s indicators…
            </button>
          )}
          {status && <div className={styles.indTplStatus} role="status">{status}</div>}
        </div>
      )}
    </div>
  )
}
