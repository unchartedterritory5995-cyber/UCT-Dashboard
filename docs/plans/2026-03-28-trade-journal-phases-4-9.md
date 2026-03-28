# Trade Journal Implementation Plan — Phases 4-9

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build daily journals, calendar review, overview dashboard, review queue UI, analytics, playbooks, monthly reviews, insights engine, resources, CSV import, and AI trade summaries.

**Prerequisites:** Phases 1-3 must be complete (schema, taxonomy, enhanced CRUD, trade log, trade drawer, process scoring, mistakes/emotions, screenshots, review status).

**Tech Stack:** React 19, Vite, CSS Modules, FastAPI, SQLite, ECharts, SWR, Claude Haiku (Phase 9)

**Spec:** `docs/plans/2026-03-28-trade-journal-design.md`

---

## File Structure (Phases 4-9)

### Backend (Python — `api/`)

```
api/services/
  journal_service.py          — MODIFY: add daily journal CRUD, analytics aggregation, insights engine
  journal_playbooks.py        — CREATE: playbook CRUD + denormalized stats recompute
  journal_import.py           — CREATE: CSV parser, field mapping, duplicate detection
  journal_ai.py               — CREATE: Claude Haiku trade summaries + weekly digest

api/routers/
  journal.py                  — MODIFY: add daily journal, analytics, playbook, resource, import, AI endpoints
```

### Frontend (React — `app/src/`)

```
app/src/pages/journal/
  tabs/
    DailyNotes.jsx            — CREATE: split-view daily journal
    DailyNotes.module.css     — CREATE: daily notes styles
    CalendarReview.jsx        — CREATE: month grid calendar
    CalendarReview.module.css — CREATE: calendar styles
    Overview.jsx              — CREATE: KPI dashboard + review shortcuts
    Overview.module.css       — CREATE: overview styles
    ReviewQueue.jsx           — CREATE: prioritized review items
    ReviewQueue.module.css    — CREATE: review queue styles
    Analytics.jsx             — CREATE: dimension breakdowns + equity curve
    Analytics.module.css      — CREATE: analytics styles
    Playbooks.jsx             — CREATE: playbook CRUD + linked trades
    Playbooks.module.css      — CREATE: playbook styles
  components/
    DailyReviewForm.jsx       — CREATE: structured daily note template (4 collapsible sections)
    CalendarCell.jsx          — CREATE: single day cell (P&L + dots + bars)
    InsightCard.jsx           — CREATE: pattern insight with evidence
    ResourceEditor.jsx        — CREATE: resource CRUD (categorized list)
    ImportWizard.jsx          — CREATE: CSV upload + field mapping + preview
    ImportWizard.module.css   — CREATE: import styles
    AISummary.jsx             — CREATE: generate/display AI summary
```

---

## Phase 4: Daily Notes + Calendar

---

## Task 12: Daily Journal Service

**Files:**
- Modify: `api/services/journal_service.py`

- [ ] **Step 1: Add daily journal CRUD functions**

Append these functions to `journal_service.py`. The `get_or_create_daily` pattern auto-creates on first access (same as design spec).

```python
def get_or_create_daily(user_id: str, date: str) -> dict:
    """Get daily journal for date, creating if it doesn't exist."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM daily_journals WHERE user_id = ? AND date = ?",
            (user_id, date),
        ).fetchone()
        if row:
            result = dict(row)
            # Attach trades for this date
            result["trades"] = _get_trades_for_date(conn, user_id, date)
            return result

        # Auto-create
        dj_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO daily_journals (id, user_id, date, created_at, updated_at)
               VALUES (?,?,?,?,?)""",
            (dj_id, user_id, date, now, now),
        )
        conn.commit()
        result = dict(conn.execute(
            "SELECT * FROM daily_journals WHERE id = ?", (dj_id,)
        ).fetchone())
        result["trades"] = _get_trades_for_date(conn, user_id, date)
        return result
    finally:
        conn.close()


def update_daily(user_id: str, date: str, data: dict) -> dict | None:
    """Update daily journal fields. Returns updated record."""
    _DAILY_FIELDS = {
        "premarket_thesis", "focus_list", "a_plus_setups", "risk_plan",
        "market_regime", "emotional_state", "midday_notes", "eod_recap",
        "did_well", "did_poorly", "learned", "tomorrow_focus",
        "energy_rating", "discipline_score", "review_complete",
    }
    updates = {k: v for k, v in data.items() if k in _DAILY_FIELDS}
    if not updates:
        return get_or_create_daily(user_id, date)

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Auto-compute review_complete if not explicitly set
    if "review_complete" not in updates:
        merged = {**get_or_create_daily(user_id, date), **updates}
        has_premarket = bool(merged.get("premarket_thesis"))
        has_eod = bool(merged.get("eod_recap"))
        has_learned = bool(merged.get("learned"))
        updates["review_complete"] = 1 if (has_premarket and has_eod and has_learned) else 0

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [user_id, date]

    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE daily_journals SET {set_clause} WHERE user_id = ? AND date = ?",
            values,
        )
        conn.commit()
        return get_or_create_daily(user_id, date)
    finally:
        conn.close()


def list_daily_journals(user_id: str, date_from: str = None, date_to: str = None) -> list[dict]:
    """List daily journals with completion status (for the left sidebar date list)."""
    conn = get_connection()
    try:
        where = "user_id = ?"
        params = [user_id]
        if date_from:
            where += " AND date >= ?"
            params.append(date_from)
        if date_to:
            where += " AND date <= ?"
            params.append(date_to)

        rows = conn.execute(
            f"""SELECT id, date, review_complete,
                       CASE WHEN premarket_thesis != '' OR eod_recap != '' THEN 1 ELSE 0 END as has_content
                FROM daily_journals WHERE {where} ORDER BY date DESC""",
            params,
        ).fetchall()

        # Also find dates with trades but no journal
        trade_dates = conn.execute(
            f"""SELECT DISTINCT entry_date FROM journal_entries
                WHERE user_id = ? AND entry_date IS NOT NULL
                {"AND entry_date >= ?" if date_from else ""}
                {"AND entry_date <= ?" if date_to else ""}
                ORDER BY entry_date DESC""",
            [user_id] + ([date_from] if date_from else []) + ([date_to] if date_to else []),
        ).fetchall()

        journal_dates = {r["date"] for r in rows}
        result = [dict(r) for r in rows]
        for td in trade_dates:
            if td["entry_date"] not in journal_dates:
                result.append({
                    "date": td["entry_date"],
                    "review_complete": 0,
                    "has_content": 0,
                    "has_journal": False,
                })

        result.sort(key=lambda x: x["date"], reverse=True)
        return result
    finally:
        conn.close()


def _get_trades_for_date(conn, user_id: str, date: str) -> list[dict]:
    """Get mini trade list for a date (used in daily journal view)."""
    rows = conn.execute(
        """SELECT id, sym, direction, pnl_pct, pnl_dollar, review_status, setup, status
           FROM journal_entries WHERE user_id = ? AND entry_date = ?
           ORDER BY entry_time, created_at""",
        (user_id, date),
    ).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 2: Commit**

```bash
git add api/services/journal_service.py
git commit -m "feat(journal): add daily journal CRUD — get_or_create, update, list with trade linking"
```

---

## Task 13: Daily Journal + Calendar API Endpoints

**Files:**
- Modify: `api/routers/journal.py`

- [ ] **Step 1: Add daily journal endpoints to the router**

Add these routes after the existing trade CRUD routes:

```python
# ── Daily Journals ────────────────────────────────────────────────────────────

class DailyJournalUpdate(BaseModel):
    premarket_thesis: Optional[str] = None
    focus_list: Optional[str] = None
    a_plus_setups: Optional[str] = None
    risk_plan: Optional[str] = None
    market_regime: Optional[str] = None
    emotional_state: Optional[str] = None
    midday_notes: Optional[str] = None
    eod_recap: Optional[str] = None
    did_well: Optional[str] = None
    did_poorly: Optional[str] = None
    learned: Optional[str] = None
    tomorrow_focus: Optional[str] = None
    energy_rating: Optional[int] = None
    discipline_score: Optional[int] = None
    review_complete: Optional[int] = None


@router.get("/api/journal/daily")
def list_daily(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    return journal_service.list_daily_journals(user["id"], date_from, date_to)


@router.get("/api/journal/daily/{date}")
def get_daily(date: str, user: dict = Depends(get_current_user)):
    return journal_service.get_or_create_daily(user["id"], date)


@router.put("/api/journal/daily/{date}")
def update_daily(date: str, body: DailyJournalUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    return journal_service.update_daily(user["id"], date, data)
```

- [ ] **Step 2: Verify calendar endpoint already exists from Phase 3**

The `GET /api/journal/calendar?month=YYYY-MM` endpoint was already added in Task 6. Confirm it returns the expected shape: `{ month, days: { "YYYY-MM-DD": { trade_count, wins, losses, net_pnl_pct, ... } } }`.

- [ ] **Step 3: Commit**

```bash
git add api/routers/journal.py
git commit -m "feat(journal): add daily journal API — GET/PUT /api/journal/daily/{date}"
```

---

## Task 14: DailyNotes Tab

**Files:**
- Create: `app/src/pages/journal/tabs/DailyNotes.jsx`
- Create: `app/src/pages/journal/tabs/DailyNotes.module.css`
- Create: `app/src/pages/journal/components/DailyReviewForm.jsx`

- [ ] **Step 1: Create DailyReviewForm component**

The form has 4 collapsible sections. Each section has a header that toggles open/closed. Time-appropriate highlighting: pre-market sections pulse before market open, midday during session, EOD after close.

```jsx
// DailyReviewForm.jsx — key structure
import { useState, useCallback } from 'react';
import styles from '../tabs/DailyNotes.module.css';

const SECTIONS = [
  {
    key: 'premarket',
    label: 'PRE-MARKET',
    fields: [
      { key: 'premarket_thesis', label: 'Market Thesis', type: 'textarea', placeholder: 'What is your thesis for today?' },
      { key: 'focus_list', label: 'Focus List', type: 'text', placeholder: 'AAPL, NVDA, SMCI...' },
      { key: 'a_plus_setups', label: 'A+ Setups', type: 'textarea', placeholder: 'Best setups identified...' },
      { key: 'risk_plan', label: 'Risk Plan', type: 'textarea', placeholder: 'Max loss, position sizing rules...' },
    ],
  },
  {
    key: 'market',
    label: 'MARKET NOTES',
    fields: [
      { key: 'market_regime', label: 'Market Regime', type: 'text', placeholder: 'Bull/bear/chop, breadth reading...' },
      { key: 'emotional_state', label: 'Emotional Baseline', type: 'text', placeholder: 'How are you feeling before the bell?' },
      { key: 'energy_rating', label: 'Energy Rating', type: 'rating', max: 5 },
    ],
  },
  {
    key: 'midday',
    label: 'MIDDAY CHECK-IN',
    fields: [
      { key: 'midday_notes', label: 'Midday Notes', type: 'textarea', placeholder: 'Adjustments, observations...' },
    ],
  },
  {
    key: 'eod',
    label: 'END OF DAY',
    fields: [
      { key: 'eod_recap', label: 'Recap', type: 'textarea', placeholder: 'How did the day go?' },
      { key: 'did_well', label: 'Did Well', type: 'textarea', placeholder: 'What went right...' },
      { key: 'did_poorly', label: 'Did Poorly', type: 'textarea', placeholder: 'What went wrong...' },
      { key: 'learned', label: 'Learned', type: 'textarea', placeholder: 'Key takeaway for today...' },
      { key: 'tomorrow_focus', label: 'Tomorrow Focus', type: 'text', placeholder: 'Focus for next session...' },
      { key: 'discipline_score', label: 'Discipline Score', type: 'slider', min: 0, max: 100 },
    ],
  },
];

export default function DailyReviewForm({ data, onFieldChange, saving }) {
  const [expanded, setExpanded] = useState({ premarket: true, market: true, midday: false, eod: true });

  // Time-appropriate section highlighting
  const hour = new Date().getHours();
  const highlight = hour < 9 ? 'premarket' : hour < 12 ? 'midday' : hour >= 16 ? 'eod' : null;

  // Render sections with collapsible headers
  // Each field calls onFieldChange(key, value) which debounces a PUT to the API
}
```

- [ ] **Step 2: Create DailyNotes tab**

Split view: left 240px date sidebar + right form area. Date sidebar shows dates with completion dots (green=complete, amber=partial, gray=empty, blue dot=has trades). Clicking a date loads that day's journal.

```jsx
// DailyNotes.jsx — key structure
import { useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import DailyReviewForm from '../components/DailyReviewForm';
import styles from './DailyNotes.module.css';

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json());

export default function DailyNotes() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);

  // Date list (last 90 days of journals + trade dates)
  const { data: dateList } = useSWR('/api/journal/daily', fetcher);

  // Selected day's journal (auto-creates on first access)
  const { data: journal, mutate } = useSWR(
    `/api/journal/daily/${selectedDate}`, fetcher
  );

  const handleFieldChange = useCallback(async (key, value) => {
    // Optimistic update + debounced PUT
    mutate({ ...journal, [key]: value }, false);
    await fetch(`/api/journal/daily/${selectedDate}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ [key]: value }),
    });
    mutate();
  }, [journal, selectedDate, mutate]);

  return (
    <div className={styles.dailyLayout}>
      <div className={styles.dateSidebar}>
        <div className={styles.dateSidebarHeader}>DAILY NOTES</div>
        {dateList?.map(d => (
          <button
            key={d.date}
            className={`${styles.dateItem} ${d.date === selectedDate ? styles.dateItemActive : ''}`}
            onClick={() => setSelectedDate(d.date)}
          >
            <span className={styles.dateLabel}>{formatDate(d.date)}</span>
            <span className={`${styles.dateDot} ${
              d.review_complete ? styles.dotGreen :
              d.has_content ? styles.dotAmber : styles.dotGray
            }`} />
          </button>
        ))}
      </div>
      <div className={styles.dailyForm}>
        {journal && (
          <DailyReviewForm data={journal} onFieldChange={handleFieldChange} />
        )}
        {/* Linked trades mini-table below form */}
        {journal?.trades?.length > 0 && (
          <div className={styles.linkedTrades}>
            <div className={styles.linkedTradesHeader}>TRADES THIS DAY</div>
            {journal.trades.map(t => (
              <div key={t.id} className={styles.linkedTradeRow}>
                <span className={styles.ltSym}>{t.sym}</span>
                <span className={styles.ltDir}>{t.direction}</span>
                <span className={t.pnl_pct >= 0 ? styles.ltGreen : styles.ltRed}>
                  {t.pnl_pct != null ? `${t.pnl_pct > 0 ? '+' : ''}${t.pnl_pct}%` : '—'}
                </span>
                <span className={styles.ltStatus}>{t.review_status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create DailyNotes.module.css**

Key classes: `.dailyLayout` (flex row), `.dateSidebar` (240px, overflow-y auto, border-right), `.dateItem` + `.dateItemActive`, `.dateDot` + `.dotGreen/.dotAmber/.dotGray`, `.dailyForm` (flex 1, padding 20px, overflow-y auto), `.linkedTrades`, `.sectionHeader` (collapsible, Cinzel 14px gold), `.sectionBody`, `.sectionHighlight` (subtle pulse on appropriate time). Mobile: sidebar becomes horizontal scrollable date strip at top.

- [ ] **Step 4: Wire DailyNotes tab into JournalPage**

Import `DailyNotes` in `JournalPage.jsx` and render it when `activeTab === 'daily'`.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal/tabs/DailyNotes.jsx app/src/pages/journal/tabs/DailyNotes.module.css app/src/pages/journal/components/DailyReviewForm.jsx app/src/pages/journal/JournalPage.jsx
git commit -m "feat(journal): add DailyNotes tab — split-view with 4 collapsible sections, date sidebar, linked trades"
```

---

## Task 15: CalendarReview Tab

**Files:**
- Create: `app/src/pages/journal/tabs/CalendarReview.jsx`
- Create: `app/src/pages/journal/tabs/CalendarReview.module.css`
- Create: `app/src/pages/journal/components/CalendarCell.jsx`

- [ ] **Step 1: Create CalendarCell component**

Each cell shows: net P&L (green/red), trade count, mini win rate bar, review dots.

```jsx
// CalendarCell.jsx
import styles from '../tabs/CalendarReview.module.css';

export default function CalendarCell({ day, data, isToday, onClick }) {
  if (!data) {
    return (
      <div className={`${styles.cell} ${isToday ? styles.cellToday : ''}`} onClick={onClick}>
        <span className={styles.cellDay}>{day}</span>
      </div>
    );
  }

  const { trade_count, wins, losses, net_pnl_pct, avg_process_score,
          has_daily_journal, daily_review_complete, review_statuses } = data;
  const winRate = trade_count > 0 ? (wins / trade_count) * 100 : 0;

  return (
    <div
      className={`${styles.cell} ${styles.cellActive} ${isToday ? styles.cellToday : ''}`}
      style={{ borderLeftColor: net_pnl_pct >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
      onClick={onClick}
    >
      <span className={styles.cellDay}>{day}</span>
      <span className={net_pnl_pct >= 0 ? styles.cellPnlGreen : styles.cellPnlRed}>
        {net_pnl_pct > 0 ? '+' : ''}{net_pnl_pct.toFixed(1)}%
      </span>
      <span className={styles.cellCount}>{trade_count} trade{trade_count !== 1 ? 's' : ''}</span>
      {/* Mini win rate bar */}
      <div className={styles.winBar}>
        <div className={styles.winBarFill} style={{ width: `${winRate}%` }} />
      </div>
      {/* Review dots */}
      <div className={styles.cellDots}>
        {review_statuses?.map((s, i) => (
          <span key={i} className={`${styles.dot} ${styles[`dot_${s}`]}`} />
        ))}
        {has_daily_journal && <span className={`${styles.dot} ${styles.dotBlue}`} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CalendarReview tab**

Month grid with navigation arrows. Clicking a day opens a detail panel below the calendar showing that day's trades and journal excerpt.

```jsx
// CalendarReview.jsx — key structure
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import CalendarCell from '../components/CalendarCell';
import styles from './CalendarReview.module.css';

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json());

export default function CalendarReview({ onOpenTrade }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(null);

  const { data: calData } = useSWR(`/api/journal/calendar?month=${month}`, fetcher);

  // Build 6-week grid from month
  const grid = useMemo(() => buildCalendarGrid(month), [month]);

  const prevMonth = () => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setMonth(d.toISOString().slice(0, 7));
  };
  const nextMonth = () => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m, 1);
    setMonth(d.toISOString().slice(0, 7));
  };

  const dayDetail = selectedDay && calData?.days?.[selectedDay];

  return (
    <div className={styles.calendarWrap}>
      <div className={styles.calHeader}>
        <button onClick={prevMonth} className={styles.calNav}>←</button>
        <span className={styles.calMonth}>{formatMonth(month)}</span>
        <button onClick={nextMonth} className={styles.calNav}>→</button>
      </div>
      <div className={styles.calDayHeaders}>
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} className={styles.calDayHeader}>{d}</div>
        ))}
      </div>
      <div className={styles.calGrid}>
        {grid.map((dateStr, i) => {
          const day = dateStr ? parseInt(dateStr.slice(-2)) : null;
          const data = dateStr ? calData?.days?.[dateStr] : null;
          const isToday = dateStr === new Date().toISOString().slice(0, 10);
          return (
            <CalendarCell
              key={i}
              day={day}
              data={data}
              isToday={isToday}
              onClick={() => dateStr && setSelectedDay(dateStr)}
            />
          );
        })}
      </div>
      {/* Day detail panel */}
      {selectedDay && (
        <div className={styles.dayDetail}>
          {/* Show trades for selected day + daily journal excerpt */}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create CalendarReview.module.css**

Key classes: `.calendarWrap`, `.calHeader` (flex, Cinzel gold), `.calGrid` (7-column CSS grid), `.cell` (aspect-ratio 1, border-left 3px transparent), `.cellActive` (border-left-color from P&L), `.cellToday` (gold outline), `.cellPnlGreen/.cellPnlRed` (IBM Plex Mono 11px), `.winBar` (2px height, bg var(--bg-elevated), `.winBarFill` green), `.dot` (6px circle), `.dot_reviewed` green, `.dot_partial` amber, `.dot_logged` blue, `.dot_draft` gray, `.dotBlue` blue, `.dayDetail` (border-top, padding 16px, max-height 300px overflow-y). Mobile: cells shrink, hide win bar, show just P&L and dot count.

- [ ] **Step 4: Wire CalendarReview into JournalPage**

Import and render when `activeTab === 'calendar'`. Pass `onOpenTrade` prop so clicking a trade in the day detail opens the TradeDrawer.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal/tabs/CalendarReview.jsx app/src/pages/journal/tabs/CalendarReview.module.css app/src/pages/journal/components/CalendarCell.jsx app/src/pages/journal/JournalPage.jsx
git commit -m "feat(journal): add CalendarReview tab — month grid with P&L heatmap, win rate bars, review dots"
```

---

## Phase 5: Overview + Review Queue UI

---

## Task 16: Overview Tab

**Files:**
- Create: `app/src/pages/journal/tabs/Overview.jsx`
- Create: `app/src/pages/journal/tabs/Overview.module.css`

- [ ] **Step 1: Create Overview tab**

Uses the existing `GET /api/journal/stats` endpoint (already has win_rate, avg_r, profit_factor, expectancy, avg_process_score, review_counts) plus `GET /api/journal/review-queue` for the queue count.

```jsx
// Overview.jsx — key structure
import { useState } from 'react';
import useSWR from 'swr';
import StatCard from '../components/StatCard';
import styles from './Overview.module.css';

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json());

const PERIOD_OPTIONS = [
  { key: '7d', label: '1W' },
  { key: '30d', label: '1M' },
  { key: '90d', label: '3M' },
  { key: '365d', label: '1Y' },
  { key: 'all', label: 'All' },
];

function dateFrom(period) {
  if (period === 'all') return '';
  const d = new Date();
  d.setDate(d.getDate() - parseInt(period));
  return d.toISOString().slice(0, 10);
}

export default function Overview({ onSwitchTab }) {
  const [period, setPeriod] = useState('30d');
  const from = dateFrom(period);

  const { data: stats } = useSWR(
    `/api/journal/stats${from ? `?date_from=${from}` : ''}`, fetcher
  );
  const { data: queue } = useSWR('/api/journal/review-queue', fetcher);

  if (!stats) return null;

  return (
    <div className={styles.overview}>
      {/* Period selector */}
      <div className={styles.periodBar}>
        {PERIOD_OPTIONS.map(p => (
          <button
            key={p.key}
            className={`${styles.periodBtn} ${period === p.key ? styles.periodActive : ''}`}
            onClick={() => setPeriod(p.key)}
          >{p.label}</button>
        ))}
      </div>

      {/* 6 KPI cards */}
      <div className={styles.kpiGrid}>
        <StatCard label="NET P&L" value={`${stats.total_pnl_pct > 0 ? '+' : ''}${stats.total_pnl_pct}%`}
          accent={stats.total_pnl_pct >= 0 ? 'green' : 'red'} />
        <StatCard label="WIN RATE" value={`${stats.win_rate}%`}
          sub={`${stats.wins}W / ${stats.losses}L`} accent="gold" />
        <StatCard label="AVG R" value={stats.avg_r.toFixed(2)} accent="gold" />
        <StatCard label="PROFIT FACTOR" value={stats.profit_factor.toFixed(2)}
          accent={stats.profit_factor >= 1.5 ? 'green' : stats.profit_factor >= 1 ? 'gold' : 'red'} />
        <StatCard label="EXPECTANCY" value={stats.expectancy.toFixed(2)}
          accent={stats.expectancy > 0 ? 'green' : 'red'} />
        <StatCard label="PROCESS SCORE" value={Math.round(stats.avg_process_score)}
          accent={stats.avg_process_score >= 70 ? 'green' : stats.avg_process_score >= 50 ? 'gold' : 'red'} />
      </div>

      {/* Review shortcuts — clickable chips */}
      <div className={styles.shortcutsSection}>
        <div className={styles.shortcutsLabel}>REVIEW SHORTCUTS</div>
        <div className={styles.chipRow}>
          {/* Each chip shows count badge and filters trade log on click */}
          <Chip label="Unreviewed" count={stats.review_counts?.logged || 0}
            onClick={() => onSwitchTab('log', { review_status: 'logged' })} />
          <Chip label="Partial" count={stats.review_counts?.partial || 0}
            onClick={() => onSwitchTab('log', { review_status: 'partial' })} />
          <Chip label="Flagged" count={stats.review_counts?.flagged || 0}
            onClick={() => onSwitchTab('log', { review_status: 'flagged' })} />
          <Chip label="Follow-Up" count={stats.review_counts?.follow_up || 0}
            onClick={() => onSwitchTab('log', { review_status: 'follow_up' })} />
          <Chip label="No Screenshots" count={stats.review_counts?.missing_screenshots || 0}
            onClick={() => onSwitchTab('log', { has_screenshots: 'false' })} />
          <Chip label="No Notes" count={stats.review_counts?.missing_notes || 0}
            onClick={() => onSwitchTab('log', { has_notes: 'false' })} />
        </div>
      </div>

      {/* Review queue banner */}
      {queue?.length > 0 && (
        <div className={styles.queueBanner} onClick={() => onSwitchTab('queue')}>
          <span className={styles.queueCount}>{queue.length}</span> items need review →
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create Overview.module.css**

Key classes: `.overview` (padding 20px), `.periodBar` (flex gap 6px), `.periodBtn` / `.periodActive` (same pattern as ThemeTrackerPage), `.kpiGrid` (6-column grid, gap 12px; collapses to 3x2 on tablet, 2x3 on mobile), `.shortcutsSection`, `.chipRow` (flex wrap gap 8px), `.chip` (bg var(--bg-elevated), 12px IBM Plex Mono, count badge as small circle), `.queueBanner` (gold left border, bg var(--bg-surface), cursor pointer, subtle hover glow).

- [ ] **Step 3: Wire into JournalPage**

Import Overview, render when `activeTab === 'overview'`. Pass `onSwitchTab` callback that sets activeTab + optional filter state.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/journal/tabs/Overview.jsx app/src/pages/journal/tabs/Overview.module.css app/src/pages/journal/JournalPage.jsx
git commit -m "feat(journal): add Overview tab — 6 KPI cards, period selector, review shortcuts, queue banner"
```

---

## Task 17: ReviewQueue Tab

**Files:**
- Create: `app/src/pages/journal/tabs/ReviewQueue.jsx`
- Create: `app/src/pages/journal/tabs/ReviewQueue.module.css`

- [ ] **Step 1: Create ReviewQueue tab**

Renders the items from `GET /api/journal/review-queue` (already implemented in Phase 3 service). Each item shows a type badge, symbol/date, what's missing, and a "Review" button that opens the trade in the TradeDrawer.

```jsx
// ReviewQueue.jsx — key structure
const TYPE_CONFIG = {
  today_unreviewed: { label: 'TODAY', color: 'var(--color-danger)', icon: '!' },
  follow_up: { label: 'FOLLOW-UP', color: '#a78bfa', icon: '↩' },
  missing_process: { label: 'NO PROCESS', color: 'var(--color-warning)', icon: '◎' },
  flagged: { label: 'FLAGGED', color: 'var(--color-danger)', icon: '⚑' },
  missing_screenshots: { label: 'NO SCREENSHOTS', color: '#64748b', icon: '📷' },
  missing_notes: { label: 'NO NOTES', color: '#64748b', icon: '✎' },
};

export default function ReviewQueue({ onOpenTrade }) {
  const { data: items } = useSWR('/api/journal/review-queue', fetcher);

  if (!items?.length) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>✓</div>
        <div className={styles.emptyText}>All caught up — no items need review</div>
      </div>
    );
  }

  return (
    <div className={styles.queue}>
      <div className={styles.queueHeader}>
        <span className={styles.queueTitle}>REVIEW QUEUE</span>
        <span className={styles.queueCount}>{items.length} items</span>
      </div>
      {items.map(item => {
        const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.missing_notes;
        return (
          <div key={item.id} className={styles.queueItem}>
            <span className={styles.typeBadge} style={{ background: cfg.color }}>
              {cfg.icon} {cfg.label}
            </span>
            <span className={styles.itemSym}>{item.sym}</span>
            <span className={styles.itemDate}>{item.entry_date}</span>
            {item.pnl_pct != null && (
              <span className={item.pnl_pct >= 0 ? styles.pnlGreen : styles.pnlRed}>
                {item.pnl_pct > 0 ? '+' : ''}{item.pnl_pct}%
              </span>
            )}
            <button className={styles.reviewBtn} onClick={() => onOpenTrade(item.id)}>
              Review →
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create ReviewQueue.module.css**

Key classes: `.queue` (padding 20px), `.queueItem` (flex row, align-items center, gap 12px, padding 10px 12px, border-bottom 1px var(--border), hover bg), `.typeBadge` (font 9px IBM Plex Mono uppercase, padding 2px 8px, border-radius 3px, color white), `.reviewBtn` (gold text, no bg, hover underline), `.empty` (centered, muted, 200px top margin). Badge on the Review Queue tab in `JournalPage.jsx`: small red circle with count.

- [ ] **Step 3: Add queue count badge to JournalPage tab bar**

In `JournalPage.jsx`, fetch `GET /api/journal/review-queue` and show `items.length` as a badge on the Review Queue tab label.

```jsx
// In JournalPage tab rendering:
{tab.key === 'queue' && queueCount > 0 && (
  <span className={styles.tabBadge}>{queueCount}</span>
)}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/journal/tabs/ReviewQueue.jsx app/src/pages/journal/tabs/ReviewQueue.module.css app/src/pages/journal/JournalPage.jsx
git commit -m "feat(journal): add ReviewQueue tab — prioritized items with type badges, queue count badge on tab"
```

---

## Phase 6: Analytics + Playbooks + Monthly Reviews

---

## Task 18: Analytics Backend

**Files:**
- Modify: `api/services/journal_service.py`
- Modify: `api/routers/journal.py`

- [ ] **Step 1: Add analytics aggregation function to journal_service.py**

```python
_HOLDING_BUCKETS = [
    (0, 60, "< 1hr"),
    (60, 390, "1hr-1D"),
    (390, 1950, "1-5D"),
    (1950, 9750, "1-5W"),
    (9750, 999999, "5W+"),
]

_PROCESS_BUCKETS = [
    (0, 30, "0-30 (Poor)"),
    (31, 60, "31-60 (Average)"),
    (61, 80, "61-80 (Good)"),
    (81, 100, "81-100 (Elite)"),
]


def get_analytics(user_id: str, group_by: str, date_from: str = None, date_to: str = None) -> dict:
    """Aggregate trade metrics by dimension."""
    conn = get_connection()
    try:
        where = "user_id = ? AND status = 'closed'"
        params = [user_id]
        if date_from:
            where += " AND entry_date >= ?"
            params.append(date_from)
        if date_to:
            where += " AND entry_date <= ?"
            params.append(date_to)

        rows = conn.execute(
            f"SELECT * FROM journal_entries WHERE {where} ORDER BY entry_date",
            params,
        ).fetchall()
        entries = [dict(r) for r in rows]

        # Group entries into buckets
        buckets = {}
        for e in entries:
            key = _get_bucket_key(e, group_by)
            if key is None:
                key = "Unknown"
            if key not in buckets:
                buckets[key] = []
            buckets[key].append(e)

        # Compute per-bucket metrics
        result = []
        for key, trades in buckets.items():
            result.append(_compute_bucket_metrics(key, trades))

        result.sort(key=lambda x: x["trade_count"], reverse=True)

        # Totals
        totals = _compute_bucket_metrics("ALL", entries) if entries else None

        # Equity curve (cumulative P&L per trade, chronological)
        equity = []
        cum = 0
        for e in entries:
            if e.get("pnl_pct") is not None:
                cum += e["pnl_pct"]
                equity.append({"date": e["entry_date"], "sym": e["sym"], "cum_pnl": round(cum, 2)})

        return {"buckets": result, "totals": totals, "equity_curve": equity}
    finally:
        conn.close()


def _get_bucket_key(entry: dict, group_by: str) -> str | None:
    if group_by == "setup":
        return entry.get("setup") or "No Setup"
    elif group_by == "symbol":
        return entry.get("sym")
    elif group_by == "direction":
        return entry.get("direction")
    elif group_by == "day_of_week":
        return entry.get("day_of_week")
    elif group_by == "session":
        return entry.get("session") or "Unknown"
    elif group_by == "asset_class":
        return entry.get("asset_class") or "equity"
    elif group_by == "playbook":
        return entry.get("playbook_id") or "No Playbook"
    elif group_by == "month":
        return entry.get("entry_date", "")[:7] or None
    elif group_by == "week":
        # ISO week
        try:
            dt = datetime.strptime(entry["entry_date"][:10], "%Y-%m-%d")
            return f"{dt.isocalendar()[0]}-W{dt.isocalendar()[1]:02d}"
        except (ValueError, KeyError):
            return None
    elif group_by == "mistake_tag":
        tags = entry.get("mistake_tags") or ""
        return tags.split(",")[0].strip() if tags else "No Mistakes"
    elif group_by == "holding_period_bucket":
        mins = entry.get("holding_minutes")
        if mins is None:
            return "Unknown"
        for lo, hi, label in _HOLDING_BUCKETS:
            if lo <= mins < hi:
                return label
        return "5W+"
    elif group_by == "process_score_bucket":
        ps = entry.get("process_score")
        if ps is None:
            return "Unscored"
        for lo, hi, label in _PROCESS_BUCKETS:
            if lo <= ps <= hi:
                return label
        return "Unscored"
    return None


def _compute_bucket_metrics(key: str, trades: list[dict]) -> dict:
    with_pnl = [t for t in trades if t.get("pnl_pct") is not None]
    wins = [t for t in with_pnl if t["pnl_pct"] > 0]
    losses = [t for t in with_pnl if t["pnl_pct"] <= 0]

    total_win = sum(t["pnl_pct"] for t in wins)
    total_loss = sum(abs(t["pnl_pct"]) for t in losses)
    pf = total_win / total_loss if total_loss > 0 else 0

    with_r = [t for t in with_pnl if t.get("realized_r") is not None]
    with_ps = [t for t in trades if t.get("process_score") is not None]

    best = max(with_pnl, key=lambda t: t["pnl_pct"]) if with_pnl else None
    worst = min(with_pnl, key=lambda t: t["pnl_pct"]) if with_pnl else None

    return {
        "key": key,
        "trade_count": len(trades),
        "win_rate": round(len(wins) / len(with_pnl) * 100, 1) if with_pnl else 0,
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in with_pnl) / len(with_pnl), 2) if with_pnl else 0,
        "total_pnl_pct": round(sum(t["pnl_pct"] for t in with_pnl), 2),
        "avg_r": round(sum(t["realized_r"] for t in with_r) / len(with_r), 2) if with_r else None,
        "profit_factor": round(pf, 2),
        "avg_process_score": round(sum(t["process_score"] for t in with_ps) / len(with_ps), 1) if with_ps else None,
        "avg_holding_minutes": round(sum(t.get("holding_minutes", 0) for t in trades) / len(trades)) if trades else 0,
        "best_trade": {"sym": best["sym"], "pnl_pct": best["pnl_pct"]} if best else None,
        "worst_trade": {"sym": worst["sym"], "pnl_pct": worst["pnl_pct"]} if worst else None,
    }
```

- [ ] **Step 2: Add analytics endpoint to router**

```python
@router.get("/api/journal/analytics")
def journal_analytics(
    group_by: str = Query("setup", description="Dimension to group by"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    valid_groups = {
        "setup", "symbol", "direction", "day_of_week", "session",
        "asset_class", "playbook", "month", "week", "mistake_tag",
        "holding_period_bucket", "process_score_bucket",
    }
    if group_by not in valid_groups:
        raise HTTPException(status_code=400, detail=f"Invalid group_by. Must be one of: {', '.join(valid_groups)}")
    return journal_service.get_analytics(user["id"], group_by, date_from, date_to)
```

- [ ] **Step 3: Commit**

```bash
git add api/services/journal_service.py api/routers/journal.py
git commit -m "feat(journal): add analytics aggregation — group by 12 dimensions with per-bucket metrics"
```

---

## Task 19: Analytics Tab UI

**Files:**
- Create: `app/src/pages/journal/tabs/Analytics.jsx`
- Create: `app/src/pages/journal/tabs/Analytics.module.css`

- [ ] **Step 1: Create Analytics tab**

Horizontal chip bar for dimension selection, period selector, results table, and ECharts equity curve below.

```jsx
// Analytics.jsx — key structure
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import ReactECharts from 'echarts-for-react';
import styles from './Analytics.module.css';

const DIMENSIONS = [
  { key: 'setup', label: 'Setup' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'direction', label: 'Direction' },
  { key: 'day_of_week', label: 'Day of Week' },
  { key: 'session', label: 'Session' },
  { key: 'holding_period_bucket', label: 'Holding Period' },
  { key: 'process_score_bucket', label: 'Process Score' },
  { key: 'mistake_tag', label: 'Mistake' },
  { key: 'playbook', label: 'Playbook' },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
];

const PERIODS = [
  { key: '7', label: '1W' },
  { key: '30', label: '1M' },
  { key: '90', label: '3M' },
  { key: '180', label: '6M' },
  { key: '365', label: '1Y' },
  { key: '', label: 'All' },
];

export default function Analytics() {
  const [dimension, setDimension] = useState('setup');
  const [periodDays, setPeriodDays] = useState('');

  const dateFrom = periodDays
    ? new Date(Date.now() - periodDays * 86400000).toISOString().slice(0, 10)
    : '';

  const { data } = useSWR(
    `/api/journal/analytics?group_by=${dimension}${dateFrom ? `&date_from=${dateFrom}` : ''}`,
    fetcher
  );

  // ECharts equity curve option
  const chartOption = useMemo(() => {
    if (!data?.equity_curve?.length) return null;
    return {
      // ... standard ECharts line config with dataZoom
      // x: dates, y: cum_pnl, same dark theme as BreadthCharts
    };
  }, [data]);

  return (
    <div className={styles.analytics}>
      {/* Dimension chips */}
      <div className={styles.dimBar}>
        {DIMENSIONS.map(d => (
          <button key={d.key}
            className={`${styles.dimChip} ${dimension === d.key ? styles.dimActive : ''}`}
            onClick={() => setDimension(d.key)}>
            {d.label}
          </button>
        ))}
      </div>

      {/* Period selector */}
      <div className={styles.periodBar}>
        {PERIODS.map(p => (
          <button key={p.key}
            className={`${styles.periodBtn} ${periodDays === p.key ? styles.periodActive : ''}`}
            onClick={() => setPeriodDays(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Results table */}
      {data?.buckets && (
        <table className={styles.analyticsTable}>
          <thead>
            <tr>
              <th>{dimension === 'month' ? 'Month' : 'Bucket'}</th>
              <th>Trades</th><th>Win %</th><th>Avg P&L</th>
              <th>Total P&L</th><th>Avg R</th><th>PF</th><th>Process</th>
            </tr>
          </thead>
          <tbody>
            {data.buckets.map(b => (
              <tr key={b.key}>
                <td className={styles.bucketKey}>{b.key}</td>
                <td>{b.trade_count}</td>
                <td>{b.win_rate}%</td>
                <td className={b.avg_pnl_pct >= 0 ? styles.green : styles.red}>
                  {b.avg_pnl_pct > 0 ? '+' : ''}{b.avg_pnl_pct}%
                </td>
                <td className={b.total_pnl_pct >= 0 ? styles.green : styles.red}>
                  {b.total_pnl_pct > 0 ? '+' : ''}{b.total_pnl_pct}%
                </td>
                <td>{b.avg_r ?? '—'}</td>
                <td>{b.profit_factor}</td>
                <td>{b.avg_process_score ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Equity curve chart */}
      {chartOption && (
        <div className={styles.chartWrap}>
          <ReactECharts option={chartOption} style={{ height: 300 }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create Analytics.module.css**

Key classes: `.analytics`, `.dimBar` (flex wrap gap 6px), `.dimChip` / `.dimActive` (similar to period tabs), `.analyticsTable` (full width, IBM Plex Mono 12px, sticky header, zebra rows), `.chartWrap` (margin-top 20px, border-top). Mobile: table becomes horizontally scrollable.

- [ ] **Step 3: Wire into JournalPage**

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/journal/tabs/Analytics.jsx app/src/pages/journal/tabs/Analytics.module.css app/src/pages/journal/JournalPage.jsx
git commit -m "feat(journal): add Analytics tab — 11 dimensions, metrics table, equity curve chart"
```

---

## Task 20: Playbook Service + API

**Files:**
- Create: `api/services/journal_playbooks.py`
- Modify: `api/routers/journal.py`

- [ ] **Step 1: Create playbook service**

```python
"""
Playbook service — CRUD for trade setup definitions with denormalized stats.
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


def list_playbooks(user_id: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM playbooks WHERE user_id = ? ORDER BY is_active DESC, name",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_playbook(user_id: str, playbook_id: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM playbooks WHERE id = ? AND user_id = ?",
            (playbook_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_playbook(user_id: str, data: dict) -> dict:
    pb_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    _TEXT_FIELDS = [
        "name", "description", "market_condition", "trigger_criteria",
        "invalidations", "entry_model", "exit_model", "sizing_rules",
        "common_mistakes", "best_practices", "ideal_time", "ideal_volatility",
    ]

    conn = get_connection()
    try:
        vals = {f: (data.get(f) or "")[:5000] for f in _TEXT_FIELDS}
        vals["name"] = vals["name"][:200] or "Untitled Playbook"
        cols = list(vals.keys()) + ["id", "user_id", "created_at", "updated_at"]
        all_vals = list(vals.values()) + [pb_id, user_id, now, now]
        placeholders = ",".join(["?"] * len(cols))
        conn.execute(
            f"INSERT INTO playbooks ({','.join(cols)}) VALUES ({placeholders})",
            all_vals,
        )
        conn.commit()
        return get_playbook(user_id, pb_id)
    finally:
        conn.close()


def update_playbook(user_id: str, playbook_id: str, data: dict) -> dict | None:
    existing = get_playbook(user_id, playbook_id)
    if not existing:
        return None

    _WRITABLE = {
        "name", "description", "market_condition", "trigger_criteria",
        "invalidations", "entry_model", "exit_model", "sizing_rules",
        "common_mistakes", "best_practices", "ideal_time", "ideal_volatility",
        "is_active",
    }
    updates = {k: v for k, v in data.items() if k in _WRITABLE}
    if not updates:
        return existing

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [playbook_id, user_id]

    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE playbooks SET {set_clause} WHERE id = ? AND user_id = ?",
            values,
        )
        conn.commit()
        return get_playbook(user_id, playbook_id)
    finally:
        conn.close()


def delete_playbook(user_id: str, playbook_id: str) -> bool:
    conn = get_connection()
    try:
        # Clear playbook_id from linked trades
        conn.execute(
            "UPDATE journal_entries SET playbook_id = NULL WHERE playbook_id = ? AND user_id = ?",
            (playbook_id, user_id),
        )
        result = conn.execute(
            "DELETE FROM playbooks WHERE id = ? AND user_id = ?",
            (playbook_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def get_playbook_trades(user_id: str, playbook_id: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, sym, direction, entry_date, pnl_pct, realized_r, process_score, review_status
               FROM journal_entries WHERE user_id = ? AND playbook_id = ?
               ORDER BY entry_date DESC""",
            (user_id, playbook_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def recompute_playbook_stats(user_id: str, playbook_id: str):
    """Recompute denormalized stats on a playbook from its linked trades."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT pnl_pct, realized_r FROM journal_entries
               WHERE user_id = ? AND playbook_id = ? AND status = 'closed'""",
            (user_id, playbook_id),
        ).fetchall()
        trades = [dict(r) for r in rows]

        count = len(trades)
        if count == 0:
            conn.execute(
                "UPDATE playbooks SET trade_count = 0, win_rate = NULL, avg_r = NULL WHERE id = ?",
                (playbook_id,),
            )
            conn.commit()
            return

        with_pnl = [t for t in trades if t.get("pnl_pct") is not None]
        wins = [t for t in with_pnl if t["pnl_pct"] > 0]
        wr = round(len(wins) / len(with_pnl) * 100, 1) if with_pnl else None

        with_r = [t for t in with_pnl if t.get("realized_r") is not None]
        avg_r = round(sum(t["realized_r"] for t in with_r) / len(with_r), 2) if with_r else None

        conn.execute(
            "UPDATE playbooks SET trade_count = ?, win_rate = ?, avg_r = ? WHERE id = ?",
            (count, wr, avg_r, playbook_id),
        )
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 2: Add playbook + resource endpoints to router**

```python
from api.services import journal_playbooks

# ── Playbooks ─────────────────────────────────────────────────────────────────

class PlaybookCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    market_condition: Optional[str] = ""
    trigger_criteria: Optional[str] = ""
    invalidations: Optional[str] = ""
    entry_model: Optional[str] = ""
    exit_model: Optional[str] = ""
    sizing_rules: Optional[str] = ""
    common_mistakes: Optional[str] = ""
    best_practices: Optional[str] = ""
    ideal_time: Optional[str] = ""
    ideal_volatility: Optional[str] = ""


@router.get("/api/journal/playbooks")
def list_playbooks(user: dict = Depends(get_current_user)):
    return journal_playbooks.list_playbooks(user["id"])


@router.post("/api/journal/playbooks")
def create_playbook(body: PlaybookCreate, user: dict = Depends(get_current_user)):
    return journal_playbooks.create_playbook(user["id"], body.model_dump())


@router.put("/api/journal/playbooks/{pb_id}")
def update_playbook(pb_id: str, body: PlaybookCreate, user: dict = Depends(get_current_user)):
    result = journal_playbooks.update_playbook(user["id"], pb_id, body.model_dump())
    if not result:
        raise HTTPException(status_code=404, detail="Playbook not found")
    return result


@router.delete("/api/journal/playbooks/{pb_id}")
def delete_playbook(pb_id: str, user: dict = Depends(get_current_user)):
    if not journal_playbooks.delete_playbook(user["id"], pb_id):
        raise HTTPException(status_code=404, detail="Playbook not found")
    return {"ok": True}


@router.get("/api/journal/playbooks/{pb_id}/trades")
def playbook_trades(pb_id: str, user: dict = Depends(get_current_user)):
    return journal_playbooks.get_playbook_trades(user["id"], pb_id)


# ── Resources ─────────────────────────────────────────────────────────────────

class ResourceCreate(BaseModel):
    category: str  # checklist, rule, template, psychology, plan
    title: str
    content: Optional[str] = ""
    sort_order: Optional[int] = 0
    is_pinned: Optional[int] = 0


@router.get("/api/journal/resources")
def list_resources(category: Optional[str] = None, user: dict = Depends(get_current_user)):
    return journal_service.list_resources(user["id"], category)


@router.post("/api/journal/resources")
def create_resource(body: ResourceCreate, user: dict = Depends(get_current_user)):
    return journal_service.create_resource(user["id"], body.model_dump())


@router.put("/api/journal/resources/{res_id}")
def update_resource(res_id: str, body: ResourceCreate, user: dict = Depends(get_current_user)):
    result = journal_service.update_resource(user["id"], res_id, body.model_dump())
    if not result:
        raise HTTPException(status_code=404, detail="Resource not found")
    return result


@router.delete("/api/journal/resources/{res_id}")
def delete_resource(res_id: str, user: dict = Depends(get_current_user)):
    if not journal_service.delete_resource(user["id"], res_id):
        raise HTTPException(status_code=404, detail="Resource not found")
    return {"ok": True}
```

- [ ] **Step 3: Add resource CRUD to journal_service.py**

Simple CRUD following the same pattern as daily journals — `list_resources(user_id, category)`, `create_resource(user_id, data)`, `update_resource(user_id, res_id, data)`, `delete_resource(user_id, res_id)`. All operate on the `journal_resources` table (created in Phase 1 migration).

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_playbooks.py api/services/journal_service.py api/routers/journal.py
git commit -m "feat(journal): add playbook + resource CRUD — service, router, denormalized stats"
```

---

## Task 21: Playbooks Tab UI

**Files:**
- Create: `app/src/pages/journal/tabs/Playbooks.jsx`
- Create: `app/src/pages/journal/tabs/Playbooks.module.css`

- [ ] **Step 1: Create Playbooks tab**

Left sidebar list (playbook name + trade count + win rate) with "+ New Playbook" button. Right panel: playbook detail form (all text fields from schema) + linked trades table below + denormalized stats card.

```jsx
// Playbooks.jsx — key structure
export default function Playbooks({ onOpenTrade }) {
  const [selectedId, setSelectedId] = useState(null);

  const { data: playbooks, mutate: mutateList } = useSWR('/api/journal/playbooks', fetcher);
  const { data: detail, mutate: mutateDetail } = useSWR(
    selectedId ? `/api/journal/playbooks/${selectedId}` : null, fetcher
  );
  const { data: trades } = useSWR(
    selectedId ? `/api/journal/playbooks/${selectedId}/trades` : null, fetcher
  );

  // CRUD handlers: create, update (debounced field save), delete
  // Form fields for: description, market_condition, trigger_criteria,
  //   invalidations, entry_model, exit_model, sizing_rules,
  //   common_mistakes, best_practices, ideal_time, ideal_volatility

  return (
    <div className={styles.playbookLayout}>
      <div className={styles.playbookSidebar}>
        <button className={styles.newBtn} onClick={handleCreate}>+ New Playbook</button>
        {playbooks?.map(pb => (
          <div key={pb.id}
            className={`${styles.pbItem} ${pb.id === selectedId ? styles.pbItemActive : ''}`}
            onClick={() => setSelectedId(pb.id)}>
            <div className={styles.pbName}>{pb.name}</div>
            <div className={styles.pbMeta}>
              {pb.trade_count} trades · {pb.win_rate ?? '—'}% WR
            </div>
          </div>
        ))}
      </div>
      <div className={styles.playbookDetail}>
        {detail ? (
          <>
            {/* Editable form fields */}
            {/* Stats card */}
            {/* Linked trades table */}
          </>
        ) : (
          <div className={styles.emptyDetail}>Select or create a playbook</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create Playbooks.module.css**

Key classes: `.playbookLayout` (flex row), `.playbookSidebar` (240px, overflow-y auto), `.pbItem` / `.pbItemActive`, `.playbookDetail` (flex 1, overflow-y auto, padding 20px), `.pbField` (label 9px IBM Plex Mono uppercase, textarea/input full width), `.statsCard` (flex row, 4 mini stat boxes: trades, win rate, avg R, best/worst), `.linkedTable` (compact, clickable rows). Mobile: sidebar becomes a select dropdown.

- [ ] **Step 3: Wire into JournalPage**

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/journal/tabs/Playbooks.jsx app/src/pages/journal/tabs/Playbooks.module.css app/src/pages/journal/JournalPage.jsx
git commit -m "feat(journal): add Playbooks tab — sidebar list, detail form, linked trades, stats card"
```

---

## Task 22: Monthly Review Extension

**Files:**
- Modify: `api/services/journal_service.py`
- Modify: `api/routers/journal.py`

- [ ] **Step 1: Add monthly review functions to journal_service.py**

Reuse the `weekly_reviews` table with a `type` column distinguishing weekly vs monthly. Add migration for the `type` column if not present.

```python
def get_or_create_monthly_review(user_id: str, month: str) -> dict:
    """Get monthly review for YYYY-MM, auto-creating and populating metrics."""
    conn = get_connection()
    try:
        # Check for existing (use week_start = YYYY-MM-01 for monthly)
        month_start = f"{month}-01"
        row = conn.execute(
            "SELECT * FROM weekly_reviews WHERE user_id = ? AND week_start = ?",
            (user_id, month_start),
        ).fetchone()
        if row:
            return dict(row)

        # Auto-populate from trade data
        trades = conn.execute(
            "SELECT * FROM journal_entries WHERE user_id = ? AND entry_date LIKE ? AND status = 'closed'",
            (user_id, f"{month}%"),
        ).fetchall()
        trades = [dict(r) for r in trades]

        with_pnl = [t for t in trades if t.get("pnl_pct") is not None]
        wins = [t for t in with_pnl if t["pnl_pct"] > 0]
        losses = [t for t in with_pnl if t["pnl_pct"] <= 0]
        net_pnl = sum(t["pnl_pct"] for t in with_pnl) if with_pnl else 0
        with_ps = [t for t in trades if t.get("process_score") is not None]
        avg_ps = sum(t["process_score"] for t in with_ps) / len(with_ps) if with_ps else None

        best = max(with_pnl, key=lambda t: t["pnl_pct"]) if with_pnl else None
        worst = min(with_pnl, key=lambda t: t["pnl_pct"]) if with_pnl else None

        review_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO weekly_reviews
               (id, user_id, week_start, wins, losses, net_pnl_pct, avg_process_score,
                best_trade_id, worst_trade_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (review_id, user_id, month_start, len(wins), len(losses),
             round(net_pnl, 2), round(avg_ps, 1) if avg_ps else None,
             best["id"] if best else None, worst["id"] if worst else None,
             now, now),
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM weekly_reviews WHERE id = ?", (review_id,)).fetchone())
    finally:
        conn.close()
```

- [ ] **Step 2: Add monthly review endpoint**

```python
@router.get("/api/journal/monthly/{month}")
def get_monthly_review(month: str, user: dict = Depends(get_current_user)):
    """Get monthly review for YYYY-MM format."""
    return journal_service.get_or_create_monthly_review(user["id"], month)

@router.put("/api/journal/monthly/{month}")
def update_monthly_review(month: str, body: dict, user: dict = Depends(get_current_user)):
    return journal_service.update_weekly_review(user["id"], f"{month}-01", body)
```

- [ ] **Step 3: Commit**

```bash
git add api/services/journal_service.py api/routers/journal.py
git commit -m "feat(journal): add monthly review — auto-populated metrics, reuses weekly_reviews table"
```

---

## Phase 7: Insights + Resources + Polish

---

## Task 23: Insights Engine

**Files:**
- Modify: `api/services/journal_service.py`
- Modify: `api/routers/journal.py`

- [ ] **Step 1: Add insights engine to journal_service.py**

8 pattern-derived coaching statements, all computed from trade data (no AI).

```python
def get_insights(user_id: str) -> list[dict]:
    """Generate up to 8 pattern-derived coaching statements."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM journal_entries WHERE user_id = ? AND status = 'closed' ORDER BY entry_date",
            (user_id,),
        ).fetchall()
        entries = [dict(r) for r in rows]

        if len(entries) < 5:
            return []  # Not enough data for insights

        insights = []

        # 1. Time-of-day win rates
        _insight_time_of_day(entries, insights)
        # 2. Setup comparison
        _insight_setup_comparison(entries, insights)
        # 3. Mistake correlation
        _insight_mistake_correlation(entries, insights)
        # 4. Position size clustering
        _insight_size_clustering(entries, insights)
        # 5. Trades-per-day analysis
        _insight_daily_count(entries, insights)
        # 6. Day-of-week analysis
        _insight_day_of_week(entries, insights)
        # 7. Playbook vs unlinked
        _insight_playbook_performance(entries, insights)
        # 8. Streak detection
        _insight_streaks(entries, insights)

        return sorted(insights, key=lambda x: x["priority"])[:8]
    finally:
        conn.close()


def _insight_time_of_day(entries, insights):
    """Compare win rate by session buckets."""
    buckets = {}
    for e in entries:
        t = e.get("entry_time") or ""
        if not t:
            continue
        hour = int(t.split(":")[0]) if ":" in t else None
        if hour is None:
            continue
        if hour < 9 or (hour == 9 and int(t.split(":")[1]) < 30):
            key = "Pre-market"
        elif hour < 11:
            key = "First 90min"
        elif hour < 14:
            key = "Midday"
        elif hour < 16:
            key = "Power hour"
        else:
            key = "After hours"
        if key not in buckets:
            buckets[key] = {"wins": 0, "total": 0}
        buckets[key]["total"] += 1
        if e.get("pnl_pct") and e["pnl_pct"] > 0:
            buckets[key]["wins"] += 1

    if len(buckets) < 2:
        return

    rates = {k: v["wins"] / v["total"] * 100 for k, v in buckets.items() if v["total"] >= 3}
    if len(rates) < 2:
        return

    best = max(rates, key=rates.get)
    worst = min(rates, key=rates.get)
    if rates[best] - rates[worst] >= 15:
        insights.append({
            "id": "time_of_day",
            "statement": f"Your win rate is {rates[best]:.0f}% during {best} vs {rates[worst]:.0f}% during {worst}.",
            "evidence": f"Based on {sum(v['total'] for v in buckets.values())} trades with timestamps.",
            "action_type": "filter",
            "action_label": f"View {best} trades",
            "priority": 2,
        })


def _insight_setup_comparison(entries, insights):
    """Find best and worst setups by expectancy."""
    setups = {}
    for e in entries:
        s = e.get("setup") or "Unknown"
        if s not in setups:
            setups[s] = []
        if e.get("pnl_pct") is not None:
            setups[s].append(e["pnl_pct"])

    qualified = {k: v for k, v in setups.items() if len(v) >= 3}
    if len(qualified) < 2:
        return

    avgs = {k: sum(v) / len(v) for k, v in qualified.items()}
    best = max(avgs, key=avgs.get)
    worst = min(avgs, key=avgs.get)
    if avgs[best] - avgs[worst] >= 1:
        insights.append({
            "id": "setup_comparison",
            "statement": f"{best} averages +{avgs[best]:.1f}% per trade vs {worst} at {avgs[worst]:+.1f}%.",
            "evidence": f"{len(qualified[best])} {best} trades, {len(qualified[worst])} {worst} trades.",
            "action_type": "analytics",
            "action_label": "View by setup",
            "priority": 1,
        })


def _insight_mistake_correlation(entries, insights):
    """Compare P&L on trades with vs without mistakes."""
    with_mistakes = [e for e in entries if e.get("mistake_tags") and e.get("pnl_pct") is not None]
    without = [e for e in entries if not e.get("mistake_tags") and e.get("pnl_pct") is not None]

    if len(with_mistakes) < 3 or len(without) < 3:
        return

    avg_with = sum(e["pnl_pct"] for e in with_mistakes) / len(with_mistakes)
    avg_without = sum(e["pnl_pct"] for e in without) / len(without)

    if avg_without - avg_with >= 0.5:
        insights.append({
            "id": "mistake_correlation",
            "statement": f"Trades with mistakes average {avg_with:+.1f}% vs {avg_without:+.1f}% without.",
            "evidence": f"{len(with_mistakes)} trades had mistakes tagged, {len(without)} did not.",
            "action_type": "analytics",
            "action_label": "View by mistake",
            "priority": 3,
        })


def _insight_size_clustering(entries, insights):
    """Detect if larger positions lose more often."""
    sized = [e for e in entries if e.get("size_pct") and e.get("pnl_pct") is not None]
    if len(sized) < 10:
        return

    sorted_by_size = sorted(sized, key=lambda e: e["size_pct"])
    mid = len(sorted_by_size) // 2
    small = sorted_by_size[:mid]
    large = sorted_by_size[mid:]

    small_wr = sum(1 for e in small if e["pnl_pct"] > 0) / len(small) * 100
    large_wr = sum(1 for e in large if e["pnl_pct"] > 0) / len(large) * 100

    if abs(small_wr - large_wr) >= 15:
        better = "smaller" if small_wr > large_wr else "larger"
        insights.append({
            "id": "size_clustering",
            "statement": f"You perform better on {better} positions ({max(small_wr, large_wr):.0f}% vs {min(small_wr, large_wr):.0f}% WR).",
            "evidence": f"Compared top vs bottom half of positions by size.",
            "action_type": "review",
            "action_label": "Review sizing",
            "priority": 4,
        })


def _insight_daily_count(entries, insights):
    """Compare performance by # trades per day."""
    by_date = {}
    for e in entries:
        d = e.get("entry_date")
        if d:
            by_date.setdefault(d, []).append(e)

    low_days = [d for d, ts in by_date.items() if len(ts) <= 2]
    high_days = [d for d, ts in by_date.items() if len(ts) >= 4]

    if len(low_days) < 3 or len(high_days) < 3:
        return

    low_pnl = sum(e.get("pnl_pct", 0) for d in low_days for e in by_date[d] if e.get("pnl_pct")) / max(sum(len(by_date[d]) for d in low_days), 1)
    high_pnl = sum(e.get("pnl_pct", 0) for d in high_days for e in by_date[d] if e.get("pnl_pct")) / max(sum(len(by_date[d]) for d in high_days), 1)

    if abs(low_pnl - high_pnl) >= 0.5:
        better = "1-2 trade" if low_pnl > high_pnl else "4+ trade"
        insights.append({
            "id": "daily_count",
            "statement": f"You average {max(low_pnl, high_pnl):+.1f}% per trade on {better} days vs {min(low_pnl, high_pnl):+.1f}% on others.",
            "evidence": f"{len(low_days)} low-activity days, {len(high_days)} high-activity days.",
            "action_type": "review",
            "action_label": "Review overtrading",
            "priority": 3,
        })


def _insight_day_of_week(entries, insights):
    """Best and worst day of week."""
    by_dow = {}
    for e in entries:
        dow = e.get("day_of_week")
        if dow and e.get("pnl_pct") is not None:
            by_dow.setdefault(dow, []).append(e["pnl_pct"])

    qualified = {k: v for k, v in by_dow.items() if len(v) >= 3}
    if len(qualified) < 3:
        return

    avgs = {k: sum(v) / len(v) for k, v in qualified.items()}
    best = max(avgs, key=avgs.get)
    worst = min(avgs, key=avgs.get)
    if avgs[best] - avgs[worst] >= 1:
        insights.append({
            "id": "day_of_week",
            "statement": f"{best}s average {avgs[best]:+.1f}% while {worst}s average {avgs[worst]:+.1f}%.",
            "evidence": f"Across {sum(len(v) for v in qualified.values())} trades with day data.",
            "action_type": "analytics",
            "action_label": "View by day",
            "priority": 5,
        })


def _insight_playbook_performance(entries, insights):
    """Compare playbook-linked vs unlinked trades."""
    linked = [e for e in entries if e.get("playbook_id") and e.get("pnl_pct") is not None]
    unlinked = [e for e in entries if not e.get("playbook_id") and e.get("pnl_pct") is not None]

    if len(linked) < 3 or len(unlinked) < 3:
        return

    avg_linked = sum(e["pnl_pct"] for e in linked) / len(linked)
    avg_unlinked = sum(e["pnl_pct"] for e in unlinked) / len(unlinked)

    if abs(avg_linked - avg_unlinked) >= 0.5:
        better = "playbook" if avg_linked > avg_unlinked else "non-playbook"
        insights.append({
            "id": "playbook_performance",
            "statement": f"Playbook trades average {avg_linked:+.1f}% vs {avg_unlinked:+.1f}% without.",
            "evidence": f"{len(linked)} playbook-linked, {len(unlinked)} unlinked.",
            "action_type": "playbooks",
            "action_label": "View playbooks",
            "priority": 4,
        })


def _insight_streaks(entries, insights):
    """Detect significant losing or winning streaks."""
    with_pnl = [e for e in entries if e.get("pnl_pct") is not None]
    if len(with_pnl) < 10:
        return

    max_lose = 0
    current_lose = 0
    for e in with_pnl:
        if e["pnl_pct"] <= 0:
            current_lose += 1
            max_lose = max(max_lose, current_lose)
        else:
            current_lose = 0

    if max_lose >= 5:
        insights.append({
            "id": "losing_streak",
            "statement": f"Your longest losing streak was {max_lose} trades in a row.",
            "evidence": "Consider reducing size after 3 consecutive losses.",
            "action_type": "review",
            "action_label": "Review streak",
            "priority": 2,
        })
```

- [ ] **Step 2: Add insights endpoint**

```python
@router.get("/api/journal/insights")
def journal_insights(user: dict = Depends(get_current_user)):
    return journal_service.get_insights(user["id"])
```

- [ ] **Step 3: Commit**

```bash
git add api/services/journal_service.py api/routers/journal.py
git commit -m "feat(journal): add insights engine — 8 pattern-derived coaching statements from trade data"
```

---

## Task 24: InsightCard + Resources UI

**Files:**
- Create: `app/src/pages/journal/components/InsightCard.jsx`
- Create: `app/src/pages/journal/components/ResourceEditor.jsx`

- [ ] **Step 1: Create InsightCard component**

```jsx
// InsightCard.jsx
import styles from '../tabs/Overview.module.css';

export default function InsightCard({ insight, onAction }) {
  return (
    <div className={styles.insightCard}>
      <div className={styles.insightStatement}>{insight.statement}</div>
      <div className={styles.insightEvidence}>{insight.evidence}</div>
      {insight.action_label && (
        <button className={styles.insightAction} onClick={() => onAction(insight)}>
          {insight.action_label} →
        </button>
      )}
    </div>
  );
}
```

CSS: `.insightCard` (bg var(--bg-surface), border-left 3px gold, padding 12px 16px, margin-bottom 8px), `.insightStatement` (13px, color var(--color-text)), `.insightEvidence` (11px, color var(--color-text-muted)), `.insightAction` (gold text 11px, no bg, hover underline).

- [ ] **Step 2: Wire insights into Overview tab**

Add `useSWR('/api/journal/insights')` to Overview.jsx and render up to 3 InsightCards at the bottom of the page.

- [ ] **Step 3: Create ResourceEditor component**

Categorized list with create/edit/delete. Categories: checklist, rule, template, psychology, plan. Each resource has title + content (editable textarea).

```jsx
// ResourceEditor.jsx — key structure
const CATEGORIES = [
  { key: 'checklist', label: 'Checklists', icon: '☑' },
  { key: 'rule', label: 'Rules', icon: '§' },
  { key: 'template', label: 'Templates', icon: '⊞' },
  { key: 'psychology', label: 'Psychology', icon: '◉' },
  { key: 'plan', label: 'Plans', icon: '▸' },
];

export default function ResourceEditor() {
  const [category, setCategory] = useState('checklist');
  const { data: resources, mutate } = useSWR(
    `/api/journal/resources?category=${category}`, fetcher
  );
  // CRUD: create, inline edit (title + content), delete
  // Each resource is a card with edit/delete icons on hover
}
```

- [ ] **Step 4: Add Resources section to Playbooks tab (or as sub-tab)**

Resources can live as a section below the playbook detail, or as a second panel within the Playbooks tab. The simplest approach: add a toggle at the top of the Playbooks tab — "Playbooks | Resources" — and swap the content.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal/components/InsightCard.jsx app/src/pages/journal/components/ResourceEditor.jsx app/src/pages/journal/tabs/Overview.jsx app/src/pages/journal/tabs/Playbooks.jsx
git commit -m "feat(journal): add InsightCard + ResourceEditor — insights on Overview, resources in Playbooks"
```

---

## Task 25: Guided Flow Prompts + Mobile Polish

**Files:**
- Modify: various journal tab/component CSS files
- Modify: `app/src/pages/journal/JournalPage.jsx`

- [ ] **Step 1: Add guided flow prompts**

In the TradeDrawer completion sidebar (ReviewProgress.jsx), add a single-cycle pulse animation on incomplete items when drawer first opens:

```css
@keyframes gentlePulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.dotIncomplete {
  animation: gentlePulse 1.5s ease-in-out 1;
}
```

In DailyNotes DailyReviewForm, add time-appropriate section highlighting:

```css
.sectionHighlight {
  border-left: 2px solid var(--gold);
}
```

In Overview tab, add "N items need review" banner (already done in Task 16).

- [ ] **Step 2: Mobile responsive polish for all journal tabs**

Add `@media (max-width: 640px)` breakpoints to all journal CSS modules:

- **DailyNotes**: date sidebar becomes horizontal scrollable strip at top (40px height, flex-shrink 0)
- **CalendarReview**: cells shrink to minimum, hide win rate bar, show only P&L number and single dot
- **Overview**: KPI grid collapses to 2x3
- **ReviewQueue**: full width, stack badge + sym + date vertically
- **Analytics**: table becomes horizontally scrollable, dim chips wrap
- **Playbooks**: sidebar becomes select dropdown on mobile
- **JournalPage tab bar**: horizontally scrollable on mobile with `overflow-x: auto; white-space: nowrap`

- [ ] **Step 3: Performance optimization**

If the trade log has >100 rows, virtualize the table body using `react-window` (already available in node_modules from other pages, or add it):

```jsx
// In TradeLog.jsx, wrap table body with FixedSizeList when trade count > 100
import { FixedSizeList } from 'react-window';

// Only activate virtualization for large datasets
{trades.length > 100 ? (
  <FixedSizeList height={600} itemCount={trades.length} itemSize={36}>
    {({ index, style }) => <TradeRow trade={trades[index]} style={style} />}
  </FixedSizeList>
) : (
  <tbody>{trades.map(t => <TradeRow key={t.id} trade={t} />)}</tbody>
)}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(journal): guided flow prompts, mobile responsive polish, virtualized table for large datasets"
```

---

## Phase 8: Import / Data Quality Center

---

## Task 26: CSV Import Backend

**Files:**
- Create: `api/services/journal_import.py`
- Modify: `api/routers/journal.py`

- [ ] **Step 1: Create import service**

```python
"""
CSV import service — parse broker exports, map fields, detect duplicates, create trades.
"""

import csv
import io
import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.journal_service import create_entry


# Known broker column mappings
BROKER_PROFILES = {
    "td_ameritrade": {
        "sym": ["Symbol", "Sym"],
        "direction": ["Side", "Buy/Sell"],
        "entry_price": ["Price", "Exec Price", "Fill Price"],
        "shares": ["Qty", "Quantity", "Shares"],
        "entry_date": ["Date", "Trade Date", "Exec Date"],
        "entry_time": ["Time", "Exec Time"],
        "fees": ["Commission", "Comm", "Fees"],
    },
    "interactive_brokers": {
        "sym": ["Symbol", "Underlying"],
        "direction": ["Buy/Sell", "Side"],
        "entry_price": ["T. Price", "Price", "Trade Price"],
        "shares": ["Quantity", "Qty"],
        "entry_date": ["Date/Time", "TradeDate"],
        "fees": ["Comm/Fee", "IBCommission"],
    },
    "schwab": {
        "sym": ["Symbol"],
        "direction": ["Action"],
        "entry_price": ["Price"],
        "shares": ["Quantity"],
        "entry_date": ["Date"],
        "fees": ["Fees & Comm"],
    },
    "tradestation": {
        "sym": ["Symbol"],
        "direction": ["Type"],
        "entry_price": ["Price"],
        "shares": ["Qty"],
        "entry_date": ["Date"],
        "entry_time": ["Time"],
        "fees": ["Commission"],
    },
}


def detect_broker(headers: list[str]) -> str | None:
    """Attempt to auto-detect broker from CSV headers."""
    header_set = {h.strip().lower() for h in headers}
    for broker, mapping in BROKER_PROFILES.items():
        matches = 0
        for field, candidates in mapping.items():
            if any(c.lower() in header_set for c in candidates):
                matches += 1
        if matches >= 3:
            return broker
    return None


def parse_csv(content: str, field_mapping: dict) -> tuple[list[dict], list[str]]:
    """Parse CSV content using the provided field mapping.
    Returns (parsed_rows, warnings).
    field_mapping: {"sym": "Symbol", "entry_price": "Price", ...}
    """
    reader = csv.DictReader(io.StringIO(content))
    rows = []
    warnings = []

    for i, csv_row in enumerate(reader, 1):
        trade = {}
        for target_field, source_col in field_mapping.items():
            val = csv_row.get(source_col, "").strip()
            if val:
                trade[target_field] = val

        # Normalize
        if not trade.get("sym"):
            warnings.append(f"Row {i}: missing symbol, skipped")
            continue

        trade["sym"] = trade["sym"].upper().replace(" ", "")

        # Parse price
        for price_field in ("entry_price", "exit_price", "stop_price", "fees"):
            if trade.get(price_field):
                try:
                    trade[price_field] = float(trade[price_field].replace("$", "").replace(",", ""))
                except ValueError:
                    warnings.append(f"Row {i}: invalid {price_field} '{trade[price_field]}'")
                    trade[price_field] = None

        # Parse shares
        if trade.get("shares"):
            try:
                trade["shares"] = abs(float(trade["shares"].replace(",", "")))
            except ValueError:
                warnings.append(f"Row {i}: invalid shares")
                trade["shares"] = None

        # Normalize direction
        direction = (trade.get("direction") or "").lower()
        if direction in ("buy", "long", "bot", "bought"):
            trade["direction"] = "long"
        elif direction in ("sell", "short", "sld", "sold"):
            trade["direction"] = "short"
        else:
            trade["direction"] = "long"

        # Parse date
        if trade.get("entry_date"):
            trade["entry_date"] = _normalize_date(trade["entry_date"])

        trade["review_status"] = "draft"  # Imported trades start as draft
        rows.append(trade)

    return rows, warnings


def _normalize_date(date_str: str) -> str:
    """Try common date formats and return YYYY-MM-DD."""
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d-%b-%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(date_str.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return date_str[:10]


def find_duplicates(user_id: str, rows: list[dict], tolerance: float = 0.01) -> list[int]:
    """Return indices of rows that are likely duplicates of existing trades."""
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT sym, entry_date, entry_price FROM journal_entries WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        existing_set = {
            (r["sym"], r["entry_date"], r["entry_price"])
            for r in existing if r["entry_price"]
        }

        dupes = []
        for i, row in enumerate(rows):
            sym = row.get("sym")
            date = row.get("entry_date")
            price = row.get("entry_price")
            if not all([sym, date, price]):
                continue
            for e_sym, e_date, e_price in existing_set:
                if (sym == e_sym and date == e_date
                    and abs(price - e_price) / e_price <= tolerance):
                    dupes.append(i)
                    break

        return dupes
    finally:
        conn.close()


def import_trades(user_id: str, rows: list[dict], skip_indices: set = None) -> dict:
    """Create journal entries from parsed rows. Returns import summary."""
    skip_indices = skip_indices or set()
    created = 0
    skipped = 0

    for i, row in enumerate(rows):
        if i in skip_indices:
            skipped += 1
            continue
        try:
            create_entry(user_id, row)
            created += 1
        except Exception:
            skipped += 1

    # Record import session
    conn = get_connection()
    try:
        session_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO journal_resources (id, user_id, category, title, content, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?)""",
            (session_id, user_id, "import_session",
             f"Import {now[:10]}", f"Created: {created}, Skipped: {skipped}",
             now, now),
        )
        conn.commit()
    finally:
        conn.close()

    return {"created": created, "skipped": skipped, "total": len(rows)}
```

- [ ] **Step 2: Add import endpoints**

```python
from api.services import journal_import

@router.post("/api/journal/import")
async def import_csv(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Step 1: Upload CSV, auto-detect broker, return preview + field mapping."""
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    headers = reader.fieldnames or []

    broker = journal_import.detect_broker(headers)

    # Auto-map fields if broker detected
    mapping = {}
    if broker:
        profile = journal_import.BROKER_PROFILES[broker]
        for target, candidates in profile.items():
            for c in candidates:
                if c in headers:
                    mapping[target] = c
                    break

    # Parse preview (first 10 rows)
    rows, warnings = journal_import.parse_csv(content, mapping)
    dupes = journal_import.find_duplicates(user["id"], rows)

    return {
        "headers": headers,
        "detected_broker": broker,
        "auto_mapping": mapping,
        "preview_rows": rows[:10],
        "total_rows": len(rows),
        "duplicate_indices": dupes,
        "warnings": warnings[:20],
        # Store content in session for step 2
        "_csv_content": content,
    }


@router.post("/api/journal/import/confirm")
async def confirm_import(
    body: dict,
    user: dict = Depends(get_current_user),
):
    """Step 2: Confirm import with final field mapping."""
    content = body.get("csv_content", "")
    mapping = body.get("field_mapping", {})
    skip_dupes = body.get("skip_duplicates", True)

    rows, warnings = journal_import.parse_csv(content, mapping)
    skip_indices = set()
    if skip_dupes:
        skip_indices = set(journal_import.find_duplicates(user["id"], rows))

    result = journal_import.import_trades(user["id"], rows, skip_indices)
    result["warnings"] = warnings
    return result


@router.get("/api/journal/import/history")
def import_history(user: dict = Depends(get_current_user)):
    """List previous import sessions."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM journal_resources WHERE user_id = ? AND category = 'import_session' ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
```

- [ ] **Step 3: Commit**

```bash
git add api/services/journal_import.py api/routers/journal.py
git commit -m "feat(journal): add CSV import — broker detection, field mapping, duplicate detection, import history"
```

---

## Task 27: Import Wizard UI

**Files:**
- Create: `app/src/pages/journal/components/ImportWizard.jsx`
- Create: `app/src/pages/journal/components/ImportWizard.module.css`

- [ ] **Step 1: Create ImportWizard component**

3-step wizard: Upload → Map Fields → Review & Import.

```jsx
// ImportWizard.jsx — key structure
export default function ImportWizard({ onClose, onComplete }) {
  const [step, setStep] = useState(1); // 1=upload, 2=map, 3=review
  const [csvContent, setCsvContent] = useState('');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);

  const TARGET_FIELDS = [
    { key: 'sym', label: 'Symbol', required: true },
    { key: 'direction', label: 'Direction' },
    { key: 'entry_price', label: 'Entry Price' },
    { key: 'exit_price', label: 'Exit Price' },
    { key: 'shares', label: 'Shares' },
    { key: 'entry_date', label: 'Date', required: true },
    { key: 'entry_time', label: 'Time' },
    { key: 'fees', label: 'Fees' },
    { key: 'stop_price', label: 'Stop' },
    { key: 'notes', label: 'Notes' },
  ];

  // Step 1: file upload via <input type="file" accept=".csv">
  // Read file, POST to /api/journal/import, get preview back

  // Step 2: field mapping interface
  // Left column: target fields. Right: dropdown of CSV headers + "skip"
  // Auto-populated from preview.auto_mapping

  // Step 3: review — show preview rows in table, highlight duplicates in amber,
  // warnings panel below, "Import N trades (skip M duplicates)" button

  // On confirm: POST /api/journal/import/confirm with csv_content + mapping
}
```

- [ ] **Step 2: Create ImportWizard.module.css**

Key classes: `.wizard` (max-width 700px, margin auto, bg var(--bg-elevated), border-radius 8px, padding 24px), `.stepBar` (3 numbered steps with connecting line), `.mapRow` (flex, target label on left, select dropdown on right), `.previewTable` (compact, max-height 300px overflow-y), `.dupeRow` (amber bg), `.warningPanel` (amber left border, 11px text), `.importBtn` (gold bg, white text, disabled when importing).

- [ ] **Step 3: Add import trigger to TradeLog tab**

In `TradeLog.jsx`, add an "Import CSV" button next to the existing "+ New Trade" button. Clicking opens ImportWizard as a modal overlay.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/journal/components/ImportWizard.jsx app/src/pages/journal/components/ImportWizard.module.css app/src/pages/journal/tabs/TradeLog.jsx
git commit -m "feat(journal): add ImportWizard UI — 3-step wizard with field mapping, dupe detection, preview"
```

---

## Phase 9: AI Trade Summaries

---

## Task 28: AI Summary Backend

**Files:**
- Create: `api/services/journal_ai.py`
- Modify: `api/services/auth_db.py` (add `ai_summary` column migration)
- Modify: `api/routers/journal.py`

- [ ] **Step 1: Add ai_summary column migration**

In `_migrate_journal_v2` in `auth_db.py`, add:

```python
("journal_entries", "ai_summary", "TEXT"),
```

This is idempotent — the try/except pattern handles existing columns.

- [ ] **Step 2: Create AI summary service**

```python
"""
Journal AI — trade summaries and weekly digests via Claude Haiku.
Uses existing ANTHROPIC_API_KEY. Cost: ~$0.001 per summary.
"""

import os
import json
from datetime import datetime, timezone

import anthropic

from api.services.auth_db import get_connection
from api.services.journal_service import get_entry, get_stats

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    return _client


def generate_trade_summary(user_id: str, trade_id: str, force: bool = False) -> dict:
    """Generate AI summary for a single trade. Returns {summary, cached}."""
    entry = get_entry(user_id, trade_id)
    if not entry:
        return {"error": "Trade not found"}

    # Return cached unless force regenerate
    if entry.get("ai_summary") and not force:
        return {"summary": entry["ai_summary"], "cached": True}

    # Build prompt context
    direction = entry.get("direction", "long")
    pnl = entry.get("pnl_pct")
    r_mult = entry.get("realized_r")
    setup = entry.get("setup") or "Unknown"
    thesis = entry.get("thesis") or "Not provided"
    lesson = entry.get("lesson") or ""
    mistakes = entry.get("mistake_tags") or "None"
    process_score = entry.get("process_score")
    notes = entry.get("notes") or ""

    prompt = f"""Analyze this trade and provide:
1. A 2-3 sentence recap of what happened
2. One key takeaway
3. One specific improvement suggestion

Trade details:
- Symbol: {entry.get('sym')} ({direction})
- Setup: {setup}
- Entry: ${entry.get('entry_price')} → Exit: ${entry.get('exit_price') or 'still open'}
- P&L: {f'{pnl:+.1f}%' if pnl is not None else 'N/A'} | R-Multiple: {r_mult or 'N/A'}
- Process Score: {process_score or 'Not scored'}/100
- Thesis: {thesis[:500]}
- Mistakes: {mistakes}
- Notes: {notes[:500]}
- Lesson: {lesson[:300]}

Be direct and specific. No generic advice. Reference the actual trade data."""

    try:
        client = _get_client()
        response = client.messages.create(
            model="claude-haiku-4-20250414",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        summary = response.content[0].text

        # Cache in DB
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE journal_entries SET ai_summary = ? WHERE id = ? AND user_id = ?",
                (summary, trade_id, user_id),
            )
            conn.commit()
        finally:
            conn.close()

        return {"summary": summary, "cached": False}

    except Exception as e:
        return {"error": str(e)}


def generate_weekly_digest(user_id: str, week_start: str) -> dict:
    """Generate AI weekly digest. week_start is YYYY-MM-DD (Monday)."""
    conn = get_connection()
    try:
        # Get week's trades
        from datetime import timedelta
        start_dt = datetime.strptime(week_start, "%Y-%m-%d")
        end_dt = start_dt + timedelta(days=6)
        end_str = end_dt.strftime("%Y-%m-%d")

        rows = conn.execute(
            """SELECT sym, direction, setup, pnl_pct, realized_r, process_score, mistake_tags
               FROM journal_entries
               WHERE user_id = ? AND status = 'closed'
               AND entry_date >= ? AND entry_date <= ?
               ORDER BY entry_date""",
            (user_id, week_start, end_str),
        ).fetchall()
        trades = [dict(r) for r in rows]

        if not trades:
            return {"digest": "No closed trades this week.", "trade_count": 0}

        # Build summary data
        wins = [t for t in trades if t.get("pnl_pct") and t["pnl_pct"] > 0]
        losses = [t for t in trades if t.get("pnl_pct") and t["pnl_pct"] <= 0]
        total_pnl = sum(t.get("pnl_pct", 0) for t in trades)
        all_mistakes = []
        for t in trades:
            if t.get("mistake_tags"):
                all_mistakes.extend(t["mistake_tags"].split(","))

        # Format trade list for prompt
        trade_lines = []
        for t in trades:
            trade_lines.append(
                f"  {t['sym']} {t['direction']} ({t.get('setup','?')}): "
                f"{t.get('pnl_pct',0):+.1f}% | R={t.get('realized_r','?')} | "
                f"Process={t.get('process_score','?')}"
            )

        prompt = f"""Analyze this trader's week and provide:
1. Top 3 patterns you notice (what's working, what isn't)
2. The single biggest lesson from this week
3. One specific focus area for next week

Week: {week_start} to {end_str}
Record: {len(wins)}W / {len(losses)}L | Net P&L: {total_pnl:+.1f}%
Most common mistakes: {', '.join(set(all_mistakes)) if all_mistakes else 'None tagged'}

Trades:
{chr(10).join(trade_lines)}

Be specific to THIS data. No generic trading advice."""

        client = _get_client()
        response = client.messages.create(
            model="claude-haiku-4-20250414",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )

        return {
            "digest": response.content[0].text,
            "trade_count": len(trades),
            "week": week_start,
        }

    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()
```

- [ ] **Step 3: Add AI endpoints to router**

```python
from api.services import journal_ai

@router.post("/api/journal/{trade_id}/ai-summary")
def generate_ai_summary(
    trade_id: str,
    force: bool = False,
    user: dict = Depends(get_current_user),
):
    """Generate AI summary for a trade. User-triggered only."""
    return journal_ai.generate_trade_summary(user["id"], trade_id, force=force)


@router.get("/api/journal/ai-digest")
def get_ai_digest(
    week: str = Query(..., description="Week start date YYYY-MM-DD"),
    user: dict = Depends(get_current_user),
):
    """Generate weekly AI digest."""
    return journal_ai.generate_weekly_digest(user["id"], week)
```

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_ai.py api/services/auth_db.py api/routers/journal.py
git commit -m "feat(journal): add AI summaries — Claude Haiku trade recap + weekly digest, cached in DB"
```

---

## Task 29: AI Summary UI

**Files:**
- Create: `app/src/pages/journal/components/AISummary.jsx`
- Modify: `app/src/pages/journal/TradeDrawer.jsx` (add to Summary tab)

- [ ] **Step 1: Create AISummary component**

```jsx
// AISummary.jsx
import { useState, useCallback } from 'react';
import styles from './AISummary.module.css';

export default function AISummary({ tradeId, existingSummary }) {
  const [summary, setSummary] = useState(existingSummary || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal/${tradeId}/ai-summary${force ? '?force=true' : ''}`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSummary(data.summary);
      }
    } catch (e) {
      setError('Failed to generate summary');
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  return (
    <div className={styles.aiSection}>
      <div className={styles.aiHeader}>
        <span className={styles.aiLabel}>AI SUMMARY</span>
        {summary && (
          <button className={styles.regenBtn} onClick={() => generate(true)} disabled={loading}>
            Regenerate
          </button>
        )}
      </div>
      {summary ? (
        <div className={styles.aiContent}>{summary}</div>
      ) : (
        <button className={styles.generateBtn} onClick={() => generate()} disabled={loading}>
          {loading ? 'Generating...' : 'Generate Summary'}
        </button>
      )}
      {error && <div className={styles.aiError}>{error}</div>}
    </div>
  );
}
```

CSS: `.aiSection` (border-top 1px var(--border), padding-top 16px, margin-top 16px), `.aiLabel` (9px IBM Plex Mono uppercase gold), `.aiContent` (13px Instrument Sans, line-height 1.6, whitespace pre-wrap), `.generateBtn` (gold border, gold text, bg transparent, hover bg gold/10), `.regenBtn` (muted small text, hover gold), `.aiError` (red 11px).

- [ ] **Step 2: Add AISummary to TradeDrawer Summary tab**

In `TradeDrawer.jsx`, within the Summary tab section (after the StockChart and key metrics), add:

```jsx
<AISummary tradeId={trade.id} existingSummary={trade.ai_summary} />
```

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/journal/components/AISummary.jsx app/src/pages/journal/components/AISummary.module.css app/src/pages/journal/TradeDrawer.jsx
git commit -m "feat(journal): add AI summary UI — generate/regenerate button in trade drawer Summary tab"
```

---

## Task 30: Integration Testing + Final Polish

- [ ] **Step 1: Test Daily Notes flow**

1. Navigate to Daily Notes tab
2. Click today's date in sidebar (or verify it auto-selects)
3. Fill pre-market thesis + focus list
4. Verify dot changes from gray to amber
5. Fill EOD recap + learned
6. Verify dot changes to green (review_complete = true)
7. Verify linked trades appear below form

- [ ] **Step 2: Test Calendar Review**

1. Navigate to Calendar tab
2. Verify current month shows with trade data in cells
3. Click a day with trades — verify detail panel opens
4. Navigate to previous month — verify data loads
5. Verify P&L colors (green/red) and review dots

- [ ] **Step 3: Test Overview**

1. Navigate to Overview tab
2. Verify 6 KPI cards show correct values
3. Switch period (1W → 1M → All) — verify values update
4. Click a review shortcut chip — verify it switches to Trade Log with filter applied
5. Verify review queue banner shows correct count

- [ ] **Step 4: Test Analytics**

1. Navigate to Analytics tab
2. Select "Setup" dimension — verify table shows setup breakdown
3. Switch to "Day of Week" — verify different buckets
4. Verify equity curve chart renders below table
5. Change period — verify data updates

- [ ] **Step 5: Test Playbooks**

1. Navigate to Playbooks tab
2. Create a new playbook (fill name + trigger criteria)
3. Go to a trade → set its playbook_id to the new playbook
4. Return to Playbooks → verify trade count updates
5. Click playbook → verify linked trades table shows the trade

- [ ] **Step 6: Test CSV Import**

1. Create a simple test CSV (sym, date, price, shares columns)
2. Click "Import CSV" in Trade Log
3. Verify broker auto-detection (or manual mapping)
4. Verify preview shows parsed rows
5. Import — verify trades appear in log with "draft" status

- [ ] **Step 7: Test AI Summary**

1. Open a closed trade in the drawer
2. Click "Generate Summary" button
3. Verify AI summary appears
4. Close and reopen — verify summary is cached
5. Click "Regenerate" — verify new summary replaces old

- [ ] **Step 8: Commit all polish fixes**

```bash
git add -A
git commit -m "feat(journal): phases 4-9 complete — daily notes, calendar, overview, analytics, playbooks, import, AI summaries"
```

---

## Summary

| Task | What it builds | Backend/Frontend |
|------|---------------|-----------------|
| 12 | Daily journal CRUD (get_or_create, update, list) | Backend |
| 13 | Daily journal + calendar API endpoints | Backend |
| 14 | DailyNotes tab (split view, 4 collapsible sections, date sidebar) | Frontend |
| 15 | CalendarReview tab (month grid, P&L heatmap, day detail) | Frontend |
| 16 | Overview tab (6 KPI cards, period selector, review shortcuts) | Frontend |
| 17 | ReviewQueue tab (prioritized items, type badges, queue badge) | Frontend |
| 18 | Analytics aggregation (12 dimensions, per-bucket metrics, equity curve) | Backend |
| 19 | Analytics tab (dimension chips, metrics table, ECharts chart) | Frontend |
| 20 | Playbook service + resource CRUD + API endpoints | Backend |
| 21 | Playbooks tab (sidebar list, detail form, linked trades, stats) | Frontend |
| 22 | Monthly review (auto-populated, reuses weekly_reviews table) | Backend |
| 23 | Insights engine (8 pattern-derived coaching statements) | Backend |
| 24 | InsightCard + ResourceEditor components | Frontend |
| 25 | Guided flow prompts + mobile responsive + virtualized tables | Frontend |
| 26 | CSV import backend (broker detection, mapping, dedup) | Backend |
| 27 | Import Wizard UI (3-step: upload → map → review) | Frontend |
| 28 | AI summary backend (Claude Haiku trade recap + weekly digest) | Backend |
| 29 | AI Summary UI (generate/regenerate in trade drawer) | Frontend |
| 30 | Integration testing + final polish | Full stack |

**After Phases 4-9:** The trade journal is feature-complete. Users have daily structured journaling, visual calendar review, KPI dashboards, analytics by 12 dimensions, playbook management, CSV import from 4 brokers, AI trade summaries, guided review flows, and a prioritized review queue. The system covers the full loop: Log → Review → Analyze → Learn → Improve → Repeat.
