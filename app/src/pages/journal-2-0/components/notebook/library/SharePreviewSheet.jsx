// Notebook widgets phase 2, wave 11 (Task 11.15): the share preview.
//
// Before a widget, routine, tracker or template goes to the library, the author sees exactly what will travel. The
// SERVER builds that (`template_gallery.share_preview` over the ONE reducer, `widget_engine/share.py`, ruling W11-R1):
// every member value becomes a "pick yours" choice, and the only member text that travels is what the author types
// here (`edits`), with numbers only where the author turns their switch on (`keep`, ruling W11-R6). The server
// PREFILLS the author's own name, description, field names, routine items, tracker name and unit, so leaving a field
// as it is shares it, and clearing or unticking it keeps it home.
//
// ⛔ This sheet never builds the payload. "Exactly what travels" renders the server's `travels`, nothing else; the
//    fields only say what to ASK for. Every edit re-asks the server, 600 ms after the last keystroke, with at most one
//    request in flight (a newer edit waits for the answer, then asks once with the latest fields). Send is offered only
//    while the answer on screen is the answer for the fields on screen.
// ⛔ An unticked routine item is sent as '' AT ITS PLACE, never removed from the list: the server pairs each typed
//    item with the stored item at the same index (its "counts when it didn't happen" flag and suggestion), so dropping
//    one would hand the next item the wrong settings.
// ⛔ Server refusals are shown in the server's own words. `own_words` and `adopted` cannot be fixed here, so they
//    stand at the top and Send stays off.
// ⛔ LAZY. Reached only through `openSharePreview` (its own root) and the styles chunk's ShareStyleForm.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import Switch from '../../../../../components/ui/Switch'
import { publishTemplate, publishTool, sharePreview } from '../../../lib/templateLibrary'
import { TYPE_LABELS, bindWords, familyLabel, outlineWithBlockNames, slotFamily, slotLabel } from '../../../lib/templateSlots'
import { GALLERY_CATEGORIES } from '../../../lib/templateGallery'
import { TRADING_STYLES } from '../../../lib/styleLibrary'
import { SCHEDULES, TRACKER_DAYS, WEEKDAYS, kindWords } from '../routines/toolEditorLib'
import { VIEW_LABELS } from '../widgetBuilder/builderCatalog'
// The template picker's read-only outline renderer (TemplateDetailSheet draws listed outlines with it too).
import { DocBody } from '../TemplatePreview'
import styles from './library.module.css'

export const TITLE = 'Share to library'
export const HEADING = 'What will be shared'
export const TRAVELS_LABEL = 'Exactly what travels'
export const NOT_SHARED_LABEL = 'Not shared'
export const SEND_LABEL = 'Send for review'
export const SENT_SENTENCE = "Sent. UCT reviews every item before it's listed."
export const LOADING_SENTENCE = 'Checking what will be shared…'
// The server's own limits and sentences, shown beside each field. Each is pinned to the server's source text by
// SharePreviewSheet.server.test.js: share.NAME_MAX / S_NAME_LONG, DESCRIPTION_MAX / S_DESCRIPTION_LONG,
// ITEM_TEXT_MAX / S_ITEM_LONG, UNIT_MAX / S_UNIT_LONG, and a widget's field names widget_formula.NAME_MAX /
// plan.S_FORMULA_NAME_LONG (the cap share_plan applies to a formula's name).
export const NAME_MAX = 80
export const DESCRIPTION_MAX = 280
export const ITEM_MAX = 200
export const UNIT_MAX = 16
export const FIELD_NAME_MAX = 60
export const NAME_HINT = 'A name can be at most 80 characters.'
export const DESCRIPTION_HINT = 'A description can be at most 280 characters.'
export const ITEM_HINT = 'An item can be at most 200 characters.'
export const UNIT_HINT = 'A unit can be at most 16 characters.'
export const FIELD_NAME_HINT = 'A field name can be at most 60 characters.'
export const DEBOUNCE_MS = 600
/** Refusals the author cannot fix in this sheet: their sentence stands at the top, Send stays off and there is no
 *  Try again (asking again would only repeat it). */
export const BLOCKING_CODES = Object.freeze(['own_words', 'adopted', 'not_yours'])
export const CATEGORY_LABEL = 'Category (required)'
export const CATEGORY_HINT = 'Pick a category to send it.'
export const SHARED_NUMBERS_LABEL = 'Shared numbers'
export const sameAsSentence = (label) => `This is the same as ${label} above. Change it there.`

export const pickLine = (labels) => `People who use it pick their own: ${labels.join(', ')}`
export const numberSwitchLabel = (value) => `Share this number (${value})`

const FAMILY_KIND = Object.freeze({ built: 'widget', routine: 'routine', tracker: 'tracker' })
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => (typeof v === 'string' ? v : '')
const listOf = (v) => (Array.isArray(v) ? v : [])

/** A number as the member reads it, or null (NaN, Infinity and non-numbers have no words). */
function numberWords(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return String(v)
}

/** The numbers the author may choose to share: `[{path, value, label}]`, paths prefixed for a template's block. */
function numbersOf(raw, prefix = '') {
  return listOf(raw)
    .filter((n) => isRecord(n) && typeof n.path === 'string' && n.path && numberWords(n.value) !== null)
    .map((n) => ({ path: prefix + n.path, value: n.value, label: text(n.label) }))
}

/** The fields of one shareable thing, from the server's prefill (and, for a widget's field order, its travels). */
function fieldsOf(kind, pre, travels) {
  const p = isRecord(pre) ? pre : {}
  if (kind === 'widget') {
    // Ruling W11-R22: `formulas: [{id, name}]`. The object form `{id: name}` is read too (an older answer).
    const names = Array.isArray(p.formulas)
      ? Object.fromEntries(p.formulas.filter((x) => isRecord(x) && typeof x.id === 'string').map((x) => [x.id, text(x.name)]))
      : isRecord(p.formulas) ? p.formulas : {}
    const order = listOf(travels?.plan?.formulas).map((f) => f?.id).filter((fid) => typeof fid === 'string')
    const ids = [...order, ...Object.keys(names).filter((fid) => !order.includes(fid))]
    return {
      name: text(p.name), description: text(p.description),
      formulas: ids.map((fid) => ({ id: fid, text: text(names[fid]) })),
    }
  }
  if (kind === 'routine') {
    return { name: text(p.name), items: listOf(p.items).map((it) => ({ text: text(isRecord(it) ? it.text : it), on: true })) }
  }
  if (kind === 'tracker') return { name: text(p.name), unit: text(p.unit) }
  return { name: text(p.name), description: text(p.description) }
}

/** Every field of the sheet from the first answer's prefill. */
export function fieldsFromPrefill(kind, prefill, travels) {
  const base = fieldsOf(kind, prefill, travels)
  if (kind !== 'template') return { ...base, numbers: numbersOf(prefill?.numbers) }
  const blocks = isRecord(prefill?.blocks) ? prefill.blocks : {}
  const defs = new Map(listOf(travels?.definitions).map((d) => [d?.key, d]))
  const travelBlocks = new Map(listOf(travels?.blocks).map((b) => [b?.block, b]))
  // One widget, routine or tracker held by two blocks is reduced ONCE, with the first block's edits (share_template's
  // `if ref not in inline`), so a later block holding it gets no controls of its own: it says where to change it.
  const firstOf = new Map()
  return {
    ...base,
    numbers: [],
    blocks: Object.keys(blocks).filter((bid) => slotFamily(bid)).map((bid) => {
      const family = slotFamily(bid)
      const sub = FAMILY_KIND[family]
      const st = travelBlocks.get(bid)?.settings
      const ref = typeof st?.ref === 'string' ? st.ref : typeof st?.inline === 'string' ? `inline:${st.inline}` : null
      const def = ref && ref.startsWith('inline:') ? defs.get(ref.slice(7)) : null
      const fields = fieldsOf(sub, blocks[bid], def ? { plan: def.plan } : null)
      const first = ref ? firstOf.get(ref) : null
      if (ref && !first) firstOf.set(ref, familyLabel(family, fields.name))
      return {
        bid, family, kind: sub, fields, sameAs: first || null,
        numbers: first ? [] : numbersOf(blocks[bid]?.numbers, `${bid}/`),
      }
    }),
  }
}

function editsOne(kind, f) {
  if (kind === 'widget') {
    const out = { name: f.name, description: f.description }
    if (f.formulas.length) out.formulas = Object.fromEntries(f.formulas.map((x) => [x.id, x.text]))
    return out
  }
  if (kind === 'routine') return { name: f.name, items: f.items.map((it) => (it.on ? it.text : '')) }
  if (kind === 'tracker') return { name: f.name, unit: f.unit }
  return { name: f.name, description: f.description }
}

/** The `edits` the fields ask for: exactly their values, nothing else. */
export function editsOf(kind, fields) {
  const out = editsOne(kind, fields)
  if (kind === 'template') {
    out.blocks = Object.fromEntries(fields.blocks.filter((b) => !b.sameAs).map((b) => [b.bid, editsOne(b.kind, b.fields)]))
  }
  return out
}

const sigOf = (edits, keep) => JSON.stringify([edits ?? null, [...keep].sort()])

// ── "Exactly what travels" (read-only, plain words, never JSON) ────────────────────────────────────

function Row({ label, children }) {
  return (
    <p className={styles.travelRow}><span className={styles.travelKey}>{label}: </span>{children}</p>
  )
}

function scheduleWords(s) {
  const base = (SCHEDULES.find(([k]) => k === s?.kind) || SCHEDULES[0])[1]
  if (s?.kind !== 'weekdays') return base
  const days = listOf(s.days).map((d) => (WEEKDAYS.find(([k]) => k === d) || [])[1]).filter(Boolean)
  return days.length ? `${base}: ${days.join(', ')}` : base
}

function WidgetTravels({ t }) {
  const fields = listOf(t?.plan?.formulas).map((f) => text(f?.name)).filter(Boolean)
  const view = (VIEW_LABELS.find(([k]) => k === t?.plan?.view?.type) || [])[1]
  return (
    <>
      {text(t?.name) && <Row label="Name">{t.name}</Row>}
      {text(t?.description) && <Row label="Description">{t.description}</Row>}
      {view && <Row label="Shown as">{view}</Row>}
      {fields.length > 0 && <Row label="Your own fields">{fields.join(', ')}</Row>}
    </>
  )
}

/** The numbers the SERVER says travel: each path in `answer.kept`, named and valued by the same answer's prefill
 *  (`numbers`, or a template block's `numbers` under its `<block id>/` prefix). Nothing here reads the switches, so
 *  a switch the server did not keep shows nothing. */
export function sharedNumbers(answer) {
  const kept = listOf(answer?.kept).filter((k) => typeof k === 'string')
  if (!kept.length) return []
  const pre = isRecord(answer?.prefill) ? answer.prefill : {}
  const known = new Map(numbersOf(pre.numbers).map((n) => [n.path, n]))
  for (const [bid, b] of Object.entries(isRecord(pre.blocks) ? pre.blocks : {})) {
    for (const n of numbersOf(b?.numbers, `${bid}/`)) known.set(n.path, n)
  }
  return kept.filter((k) => known.has(k)).map((k) => {
    const n = known.get(k)
    return n.label ? `${n.label} ${numberWords(n.value)}` : numberWords(n.value)
  })
}

function SharedNumbers({ answer }) {
  const words = sharedNumbers(answer)
  return words.length > 0 ? <Row label={SHARED_NUMBERS_LABEL}>{words.join(', ')}</Row> : null
}

function RoutineTravels({ t }) {
  const items = listOf(t?.items).filter((it) => text(it?.text))
  return (
    <>
      {text(t?.name) && <Row label="Name">{t.name}</Row>}
      {items.length > 0 && (
        <>
          <p className={styles.travelRow}><span className={styles.travelKey}>Items:</span></p>
          <ul className={styles.list}>
            {items.map((it, i) => (
              <li key={i} className={styles.travelRow}>
                {it.text}{it.negative === true ? ' (counts when it didn’t happen)' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {isRecord(t?.schedule) && <Row label="When">{scheduleWords(t.schedule)}</Row>}
    </>
  )
}

function TrackerTravels({ t }) {
  const days = (TRACKER_DAYS.find(([k]) => k === t?.days) || [])[1]
  return (
    <>
      {text(t?.name) && <Row label="Name">{t.name}</Row>}
      {text(t?.kind) && <Row label="Type">{kindWords(t.kind)}</Row>}
      {text(t?.unit) && <Row label="Unit">{t.unit}</Row>}
      {days && <Row label="Days">{days}</Row>}
    </>
  )
}

/** A shared template's inline widgets, routines and trackers, keyed `inline:<key>`, and their names by that ref. */
function inlineOf(t) {
  const inline = new Map()
  for (const [key, list] of [['definitions', 'd'], ['routines', 'r'], ['trackers', 't']]) {
    for (const x of listOf(t?.[key])) if (typeof x?.key === 'string') inline.set(`inline:${x.key}`, { kind: list, item: x })
  }
  return { inline, names: Object.fromEntries([...inline].map(([ref, v]) => [ref, text(v.item.name)])) }
}

function TemplateTravels({ t }) {
  const { inline, names } = inlineOf(t)
  const slots = listOf(t?.blocks).filter((b) => slotFamily(b?.block))
  const others = listOf(t?.blocks).length - slots.length
  return (
    <>
      {text(t?.name) && <Row label="Name">{t.name}</Row>}
      {text(t?.description) && <Row label="Description">{t.description}</Row>}
      {slots.length > 0 && (
        <ul className={styles.list}>
          {slots.map((b) => {
            const s = isRecord(b.settings) ? b.settings : {}
            const ref = typeof s.ref === 'string' ? s.ref : typeof s.inline === 'string' ? `inline:${s.inline}` : null
            const held = ref ? inline.get(ref) : null
            const bind = slotFamily(b.block) === 'built' ? '' : bindWords(s.bind)
            return (
              <li key={b.block} className={styles.group}>
                <p className={styles.travelRow}>{slotLabel(b, names)}{bind ? ` (${bind})` : ''}</p>
                {held?.kind === 'd' && <WidgetTravels t={{ ...held.item, name: '' }} />}
                {held?.kind === 'r' && <RoutineTravels t={{ ...held.item, name: '' }} />}
                {held?.kind === 't' && <TrackerTravels t={{ ...held.item, name: '' }} />}
              </li>
            )
          })}
        </ul>
      )}
      {others > 0 && <p className={styles.travelRow}>{`And ${others} other part${others === 1 ? '' : 's'} of the template`}</p>}
    </>
  )
}

/**
 * F-FE-1 F1 (11.15 M-4): a template's outline, exactly as the server will share it (`answer.outline`: sanitized, its
 * links dropped by W11-R33/R40). Drawn only when the answer carries one with content. An outline that is gone
 * (`outlineGone`: the server sends `outline: null`) is already said once, in the server's own sentence, under Not
 * shared (`notShared`), so nothing more is drawn here and no client copy restates it.
 */
const OUTLINE_LABEL = 'Outline'
function OutlineTravels({ answer }) {
  const o = answer?.outline
  if (!isRecord(o) || !Array.isArray(o.content) || o.content.length === 0) return null
  return (
    <div className={styles.group} data-outline-travels="">
      <h4 className={styles.subheading}>{OUTLINE_LABEL}</h4>
      {/* m-4: under the sheet's h2 title, the h3 "Exactly what travels" and this h4, the author's headings are h5-h6. */}
      <DocBody body={outlineWithBlockNames(o, answer?.travels?.blocks, inlineOf(answer?.travels).names)} headingBase={5} />
    </div>
  )
}

function Travels({ kind, answer }) {
  const travels = answer?.travels
  if (!isRecord(travels)) return null
  const body = kind === 'widget' ? <WidgetTravels t={travels} />
    : kind === 'routine' ? <RoutineTravels t={travels} />
      : kind === 'tracker' ? <TrackerTravels t={travels} />
        : <><TemplateTravels t={travels} /><OutlineTravels answer={answer} /></>
  return <>{body}<SharedNumbers answer={answer} /></>
}

// ── the author's fields ────────────────────────────────────────────────────────────────────────────

function TextField({ id, label, value, max, hint, multiline = false, placeholder, onChange }) {
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <Tag id={id} className={multiline ? styles.textarea : styles.input} value={value} maxLength={max}
        placeholder={placeholder} aria-describedby={hint ? `${id}-hint` : undefined}
        {...(multiline ? { rows: 3 } : { type: 'text' })}
        onChange={(e) => onChange(e.target.value)} />
      {hint && <p className={styles.hint} id={`${id}-hint`}>{hint}</p>}
    </div>
  )
}

function NumberSwitches({ uid, numbers, keep, onToggle }) {
  if (!numbers.length) return null
  return (
    <div className={styles.section}>
      {numbers.map((n, i) => {
        const id = `${uid}-num-${i}`
        const on = keep.has(n.path)
        return (
          <div key={n.path} className={styles.switchRow}>
            <Switch checked={on} aria-labelledby={id} className={styles.switch} checkedClassName={styles.switchOn}
              knobClassName={styles.knob} data-keep-path={n.path} onClick={() => onToggle(n.path)} />
            <span id={id} className={styles.switchLabel}>
              {n.label ? `${n.label}: ` : ''}{numberSwitchLabel(numberWords(n.value))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** The fields for one widget, routine or tracker. `set(next)` replaces its fields. */
function ToolFields({ uid, kind, f, set, numbers, keep, onToggle, named = true }) {
  return (
    <>
      {named && (
        <TextField id={`${uid}-name`} label="Name" value={f.name} max={NAME_MAX} hint={NAME_HINT}
          onChange={(v) => set({ ...f, name: v })} />
      )}
      {kind === 'widget' && (
        <TextField id={`${uid}-desc`} label="Description" value={f.description} max={DESCRIPTION_MAX}
          hint={DESCRIPTION_HINT} multiline onChange={(v) => set({ ...f, description: v })} />
      )}
      {kind === 'widget' && f.formulas.map((x, i) => (
        <TextField key={x.id} id={`${uid}-f-${i}`} label={`Name of field ${i + 1}`} value={x.text}
          placeholder={`Field ${i + 1}`} max={FIELD_NAME_MAX} hint={FIELD_NAME_HINT}
          onChange={(v) => set({ ...f, formulas: f.formulas.map((y) => (y.id === x.id ? { ...y, text: v } : y)) })} />
      ))}
      {kind === 'routine' && f.items.length > 0 && (
        <fieldset className={styles.section}>
          <legend className={styles.label}>Items</legend>
          <ul className={styles.list}>
            {f.items.map((it, i) => {
              const n = i + 1
              return (
                <li key={i} className={styles.itemRow}>
                  <label className={styles.check}>
                    <input type="checkbox" checked={it.on} aria-label={`Share item ${n}`}
                      onChange={() => set({ ...f, items: f.items.map((y, j) => (j === i ? { ...y, on: !y.on } : y)) })} />
                  </label>
                  <input type="text" className={styles.input} value={it.text} maxLength={ITEM_MAX}
                    aria-label={`Item ${n}`} disabled={!it.on}
                    onChange={(e) => set({ ...f, items: f.items.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} />
                </li>
              )
            })}
          </ul>
          <p className={styles.hint}>{ITEM_HINT}</p>
        </fieldset>
      )}
      {kind === 'tracker' && (
        <TextField id={`${uid}-unit`} label="Unit" value={f.unit} max={UNIT_MAX} hint={UNIT_HINT}
          onChange={(v) => set({ ...f, unit: v })} />
      )}
      <NumberSwitches uid={uid} numbers={numbers} keep={keep} onToggle={onToggle} />
    </>
  )
}

/**
 * @param kind    'widget' | 'routine' | 'tracker' | 'template'
 * @param id      the member's own item (a widget, routine or tracker id, or the template's style id)
 * @param onClose Cancel, Done, Escape or the Sheet's own close
 * @param onDone  `(sentence) => void` once the server took the item for review
 */
export default function SharePreviewSheet({ kind, id, onClose, onDone }) {
  const uid = useId()
  const [fields, setFields] = useState(null)              // null until the first answer's prefill
  const [keep, setKeep] = useState(() => new Set())
  const [answer, setAnswer] = useState(null)               // the server's {travels, slots, kept, notShared, prefill}
  const [problem, setProblem] = useState(null)             // {code, message} of the last refused ask
  const [answeredSig, setAnsweredSig] = useState(null)     // what the answer on screen was asked for
  const [category, setCategory] = useState('')
  const [tradingStyle, setTradingStyle] = useState('')
  const [sending, setSending] = useState(false)
  const [sendProblem, setSendProblem] = useState(null)
  const [sent, setSent] = useState(false)

  const latest = useRef({ edits: undefined, keep: [] })   // what the next ask sends
  const inFlight = useRef(false)
  const again = useRef(false)
  const timer = useRef(null)
  const alive = useRef(true)
  const primed = useRef(false)
  const doneRef = useRef(null)
  const alertRef = useRef(null)
  const focusAlert = useRef(false)

  // Focus follows the member when the form leaves the screen: to Done after a send, to the refusal after a send the
  // server refused for good (the Sheet moves focus in only once per open).
  useEffect(() => { if (sent) doneRef.current?.focus() }, [sent])
  useEffect(() => {
    if (problem && focusAlert.current) { focusAlert.current = false; alertRef.current?.focus() }
  }, [problem])

  const ask = useCallback(async () => {
    if (inFlight.current) { again.current = true; return }
    inFlight.current = true
    const { edits, keep: k } = latest.current
    const sig = sigOf(edits, k)
    const out = await sharePreview(kind, id, { edits, keep: k })
    inFlight.current = false
    if (!alive.current) return
    if (out.ok) {
      setAnswer(out.data)
      setProblem(null)
      if (!primed.current) {
        primed.current = true
        const f = fieldsFromPrefill(kind, out.data.prefill, out.data.travels)
        setFields(f)
        // The author's own words are prefilled, so what travels must be re-asked WITH them as the edits.
        latest.current = { edits: editsOf(kind, f), keep: [] }
        again.current = true
      }
    } else {
      setAnswer(null)
      setProblem({ code: out.code, message: out.message })
    }
    setAnsweredSig(sig)
    if (again.current) {
      again.current = false
      ask()
    }
  }, [kind, id])

  useEffect(() => {
    alive.current = true
    ask()
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [ask])

  /** An edit: the fields move at once; the server is asked 600 ms after the last one. */
  const edit = (nextFields, nextKeep = keep) => {
    setFields(nextFields)
    setKeep(nextKeep)
    latest.current = { edits: editsOf(kind, nextFields), keep: [...nextKeep] }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; ask() }, DEBOUNCE_MS)
  }
  const toggleKeep = (path) => {
    const next = new Set(keep)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    edit(fields, next)
  }

  const currentSig = fields ? sigOf(editsOf(kind, fields), [...keep]) : null
  // ONE test of "the answer on screen is the answer for the fields on screen": what it was asked for. A waiting or
  // in-flight ask is always for other fields than the answer on screen, so it needs no second flag.
  const fresh = Boolean(answer) && !problem && answeredSig === currentSig
  const blocked = Boolean(problem && BLOCKING_CODES.includes(problem.code))
  const canSend = fresh && !sending && !sent && (kind !== 'template' || Boolean(category))

  const labels = useMemo(() => {
    const seen = []
    for (const s of listOf(answer?.slots)) {
      const word = Object.hasOwn(TYPE_LABELS, s?.type) ? TYPE_LABELS[s.type] : null
      if (word && !seen.includes(word)) seen.push(word)
    }
    return seen
  }, [answer])
  const notShared = listOf(answer?.notShared).filter((s) => typeof s === 'string' && s.trim())

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setSendProblem(null)
    const { edits, keep: k } = latest.current
    const travels = answer.travels || {}
    const body = { title: text(travels.name), description: text(travels.description), edits, keep: k }
    const out = kind === 'template'
      ? await publishTemplate(id, { ...body, category, tradingStyle })
      : await publishTool(kind, id, body)
    if (!alive.current) return
    setSending(false)
    if (out.ok) {
      setSent(true)
      onDone?.(SENT_SENTENCE)
    } else if (BLOCKING_CODES.includes(out.code)) {
      focusAlert.current = true
      setProblem({ code: out.code, message: out.message })
    } else {
      setSendProblem(out.message)
    }
  }

  return (
    <Sheet open onClose={onClose} title={TITLE} labelledByTitle variant="auto" maxWidth={600}>
      <div className={styles.sheet} data-share-preview={kind}>
        {problem && (
          <p className={styles.notice} role="alert" data-refusal={problem.code} ref={alertRef} tabIndex={-1}>{problem.message}</p>
        )}
        {sent ? (
          <>
            <p className={styles.sent} role="status">{SENT_SENTENCE}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.btnPrimary} ref={doneRef} onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.heading}>{HEADING}</h2>
            {!fields && !problem && <p className={styles.hint} role="status">{LOADING_SENTENCE}</p>}
            {fields && !blocked && (
              <div className={styles.section} role="group" aria-label={HEADING}>
                {kind === 'template' ? (
                  <>
                    <TextField id={`${uid}-name`} label="Name" value={fields.name} max={NAME_MAX} hint={NAME_HINT}
                      onChange={(v) => edit({ ...fields, name: v })} />
                    <TextField id={`${uid}-desc`} label="Description" value={fields.description} max={DESCRIPTION_MAX}
                      hint={DESCRIPTION_HINT} multiline onChange={(v) => edit({ ...fields, description: v })} />
                    {fields.blocks.map((b, i) => (
                      <section key={b.bid} className={styles.group} aria-labelledby={`${uid}-b${i}`}>
                        <h3 className={styles.subheading} id={`${uid}-b${i}`}>{familyLabel(b.family, b.fields.name)}</h3>
                        {b.sameAs ? <p className={styles.hint}>{sameAsSentence(b.sameAs)}</p> : (
                          <ToolFields uid={`${uid}-b${i}`} kind={b.kind} f={b.fields} numbers={b.numbers} keep={keep}
                            onToggle={toggleKeep}
                            set={(next) => edit({ ...fields, blocks: fields.blocks.map((x) => (x.bid === b.bid ? { ...x, fields: next } : x)) })} />
                        )}
                      </section>
                    ))}
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`${uid}-cat`}>{CATEGORY_LABEL}</label>
                      <select id={`${uid}-cat`} className={styles.select} value={category} required
                        aria-describedby={category ? undefined : `${uid}-cat-hint`}
                        onChange={(e) => setCategory(e.target.value)}>
                        <option value="">Choose a category</option>
                        {GALLERY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                      {!category && <p className={styles.hint} id={`${uid}-cat-hint`}>{CATEGORY_HINT}</p>}
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`${uid}-ts`}>Trading style (optional)</label>
                      <select id={`${uid}-ts`} className={styles.select} value={tradingStyle}
                        onChange={(e) => setTradingStyle(e.target.value)}>
                        <option value="">No trading style</option>
                        {TRADING_STYLES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </div>
                  </>
                ) : (
                  <ToolFields uid={uid} kind={kind} f={fields} numbers={fields.numbers} keep={keep}
                    onToggle={toggleKeep} set={(next) => edit(next)} />
                )}
              </div>
            )}
            {labels.length > 0 && <p className={styles.travelRow} data-pick-line="">{pickLine(labels)}</p>}
            {notShared.length > 0 && (
              <section className={styles.section} aria-labelledby={`${uid}-not`}>
                <h3 className={styles.subheading} id={`${uid}-not`}>{NOT_SHARED_LABEL}</h3>
                <ul className={styles.list}>
                  {notShared.map((s) => <li key={s} className={styles.hint}>{s}</li>)}
                </ul>
              </section>
            )}
            {answer && !blocked && (
              <section className={styles.section} aria-labelledby={`${uid}-travels`}>
                <h3 className={styles.subheading} id={`${uid}-travels`}>{TRAVELS_LABEL}</h3>
                <div className={styles.travels} data-travels="">
                  <Travels kind={kind} answer={answer} />
                </div>
              </section>
            )}
            {sendProblem && <p className={styles.notice} role="alert">{sendProblem}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
              {problem && !blocked && (
                <button type="button" className={styles.btn} onClick={() => ask()}>Try again</button>
              )}
              <button type="button" className={styles.btnPrimary} disabled={!canSend || blocked} onClick={send}>
                {sending ? 'Sending…' : SEND_LABEL}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
