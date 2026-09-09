import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CollapsibleSection from '../CollapsibleSection'
import UIcon from '../../../../components/ui/UIcon'
import useThesisSummary from '../../hooks/useThesisSummary'
import useNoteFacts from '../../hooks/useNoteFacts'
import useNoteExcerpts from '../../hooks/useNoteExcerpts'
import useEvidenceCandidates from '../../hooks/useEvidenceCandidates'
import { isScannedText, SCANNED_TEXT_LABEL, SCANNED_TEXT_HINT }
  from '../../lib/documentProvenance'
import ThesisReviewSection from './ThesisReviewSection'
// ⛔ Wave M's canonical source-kind labeller. The picker used to format
// `${documentName} · p.${pageNumber}` itself — a THIRD formatter over one
// truth, and the one place the '· p.2' defect would have survived Wave M.
import { searchResultTitle } from '../../lib/searchResultLabel'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import styles from './ThesisSection.module.css'

const THESIS_RESEARCH_TYPES = new Set(['long_thesis', 'short_thesis'])

/** Checkpoint decision 4/39: a note only grows this section once it is
 * genuinely being used as a thesis -- Research Type set to Long/Short
 * Thesis, the legacy Wave 3 'thesis' tag, OR it already carries evidence/
 * changelog activity (so the section never vanishes out from under a
 * thesis whose Research Type gets cleared later). An ordinary note never
 * shows an "Add evidence" invitation it has no use for (north star:
 * "not administrative," no giant panel on every note). */
/** The server's own `list_candidates` default page size. Named here so the
 *  "showing N most recent" line cannot drift away from what arrives. */
const CANDIDATE_PAGE = 50

function isThesisShaped(note, evidence, changelog) {
  if (!note) return false
  const researchType = note.propertiesJson?.['builtin:research_type']
  if (THESIS_RESEARCH_TYPES.has(researchType)) return true
  if (Array.isArray(note.tags) && note.tags.includes('thesis')) return true
  if (evidence.length > 0 || changelog.length > 0) return true
  return false
}

/** Wave J — one document_excerpt evidence row. The evidence edge's own
 * `caption` ("why THIS excerpt supports/opposes THIS thesis") is shown
 * when present, exactly like the fact case; otherwise falls back to the
 * excerpt's own citation line if it happens to already be loaded (this
 * note's own `useNoteExcerpts`) -- neither branch requires a resolved
 * excerpt to click through, since `onOpen` always hits GET /excerpts/{id}
 * regardless (checkpoint decision: an evidence row must open its source
 * even when the excerpt was captured into a DIFFERENT note). */
function ExcerptEvidenceRow({ evidence, localExcerpt, candidate, onOpen }) {
  // The citation is NOT interchangeable with the caption, so it is never
  // replaced by one. The caption answers "why does this support the thesis";
  // the citation answers "which passage, of which source" -- and a thesis whose
  // evidence list reads as four sentences of reasoning with no sources is
  // exactly the thing this wave exists to prevent. Both, in that order, the
  // source dimmed behind the reason.
  //
  // ⛔⛔ WAVE N, found by the §1 downstream audit: this was a FOURTH formatter
  // spelling `${documentName} · p.${pageNumber}`, and it renders inside the
  // THESIS -- the most consequential surface of all. For a web capture that
  // page number is a capture ordinal.
  // ⛔ It also fell through to the literal string "Document excerpt" for a
  // captured passage, because `localExcerpt` comes from the body-refs sidecar a
  // capture is never in. Calling a Reuters clipping a "Document excerpt" is the
  // same category error in words instead of numbers.
  // `candidate` carries `sourceKind` (and `pageNumber: null` for web), so the
  // ONE canonical labeller can answer here too.
  const citation = candidate
    ? searchResultTitle({
        sourceKind: candidate.sourceKind, name: candidate.sourceTitle,
        pageNumber: candidate.pageNumber, sourceUrl: candidate.sourceUrl,
      }, { kind: 'page' })
    : localExcerpt
      ? `${localExcerpt.documentName || 'Document'} · p.${localExcerpt.pageNumber}`
      : null
  // ⛔⛔ WAVE N §10 — GHOST EVIDENCE. When the owning note is PURGED the
  // excerpt is hard-deleted and this edge survives ON PURPOSE (`db.py` says
  // so where the cascade is written: it must "degrade via the same 'no longer
  // available' pattern FinancialFactView already established"). That degrade
  // was never implemented here: the row rendered its caption as if nothing had
  // happened, and clicking it hit a 404 and silently did nothing.
  // ⛔ THE CLIENT CANNOT WORK THIS OUT ALONE — an excerpt captured into
  // ANOTHER note is equally unresolvable from here, and that one IS still
  // real and must stay clickable. `targetAvailable` is the server's answer,
  // computed by the same `_target_exists` that guards attachment.
  if (evidence.targetAvailable === false) {
    return (
      <span className={`${styles.evidenceLink} ${styles.evidenceGone}`}
            title="This evidence's source is no longer available">
        <UIcon name="warning" size={11} gold={false}
               style={{ verticalAlign: '-1px', marginRight: 4 }} />
        {evidence.caption
          ? <>{evidence.caption}<span className={styles.evidenceCitation}>
              {' '}— source no longer available</span></>
          : "This evidence's source is no longer available"}
      </span>
    )
  }
  return (
    <button type="button" className={styles.evidenceLink} onClick={onOpen}>
      <UIcon name="link" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
      {evidence.caption || citation || 'Saved evidence'}
      {evidence.caption && citation && (
        <span className={styles.evidenceCitation}> — {citation}</span>
      )}
      {/* ⛔⛔ WAVE P5 — AND IT SAYS SO AFTER THE DECISION TOO.
          §24 put this chip in the PICKER so a member knows the words were read
          off an image BEFORE they stake a thesis on them. Driving the journey
          on a phone showed the chip then vanishing at the moment it starts to
          matter: the attached row is what they re-read weeks later, next to
          their own reasoning, and it read exactly like a quotation lifted from
          a text PDF. Provenance that survives only until the click is the same
          defect as no provenance.
          ⛔ Only where the origin is actually KNOWN. `candidate` is this
          note's own material; an excerpt captured into another note resolves
          to nothing here, and inventing "native" from a missing answer is the
          claim this whole wave exists to avoid. */}
      {candidate && isScannedText(candidate) && (
        <span className={styles.scannedChip} title={SCANNED_TEXT_HINT}>
          {SCANNED_TEXT_LABEL}
        </span>
      )}
    </button>
  )
}

function eventLabel(e) {
  switch (e.type) {
    case 'thesis_edited':
      return 'Thesis edited'
    case 'restored': {
      const d = e.restoredFromVersionAt ? new Date(e.restoredFromVersionAt).toLocaleDateString() : null
      return d ? `Restored to the version from ${d}` : 'Restored an earlier version'
    }
    case 'property_changed': {
      const names = {
        'builtin:thesis_status': 'Status', 'builtin:confidence': 'Confidence',
        'builtin:research_type': 'Research Type', 'builtin:review_date': 'Review Date',
      }
      const label = names[e.propertyId] || e.propertyId
      return `${label} changed${e.to ? ` to ${e.to}` : ''}`
    }
    case 'evidence_added':
      return `Evidence added (${e.stance})`
    case 'evidence_removed':
      return 'Evidence removed'
    case 'fact_captured':
      return `Captured ${e.factLabel || e.factType} for ${e.ticker}`
    case 'position_linked':
      return `Linked to ${e.symbol || 'a trade'}`
    case 'trade_closed':
      return `Trade closed${e.symbol ? ` — ${e.symbol}` : ''}${e.result ? ` (${e.result})` : ''}`
    default:
      return e.type
  }
}

/**
 * Wave G — Thesis Evidence + Thesis Changelog. Sits below PropertiesSection,
 * above the editor body (checkpoint §39), and renders nothing at all for a
 * note that isn't being used as a thesis (see isThesisShaped above).
 *
 * Evidence follows PropertiesSection's own progressive-disclosure idiom
 * exactly: empty state is a single small "+ Add evidence" link, not a
 * permanent panel. The changelog is a CollapsibleSection (Analytics' own
 * accordion, reused rather than a bespoke one) that shows an honest empty
 * state rather than nothing (checkpoint §31) once the note IS a thesis --
 * that's the one place this section deliberately shows itself with nothing
 * in it, because "no changes yet" is itself informative for a thesis.
 */
export default function ThesisSection({ noteId, note, onOpenExcerptSource,
                                        anchorReviewId = null,
                                        onReviewAnchorConsumed = null }) {
  const { evidence, changelog, isLoading, refresh } = useThesisSummary(noteId)
  const { facts } = useNoteFacts(noteId)
  const { excerpts } = useNoteExcerpts(noteId)
  const navigate = useNavigate()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [stance, setStance] = useState('supports')
  const [targetType, setTargetType] = useState('note')
  // ⭐ WAVE N: what this note OWNS that can be evidence — captured web
  // passages included. `useNoteExcerpts` answers "embedded in the body",
  // which is why a capture was invisible here.
  // ⛔ NOT gated on the picker being open. The ATTACHED evidence list needs the
  // same rows to label a captured passage truthfully — gating this on the
  // picker meant a thesis rendered its own evidence as the bare fallback until
  // the member happened to open Add Evidence. One note's own candidates, so
  // the cost is a small scoped query rather than a corpus scan.
  const { candidates, refresh: refreshCandidates } = useEvidenceCandidates(noteId)
  // ⛔⛔ WAVE N §12 — THE PICKER SHOWED 50 OF 120 AND SAID NOTHING.
  // The endpoint is correctly bounded (one note's own material, LIMIT 50) and
  // measured at ~12ms p50 against a 240-capture corpus, so scale is not the
  // problem. Reachability is: a member with more than fifty saved passages in
  // one note could not get to the rest, and nothing on screen said so. The
  // endpoint has taken `q` since Wave N step 1 — the picker simply never
  // offered it. Same defect shape as the candidate list itself: the capability
  // existed and no door opened it.
  // ⭐ A SECOND read, not a replacement: the unfiltered one above labels the
  // ATTACHED rows and must not narrow when the member types. With an empty
  // query both calls resolve to the same URL, so SWR dedupes them to ONE
  // request and the common case costs nothing.
  const [excerptQuery, setExcerptQuery] = useState('')
  const { candidates: excerptCandidates } = useEvidenceCandidates(noteId, {
    q: excerptQuery,
    enabled: pickerOpen && targetType === 'document_excerpt',
  })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [caption, setCaption] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // ⛔ WAVE N §14 — ATTACHING MUST BE ANNOUNCED, AND FOCUS MUST LAND SOMEWHERE.
  // On success the picker closes and a row appears further up the page: a
  // sighted member sees it, and a screen-reader user was told nothing and left
  // with focus on <body> because the button they had pressed was unmounted.
  const [announcement, setAnnouncement] = useState('')
  const addTriggerRef = useRef(null)

  useEffect(() => {
    if (targetType !== 'note' || selected || !query.trim()) { setResults([]); return undefined }
    let alive = true
    setSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/j2/notes?q=${encodeURIComponent(query.trim())}&limit=8&sort=updated`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { notes: [] }))
        .then((body) => { if (alive) setResults((body?.notes || []).filter((n) => n.id !== noteId)) })
        .catch(() => { if (alive) setResults([]) })
        .finally(() => { if (alive) setSearching(false) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [query, targetType, selected, noteId])

  const shaped = useMemo(() => isThesisShaped(note, evidence, changelog), [note, evidence, changelog])

  if (isLoading || !shaped) return null

  const resetPicker = () => {
    setPickerOpen(false)
    setStance('supports')
    setTargetType('note')
    setQuery('')
    setExcerptQuery('')
    setResults([])
    setSelected(null)
    setCaption('')
    setError(null)
    // Focus returns to the control that opened the picker — never the void.
    // rAF because the trigger only re-mounts once `pickerOpen` is false.
    requestAnimationFrame(() => addTriggerRef.current?.focus())
  }

  const submit = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/j2/notes/${noteId}/evidence`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType, targetId: selected.id, stance, caption: caption.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail || 'Could not add evidence')
      }
      await refresh()
      // ⛔ The candidate list carries `alreadyAttached`, so it must be re-read
      // after a write — otherwise the member can pick the same passage twice
      // and only learn it was a duplicate by being refused.
      await refreshCandidates()
      setAnnouncement(`Evidence added as ${stance === 'supports' ? 'supporting' : 'opposing'}.`)
      resetPicker()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (evidenceId) => {
    await fetch(`/api/j2/evidence/${evidenceId}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
    await refresh()
    // Removing evidence frees the candidate again — the picker must say so.
    await refreshCandidates()
  }

  return (
    <div className={styles.wrap} data-export-exclude>
      {/* Polite, and outside the picker so it survives the picker unmounting. */}
      {/* ⛔ NAMED. ThesisReviewSection renders its own status region in this
          same subtree, and two anonymous ones leave assistive tech (and any
          probe) unable to say which just spoke — the Wave N harness lost a day
          to exactly that ambiguity. */}
      <div className={styles.srOnly} role="status" aria-live="polite"
           aria-label="Evidence status">{announcement}</div>
      <div className={styles.evidenceBlock}>
        {evidence.length > 0 && (
          <ul className={styles.evidenceList}>
            {evidence.map((e) => (
              <li key={e.id} className={styles.evidenceRow}>
                <span className={`${styles.stancePill} ${e.stance === 'supports' ? styles.supports : styles.opposes}`}>
                  {e.stance === 'supports' ? 'Supports' : 'Opposes'}
                </span>
                {e.targetType === 'note' ? (
                  <button type="button" className={styles.evidenceLink} onClick={() => navigate(notePath(e.targetId))}>
                    <UIcon name="link" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                    {e.caption || 'Linked note'}
                  </button>
                ) : e.targetType === 'document_excerpt' ? (
                  <ExcerptEvidenceRow
                    evidence={e}
                    localExcerpt={excerpts.find((ex) => ex.id === e.targetId)}
                    candidate={candidates.find((c) => c.id === e.targetId)}
                    onOpen={() => onOpenExcerptSource?.(e.targetId)}
                  />
                ) : (
                  <span className={styles.evidenceLabel}>{e.caption || 'Captured fact'}</span>
                )}
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => remove(e.id)}
                  aria-label="Remove evidence"
                >
                  <UIcon name="x" size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!pickerOpen ? (
          <button type="button" ref={addTriggerRef} className={styles.addLink}
                  onClick={() => { setAnnouncement(''); setPickerOpen(true) }}>
            <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            Add evidence
          </button>
        ) : (
          <div className={styles.picker}>
            <div className={styles.pickerRow}>
              <div className={styles.stanceToggle} role="group" aria-label="Evidence stance">
                <button
                  type="button"
                  className={`${styles.stanceBtn} ${stance === 'supports' ? styles.stanceBtnActive : ''}`}
                  onClick={() => setStance('supports')}
                >
                  Supports
                </button>
                <button
                  type="button"
                  className={`${styles.stanceBtn} ${stance === 'opposes' ? styles.stanceBtnActive : ''}`}
                  onClick={() => setStance('opposes')}
                >
                  Opposes
                </button>
              </div>
              <div className={styles.stanceToggle} role="group" aria-label="Evidence type">
                <button
                  type="button"
                  className={`${styles.stanceBtn} ${targetType === 'note' ? styles.stanceBtnActive : ''}`}
                  onClick={() => { setTargetType('note'); setSelected(null) }}
                >
                  Note
                </button>
                <button
                  type="button"
                  className={`${styles.stanceBtn} ${targetType === 'fact' ? styles.stanceBtnActive : ''}`}
                  onClick={() => { setTargetType('fact'); setSelected(null) }}
                >
                  Captured fact
                </button>
                <button
                  type="button"
                  className={`${styles.stanceBtn} ${targetType === 'document_excerpt' ? styles.stanceBtnActive : ''}`}
                  onClick={() => { setTargetType('document_excerpt'); setSelected(null) }}
                >
                  Document excerpt
                </button>
              </div>
            </div>

            {targetType === 'document_excerpt' ? (
              selected ? (
                <div className={styles.selectedRow}>
                  <span>{selected.title}</span>
                  <button type="button" className={styles.clearSel} onClick={() => setSelected(null)}>Change</button>
                </div>
              ) : (
              <>
                {(excerptCandidates.length >= CANDIDATE_PAGE || excerptQuery) && (
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Search your captured passages…"
                    aria-label="Search your captured passages"
                    value={excerptQuery}
                    onChange={(e) => setExcerptQuery(e.target.value)}
                  />
                )}
                {excerptCandidates.length ? (
                <ul className={styles.resultsList}>
                  {excerptCandidates.map((c) => {
                    // ⛔ ONE labeller, shared with Search. A web capture reads
                    // "Captured passage · Reuters: NVDA margins (reuters.com)";
                    // a real PDF keeps "NVDA 10-Q · p.47".
                    const label = searchResultTitle(
                      { sourceKind: c.sourceKind, name: c.sourceTitle,
                        pageNumber: c.pageNumber, sourceUrl: c.sourceUrl },
                      // ⛔ 'page' rather than 'excerpt' is deliberate: in the
                      // PICKER the member is choosing the capture itself, and
                      // the wave directive's own example wording is "Captured
                      // passage · <title> (<domain>)". 'excerpt' would render
                      // "Saved passage", which describes the storage rather
                      // than what the member did.
                      { kind: 'page' })
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={styles.resultItem}
                          disabled={c.alreadyAttached}
                          onClick={() => setSelected({ id: c.id, title: label })}
                        >
                          <span className={styles.candidateLabel}>
                            {label}{c.alreadyAttached ? ' · already attached' : ''}
                            {/* ⛔ WAVE P4 §24 — the member is choosing what to
                                stake a thesis on. If these words were READ OFF
                                AN IMAGE they should know before they attach,
                                not after. Quiet, and only where it is true. */}
                            {isScannedText(c) && (
                              <span className={styles.scannedChip} title={SCANNED_TEXT_HINT}>
                                {SCANNED_TEXT_LABEL}
                              </span>
                            )}
                          </span>
                          {/* ⛔ SOURCE CLAIM AND MEMBER NOTE ARE TWO THINGS, and
                              the picker is where a member decides which they are
                              attaching. Concatenating them here would let their
                              own opinion be filed as a publisher's quotation. */}
                          <span className={styles.candidateSource}>
                            &ldquo;{c.text.slice(0, 90)}{c.text.length > 90 ? '…' : ''}&rdquo;
                          </span>
                          {c.annotation && (
                            <span className={styles.candidateAnnotation}>
                              Your note: {c.annotation.slice(0, 70)}
                              {c.annotation.length > 70 ? '…' : ''}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                ) : (
                  <div className={styles.hint}>
                    {excerptQuery
                      ? 'No captured passage in this note matches that.'
                      : 'Capture a passage from the web, or save an excerpt from a PDF, in this note first.'}
                  </div>
                )}
                {/* ⛔ SAY WHAT IS BEING SHOWN. A capped list that looks complete
                    is the CoverageLine defect in miniature: the member reads
                    "these are my passages" and acts on a subset. It never
                    claims a total it does not have. */}
                {excerptCandidates.length >= CANDIDATE_PAGE && (
                  <div className={styles.hint}>
                    Showing your {CANDIDATE_PAGE} most recent — search to narrow.
                  </div>
                )}
              </>
              )
            ) : targetType === 'note' ? (
              selected ? (
                <div className={styles.selectedRow}>
                  <span>{selected.title || 'Untitled'}</span>
                  <button type="button" className={styles.clearSel} onClick={() => setSelected(null)}>Change</button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Search notes…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                  {searching && <div className={styles.hint}>Searching…</div>}
                  {results.length > 0 && (
                    <ul className={styles.resultsList}>
                      {results.map((n) => (
                        <li key={n.id}>
                          <button type="button" className={styles.resultItem} onClick={() => setSelected({ id: n.id, title: n.title })}>
                            {n.title || 'Untitled'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )
            ) : (
              selected ? (
                <div className={styles.selectedRow}>
                  <span>{selected.title}</span>
                  <button type="button" className={styles.clearSel} onClick={() => setSelected(null)}>Change</button>
                </div>
              ) : facts.length ? (
                <ul className={styles.resultsList}>
                  {facts.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className={styles.resultItem}
                        onClick={() => setSelected({ id: f.id, title: `${f.ticker} ${f.factLabel}` })}
                      >
                        {f.ticker} — {f.factLabel}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.hint}>Capture a financial fact in this note first (try /price).</div>
              )
            )}

            <input
              type="text"
              className={styles.searchInput}
              placeholder="Why this matters (optional)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />

            {/* ⛔ role=alert: a refusal the member cannot see is a refusal they
                will repeat. The duplicate guard's 400 arrives here. */}
            {error && <div className={styles.error} role="alert">{error}</div>}

            <div className={styles.pickerActions}>
              <button type="button" className={styles.cancelBtn} onClick={resetPicker}>Cancel</button>
              <button type="button" className={styles.saveBtn} onClick={submit} disabled={!selected || saving}>
                {saving ? 'Saving…' : 'Add evidence'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ⛔ WAVE O — THE REVIEW LOOP LIVES WHERE THE RESEARCH IS (§32). The
          member does not open a task app, create a task and link a ticker;
          they are already looking at the thesis and its evidence, so the
          review opens in place already knowing what it is about. It is passed
          the SAME evidence array this section renders, so the counts it shows
          and the rows above it can never disagree. */}
      <ThesisReviewSection noteId={noteId} evidence={evidence}
                           anchorReviewId={anchorReviewId}
                           onAnchorConsumed={onReviewAnchorConsumed} />

      <CollapsibleSection id={`thesis-changelog-${noteId}`} title="Changelog" defaultOpen={false}>
        {changelog.length === 0 ? (
          <div className={styles.emptyChangelog}>Changes will appear here as this thesis evolves.</div>
        ) : (
          <ul className={styles.changelogList}>
            {changelog.map((e, i) => (
              <li key={`${e.type}-${e.at}-${i}`} className={styles.changelogRow}>
                <span className={styles.changelogDate}>{new Date(e.at).toLocaleDateString()}</span>
                <span className={styles.changelogText}>{eventLabel(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </div>
  )
}
