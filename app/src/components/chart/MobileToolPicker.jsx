import { useMemo, useState } from 'react'
import Sheet from '../mobile/Sheet'
import haptics from '../mobile/haptics'
import { TOOL_ICONS } from './ChartToolbar'
import styles from './MobileToolPicker.module.css'

/* MOB-04 — the all-tools door.
 *
 * ⛔ THE DEFECT WAS AN INVISIBLE REQUIREMENT, NOT A MISSING FEATURE. All 18
 * drawing tools were already in the phone bar and all 18 already worked — inside
 * a `overflow-x: auto` rail with `scrollbar-width: none` and no fade, about
 * three tiles wide at 390px. Fifteen tools were reachable only by a horizontal
 * swipe that the interface never mentions. That is a gesture standing in for a
 * critical task rather than accelerating one, which is the one thing the
 * interaction grammar forbids.
 *
 * So this is a DOOR, not a replacement: the rail keeps working exactly as it
 * did (and now shows a fade so the swipe is discoverable), and this sheet gives
 * the same tools a flat, labelled, searchable surface. Two interactions from the
 * chart to any tool: open, tap.
 *
 * ⭐ RECENCY, NOT FAVOURITES (`CMP-017`). A favourites system asks the user to
 * curate before they have used anything; recency pays for itself from the second
 * session and needs no UI. Device-scoped in localStorage, which is correct — a
 * phone's recent tools are not a fact about the account.
 *
 * ⛔ THE ROSTER IS PASSED IN, NEVER RE-TYPED. `DRAW_TOOLS` already exists and is
 * already pinned set-equal to the desktop list by `MobileDrawBar.roster.test.js`.
 * A second copy here is the exact drift this file's own neighbours warn about —
 * `advance` and `cup` shipped unreachable for two waves that way.
 */

const RECENT_KEY = 'uct.draw.recentTools'
const RECENT_MAX = 5

export function readRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
  } catch { return [] }
}

/** Most-recent-first, de-duplicated, capped. Pure so it can be tested directly. */
export function pushRecent(list, id) {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX)
}

export function rememberRecent(id) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(readRecents(), id))) } catch { /* quota */ }
}

/** Match on the label a user can actually see, and on the id they cannot.
 *  Case- and space-insensitive so "hray", "H Ray" and "h ray" all find it. */
export function filterTools(tools, query) {
  const q = String(query || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!q) return tools
  return tools.filter((t) =>
    t.label.toLowerCase().replace(/\s+/g, '').includes(q) || t.id.toLowerCase().includes(q))
}

export default function MobileToolPicker({ open, onClose, tools, activeTool, onPick, className = '' }) {
  const [q, setQ] = useState('')
  const recents = useMemo(() => (open ? readRecents() : []), [open])

  const shown = useMemo(() => filterTools(tools, q), [tools, q])
  const recentTools = useMemo(
    () => recents.map((id) => tools.find((t) => t.id === id)).filter(Boolean),
    [recents, tools],
  )

  const choose = (id) => {
    haptics.tap()
    rememberRecent(id)
    onPick(id)
    onClose()
  }

  const Tile = ({ t }) => (
    <button
      type="button"
      className={`${styles.tile} ${activeTool === t.id ? styles.tileActive : ''}`}
      onClick={() => choose(t.id)}
      aria-label={t.label}
      aria-pressed={activeTool === t.id}
    >
      <span className={styles.glyph} aria-hidden="true">{TOOL_ICONS[t.id]}</span>
      <span className={styles.label}>{t.label}</span>
    </button>
  )

  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title="Drawing tools"
      ariaLabel="All drawing tools" className={className}>
      <div className={styles.wrap}>
        <input
          className={styles.search}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tools"
          aria-label="Search drawing tools"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />

        {/* Recents are suppressed while searching: the point of a search is that
            the user already knows what they want. */}
        {!q && recentTools.length > 0 && (
          <>
            <div className={styles.sectionLabel}>Recent</div>
            <div className={styles.grid}>{recentTools.map((t) => <Tile key={`r-${t.id}`} t={t} />)}</div>
          </>
        )}

        <div className={styles.sectionLabel}>{q ? 'Matching' : 'All tools'}</div>
        {shown.length === 0 ? (
          <div className={styles.empty}>No tool matches “{q}”.</div>
        ) : (
          <div className={styles.grid} data-testid="tool-grid">
            {shown.map((t) => <Tile key={t.id} t={t} />)}
          </div>
        )}
      </div>
    </Sheet>
  )
}
