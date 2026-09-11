// TickerActions — universal context menu for any ticker symbol.
// Right-click (desktop) or long-press (touch) → color tagging, flag toggle,
// add to watchlist, set price alert. On touch it renders as a bottom-sheet.
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import useWatchlistAlerts from '../hooks/useWatchlistAlerts'
import useTagColors from '../hooks/useTagColors'
import { useIsTouch } from '../hooks/useBreakpoint'
import Sheet from './mobile/Sheet'
import UIcon from './ui/UIcon'
import SymbolSearch from './chart/SymbolSearch'
import { buildWidgetEmbedAttrs } from '../pages/journal-2-0/lib/widgetEmbedCore'
import { targetsFor } from '../pages/journal-2-0/lib/captureTargets'
import { sendCaptureToJournal } from '../pages/journal-2-0/lib/sendToJournal'
import styles from './TickerActions.module.css'

// ─── Wave R (R-2e): "Send chart to note" ─────────────────────────────────────
//
// THE DEFAULT TIMEFRAME, and why it is 'D'.
//
// This menu is reached from ticker chips all over the app — movers, news rows,
// breadth drills, theme holdings, the flow tape. There is NO chart instance in
// scope here and therefore no `getCaptureState()` to read: the only things this
// door honestly knows are the SYMBOL and the MOMENT the member asked. So the
// timeframe is a decision, not a measurement, and it is made once, here:
//
//   1. 'D' is the chart widget's OWN declared default (registry.js `paramsSchema`
//      → `{ key: 'tf', default: 'D' }`), so a right-click capture and a typed
//      `/chart AMD` insert land on the same timeframe. One answer, not two.
//   2. 'D' never expires. `chartReconstructable` gates NUMERIC (intraday) tfs on
//      `CHART_TF_CEILING_DAYS` — 1m dies at 60 days, 5m at a year — past which an
//      anchored snapshot can no longer re-render and falls back to its archived
//      image. THIS DOOR HAS NO IMAGE ARCHIVE, so an expired intraday default
//      would degrade to a placeholder chip inside a note the member keeps
//      forever. Non-numeric tfs are reconstructable at any horizon.
//   3. Nothing about a ticker chip suggests an execution timeframe. Guessing
//      '15' would be inventing the member's intent from no evidence; the embed's
//      own timeframe switcher (R-2d) re-anchors around the same moment in one
//      click, which is the right place to change it.
const TICKER_CAPTURE_TF = 'D'

/** The frozen capture for a symbol, anchored at the moment the member opened the
 *  menu — NOT at the moment they pick a destination. `buildWidgetEmbedAttrs`
 *  would stamp `to` itself if we left it absent, but that stamp happens at SEND,
 *  and a member reading four destination labels is the interval where "frozen
 *  means anchored" quietly stops being true. Every other door freezes at open;
 *  so does this one.
 *
 *  ⛔ `from` is deliberately ABSENT. We did not measure a visible range and must
 *  not claim one: ChartEmbed renders the frozen window from `params.to` alone
 *  (`tsToAnchorDay(params.to)` → `replayCutoff`) and never reads `from`, so a
 *  fabricated start would be a claim about what the member saw that buys the
 *  renderer nothing. */
export function tickerChartCapture(sym, nowMs = Date.now()) {
  return { symbol: sym, tf: TICKER_CAPTURE_TF, to: Math.floor(nowMs / 1000) }
}

export function useTickerActions() {
  const [menu, setMenu] = useState(null) // { sym, x, y }
  const [alertForm, setAlertForm] = useState(null) // { sym }
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')
  const [addToListSym, setAddToListSym] = useState(null)

  // Shared long-press timer state (one set of refs serves every call site)
  const lpTimer = useRef(null)
  const lpStart = useRef({ x: 0, y: 0 })
  const lpFiredAt = useRef(0)
  const clearLp = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }

  function openMenu(e, sym) {
    e.preventDefault?.()
    e.stopPropagation?.()
    const x = Math.min(e.clientX ?? 0, window.innerWidth - 220)
    const y = Math.min(e.clientY ?? 0, window.innerHeight - 350)
    setMenu({ sym: String(sym).toUpperCase(), x, y })
  }

  function closeMenu() { setMenu(null) }

  // Spread onto any ticker element to get touch long-press + desktop right-click.
  //   <span {...longPressProps(sym)} onContextMenu={e => openMenu(e, sym)}>…
  function longPressProps(sym) {
    return {
      onContextMenu: (e) => openMenu(e, sym),
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse') return
        lpStart.current = { x: e.clientX, y: e.clientY }
        clearLp()
        lpTimer.current = setTimeout(() => {
          try { navigator.vibrate?.(10) } catch { /* noop */ }
          lpFiredAt.current = e.timeStamp || performance.now()
          openMenu({ clientX: e.clientX, clientY: e.clientY }, sym)
        }, 450)
      },
      onPointerMove: (e) => {
        if (!lpTimer.current) return
        if (Math.abs(e.clientX - lpStart.current.x) > 10 || Math.abs(e.clientY - lpStart.current.y) > 10) clearLp()
      },
      onPointerUp: clearLp,
      onPointerCancel: clearLp,
      // Swallow the tap-click that follows a long-press so the element's own
      // onClick (e.g. "open modal") doesn't also fire.
      onClickCapture: (e) => {
        const now = e.timeStamp || performance.now()
        if (now - lpFiredAt.current < 600) { e.preventDefault(); e.stopPropagation() }
      },
    }
  }

  return { menu, openMenu, closeMenu, longPressProps, alertForm, setAlertForm, alertPrice, setAlertPrice, alertDir, setAlertDir, addToListSym, setAddToListSym }
}

const _listsFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : []))

export default function TickerActionsMenu({ menu, onClose, lists, mutateLists }) {
  const navigate = useNavigate()
  const { toggle: toggleFlag, isFlagged } = useFlagged()
  const { tagColors: TAG_COLORS } = useTagColors()
  const { getTag, setTag, removeTag } = useTickerTags()
  const { createAlert, deleteAlert, getAlertsForSym, hasAlert } = useWatchlistAlerts()
  const isTouch = useIsTouch()
  const [showAlert, setShowAlert] = useState(false)
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')
  const [showAddList, setShowAddList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  // Wave R (R-2e). Same bespoke-toggle shape as Add to list / Compare / Set alert:
  // the entry is always present and reveals an inline section, and it consults NO
  // React context — `targetsFor` and `sendCaptureToJournal` are plain module
  // functions over fetch/localStorage. That is what makes this safe on the many
  // surfaces that render TickerActions with no VoiceProvider and no journal
  // context above them; a menu item that throws on one of those would be worse
  // than an absent one.
  //   null            → the entry is collapsed
  //   {capture,targets} → open, holding the capture FROZEN at the moment it opened
  const [sendNote, setSendNote] = useState(null)
  const [sending, setSending] = useState(false)
  // ⛔ The result sentence is owned by the section that stays mounted, and the menu
  // does NOT close on send. This repo has shipped two toast defects where the
  // message was set by an action that unmounted its own host and rendered for zero
  // frames; the member is told what happened, in place, and closes the menu
  // themselves.
  const [sendResult, setSendResult] = useState(null)
  // "+ Add to list" used to depend on a `lists` prop that NO call site passed,
  // so every surface in the app rendered "No lists yet". The menu now fetches
  // the user's lists itself when the picker opens; an explicit prop still wins
  // (a caller that already holds fresh lists shouldn't trigger a second fetch).
  const { data: fetchedLists, mutate: mutateFetched } = useSWR(
    // include_items=0: this picker reads only `is_prebuilt`, `id` and `name` (see the
    // filter below) — the symbols in each list are never touched here, and on the
    // owner's account they are 4,406 rows / 553 KB. An explicit `lists` prop still
    // wins and may carry items; the filter and menu work the same either way.
    menu && showAddList && !lists ? '/api/watchlists?include_items=0' : null,
    _listsFetcher,
  )
  // Prebuilt (UCT-curated) lists are OWNED by the admin account, so the owner's own
  // fetch returns them too — ~30 UCT names (12 of them the dated Sunday Scans archive)
  // stacked above his personal lists. They are also config-managed: the boot seeder
  // reverts any symbol added by hand on the next boot. So the quick-add picker offers
  // only lists a person actually curates. (Members never receive prebuilt rows here.)
  const effLists = (lists || fetchedLists)?.filter(wl => !wl?.is_prebuilt)
  const effMutate = mutateLists || mutateFetched

  if (!menu) return null
  const { sym, x, y } = menu
  const flagged = isFlagged(sym)
  const currentTag = getTag(sym)

  // Compare entry point — same canonical route + picker TickerPopup's own
  // "+ Compare" uses (goToCompare, ~TickerPopup.jsx:91). `sym` here is already
  // uppercased by openMenu, so no second normalization.
  const goToCompare = (comparator) => { navigate(`/research/${sym}/compare/${comparator.toUpperCase()}`); onClose() }

  async function handleAddToList(listId) {
    await fetch(`/api/watchlists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sym, notes: '' }),
    })
    if (effMutate) effMutate()
    setShowAddList(false)
    onClose()
  }

  // Inline "New list" — create a watchlist and drop the symbol in, without
  // leaving whatever page the reader is on.
  async function handleCreateList() {
    const name = newListName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const r = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.slice(0, 60), description: '', is_public: false }),
      })
      if (!r.ok) throw new Error('create failed')
      const created = await r.json()
      await handleAddToList(created.id)
      setNewListName('')
    } catch { /* leave the picker open so the user can retry */ } finally {
      setCreating(false)
    }
  }

  // Open the send-to-note section: build + freeze the capture ONCE, right here,
  // and resolve which destinations apply to it from that same frozen object.
  function openSendNote() {
    const capture = tickerChartCapture(sym)
    setSendResult(null)
    setSendNote({ capture, targets: targetsFor('chart', buildWidgetEmbedAttrs('chart', capture)) })
  }

  async function sendNoteTo(targetId) {
    if (sending || !sendNote) return
    setSending(true)
    setSendResult('sending…')
    try {
      // The SAME frozen capture object the section opened with — never rebuilt.
      setSendResult(await sendCaptureToJournal('chart', sendNote.capture, { label: sym, target: targetId }))
    } finally {
      setSending(false)
    }
  }

  const body = (
    <>
      {/* Full Research / Ask AI — the shared door into the canonical /research/:sym
          environment (ticker_explain.py), matching TickerPopup's goToResearch/
          goToAskAi exactly. This used to deep-link "Ask AI" to the separate,
          non-grounded /ai-search page — a security-scoped "Ask AI" action must
          mean the same canonical Ask AI everywhere in the app (entry-point
          convergence, owner authorization). /ai-search itself is untouched and
          still serves its other, non-security-scoped callers. */}
        <button
          className={styles.item}
          onClick={() => { navigate(`/research/${sym}`); onClose() }}
        >
          <UIcon name="book" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Full Research
        </button>
        <button
          className={styles.item}
          onClick={() => { navigate(`/research/${sym}?section=ai`); onClose() }}
        >
          <UIcon name="sparkle" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Ask AI about {sym}
        </button>

        {/* Flag */}
        <button className={styles.item} onClick={() => { toggleFlag(sym); onClose() }}>
          <UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{flagged ? 'Unflag' : 'Flag'}
        </button>

        {/* Tags */}
        <div className={styles.tagSection}>
          <span className={styles.tagLabel}>Tag</span>
          <div className={styles.swatches}>
            {TAG_COLORS.map(tc => (
              <button
                key={tc.key}
                className={`${styles.swatch}${currentTag === tc.key ? ' ' + styles.swatchActive : ''}`}
                style={{ background: tc.hex }}
                title={tc.label}
                onClick={() => { currentTag === tc.key ? removeTag(sym) : setTag(sym, tc.key); onClose() }}
              />
            ))}
          </div>
        </div>

        {/* Add to list */}
        {!showAddList ? (
          <button className={styles.item} onClick={() => setShowAddList(true)}>+ Add to list</button>
        ) : (
          <div className={styles.listPicker}>
            {(effLists || []).map(wl => (
              <button key={wl.id} className={styles.listOption} onClick={() => handleAddToList(wl.id)}>
                {wl.name}
              </button>
            ))}
            {effLists && effLists.length === 0 && <span className={styles.noLists}>No lists yet</span>}
            {!effLists && <span className={styles.noLists}>Loading…</span>}
            <div className={styles.newListRow}>
              <input
                className={styles.newListInput}
                type="text"
                placeholder="New list…"
                value={newListName}
                maxLength={60}
                onChange={e => setNewListName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateList() }}
              />
              <button
                type="button"
                className={styles.newListBtn}
                disabled={!newListName.trim() || creating}
                onClick={handleCreateList}
              >
                {creating ? '…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Compare — same bespoke-toggle pattern as Add to list / Set alert. */}
        {!showCompare ? (
          <button className={styles.item} onClick={() => setShowCompare(true)}>
            <UIcon name="columns" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Compare {sym} with...
          </button>
        ) : (
          <div className={styles.compareSection}>
            <SymbolSearch sym={sym} displayLabel="+ Compare" onSymbolChange={goToCompare} />
          </div>
        )}

        {/* Send chart to note (Wave R R-2e) — same bespoke-toggle pattern as
            Add to list / Compare / Set alert. */}
        {!sendNote ? (
          <button className={styles.item} onClick={openSendNote}>
            <UIcon name="journal" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Send {sym} chart to note
          </button>
        ) : (
          <div className={styles.sendNoteSection}>
            {/* Say what is being frozen, in the member's words — the capture is a
                daily chart anchored at this moment, and nothing else is known. */}
            <div className={styles.sendNoteHint}>Daily chart of {sym}, frozen at now</div>
            {sendNote.targets.map((t) => (
              <button
                key={t.id}
                type="button"
                className={styles.sendNoteTarget}
                disabled={sending}
                title={t.hint}
                onClick={() => sendNoteTo(t.id)}
              >{t.label}</button>
            ))}
            <span role="status" className={styles.sendNoteStatus} data-empty={!sendResult}>
              {sendResult || ''}
            </span>
          </div>
        )}

        {/* Alert */}
        {!showAlert ? (
          <button className={styles.item} onClick={() => setShowAlert(true)}>
            <UIcon name="bell" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{hasAlert(sym) ? 'Manage alerts' : 'Set alert'}
          </button>
        ) : (
          <div className={styles.alertSection}>
            <div className={styles.alertRow}>
              <select className={styles.alertSelect} value={alertDir} onChange={e => setAlertDir(e.target.value)}>
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
              <input
                className={styles.alertInput}
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={alertPrice}
                onChange={e => setAlertPrice(e.target.value)}
                autoFocus
              />
              <button
                className={styles.alertSet}
                disabled={!alertPrice || parseFloat(alertPrice) <= 0}
                onClick={() => { createAlert(sym, parseFloat(alertPrice), alertDir); setAlertPrice(''); setShowAlert(false); onClose() }}
              >Set</button>
            </div>
            {getAlertsForSym(sym).map(a => (
              <div key={a.id} className={styles.alertItem}>
                <span>{a.direction} ${a.target_price.toFixed(2)}</span>
                <button className={styles.alertDel} onClick={() => deleteAlert(a.id)}>×</button>
              </div>
            ))}
          </div>
        )}
    </>
  )

  // Touch: bottom-sheet with big tap targets
  if (isTouch) {
    return (
      <Sheet open onClose={onClose} variant="bottom-sheet" title={sym}>
        <div className={styles.sheetBody}>{body}</div>
      </Sheet>
    )
  }

  // Desktop: anchored floating menu
  return (
    <div className={styles.backdrop} onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }}>
      <div className={styles.menu} style={{ top: y, left: x }} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>{sym}</div>
        {body}
      </div>
    </div>
  )
}
