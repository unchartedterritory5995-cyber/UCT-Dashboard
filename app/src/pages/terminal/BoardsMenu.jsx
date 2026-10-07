// UCT Terminal — the Boards and Recents menus (lane T2: V3, V11, V14, V19, V2's restore).
//
// Pure presentation over boardModel.js: every change is computed there and handed back to
// the shell through a callback, so the shell stays the ONE writer of the board documents.
import { useState } from 'react'
import { TICKER_RE } from '../../components/provenance/AbsenceReceipt'
import UIcon from '../../components/ui/UIcon'
import { BY_CODE } from './functions'
import { FAVORITES_MAX, boardAddress, encodeShare, PRESET_ANY_TICKER, recentBoards, shareHref } from './boardModel'
import TerminalVersions from './TerminalVersions'
import styles from './TerminalShell.module.css'
import Input from '../../components/ui/Input'
import Checkbox from '../../components/ui/Checkbox'

function validPresetTicker(raw) {
  const s = raw.trim().toUpperCase()
  return s === PRESET_ANY_TICKER || TICKER_RE.test(s)
}

function shareUrl(board) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}${shareHref(encodeShare(board.name, board.layout, null))}`
}

function presetsFor(library, boardId) {
  return Object.entries(library.presets).filter(([, id]) => id === boardId).map(([k]) => k)
}

export function BoardsMenu({
  library, libraryWritable, currentName, onSave, onOpen, onDelete, onPreset, onKeepCalendar,
  onShareCurrent, onRestored, openToVersions = false,
}) {
  const [name, setName] = useState(currentName || '')
  const [presetSym, setPresetSym] = useState({})
  const [presetError, setPresetError] = useState(null)
  const [shared, setShared] = useState(null)
  const [showVersions, setShowVersions] = useState(openToVersions)
  // What the last Save said: the shell's notice line sits UNDER this sheet (round 3).
  const [saved, setSaved] = useState(null)

  const copy = async (url, label) => {
    setShared({ url, label })
    try { await navigator.clipboard?.writeText(url) } catch { /* the URL is shown to copy by hand */ }
  }

  return (
    <div className={styles.menu} data-testid="terminal-boards-menu">
      {!libraryWritable && (
        <p className={styles.menuWarn} role="alert">
          Your saved boards could not be read, so nothing here will be changed. Restore an
          earlier version below.
        </p>
      )}
      <form
        className={styles.menuForm}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) setSaved(onSave(name.trim()) || null) }}
      >
        <label className={styles.menuLabel} htmlFor="terminal-board-name">Save this board as</label>
        <div className={styles.menuInline}>
          <Input id="terminal-board-name" className={styles.menuInput} value={name} maxLength={60}
            onChange={(e) => setName(e.target.value)} placeholder="Earnings morning" data-testid="terminal-board-name" />
          <button type="submit" className={styles.menuBtn} disabled={!libraryWritable || !name.trim()}
            data-testid="terminal-board-save">Save</button>
        </div>
        {saved?.text && (
          <p className={saved.kind === 'error' ? styles.menuWarn : styles.menuNote}
            role={saved.kind === 'error' ? 'alert' : 'status'} data-testid="terminal-board-saved">{saved.text}</p>
        )}
      </form>
      <button type="button" className={styles.menuBtn} onClick={() => copy(onShareCurrent(), 'this board')}
        data-testid="terminal-share-current">Copy a share link to this board</button>

      <div className={styles.menuHead}>My boards</div>
      {library.boards.length === 0 && <p className={styles.menuNote}>No saved boards yet.</p>}
      <ul className={styles.menuList}>
        {library.boards.map((b) => {
          const presets = presetsFor(library, b.id)
          return (
            <li key={b.id} className={styles.menuBoard} data-testid={`terminal-board-${b.slug}`}>
              <div className={styles.menuRow}>
                <button type="button" className={styles.menuMainBtn} onClick={() => onOpen(b)}>
                  <span className={styles.menuLabel}>{b.name}</span>
                  <span className={styles.code}>{boardAddress(b)}</span>
                </button>
                <button type="button" className={styles.menuBtn} onClick={() => copy(shareUrl(b), b.name)}
                  data-testid={`terminal-board-share-${b.slug}`}>Share</button>
                <button type="button" className={styles.menuBtn} disabled={!libraryWritable}
                  onClick={() => onDelete(b)} aria-label={`Delete ${b.name}`}>Delete</button>
              </div>
              <div className={styles.menuInline}>
                <span className={styles.menuHint}>
                  {presets.length ? `Opens for ${presets.map((p) => (p === PRESET_ANY_TICKER ? 'any ticker' : p)).join(', ')}` : 'Open it for a ticker:'}
                </span>
                <Input className={styles.menuInputSm} value={presetSym[b.id] || ''} maxLength={10}
                  placeholder="NVDA or *" aria-label={`Ticker that opens ${b.name}`}
                  onChange={(e) => { setPresetSym((s) => ({ ...s, [b.id]: e.target.value })); setPresetError(null) }}
                  data-testid={`terminal-board-preset-input-${b.slug}`} />
                <button type="button" className={styles.menuBtn} disabled={!libraryWritable || !(presetSym[b.id] || '').trim()}
                  onClick={() => {
                    const raw = (presetSym[b.id] || '').trim()
                    if (!validPresetTicker(raw)) { setPresetError({ id: b.id, text: `"${raw}" isn't a ticker. Try NVDA or BRK.B, or * for any ticker.` }); return }
                    onPreset(raw, b.id)
                    setPresetSym((s) => ({ ...s, [b.id]: '' }))
                    setPresetError(null)
                  }}
                  data-testid={`terminal-board-preset-${b.slug}`}>Set</button>
                {presets.map((p) => (
                  <button key={p} type="button" className={styles.chip} disabled={!libraryWritable}
                    onClick={() => onPreset(p, null)} aria-label={`Stop opening ${b.name} for ${p}`}>
                    {p} <UIcon name="x" size={10} gold={false} />
                  </button>
                ))}
              </div>
              {presetError?.id === b.id && (
                <p className={styles.menuWarn} role="alert" data-testid={`terminal-board-preset-error-${b.slug}`}>{presetError.text}</p>
              )}
            </li>
          )
        })}
      </ul>

      {shared && (
        <div className={styles.menuShare} role="status" data-testid="terminal-share-link">
          <span className={styles.menuHint}>Share link for {shared.label} (copied when your browser allows):</span>
          <Input className={styles.menuInput} readOnly value={shared.url} aria-label="Share link"
            onFocus={(e) => e.target.select()} />
        </div>
      )}

      <div className={styles.menuHead}>Classic calendar</div>
      <label className={styles.menuCheck}>
        <Checkbox checked={library.keepCalendar} disabled={!libraryWritable}
          onChange={(e) => onKeepCalendar(e.target.checked)} data-testid="terminal-keep-calendar" />
        <span>Open <code>/calendar</code> as the classic page instead of this terminal. The terminal stays at <code>/terminal</code>.</span>
      </label>

      <div className={styles.menuHead}>Recovery</div>
      {showVersions ? <TerminalVersions onRestored={onRestored} /> : (
        <button type="button" className={styles.menuBtn} onClick={() => setShowVersions(true)}
          data-testid="terminal-versions-open">Version history</button>
      )}
    </div>
  )
}

export function RecentsMenu({ layout, library, libraryWritable = true, functionRecents, onRun, onOpenBoard, onToggleFavorite }) {
  const saved = recentBoards(library, 6)
  // Round 3: a star that cannot be set says why, in this sheet — it used to do nothing at all
  // (a 17th favourite was dropped by the cap; an unreadable library is never written over).
  const [favNote, setFavNote] = useState(null)
  const star = (code) => {
    const on = library.favorites.includes(code)
    if (!on && library.favorites.length >= FAVORITES_MAX) {
      setFavNote(`You have ${FAVORITES_MAX} favourites, the most there can be. Unstar one first.`)
      return
    }
    setFavNote(null)
    onToggleFavorite(code)
  }
  const fnRow = (code) => (
    <li key={code} className={styles.menuRow}>
      <button type="button" className={styles.menuMainBtn} onClick={() => onRun(code)}>
        <span className={styles.code}>{code}</span>
        <span className={styles.menuLabel}>{BY_CODE[code]?.label || ''}</span>
      </button>
      <button type="button" className={`${styles.menuBtn} ${library.favorites.includes(code) ? styles.favOn : ''}`}
        onClick={() => star(code)} disabled={!libraryWritable}
        aria-pressed={library.favorites.includes(code)}
        aria-label={library.favorites.includes(code) ? `Unfavourite ${code}` : `Favourite ${code}`}
        data-testid={`terminal-fav-${code}`}>
        <UIcon name={library.favorites.includes(code) ? 'star-fill' : 'star'} size={14} gold={false} />
      </button>
    </li>
  )
  const channels = layout.channels.filter((c) => c.history.length > 0)
  return (
    <div className={styles.menu} data-testid="terminal-recents-menu">
      <div className={styles.menuHead}>Favourites</div>
      {!libraryWritable && (
        <p className={styles.menuWarn} role="alert">Your saved boards could not be read, so favourites cannot be changed right now. Open Boards to restore an earlier version.</p>
      )}
      {favNote && <p className={styles.menuWarn} role="alert" data-testid="terminal-fav-note">{favNote}</p>}
      {library.favorites.length === 0 ? <p className={styles.menuNote}>Star a function to keep it here.</p>
        : <ul className={styles.menuList}>{library.favorites.filter((c) => BY_CODE[c]).map(fnRow)}</ul>}

      <div className={styles.menuHead}>Functions</div>
      {functionRecents.length === 0 ? <p className={styles.menuNote}>Nothing run yet.</p>
        : <ul className={styles.menuList} data-testid="terminal-recent-functions">{functionRecents.filter((c) => BY_CODE[c]).map(fnRow)}</ul>}

      <div className={styles.menuHead}>Securities</div>
      {channels.length === 0 ? <p className={styles.menuNote}>No securities yet.</p> : (
        <ul className={styles.menuList} data-testid="terminal-recent-entities">
          {channels.map((c) => (
            <li key={c.id} className={styles.menuInline}>
              <span className={styles.groupDotStatic} style={{ '--dot': c.color }} role="img" aria-label={c.name}>{c.id}</span>
              {c.history.map((s) => (
                <button key={s} type="button" className={styles.chip} onClick={() => onRun(s, c.id)}>{s}</button>
              ))}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.menuHead}>Boards</div>
      {saved.length === 0 ? <p className={styles.menuNote}>No boards opened yet.</p> : (
        <ul className={styles.menuList} data-testid="terminal-recent-boards">
          {saved.map((b) => (
            <li key={b.id} className={styles.menuRow}>
              <button type="button" className={styles.menuMainBtn} onClick={() => onOpenBoard(b)}>
                <span className={styles.menuLabel}>{b.name}</span>
                <span className={styles.code}>{boardAddress(b)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
