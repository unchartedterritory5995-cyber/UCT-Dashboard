// app/src/pages/admin/PatternCanonicalProof.jsx
//
// Phase 8, Package 8G-C readiness — admin-only end-to-end canonical proof
// surface: real PEG detection -> canonical persistence -> canonical
// scanner/detail payload -> canonical geometry -> deterministic explanation
// -> real chart render, all in one admin-only view.
//
// Deliberately narrow and inert-by-construction:
//   - Reads TWO endpoints that already existed and are already admin-gated
//     (`/api/admin/patterns/recent`, `/api/patterns/admin/canonical-detail/{id}`)
//     — no new backend route, no schema change.
//   - Renders via StockChart's `forcedDetections`/`forcedShowPatterns` props
//     (additive, default-off, added alongside this page) — never flips the
//     persisted `showPatterns` chart_settings flag, never touches
//     ChartToolbar.jsx's dead public toggle, never activates
//     PATTERN_CANONICAL_SCANNER_PILOT_ENABLED.
//   - Not linked from anywhere an ordinary user reaches; gated the same way
//     every other `/admin/*` page in this app is (outer AuthGuard + each
//     fetch's own `require_admin` 403 for a non-admin who lands here anyway).
//
// This is a READ-ONLY diagnostic. It writes nothing.
import { useState } from 'react'
import useSWR from 'swr'
import StockChart from '../../components/StockChart'
import styles from './PatternCanonicalProof.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
})

function isoFromEpochSeconds(secs) {
  if (!secs) return null
  try {
    return new Date(secs * 1000).toISOString().slice(0, 10)
  } catch {
    return null
  }
}

function FactRow({ fact }) {
  const polarityClass =
    fact.polarity === 'supports' ? styles.factSupports :
    fact.polarity === 'weakens' ? styles.factWeakens :
    styles.factNeutral
  return (
    <div className={`${styles.factRow} ${polarityClass}`}>
      <span className={styles.factLabel}>{fact.label}</span>
      <span className={styles.factClaim}>{fact.claim_type}</span>
      <span className={styles.factEvidence}>{fact.supporting_evidence}</span>
    </div>
  )
}

function ExplanationPanel({ explanation }) {
  if (!explanation?.sections?.length) {
    return <div className={styles.emptyNote}>No structured explanation for this pattern_id — the builder only covers high_tight_flag and power_earnings_gap today.</div>
  }
  return (
    <div>
      {explanation.sections.map((s) => (
        <div key={s.section} className={styles.section}>
          <div className={styles.sectionTitle}>{s.section.replace(/_/g, ' ')}</div>
          {s.facts.map((f) => <FactRow key={f.fact_id} fact={f} />)}
        </div>
      ))}
    </div>
  )
}

function RecentPegPicker({ onPick }) {
  const { data, error, isLoading } = useSWR(
    '/api/admin/patterns/recent?hours=168', fetcher, { revalidateOnFocus: false }
  )
  if (isLoading) return <div className={styles.emptyNote}>Loading recent detections…</div>
  if (error) return <div className={styles.errorNote}>Could not load /api/admin/patterns/recent ({error.message}) — admin session required.</div>
  const pegRows = (data?.detections || []).filter((d) => d.pattern_id === 'power_earnings_gap')
  if (!pegRows.length) {
    return <div className={styles.emptyNote}>No power_earnings_gap detections in the last 7 days.</div>
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr><th>Sym</th><th>Detected</th><th>Confidence</th><th>Status</th><th /></tr>
      </thead>
      <tbody>
        {pegRows.slice(0, 25).map((d) => (
          <tr key={d.id}>
            <td>{d.sym}</td>
            <td>{new Date(d.detected_at * 1000).toLocaleString()}</td>
            <td>{d.confidence}</td>
            <td>{d.status}</td>
            <td><button onClick={() => onPick(d.id)}>View proof</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function PatternCanonicalProof() {
  const [manualId, setManualId] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const { data: detail, error, isLoading } = useSWR(
    selectedId ? `/api/patterns/admin/canonical-detail/${encodeURIComponent(selectedId)}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const forced = detail ? { ...detail, id: detail.detection_id } : null
  const focusDate = detail ? isoFromEpochSeconds(detail.last_seen_at || detail.detected_at) : null

  return (
    <div className={styles.page}>
      <div className={styles.banner}>
        Admin-only, read-only proof surface (Phase 8 Package 8G-C readiness).
        Not a production feature — invisible to every ordinary user, writes
        nothing, and does not activate the canonical scanner pilot or the
        general pattern-overlay toggle.
      </div>

      <div className={styles.pickerRow}>
        <div className={styles.pickerCol}>
          <h3>Recent Power Earnings Gap detections (7d)</h3>
          <RecentPegPicker onPick={setSelectedId} />
        </div>
        <div className={styles.pickerCol}>
          <h3>Or load a detection id directly</h3>
          <input
            className={styles.input}
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="detection id"
          />
          <button onClick={() => setSelectedId(manualId.trim())} disabled={!manualId.trim()}>Load</button>
        </div>
      </div>

      {selectedId && isLoading && <div className={styles.emptyNote}>Loading canonical detail for {selectedId}…</div>}
      {selectedId && error && <div className={styles.errorNote}>Could not load canonical detail: {error.message}</div>}

      {detail && (
        <div className={styles.proof}>
          <div className={styles.header}>
            <span className={styles.headerSym}>{detail.sym}</span>
            <span>{detail.pattern_name}</span>
            <span>{detail.status}</span>
            <span>confidence {detail.confidence}</span>
            <span className={styles.headerMeta}>source={detail.source} · contract={detail.contract_version}</span>
          </div>

          <div className={styles.chartWrap}>
            <StockChart
              sym={detail.sym}
              tf={detail.tf}
              liveUpdates={false}
              focusDate={focusDate}
              forcedDetections={forced ? [forced] : []}
              forcedShowPatterns
              hidePatterns
              hideReplay
              hideCompare
              hideCountdown
            />
          </div>

          <div className={styles.explanationWrap}>
            <h3>Structured explanation (deterministic, no LLM)</h3>
            <ExplanationPanel explanation={detail.explanation} />

            <details className={styles.rawDetails}>
              <summary>Raw eligibility / event / geometry (debug)</summary>
              <pre className={styles.rawPre}>{JSON.stringify({
                eligibility: detail.eligibility,
                event: detail.event,
                gate_trace_available: detail.gate_trace_available,
                geometry: detail.geometry,
              }, null, 2)}</pre>
            </details>
          </div>
        </div>
      )}
    </div>
  )
}
