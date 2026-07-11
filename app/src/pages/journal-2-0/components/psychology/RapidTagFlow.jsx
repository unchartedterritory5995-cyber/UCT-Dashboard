/**
 * RapidTagFlow — Journal 2.0 P5, Task A11.
 *
 * A quick, one-trade-at-a-time flow for import-only users who never tagged their
 * trades. Launched from the Psychology section's empty-state pitch card (A9), it
 * loads the user's last ~20 CLOSED trades (newest-first) and walks through them:
 * each screen shows the trade's identity (symbol · side · P&L · exit date) plus
 * two `TagChipPicker`s (mistakes + emotions). "Skip" advances without saving;
 * "Save & next" PATCHes `/api/j2/trades/{id}` with `{mistakeTags, emotionTags}`
 * (optimistic — reflected into the local list; an error surfaces inline but keeps
 * the flow usable). Finishing the last trade (or the explicit finish action) calls
 * `onComplete`, which the parent uses to revalidate `/api/j2/analytics` so the
 * Psychology panels come alive.
 *
 * VOCAB FALLBACK: the pickers read the per-account taxonomy from settings
 * (`settings.mistakeTags` / `settings.emotionTags`). A user who never customized
 * may have an empty list — so an empty taxonomy falls back to the STANDARD firm
 * lists (copied from PortfolioSettingsModal.jsx; keep in sync if those change).
 *
 * Presentation lives in a responsive `Sheet` (centered modal on desktop,
 * bottom-sheet on touch) — focus, Escape-to-close and scroll-lock come for free.
 * NO emoji.
 */

import { useCallback, useEffect, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import TagChipPicker from '../TagChipPicker'
import TagSuggestions from '../trade/TagSuggestions'
import useJ2Settings from '../../hooks/useJ2Settings'
import useTagSuggestions from '../../hooks/useTagSuggestions'
import { useFeatureFlag } from '../../featureFlags'
import { moneySigned, dateShort } from '../../../../lib/journal-2-0'
import styles from './RapidTagFlow.module.css'

// Standard firm taxonomy — the fallback when a user's per-account list is empty.
// Copied verbatim from PortfolioSettingsModal.jsx (STANDARD_MISTAKES /
// STANDARD_EMOTIONS); if those lists change, update here too.
const STANDARD_MISTAKES = [
  'overtrading', 'FOMO', 'chasing', 'early_exit', 'late_entry',
  'no_stop', 'oversized', 'countertrend', 'revenge', 'ignored_thesis',
  'added_to_loser', 'cut_winner', 'broke_loss_rule', 'broke_size_rule',
  'broke_checklist', 'boredom', 'hesitation',
]
const STANDARD_EMOTIONS = [
  'confident', 'anxious', 'greedy', 'fearful', 'calm', 'frustrated',
  'euphoric', 'bored', 'disciplined', 'impulsive', 'patient', 'rushed',
  'focused', 'distracted', 'revenge-driven',
]

const MAX_TRADES = 20

async function patchTags(id, body) {
  const res = await fetch(`/api/j2/trades/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `${res.status}`
    try { const j = await res.json(); if (j?.detail) msg = j.detail } catch { /* non-JSON */ }
    throw new Error(msg)
  }
  return res.json()
}

export default function RapidTagFlow({ open, onClose, onComplete }) {
  const { settings, accountId } = useJ2Settings()

  const [trades, setTrades] = useState(null)   // null = loading · [] = none · [...] = list
  const [loadError, setLoadError] = useState(null)
  const [index, setIndex] = useState(0)
  const [mistakeSel, setMistakeSel] = useState([])
  const [emotionSel, setEmotionSel] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Load the last ~20 closed trades when opened (the API returns closed
  // newest-first; we just cap the count). Cancel-safe against a fast re-close.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setTrades(null)
    setLoadError(null)
    setIndex(0)
    const qs = new URLSearchParams()
    if (accountId) qs.set('account_id', accountId)
    qs.set('limit', String(MAX_TRADES))
    fetch(`/api/j2/trades?${qs.toString()}`, { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data?.trades) ? data.trades.slice(0, MAX_TRADES) : []
        setTrades(list)
      })
      .catch((e) => {
        if (cancelled) return
        setLoadError(String(e.message || e))
        setTrades([])
      })
    return () => { cancelled = true }
  }, [open, accountId])

  const total = Array.isArray(trades) ? trades.length : 0
  const current = Array.isArray(trades) ? trades[index] : null
  const isLast = index >= total - 1

  // Seed the pickers from the current trade's existing tags whenever we land on
  // a new trade (import-only trades start empty; re-visits show prior saves).
  useEffect(() => {
    setMistakeSel(Array.isArray(current?.mistakeTags) ? current.mistakeTags : [])
    setEmotionSel(Array.isArray(current?.emotionTags) ? current.emotionTags : [])
    setSaveError(null)
  }, [current?.id])

  const mistakeVocab = settings?.mistakeTags?.length ? settings.mistakeTags : STANDARD_MISTAKES
  const emotionVocab = settings?.emotionTags?.length ? settings.emotionTags : STANDARD_EMOTIONS

  // Deterministic AI-suggested tags for the trade in view (P6-4). Skip the
  // fetch when the flag is off; accepting a chip folds into the local selection.
  const tagSuggestOn = useFeatureFlag('tagSuggest')
  const { suggestions: tagSuggestions } = useTagSuggestions(
    tagSuggestOn ? (current?.id || null) : null,
  )

  const finish = useCallback(() => {
    if (onComplete) onComplete()
    else onClose?.()
  }, [onComplete, onClose])

  const advance = useCallback(() => {
    if (index >= total - 1) finish()
    else setIndex((i) => i + 1)
  }, [index, total, finish])

  const saveAndNext = useCallback(async () => {
    if (!current || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await patchTags(current.id, { mistakeTags: mistakeSel, emotionTags: emotionSel })
      // Reflect the save into the local list so a re-visit shows the tags.
      setTrades((cur) => (Array.isArray(cur)
        ? cur.map((t, i) => (i === index
          ? { ...t, mistakeTags: mistakeSel, emotionTags: emotionSel }
          : t))
        : cur))
      setSaving(false)
      advance()
    } catch (e) {
      setSaving(false)
      setSaveError(String(e.message || e))
      // Keep the flow usable — do NOT advance past an unsaved trade.
    }
  }, [current, saving, mistakeSel, emotionSel, index, advance])

  // ── body + footer per state ────────────────────────────────────────────────
  let body
  let footer = null

  if (loadError) {
    body = (
      <div className={styles.state}>
        <p className={styles.stateText}>Couldn&apos;t load your trades — {loadError}.</p>
      </div>
    )
    footer = (
      <button type="button" className={styles.primaryBtn} onClick={onClose}>Close</button>
    )
  } else if (trades === null) {
    body = (
      <div className={styles.state}>
        <p className={styles.stateText}>Loading your recent trades…</p>
      </div>
    )
  } else if (total === 0) {
    body = (
      <div className={styles.state}>
        <p className={styles.stateText}>No closed trades to tag yet.</p>
        <p className={styles.stateSub}>
          Once you have closed trades, come back here to tag them and light up the
          Psychology section.
        </p>
      </div>
    )
    footer = (
      <button type="button" className={styles.primaryBtn} onClick={onClose}>Done</button>
    )
  } else if (current) {
    const pnl = current.pnlDollarNet ?? current.pnlDollar
    const pnlClass = Number.isFinite(pnl) && pnl !== 0
      ? (pnl > 0 ? styles.pos : styles.neg)
      : ''
    const pct = total > 0 ? Math.round(((index + 1) / total) * 100) : 0

    body = (
      <div className={styles.flow}>
        <div className={styles.progressRow}>
          <span className={styles.progressCount}>{index + 1} / {total}</span>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className={styles.identity}>
          <span className={styles.symbol}>{current.symbol}</span>
          {current.side && <span className={styles.side}>{current.side}</span>}
          {Number.isFinite(pnl) && (
            <span className={`${styles.pnl} ${pnlClass}`}>{moneySigned(pnl)}</span>
          )}
          {current.exitDate && (
            <span className={styles.exitDate}>exit {dateShort(current.exitDate)}</span>
          )}
        </div>

        <TagSuggestions
          suggestions={tagSuggestions}
          currentMistakes={mistakeSel}
          currentEmotions={emotionSel}
          onAcceptMistake={(tag) =>
            setMistakeSel((cur) => (cur.includes(tag) ? cur : [...cur, tag]))}
          onAcceptEmotion={(tag) =>
            setEmotionSel((cur) => (cur.includes(tag) ? cur : [...cur, tag]))}
        />

        <div className={styles.pickerGroup}>
          <span className={styles.pickerLabel}>Mistakes</span>
          <TagChipPicker
            available={mistakeVocab}
            selected={mistakeSel}
            onChange={setMistakeSel}
            placeholder="No mistake tags configured."
          />
        </div>

        <div className={styles.pickerGroup}>
          <span className={styles.pickerLabel}>How it felt</span>
          <TagChipPicker
            available={emotionVocab}
            selected={emotionSel}
            onChange={setEmotionSel}
            placeholder="No emotion tags configured."
          />
        </div>

        {saveError && (
          <p className={styles.saveError} role="alert">Couldn&apos;t save — {saveError}.</p>
        )}
      </div>
    )

    footer = (
      <div className={styles.footerRow}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={advance}
          disabled={saving}
        >
          {isLast ? 'Finish' : 'Skip'}
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={saveAndNext}
          disabled={saving}
        >
          {saving ? 'Saving…' : isLast ? 'Save & finish' : 'Save & next'}
        </button>
      </div>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Tag recent trades"
      footer={footer}
      maxWidth={520}
    >
      {body}
    </Sheet>
  )
}
