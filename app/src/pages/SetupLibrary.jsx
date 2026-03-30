import { useState, useMemo } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './SetupLibrary.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const FAMILIES = [
  'All', 'Base Breakout', 'Momentum Continuation', 'Gap & Catalyst',
  'Remount & Recovery', 'Short Setup', 'Classical Pattern',
]

function GradePill({ grade }) {
  if (!grade) return null
  const cls = grade === 'A+' ? styles.gA : grade === 'A' ? styles.gA
    : grade === 'B' ? styles.gB : styles.gC
  return <span className={`${styles.gradePill} ${cls}`}>{grade}</span>
}

function PerfBar({ winRate }) {
  if (winRate == null) return <span className={styles.noData}>--</span>
  const w = Math.min(winRate, 100)
  const color = winRate >= 60 ? 'var(--ut-green)' : winRate >= 45 ? 'var(--ut-gold)' : '#e74c3c'
  return (
    <div className={styles.perfBar}>
      <div className={styles.perfFill} style={{ width: `${w}%`, background: color }} />
      <span className={styles.perfLabel}>{winRate.toFixed(0)}%</span>
    </div>
  )
}

function TemplateDetail({ template, onClose }) {
  if (!template) return null

  const perf = template.performance_by_regime || {}
  const entry = template.entry_triggers || {}
  const stop = template.stop_methods || {}
  const profit = template.profit_logic || {}
  const inv = template.invalidation || {}
  const addon = template.addon_rules || {}

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <h2 className={styles.detailName}>{template.name}</h2>
          <span className={styles.detailFamily}>{template.family} -- {template.origin_trader}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>x</button>
      </div>

      {template.description && (
        <p className={styles.detailDesc}>{template.description}</p>
      )}

      <div className={styles.detailRegime}>
        <span className={styles.sectionLabel}>IDEAL REGIME</span>
        <div className={styles.regimeTags}>
          {(template.ideal_regime || []).map(r => (
            <span key={r} className={styles.regimeTag}>{r}</span>
          ))}
        </div>
      </div>

      {/* Entry rules */}
      <div className={styles.ruleSection}>
        <span className={styles.sectionLabel}>ENTRY</span>
        {entry.primary && <div className={styles.ruleRow}><span className={styles.ruleKey}>Primary:</span> {entry.primary}</div>}
        {entry.secondary && <div className={styles.ruleRow}><span className={styles.ruleKey}>Secondary:</span> {entry.secondary}</div>}
        {entry.timing && <div className={styles.ruleRow}><span className={styles.ruleKey}>Timing:</span> {entry.timing}</div>}
        {entry.volume_min && <div className={styles.ruleRow}><span className={styles.ruleKey}>Volume:</span> {entry.volume_min}</div>}
      </div>

      {/* Stop rules */}
      <div className={styles.ruleSection}>
        <span className={styles.sectionLabel}>STOP</span>
        {stop.initial && <div className={styles.ruleRow}><span className={styles.ruleKey}>Initial:</span> {stop.initial}</div>}
        {template.max_stop_pct && <div className={styles.ruleRow}><span className={styles.ruleKey}>Max:</span> {template.max_stop_pct}%</div>}
        {stop.trailing && <div className={styles.ruleRow}><span className={styles.ruleKey}>Trail:</span> {stop.trailing}</div>}
      </div>

      {/* Profit logic */}
      <div className={styles.ruleSection}>
        <span className={styles.sectionLabel}>PROFIT</span>
        {profit.first_target && <div className={styles.ruleRow}><span className={styles.ruleKey}>T1:</span> {profit.first_target}</div>}
        {profit.second_target && <div className={styles.ruleRow}><span className={styles.ruleKey}>T2:</span> {profit.second_target}</div>}
        {profit.runner && <div className={styles.ruleRow}><span className={styles.ruleKey}>Runner:</span> {profit.runner}</div>}
      </div>

      {/* Add-on rules */}
      {(addon.first || addon.second) && (
        <div className={styles.ruleSection}>
          <span className={styles.sectionLabel}>ADD-ON</span>
          {addon.first && <div className={styles.ruleRow}><span className={styles.ruleKey}>1st:</span> {addon.first}</div>}
          {addon.second && <div className={styles.ruleRow}><span className={styles.ruleKey}>2nd:</span> {addon.second}</div>}
          {addon.max_position && <div className={styles.ruleRow}><span className={styles.ruleKey}>Max:</span> {addon.max_position}</div>}
        </div>
      )}

      {/* Invalidation */}
      <div className={styles.ruleSection}>
        <span className={styles.sectionLabel}>INVALIDATION</span>
        {inv.structural && <div className={styles.ruleRow}><span className={styles.ruleKey}>Structure:</span> {inv.structural}</div>}
        {inv.volume && <div className={styles.ruleRow}><span className={styles.ruleKey}>Volume:</span> {inv.volume}</div>}
        {inv.regime && <div className={styles.ruleRow}><span className={styles.ruleKey}>Regime:</span> {inv.regime}</div>}
      </div>

      {/* Common mistakes */}
      {template.common_mistakes?.length > 0 && (
        <div className={styles.ruleSection}>
          <span className={styles.sectionLabel}>COMMON MISTAKES</span>
          {template.common_mistakes.map((m, i) => (
            <div key={i} className={styles.mistakeRow}>- {m}</div>
          ))}
        </div>
      )}

      {/* Performance by regime */}
      {Object.keys(perf).length > 0 && (
        <div className={styles.ruleSection}>
          <span className={styles.sectionLabel}>PERFORMANCE BY REGIME</span>
          <div className={styles.perfTable}>
            <div className={styles.perfHeader}>
              <span>Regime</span><span>Trades</span><span>Win%</span><span>Avg Gain</span><span>Expect</span>
            </div>
            {Object.entries(perf).map(([phase, p]) => (
              <div key={phase} className={styles.perfRow}>
                <span>{phase}</span>
                <span>{p.total_trades}</span>
                <span>{p.win_rate_pct?.toFixed(0)}%</span>
                <span>{p.avg_gain_pct != null ? `${p.avg_gain_pct >= 0 ? '+' : ''}${p.avg_gain_pct.toFixed(1)}%` : '--'}</span>
                <span>{p.expectancy != null ? `${p.expectancy >= 0 ? '+' : ''}${p.expectancy.toFixed(1)}%` : '--'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modelbook hook — future Phase 6 */}
      <div className={styles.modelBookHook}>
        <span className={styles.sectionLabel}>MODEL EXAMPLES</span>
        <p className={styles.comingSoon}>Coming soon -- curated chart examples for this setup</p>
      </div>
    </div>
  )
}

export default function SetupLibrary() {
  const [family, setFamily] = useState('All')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  const { data } = useSWR('/api/setup-templates', fetcher, { revalidateOnFocus: false })
  const templates = data?.templates || []

  // Fetch detail when selected
  const { data: detailData } = useSWR(
    selected ? `/api/setup-templates/${encodeURIComponent(selected)}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const filtered = useMemo(() => {
    let list = templates
    if (family !== 'All') {
      list = list.filter(t => t.family === family)
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.origin_trader?.toLowerCase().includes(q) ||
        (t.aliases || []).some(a => a.toLowerCase().includes(q))
      )
    }
    return list
  }, [templates, family, search])

  // Group by family
  const grouped = useMemo(() => {
    const groups = {}
    for (const t of filtered) {
      const f = t.family || 'Other'
      if (!groups[f]) groups[f] = []
      groups[f].push(t)
    }
    return groups
  }, [filtered])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>SETUP LIBRARY</h1>
        <span className={styles.count}>{filtered.length} setups</span>
      </div>

      <div className={styles.layout}>
        {/* Left panel — list */}
        <div className={styles.listPanel}>
          {/* Filters */}
          <div className={styles.filters}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search setups..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className={styles.familyTabs}>
              {FAMILIES.map(f => (
                <button
                  key={f}
                  className={`${styles.familyTab} ${family === f ? styles.familyTabActive : ''}`}
                  onClick={() => setFamily(f)}
                >
                  {f === 'All' ? 'All' : f.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Template list */}
          <div className={styles.templateList}>
            {Object.entries(grouped).map(([fam, items]) => (
              <div key={fam}>
                <div className={styles.groupHeader}>{fam}</div>
                {items.map(t => {
                  const perf = t.performance
                  return (
                    <div
                      key={t.name}
                      className={`${styles.templateRow} ${selected === t.name ? styles.templateRowActive : ''}`}
                      onClick={() => setSelected(t.name)}
                    >
                      <div className={styles.templateMain}>
                        <span className={styles.templateName}>{t.name}</span>
                        <span className={styles.templateTrader}>{t.origin_trader}</span>
                      </div>
                      <div className={styles.templateMeta}>
                        <PerfBar winRate={perf?.win_rate_pct} />
                        <span className={styles.templateTrades}>
                          {perf?.total_trades ? `${perf.total_trades} trades` : ''}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className={styles.empty}>No setups match your filters</div>
            )}
          </div>
        </div>

        {/* Right panel — detail */}
        <div className={styles.detailPanel}>
          {detailData && !detailData.error ? (
            <TemplateDetail template={detailData} onClose={() => setSelected(null)} />
          ) : selected ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <div className={styles.emptyDetail}>
              <p>Select a setup to view its full playbook</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
