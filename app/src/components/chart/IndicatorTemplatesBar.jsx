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
//
// ⛔ A WRITE IS REPORTED BY WHAT THE SERVER SAID. `setPrefMerged` never throws for a
// refused POST — it resolves `{ok: false}` (and `undefined` when the updater abandoned
// the write). So "Saved" / "Deleted" are said only on `{ok: true}`; anything else says
// the write did not land (pre-arm review, 2026-10-11).

import { useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../hooks/usePreferences'
import {
  indicatorTemplatesEnabled, captureIndicatorTemplate, applyIndicatorTemplate,
  parseIndicatorTemplates, planTemplateSave, withoutTemplate, applySummary,
  TEMPLATE_NAME_MAX, MAX_INDICATOR_TEMPLATES, MAX_TEMPLATE_INDICATORS,
} from './builder/indicatorTemplates'
import styles from './ChartSettingsModal.module.css'

export default function IndicatorTemplatesBar(props) {
  if (!indicatorTemplatesEnabled()) return null
  return <IndicatorTemplatesBarInner {...props} />
}

const landed = (answer) => !!answer && answer.ok === true

function IndicatorTemplatesBarInner({ settings, onChange, registry }) {
  const { prefs, setPrefMerged } = usePreferences()
  // keyed on the stored STRING: `prefs` is a fresh object every render
  const raw = prefs?.indicator_templates
  const templates = useMemo(() => parseIndicatorTemplates(raw), [raw])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [status, setStatus] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
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
    // The ceilings are judged INSIDE the merge, against the list as it stands at that
    // instant (another tab may have saved a second ago); a refusal abandons the write.
    let plan = null
    try {
      const answer = await setPrefMerged('indicator_templates', (current) => {
        plan = planTemplateSave(current, tpl)
        return plan.ok ? plan.list : undefined
      })
      if (plan && !plan.ok) {
        setStatus(plan.reason === 'full'
          ? `You have ${MAX_INDICATOR_TEMPLATES} indicator templates, the most there can be. Delete one to save “${tpl.name}”.`
          : `“${tpl.name}” is too large to save with your other templates. Delete a template, or save fewer indicators.`)
        return
      }
      if (!landed(answer)) {
        setStatus(`Couldn’t save “${tpl.name}”. Nothing was changed; try again.`)
        return
      }
      const n = tpl.instances.length
      const what = `${n} indicator${n === 1 ? '' : 's'}`
      const cut = res.omitted > 0 ? ` Only the first ${MAX_TEMPLATE_INDICATORS} were saved; ${res.omitted} more were left out.` : ''
      setStatus(plan && plan.replaced
        ? `Replaced “${tpl.name}” with this chart’s ${what}.${cut}`
        : `Saved “${tpl.name}” (${what}).${cut}`)
      setSaving(false); setName('')
    } catch {
      setStatus(`Couldn’t save “${tpl.name}”. Nothing was changed; try again.`)
    }
  }

  const apply = (tpl) => {
    setConfirmId(null)
    const res = applyIndicatorTemplate(settings, tpl, registry)
    if (res.ok && res.changed) onChange?.(res.cs)
    setStatus(applySummary(tpl.name, res))
  }

  const remove = async (tpl) => {
    setConfirmId(null)
    try {
      const answer = await setPrefMerged('indicator_templates', (current) => withoutTemplate(current, tpl.id))
      setStatus(landed(answer) ? `Deleted “${tpl.name}”.` : `Couldn’t delete “${tpl.name}”. Try again.`)
    } catch {
      setStatus(`Couldn’t delete “${tpl.name}”. Try again.`)
    }
  }

  const cancelNaming = () => { setSaving(false); setName('') }

  return (
    <div className={styles.indTplBox} data-testid="indicator-templates">
      <button
        type="button"
        className={styles.indTplToggle}
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setStatus(null); setConfirmId(null) }}
      >
        Indicator templates{templates.length ? ` (${templates.length})` : ''}
        <span aria-hidden="true"> {open ? '▴' : '▾'}</span>
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
                  {confirmId === t.id ? (
                    <div className={styles.indTplConfirm} role="group" aria-label={`Delete ${t.name}?`}>
                      <span className={styles.indTplConfirmText}>Delete “{t.name}”? This can’t be undone.</span>
                      <button
                        type="button"
                        className={styles.indTplDangerBtn}
                        onClick={() => remove(t)}
                        aria-label={`Delete “${t.name}”`}
                      >Delete</button>
                      <button
                        type="button"
                        className={styles.tplCancelBtn}
                        onClick={() => setConfirmId(null)}
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                      >Keep</button>
                    </div>
                  ) : (
                    <>
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
                        onClick={() => { setConfirmId(t.id); setStatus(null) }}
                        aria-label={`Delete indicator template ${t.name}`}
                        title="Delete template"
                      >✕</button>
                    </>
                  )}
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
                  else if (e.key === 'Escape') { e.preventDefault(); cancelNaming() }
                }}
              />
              <button type="button" className={styles.tplSaveBtn} onClick={save}>Save</button>
              <button type="button" className={styles.tplCancelBtn} onClick={cancelNaming}>Cancel</button>
            </div>
          ) : (
            <button type="button" className={styles.tplSaveBtn} onClick={() => { setSaving(true); setStatus(null) }}>
              Save this chart’s indicators…
            </button>
          )}
          <div className={styles.indTplStatus} role="status" aria-live="polite">{status || ''}</div>
        </div>
      )}
    </div>
  )
}
