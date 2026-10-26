import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Switch from '../../../../../components/ui/Switch'
import { importDayRules, starters as readStarters } from '../../../lib/toolsCrud'
import { localTimeBeside } from '../../../lib/blocks/toolDays'
import ToolEditor from './ToolEditor'
import {
  CHECK, COPY, DONE_SHARES, ITEMS_MAX, REMINDER_TIMES, SCHEDULES, SUGGEST_RULES, WEEKDAYS, blankItem, blankRoutine,
  checkRoutine, routineBody, routineDraft, ruleOf, scheduleWords, starterDraft, suggestWords, timeLabel,
} from './toolEditorLib'
import styles from './routines.module.css'

/**
 * The routine editor (spec 6.1, Task 9.16): ONE Sheet with the name, the items (add, reorder, rename, remove, at most
 * 25; each with "Counts when it didn't happen" and an optional "Suggest from my trades"), "Start from" one of the
 * ready-made routines (new routines only), "Import my day rules", when it runs, how much counts as done, strict mode,
 * and one reminder, OFF by default, through the alert bell only.
 *
 * Opened by `openRoutineEditor` (its own root). `routineId` edits a routine; none makes a new one, from `starter`
 * (a ready-made routine's key) when given. `zone` and `now` are test seams for the reminder's "your time" line (default:
 * the browser's zone and clock), so a test never reads the wall clock.
 */
export const ROUTINE_SPEC = Object.freeze({
  kind: 'routine',
  titles: { new: COPY.newRoutine, edit: COPY.editRoutine, view: 'Routine' },
  archivedText: COPY.archivedRoutine,
  blank: blankRoutine,
  fromTool: routineDraft,
  body: (d) => routineBody(d),
  check: checkRoutine,
})

export default function RoutineEditorSheet({ routineId = null, starter = null, zone, now, ...rest }) {
  return (
    <ToolEditor spec={ROUTINE_SPEC} toolId={routineId} {...rest}
      renderForm={(p) => <RoutineForm {...p} starter={starter} zone={zone} now={now} />}
      renderSummary={(tool) => <RoutineSummary tool={tool} />} />
  )
}

function RoutineSummary({ tool }) {
  const items = Array.isArray(tool.items) ? tool.items : []
  const share = DONE_SHARES.find(([v]) => v === tool.settings?.done_share)?.[1] || DONE_SHARES[0][1]
  return (
    <div className={styles.summary}>
      <p className={styles.summaryName}>{tool.name}</p>
      <ul className={styles.summaryList}>
        {items.map((it) => <li key={it.id || it.text}>{it.text}</li>)}
      </ul>
      <p className={styles.hint}>{`${scheduleWords(tool)} · Counts as done with ${share.toLowerCase()}`}</p>
    </div>
  )
}

/** The day rules after what is there: blank items go, a label already present (any case) is skipped, and nothing
 *  goes past 25 items. `added` and `over` (labels that did not fit) are for the sentence. */
function mergeLabels(items, labels) {
  const kept = items.filter((it) => it.text.trim())
  const have = new Set(kept.map((it) => it.text.trim().toLowerCase()))
  const next = [...kept]
  let added = 0
  let over = 0
  for (const l of labels) {
    const k = l.trim().toLowerCase()
    if (have.has(k)) continue
    have.add(k)
    if (next.length >= ITEMS_MAX) { over += 1; continue }
    next.push(blankItem(l.trim()))
    added += 1
  }
  return { items: next.length ? next : [blankItem()], added, over }
}

/** Field error line and the props that tie it to its control. */
function errProps(e) {
  return e ? { 'aria-invalid': true, 'aria-describedby': e.id } : {}
}
function ErrorLine({ e }) {
  return e ? <p className={styles.fieldError} id={e.id}>{e.text}</p> : null
}

function RoutineForm({ draft, setDraft, error, mode, say, rebase, starter, zone, now }) {
  const id = useId()
  const isNew = mode === 'new'

  // ── the ready-made routines (new routines only) ─────────────────────────────────────────────
  const [starters, setStarters] = useState(null)
  const appliedKey = useRef(null)
  const blankKey = useMemo(() => JSON.stringify(routineBody(blankRoutine())), [])
  const [appliedBody, setAppliedBody] = useState(null)
  useEffect(() => {
    if (!isNew) return undefined
    let alive = true
    readStarters().then((got) => {
      if (!alive) return
      if (!got.ok) {
        if (starter) say("The ready-made routine couldn't load. You can start from a blank one.")
        return
      }
      setStarters(got.data)
      const asked = starter ? got.data.find((s) => s.key === starter) : null
      if (asked) {
        const d = starterDraft(blankRoutine(), asked)
        appliedKey.current = asked.key
        setAppliedBody(JSON.stringify(routineBody(d)))
        rebase(d)
      }
    })
    return () => { alive = false }
  }, [])                                                       // eslint-disable-line react-hooks/exhaustive-deps
  const bodyKey = JSON.stringify(routineBody(draft))
  const pristine = bodyKey === blankKey || bodyKey === appliedBody
  const startFrom = (s) => {
    const d = starterDraft(draft, s)
    appliedKey.current = s.key
    setAppliedBody(JSON.stringify(routineBody(d)))
    setDraft(d)
  }

  // ── items ──────────────────────────────────────────────────────────────────────────────────
  const formRef = useRef(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const focusAfter = useRef(null)
  useEffect(() => {
    const want = focusAfter.current
    if (!want) return
    focusAfter.current = null
    formRef.current?.querySelector(want)?.focus?.()
  })
  const items = draft.items
  const full = items.length >= ITEMS_MAX
  const setItem = (key, patch) => setDraft((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }))
  const add = () => {
    if (full) return
    const it = blankItem()
    setDraft((d) => (d.items.length >= ITEMS_MAX ? d : { ...d, items: [...d.items, it] }))
    focusAfter.current = `[data-item-key="${it.key}"] input`
  }
  const move = (i, by) => {
    const j = i + by
    if (j < 0 || j >= items.length) return
    const key = items[i].key
    setDraft((d) => {
      const next = [...d.items]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...d, items: next }
    })
    focusAfter.current = `[data-item-key="${key}"] [data-move="${by < 0 ? 'up' : 'down'}"]`
  }
  const remove = (i) => {
    const after = items[i + 1] || items[i - 1]
    setDraft((d) => {
      const next = d.items.filter((_, k) => k !== i)
      return { ...d, items: next.length ? next : [blankItem()] }
    })
    focusAfter.current = after ? `[data-item-key="${after.key}"] input` : '[data-item-key] input'
  }

  // ── Import my day rules ─────────────────────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false)
  const importingRef = useRef(false)
  const importRules = async () => {
    if (importingRef.current) return
    importingRef.current = true
    setImporting(true)
    const got = await importDayRules()
    importingRef.current = false
    setImporting(false)
    if (!got.ok) { say(got.message); return }
    const labels = got.data.filter((l) => typeof l === 'string' && l.trim())
    if (!labels.length) { say(COPY.importNone); return }
    const { added, over } = mergeLabels(draftRef.current.items, labels)
    if (!added) { say(over ? CHECK.tooMany : 'Your day rules are already in this routine.'); return }
    setDraft((d) => ({ ...d, items: mergeLabels(d.items, labels).items }))
    const said = `Added ${added} rule${added === 1 ? '' : 's'} from your day notes.`
    say(over ? `${said} ${CHECK.tooMany}` : said)
  }

  // ── the rest ────────────────────────────────────────────────────────────────────────────────
  const errName = error('name')
  const errItems = error('items')
  const errSchedule = error('schedule')
  const errShare = error('doneShare')
  const errReminder = error('reminder')
  const toggleDay = (v) => setDraft((d) => ({ ...d, days: d.days.includes(v) ? d.days.filter((x) => x !== v) : [...d.days, v].sort() }))

  return (
    <div className={styles.form} ref={formRef}>
      {isNew && starters && starters.length > 0 && pristine && (
        <div className={styles.field}>
          <span className={styles.fieldLabel} id={`${id}-start`}>Start from</span>
          <div className={styles.chips} role="group" aria-labelledby={`${id}-start`}>
            {starters.map((s) => (
              <button key={s.key} type="button" className={styles.chip} aria-pressed={appliedKey.current === s.key && bodyKey === appliedBody}
                onClick={() => startFrom(s)}>{s.name}</button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.field} data-field-box="">
        <label className={styles.fieldLabel} htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} className={styles.input} value={draft.name} data-field="name" autoComplete="off"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} {...errProps(errName)} />
        <ErrorLine e={errName} />
      </div>

      <fieldset className={styles.fieldset} data-field-box="">
        <legend className={styles.legend}>Items</legend>
        <ol className={styles.items}>
          {items.map((it, i) => {
            const n = i + 1
            const rule = ruleOf(it.suggest?.rule)
            const negId = `${id}-neg-${it.key}`
            const sugId = `${id}-sug-${it.key}`
            const nId = `${id}-n-${it.key}`
            return (
              <li key={it.key} className={styles.item} data-item-key={it.key}>
                <div className={styles.itemMain}>
                  <input className={styles.input} aria-label={`Item ${n}`} value={it.text} autoComplete="off"
                    data-field={i === 0 ? 'items' : undefined} {...errProps(errItems)}
                    onChange={(e) => setItem(it.key, { text: e.target.value })} />
                  <div className={styles.itemMoves}>
                    <button type="button" className={styles.iconBtn} data-move="up" aria-label={`Move item ${n} up`}
                      aria-disabled={i === 0 || undefined} onClick={() => move(i, -1)}>
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button type="button" className={styles.iconBtn} data-move="down" aria-label={`Move item ${n} down`}
                      aria-disabled={i === items.length - 1 || undefined} onClick={() => move(i, 1)}>
                      <span aria-hidden="true">↓</span>
                    </button>
                    <button type="button" className={styles.iconBtn} aria-label={`Remove item ${n}`} onClick={() => remove(i)}>
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                </div>
                <div className={styles.itemOpts}>
                  <div className={styles.switchRow}>
                    <Switch checked={it.negative} aria-labelledby={negId} className={styles.switch}
                      checkedClassName={styles.switchOn} knobClassName={styles.knob}
                      onClick={() => setItem(it.key, { negative: !it.negative })} />
                    <span id={negId} className={styles.switchLabel}>Counts when it didn't happen</span>
                  </div>
                  <div className={styles.inline}>
                    <label className={styles.smallLabel} htmlFor={sugId}>Suggest from my trades</label>
                    <select id={sugId} className={styles.select} value={it.suggest?.rule || ''}
                      onChange={(e) => {
                        const r = ruleOf(e.target.value)
                        setItem(it.key, { suggest: r ? (r.n ? { rule: r.rule, n: r.n.def } : { rule: r.rule }) : null })
                      }}>
                      <option value="">Off</option>
                      {SUGGEST_RULES.map((r) => <option key={r.rule} value={r.rule}>{r.label}</option>)}
                    </select>
                    {rule?.n && (
                      <>
                        <label className={styles.smallLabel} htmlFor={nId}>{rule.n.label}</label>
                        <select id={nId} className={styles.select} value={String(it.suggest.n ?? rule.n.def)}
                          onChange={(e) => setItem(it.key, { suggest: { rule: rule.rule, n: Number(e.target.value) } })}>
                          {[...new Set([...rule.n.choices, it.suggest.n ?? rule.n.def])].sort((a, b) => a - b)
                            .map((v) => <option key={v} value={String(v)}>{v}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                  {rule && (
                    <p className={styles.hint}>{`From your trades it suggests a tick when: ${suggestWords(it.suggest)}. You still tick it.`}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
        <ErrorLine e={errItems} />
        <div className={styles.actions}>
          <button type="button" className={styles.btn} data-add="" onClick={add} aria-disabled={full || undefined}
            aria-describedby={full ? `${id}-full` : undefined}>Add an item</button>
          <button type="button" className={styles.btn} onClick={importRules} aria-disabled={importing || undefined}
            aria-busy={importing || undefined}>Import my day rules</button>
        </div>
        {full && <p className={styles.hint} id={`${id}-full`}>{CHECK.tooMany}</p>}
      </fieldset>

      <fieldset className={styles.fieldset} data-field-box="">
        <legend className={styles.legend}>When it runs</legend>
        <div className={styles.radios}>
          {SCHEDULES.map(([k, label]) => (
            <label key={k} className={styles.radioRow}>
              <input type="radio" name={`${id}-sched`} value={k} checked={draft.schedule === k}
                data-field={draft.schedule === k ? 'schedule' : undefined} {...(draft.schedule === k ? errProps(errSchedule) : {})}
                onChange={() => setDraft((d) => ({ ...d, schedule: k }))} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {draft.schedule === 'weekdays' && (
          <div className={styles.days} role="group" aria-label="Weekdays">
            {WEEKDAYS.map(([v, label]) => (
              <button key={v} type="button" className={styles.day} aria-pressed={draft.days.includes(v)}
                onClick={() => toggleDay(v)}>{label}</button>
            ))}
          </div>
        )}
        <ErrorLine e={errSchedule} />
      </fieldset>

      <div className={styles.field} data-field-box="">
        <label className={styles.fieldLabel} htmlFor={`${id}-share`}>Counts as done with</label>
        <select id={`${id}-share`} className={styles.select} value={String(draft.doneShare)} data-field="doneShare"
          onChange={(e) => setDraft((d) => ({ ...d, doneShare: Number(e.target.value) }))} {...errProps(errShare)}>
          {DONE_SHARES.map(([v, label]) => <option key={v} value={String(v)}>{label}</option>)}
        </select>
        <ErrorLine e={errShare} />
      </div>

      <div className={styles.switchRow}>
        <Switch checked={draft.strict} aria-labelledby={`${id}-strict`} className={styles.switch}
          checkedClassName={styles.switchOn} knobClassName={styles.knob}
          onClick={() => setDraft((d) => ({ ...d, strict: !d.strict }))} />
        <span id={`${id}-strict`} className={styles.switchLabel}>Count skipped days as not done</span>
      </div>

      <div className={styles.field} data-field-box="">
        <div className={styles.switchRow}>
          <Switch checked={draft.reminderOn} aria-labelledby={`${id}-remind`} className={styles.switch}
            checkedClassName={styles.switchOn} knobClassName={styles.knob} data-field="reminder" {...errProps(errReminder)}
            onClick={() => setDraft((d) => ({ ...d, reminderOn: !d.reminderOn }))} />
          <span id={`${id}-remind`} className={styles.switchLabel}>Remind me</span>
        </div>
        {draft.reminderOn && (
          <div className={styles.reminder}>
            <label className={styles.smallLabel} htmlFor={`${id}-time`}>Reminder time (ET)</label>
            <select id={`${id}-time`} className={styles.select} value={draft.reminderTime}
              aria-describedby={`${id}-local ${id}-bell`}
              onChange={(e) => setDraft((d) => ({ ...d, reminderTime: e.target.value }))}>
              {REMINDER_TIMES.map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
            </select>
            <p className={styles.sentence} id={`${id}-local`}>{localTimeBeside(timeLabel(draft.reminderTime), now instanceof Date ? now : new Date(), zone)}</p>
            <p className={styles.hint} id={`${id}-bell`}>{COPY.remindLine}</p>
          </div>
        )}
        <ErrorLine e={errReminder} />
      </div>
    </div>
  )
}
