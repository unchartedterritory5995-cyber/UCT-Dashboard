import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import { useIsTouch } from '../../../../hooks/useBreakpoint'
import {
  PRECISE_STATES,
  citedSources,
  resolveNoteCitation,
  splitAnswer,
} from '../../lib/askCitation'
import { isScannedText, SCANNED_TEXT_LABEL, SCANNED_TEXT_HINT }
  from '../../lib/documentProvenance'
import styles from './AskPanel.module.css'

// Wave K Slice 6 — THE Ask surface. One panel, four scopes.
//
// Ask Current Note, Ask Document, Ask Security Research and Ask Notebook are
// the same research assistant pointed at different corpora, so they are one
// component: one streaming implementation, one citation renderer, one error
// path, one rate-limit message, one empty state. Four copies of this drift
// within a release, and the copy that drifts is always the one nobody is
// looking at.
//
// Scope changes WHAT is searched — never how an answer is rendered or how a
// citation is validated.

export const SCOPES = {
  note: { label: 'This note', placeholder: 'What did I say about…' },
  document: { label: 'This document', placeholder: 'What does this document say about…' },
  security: { label: 'This research', placeholder: 'What are my biggest concerns about…' },
  notebook: { label: 'My Notebook', placeholder: 'What have I written about…' },
}

const RATE_LIMIT_MSG = "You've hit today's Ask limit — it resets at midnight ET."
const PAID_MSG = 'Ask requires a paid plan.'

/** Read one SSE frame set out of a buffer. */
function drainEvents(buf) {
  const events = []
  let rest = buf
  let idx
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, idx)
    rest = rest.slice(idx + 2)
    const line = block.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    try { events.push(JSON.parse(line.slice(5))) } catch { /* partial frame */ }
  }
  return [events, rest]
}

export default function AskPanel({
  scope = 'notebook',
  target = null,
  // Note scope only: the LIVE ProseMirror doc, so a citation is verified
  // against what the member can actually see, unsaved edits included.
  getEditorDoc = null,
  onNavigate = null,
  autoOpen = false,
  onClose = null,
}) {
  const spec = SCOPES[scope] || SCOPES.notebook
  // ⛔ THE ONE SANCTIONED USE OF useIsTouch: a CLICK-TRIGGERED choice between
  // a Sheet and an anchored popover. It is stale at first paint, so it must
  // never decide layout -- CSS media queries do that.
  const isTouch = useIsTouch()
  const [open, setOpen] = useState(autoOpen)
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState([])
  const [scopeLabel, setScopeLabel] = useState(spec.label)
  const [coverageNotice, setCoverageNotice] = useState(null)
  const [status, setStatus] = useState('idle') // idle|asking|done|error|limit
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef(null)
  const historyRef = useRef([])
  const inputRef = useRef(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  // A scope change is a different corpus, so the thread does not carry over.
  // Keeping it would let a follow-up be answered from a corpus the member
  // never asked about.
  useEffect(() => {
    historyRef.current = []
    setAnswer(''); setSources([]); setCoverageNotice(null); setStatus('idle')
    setScopeLabel(SCOPES[scope]?.label || SCOPES.notebook.label)
  }, [scope, target])

  // ⛔ TWO FRAMES, NOT ONE. `Sheet` claims focus for its own panel on the
  // frame after it mounts (its focus management, deliberately, so Escape and
  // the trap work). Focusing on the same frame loses the race and the member
  // has to tap the field before typing -- caught by the browser audit, which
  // is the only place a lost focus race is visible.
  useEffect(() => {
    if (!open) return undefined
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => inputRef.current?.focus())
    })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [open])

  const ask = useCallback(async () => {
    const q = query.trim()
    if (!q || status === 'asking') return
    setStatus('asking'); setAnswer(''); setSources([])
    setCoverageNotice(null); setErrorMsg('')
    const controller = new AbortController()
    abortRef.current = controller
    let text = ''
    try {
      const r = await fetch('/api/j2/ask/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope, target, query: q, history: historyRef.current.slice(-3),
        }),
        signal: controller.signal,
      })
      if (r.status === 429) {
        const d = await r.json().catch(() => null)
        setStatus('limit'); setErrorMsg(d?.detail || RATE_LIMIT_MSG); return
      }
      if (r.status === 402) { setStatus('limit'); setErrorMsg(PAID_MSG); return }
      if (r.status === 404) {
        setStatus('error'); setErrorMsg('That research is no longer available.'); return
      }
      if (!r.ok || !r.body?.getReader) {
        setStatus('error'); setErrorMsg('Something went wrong.'); return
      }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let failed = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let events
        ;[events, buf] = drainEvents(buf)
        for (const ev of events) {
          if (ev.type === 'sources') {
            // Sources land BEFORE any prose, so a handle is validatable the
            // moment it is rendered rather than after the fact.
            setSources(ev.sources || [])
            setScopeLabel(ev.scopeLabel || spec.label)
            setCoverageNotice(ev.coverageNotice || null)
          } else if (ev.type === 'delta' && ev.text) {
            text += ev.text; setAnswer(text)
          } else if (ev.type === 'final') {
            text = ev.answer || text; setAnswer(text)
          } else if (ev.type === 'error') {
            failed = true
            setStatus('error'); setErrorMsg(ev.detail || 'Something went wrong.')
          }
        }
      }
      if (failed) return
      if (text.trim()) {
        historyRef.current = [...historyRef.current, { q, a: text }]
        setStatus('done')
      } else {
        setStatus('error'); setErrorMsg('No answer came back.')
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        setStatus('error'); setErrorMsg('Something went wrong.')
      }
    }
  }, [query, status, scope, target, spec.label])

  const handleCitation = useCallback((source) => {
    let resolved = null
    if (source?.navigation?.kind === 'note' && getEditorDoc) {
      // ⛔ VERIFY BEFORE NAVIGATING. Positions do not survive an edit, and a
      // confident jump to the wrong paragraph is worse than not jumping.
      resolved = resolveNoteCitation(getEditorDoc(), source.location,
                                     source.snippet)
    }
    onNavigate?.(source, resolved)
  }, [getEditorDoc, onNavigate])

  const parts = useMemo(() => (answer ? splitAnswer(answer, sources) : []),
                        [answer, sources])
  const cited = useMemo(() => citedSources(answer, sources), [answer, sources])

  return (
    <div className={styles.wrap}>
      {!autoOpen && (
        <button
          type="button"
          className={styles.askToggle}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`Ask a question about ${spec.label.toLowerCase()}`}
        >
          <UIcon name="sparkle" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Ask
        </button>
      )}
      {open && (
        <PanelShell isTouch={isTouch} label={`Ask ${scopeLabel}`}
                    onClose={() => { setOpen(false); onClose?.() }}>
          <div className={styles.panelHeader}>
            {/* ⛔ SCOPE IS TEXT, NOT AN ICON TOOLTIP. A wrong-scope answer is
                a trust defect, so what was searched is legible without
                hovering anything (§9). */}
            <span className={styles.scopeChip} data-testid="ask-scope">
              <UIcon name="search" size={11} gold={false}
                     style={{ verticalAlign: '-1px', marginRight: 4 }} />
              Asking: {scopeLabel}
            </span>
            <button type="button" className={styles.closeBtn}
                    onClick={() => { setOpen(false); onClose?.() }}
                    aria-label="Close Ask">×</button>
          </div>

          <div className={styles.inputRow}>
            <label className={styles.srOnly} htmlFor={`ask-input-${scope}`}>
              Your question about {scopeLabel}
            </label>
            <input
              id={`ask-input-${scope}`}
              ref={inputRef}
              className={styles.input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask() }}
              placeholder={spec.placeholder}
              disabled={status === 'asking'}
            />
            <button type="button" className={styles.askBtn} onClick={ask}
                    disabled={status === 'asking' || !query.trim()}>
              {status === 'asking' ? 'Asking…' : 'Ask'}
            </button>
          </div>

          {(status === 'error' || status === 'limit') && (
            <div className={styles.errorMsg} role="alert">{errorMsg}</div>
          )}

          {coverageNotice && (
            <div className={styles.coverage} data-testid="ask-coverage">
              <UIcon name="info" size={12} gold={false}
                     style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {coverageNotice}
            </div>
          )}

          {answer && (
            <div className={styles.answer} data-testid="ask-answer"
                 aria-live="polite" aria-busy={status === 'asking'}>
              {parts.map((p, i) => (p.source
                ? (
                  <button
                    key={i}
                    type="button"
                    className={styles.citationChip}
                    onClick={() => handleCitation(p.source)}
                    data-citation={p.source.n}
                    aria-label={`Source ${p.source.n}: ${p.source.label}`}
                  >
                    {p.text}
                  </button>
                )
                : <span key={i}>{p.text}</span>))}
            </div>
          )}

          {cited.length > 0 && (
            <div className={styles.sources} data-testid="ask-sources">
              <div className={styles.sourcesTitle}>Sources</div>
              {cited.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  className={styles.sourceRow}
                  onClick={() => handleCitation(s)}
                  /* ⛔ WAVE P3 §36 — PROVENANCE NON-VISUALLY. A title attribute
                     is hover-only and a chip is a glyph to a screen reader, so
                     the accessible name carries it too. Colour and hover can
                     never be the only channel. */
                  aria-label={`Open source ${s.n}: ${s.label}`
                    + (isScannedText(s) ? `, ${SCANNED_TEXT_LABEL}` : '')}
                >
                  <span className={styles.sourceNum}>{s.n}</span>
                  <span className={styles.sourceLabel}>{s.label}</span>
                  {/* ⛔ WAVE P3 §35 — QUIET, NOT A WARNING BANNER. The citation
                      is a good one; this only tells the member the words were
                      READ OFF AN IMAGE, so a figure deserves a look at the
                      page. Same treatment and same words as Search, from the
                      same module, so the two surfaces cannot drift. */}
                  {isScannedText(s) && (
                    <span className={styles.sourceScanned} title={SCANNED_TEXT_HINT}>
                      {SCANNED_TEXT_LABEL}
                    </span>
                  )}
                  {/* Degradation is stated in WORDS, never by colour alone. */}
                  {!PRECISE_CITATION.has(s.citation) && (
                    <span className={styles.sourceApprox}>
                      {s.citation === 'page_only' ? 'page only'
                        : s.citation === 'note_only' ? 'note only'
                          : s.citation === 'record_only' ? 'record' : 'unavailable'}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </PanelShell>
      )}
    </div>
  )
}

/**
 * ⛔ ON TOUCH THIS MUST BE A `Sheet`, NOT A FIXED-POSITION DIV.
 *
 * The first version styled its own bottom sheet at `z-index: 50`. Every
 * measurement passed -- no overflow, no sub-44px control, 16px input -- and a
 * screenshot at 390px showed the panel BURIED under the voice orb, the
 * feedback button and a Compass popover, all of which are `position: fixed`
 * in the same corner at `--z-fab: 350`. The numbers could not see it; the
 * picture could. THE BROWSER SEES WHAT NO TEST CAN.
 *
 * `Sheet` is the repo's primitive for exactly this ("use for ALL new
 * modals/drawers/popovers on mobile") and sits at `--z-modal: 1000`, so it
 * clears the FAB layer -- and brings the portal, focus trap, Escape handling,
 * body-scroll lock, drag-to-dismiss and safe-area padding that a hand-rolled
 * div silently lacked.
 */
function PanelShell({ isTouch, label, onClose, children }) {
  if (isTouch) {
    return (
      <Sheet open onClose={onClose} variant="bottom-sheet" ariaLabel={label}>
        <div className={styles.sheetBody}>{children}</div>
      </Sheet>
    )
  }
  return (
    <div className={styles.panel} role="dialog" aria-label={label}>
      {children}
    </div>
  )
}

// Which server-side citation validities can promise the exact passage.
// Mirrors ask_evidence.PRECISE_CITATIONS.
const PRECISE_CITATION = new Set(['exact'])

export { PRECISE_STATES }
