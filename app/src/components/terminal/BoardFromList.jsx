// Scan-to-board — the ONE control a list panel shows to turn its names into a board of panels
// (feature-gaps-2026-10-06 #9, Bloomberg's launchpad monitors). MOST and the embedded screener
// both render it; neither builds a board itself. It hands `{ code, syms, label }` to the shell
// through `PanelListContext` (terminalPanel.js), and the shell does the rest: the 4-panel limit,
// paging, "Back to my layout", saving. Outside a terminal panel it renders nothing.
import { useId, useState } from 'react'
import Select from '../ui/Select'
import { usePanelBoard } from './terminalPanel'
import styles from './BoardFromList.module.css'

export default function BoardFromList({ syms, label, total = null, testId = 'terminal-board-from-list' }) {
  const api = usePanelBoard()
  const id = useId()
  const [picked, setPicked] = useState(null)
  const codes = Array.isArray(api?.codes) ? api.codes : []
  if (!api?.openBoard || !codes.length) return null
  const list = (Array.isArray(syms) ? syms : []).filter(Boolean)
  const code = codes.some((c) => c.code === picked) ? picked : codes[0].code
  const n = list.length
  const page = api.pageSize || 4
  const shown = Math.min(n, page)
  // The button says how many of how many, so a long list is never presented as fitting.
  const text = !n ? 'Nothing to open' : n > page ? `Open ${shown} of ${n}` : `Open ${n}`
  return (
    <span className={styles.wrap} data-testid={testId}>
      <label htmlFor={id} className={styles.label}>Board of</label>
      <Select id={id} className={styles.select} value={code} onChange={(e) => setPicked(e.target.value)}
        data-testid={`${testId}-code`}
        options={codes.map((c) => ({ value: c.code, label: `${c.code} · ${c.label}` }))} />
      <button type="button" className={styles.btn} disabled={!n}
        onClick={() => api.openBoard({ code, syms: list, label, total })}
        aria-label={n
          ? `Open ${label || 'this list'} as a board of ${code}: ${shown} of ${n} name${n === 1 ? '' : 's'}${n > page ? `, ${page} panels at a time` : ''}`
          : 'There are no names in this list to open as a board'}
        title={n > page ? `A board shows ${page} panels at a time; Next and Previous page through the rest.` : undefined}
        data-testid={`${testId}-open`}>
        {text}
      </button>
    </span>
  )
}
