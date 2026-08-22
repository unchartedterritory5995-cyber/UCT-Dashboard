// app/src/components/research/sections/ProfileSection.jsx
//
// "What does this company do?" — the /charts Stock Profile dossier, inside the
// earnings modal (owner ask, 2026-08-21: the profile, what the company does,
// market cap and this year's story belong in the calendar too). It composes
// the SAME endpoints that widget reads — /api/stock-brief (AI company
// description + YTD stats + this-year narrative, generate-once),
// /api/fundamentals (market cap + key facts) and /api/groups/peers (sympathy
// names) — so every fact has ONE authority and nothing here is restated. The
// calendar's warm pass (earnings_preview_warm) pre-writes the profile for the
// week's reporters, so on the names people open it is already there.
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import useMobileSWR from '../../../hooks/useMobileSWR'

import TickerPopup from '../../TickerPopup'
import useFundamentals from '../../../hooks/useFundamentals'
import { EmptyState, EyebrowLabel, StatTile } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import {
  fmtAge, fmtEarnDate, fmtPct, fmtShares, fmtVol, pctText, websiteDomain,
} from '../../../utils/profileFormat'
import { GENERATING_POLL_MS, paidFetcher } from './paidFetcher'
import styles from './ProfileSection.module.css'

const jsonFetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)

export default function ProfileSection({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  // Poll fast only while the profile is being written, then stop.
  const [polling, setPolling] = useState(false)
  const { data: brief } = useMobileSWR(
    s ? `/api/stock-brief/${encodeURIComponent(s)}` : null, paidFetcher,
    { refreshInterval: polling ? GENERATING_POLL_MS : 0, dedupingInterval: 1500, revalidateOnFocus: false },
  )
  const isGenerating = brief?.status === 'generating'
  useEffect(() => { setPolling(isGenerating) }, [isGenerating])
  const { data: fund } = useFundamentals(s || null)
  // Sympathy stocks — the same group-peers engine Multi-Chart uses; cached
  // hard on the backend (~6h), so once per symbol is plenty.
  const { data: peersData } = useSWR(
    s ? `/api/groups/peers?sym=${encodeURIComponent(s)}&n=10` : null, jsonFetcher,
    { dedupingInterval: 3600000, revalidateOnFocus: false },
  )
  const peers = useMemo(() => (Array.isArray(peersData?.peers) ? peersData.peers : [])
    .map((p) => (typeof p === 'string' ? p : p?.sym))
    .filter(Boolean)
    .filter((t) => t !== s)
    .slice(0, 10), [peersData, s])

  const infoItems = useMemo(() => {
    const out = []
    if (fund?.website) {
      out.push({
        label: 'Website',
        value: (
          <a className={styles.link} href={fund.website} target="_blank" rel="noopener noreferrer">
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

  if (!s) return null
  if (brief?.paywalled) {
    return (
      <EmptyState
        icon="lock"
        title="Stock profiles require a paid plan"
        hint="The company profile and this-year story are part of the paid research tools."
      />
    )
  }

  const profile = brief?.profile || {}
  const stats = brief?.stats || null
  const generating = isGenerating
  const loading = brief === undefined
  const hasProse = !!(profile.company_desc || profile.run_story)
  const year = new Date().getFullYear()
  const gain = stats?.ytd_gain_pct
  const rangeUp = stats?.range_dir !== 'down'
  const company = brief?.company || fund?.name || null
  const sector = brief?.sector || fund?.sector || null
  const industry = brief?.industry || fund?.industry || null
  const writtenOn = profile.generated_at
    ? fmtEarnDate(new Date(Number(profile.generated_at) * 1000).toISOString())
    : null

  return (
    <div className={styles.wrap} data-testid="profile-section">
      {(company || sector || industry) && (
        <div className={styles.identity}>
          {company && <span className={styles.company}>{company}</span>}
          {(sector || industry) && (
            <span className={styles.sectorLine}>{[sector, industry].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      )}

      <EyebrowLabel>What the company does</EyebrowLabel>
      {profile.company_desc ? (
        <p className={styles.desc}>{profile.company_desc}</p>
      ) : generating ? (
        <div className={styles.generating} role="status" aria-live="polite" data-testid="profile-generating">
          <span className={styles.spinner} aria-hidden="true" />
          Writing the company profile — about half a minute for a name we haven&apos;t
          covered yet. It appears here on its own.
        </div>
      ) : loading ? (
        <SkeletonBlock height={72} />
      ) : (
        <p className={styles.note}>No company profile written for this name yet.</p>
      )}

      <EyebrowLabel>Key facts</EyebrowLabel>
      <div className={styles.grid} data-testid="profile-facts">
        <StatTile label="Market cap" value={fund?.market_cap || '—'} />
        <StatTile label="Float" value={fmtShares(fund?.float_shares)} />
        <StatTile label="Short interest" value={pctText(fund?.short_pct_float)} />
        <StatTile label="Inst. own" value={pctText(fund?.inst_own_pct)} />
        <StatTile label="Next earnings" value={fmtEarnDate(fund?.next_earnings)} />
        <StatTile label="Listed" value={fmtAge(fund?.inception)} />
      </div>

      <EyebrowLabel>{year} so far</EyebrowLabel>
      <div className={styles.grid3} data-testid="profile-ytd">
        <div className={styles.stat}>
          <span className={styles.statLabel}>{year} gain</span>
          <span className={`${styles.statValue} ${gain == null ? '' : gain >= 0 ? styles.up : styles.down}`}>
            {fmtPct(gain)}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{rangeUp ? 'Low → high' : 'High → low'}</span>
          <span className={`${styles.statValue} ${stats?.range_pct == null ? '' : rangeUp ? styles.up : styles.down}`}>
            {stats?.range_pct != null ? fmtPct(stats.range_pct) : '—'}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Avg daily $ vol</span>
          <span className={styles.statValue}>{fmtVol(stats?.avg_dollar_vol)}</span>
        </div>
      </div>

      {profile.run_story && (
        <>
          <EyebrowLabel>This year&apos;s story</EyebrowLabel>
          <p className={styles.story}>{profile.run_story}</p>
        </>
      )}

      {infoItems.length > 0 && (
        <>
          <EyebrowLabel>Company</EyebrowLabel>
          <dl className={styles.facts}>
            {infoItems.map((it) => (
              <div key={it.label} className={styles.factRow}>
                <dt>{it.label}</dt>
                <dd>{it.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {peers.length > 0 && (
        <>
          <EyebrowLabel>Sympathy names</EyebrowLabel>
          <div className={styles.chips}>
            {/* Real affordance, not a dead chip: each opens the ticker popup
                in place, the way the footer's View Chart does. */}
            {peers.map((t) => (
              <TickerPopup key={t} sym={t} as="button" className={styles.chip}>{t}</TickerPopup>
            ))}
          </div>
        </>
      )}

      {hasProse && (
        <div className={styles.provenance} data-testid="profile-provenance">
          AI · company profile{writtenOn ? ` · written ${writtenOn}` : ''}
        </div>
      )}
    </div>
  )
}
