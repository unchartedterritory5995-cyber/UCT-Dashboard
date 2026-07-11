/**
 * EdgeScoreCard — the Weekly Edge Score shareable card (P3 Task B5).
 *
 * The direct, honest answer to the "Zella Score": a branded dark/gold card that
 * renders the backend `edgeScore` composite
 *   { score, components: { winRate, profitFactor, rConsistency, tradeCount } }
 * (from `analytics.py::_edge_score`) — a big hero number, the
 * `= Win Rate × Profit Factor × R-Consistency` formula, and the 4 components,
 * each through `<ConfidenceStat>` so any stat behind n<10 trades reads dimmed
 * with the "n=X, need 10" affordance (Global Constraint: confidence = 10).
 *
 * ── Null score (n<10 or no R-multiples) ──────────────────────────────────────
 * The backend nulls `score` until tradeCount ≥ 10 AND rConsistency exists. We
 * do NOT fabricate a number: the hero slot renders a dim em-dash + the honest
 * "Need 10+ trades with R-multiples to compute" copy, while whatever components
 * DO exist (win rate / trade count) still render so the user sees progress.
 *
 * ── Share (Copy link) ────────────────────────────────────────────────────────
 * A "Copy link" button copies a shareable URL to THIS scoped Edge view:
 *   {origin}/journal?j2tab=analytics&ins=edge&<current scope's sc_* params>
 * The `sc_*` params come from the A6 codec (`scopeToSearchParams`) so a
 * recipient lands on the same Edge hub section with the same Scope. Clipboard
 * absence is guarded (older browsers / tests) → a "copy failed" hint, never a
 * crash. A transient "Copied!" confirmation clears after ~2s.
 *
 * The card is self-contained so it reads well both as the Edge hub section AND
 * standalone (screenshot / share). NO emoji — every glyph is a `<UIcon>`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import ConfidenceStat from '../analytics/ConfidenceStat'
import useScope from '../../hooks/useScope'
import { scopeToSearchParams } from '../../../../lib/journal-2-0/scope'
import { useFeatureFlag } from '../../featureFlags'
import { renderEdgeCardPng } from '../../lib/edgeCardPng'
import { downloadBlob, copyBlobToClipboard } from '../../../../components/chart/chartScreenshot'
import styles from './EdgeScoreCard.module.css'

const CONF_MIN = 10
const COPY_RESET_MS = 2000

// ── formatters ────────────────────────────────────────────────────────────────
const fmtScore = (v) => Number(v).toFixed(3)
const fmtPct1 = (v) => `${(v * 100).toFixed(1)}%`
const fmtPct0 = (v) => `${(v * 100).toFixed(0)}%`
const fmtPF = (v) => (v >= 5 ? '5.0+' : Number(v).toFixed(2))
const fmtInt = (v) => String(v)

/**
 * Build the shareable, scoped Edge-view URL. Always carries the hub deep-link
 * (`j2tab=analytics` + `ins=edge`); the current scope's `sc_*` params are
 * appended verbatim from the A6 codec so the recipient's scope matches.
 */
function buildShareUrl(scope) {
  const params = new URLSearchParams()
  params.set('j2tab', 'analytics')
  params.set('ins', 'edge')
  for (const [k, v] of scopeToSearchParams(scope).entries()) params.set(k, v)
  const origin =
    typeof window !== 'undefined' && window.location && window.location.origin
      ? window.location.origin
      : ''
  return `${origin}/journal?${params.toString()}`
}

export default function EdgeScoreCard({ edge }) {
  const { scope } = useScope()
  // The `tradePng` flag is the shared "shareable images" gate (trade-card +
  // edge-card PNG). Copy-link is ALWAYS available; only the image actions gate.
  const pngEnabled = useFeatureFlag('tradePng')
  // null = idle · 'ok' = copied · 'fail' = clipboard unavailable/blocked
  const [copied, setCopied] = useState(null)
  const timerRef = useRef(null)
  // Image-action status: null = idle · 'saving'/'copying' = in-flight ·
  // 'saved'/'copied' = transient success · 'error' = render/clipboard failed.
  const [imgStatus, setImgStatus] = useState(null)
  const imgTimerRef = useRef(null)

  useEffect(() => () => {
    clearTimeout(timerRef.current)
    clearTimeout(imgTimerRef.current)
  }, [])

  const score = edge?.score
  const c = edge?.components || {}
  const hasScore = score != null
  const n = typeof c.tradeCount === 'number' ? c.tradeCount : 0
  const hasComponents = c.winRate != null || c.tradeCount != null
  // Only offer the image actions once there's a real score to share — the honest
  // null state hides them (cleaner than exporting a "not enough data" card).
  const showImageActions = pngEnabled && hasScore

  const onCopy = useCallback(async () => {
    const url = buildShareUrl(scope)
    let ok = false
    try {
      if (
        typeof navigator !== 'undefined'
        && navigator.clipboard
        && typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(url)
        ok = true
      }
    } catch {
      ok = false
    }
    setCopied(ok ? 'ok' : 'fail')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(null), COPY_RESET_MS)
  }, [scope])

  const flashImg = useCallback((status) => {
    setImgStatus(status)
    clearTimeout(imgTimerRef.current)
    imgTimerRef.current = setTimeout(() => setImgStatus(null), COPY_RESET_MS)
  }, [])

  const onSaveImage = useCallback(async () => {
    setImgStatus('saving')
    try {
      const blob = await renderEdgeCardPng(edge)
      downloadBlob(blob, 'edge-score.png')
      flashImg('saved')
    } catch {
      flashImg('error')
    }
  }, [edge, flashImg])

  const onCopyImage = useCallback(async () => {
    setImgStatus('copying')
    try {
      const blob = await renderEdgeCardPng(edge)
      const ok = await copyBlobToClipboard(blob)
      flashImg(ok ? 'copied' : 'error')
    } catch {
      flashImg('error')
    }
  }, [edge, flashImg])

  return (
    <section className={styles.card} aria-label="Edge Score">
      <header className={styles.header}>
        <span className={styles.brandMark} aria-hidden="true">
          <UIcon name="compass" size={18} />
        </span>
        <div className={styles.titleWrap}>
          <span className={styles.eyebrow}>UCT Intelligence</span>
          <h3 className={styles.title}>Edge Score</h3>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.copyBtn}
            onClick={onCopy}
            aria-label="Copy link to this Edge view"
          >
            <UIcon name={copied === 'ok' ? 'check' : 'link'} size={14} gold={false} />
            <span>{copied === 'ok' ? 'Copied!' : 'Copy link'}</span>
          </button>
          {showImageActions && (
            <>
              <button
                type="button"
                className={styles.copyBtn}
                onClick={onSaveImage}
                disabled={imgStatus === 'saving' || imgStatus === 'copying'}
                aria-label="Save the Edge Score card as an image"
              >
                <UIcon name={imgStatus === 'saved' ? 'check' : 'download'} size={14} gold={false} />
                <span>{imgStatus === 'saved' ? 'Saved!' : 'Save as image'}</span>
              </button>
              <button
                type="button"
                className={styles.copyBtn}
                onClick={onCopyImage}
                disabled={imgStatus === 'saving' || imgStatus === 'copying'}
                aria-label="Copy the Edge Score card image"
              >
                <UIcon name={imgStatus === 'copied' ? 'check' : 'copy'} size={14} gold={false} />
                <span>{imgStatus === 'copied' ? 'Copied!' : 'Copy image'}</span>
              </button>
            </>
          )}
        </div>
      </header>

      <div className={styles.hero}>
        {hasScore ? (
          <span className={styles.score} data-testid="edge-score">
            {fmtScore(score)}
          </span>
        ) : (
          <span
            className={styles.scoreDim}
            data-testid="edge-score-null"
            aria-label="Edge Score not yet available"
          >
            —
          </span>
        )}
        {/* One text node so the formula's "Win Rate"/"Profit Factor" wording
            never collides with the ConfidenceStat component labels below. */}
        <p className={styles.formula}>
          <span className={styles.formulaEq}>=</span> Win Rate × Profit Factor ×
          R-Consistency
        </p>
      </div>

      {!hasScore && (
        <p className={styles.need}>
          Need 10+ trades with R-multiples to compute an Edge Score. Log stops so
          your trades carry an R-multiple — the number appears once the sample is
          honest.
        </p>
      )}

      {hasComponents && (
        <div className={styles.comps}>
          <div className={styles.comp}>
            <ConfidenceStat
              value={c.winRate}
              n={n}
              min={CONF_MIN}
              format={fmtPct1}
              label="Win Rate"
            />
          </div>
          <div className={styles.comp}>
            <ConfidenceStat
              value={c.profitFactor}
              n={n}
              min={CONF_MIN}
              format={fmtPF}
              label="Profit Factor"
            />
          </div>
          <div className={styles.comp}>
            <ConfidenceStat
              value={c.rConsistency}
              n={n}
              min={CONF_MIN}
              format={fmtPct0}
              label="R Consistency"
            />
          </div>
          <div className={styles.comp}>
            {/* Trade count is the sample itself — never "low confidence"; show it
                plainly (min=0) so it doesn't dim against its own threshold. */}
            <ConfidenceStat
              value={c.tradeCount}
              n={n}
              min={0}
              format={fmtInt}
              label="Trades"
            />
          </div>
        </div>
      )}

      <footer className={styles.footer}>
        {imgStatus === 'error' ? (
          <span className={styles.copyFail}>
            Couldn&apos;t create the image — please try again.
          </span>
        ) : copied === 'fail' ? (
          <span className={styles.copyFail}>
            Couldn&apos;t copy — select and copy the link manually.
          </span>
        ) : (
          <span className={styles.tagline}>Navigate the market, effectively.</span>
        )}
      </footer>
    </section>
  )
}
