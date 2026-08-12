// Compare Symbols — Tools → overlay other tickers' normalized % performance on the
// active chart. A centered modal (same chrome as the Custom-Period Sort dialog). Adds
// either an individual ticker OR a whole group (theme / sector / industry — every
// member overlaid at once, tracked as a collapsible group). Each item picks its own
// price scale (Same % scale / New price scale).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import { pickComparisonColor } from '../../components/chart/comparisonUtils'
import shell from './PeriodSortPanel.module.css'
import c from './CompareSymbolsPanel.module.css'

const GROUP_TYPES = [
  { key: 'theme', label: 'Themes' },
  { key: 'sector', label: 'Sectors' },
  { key: 'industry', label: 'Industries' },
]

export default function CompareSymbolsPanel({ chartApiById, activeChartRef, onClose }) {
  const [symbols, setSymbols] = useState([])
  const [ready, setReady] = useState(false)
  const [entry, setEntry] = useState('')
  // Group picker
  const [groupType, setGroupType] = useState(null)   // null | 'theme' | 'sector' | 'industry'
  const [groupList, setGroupList] = useState([])
  const [groupQuery, setGroupQuery] = useState('')
  const [groupBusy, setGroupBusy] = useState(false)
  const [expanded, setExpanded] = useState({})       // group name -> bool (panel expand)
  const [hideBase, setHideBase] = useState(false)    // "Group only" — hide base candles/MAs/volume
  const apiRef = useRef(null)

  // Resolve the target chart's API — the active chart if it's registered, else the
  // first mounted chart. Retries briefly so a just-auto-opened chart is picked up.
  useEffect(() => {
    let tries = 0
    const resolve = () => {
      const map = chartApiById?.current
      if (map && map.size) {
        const active = activeChartRef?.current
        const api = (active && map.has(active)) ? map.get(active) : map.get([...map.keys()][0])
        if (api) {
          apiRef.current = api
          setSymbols(api.getComparison() || [])
          try { if (api.getPercentScale && api.getPercentScale()) api.setPercentScale(false) } catch { /* older api */ }
          try { setHideBase(!!(api.getHideBase && api.getHideBase())) } catch { /* older api */ }
          setReady(true)
          return true
        }
      }
      return false
    }
    if (resolve()) return undefined
    const t = setInterval(() => { if (resolve() || ++tries > 20) clearInterval(t) }, 150)
    return () => clearInterval(t)
  }, [chartApiById, activeChartRef])

  // Escape closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load the group list when a type is chosen.
  useEffect(() => {
    if (!groupType) { setGroupList([]); return undefined }
    let alive = true
    setGroupBusy(true)
    fetch(`/api/compare/groups?type=${groupType}`)
      .then(r => (r.ok ? r.json() : { groups: [] }))
      .then(j => { if (alive) setGroupList(j.groups || []) })
      .catch(() => { if (alive) setGroupList([]) })
      .finally(() => { if (alive) setGroupBusy(false) })
    return () => { alive = false }
  }, [groupType])

  const push = useCallback((next) => {
    setSymbols(next)
    apiRef.current?.setComparison(next)
  }, [])

  const addSymbol = useCallback((raw) => {
    const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '')
    if (!s) return
    setSymbols(prev => {
      if (prev.some(x => x.sym === s)) return prev
      const next = [...prev, { sym: s, enabled: true, color: pickComparisonColor(prev.length), scaleMode: 'new' }]
      apiRef.current?.setComparison(next)
      return next
    })
    setEntry('')
  }, [])

  const addGroup = useCallback(async (name) => {
    if (!groupType || !name) return
    try {
      const r = await fetch(`/api/compare/group-members?type=${groupType}&name=${encodeURIComponent(name)}`)
      const j = r.ok ? await r.json() : null
      const members = (j?.symbols || []).map(s => String(s).toUpperCase())
      if (!members.length) return
      setSymbols(prev => {
        const have = new Set(prev.map(x => x.sym))
        let idx = prev.length
        const additions = []
        for (const s of members) {
          if (have.has(s)) continue
          additions.push({ sym: s, enabled: true, color: pickComparisonColor(idx++), scaleMode: 'new', group: name })
        }
        if (!additions.length) return prev
        const next = [...prev, ...additions]
        apiRef.current?.setComparison(next)
        return next
      })
      setGroupType(null)
      setGroupQuery('')
    } catch { /* ignore */ }
  }, [groupType])

  const removeSymbol = useCallback((sym) => { push(symbols.filter(x => x.sym !== sym)) }, [symbols, push])
  const removeGroup = useCallback((name) => { push(symbols.filter(x => x.group !== name)) }, [symbols, push])
  const clearAll = useCallback(() => { push([]); setHideBase(false); apiRef.current?.setHideBase?.(false) }, [push])
  const toggleHideBase = useCallback(() => {
    setHideBase(v => { const nv = !v; apiRef.current?.setHideBase?.(nv); return nv })
  }, [])

  // Per-item scale choice. For a group it applies to every member.
  const setScaleMode = useCallback((sym, sm) => {
    push(symbols.map(x => x.sym === sym ? { ...x, scaleMode: sm } : x))
  }, [symbols, push])
  const setGroupScale = useCallback((name, sm) => {
    push(symbols.map(x => x.group === name ? { ...x, scaleMode: sm } : x))
  }, [symbols, push])

  // Split into individual tickers + named groups (stable first-seen order).
  const { individuals, groups } = useMemo(() => {
    const inds = []
    const gmap = new Map()
    for (const s of symbols) {
      if (s.group) {
        if (!gmap.has(s.group)) gmap.set(s.group, [])
        gmap.get(s.group).push(s)
      } else inds.push(s)
    }
    return { individuals: inds, groups: [...gmap.entries()].map(([name, items]) => ({ name, items })) }
  }, [symbols])

  const filteredGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase()
    if (!q) return groupList
    return groupList.filter(g => g.name.toLowerCase().includes(q))
  }, [groupList, groupQuery])

  const nothing = symbols.length === 0

  return (
    <div className={shell.cfgBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={c.card} role="dialog" aria-label="Compare Symbols">
        <div className={c.head}>
          <span className={c.headTitle}>Compare Symbols</span>
          {!nothing && <button type="button" className={c.clear} onClick={clearAll} title="Remove all comparisons">Clear all</button>}
          <button type="button" className={c.close} onClick={onClose} title="Close" aria-label="Close"><UIcon name="x" size={13} gold={false} /></button>
        </div>

        <div className={c.body}>
          {/* Add a single ticker */}
          <input
            className={c.input}
            value={entry}
            onChange={e => setEntry(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addSymbol(entry); else if (e.key === 'Escape') setEntry('') }}
            placeholder="+ Add symbol (e.g. QQQ) — Enter"
            spellCheck={false}
            autoComplete="off"
          />

          {/* Add a whole group */}
          <div className={c.groupPick}>
            <div className={c.groupTabs}>
              {GROUP_TYPES.map(t => (
                <button
                  key={t.key}
                  type="button"
                  className={`${c.groupTab}${groupType === t.key ? ' ' + c.groupTabOn : ''}`}
                  onClick={() => { setGroupType(groupType === t.key ? null : t.key); setGroupQuery('') }}
                >{t.label}</button>
              ))}
            </div>
            {groupType && (
              <div className={c.groupBox}>
                <input
                  className={c.input}
                  value={groupQuery}
                  onChange={e => setGroupQuery(e.target.value)}
                  placeholder={`Search ${groupType}s…`}
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className={c.groupResults}>
                  {groupBusy ? (
                    <div className={c.empty}>Loading…</div>
                  ) : filteredGroups.length ? (
                    filteredGroups.map(g => (
                      <button key={g.name} type="button" className={c.groupResultRow} onClick={() => addGroup(g.name)}>
                        <span className={c.groupResultName}>{g.name}</span>
                        <span className={c.groupResultCount}>{g.count}</span>
                      </button>
                    ))
                  ) : (
                    <div className={c.empty}>No matches</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          {nothing ? (
            <div className={c.empty}>{ready ? 'No comparisons yet. Add a ticker or a group above.' : 'Connecting to the chart…'}</div>
          ) : (
            <div className={c.list}>
              {/* Groups */}
              {groups.map(g => {
                const scaleMode = g.items[0]?.scaleMode === 'same' ? 'same' : 'new'
                const open = !!expanded[g.name]
                return (
                  <div key={`g:${g.name}`} className={c.row}>
                    <div className={c.rowMain}>
                      <button type="button" className={c.groupChevron} onClick={() => setExpanded(p => ({ ...p, [g.name]: !p[g.name] }))} aria-label={open ? 'Collapse' : 'Expand'}>
                        <UIcon name={open ? 'chevronDown' : 'chevronRight'} size={12} gold={false} />
                      </button>
                      <span className={c.groupBadge}>{g.name}</span>
                      <span className={c.groupN}>· {g.items.length}</span>
                      <button type="button" className={c.rm} onClick={() => removeGroup(g.name)} title={`Remove ${g.name}`} aria-label={`Remove ${g.name}`}><UIcon name="x" size={10} gold={false} /></button>
                    </div>
                    <div className={c.scaleSeg}>
                      <button type="button" className={`${c.scaleBtn}${scaleMode === 'same' ? ' ' + c.scaleOn : ''}`} onClick={() => setGroupScale(g.name, 'same')} title="Share the main price scale">Same % scale</button>
                      <button type="button" className={`${c.scaleBtn}${scaleMode !== 'same' ? ' ' + c.scaleOn : ''}`} onClick={() => setGroupScale(g.name, 'new')} title="Own left % scale">New price scale</button>
                    </div>
                    {open && (
                      <div className={c.groupMembers}>
                        {g.items.map(s => (
                          <div key={s.sym} className={c.memberRow}>
                            <span className={c.dot} style={{ background: s.color }} />
                            <span className={c.memberSym}>{s.sym}</span>
                            <button type="button" className={c.rm} onClick={() => removeSymbol(s.sym)} title={`Remove ${s.sym}`} aria-label={`Remove ${s.sym}`}><UIcon name="x" size={9} gold={false} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Individual tickers */}
              {individuals.map(s => (
                <div key={s.sym} className={c.row}>
                  <div className={c.rowMain}>
                    <span className={c.dot} style={{ background: s.color }} />
                    <span className={c.sym}>{s.sym}</span>
                    <button type="button" className={c.rm} onClick={() => removeSymbol(s.sym)} title={`Remove ${s.sym}`} aria-label={`Remove ${s.sym}`}><UIcon name="x" size={10} gold={false} /></button>
                  </div>
                  <div className={c.scaleSeg}>
                    <button type="button" className={`${c.scaleBtn}${s.scaleMode === 'same' ? ' ' + c.scaleOn : ''}`} onClick={() => setScaleMode(s.sym, 'same')} title="Share the main price scale">Same % scale</button>
                    <button type="button" className={`${c.scaleBtn}${s.scaleMode !== 'same' ? ' ' + c.scaleOn : ''}`} onClick={() => setScaleMode(s.sym, 'new')} title="Own left % scale">New price scale</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!nothing && (
            <button
              type="button"
              className={`${c.hideBaseToggle}${hideBase ? ' ' + c.hideBaseOn : ''}`}
              onClick={toggleHideBase}
              title={hideBase ? 'Show the base chart, volume and moving averages again' : 'Hide the base chart so only the comparison lines show'}
            >
              <span className={c.hideBaseBox}>{hideBase ? '✓' : ''}</span>
              <span>{hideBase ? 'Group only — base chart hidden (click to bring it back)' : 'Group only — hide the base chart'}</span>
            </button>
          )}
          <div className={c.hint}>Normalized to 0% at the left edge of the framed range.</div>
        </div>
      </div>
    </div>
  )
}
