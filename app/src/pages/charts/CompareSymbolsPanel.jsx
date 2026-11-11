// Compare Symbols — Tools → overlay other tickers' normalized % performance on the
// active chart. A centered modal (same chrome as the Custom-Period Sort dialog). Adds
// either an individual ticker OR a whole group (theme / sector / industry — every
// member overlaid at once, tracked as a collapsible group). Each item picks its own
// price scale (Same % scale / New price scale).
//
// Two tabs (UCT RS Phase 3, unit 3-12): "Overlay" is the panel above, unchanged; "Rotation"
// (CompareRotation.jsx, loaded on first use) plots the same names, a group or a watchlist on the
// Terminal's relative-rotation graph. A `uct:compare-open` window event with `tab: 'rotation'`
// (unit 3-09) opens the panel on that tab; ChartsWorkspace mounts the panel for it.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import { pickComparisonColor } from '../../components/chart/comparisonUtils'
import shell from './PeriodSortPanel.module.css'
import c from './CompareSymbolsPanel.module.css'
import Input from '../../components/ui/Input'
import useFocusTrap from '../../components/mobile/useFocusTrap'
import { COMPARE_OPEN_EVENT, GROUP_TYPES, fetchGroupList, fetchGroupMembers, withGroupAdded, withoutGroup, withGroupScale } from './compareGroups'

const CompareRotation = lazy(() => import('./CompareRotation'))

const TABS = [
  { key: 'overlay', label: 'Overlay' },
  { key: 'rotation', label: 'Rotation' },
]

/** A fresh intent object per open, so the Rotation tab acts on each one once. */
const intentOf = (detail) => (detail && detail.tab === 'rotation' ? { ...detail } : null)

export default function CompareSymbolsPanel({ chartApiById, activeChartRef, onClose, initialIntent = null }) {
  const [tab, setTab] = useState(() => (initialIntent?.tab === 'rotation' ? 'rotation' : 'overlay'))
  const [intent, setIntent] = useState(() => intentOf(initialIntent))
  const tabRefs = useRef({})
  const cardRef = useRef(null)
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

  // ⭐ a11y gate §12.2 (2026-11-08) — A MODAL THAT HOLDS FOCUS. It opened with focus on
  // <body> (or the Tools button behind it), and Tab walked the page under the backdrop.
  // Now: focus moves to the selected tab on open, Tab and Shift+Tab wrap inside the card
  // (`useFocusTrap`, the one trap `Sheet` and the chip popover use), and on close focus
  // goes back to what held it when the panel opened, while that is still on the page.
  useFocusTrap(true, cardRef)
  useEffect(() => {
    const card = cardRef.current
    const was = typeof document !== 'undefined' ? document.activeElement : null
    const opener = was && was !== document.body && !(card && card.contains(was)) ? was : null
    let raf = 0
    let tries = 0
    const take = () => {
      const el = cardRef.current
      if (!el || el.contains(document.activeElement)) return
      const first = el.querySelector('[role="tab"][aria-selected="true"]') || el.querySelector('[role="tab"]')
        || el.querySelector('button[aria-label="Close"]')
      ;(first || el).focus?.({ preventScroll: true })
      if (!el.contains(document.activeElement) && tries < 12) { tries += 1; raf = requestAnimationFrame(take) }
    }
    take()
    return () => {
      cancelAnimationFrame(raf)
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true })
    }
  }, [])

  // Escape closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // An open while the panel is already up switches the tab (unit 3-09's rotation link).
  useEffect(() => {
    const onOpen = (e) => {
      const d = e?.detail || {}
      if (d.tab === 'rotation') { setTab('rotation'); setIntent(intentOf(d)) }
      else if (d.tab === 'overlay') setTab('overlay')
    }
    window.addEventListener(COMPARE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(COMPARE_OPEN_EVENT, onOpen)
  }, [])

  // Load the group list when a type is chosen.
  useEffect(() => {
    if (!groupType) { setGroupList([]); return undefined }
    let alive = true
    setGroupBusy(true)
    fetchGroupList(groupType)
      .then(list => { if (alive) setGroupList(list) })
      .finally(() => { if (alive) setGroupBusy(false) })
    return () => { alive = false }
  }, [groupType])

  const push = useCallback((next) => {
    setSymbols(next)
    apiRef.current?.setComparison(next)
  }, [])

  const addSymbol = useCallback((raw) => {
    // ⚠️ `:` and `$` SURVIVE THE SANITISER. They were stripped, which silently
    // turned a namespaced canonical symbol into a different one — `$IDX:AI` became
    // `IDXAI`, a ticker we do not hold, and the comparison drew nothing with no
    // error. Everything else is still removed: this is a paste-and-typo guard, not
    // a grammar.
    const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.:$^-]/g, '')
    if (!s) return
    setSymbols(prev => {
      if (prev.some(x => x.sym === s)) return prev
      const used = prev.map(x => x.color)
      const next = [...prev, { sym: s, enabled: true, color: pickComparisonColor(prev.length, used), scaleMode: 'new' }]
      apiRef.current?.setComparison(next)
      return next
    })
    setEntry('')
  }, [])

  const addGroup = useCallback(async (name) => {
    if (!groupType || !name) return
    try {
      const members = (await fetchGroupMembers(groupType, name))?.symbols || []
      if (!members.length) return
      // The one list write for a group (compareGroups.withGroupAdded), shared with the Agent's chart.compareGroup.
      setSymbols(prev => {
        const next = withGroupAdded(prev, name, members, pickComparisonColor)
        if (next === prev) return prev
        apiRef.current?.setComparison(next)
        return next
      })
      setGroupType(null)
      setGroupQuery('')
    } catch { /* ignore */ }
  }, [groupType])

  const removeSymbol = useCallback((sym) => { push(symbols.filter(x => x.sym !== sym)) }, [symbols, push])
  const removeGroup = useCallback((name) => { push(withoutGroup(symbols, name)) }, [symbols, push])
  const clearAll = useCallback(() => { push([]); setHideBase(false); apiRef.current?.setHideBase?.(false) }, [push])
  const toggleHideBase = useCallback(() => {
    setHideBase(v => { const nv = !v; apiRef.current?.setHideBase?.(nv); return nv })
  }, [])

  // Per-item scale choice. For a group it applies to every member.
  const setScaleMode = useCallback((sym, sm) => {
    push(symbols.map(x => x.sym === sym ? { ...x, scaleMode: sm } : x))
  }, [symbols, push])
  const setGroupScale = useCallback((name, sm) => {
    push(withGroupScale(symbols, name, sm))
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
  const ownSyms = useMemo(() => symbols.map(x => x.sym), [symbols])

  // A proper tablist: Left/Right/Home/End move between the tabs and select them.
  const onTabKey = (e) => {
    const i = TABS.findIndex(t => t.key === tab)
    const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length
      : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    setTab(TABS[to].key)
    tabRefs.current[TABS[to].key]?.focus()
  }

  return (
    <div className={shell.cfgBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={cardRef} tabIndex={-1} className={`${c.card}${tab === 'rotation' ? ' ' + c.cardWide : ''}`} role="dialog" aria-modal="true" aria-label="Compare Symbols" data-guide="compare.panel">
        <div className={c.head}>
          <span className={c.headTitle}>Compare Symbols</span>
          {!nothing && tab === 'overlay' && <button type="button" className={c.clear} data-guide="compare.clear" onClick={clearAll} title="Remove all comparisons">Clear all</button>}
          <button type="button" className={c.close} onClick={onClose} title="Close" aria-label="Close"><UIcon name="x" size={13} gold={false} /></button>
        </div>

        <div className={c.tabs} role="tablist" aria-label="Compare view" onKeyDown={onTabKey}>
          {TABS.map(t => (
            <button
              key={t.key}
              ref={el => { tabRefs.current[t.key] = el }}
              type="button"
              role="tab"
              id={`compare-tab-${t.key}`}
              aria-controls={`compare-panel-${t.key}`}
              aria-selected={tab === t.key}
              tabIndex={tab === t.key ? 0 : -1}
              className={c.tab}
              onClick={() => setTab(t.key)}
            >{t.label}</button>
          ))}
        </div>

        {tab === 'rotation' && (
          <div className={c.body} role="tabpanel" id="compare-panel-rotation" aria-labelledby="compare-tab-rotation">
            <Suspense fallback={<div className={c.empty}>Loading the rotation graph…</div>}>
              <CompareRotation ownSyms={ownSyms} intent={intent} />
            </Suspense>
          </div>
        )}

        {tab === 'overlay' && (
        <div className={c.body} role="tabpanel" id="compare-panel-overlay" aria-labelledby="compare-tab-overlay">
          {/* Add a single ticker */}
          <Input aria-label="Add symbol"
            className={c.input}
            value={entry}
            onChange={e => setEntry(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addSymbol(entry); else if (e.key === 'Escape') setEntry('') }}
            placeholder="+ Add symbol (e.g. QQQ) — Enter"
            spellCheck={false}
            autoComplete="off"
          />

          {/* Add a whole group */}
          <div className={c.groupPick} data-guide="compare.groups">
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
                <Input aria-label="Search group"
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
                      <button type="button" className={c.rm} data-guide="compare.removeGroup" onClick={() => removeGroup(g.name)} title={`Remove ${g.name}`} aria-label={`Remove ${g.name}`}><UIcon name="x" size={10} gold={false} /></button>
                    </div>
                    <div className={c.scaleSeg} data-guide="compare.groupScale">
                      <button type="button" className={`${c.scaleBtn}${scaleMode === 'same' ? ' ' + c.scaleOn : ''}`} onClick={() => setGroupScale(g.name, 'same')} title="Share the main price scale">Same % scale</button>
                      <button type="button" className={`${c.scaleBtn}${scaleMode !== 'same' ? ' ' + c.scaleOn : ''}`} onClick={() => setGroupScale(g.name, 'new')} title="Right % scale — base + all comparisons shown in %">New price scale</button>
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
                    <button type="button" className={c.rm} data-guide="compare.remove" onClick={() => removeSymbol(s.sym)} title={`Remove ${s.sym}`} aria-label={`Remove ${s.sym}`}><UIcon name="x" size={10} gold={false} /></button>
                  </div>
                  <div className={c.scaleSeg} data-guide="compare.scale">
                    <button type="button" className={`${c.scaleBtn}${s.scaleMode === 'same' ? ' ' + c.scaleOn : ''}`} onClick={() => setScaleMode(s.sym, 'same')} title="Share the main price scale">Same % scale</button>
                    <button type="button" className={`${c.scaleBtn}${s.scaleMode !== 'same' ? ' ' + c.scaleOn : ''}`} onClick={() => setScaleMode(s.sym, 'new')} title="Right % scale — base + all comparisons shown in %">New price scale</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!nothing && (
            <button
              type="button"
              className={`${c.hideBaseToggle}${hideBase ? ' ' + c.hideBaseOn : ''}`}
              data-guide="compare.hideBase"
              onClick={toggleHideBase}
              title={hideBase ? 'Show the base chart, volume and moving averages again' : 'Hide the base chart so only the comparison lines show'}
            >
              <span className={c.hideBaseBox}>{hideBase ? '✓' : ''}</span>
              <span>{hideBase ? 'Group only — base chart hidden (click to bring it back)' : 'Group only — hide the base chart'}</span>
            </button>
          )}
          <div className={c.hint}>Normalized to 0% at the left edge of the framed range.</div>
        </div>
        )}
      </div>
    </div>
  )
}
