import { useMemo, useState } from 'react'
import { WorkspaceContext } from '../../../charts/WorkspaceContext'
import MarketContextWidget from '../../../charts/widgets/MarketContextWidget'
import { frozenWorkspaceValue } from './frozenWorkspace'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'
import { FAILED } from './blocks/PrepCapture'
import blockStyles from './blocks/Blocks.module.css'

const READ_URL = '/api/j2/trader-blocks/market-context'

/**
 * R-T12-C (fix round, I-1): "Capture now" on a stamp a NEW note's create could not read in time
 * (`uncaptured: true, reason: "budget"`). It reads the hand-insert's own route (GET, the slash menu's
 * read) once, on the member's click, and lands the readings through `setParams`: the prep blocks'
 * mechanism (blocks/useBlockParams.js), one editor transaction on the note's own save path. Never on
 * mount, and never for the "Update layout" stamp (no reason): IR-S11 keeps today's market out of an
 * older note unless the member stamps it. A read or a write that fails says PrepCapture's sentence.
 */
function CaptureNow({ setParams }) {
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
      const landed = setParams({
        readings: r, wireDate: body.wireDate ?? null, updated: body.updated ?? null,
        uncaptured: undefined, reason: undefined,
      })
      if (landed === false) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      {failed && <p role="status" className={blockStyles.muted}>{FAILED}</p>}
      <button type="button" className={`btn btn-ghost ${blockStyles.tap}`} disabled={busy} onClick={capture}>
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
 * `setParams` / `editable` come from the note's node view (WidgetEmbedView), for the budget stamp's
 * "Capture now" only; a host that passes none (a share page, a reader, a test) offers no button.
 */
export default function MarketContextEmbed({ attrs, height = 320, setParams = null, editable = false }) {
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
    && editable === true && typeof setParams === 'function'
  return (
    // Wave 8 (8A): a figure named by the embed's own caption -- the same
    // words its archived image uses for alt (embedAutoCaption).
    <div style={{ height, overflow: 'hidden' }} role="figure" aria-label={embedAutoCaption(attrs)}>
      <WorkspaceContext.Provider value={value}>
        <MarketContextWidget
          opts={null}
          onOptsChange={null}
          frozen={frozen}
          readOnly
          journalDoor={false}
          captureDoor={offerCapture ? <CaptureNow setParams={setParams} /> : null}
        />
      </WorkspaceContext.Provider>
    </div>
  )
}
