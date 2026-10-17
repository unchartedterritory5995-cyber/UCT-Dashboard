/**
 * ChecklistFromWinners — "Checklist from my winners" in Insights (P2 Tier 3, Task 6).
 *
 * Reads `GET /api/j2/insights/checklist-suggestions` (api/services/journal_two/checklist_suggestions.py):
 * the emotion tags that ride on the member's best winning trades far more than on the rest. Each
 * suggestion shows its share line, the best trades carrying it (each a link to its trade page) and
 * an `Add to my checklist` button. NOTHING IS WRITTEN UNTIL THE MEMBER CHOOSES IT.
 *
 * ACCEPTING IS TWO WRITES, BOTH THROUGH DOORS THAT ALREADY EXIST (ruling R-T3-V4):
 *   1. the rules create door, `useJournalRules(accountId).create` (POST /api/j2/accounts/{id}/rules),
 *      the one MakeRuleButton uses;
 *   2. the rule edit door, `rulesApi.editRule` (PUT /api/j2/trader-blocks/rules/{id}), to mark it
 *      before entry, because the create door cannot.
 * If the second fails the panel says MARK_FAILED_TEXT and its Try again repeats ONLY the PUT. It never
 * deletes the rule: the member's words were saved, and only the before-entry mark is missing.
 *
 * The confirm is MakeRuleButton's shape (label editable, the evidence line read-only, one confirm),
 * built here because MakeRuleButton takes no pre-filled label. MakeRuleButton is unchanged.
 *
 * ⛔ LAZY ONLY. InsightsHub mounts this through `lazyLeaf`, and only while `tier3Enabled()`, so it never
 * rides the Notebook's first open. The switch lives in InsightsHub, once.
 *
 * ⛔ Every message lives in the PANEL, never inside a suggestion: an accepted suggestion leaves the
 * list, so a host inside it would be torn down by its own success. No emoji: UIcon only.
 */

import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import useJournalRules from '../../hooks/useJournalRules'
import { editRule } from '../../lib/blocks/rulesApi'
import styles from './ChecklistFromWinners.module.css'

export const TITLE = 'Checklist from my winners'
export const TOO_FEW_TEXT = 'Log at least 10 winning trades and this will suggest checklist items from them.'
export const ADDED_TEXT = 'Added. It will show in your pre-entry checklist.'
export const CREATE_FAILED_TEXT = "Couldn't add that rule. Nothing was changed."
export const MARK_FAILED_TEXT = "Added the rule, but couldn't mark it for before entry. Try again."
export const NONE_TEXT = 'No habit stands out on your best trades right now.'
export const NO_ACCOUNT_TEXT = 'Pick one account to add these to its pre-entry checklist.'
export const LOAD_FAILED_TEXT = "Couldn't load suggestions right now."

const URL = '/api/j2/insights/checklist-suggestions'
const LABEL_MAX = 140 // MakeRuleButton's input cap

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const fmtDay = (day) => {
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? day : DAY.format(d)
}
const fmtR = (r) => `${r > 0 ? '+' : ''}${Number(r).toFixed(2)}R`
const tradeHref = (id) => `/journal-2-0/trade/${encodeURIComponent(id)}`

/** `On 9 of your 20 best trades (45%) · on 12% of the rest` */
export function shareLine(suggestion, bestCount) {
  const n = suggestion.evidence?.length || 0
  return `On ${n} of your ${bestCount} best trades (${pct(suggestion.shareBest)}) · on ${pct(suggestion.shareOthers)} of the rest`
}

export default function ChecklistFromWinners({ accountId }) {
  const url = accountId ? `${URL}?account_id=${encodeURIComponent(accountId)}` : URL
  const { data, error, isLoading } = useSWR(url, fetcher, { revalidateOnFocus: false, shouldRetryOnError: false })
  const { create, mutate: rereadRules } = useJournalRules(accountId || null)
  const baseId = useId()

  const [openTag, setOpenTag] = useState(null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(() => new Set()) // tags whose rule exists (added, or added and waiting on the mark)
  const [pending, setPending] = useState([]) // [{tag, ruleId, retrying}] the PUT still owed
  const [notice, setNotice] = useState(null) // {kind: 'ok' | 'error', text}

  const markDone = useCallback((tag) => setDone((prev) => new Set(prev).add(tag)), [])

  const open = useCallback((s) => {
    setOpenTag(s.tag)
    setLabel(s.label)
    setNotice(null)
  }, [])

  const accept = useCallback(async (s, evidence) => {
    const text = label.trim()
    if (!text || saving) return
    setSaving(true)
    setNotice(null)
    const rule = await create({ label: text, evidence, sourceType: 'psychology', sourceId: s.tag })
    if (!rule) {
      setSaving(false)
      setNotice({ kind: 'error', text: CREATE_FAILED_TEXT })
      return
    }
    // The rule exists from here on: the suggestion leaves the list whatever the mark does.
    markDone(s.tag)
    setOpenTag(null)
    const marked = await editRule(rule.id, { beforeEntry: true })
    setSaving(false)
    if (marked.ok) {
      rereadRules()
      setNotice({ kind: 'ok', text: ADDED_TEXT })
    } else {
      setPending((prev) => [...prev, { tag: s.tag, ruleId: rule.id, retrying: false }])
    }
  }, [label, saving, create, markDone, rereadRules])

  const retryMark = useCallback(async (ruleId) => {
    setPending((prev) => prev.map((p) => (p.ruleId === ruleId ? { ...p, retrying: true } : p)))
    const marked = await editRule(ruleId, { beforeEntry: true })
    if (marked.ok) {
      setPending((prev) => prev.filter((p) => p.ruleId !== ruleId))
      rereadRules()
      setNotice({ kind: 'ok', text: ADDED_TEXT })
    } else {
      setPending((prev) => prev.map((p) => (p.ruleId === ruleId ? { ...p, retrying: false } : p)))
    }
  }, [rereadRules])

  const bestCount = data?.bestCount || 0
  const visible = (data?.suggestions || []).filter((s) => !done.has(s.tag))

  return (
    <section className={styles.panel} aria-labelledby={`${baseId}-title`}>
      <h4 id={`${baseId}-title`} className={styles.title}>{TITLE}</h4>
      <p className={styles.sub}>
        Emotion tags that show up far more on your best winning trades than on the rest. Nothing is
        added until you choose it.
      </p>

      {/* The panel's feedback host: it outlives every control that writes to it. */}
      <div className={styles.feedback}>
        {notice?.kind === 'ok' && (
          <p role="status" className={styles.ok}>
            <UIcon name="check" size={14} gold={false} className={styles.okGlyph} />
            <span>{notice.text}</span>
          </p>
        )}
        {notice?.kind === 'error' && <p role="alert" className={styles.err}>{notice.text}</p>}
        {pending.map((p) => (
          <div key={p.ruleId} role="alert" className={styles.pending}>
            <span>{MARK_FAILED_TEXT}</span>
            <button
              type="button"
              className={styles.retry}
              onClick={() => retryMark(p.ruleId)}
              disabled={p.retrying}
              aria-label={`Try again to mark "${p.tag}" for before entry`}
            >
              {p.retrying ? 'Trying…' : 'Try again'}
            </button>
          </div>
        ))}
      </div>

      {isLoading && !data ? (
        <p className={styles.muted}>Reading your best trades…</p>
      ) : error ? (
        <p className={styles.muted}>{LOAD_FAILED_TEXT}</p>
      ) : data?.status === 'too_few' ? (
        <p className={styles.empty}>{TOO_FEW_TEXT}</p>
      ) : visible.length === 0 ? (
        <p className={styles.empty}>{NONE_TEXT}</p>
      ) : (
        <>
          {!accountId && <p className={styles.muted}>{NO_ACCOUNT_TEXT}</p>}
          <ul className={styles.list}>
            {visible.map((s) => {
              const line = shareLine(s, bestCount)
              const isOpen = openTag === s.tag
              return (
                <li key={s.tag} className={styles.item}>
                  <div className={styles.itemHead}>
                    <span className={styles.tag}>{s.tag}</span>
                    <span className={styles.share}>{line}</span>
                  </div>
                  <ul className={styles.evidence} aria-label={`Best trades tagged ${s.tag}`}>
                    {s.evidence.map((e) => (
                      <li key={e.tradeId}>
                        <Link className={styles.trade} to={tradeHref(e.tradeId)}>
                          {e.symbol} · {fmtDay(e.exitDate)} · {fmtR(e.r)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {accountId && (
                    <button
                      type="button"
                      className={styles.add}
                      onClick={() => (isOpen ? setOpenTag(null) : open(s))}
                      aria-expanded={isOpen}
                    >
                      <UIcon name="shield" size={13} />
                      <span>Add to my checklist</span>
                    </button>
                  )}
                  {isOpen && (
                    <div className={styles.pop} role="dialog" aria-label={`Add "${s.tag}" to your checklist`}>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={`${baseId}-rule`}>Your rule</label>
                        <input
                          id={`${baseId}-rule`}
                          type="text"
                          className={styles.input}
                          value={label}
                          onChange={(ev) => setLabel(ev.target.value)}
                          maxLength={LABEL_MAX}
                          autoFocus
                        />
                      </div>
                      <p className={styles.evidenceLine}>{line}</p>
                      <div className={styles.actions}>
                        <button type="button" className={styles.cancel} onClick={() => setOpenTag(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={styles.save}
                          onClick={() => accept(s, line)}
                          disabled={saving || !label.trim()}
                        >
                          {saving ? 'Saving…' : 'Save rule'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
