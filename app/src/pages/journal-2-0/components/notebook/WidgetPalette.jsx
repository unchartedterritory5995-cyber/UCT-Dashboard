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
import { JOURNAL_MENU_TYPES, widgetMeta, isReconstructable } from '../../../../widgets/registry'
import {
  parseChartSlashArgs, parseMtfSlashArgs, parseCompareSlashArgs, chartInsertNodes, etTodayIso,
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
// the REAL parser decide validity — never a second validation path. On top of
// grammar validity, refuse what the RENDER path cannot serve (review
// findings): a future anchor (renders identical before/after halves — the
// exact trap the yearless-M/D roll-back exists to prevent, which the date
// picker's full ISO bypasses) and an anchor past the timeframe's re-render
// ceiling (would insert a permanently dead placeholder — the self-archive
// only arms on the live render path). Returns { args, reason }.
function parseSelection(kind, sym, tfTok, day) {
  const s = String(sym || '').trim()
  let args = null
  if (kind === 'mtf') args = s ? parseMtfSlashArgs([s, day].filter(Boolean).join(' ')) : null
  else if (kind === 'compare') {
    args = (s && day) ? parseCompareSlashArgs([s, day, tfTok !== 'D' ? tfTok : ''].filter(Boolean).join(' ')) : null
  } else {
    args = s ? parseChartSlashArgs([s, tfTok, day].filter(Boolean).join(' ')) : null
  }
  if (!args) return { args: null, reason: null }
  if (args.day) {
    if (args.day > etTodayIso()) return { args: null, reason: 'that date has not happened yet' }
    const tfs = kind === 'mtf' ? args.tfs : [args.tf || 'D']
    if (tfs.some((tf) => !isReconstructable('chart', { symbol: args.symbol, tf, to: args.day }))) {
      return { args: null, reason: 'no data that far back at that timeframe' }
    }
  }
  return { args, reason: null }
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

  const { args, reason: blockReason } = kind ? parseSelection(kind, sym, tfTok, day) : { args: null, reason: null }
  const multi = kind === 'mtf' || kind === 'compare'

  const insert = () => {
    if (!args || !editor) return
    const nodes = chartInsertNodes(kind, args, editor.storage?.uctJournalWidgets?.chartSettings)
    if (!nodes.length) return
    // caretAfterWidgetEmbed BEFORE the insert too: clicking an embed leaves a
    // NodeSelection ON the atom, focus() restores it, and insertContent over
    // a NodeSelection REPLACES the node (the trap that ate an embed on 8/13).
    // The slash path can't reach this state — typing collapses the selection
    // — but a palette click doesn't, so the entry side needs the same guard
    // as the exit side.
    editor.chain().focus()
      .caretAfterWidgetEmbed()
      .insertContent(nodes)
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
            onChange={(e) => setSym(e.target.value.toUpperCase().replace(/\s+/g, ''))}
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
            max={etTodayIso()}
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
          {blockReason && <span className={styles.blockMsg} role="status">{blockReason}</span>}
          {inserted && !blockReason && <span className={styles.insertedMsg} role="status">{inserted}</span>}
        </div>
      )}
    </div>
  )
}
