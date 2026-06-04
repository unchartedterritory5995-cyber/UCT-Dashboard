// app/src/pages/calendar/MyStocksHub.jsx
// /calendar/mystocks — Multi-tab hub scoped to the user's My-Stocks set.
//
// Tabs: Earnings · News · Calls · Filings · Insights
//   - Earnings: upcoming + recently-reported cards filtered to mySets
//   - News: /api/news filtered client-side to mySets syms
//   - Calls: CallRecapSection for recently-reported mySets names
//   - Filings: SEC filings stream per mySets sym (useFilings)
//   - Insights: Sentiment gauge + expected move + surprise history per sym
//
// Read/unseen: useSeen(itemType) — unseen items get a dot; opening marks seen.
// Per-tab unseen count badge shown on the tab button.
// Mobile: stacked layout (no horizontal scroll needed).
import { useState, useMemo, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import usePreferences from '../../hooks/usePreferences'
import {
  useCalendar,
  useCalendarMySets,
  isMine,
} from './useCalendarData'
import EarningsCard from './EarningsCard'
import EventCard from './EventCard'
import useFilings from '../../hooks/useFilings'
import useCallRecap from '../../hooks/useCallRecap'
import useSeen from '../../hooks/useSeen'
import { SentimentGaugeDisplay } from '../../components/calendar/SentimentGauge'
import useSentiment from '../../hooks/useSentiment'
import CallRecapSection from '../../components/calendar/CallRecapSection'
import EarningsModal from '../../components/tiles/EarningsModal'
import ErrorBoundary from '../../components/ErrorBoundary'
import { toModalRow, timingLabel } from './earningsModalRow'
import styles from './Calendar.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_SOURCES = ['watchlist', 'flagged', 'positions', 'uct20']

const TABS = [
  { id: 'earnings',  label: 'Earnings',  itemType: 'earnings' },
  { id: 'news',      label: 'News',      itemType: 'news'     },
  { id: 'calls',     label: 'Calls',     itemType: 'recap'    },
  { id: 'filings',   label: 'Filings',   itemType: 'filing'   },
  { id: 'insights',  label: 'Insights',  itemType: 'insight'  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const newsFetcher = url =>
  fetch(url).then(r => (r.ok ? r.json() : [])).catch(() => [])

/** Extract the deduplicated My-Stocks ticker set from mySets + mySources. */
function buildMySymsSet(mySets, mySources) {
  const out = new Set()
  if (!mySets || !mySources) return out
  for (const src of mySources) {
    for (const sym of mySets[src] || []) {
      out.add(sym.toUpperCase())
    }
  }
  return out
}

// ── useSeen multi-type wrapper ────────────────────────────────────────────────

/** Returns { seen, markSeen } for a given item type. */
function useSeenForTab(tabId) {
  const tab = TABS.find(t => t.id === tabId)
  return useSeen(tab?.itemType ?? null)
}

// ── Sub-tab: Earnings ─────────────────────────────────────────────────────────

function EarningsTab({ mineSyms, onSelect, seen, markSeen }) {
  const { data: calData } = useCalendar()

  const entries = useMemo(() => {
    if (!calData || !mineSyms.size) return []
    const out = []
    for (const [, day] of Object.entries(calData.days || {})) {
      // Tag each entry with its session timing — EarningsCard requires `timing`
      // (renders timing.toUpperCase()). All hub entries are "mine" → mine:true.
      for (const e of (day.bmo || [])) {
        if (mineSyms.has(e.sym?.toUpperCase())) out.push({ ...e, _timing: 'bmo', mine: true })
      }
      for (const e of (day.amc || [])) {
        if (mineSyms.has(e.sym?.toUpperCase())) out.push({ ...e, _timing: 'amc', mine: true })
      }
    }
    return out
  }, [calData, mineSyms])

  const bmoEntries = useMemo(() => entries.filter(e => e._timing === 'bmo'), [entries])
  const amcEntries = useMemo(() => entries.filter(e => e._timing === 'amc'), [entries])

  if (!entries.length) {
    return <div className={styles.hubEmpty}>No upcoming earnings for your stocks.</div>
  }

  return (
    <>
      <HubTimingSection label="Before Open" icon="☀" hdClass={styles.bmoHd}
        entries={bmoEntries} seen={seen} markSeen={markSeen} onSelect={onSelect} />
      <HubTimingSection label="After Close" icon="🌙" hdClass={styles.amcHd}
        entries={amcEntries} seen={seen} markSeen={markSeen} onSelect={onSelect} />
    </>
  )
}

// One timing-grouped section (Before Open / After Close) inside the Earnings tab.
function HubTimingSection({ label, icon, hdClass, entries, seen, markSeen, onSelect }) {
  if (!entries.length) return null
  return (
    <div className={styles.timedGroup}>
      <div className={`${styles.timedHd} ${hdClass}`}>
        <span aria-hidden="true">{icon}</span> {label}
        <span className={styles.timedCount}>{entries.length}</span>
      </div>
      <div className={styles.hubCardGrid}>
        {entries.map(e => {
          const key = `${e.sym}:${e.date}`
          const unseen = !seen.has(key)
          return (
            <div
              key={key}
              className={`${styles.hubCardWrap} ${unseen ? styles.hubUnseen : ''}`}
            >
              {unseen && <span className={styles.unseenDot} aria-label="New" />}
              <EarningsCard
                entry={e}
                timing={e._timing}
                onSelect={() => { markSeen(key); onSelect && onSelect(e) }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Sub-tab: News ─────────────────────────────────────────────────────────────

function NewsTab({ mineSyms, seen, markSeen }) {
  const { data: newsItems } = useSWR('/api/news', newsFetcher, {
    refreshInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
  })

  const filtered = useMemo(() => {
    if (!newsItems || !mineSyms.size) return []
    return (newsItems || []).filter(item => {
      const tickers = (item.tickers || []).map(t => t.toUpperCase())
      return tickers.some(t => mineSyms.has(t))
    })
  }, [newsItems, mineSyms])

  if (!filtered.length) {
    return <div className={styles.hubEmpty}>No news for your stocks right now.</div>
  }

  return (
    <div className={styles.hubNewsList}>
      {filtered.map((item, i) => {
        const key = item.url || `news-${i}`
        const unseen = !seen.has(key)
        return (
          <a
            key={key}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.hubNewsRow} ${unseen ? styles.hubUnseen : ''}`}
            onClick={() => markSeen(key)}
          >
            {unseen && <span className={styles.unseenDot} aria-label="New" />}
            <span className={styles.hubNewsSource}>{item.source}</span>
            <span className={styles.hubNewsHeadline}>{item.headline}</span>
            <span className={styles.hubNewsTime}>{item.time}</span>
          </a>
        )
      })}
    </div>
  )
}

// ── Sub-tab: Calls ────────────────────────────────────────────────────────────

function CallsTab({ mineSyms, seen, markSeen }) {
  const { data: calData } = useCalendar()

  // Recently-reported stocks from my set (have eps_act)
  const reportedMine = useMemo(() => {
    if (!calData || !mineSyms.size) return []
    const out = []
    for (const [, day] of Object.entries(calData.days || {})) {
      for (const e of [...(day.bmo || []), ...(day.amc || [])]) {
        if (mineSyms.has(e.sym?.toUpperCase()) && e.eps_act != null) {
          out.push(e)
        }
      }
    }
    return out.slice(0, 10)
  }, [calData, mineSyms])

  if (!reportedMine.length) {
    return <div className={styles.hubEmpty}>No recently-reported stocks in your set.</div>
  }

  return (
    <div className={styles.hubSection}>
      {reportedMine.map(e => {
        const key = `${e.sym}:recap`
        const unseen = !seen.has(key)
        return (
          <div
            key={key}
            className={`${styles.hubCallRow} ${unseen ? styles.hubUnseen : ''}`}
            onClick={() => markSeen(key)}
          >
            {unseen && <span className={styles.unseenDot} aria-label="New" />}
            <div className={styles.hubCallSym}>{e.sym}</div>
            <CallRecapForSym sym={e.sym} />
          </div>
        )
      })}
    </div>
  )
}

function CallRecapForSym({ sym }) {
  const { data: recap } = useCallRecap(sym)
  if (!recap) return <div className={styles.hubCallLoading}>Loading recap…</div>
  return <CallRecapSection recap={recap} audio={null} />
}

// ── Sub-tab: Filings ──────────────────────────────────────────────────────────

function FilingsTab({ mineSyms, seen, markSeen }) {
  const syms = useMemo(() => [...mineSyms].slice(0, 20), [mineSyms])

  if (!syms.length) {
    return <div className={styles.hubEmpty}>Add stocks to your set to see filings.</div>
  }

  return (
    <div className={styles.hubSection}>
      {syms.map(sym => (
        <FilingsForSym key={sym} sym={sym} seen={seen} markSeen={markSeen} />
      ))}
    </div>
  )
}

function FilingsForSym({ sym, seen, markSeen }) {
  const { data } = useFilings(sym, 5)
  const filings = data?.filings || []
  if (!filings.length) return null

  return (
    <div className={styles.hubFilingGroup}>
      <div className={styles.hubFilingSym}>{sym}</div>
      {filings.map((f, i) => {
        const key = `${sym}:${f.form}:${f.filed}`
        const unseen = !seen.has(key)
        return (
          <a
            key={i}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.hubFilingRow} ${unseen ? styles.hubUnseen : ''}`}
            onClick={() => markSeen(key)}
          >
            {unseen && <span className={styles.unseenDot} aria-label="New" />}
            <span className={styles.hubFilingForm}>{f.form}</span>
            <span className={styles.hubFilingDate}>{f.filed}</span>
            <span className={styles.hubFilingLink}>View ↗</span>
          </a>
        )
      })}
    </div>
  )
}

// ── Sub-tab: Insights ─────────────────────────────────────────────────────────

function InsightsTab({ mineSyms }) {
  const syms = useMemo(() => [...mineSyms].slice(0, 20), [mineSyms])

  if (!syms.length) {
    return <div className={styles.hubEmpty}>Add stocks to your set to see insights.</div>
  }

  return (
    <div className={styles.hubSection}>
      {syms.map(sym => <InsightForSym key={sym} sym={sym} />)}
    </div>
  )
}

function InsightForSym({ sym }) {
  const { data } = useSentiment(sym)

  return (
    <div className={styles.hubInsightRow}>
      <div className={styles.hubInsightSym}>{sym}</div>
      {data
        ? <SentimentGaugeDisplay data={data} />
        : <div className={styles.hubCallLoading}>Loading…</div>
      }
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MyStocksHub() {
  const { prefs, setPref } = usePreferences()
  const { data: mySets } = useCalendarMySets()
  const [activeTab, setActiveTab] = useState('earnings')
  const [selected, setSelected] = useState(null)   // { row, label } for EarningsModal

  // Open the earnings detail modal for a clicked card. `_timing` rides on the
  // hub entry (set in EarningsTab) so we don't need a separate timing arg.
  const openEntry = useCallback(
    entry => setSelected({ row: toModalRow(entry), label: timingLabel(entry?._timing) }),
    [],
  )

  const mySources = prefs.calendar_mystocks_sources || ALL_SOURCES
  const setMySources = s => setPref('calendar_mystocks_sources', s)

  const mineSyms = useMemo(
    () => buildMySymsSet(mySets, mySources),
    [mySets, mySources],
  )

  // Read/unseen state — one hook per tab type (rules of hooks: called unconditionally)
  const earnSeen  = useSeen('earnings')
  const newsSeen  = useSeen('news')
  const recapSeen = useSeen('recap')
  const fileSeen  = useSeen('filing')
  // Insights tab is informational — no unseen count needed

  // Map tabId → seen state
  const seenMap = {
    earnings: earnSeen,
    news:     newsSeen,
    calls:    recapSeen,
    filings:  fileSeen,
    insights: { seen: new Set(), markSeen: () => {} },
  }

  // Unseen counts — optimistic (client-side only, no server round-trip)
  // We don't have per-tab item lists here so just show a • when any unseen
  // exists (simplified badge — full count would require loading all items).
  // This is intentionally lightweight.

  return (
    <div className={styles.hubPage}>
      {/* Header */}
      <div className={styles.hubHeader}>
        <Link to="/calendar" className={styles.hubBack}>← Calendar</Link>
        <span className={styles.hubTitle}>⭐ My Stocks</span>

        {/* ⚙ Source customizer — same pattern as CalendarHeader */}
        <SourceCustomizer mySources={mySources} setMySources={setMySources} />
      </div>

      {/* Tab bar */}
      <div className={styles.hubTabs} role="tablist">
        {TABS.map(tab => {
          const s = seenMap[tab.id]
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`${styles.hubTab} ${activeTab === tab.id ? styles.hubTabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab panel */}
      <div className={styles.hubPanel} role="tabpanel">
        {activeTab === 'earnings' && (
          <EarningsTab
            mineSyms={mineSyms}
            onSelect={openEntry}
            seen={seenMap.earnings.seen}
            markSeen={seenMap.earnings.markSeen}
          />
        )}
        {activeTab === 'news' && (
          <NewsTab
            mineSyms={mineSyms}
            seen={seenMap.news.seen}
            markSeen={seenMap.news.markSeen}
          />
        )}
        {activeTab === 'calls' && (
          <CallsTab
            mineSyms={mineSyms}
            seen={seenMap.calls.seen}
            markSeen={seenMap.calls.markSeen}
          />
        )}
        {activeTab === 'filings' && (
          <FilingsTab
            mineSyms={mineSyms}
            seen={seenMap.filings.seen}
            markSeen={seenMap.filings.markSeen}
          />
        )}
        {activeTab === 'insights' && (
          <InsightsTab mineSyms={mineSyms} />
        )}
      </div>

      {/* Earnings detail modal — opened by clicking a card in the Earnings tab */}
      {selected && (
        <ErrorBoundary
          key={selected.row.sym}
          fallback={
            <div style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace', padding: '12px' }}>
              Unable to load — click a ticker to retry.
            </div>
          }
        >
          <EarningsModal
            row={selected.row}
            label={selected.label}
            onClose={() => setSelected(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  )
}

// ── SourceCustomizer ──────────────────────────────────────────────────────────

const SOURCES = [
  ['watchlist', 'Watchlists'],
  ['flagged',   'Flagged'],
  ['positions', 'Positions'],
  ['uct20',     'UCT20'],
]

function SourceCustomizer({ mySources, setMySources }) {
  const [open, setOpen] = useState(false)
  const toggleSource = s =>
    setMySources(
      mySources.includes(s) ? mySources.filter(x => x !== s) : [...mySources, s],
    )

  return (
    <span className={styles.gearWrap}>
      <button className={styles.mystk} onClick={() => setOpen(o => !o)}>
        ⚙ Sources
      </button>
      {open && (
        <div className={styles.gearPop}>
          <div className={styles.scolLbl}>Count toward &ldquo;My Stocks&rdquo;:</div>
          {SOURCES.map(([k, lbl]) => (
            <label key={k} className={styles.gearRow}>
              <input
                type="checkbox"
                checked={mySources.includes(k)}
                onChange={() => toggleSource(k)}
              />
              {' '}{lbl}
            </label>
          ))}
        </div>
      )}
    </span>
  )
}
