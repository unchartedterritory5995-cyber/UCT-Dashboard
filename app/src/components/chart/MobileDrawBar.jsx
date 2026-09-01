import UIcon from '../ui/UIcon'
import { TOOL_ICONS } from './ChartToolbar'
import styles from './MobileDrawBar.module.css'

/* MobileDrawBar — the phone presentation of the drawing tools (wave 8).
 *
 * The desktop ChartToolbar wraps ~20 unlabeled 40px squares into three rows on
 * a phone — the single clunkiest surface the owner named against TradingView
 * mobile. This is the TradingView-shaped replacement: a slide-up strip docked
 * to the bottom of the chart with LABELED, thumb-sized tool tiles in one
 * horizontal scroll row, pinned Done on the left and pinned history/eraser/
 * magnet controls on the right. It presents state it does not own: activeTool,
 * undo/redo and magnet are StockChart's — the SAME state ChartDrawingOverlay
 * draws with and ChartToolbar (hidden on this shell, dialogs still mounted)
 * would show. One arming machinery, two presentations.
 *
 * Tool ids and glyphs come from ChartToolbar's exported TOOL_ICONS — a copied
 * glyph set would drift the day a tool is added.
 */

// The roster, in reach-for order. Labels are the accessible names the rig arms
// tools by — keep them stable. `eraser` is real (ChartDrawingOverlay deletes
// whatever an armed-eraser tap hits) — it never had a desktop button.
const DRAW_TOOLS = [
  { id: 'trendline',  label: 'Trend' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'hray',       label: 'Ray' },
  { id: 'rect',       label: 'Rectangle' },
  { id: 'fib',        label: 'Fib' },
  { id: 'channel',    label: 'Channel' },
  { id: 'avwap',      label: 'AVWAP' },
  { id: 'vertical',   label: 'Vertical' },
  { id: 'extended',   label: 'Extended' },
  { id: 'arrow',      label: 'Arrow' },
  { id: 'circle',     label: 'Circle' },
  { id: 'text',       label: 'Text' },
  { id: 'measure',    label: 'Measure' },
  { id: 'position',   label: 'Position' },
  { id: 'fibext',     label: 'Fib Ext' },
  { id: 'pitchfork',  label: 'Pitchfork' },
]

export default function MobileDrawBar({
  open, onClose,
  activeTool, setActiveTool,
  onUndo, onRedo, canUndo = false, canRedo = false,
  magnet, setMagnet,
}) {
  if (!open) return null

  const arm = (id) => setActiveTool(activeTool === id ? null : id)

  return (
    <div className={styles.bar} role="toolbar" aria-label="Drawing tools" data-testid="mobile-draw-bar">
      <button
        type="button"
        className={styles.done}
        onClick={() => { setActiveTool(null); onClose() }}
        aria-label="Done drawing"
      >
        Done
      </button>

      <div className={styles.tools}>
        {DRAW_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tool} ${activeTool === t.id ? styles.toolActive : ''}`}
            onClick={() => arm(t.id)}
            aria-label={t.label}
            aria-pressed={activeTool === t.id}
          >
            <span className={styles.glyph} aria-hidden="true">{TOOL_ICONS[t.id]}</span>
            <span className={styles.label}>{t.label}</span>
          </button>
        ))}
      </div>

      <div className={styles.side}>
        <button
          type="button"
          className={`${styles.tool} ${activeTool === 'eraser' ? styles.toolActive : ''}`}
          onClick={() => arm('eraser')}
          aria-label="Eraser"
          aria-pressed={activeTool === 'eraser'}
        >
          <span className={styles.glyph} aria-hidden="true">{TOOL_ICONS.delete}</span>
          <span className={styles.label}>Eraser</span>
        </button>
        <button type="button" className={styles.ctl} onClick={onUndo} disabled={!canUndo} aria-label="Undo">
          <span className={styles.glyph} aria-hidden="true">{TOOL_ICONS.undo}</span>
        </button>
        <button type="button" className={styles.ctl} onClick={onRedo} disabled={!canRedo} aria-label="Redo">
          <span className={styles.glyph} aria-hidden="true">{TOOL_ICONS.redo}</span>
        </button>
        <button
          type="button"
          className={`${styles.ctl} ${magnet ? styles.ctlOn : ''}`}
          onClick={() => setMagnet(!magnet)}
          aria-label="Snap to price"
          aria-pressed={!!magnet}
          title="Snap to OHLC"
        >
          <UIcon name="magnet" size={17} gold={false} />
        </button>
      </div>
    </div>
  )
}
