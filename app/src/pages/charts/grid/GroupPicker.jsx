// app/src/pages/charts/grid/GroupPicker.jsx
//
// Groups picker for the Multi Charts menu. Pick a theme -> the grid repopulates
// with its today's-move leaders (top-N for the CURRENT grid size; no resize).
import { useEffect, useMemo, useState } from 'react'
import { parseLayoutId } from './gridLayouts'
import { fetchGroups, fetchGroupTop } from './groupsApi'
import wsStyles from '../ChartsWorkspace.module.css'
import styles from './MultiChartGrid.module.css'

export default function GroupPicker({ mc, onClose }) {
  const [groups, setGroups] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => { let live = true; fetchGroups().then(g => { if (live) setGroups(g) }); return () => { live = false } }, [])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return groups
    return groups.filter(g => (g.name || '').toLowerCase().includes(s))
  }, [groups, q])

  const pick = async (g) => {
    setBusy(g.id)
    const n = parseLayoutId(mc.state.layout).cellCount
    if (mc.state.mode !== 'grid') mc.enterGrid(mc.state.layout)
    const { syms, etf } = await fetchGroupTop(g.id, { n, by: 'today' })
    const filled = etf ? [etf, ...(syms || []).filter(s => s !== etf)].slice(0, n) : (syms || [])
    if (filled.length) mc.fillCells(filled, { id: g.id, by: 'today', n })
    setBusy('')
    onClose?.()
  }

  return (
    <div className={styles.groupPicker}>
      <div className={wsStyles.menuSection}>Groups</div>
      <input
        className={wsStyles.menuInput}
        placeholder="Search groups…"
        value={q}
        onChange={e => setQ(e.target.value)}
        aria-label="Search groups"
      />
      <div className={styles.groupList}>
        {shown.map(g => (
          <button
            key={g.id}
            type="button"
            className={wsStyles.addMenuItem}
            disabled={busy === g.id}
            onClick={() => pick(g)}
          >
            <span style={{ flex: 1 }}>{g.name}</span>
            <span className={styles.groupCount}>{g.chartable}</span>
          </button>
        ))}
        {shown.length === 0 && <div className={styles.groupEmpty}>No groups</div>}
      </div>
    </div>
  )
}
