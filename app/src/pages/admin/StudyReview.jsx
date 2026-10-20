/**
 * StudyReview — the owner's review card for Study drafts (spec §4.7, §13.6,
 * §13.9 #3; §13.2 T12: no route of its own, mounted by PatternReview as the
 * `study` mode).
 *
 * ONE screen per item: the chart with the ticker and dates REVEALED and the
 * forward strip (what the member sees only on reveal) marked · the question
 * and choices with the key highlighted · a provenance line (the verbatim
 * source quote, or the detector's geometry numbers) · the forward-strip
 * summary (outcome rule + window printed) · the lesson · the importer's
 * automatic checks as pass/fail chips · three keys A approve / F fix / R
 * reject (one-tap reason chips) · N next / P previous · Enter confirms.
 *
 * Backend (api/routers/study.py):
 *   GET  /api/study/admin/review?lane=&type=&skill=&limit=   drafts + counts + skills + trust per type
 *   GET  /api/study/admin/items/{id}/bars   the STORED bars (visible + forward) of any draft
 *        ⛔ The chart draws these through `barsOverride`, never a live fetch by
 *        ticker: the member sees the snapshot stored with the item, so the
 *        reviewer must judge that same snapshot (a live fetch also fails for a
 *        2022 window the provider no longer serves, which is how this shipped
 *        as "No MSFT chart data" on 2026-10-19).
 *   POST /api/study/admin/review/{id}  {action, reason?, field?, after?}
 *        `fix` rewrites ONE field per call; an edit touching several fields
 *        posts one call per changed field, in order.
 *   POST /api/study/admin/trust/{type} {state, sample_rate?}
 *   GET  /api/study/admin/corrections/export
 *
 * Graduated trust: the backend counts clean approvals per item TYPE and
 * reports `ask_to_switch` once the count reaches `ask_at` (TRUST_ASK_AT);
 * this screen then ASKS. Nothing here switches a type on its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import StockChart from '../../components/StockChart'
import { appendForwardBars, normalizeBars } from '../study/useStudySession'
import Textarea from '../../components/ui/Textarea'
import UIcon from '../../components/ui/UIcon'
import { studySettingsOverride } from '../study/DrillPlayer'
import { CHART_TYPES, choicesFromPrompt, questionOf as playerQuestionOf } from '../study/drills/types'
import styles from './StudyReview.module.css'

export const REVIEW_URL = '/api/study/admin/review'
export const TRUST_URL = '/api/study/admin/trust'
export const EXPORT_URL = '/api/study/admin/corrections/export'
export const QUEUE_LIMIT = 150
export const LANES = ['manual', 'deterministic', 'fast', 'second_look']
export const REJECT_REASONS = [
  'wrong label', 'bad chart', 'wrong number', 'voice', 'duplicate', 'split/adjustment', 'hindsight-obvious',
]
export const SAMPLE_RATE = 0.1
export const KEY_MARK = 'key'

const NO_ITEMS = Object.freeze([])
const NO_OBJ = Object.freeze({})
const GOLD = '#dcbb5e'
const DEFAULT_WINDOW_BARS = 120
const DEFAULT_FORWARD = 20

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

export function reviewKey(lane, type, limit = QUEUE_LIMIT, skill = '') {
  const p = new URLSearchParams()
  if (lane) p.set('lane', lane)
  if (type) p.set('type', type)
  if (skill) p.set('skill', skill)
  p.set('limit', String(limit))
  return `${REVIEW_URL}?${p.toString()}`
}

/** The question text; the bank writes `q` (study_import.PROMPT_QUESTION_KEYS), the player reads the rest. */
export function questionOf(item) {
  const q = item?.prompt_json?.q
  return q != null && q !== '' ? String(q) : playerQuestionOf(item)
}

function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function norm(v) {
  if (v == null) return ''
  return String(v).trim().toLowerCase().split(/\s+/).join(' ')
}

/** The key as the scorer reads it: a bare value, {answer}, or {choice}. */
export function keyOf(item) {
  const a = item?.answer_json
  if (a == null) return null
  if (typeof a !== 'object') return a
  if (a.answer != null && typeof a.answer !== 'object') return a.answer
  if (a.choice != null && typeof a.choice !== 'object') return a.choice
  return null
}

export function keyText(item) {
  const k = keyOf(item)
  if (k != null) return String(k)
  const a = item?.answer_json
  if (a == null) return ''
  if (typeof a === 'object' && a.shares != null) {
    return `${a.shares} shares${a.dollars != null ? `, $${a.dollars} in the stock` : ''}`
  }
  return JSON.stringify(a)
}

function flagsOf(item) {
  const raw = item?.import_flags
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    try {
      const d = JSON.parse(raw)
      return Array.isArray(d) ? d.map(String) : [raw]
    } catch {
      return [raw]
    }
  }
  return []
}

/** The importer's automatic checks (study_import.run_checks), as pass/fail. */
export function checksOf(item) {
  const flags = flagsOf(item)
  const pick = (re) => flags.filter((f) => re.test(f))
  const numbers = pick(/ungrounded number/i)
  const dup = pick(/near-duplicate/i)
  const voice = pick(/^voice/i)
  return [
    { id: 'numbers', label: 'Numbers in the facts', pass: numbers.length === 0, detail: numbers },
    { id: 'duplicate', label: 'Not a near-duplicate', pass: dup.length === 0, detail: dup },
    { id: 'voice', label: 'Voice', pass: voice.length === 0, detail: voice },
  ]
}

function fmtNum(v) {
  if (typeof v !== 'number') return String(v)
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')
}

/** The provenance line: the verbatim quote, else the detector's geometry numbers. */
export function provenanceOf(item) {
  const r = item?.reveal_json || NO_OBJ
  const facts = r.facts || NO_OBJ
  if (r.quote) return { kind: 'quote', text: String(r.quote) }
  const geometry = facts.geometry || r.geometry
  if (geometry && typeof geometry === 'object' && Object.keys(geometry).length) {
    const parts = Object.entries(geometry).map(([k, v]) => `${k.replace(/_/g, ' ')} ${fmtNum(v)}`)
    const who = r.detector || facts.pattern_id || facts.name || 'detector'
    return { kind: 'geometry', text: `${who} measured ${parts.join(', ')}` }
  }
  if (r.rule) return { kind: 'rule', text: String(r.rule) }
  if (r.detector) return { kind: 'detector', text: `${r.detector}${r.fixture ? ` · fixture ${r.fixture}` : ''}` }
  return null
}

/** The forward-strip summary: the outcome rule and the window, printed. */
export function forwardSummaryOf(item) {
  const r = item?.reveal_json || NO_OBJ
  const facts = r.facts || NO_OBJ
  const a = item?.answer_json
  const parts = []
  const outcome = facts.outcome || r.outcome || (a && typeof a === 'object' ? a.outcome : null)
  if (outcome) parts.push(`outcome ${String(outcome).replace(/_/g, ' ')}`)
  const window = facts.window || r.window
  if (window) parts.push(`window ${window} sessions`)
  else if (r.window_bars) parts.push(`${r.window_bars} bars shown`)
  const lv = facts.levels
  if (lv && typeof lv === 'object') {
    const l = ['entry', 'stop', 'target'].filter((k) => lv[k] != null).map((k) => `${k} ${fmtNum(lv[k])}`)
    if (l.length) parts.push(l.join(' · '))
  }
  if (facts.bars_to_resolve != null) parts.push(`${facts.bars_to_resolve} bars to resolve`)
  if (facts.mfe_pct != null || facts.mae_pct != null) {
    parts.push(`MFE ${fmtNum(facts.mfe_pct ?? 0)}% · MAE ${fmtNum(facts.mae_pct ?? 0)}%`)
  }
  if (a && typeof a === 'object' && Array.isArray(a.accept) && a.accept.length) {
    parts.push(`accepts ${a.accept.join(', ')} (fair-scoring)`)
  }
  if (r.fires != null) parts.push(`fires: ${r.fires ? 'yes' : 'no'}`)
  return parts.join(' · ')
}

function shiftDate(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** [entryDate, exitDate, forwardSessions] framing the member's window plus the forward strip. */
export function chartFrameOf(item) {
  const asof = item?.asof
  if (!asof) return null
  const r = item?.reveal_json || NO_OBJ
  const back = Number(item?.prompt_json?.chart?.window_bars || r.window_bars || DEFAULT_WINDOW_BARS)
  const fwd = Number(r.facts?.window || r.window || DEFAULT_FORWARD)
  return {
    entryDate: shiftDate(asof, -Math.ceil(back * 1.5) - 7),
    exitDate: shiftDate(asof, Math.ceil(fwd * 1.5) + 5),
    forward: fwd,
  }
}

function itemHasChartView(item) {
  if (!item || !item.sym || !item.asof) return false
  if (item.prompt_json?.image_url) return false
  return !!item.bars_ref || CHART_TYPES.has(item.type)
}

function detectionIdOf(item) {
  const r = item?.reveal_json || NO_OBJ
  return r.detection_id || r.facts?.detection_id || r.facts?.pattern_id || r.detector || null
}

const STATUS_WORD = { approved: 'approved', fixed: 'fixed', rejected: 'rejected' }

function Chips({ checks }) {
  return (
    <ul className={styles.checks} aria-label="Automatic checks">
      {checks.map((c) => (
        <li key={c.id} className={c.pass ? styles.chipPass : styles.chipFail}
          title={c.detail.join('; ') || (c.pass ? 'passed' : 'failed')} data-testid={`check-${c.id}`}>
          <UIcon name={c.pass ? 'check' : 'x'} size={12} gold={false} />
          <span>{c.label}</span>
          <span className={styles.chipWord}>{c.pass ? 'pass' : 'fail'}</span>
        </li>
      ))}
    </ul>
  )
}

export default function StudyReview() {
  const [lane, setLane] = useState('')
  const [type, setType] = useState('')
  // The queue is the OLDEST drafts of a lane/type, so a segment imported after
  // hundreds of older ones (vocab.chart behind 374 recall drafts) never reaches
  // the limit. The skill filter is how the reviewer gets straight to it.
  const [skill, setSkill] = useState('')
  const key = reviewKey(lane, type, QUEUE_LIMIT, skill)
  const { data, error, mutate } = useSWR(key, fetcher, { revalidateOnFocus: false })
  const drafts = data?.drafts || NO_ITEMS
  const counts = data?.counts || NO_OBJ
  const skills = data?.skills || NO_OBJ

  const [localStatus, setLocalStatus] = useState({})
  const [localTrust, setLocalTrust] = useState({})
  const [dismissed, setDismissed] = useState(() => new Set())
  const trustFor = useCallback(
    (t) => localTrust[t] || data?.trust?.[t] || { item_type: t, clean_count: 0, state: 'manual' },
    [localTrust, data],
  )
  const statusOf = useCallback((it) => localStatus[it.id] || null, [localStatus])

  const typesSeen = useMemo(() => {
    const s = new Set(Object.keys(data?.trust || NO_OBJ))
    Object.values(counts).forEach((byType) => Object.keys(byType || NO_OBJ).forEach((t) => s.add(t)))
    drafts.forEach((d) => s.add(d.type))
    return [...s].sort()
  }, [data, counts, drafts])

  const countFor = useCallback((ln, ty) => {
    let n = 0
    Object.entries(counts).forEach(([l, byType]) => {
      if (ln && l !== ln) return
      Object.entries(byType || NO_OBJ).forEach(([t, c]) => { if (!ty || t === ty) n += Number(c) || 0 })
    })
    return n
  }, [counts])

  const [selId, setSelId] = useState(null)
  const sel = useMemo(
    () => drafts.find((d) => d.id === selId) || drafts.find((d) => !localStatus[d.id]) || drafts[0] || null,
    [drafts, selId, localStatus],
  )
  const selIdx = sel ? drafts.findIndex((d) => d.id === sel.id) : -1

  const [mode, setMode] = useState('view')          // view | fix | reject
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)         // {kind: 'ok'|'error', text}
  const [fixQ, setFixQ] = useState('')
  const [fixChoices, setFixChoices] = useState('')
  const [fixAnswer, setFixAnswer] = useState('')
  const [fixLesson, setFixLesson] = useState('')
  const [rejectChip, setRejectChip] = useState(null)
  const [rejectText, setRejectText] = useState('')

  const choices = useMemo(() => choicesFromPrompt(sel), [sel])
  const keyValue = keyOf(sel)
  const keyNorm = norm(keyValue)
  const keyIsChoice = !!choices.length && choices.some((c) => norm(c) === keyNorm)

  const resetEditors = useCallback((it) => {
    setFixQ(questionOf(it))
    setFixChoices(choicesFromPrompt(it).join('\n'))
    const k = keyOf(it)
    setFixAnswer(k != null && typeof it?.answer_json === 'object' && it.answer_json?.answer != null
      ? String(k)
      : JSON.stringify(it?.answer_json ?? null, null, 2))
    setFixLesson(it?.lesson_text || '')
    setRejectChip(null)
    setRejectText('')
  }, [])

  const lastKey = useRef(null)
  if ((sel?.id || null) !== lastKey.current) {
    lastKey.current = sel?.id || null
    resetEditors(sel)
    setMode('view')
  }

  const go = useCallback((delta) => {
    if (!drafts.length) return
    const i = selIdx < 0 ? 0 : selIdx
    const next = drafts[Math.min(drafts.length - 1, Math.max(0, i + delta))]
    if (next) { setSelId(next.id); setStatus(null) }
  }, [drafts, selIdx])

  const advance = useCallback((fromId, statusMap) => {
    const i = drafts.findIndex((d) => d.id === fromId)
    const rest = [...drafts.slice(i + 1), ...drafts.slice(0, Math.max(0, i))]
    const next = rest.find((d) => d.id !== fromId && !statusMap[d.id])
    if (next) setSelId(next.id)
  }, [drafts])

  async function post(itemId, body) {
    const r = await fetch(`${REVIEW_URL}/${encodeURIComponent(itemId)}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  }

  function settle(itemId, word, res) {
    const nextMap = { ...localStatus, [itemId]: word }
    setLocalStatus(nextMap)
    if (res?.trust?.item_type) setLocalTrust((m) => ({ ...m, [res.trust.item_type]: res.trust }))
    setStatus({ kind: 'ok', text: `${sel?.sym || sel?.id}: ${STATUS_WORD[word]}.` })
    setMode('view')
    mutate()
    advance(itemId, nextMap)
  }

  const approve = useCallback(async () => {
    if (!sel || saving) return
    setSaving(true); setStatus(null)
    try {
      const res = await post(sel.id, { action: 'approve' })
      settle(sel.id, 'approved', res)
    } catch (e) {
      setStatus({ kind: 'error', text: `Approve failed (${e.message}). Nothing was recorded.` })
    } finally {
      setSaving(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, saving, localStatus, drafts])

  const fixEdits = useCallback(() => {
    if (!sel) return []
    const edits = []
    const p = sel.prompt_json || NO_OBJ
    const qKey = ['q', 'question', 'prompt', 'text'].find((k) => p[k] != null) || 'q'
    const newChoices = fixChoices.split('\n').map((s) => s.trim()).filter(Boolean)
    const choicesChanged = choices.length > 0 && newChoices.join('\n') !== choices.join('\n')
    if (fixQ !== questionOf(sel) || choicesChanged) {
      const after = { ...p, [qKey]: fixQ }
      if (choicesChanged) after.choices = newChoices
      edits.push({ field: 'prompt_json', after })
    }
    const a = sel.answer_json
    if (a != null && typeof a === 'object' && a.answer != null && typeof a.answer !== 'object') {
      if (fixAnswer !== String(a.answer)) edits.push({ field: 'answer_json', after: { ...a, answer: fixAnswer } })
    } else {
      let parsed
      try { parsed = JSON.parse(fixAnswer) } catch { parsed = undefined }
      if (parsed === undefined) return { error: 'The answer is not valid JSON.' }
      if (JSON.stringify(parsed) !== JSON.stringify(a)) edits.push({ field: 'answer_json', after: parsed })
    }
    if (fixLesson !== (sel.lesson_text || '')) edits.push({ field: 'lesson_text', after: fixLesson })
    return edits
  }, [sel, fixQ, fixChoices, fixAnswer, fixLesson, choices])

  const saveFix = useCallback(async () => {
    if (!sel || saving) return
    const edits = fixEdits()
    if (edits.error) { setStatus({ kind: 'error', text: edits.error }); return }
    if (!edits.length) { setStatus({ kind: 'error', text: 'Nothing changed. Edit a field, or press A to approve as is.' }); return }
    setSaving(true); setStatus(null)
    try {
      let res = null
      for (const e of edits) {
        // eslint-disable-next-line no-await-in-loop
        res = await post(sel.id, { action: 'fix', field: e.field, after: e.after, reason: 'fix' })
      }
      settle(sel.id, 'fixed', res)
    } catch (e) {
      setStatus({ kind: 'error', text: `Fix failed (${e.message}). Check what was recorded before retrying.` })
    } finally {
      setSaving(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, saving, fixEdits, localStatus, drafts])

  const confirmReject = useCallback(async () => {
    if (!sel || saving) return
    if (!rejectChip) { setStatus({ kind: 'error', text: 'Pick a reason chip first.' }); return }
    const reason = rejectText.trim() ? `${rejectChip}: ${rejectText.trim()}` : rejectChip
    setSaving(true); setStatus(null)
    try {
      const res = await post(sel.id, { action: 'reject', reason })
      settle(sel.id, 'rejected', res)
    } catch (e) {
      setStatus({ kind: 'error', text: `Reject failed (${e.message}). Nothing was recorded.` })
    } finally {
      setSaving(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, saving, rejectChip, rejectText, localStatus, drafts])

  const switchTrust = useCallback(async (t) => {
    try {
      const r = await fetch(`${TRUST_URL}/${encodeURIComponent(t)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'sampled', sample_rate: SAMPLE_RATE }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const row = await r.json()
      setLocalTrust((m) => ({ ...m, [t]: { ...(row || {}), item_type: t, state: 'sampled' } }))
      setStatus({ kind: 'ok', text: `${t} now auto-approves with a ${Math.round(SAMPLE_RATE * 100)}% sample.` })
      mutate()
    } catch (e) {
      setStatus({ kind: 'error', text: `Could not switch ${t} (${e.message}).` })
    }
  }, [mutate])

  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const typing = isTypingTarget(e.target)
      if (e.key === 'Escape' && mode !== 'view') { e.preventDefault(); setMode('view'); return }
      if (e.key === 'Enter') {
        if (e.target?.tagName === 'TEXTAREA') return
        if (mode === 'fix') { e.preventDefault(); saveFix() }
        else if (mode === 'reject') { e.preventDefault(); confirmReject() }
        return
      }
      if (typing) return
      const k = e.key.toLowerCase()
      if (k === 'a') { e.preventDefault(); if (mode === 'view') approve() }
      else if (k === 'f') { e.preventDefault(); setMode('fix'); setStatus(null) }
      else if (k === 'r') { e.preventDefault(); setMode('reject'); setStatus(null) }
      else if (k === 'n') { e.preventDefault(); go(1) }
      else if (k === 'p') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, approve, saveFix, confirmReject, go])

  const trust = sel ? trustFor(sel.type) : null
  const askTrust = !!(trust && sel && trust.state === 'manual' && (trust.ask_to_switch || trust.ask) && !dismissed.has(sel.type))

  const frame = useMemo(() => chartFrameOf(sel), [sel])
  // The stored snapshot (visible window + forward strip) for the selected
  // chart item. `null` key = no request for text items.
  const barsKey = sel && itemHasChartView(sel) ? `/api/study/admin/items/${encodeURIComponent(sel.id)}/bars` : null
  const { data: storedBars, error: storedBarsError } = useSWR(barsKey, fetcher, { revalidateOnFocus: false })
  // Stored bars carry `t` as YYYYMMDD ints; the chart wants 'YYYY-MM-DD'. The
  // drill normalises through the same two helpers, so the reviewer and the
  // member see one shape (raw ints under `exactDateRange` match no date and
  // the chart reports "No <sym> chart data", measured on production 2026-10-20).
  const chartBars = useMemo(() => {
    if (!storedBars || !Array.isArray(storedBars.bars) || !storedBars.bars.length) return null
    return appendForwardBars(normalizeBars(storedBars), storedBars.forward)
  }, [storedBars])
  const chartBarsPending = !!barsKey && !storedBars && !storedBarsError
  const chartOpts = sel?.prompt_json?.chart
  const settingsOverride = useMemo(() => studySettingsOverride(chartOpts), [chartOpts])
  const markers = useMemo(() => {
    if (!sel?.asof) return null
    return [{ time: sel.asof, position: 'aboveBar', color: GOLD, shape: 'arrowDown', text: 'member sees to here', id: 'study-asof' }]
  }, [sel])
  const priceLines = useMemo(() => {
    const lv = sel?.reveal_json?.facts?.levels
    if (!lv || typeof lv !== 'object') return null
    const out = []
    if (lv.entry != null) out.push({ price: lv.entry, color: GOLD, lineStyle: 2, title: `Entry ${fmtNum(lv.entry)}` })
    if (lv.stop != null) out.push({ price: lv.stop, color: '#df4646', lineStyle: 2, title: `Stop ${fmtNum(lv.stop)}` })
    if (lv.target != null) out.push({ price: lv.target, color: '#2faf68', lineStyle: 2, title: `Target ${fmtNum(lv.target)}` })
    return out.length ? out : null
  }, [sel])

  if (error) return <div className={styles.empty}>Could not load the review queue ({error.message}).</div>
  if (!data) return <div className={styles.empty}>Loading the review queue…</div>

  const showChart = itemHasChartView(sel)
  const imageUrl = sel?.prompt_json?.image_url || null
  const prov = provenanceOf(sel)
  const forward = forwardSummaryOf(sel)
  const checks = checksOf(sel)
  const selStatus = sel ? statusOf(sel) : null
  const reviewed = Object.keys(localStatus).filter((id) => drafts.some((d) => d.id === id)).length

  return (
    <div className={styles.wrap}>
      <div className={styles.rail}>
        <div className={styles.trustStrip} data-testid="trust-strip" aria-label="Trust per item type">
          {typesSeen.length === 0 && <span className={styles.trustEmpty}>No types yet.</span>}
          {typesSeen.map((t) => {
            const tr = trustFor(t)
            return (
              <span key={t} className={`${styles.trustRow} ${tr.state === 'sampled' ? styles.trustSampled : ''}`}>
                <span className={styles.trustType}>{t}</span>
                <span className={styles.trustState}>{tr.state === 'sampled' ? 'sampled' : 'manual'}</span>
                <span className={styles.trustCount}>{Number(tr.clean_count) || 0} clean</span>
              </span>
            )
          })}
        </div>

        <div className={styles.filters}>
          <label className={styles.filter}>
            <span>Lane</span>
            <select aria-label="Lane" className={styles.select} value={lane}
              onChange={(e) => { setLane(e.target.value); setSelId(null) }}>
              <option value="">All lanes ({countFor('', type)})</option>
              {LANES.map((l) => <option key={l} value={l}>{l} ({countFor(l, type)})</option>)}
            </select>
          </label>
          <label className={styles.filter}>
            <span>Type</span>
            <select aria-label="Item type" className={styles.select} value={type}
              onChange={(e) => { setType(e.target.value); setSelId(null) }}>
              <option value="">All types ({countFor(lane, '')})</option>
              {typesSeen.map((t) => <option key={t} value={t}>{t} ({countFor(lane, t)})</option>)}
            </select>
          </label>
          <label className={`${styles.filter} ${styles.filterWide}`}>
            <span>Skill</span>
            <select aria-label="Skill" className={styles.select} value={skill}
              onChange={(e) => { setSkill(e.target.value); setSelId(null) }}>
              <option value="">All skills</option>
              {Object.keys(skills).sort().map((sk) => (
                <option key={sk} value={sk}>{sk || '(none)'} ({Number(skills[sk]) || 0})</option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.progress} data-testid="study-progress">
          {reviewed} of {drafts.length} reviewed this sitting · {countFor('', '')} drafts waiting
        </div>

        <div className={styles.list}>
          {drafts.length === 0 && <div className={styles.empty}>Nothing in this lane.</div>}
          {drafts.map((d) => {
            const st = statusOf(d)
            return (
              <button key={d.id} type="button"
                className={`${styles.row} ${sel && d.id === sel.id ? styles.rowActive : ''}`}
                onClick={() => { setSelId(d.id); setStatus(null) }}>
                <span className={styles.rowSym}>{d.sym || d.type}</span>
                <span className={styles.rowType}>{d.type} · {d.review_lane || 'manual'}</span>
                <span className={styles.rowDate}>{d.asof || ''}</span>
                <span className={st ? styles[`st_${st}`] : styles.stTodo}>{st ? STATUS_WORD[st] : 'to do'}</span>
              </button>
            )
          })}
        </div>

        <a className={styles.exportLink} href={EXPORT_URL} target="_blank" rel="noopener noreferrer">
          <UIcon name="download" size={14} /> Export corrections
        </a>
      </div>

      <div className={styles.card}>
        {!sel && <div className={styles.empty}>Nothing to review in this lane.</div>}
        {sel && (
          <>
            {askTrust && (
              <div className={styles.trustBanner} role="status" data-testid="trust-banner">
                <span>
                  You have approved {trust.clean_count} clean {sel.type} items in a row. Switch {sel.type} to
                  auto-approve with a {Math.round(SAMPLE_RATE * 100)}% sample?
                </span>
                <span className={styles.trustActions}>
                  <button type="button" className={styles.yes} onClick={() => switchTrust(sel.type)}>Yes</button>
                  <button type="button" onClick={() => setDismissed((s) => new Set([...s, sel.type]))}>Not yet</button>
                </span>
              </div>
            )}

            <div className={styles.head}>
              <span className={styles.sym} data-testid="study-ticker">{sel.sym || '(no ticker)'}</span>
              <span className={styles.type}>{sel.type}</span>
              <span className={styles.lane}>{sel.review_lane || 'manual'}</span>
              {sel.asof && (
                <span className={styles.dates} data-testid="study-dates">
                  {frame?.entryDate ? `${frame.entryDate} to ` : ''}{sel.asof}
                  {frame ? ` · forward ${frame.forward} sessions` : ''}
                </span>
              )}
              <span className={styles.position}>{selIdx + 1} / {drafts.length}</span>
            </div>

            {showChart && (
              <>
                <div className={styles.chartWrap} data-testid="study-chart">
                  <StockChart
                    sym={sel.sym}
                    tf={storedBars?.tf || sel.prompt_json?.chart?.tf || sel.prompt_json?.tf || 'D'}
                    studyMode
                    barsOverride={chartBars}
                    barsOverridePending={chartBarsPending}
                    liveUpdates={false}
                    backgroundWarm={false}
                    frozen
                    hideWatermark
                    showBrandMark={false}
                    disablePatterns
                    hideJournalOverlay
                    hideCompare
                    showDrawingTools={false}
                    entryDate={frame?.entryDate || null}
                    exitDate={frame?.exitDate || null}
                    exactDateRange
                    settingsOverride={settingsOverride}
                    markers={markers}
                    priceLines={priceLines}
                  />
                </div>
                <p className={styles.strip}>
                  Member sees bars through {sel.asof}. The {frame?.forward} sessions after it are the forward
                  strip, printed on the same chart at reveal.
                  {storedBarsError ? ' No stored bars for this item: the import left it unresolved.' : ''}
                </p>
              </>
            )}
            {imageUrl && (
              <img className={styles.image} src={imageUrl}
                alt={sel.prompt_json?.image_alt || `Scans image for ${sel.sym || sel.id}`} />
            )}

            {mode !== 'fix' && (
              <>
                <h2 className={styles.question}>{questionOf(sel) || '(no question text)'}</h2>
                {choices.length > 0 && (
                  <ol className={styles.choices} aria-label="Choices">
                    {choices.map((c, i) => {
                      const isKey = norm(c) === keyNorm
                      return (
                        <li key={`${i}-${c}`} className={isKey ? styles.choiceKey : styles.choice}
                          data-key={isKey ? '1' : '0'}>
                          <span className={styles.choiceN}>{i + 1}</span>
                          <span className={styles.choiceText}>{c}</span>
                          {isKey && <span className={styles.keyMark}><UIcon name="check" size={12} /> {KEY_MARK}</span>}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {(!choices.length || !keyIsChoice) && (
                  <p className={styles.keyBox}>
                    <span className={styles.label}>Key</span>
                    <code>{keyText(sel) || '(none)'}</code>
                  </p>
                )}
              </>
            )}

            {mode === 'fix' && (
              <div className={styles.fix} data-testid="fix-editor">
                <label className={styles.fixField}>
                  <span className={styles.label}>Question</span>
                  <input className={styles.input} aria-label="Question" value={fixQ} onChange={(e) => setFixQ(e.target.value)} />
                </label>
                {choices.length > 0 && (
                  <label className={styles.fixField}>
                    <span className={styles.label}>Choices (one per line)</span>
                    <Textarea aria-label="Choices" className={styles.textarea} value={fixChoices}
                      onChange={(e) => setFixChoices(e.target.value)} />
                  </label>
                )}
                <label className={styles.fixField}>
                  <span className={styles.label}>Answer</span>
                  {keyIsChoice ? (
                    <select aria-label="Answer" className={styles.select} value={fixAnswer}
                      onChange={(e) => setFixAnswer(e.target.value)}>
                      {fixChoices.split('\n').map((s) => s.trim()).filter(Boolean).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <Textarea aria-label="Answer" className={styles.textarea} value={fixAnswer}
                      onChange={(e) => setFixAnswer(e.target.value)} />
                  )}
                </label>
                <label className={styles.fixField}>
                  <span className={styles.label}>Lesson</span>
                  <Textarea aria-label="Lesson" className={styles.textarea} value={fixLesson}
                    onChange={(e) => setFixLesson(e.target.value)} />
                </label>
                <div className={styles.fixActions}>
                  <button type="button" className={styles.fixed} disabled={saving} onClick={saveFix}>Save fix</button>
                  <button type="button" disabled={saving} onClick={() => { resetEditors(sel); setMode('view') }}>Cancel</button>
                  <span className={styles.keys}>Enter saves · Esc cancels</span>
                </div>
              </div>
            )}

            {prov && (
              <p className={styles.prov} data-testid="study-provenance">
                <span className={styles.label}>{prov.kind === 'quote' ? 'Source says' : 'Provenance'}</span>
                {prov.kind === 'quote' ? <q>{prov.text}</q> : <span>{prov.text}</span>}
              </p>
            )}
            {(sel.source_kind || sel.source_ref) && (
              <p className={styles.provLine}>
                {[sel.source_kind, sel.source_ref].filter(Boolean).join(' · ')}
                {sel.adjustment_basis ? ` · ${sel.adjustment_basis}` : ''}
              </p>
            )}
            {forward && (
              <p className={styles.forward} data-testid="study-forward">
                <span className={styles.label}>Forward strip</span>
                <span>{forward}</span>
              </p>
            )}
            {mode !== 'fix' && (
              <p className={styles.lesson} data-testid="study-lesson">
                <span className={styles.label}>Lesson</span>
                <span>{sel.lesson_text || '(no lesson text)'}</span>
                {sel.lesson_origin && <span className={styles.origin}>{sel.lesson_origin}</span>}
              </p>
            )}

            <Chips checks={checks} />

            {mode === 'reject' && (
              <div className={styles.reject} data-testid="reject-panel">
                <span className={styles.label}>Why?</span>
                <div className={styles.reasonChips} role="radiogroup" aria-label="Reject reason">
                  {REJECT_REASONS.map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={rejectChip === r}
                      className={`${styles.reasonChip} ${rejectChip === r ? styles.reasonChipOn : ''}`}
                      onClick={() => setRejectChip(r)}>{r}</button>
                  ))}
                </div>
                <input className={styles.input} aria-label="Reject note" placeholder="Anything else (optional)"
                  value={rejectText} onChange={(e) => setRejectText(e.target.value)} />
                <div className={styles.fixActions}>
                  <button type="button" className={styles.rejectBtn} disabled={saving || !rejectChip} onClick={confirmReject}>
                    Confirm reject
                  </button>
                  <button type="button" disabled={saving} onClick={() => setMode('view')}>Cancel</button>
                  <span className={styles.keys}>Enter confirms · Esc cancels</span>
                </div>
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.approve} disabled={saving || mode !== 'view'} onClick={approve}>
                <kbd>A</kbd> Approve
              </button>
              <button type="button" className={styles.fixed} disabled={saving || mode === 'fix'}
                onClick={() => { setMode('fix'); setStatus(null) }}>
                <kbd>F</kbd> Fix
              </button>
              <button type="button" className={styles.rejectBtn} disabled={saving || mode === 'reject'}
                onClick={() => { setMode('reject'); setStatus(null) }}>
                <kbd>R</kbd> Reject
              </button>
              <span className={styles.nav}>
                <button type="button" aria-label="Previous item" disabled={selIdx <= 0} onClick={() => go(-1)}>
                  <kbd>P</kbd> Prev
                </button>
                <button type="button" aria-label="Next item" disabled={selIdx >= drafts.length - 1} onClick={() => go(1)}>
                  <kbd>N</kbd> Next
                </button>
              </span>
            </div>
            {selStatus && <div className={styles.doneNote}>This item is {STATUS_WORD[selStatus]} in this sitting.</div>}
            {status && (
              <div role="status" className={status.kind === 'error' ? styles.err : styles.saved}>{status.text}</div>
            )}

            <div className={styles.footer} data-testid="study-ids">
              item {sel.id} · v{sel.version ?? 1} · skill {sel.skill_id || '-'} · lane {sel.review_lane || 'manual'}
              {' · '}source_ref {sel.source_ref || '-'} · detection {detectionIdOf(sel) || '-'} · bars {sel.bars_ref || '-'}
            </div>
            <div className={styles.keys}>Keys: A approve · F fix · R reject · Enter confirm · N next · P previous</div>
          </>
        )}
      </div>
    </div>
  )
}
