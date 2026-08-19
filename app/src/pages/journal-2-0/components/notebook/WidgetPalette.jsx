/**
 * Widget palette — the point-and-click twin of the slash commands (owner ask:
 * "click Charts → What ticker? What time frame? Boom — click, click, click").
 *
 * One authority everywhere: the type roster derives from the registry's
 * menus.journal flag (the same set the slash menu offers) plus the two
 * composition presets the slash menu defines; validation runs the SAME
 * parsers as the slash grammar (a token string is assembled from the clicked
 * choices and parsed — the palette IS a clickable front-end over that
 * grammar); the insert payload comes from chartInsertNodes, the builder the
 * slash commands ride. Nothing here re-states a grammar or a payload.
 *
 * Settings ride the editor-storage stamp (stampChartSettings), so a palette
 * insert freezes the user's resolved own chart exactly like /chart does.
 */
import { useEffect, useRef, useState } from 'react'
import { JOURNAL_MENU_TYPES, widgetMeta } from '../../../../widgets/registry'
import {
  parseChartSlashArgs, parseMtfSlashArgs, parseCompareSlashArgs, chartInsertNodes,
} from '../../lib/widgetEmbedCore'
import styles from './WidgetPalette.module.css'

// The tf pills speak slash TOKENS ('15m', '1h', 'M' — case decides
// month-vs-minute), so the parser below is the one validator.
const TF_PILLS = ['1m', '5m', '15m', '30m', '1h', 'D', 'W', 'M']

// The two composition presets the slash menu offers (/mtf, /compare). They
// are compositions, not registry types — SlashMenu.widgetItems is the
// sibling list; add a preset in both places or it ships half-reachable.
const PRESETS = [
  { kind: 'mtf', label: 'MTF stack', hint: 'Three frozen charts, top-down: D · 1h · 15m' },
  { kind: 'compare', label: 'Before / after', hint: 'Half-width pair: window ending a date vs now' },
]

// Assemble the clicked choices into the slash grammar's token string and let
// the REAL parser decide validity — never a second validation path.
function parseSelection(kind, sym, tfTok, day) {
  const s = String(sym || '').trim()
  if (kind === 'mtf') return s ? parseMtfSlashArgs([s, day].filter(Boolean).join(' ')) : null
  if (kind === 'compare') {
    if (!s || !day) return null
    return parseCompareSlashArgs([s, day, tfTok !== 'D' ? tfTok : ''].filter(Boolean).join(' '))
  }
  return s ? parseChartSlashArgs([s, tfTok, day].filter(Boolean).join(' ')) : null
}

export default function WidgetPalette({ editor, onClose }) {
  const [kind, setKind] = useState(null)   // null = the type list
  const [sym, setSym] = useState('')
  const [tfTok, setTfTok] = useState('D')
  const [day, setDay] = useState('')
  const [inserted, setInserted] = useState(null)
  const symRef = useRef(null)

  // Opening a form focuses the ticker — the whole point is speed.
  useEffect(() => {
    if (kind) symRef.current?.focus()
  }, [kind])

  const args = kind ? parseSelection(kind, sym, tfTok, day) : null
  const multi = kind === 'mtf' || kind === 'compare'

  const insert = () => {
    if (!args || !editor) return
    const settings = editor.storage?.uctJournalWidgets?.chartSettings
    editor.chain().focus()
      .insertContent(chartInsertNodes(kind, args, settings))
      .caretAfterWidgetEmbed()
      .run()
    // Stay open, clear the ticker, refocus — "click, click, click" means the
    // next insert starts immediately.
    setInserted(`${args.symbol} inserted`)
    setSym('')
    symRef.current?.focus()
  }

  const backToList = () => { setKind(null); setSym(''); setDay(''); setInserted(null) }

  return (
    <div className={styles.panel} role="dialog" aria-label="Insert widget" contentEditable={false}>
      <div className={styles.panelHead}>
        {kind ? (
          <button type="button" className={styles.headBtn} onClick={backToList}>‹ Back</button>
        ) : (
          <span className={styles.headTitle}>Insert widget</span>
        )}
        {onClose && (
          <button type="button" className={styles.headBtn} onClick={onClose} aria-label="Close insert panel">✕</button>
        )}
      </div>

      {!kind && (
        <div className={styles.typeList}>
          {/* Registry half of the roster — every menus.journal type, labeled
              by the registry (today: chart; a new journal-menu type appears
              here the day it lands). */}
          {JOURNAL_MENU_TYPES.map((id) => (
            <button key={id} type="button" className={styles.typeBtn} onClick={() => setKind(id)}>
              <span className={styles.typeLabel}>{widgetMeta(id)?.labels?.menu || id}</span>
              <span className={styles.typeHint}>Frozen snapshot — your chart settings and drawings</span>
            </button>
          ))}
          {PRESETS.map((p) => (
            <button key={p.kind} type="button" className={styles.typeBtn} onClick={() => setKind(p.kind)}>
              <span className={styles.typeLabel}>{p.label}</span>
              <span className={styles.typeHint}>{p.hint}</span>
            </button>
          ))}
          <div className={styles.footNote}>
            Widgets with live data (news, breadth, calendar…) come in from their
            own page — use the journal button beside each widget&apos;s gear.
          </div>
        </div>
      )}

      {kind && (
        <div className={styles.form}>
          <label className={styles.fieldLabel} htmlFor="uct-palette-sym">Ticker</label>
          <input
            id="uct-palette-sym"
            ref={symRef}
            className={styles.symInput}
            value={sym}
            placeholder="e.g. AMD"
            onChange={(e) => setSym(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') insert() }}
          />
          {kind !== 'mtf' && (
            <>
              <span className={styles.fieldLabel}>Timeframe</span>
              <div className={styles.tfRow} role="group" aria-label="Timeframe">
                {TF_PILLS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.tfPill} ${tfTok === t ? styles.tfPillActive : ''}`}
                    onClick={() => setTfTok(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </>
          )}
          <label className={styles.fieldLabel} htmlFor="uct-palette-day">
            {kind === 'compare' ? 'Anchor date' : 'Date (optional)'}
          </label>
          <input
            id="uct-palette-day"
            type="date"
            className={styles.dayInput}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <button
            type="button"
            className={styles.insertBtn}
            disabled={!args}
            onClick={insert}
          >
            {multi ? 'Insert charts' : 'Insert chart'}
          </button>
          {inserted && <span className={styles.insertedMsg} role="status">{inserted}</span>}
        </div>
      )}
    </div>
  )
}
