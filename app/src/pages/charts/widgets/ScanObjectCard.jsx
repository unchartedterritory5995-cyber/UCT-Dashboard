// TERM-087 (item 14 WF-C12) — the product's editable object, BESIDE the prose.
//
// An AI Search answer to a screen-shaped question carries `scan_object`: the
// scan formula the builder's own concierge produced, or an honest refusal. This
// card shows it and opens it in the SHIPPED builder, where a member who
// disagrees with the answer edits one condition instead of re-asking in prose.
//
// ⛔ NO SECOND BUILDER, NO SECOND WRITE DOOR. "Open in builder" mounts the real
// `BuilderSheet` (lazy — a reader who never opens it never downloads the
// authoring bundle) on its Conditions tab with the formula written into its one
// source field via `initialDraft`. The sheet's own Save is the only write; this
// card saves nothing.
//
// ⛔ A REFUSAL SHOWS NO FORMULA AND NO DOOR. `readScanObject` has already
// refused anything less than a whole object the builder's validator accepts.
//
// ⚠️ INLINE STYLES over the shared tokens, the ConciergeBox convention: the card
// is dropped into a widget whose stylesheet belongs to that widget.

import { Suspense, lazy, useMemo, useState } from 'react'
import { readScanObject } from './scanObject'

const BuilderSheet = lazy(() => import('../../../components/chart/builder/BuilderSheet'))

/** The builder tab a member edits a SCREEN on (condition by condition). The
 *  sheet validates nothing about this name; `ScanObjectCard.test.jsx` asserts
 *  the sheet actually opens on the Conditions tab, so a rename reds there. */
const SCAN_TAB = 'picker'

const S = {
  card: {
    marginTop: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-surface)',
  },
  label: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)' },
  readback: { fontSize: 13, color: 'var(--text-bright)', lineHeight: 1.45 },
  source: {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12,
    color: 'var(--text)', wordBreak: 'break-word',
  },
  gap: { fontSize: 12, color: 'var(--text-muted)' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  button: {
    minHeight: 'var(--tap-min)', padding: '0 14px', cursor: 'pointer',
    background: 'var(--bg-elevated)', color: 'var(--text-bright)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 13,
  },
  refusal: { marginTop: 10, fontSize: 12, color: 'var(--text-muted)' },
  done: { fontSize: 12, color: 'var(--text-muted)' },
}

function GapList({ items, testid, lead }) {
  if (!items || items.length === 0) return null
  return (
    <div style={S.gap} data-testid={testid}>
      {lead}{' '}
      {items.map((item, i) => (
        <span key={`${testid}-${i}`}>
          {i > 0 ? '; ' : ''}“{(item && (item.clause || item.phrase || item.text)) || ''}”
          {item && item.reason ? ` — ${item.reason}` : ''}
        </span>
      ))}
    </div>
  )
}

export default function ScanObjectCard({ object }) {
  const view = useMemo(() => readScanObject(object), [object])
  // ⚠️ HELD IN STATE: `initialDraft` is a dependency of the sheet's open-reset,
  // so its identity must be stable for as long as the sheet is open.
  const [draft, setDraft] = useState(null)
  const [savedName, setSavedName] = useState(null)

  if (!view) return null

  if (!view.ok) {
    return (
      <div style={S.refusal} role="note" data-testid="scan-object-refusal" data-gate={view.gate}>
        Could not turn this into a scan you can edit: {view.reason}
      </div>
    )
  }

  return (
    <div style={S.card} data-testid="scan-object">
      <span style={S.label}>As a scan</span>
      <span style={S.readback}>{view.readback}</span>
      <code style={S.source} data-testid="scan-object-source">{view.source}</code>
      <GapList items={view.notUnderstood} testid="scan-object-not-understood"
        lead="Not included (could not read):" />
      <GapList items={view.unavailable} testid="scan-object-unavailable"
        lead="Not included (not screenable here):" />
      <div style={S.row}>
        <button
          type="button"
          style={S.button}
          onClick={() => setDraft({ source: view.source, importId: view.importId, dialect: 'ai-search' })}
        >
          Open in builder
        </button>
        {savedName && <span style={S.done} data-testid="scan-object-saved">Saved to My scans: {savedName}</span>}
      </div>
      {draft && (
        <Suspense fallback={null}>
          <BuilderSheet
            open
            onClose={() => setDraft(null)}
            initialMode={SCAN_TAB}
            initialDraft={draft}
            onSaved={(row) => {
              setDraft(null)
              setSavedName((row && (row.name || row.def_id)) || 'saved')
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
