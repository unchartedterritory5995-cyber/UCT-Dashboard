/**
 * Stock Profile widget — a per-stock dossier for whichever symbol is selected on
 * this widget's color group. Mirrors the Model Book info panel, but LIVE for the
 * current (YTD) year:
 *   • a top row of three YTD stats — YTD gain · low→high / high→low · avg daily $ vol
 *   • the last 4 reported earnings (EPS / % chg / revenue / % chg)
 *   • the AI company description + this-year thematic narrative
 *
 * Data comes from one endpoint (/api/stock-brief/{sym}); the AI profile reuses the
 * Model Book's own generation (generated once per stock, then cached). Appearance
 * (canvas + text/accent colors) is a per-widget ⚙ blob persisted globally like the
 * News widget's, applied as CSS variables.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import useStockBrief from '../../../hooks/useStockBrief'
import useMobileSWR from '../../../hooks/useMobileSWR'
import UIcon from '../../../components/ui/UIcon'
import CompanyLogo from '../../../components/CompanyLogo'
import NewsSettingsPanel from './NewsSettingsPanel'
import {
  mergeProfileWidgetSettings, profileWidgetStyleVars, profileDefaultsForTheme,
} from './profileWidgetSettings'
import styles from './ProfileWidget.module.css'

// +952% / -63% — signed, rounded to a whole percent (Model Book style).
function fmtPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${Math.round(n)}%`
}
// $11.8M — dollar volume with a magnitude suffix (Model Book fmtVol).
function fmtVol(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}
function fmtEps(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}
function fmtRevenue(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}
// A % surprise cell → {text, dir} so the caller can color it up/down.
function pctCell(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return { text: '—', dir: 0 }
  return { text: `${n >= 0 ? '+' : ''}${Math.round(n)}%`, dir: n > 0 ? 1 : n < 0 ? -1 : 0 }
}
function fmtQuarter(r) {
  return `Q${r?.quarter ?? '?'} ${r?.year ?? ''}`.trim()
}
function fmtShares(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(Math.round(n))
}
function fmtEarnDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return (m && d && y) ? `${m}/${d}/${String(y).slice(-2)}` : String(iso)
}
// Time trading since inception (first-trade date): years / months / weeks / days.
function fmtAge(iso) {
  if (!iso) return '—'
  const start = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(start)) return '—'
  const days = (Date.now() - start) / 86400000
  if (days < 0) return '—'
  if (days >= 365.25) return `${(days / 365.25).toFixed(1)} years`
  if (days >= 30.44) return `${(days / 30.44).toFixed(1)} months`
  if (days >= 7) return `${(days / 7).toFixed(1)} weeks`
  return `${Math.max(1, Math.round(days))} days`
}
function websiteDomain(url) {
  return String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
}
const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

export default function ProfileWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const sym = groupSyms?.[color] || null

  // ── Appearance settings (⚙) — PER-WIDGET (this widget's own opts.settings) so one
  // Profile widget's look never touches another, or the same widget in another layout.
  // A widget with NO explicit look uses the DEFAULTS FOR THE CURRENT APP THEME (light
  // → white canvas + dark text), so both the ⚙ swatches AND the rendered widget follow
  // the site theme until the user picks colors. Reset clears back to that.
  const { prefs } = usePreferences()
  const placedTheme = usePlacedTheme()
  const settings = useMemo(
    () => mergeProfileWidgetSettings(opts?.settings ?? profileDefaultsForTheme(placedTheme)),
    [opts?.settings, prefs.theme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback(
    (patch) => onOptsChange?.({ ...(opts || {}), settings: { ...settings, ...patch } }),
    [opts, settings, onOptsChange],
  )
  const resetSettings = useCallback(
    () => onOptsChange?.({ ...(opts || {}), settings: null }),
    [opts, onOptsChange],
  )
  const rootStyle = useMemo(() => profileWidgetStyleVars(settings), [settings])
  const menuVars = useMemo(() => {
    const canvas = settings.bgMode === 'gradient' ? (settings.bgGradient?.top || settings.bg) : settings.bg
    return menuThemeVars(canvas) || {}
  }, [settings])

  // ── Data — poll fast while the AI profile generates, then settle ──
  const [fastPoll, setFastPoll] = useState(false)
  const { status, company, stats, earnings, profile } = useStockBrief(sym, { generating: fastPoll })
  useEffect(() => { setFastPoll(status === 'generating') }, [status])

  // Slow-moving fundamentals for the Key Stats grid (own cached, never-blocking
  // endpoint) — refreshed every 10 min, no need to ride the 30s brief cadence.
  const { data: fund } = useMobileSWR(
    sym ? `/api/fundamentals/${encodeURIComponent(sym)}` : null,
    jsonFetcher,
    { refreshInterval: 600000, dedupingInterval: 60000, revalidateOnFocus: false },
  )
  // Key metrics (always shown; '—' when unavailable).
  const keyItems = useMemo(() => ([
    { label: 'Market Cap', value: fund?.market_cap || '—' },
    { label: 'Next Earnings', value: fmtEarnDate(fund?.next_earnings) },
    { label: 'Float', value: fmtShares(fund?.float_shares) },
    { label: 'Short Interest', value: fund?.short_pct_float != null ? `${Number(fund.short_pct_float).toFixed(1)}%` : '—' },
    { label: 'Inst. Own', value: fund?.inst_own_pct != null ? `${Number(fund.inst_own_pct).toFixed(1)}%` : '—' },
    { label: 'Age', value: fmtAge(fund?.inception) },
  ]), [fund])
  // Company profile rows (only shown when present).
  const infoItems = useMemo(() => {
    const out = []
    if (fund?.website) {
      out.push({
        label: 'Website',
        value: (
          <a className={styles.link} href={fund.website} target="_blank" rel="noreferrer">
            {websiteDomain(fund.website)}
          </a>
        ),
      })
    }
    if (fund?.hq) out.push({ label: 'Headquarters', value: fund.hq })
    if (fund?.ceo) out.push({ label: 'CEO', value: fund.ceo })
    if (fund?.employees != null) out.push({ label: 'Employees', value: Number(fund.employees).toLocaleString() })
    return out
  }, [fund])

  // Sympathy stocks — the closest related names from the SAME group-peers engine
  // the Multi-Chart group feature uses (theme holdings → industry cohort → AI
  // peers). Cached hard on the backend (~6h), so fetch once per symbol.
  const { data: peersData } = useMobileSWR(
    sym ? `/api/groups/peers?sym=${encodeURIComponent(sym)}&n=10` : null,
    jsonFetcher,
    { refreshInterval: 0, dedupingInterval: 3600000, revalidateOnFocus: false },
  )
  const peers = useMemo(() => {
    const raw = Array.isArray(peersData?.peers) ? peersData.peers : []
    return raw
      .map(p => (typeof p === 'string' ? p : p?.sym))
      .filter(Boolean)
      .filter(s => s !== sym)
      .slice(0, 10)
  }, [peersData, sym])

  const hasStats = !!stats && (stats.ytd_gain_pct != null || stats.avg_dollar_vol != null)
  const year = new Date().getFullYear()
  const gainDir = stats?.ytd_gain_pct == null ? 0 : (stats.ytd_gain_pct >= 0 ? 1 : -1)
  const rangeUp = stats?.range_dir !== 'down'
  const rangeLabel = rangeUp ? 'Low → High' : 'High → Low'

  const dirClass = (d) => (d > 0 ? styles.up : d < 0 ? styles.down : styles.neutral)
  // Earnings surprise cells use their OWN (separately configurable) colors.
  const surpClass = (d) => (d > 0 ? styles.surpUp : d < 0 ? styles.surpDown : styles.neutral)

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Stock Profile Settings"
          perfLabel="Performance"
          extraSections={[{
            label: 'Header',
            rows: [
              { key: 'headerColor', label: 'Header color', hint: 'ticker & name' },
              { key: 'headerShow', label: 'Show', type: 'segmented', options: [
                { key: 'both', label: 'Both' },
                { key: 'ticker', label: 'Ticker' },
                { key: 'company', label: 'Company' },
              ] },
            ],
          }, {
            label: 'Earnings Surprise',
            rows: [{ key: 'surpUpColor', label: 'Positive' }, { key: 'surpDownColor', label: 'Negative' }],
          }]}
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}

      {/* Header: logo + ticker + company name + gear.
          `headerShow` (⚙) chooses ticker / company / both. */}
      <div className={styles.bar}>
        <span className={styles.symWrap}>
          {sym && <CompanyLogo sym={sym} size={18} name={company} round />}
          {settings.headerShow !== 'company' && <span className={styles.sym}>{sym || '—'}</span>}
          {sym && company && settings.headerShow === 'both' && <span className={styles.company}>({company})</span>}
          {sym && company && settings.headerShow === 'company' && <span className={styles.sym}>{company}</span>}
          {sym && !company && settings.headerShow === 'company' && <span className={styles.sym}>{sym}</span>}
        </span>
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Stock Profile settings"
        ><UIcon name="gear" size={13} /></button>
      </div>

      {!sym && (
        <div className={styles.empty}>
          Link this widget's color group to a stock to see its profile.
        </div>
      )}

      {sym && (
        <div className={styles.scroll}>
          {/* ── Top row: three YTD stats ── */}
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>{year} Gain</div>
              <div className={`${styles.statValue} ${dirClass(gainDir)}`}>
                {hasStats ? fmtPct(stats?.ytd_gain_pct) : '—'}
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>{rangeLabel}</div>
              <div className={`${styles.statValue} ${dirClass(rangeUp ? 1 : -1)}`}>
                {stats?.range_pct != null ? fmtPct(stats.range_pct) : '—'}
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Avg Daily $ Vol</div>
              <div className={styles.statValue}>{fmtVol(stats?.avg_dollar_vol)}</div>
            </div>
          </div>

          {/* ── Company description + this-year thematic narrative ── */}
          {(profile?.company_desc || profile?.run_story) ? (
            <div className={styles.prose}>
              {profile.company_desc && <p className={styles.desc}>{profile.company_desc}</p>}
              {profile.run_story && <p className={styles.story}>{profile.run_story}</p>}
            </div>
          ) : status === 'generating' ? (
            <div className={styles.generating}>
              <span className={styles.spinner} /> Writing company profile…
            </div>
          ) : null}

          {/* ── Earnings: last 4 reported quarters ── */}
          {earnings && earnings.length > 0 && (
            <div className={styles.earnWrap}>
              <div className={styles.sectionLabel}>Last {earnings.length} Earnings</div>
              <table className={styles.earnTable}>
                <thead>
                  <tr>
                    <th className={styles.thLeft}>Quarter</th>
                    <th className={styles.thNum}>EPS</th>
                    <th className={styles.thNum}>Surprise</th>
                    <th className={styles.thNum}>Revenue</th>
                    <th className={styles.thNum}>Surprise</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map((r, i) => {
                    const eps = pctCell(r.eps_surprise_pct)
                    const rev = pctCell(r.revenue_surprise_pct)
                    return (
                      <tr key={`${r.year}-${r.quarter}-${i}`}>
                        <td className={styles.tdLeft}>{fmtQuarter(r)}</td>
                        <td className={styles.tdNum}>{fmtEps(r.eps_actual)}</td>
                        <td className={`${styles.tdNum} ${surpClass(eps.dir)}`}>{eps.text}</td>
                        <td className={styles.tdNum}>{fmtRevenue(r.revenue_actual)}</td>
                        <td className={`${styles.tdNum} ${surpClass(rev.dir)}`}>{rev.text}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── More Info: 4 key metrics + company profile ── */}
          <div className={styles.keyWrap}>
            <div className={styles.sectionLabel}>More Info</div>
            <div className={styles.keyGrid}>
              {keyItems.map(it => (
                <div key={it.label} className={styles.keyItem}>
                  <span className={styles.keyLabel}>{it.label}</span>
                  <span className={styles.keyVal}>{it.value}</span>
                </div>
              ))}
            </div>
            {infoItems.length > 0 && (
              <div className={styles.infoList}>
                {infoItems.map(it => (
                  <div key={it.label} className={styles.infoRow}>
                    <span className={styles.keyLabel}>{it.label}</span>
                    <span className={styles.keyVal}>{it.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Sympathy stocks (clickable peer chips) ── */}
          {peers.length > 0 && (
            <div className={styles.sympWrap}>
              <div className={styles.sectionLabel}>Sympathy Stocks</div>
              <div className={styles.chips}>
                {peers.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={styles.chip}
                    onClick={() => setGroupSym?.(color, t)}
                    title={`Show ${t}`}
                  >{t}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
