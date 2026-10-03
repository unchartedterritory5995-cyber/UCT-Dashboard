// UCT Terminal — the Boards and Recents menus (lane T2: V3, V11, V14, V19, V2's restore).
//
// Pure presentation over boardModel.js: every change is computed there and handed back to
// the shell through a callback, so the shell stays the ONE writer of the board documents.
import { useState } from 'react'
import { BY_CODE } from './functions'
import { boardAddress, encodeShare, PRESET_ANY_TICKER, recentBoards, shareHref } from './boardModel'
import TerminalVersions from './TerminalVersions'
import styles from './TerminalShell.module.css'

function shareUrl(board) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}${shareHref(encodeShare(board.name, board.layout, null))}`
}

function presetsFor(library, boardId) {
  return Object.entries(library.presets).filter(([, id]) => id === boardId).map(([k]) => k)
}

export function BoardsMenu({
  library, libraryWritable, currentName, onSave, onOpen, onDelete, onPreset, onKeepCalendar,
  onShareCurrent, onRestored,
}) {
  const [name, setName] = useState(currentName || '')
  const [presetSym, setPresetSym] = useState({})
  const [shared, setShared] = useState(null)
  const [showVersions, setShowVersions] = useState(false)

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
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()) }}
      >
        <label className={styles.menuLabel} htmlFor="terminal-board-name">Save this board as</label>
        <div className={styles.menuInline}>
          <input id="terminal-board-name" className={styles.menuInput} value={name} maxLength={60}
            onChange={(e) => setName(e.target.value)} placeholder="Earnings morning" data-testid="terminal-board-name" />
          <button type="submit" className={styles.menuBtn} disabled={!libraryWritable || !name.trim()}
            data-testid="terminal-board-save">Save</button>
        </div>
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
                <input className={styles.menuInputSm} value={presetSym[b.id] || ''} maxLength={10}
                  placeholder="NVDA or *" aria-label={`Ticker that opens ${b.name}`}
                  onChange={(e) => setPresetSym((s) => ({ ...s, [b.id]: e.target.value }))}
                  data-testid={`terminal-board-preset-input-${b.slug}`} />
                <button type="button" className={styles.menuBtn} disabled={!libraryWritable || !(presetSym[b.id] || '').trim()}
                  onClick={() => { onPreset((presetSym[b.id] || '').trim(), b.id); setPresetSym((s) => ({ ...s, [b.id]: '' })) }}
                  data-testid={`terminal-board-preset-${b.slug}`}>Set</button>
                {presets.map((p) => (
                  <button key={p} type="button" className={styles.chip} disabled={!libraryWritable}
                    onClick={() => onPreset(p, null)} aria-label={`Stop opening ${b.name} for ${p}`}>{p} ×</button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>

      {shared && (
        <div className={styles.menuShare} role="status" data-testid="terminal-share-link">
          <span className={styles.menuHint}>Share link for {shared.label} (copied when your browser allows):</span>
          <input className={styles.menuInput} readOnly value={shared.url} aria-label="Share link"
            onFocus={(e) => e.target.select()} />
        </div>
      )}

      <div className={styles.menuHead}>Classic calendar</div>
      <label className={styles.menuCheck}>
        <input type="checkbox" checked={library.keepCalendar} disabled={!libraryWritable}
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

export function RecentsMenu({ layout, library, functionRecents, onRun, onOpenBoard, onToggleFavorite }) {
  const saved = recentBoards(library, 6)
  const fnRow = (code) => (
    <li key={code} className={styles.menuRow}>
      <button type="button" className={styles.menuMainBtn} onClick={() => onRun(code)}>
        <span className={styles.code}>{code}</span>
        <span className={styles.menuLabel}>{BY_CODE[code]?.label || ''}</span>
      </button>
      <button type="button" className={styles.menuBtn} onClick={() => onToggleFavorite(code)}
        aria-pressed={library.favorites.includes(code)}
        aria-label={library.favorites.includes(code) ? `Unfavourite ${code}` : `Favourite ${code}`}
        data-testid={`terminal-fav-${code}`}>{library.favorites.includes(code) ? '★' : '☆'}</button>
    </li>
  )
  const channels = layout.channels.filter((c) => c.history.length > 0)
  return (
    <div className={styles.menu} data-testid="terminal-recents-menu">
      <div className={styles.menuHead}>Favourites</div>
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
              <span className={styles.groupDotStatic} style={{ '--dot': c.color }} aria-label={c.name}>{c.id}</span>
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
