// app/src/pages/MultiChart.jsx — Multi-chart layout page (1×1 / 2×1 / 2×2 / 3×1)
import { useState, useCallback } from 'react'
import StockChart from '../components/StockChart'
import styles from './MultiChart.module.css'

const LAYOUTS = [
  { id: '1x1', label: '1×1', cols: 1, rows: 1, count: 1 },
  { id: '2x1', label: '2×1', cols: 2, rows: 1, count: 2 },
  { id: '2x2', label: '2×2', cols: 2, rows: 2, count: 4 },
  { id: '3x1', label: '3×1', cols: 3, rows: 1, count: 3 },
]

const TF_OPTIONS = ['D', 'W', '60', '30', '15', '5', '1']
const TF_LABELS  = { D: 'D', W: 'W', '60': '1H', '30': '30m', '15': '15m', '5': '5m', '1': '1m' }

const LS_KEY = 'uct_multichart_state'

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || null
  } catch { return null }
}

function defaultPanes() {
  return [
    { sym: 'SPY',  tf: 'D' },
    { sym: 'QQQ',  tf: 'D' },
    { sym: 'AAPL', tf: 'D' },
    { sym: 'NVDA', tf: 'D' },
  ]
}

export default function MultiChartPage() {
  const saved = loadState()
  const [layout, setLayout]   = useState(saved?.layout || '2x2')
  const [panes,  setPanes]    = useState(saved?.panes  || defaultPanes())
  const [editing, setEditing] = useState(null) // index of pane being edited

  const activeLayout = LAYOUTS.find(l => l.id === layout) || LAYOUTS[2]
  const visiblePanes = panes.slice(0, activeLayout.count)

  function save(nextLayout, nextPanes) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ layout: nextLayout, panes: nextPanes })) }
    catch {}
  }

  function setLayoutAndSave(id) {
    setLayout(id)
    save(id, panes)
  }

  function updatePane(idx, partial) {
    setPanes(prev => {
      const next = prev.map((p, i) => i === idx ? { ...p, ...partial } : p)
      save(layout, next)
      return next
    })
  }

  const handleSymbolCommit = useCallback((idx, raw) => {
    const sym = raw.trim().toUpperCase()
    if (sym) updatePane(idx, { sym })
    setEditing(null)
  }, [])

  return (
    <div className={styles.page}>
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>Multi-Chart</span>
        <div className={styles.layoutBtns}>
          {LAYOUTS.map(l => (
            <button
              key={l.id}
              className={`${styles.layoutBtn} ${layout === l.id ? styles.layoutBtnActive : ''}`}
              onClick={() => setLayoutAndSave(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chart grid ── */}
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${activeLayout.cols}, 1fr)`,
          gridTemplateRows: `repeat(${activeLayout.rows}, 1fr)`,
        }}
      >
        {visiblePanes.map((pane, idx) => (
          <div key={idx} className={styles.pane}>
            {/* Pane header */}
            <div className={styles.paneHeader}>
              {editing === idx ? (
                <input
                  className={styles.symInput}
                  defaultValue={pane.sym}
                  autoFocus
                  onBlur={e => handleSymbolCommit(idx, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSymbolCommit(idx, e.target.value)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <button className={styles.symBtn} onClick={() => setEditing(idx)}>
                  {pane.sym}
                </button>
              )}
              <div className={styles.tfRow}>
                {TF_OPTIONS.map(tf => (
                  <button
                    key={tf}
                    className={`${styles.tfBtn} ${pane.tf === tf ? styles.tfBtnActive : ''}`}
                    onClick={() => updatePane(idx, { tf })}
                  >
                    {TF_LABELS[tf]}
                  </button>
                ))}
              </div>
            </div>

            {/* StockChart fills the rest */}
            <div className={styles.chartWrap}>
              <StockChart
                sym={pane.sym}
                tf={pane.tf}
                height="100%"
                showDrawingTools={true}
                onTfChange={tf => updatePane(idx, { tf })}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
