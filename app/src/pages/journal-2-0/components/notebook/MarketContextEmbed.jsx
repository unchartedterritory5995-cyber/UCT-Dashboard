import { useEffect, useMemo, useRef, useState } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import MarketContextWidget from '../../../charts/widgets/MarketContextWidget'
import { captureIso, CAPTURED_ANNOUNCEMENT } from '../../../charts/widgets/marketContextModel'
import { frozenWorkspaceValue } from './frozenWorkspace'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'
import { CAPTURE_FAILED } from '../../lib/blocks/captureCopy'
import { RENDER_UNAVAILABLE } from '../../../../lib/captureSafety'
import blockStyles from './blocks/Blocks.module.css'

const READ_URL = '/api/j2/trader-blocks/market-context'

/**
 * R-T12-C (fix round, I-1): "Capture now" on a stamp a create-mode read could not fill in time
 * (`uncaptured: true, reason: "budget"`). It reads the hand-insert's own route (GET, the slash menu's
 * read) once, on the member's click, and lands the readings through `setParams`: the prep blocks'
 * mechanism (blocks/useBlockParams.js), one editor transaction on the note's own save path. Never on
 * mount, and never for the "Update layout" stamp (no reason): IR-S11 keeps today's market out of an
 * older note unless the member stamps it. A read or a write that fails says CAPTURE_FAILED.
 * ⛔ Fix round 2 (I-1): the door is RENDER_UNAVAILABLE -- a control is not the artifact, so the
 * self-archive never freezes a picture of this button -- and the capture clears the archive in the SAME
 * write ({ clearArchive: true }), so the next archive is of the captured stamp.
 */
function CaptureNow({ setParams, onCaptured }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const capture = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(READ_URL, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      const r = body?.readings
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('no readings')
      // The stamp's own `fields` stays; `uncaptured` and `reason` go (an undefined key is not saved).
      // Fix round 1: the capture time rides the SAME write (a stamp is a dated reading), in the
      // server builder's format, so the caption says "· captured <day>" like every other stamp.
      const landed = setParams({
        readings: r, wireDate: body.wireDate ?? null, updated: body.updated ?? null,
        uncaptured: undefined, reason: undefined,
      }, { capturedAt: captureIso(new Date()), clearArchive: true })
      if (landed === false) setFailed(true)
      else onCaptured()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div {...RENDER_UNAVAILABLE}>
      {failed && <p role="status" className={blockStyles.muted}>{CAPTURE_FAILED}</p>}
      {/* btn-secondary, not btn-ghost: a ghost button has no border or fill, so at 1280 it read as
          bold text rather than the block's one action (F-CAPTURE-AFFORDANCE, walk 2026-10-14). */}
      <button type="button" className={`btn btn-secondary ${blockStyles.tap}`} disabled={busy} onClick={capture}>
        Capture now
      </button>
    </div>
  )
}

/**
 * The market-context journal renderer: the REAL MarketContextWidget under the
 * frozen workspace host, rendering the CAPTURED readings verbatim (payload
 * freeze). ⭐ `/api/breadth` takes no date and `wire_data.json` is OVERWRITTEN
 * by each morning's run — yesterday's exposure score and market phase exist
 * nowhere once today's wire lands, so this embed is their only durable record.
 * ⛔ `powerTrend` stays null (owner direction 2026-04-17) and renders as an em
 * dash here exactly as it does on the board.
 * `setParams` / `editable` / `embedFrozen` come from the note's node view (WidgetEmbedView), for the
 * budget stamp's "Capture now" only; a host that passes none (a share page, a reader, a test) offers no
 * button, and neither does a FROZEN embed (fix round 2, M-4: its body takes no pointer events).
 */
export default function MarketContextEmbed({ attrs, height = 320, setParams = null, editable = false, embedFrozen = false }) {
  const params = attrs?.params || {}
  const value = useMemo(() => frozenWorkspaceValue(), [])
  // Notebook P2a: `fields` is the stamp's preset; `uncaptured` a stamp a note gained after it
  // was written (IR-S11) — it renders its sentence, never a re-fetch. R-T12-C: `reason` says why.
  const frozen = useMemo(() => ({
    readings: (params.readings && typeof params.readings === 'object') ? params.readings : null,
    wireDate: params.wireDate || null,
    updated: params.updated || null,
    fields: params.fields || 'all',
    uncaptured: params.uncaptured === true,
    uncapturedReason: typeof params.reason === 'string' ? params.reason : null,
  }), [params.readings, params.wireDate, params.updated, params.fields, params.uncaptured, params.reason])
  const offerCapture = frozen.uncaptured && frozen.uncapturedReason === 'budget'
    && editable === true && typeof setParams === 'function' && embedFrozen !== true

  // Fix round 2 (M-2): a landed capture unmounts the focused button and the role="status" sentence, so
  // focus moves to the stamp itself once the readings render, and a live region that STAYS mounted says so.
  const figureRef = useRef(null)
  const focusOnCaptured = useRef(false)
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    if (!frozen.uncaptured && focusOnCaptured.current) {
      focusOnCaptured.current = false
      figureRef.current?.focus()
    }
  }, [frozen.uncaptured])
  const onCaptured = () => {
    focusOnCaptured.current = true
    setAnnounced(CAPTURED_ANNOUNCEMENT)
  }

  return (
    // Wave 8 (8A): a figure named by the embed's own caption -- the same
    // words its archived image uses for alt (embedAutoCaption).
    <div ref={figureRef} tabIndex={-1} style={{ height, overflow: 'hidden' }} role="figure" aria-label={embedAutoCaption(attrs)}>
      <WorkspaceContext.Provider value={value}>
        <MarketContextWidget
          opts={null}
          onOptsChange={null}
          frozen={frozen}
          readOnly
          journalDoor={false}
          captureDoor={offerCapture ? <CaptureNow setParams={setParams} onCaptured={onCaptured} /> : null}
        />
      </WorkspaceContext.Provider>
      <p className="sr-only" role="status" aria-live="polite">{announced}</p>
    </div>
  )
}
