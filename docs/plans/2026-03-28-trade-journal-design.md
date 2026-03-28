# Trade Journal — Elite Design Spec

**Date:** 2026-03-28
**Status:** Draft
**Scope:** Complete rebuild of `/journal` into an institutional-grade trade journaling, review, and improvement system

---

## 1. Product Vision

The Trade Journal replaces the current simple trade log with a complete operating system for trader self-review. It combines trade capture, process scoring, mistake tracking, daily/weekly review workflows, playbook management, analytics, and guided improvement loops into one unified workspace.

**Core loop:** Log → Review → Analyze → Learn → Improve → Repeat

**Design philosophy:** Bloomberg meets Linear. Dense, analytical, calm. Dark mode first. No SaaS template aesthetics. Every pixel serves the review workflow.

---

## 2. Architecture Decisions

### 2.1 Navigation Model

The journal becomes a **section with its own sub-navigation** — a horizontal tab bar inside the page, not separate sidebar entries. The single `/journal` nav item opens to a rich interior.

**Sub-tabs (horizontal, left-aligned):**
1. **Overview** — KPI dashboard + review shortcuts
2. **Trade Log** — professional filterable table
3. **Daily Notes** — per-day journal entries
4. **Calendar** — visual calendar review
5. **Analytics** — breakdowns by every dimension
6. **Playbooks** — setup definitions + performance
7. **Review Queue** — guided incomplete-work surface

These 7 tabs cover the core product. Mistakes, screenshots, and insights are integrated INTO the trade detail and analytics rather than being separate sections (reduces tab sprawl, keeps context tight).

### 2.2 Trade Detail: Slide-Over Drawer

Clicking any trade opens a **right-side drawer** (480px wide, full height). This preserves the log context while allowing deep review. The drawer has its own tab bar:
- **Summary** — execution timeline, key metrics, thesis, **embedded StockChart with entry/exit/stop markers**
- **Executions** — scale-in/scale-out events, partial fills, fees per leg
- **Process** — process score breakdown (5 dimensions), outcome score
- **Notes & Screenshots** — voice-of-trader notes, image uploads, lessons
- **Mistakes** — structured mistake tags with taxonomy
- **Related** — linked daily journal, same-setup trades, same-symbol history

The drawer can be expanded to full-width for screenshot review.

### 2.6a Chart Integration in Trade Detail

The Summary tab embeds the existing `StockChart` component (Lightweight Charts v5) showing:
- **Entry marker** (green BUY arrow) at entry price/date
- **Exit marker** (red SELL arrow) at exit price/date (if closed)
- **Stop price line** (dashed red horizontal)
- **Target price line** (dashed green horizontal)
- **Scale-in/out markers** (smaller arrows at execution prices)
- Default zoom: centers on the trade's holding period with 20 bars of context on each side
- Timeframe: Daily by default, toggleable to Weekly/Intraday

This reuses the existing `StockChart` component and `/api/bars/{ticker}` endpoint — no new chart infrastructure needed. The markers use the same `createSeriesMarker` pattern already used for UCT20 positions.

### 2.3 Database Strategy

Extend the existing SQLite `auth.db` with new tables via auto-migration (same pattern as existing columns). No new database files.

### 2.4 Screenshot Storage

Screenshots stored on Railway persistent volume at `/data/journal_screenshots/`. Each file named `{user_id}_{trade_id}_{slot}_{uuid}.webp`. Backend converts uploads to WebP (Pillow, same as avatar system). Max 5 screenshots per trade. Max 2MB per upload.

### 2.5 Review State Machine

Every trade carries a `review_status` field:
```
draft → logged → partial → reviewed → flagged
                                    ↘ follow_up
```
- **draft**: created but missing required fields (no entry price or no symbol)
- **logged**: has core fields but no review work done
- **partial**: some review fields completed (has notes OR process score OR mistakes, but not all)
- **reviewed**: process score + notes + at least 1 screenshot = complete
- **flagged**: user manually flagged for deeper review
- **follow_up**: has an open action item

Status is auto-computed on every save based on field completeness. Users can manually flag/unflag.

### 2.6 Guided Flows

Guided flows are implemented as **progress indicators and smart prompts within existing UI**, not modal wizards. The review queue surfaces what's incomplete. The trade detail drawer shows a completion checklist sidebar. Daily notes show a structured template with sections.

This is less disruptive than step-by-step wizards and respects the power-user audience. The UI teaches through structure and prompts, not forced linear flows.

---

## 3. Data Model

### 3.1 Expanded `journal_entries` Table

New columns added to existing table (auto-migration):

```sql
-- Existing columns retained as-is:
-- id, user_id, sym, direction, setup, entry_price, exit_price,
-- stop_price, target_price, size_pct, status, entry_date, exit_date,
-- pnl_pct, pnl_dollar, notes, rating, created_at, updated_at

-- New columns:
account          TEXT DEFAULT 'default',    -- account name (multi-account support)
asset_class      TEXT DEFAULT 'equity',     -- equity, options, futures
strategy         TEXT DEFAULT '',            -- higher-level strategy name
playbook_id      TEXT,                       -- FK to playbooks table
tags             TEXT DEFAULT '',            -- comma-separated custom tags
mistake_tags     TEXT DEFAULT '',            -- comma-separated mistake IDs
emotion_tags     TEXT DEFAULT '',            -- comma-separated emotion tags
entry_time       TEXT,                       -- HH:MM timestamp
exit_time        TEXT,                       -- HH:MM timestamp
fees             REAL DEFAULT 0,
shares           REAL,                       -- share/contract count
risk_dollars     REAL,                       -- planned $ risk
planned_r        REAL,                       -- planned R:R
realized_r       REAL,                       -- actual R-multiple
thesis           TEXT DEFAULT '',            -- entry thesis/rationale
market_context   TEXT DEFAULT '',            -- market regime note
confidence       INTEGER,                   -- 1-5 pre-trade confidence
process_score    INTEGER,                    -- 0-100 composite
outcome_score    INTEGER,                    -- 0-100 composite
ps_setup         INTEGER,                    -- 0-20 setup quality
ps_entry         INTEGER,                    -- 0-20 entry quality
ps_exit          INTEGER,                    -- 0-20 exit quality
ps_sizing        INTEGER,                    -- 0-20 sizing discipline
ps_stop          INTEGER,                    -- 0-20 stop discipline
lesson           TEXT DEFAULT '',            -- post-trade lesson
follow_up        TEXT DEFAULT '',            -- follow-up action item
review_status    TEXT DEFAULT 'draft',       -- draft/logged/partial/reviewed/flagged/follow_up
review_date      TEXT,                       -- when review was completed
session          TEXT DEFAULT '',            -- e.g. "pre-market", "regular", "after-hours"
day_of_week      TEXT,                       -- auto-computed on save
holding_minutes  INTEGER,                    -- auto-computed from timestamps
```

**Design decision:** Process score uses 5 dimensions at 0-20 each (total 0-100) rather than the prompt's 7 dimensions. This maps cleanly to a 100-point scale and each dimension is meaningful enough to score independently. "Emotional discipline" and "plan adherence" are folded into the 5 core dimensions since they overlap heavily with entry/exit/stop quality.

**Design decision:** `tags`, `mistake_tags`, and `emotion_tags` are stored as comma-separated strings rather than junction tables. For a single-user journal with <1000 trades, this avoids schema complexity while still supporting filtering. If scale demands it, migration to junction tables is straightforward.

### 3.2 New Table: `journal_screenshots`

```sql
CREATE TABLE IF NOT EXISTS journal_screenshots (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    trade_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    slot        TEXT NOT NULL,    -- 'pre_entry', 'in_trade', 'exit', 'higher_tf', 'lower_tf'
    filename    TEXT NOT NULL,
    label       TEXT DEFAULT '',  -- annotation label
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_screenshots_trade ON journal_screenshots(trade_id);
```

### 3.3 New Table: `trade_executions`

Tracks individual scale-in/scale-out events for a single trade position.

```sql
CREATE TABLE IF NOT EXISTS trade_executions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    trade_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    exec_type   TEXT NOT NULL,       -- 'entry', 'add', 'trim', 'exit', 'stop'
    exec_date   TEXT NOT NULL,       -- YYYY-MM-DD
    exec_time   TEXT,                -- HH:MM
    price       REAL NOT NULL,
    shares      REAL NOT NULL,       -- positive for buys, negative for sells
    fees        REAL DEFAULT 0,
    notes       TEXT DEFAULT '',
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_executions_trade ON trade_executions(trade_id);
```

**Execution logic:**
- When a trade has executions, the parent `journal_entries` row's `entry_price` and `exit_price` are computed as VWAP of entry-type and exit-type executions respectively.
- `shares` on the parent is the sum of all execution shares.
- `fees` on the parent is the sum of all execution fees.
- `pnl_dollar` is computed from individual execution legs, not just average entry/exit.
- If no executions exist, the parent's `entry_price`/`exit_price` are used directly (simple single-fill mode).
- All execution events appear as markers on the StockChart in the trade detail drawer.

### 3.4 New Table: `daily_journals`

```sql
CREATE TABLE IF NOT EXISTS daily_journals (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    date            TEXT NOT NULL,       -- YYYY-MM-DD
    premarket_thesis TEXT DEFAULT '',
    focus_list      TEXT DEFAULT '',      -- comma-separated tickers
    a_plus_setups   TEXT DEFAULT '',
    risk_plan       TEXT DEFAULT '',
    market_regime   TEXT DEFAULT '',
    emotional_state TEXT DEFAULT '',      -- pre-session baseline
    midday_notes    TEXT DEFAULT '',
    eod_recap       TEXT DEFAULT '',
    did_well        TEXT DEFAULT '',
    did_poorly      TEXT DEFAULT '',
    learned         TEXT DEFAULT '',
    tomorrow_focus  TEXT DEFAULT '',
    energy_rating   INTEGER,             -- 1-5
    discipline_score INTEGER,            -- 0-100
    review_complete INTEGER DEFAULT 0,   -- boolean
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_journals_user_date ON daily_journals(user_id, date);
```

### 3.4 New Table: `weekly_reviews`

```sql
CREATE TABLE IF NOT EXISTS weekly_reviews (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    week_start      TEXT NOT NULL,       -- YYYY-MM-DD (Monday)
    best_trade_id   TEXT,
    worst_trade_id  TEXT,
    top_setup       TEXT DEFAULT '',
    worst_mistake   TEXT DEFAULT '',
    wins            INTEGER DEFAULT 0,
    losses          INTEGER DEFAULT 0,
    net_pnl_pct     REAL,
    avg_process_score REAL,
    reflection      TEXT DEFAULT '',
    key_lessons     TEXT DEFAULT '',      -- newline-separated
    next_week_focus TEXT DEFAULT '',
    rules_to_add    TEXT DEFAULT '',
    review_complete INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_start)
);
```

### 3.5 New Table: `playbooks`

```sql
CREATE TABLE IF NOT EXISTS playbooks (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    market_condition TEXT DEFAULT '',
    trigger_criteria TEXT DEFAULT '',
    invalidations   TEXT DEFAULT '',
    entry_model     TEXT DEFAULT '',
    exit_model      TEXT DEFAULT '',
    sizing_rules    TEXT DEFAULT '',
    common_mistakes TEXT DEFAULT '',
    best_practices  TEXT DEFAULT '',
    ideal_time      TEXT DEFAULT '',
    ideal_volatility TEXT DEFAULT '',
    is_active       INTEGER DEFAULT 1,
    trade_count     INTEGER DEFAULT 0,  -- denormalized for perf
    win_rate        REAL,               -- denormalized
    avg_r           REAL,               -- denormalized
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_playbooks_user ON playbooks(user_id);
```

### 3.6 New Table: `journal_resources`

```sql
CREATE TABLE IF NOT EXISTS journal_resources (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    category    TEXT NOT NULL,  -- 'checklist', 'rule', 'template', 'psychology', 'plan'
    title       TEXT NOT NULL,
    content     TEXT DEFAULT '',
    sort_order  INTEGER DEFAULT 0,
    is_pinned   INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_resources_user ON journal_resources(user_id);
```

### 3.7 Mistake Taxonomy

Stored as a constant in the backend (not a table). Users can extend with custom tags via comma-separated `mistake_tags` field.

**Default library (17 items):**
```python
MISTAKE_TAXONOMY = [
    {"id": "overtrading", "label": "Overtrading", "category": "discipline"},
    {"id": "fomo", "label": "FOMO Entry", "category": "psychology"},
    {"id": "chasing", "label": "Chasing Extended", "category": "entry"},
    {"id": "early_exit", "label": "Early Exit", "category": "exit"},
    {"id": "late_entry", "label": "Late Entry", "category": "entry"},
    {"id": "no_stop", "label": "No Stop Loss", "category": "risk"},
    {"id": "oversized", "label": "Oversized Position", "category": "risk"},
    {"id": "countertrend", "label": "Countertrend Impulse", "category": "strategy"},
    {"id": "revenge", "label": "Revenge Trade", "category": "psychology"},
    {"id": "ignored_thesis", "label": "Ignored Thesis", "category": "discipline"},
    {"id": "added_to_loser", "label": "Added to Loser", "category": "risk"},
    {"id": "cut_winner", "label": "Cut Winner Too Early", "category": "exit"},
    {"id": "broke_loss_rule", "label": "Broke Daily Loss Rule", "category": "discipline"},
    {"id": "broke_size_rule", "label": "Broke Max Size Rule", "category": "risk"},
    {"id": "broke_checklist", "label": "Broke Process Checklist", "category": "discipline"},
    {"id": "boredom", "label": "Entered from Boredom", "category": "psychology"},
    {"id": "hesitation", "label": "Hesitation / Missed Entry", "category": "psychology"},
]
```

**Emotion tags (constant):**
```python
EMOTION_TAGS = [
    "confident", "anxious", "greedy", "fearful", "calm",
    "frustrated", "euphoric", "bored", "disciplined", "impulsive",
    "patient", "rushed", "focused", "distracted", "revenge-driven",
]
```

---

## 4. API Design

### 4.1 Enhanced Trade Endpoints

```
GET    /api/journal                    — list trades (expanded filtering)
GET    /api/journal/stats              — aggregate stats (enhanced)
GET    /api/journal/calendar           — calendar view data (see response shape below)
GET    /api/journal/review-queue       — trades/days needing review
GET    /api/journal/analytics          — breakdowns by dimension
GET    /api/journal/insights           — pattern-derived coaching statements
GET    /api/journal/taxonomy           — mistake + emotion tag libraries
POST   /api/journal                    — create trade (enhanced fields)
PUT    /api/journal/{id}               — update trade
DELETE /api/journal/{id}               — delete trade
POST   /api/journal/{id}/screenshots   — upload screenshot (multipart)
DELETE /api/journal/{id}/screenshots/{screenshot_id}  — remove screenshot
GET    /api/journal/{id}/screenshots   — list screenshots for trade
```

**Calendar endpoint response** (`GET /api/journal/calendar?month=2026-03`):
```json
{
  "month": "2026-03",
  "days": {
    "2026-03-10": {
      "trade_count": 3,
      "wins": 2,
      "losses": 1,
      "net_pnl_pct": 2.4,
      "net_pnl_dollar": 120.00,
      "avg_process_score": 72,
      "has_daily_journal": true,
      "daily_review_complete": false,
      "mistake_count": 1,
      "screenshot_count": 2,
      "review_statuses": ["reviewed", "partial", "logged"]
    }
  }
}
```

**Filter params for GET /api/journal:**
```
status, review_status, symbol, setup, playbook_id, direction, asset_class,
date_from, date_to, tag, mistake_tag, session, day_of_week,
has_screenshots (bool), has_notes (bool), has_process_score (bool),
min_r, max_r, min_pnl, max_pnl, sort_by, sort_dir, limit, offset
```

### 4.2 Daily Journal Endpoints

```
GET    /api/journal/daily              — list daily journals (date range)
GET    /api/journal/daily/{date}       — get/create daily journal for date
PUT    /api/journal/daily/{date}       — update daily journal
```

Auto-creates a daily journal entry on first access for a given date.

### 4.3 Weekly Review Endpoints

```
GET    /api/journal/weekly             — list weekly reviews
GET    /api/journal/weekly/{week_start} — get/create weekly review
PUT    /api/journal/weekly/{week_start} — update weekly review
```

Auto-populates computed fields (wins, losses, net P&L, avg process score) from trade data for the week.

### 4.4 Playbook Endpoints

```
GET    /api/journal/playbooks          — list user's playbooks
POST   /api/journal/playbooks          — create playbook
PUT    /api/journal/playbooks/{id}     — update playbook
DELETE /api/journal/playbooks/{id}     — delete playbook
GET    /api/journal/playbooks/{id}/trades — trades linked to this playbook
```

### 4.5 Resource Endpoints

```
GET    /api/journal/resources          — list by category
POST   /api/journal/resources          — create resource
PUT    /api/journal/resources/{id}     — update resource
DELETE /api/journal/resources/{id}     — delete resource
```

### 4.6 Analytics Endpoint Detail

`GET /api/journal/analytics?group_by={dimension}&date_from=&date_to=`

**Supported `group_by` values:** setup, playbook, symbol, direction, asset_class, day_of_week, session, mistake_tag, emotion_tag, holding_period_bucket, process_score_bucket, month, week

**Returns per bucket:**
```json
{
  "buckets": [
    {
      "key": "VCP",
      "trade_count": 24,
      "win_rate": 62.5,
      "avg_pnl_pct": 2.3,
      "total_pnl_pct": 55.2,
      "avg_r": 1.4,
      "profit_factor": 2.1,
      "avg_process_score": 78,
      "avg_holding_minutes": 4320,
      "best_trade": {"sym": "SMCI", "pnl_pct": 12.3},
      "worst_trade": {"sym": "TSLA", "pnl_pct": -6.1}
    }
  ],
  "totals": { ... }
}
```

### 4.7 Insights Engine

`GET /api/journal/insights` — returns up to 8 pattern-derived statements computed from user's trade history.

**Insight generation logic (server-side, no AI):**
- Compare win rate by time-of-day buckets (pre-market, first 90min, midday, power hour, after hours)
- Compare expectancy by setup
- Correlate mistake count with outcome
- Detect position-size clustering on losing days
- Compare performance by trade count per day (1-2 vs 3-5 vs 6+)
- Compare process score by day of week
- Detect whether playbook-linked trades outperform unlinked
- Flag consecutive losing streak patterns

Each insight returns `{ id, statement, evidence, action_type, action_label, priority }`.

---

## 5. Frontend Architecture

### 5.1 File Structure

```
app/src/pages/
  journal/
    JournalPage.jsx              — shell: header + sub-tab router
    JournalPage.module.css
    tabs/
      Overview.jsx               — KPI cards + review shortcuts
      TradeLog.jsx               — filterable trade table
      DailyNotes.jsx             — per-day journal + linked trades
      CalendarReview.jsx         — calendar grid + day detail
      Analytics.jsx              — dimension breakdowns
      Playbooks.jsx              — playbook CRUD + performance
      ReviewQueue.jsx            — guided review surface
    components/
      TradeDrawer.jsx            — right-side detail drawer
      TradeDrawer.module.css
      TradeForm.jsx              — new/edit trade form (used in drawer + standalone)
      ProcessScoreCard.jsx       — 5-dimension scoring widget
      MistakeSelector.jsx        — multi-select from taxonomy
      EmotionSelector.jsx        — multi-select emotion tags
      ScreenshotUploader.jsx     — upload + slot management
      ReviewProgress.jsx         — completion indicator bar
      InsightCard.jsx            — pattern insight with action button
      CalendarCell.jsx           — single day in calendar grid
      FilterBar.jsx              — trade log filter controls
      StatCard.jsx               — KPI card component
      WeeklyReviewDrawer.jsx     — weekly review form in drawer
      DailyReviewForm.jsx        — structured daily note template
```

### 5.2 JournalPage Shell

```jsx
// Horizontal tab bar below page header
// URL: /journal, /journal/log, /journal/daily, /journal/calendar, etc.
// Uses React Router nested routes OR local state tabs (decision: local state tabs
// to avoid URL noise — journal is one "place", tabs are interior navigation)

const JOURNAL_TABS = [
  { key: 'overview', label: 'Overview', icon: '⊞' },
  { key: 'log', label: 'Trade Log', icon: '☰' },
  { key: 'daily', label: 'Daily Notes', icon: '📝' },
  { key: 'calendar', label: 'Calendar', icon: '📅' },
  { key: 'analytics', label: 'Analytics', icon: '📊' },
  { key: 'playbooks', label: 'Playbooks', icon: '📖' },
  { key: 'queue', label: 'Review Queue', icon: '⚡' },
]
```

**Design decision:** Local state tabs, not nested routes. This keeps URL as `/journal` always, which matches the existing nav pattern. The active tab persists via `usePreferences` hook (server-side pref key `journal_tab`, survives page refresh and sessions, but does not appear in the URL bar).

### 5.3 Overview Tab

**Top row: 6 KPI cards** (compact, not oversized)
- Net P&L (period selector: week/month/quarter/year/all)
- Win Rate
- Avg R
- Profit Factor
- Expectancy
- Process Score (avg)

**Middle row: Review shortcuts** — clickable chips that filter the trade log:
- Today's trades (count)
- Unreviewed (count)
- Missing screenshots (count)
- Missing notes (count)
- Has mistakes (count)
- Follow-up needed (count)
- Weekly review pending (bool)

**Bottom: Recent insights** (top 3 from insights engine)

### 5.4 Trade Log Tab

Dense table with sticky header. Columns:
`Date | Time | Symbol | Dir | Setup | Entry | Exit | Stop | R | P&L% | P&L$ | Process | Mistakes | Review | Actions`

- Click row → opens TradeDrawer
- Checkbox column for bulk actions
- FilterBar above table (collapsible)
- Bulk action bar appears when rows selected: tag, assign playbook, mark reviewed
- Export button (CSV)
- Sort by any column header click
- Pagination (50 per page)

### 5.5 Trade Drawer

480px right drawer. Slides in with `transform: translateX`. Close on Escape or X button.

**Header:** Symbol (large) + direction badge + P&L + R-multiple + review status pill

**Drawer tabs:**
1. **Summary**: Embedded StockChart (daily, ~200 bars centered on trade period) with entry/exit/stop/target markers + execution arrows. Key metrics grid (entry, exit, stop, target, shares, fees, risk, R, holding time). Thesis text, market context. Chart timeframe toggle (5min/30min/1hr/Daily/Weekly).
2. **Executions**: Timeline of all scale-in/scale-out events. Each row: type (entry/add/trim/exit/stop), date, time, price, shares, fees, notes. "Add Execution" button. VWAP entry/exit auto-computed from legs. If no executions, shows "Simple mode — single entry/exit" with link to add legs.
3. **Process**: 5 sliders (0-20 each) for setup/entry/exit/sizing/stop quality. Total process score auto-computed. Outcome score (separate 0-100). Visual comparison: process vs outcome bar.
4. **Notes**: Rich text notes area, lesson field, follow-up action field. Screenshot upload area with 5 slots (pre-entry, in-trade, exit, higher TF, lower TF). Screenshots displayed as thumbnails, click to enlarge.
5. **Mistakes**: Mistake tag multi-select (checkboxes from taxonomy). Emotion tag multi-select. Custom tag input.
6. **Related**: Linked daily journal (click to navigate). Other trades same day. Other trades same symbol (last 20). Other trades same setup (last 10).

**Completion sidebar** (always visible in drawer, right edge):
Vertical progress dots showing what's done:
- Core fields ✓
- Thesis ○
- Process score ○
- Screenshots ○
- Notes ○
- Lesson ○
- Mistakes reviewed ○

### 5.6 Daily Notes Tab

Split view: left sidebar = date list (scrollable, shows completion status), right = daily journal form.

**Daily journal form sections** (collapsible):
1. **Pre-Market** — thesis, focus list (ticker chips), A+ setups, risk plan
2. **Market Notes** — regime note, emotional baseline, energy rating (1-5 pills)
3. **Midday** — adjustment notes
4. **End of Day** — recap, did well, did poorly, learned, tomorrow focus, discipline score (0-100 slider)

**Below form:** linked trades for the day (mini table: symbol, dir, P&L, review status)

Dates with no journal show "Start today's journal" CTA. Dates with partial completion show amber dot. Complete days show green dot.

### 5.7 Calendar Review Tab

Full month calendar grid. Each cell shows:
- Net P&L (colored green/red)
- Trade count
- Win rate bar (mini horizontal bar, green portion)
- Dots: green (reviewed), amber (partial), red (unreviewed), blue (has daily journal)

Click a day → opens a day detail panel (below calendar or as drawer):
- All trades for that day (mini table)
- Daily journal excerpt
- Day metrics: trades, wins, losses, net P&L, avg R, process score
- Review status

Month navigation (← →). Green/red border-left on each cell for quick P&L scan.

### 5.8 Analytics Tab

**Dimension selector** (horizontal chip bar): Setup | Symbol | Direction | Day of Week | Time of Day | Session | Holding Period | Process Score | Mistake | Playbook

**Period selector**: 1W | 1M | 3M | 6M | 1Y | All

**Main area**: Table showing buckets with metrics (trade count, win rate, avg P&L, avg R, profit factor, process score). Color-coded bars for visual comparison.

**Below table**: ECharts line chart showing equity curve for selected segment (or overall). Toggle: cumulative P&L, per-trade P&L, R-multiples.

### 5.9 Playbooks Tab

Left sidebar: list of playbooks (name + trade count + win rate). "+ New Playbook" button.

Right panel: playbook detail form with all fields from schema. Below form: linked trades table (filtered by `playbook_id`). Denormalized stats card (trade count, win rate, avg R, best/worst trade).

### 5.10 Review Queue Tab

Ordered list of items needing attention, organized by priority:

1. **Today's unreviewed trades** (highest priority)
2. **Yesterday's incomplete daily journal**
3. **Trades with follow-up actions**
4. **Trades missing process scores**
5. **Trades missing screenshots** (closed only)
6. **Trades flagged for deep review**
7. **Weekly review pending** (if past Sunday)
8. **Trades missing notes** (closed only)

Each queue item shows: type badge, symbol/date, what's missing, "Review →" button that opens the relevant drawer/form.

**Queue count** shown as badge on the "Review Queue" tab. Also shown on Overview.

---

## 6. Guided Flow Implementation

### 6.1 Trade Review Guidance

Inside the TradeDrawer, the completion sidebar shows clear visual progress. When a trade is first opened in the drawer, incomplete items pulse gently (one cycle) to draw attention. The top of each empty section shows a subtle prompt:

- Thesis: "What was your reason for entering this trade?"
- Process score: "Rate your execution across 5 dimensions"
- Screenshots: "Add chart screenshots for future reference"
- Notes: "What happened? What did you observe?"
- Lesson: "If you could trade this again, what would you change?"
- Mistakes: "Did you make any execution errors?"

These prompts disappear once content is added.

### 6.2 Daily Review Guidance

When viewing "today" in Daily Notes, the form sections appear in natural order with time-appropriate highlights:
- Pre-market sections highlighted before market open
- Midday section highlighted during session
- EOD sections highlighted after close

If any trades exist for the day without a daily journal, a banner appears: "You have N trades today. Start your daily review →"

### 6.3 Weekly Review Guidance

The weekly review drawer auto-populates computed fields and shows:
- This week's metrics pre-filled
- Top/bottom trades pre-selected (can override)
- Reflection and lessons as structured text areas with prompts

### 6.4 Review Queue as Home

When trades exist that need review, the Overview tab shows a prominent "N items need review" card at the top linking to the Review Queue tab. This makes the journal feel actively guided rather than passive.

---

## 7. Mock Data Seeding

Create a `seed_journal_data.py` script that generates realistic trade history for demo/development:

- **60 trades** across 45 trading days (mix of 1-3 trades per active day)
- Symbols from UCT20 + scanner universe (SMCI, NVDA, PLTR, APP, CRWD, META, TSLA, etc.)
- Setups from existing `SETUP_GROUPS` (VCP, Flag, Episodic Pivot, etc.)
- Realistic P&L distribution: ~55% win rate, avg winner +3.2%, avg loser -2.1%, profit factor ~1.6
- Process scores distributed 40-95 range (some good losers, some bad winners)
- 30% of trades have screenshots (mock entries with placeholder labels)
- 40% have notes filled in
- 20% have mistake tags
- 15 daily journal entries (some complete, some partial)
- 2 playbooks (VCP + Episodic Pivot) with linked trades
- Various review statuses to populate the queue
- 5 resources (pre-market checklist, risk rules, etc.)
- Realistic timestamps spanning last 8 weeks

---

## 8. Visual Design Specifications

### 8.1 Color Usage

- **Background**: `var(--bg)` page, `var(--bg-surface)` cards, `var(--bg-elevated)` drawers/modals
- **KPI cards**: thin left border accent (green for positive, red for negative, gold for neutral)
- **Process score**: gradient from red (0-30) → amber (31-60) → green (61-100)
- **Outcome vs process comparison**: dual bar — green for process, blue for outcome — makes divergence visible
- **Calendar cells**: subtle background tint based on net P&L (very faint green/red)
- **Review status pills**: draft=muted, logged=blue, partial=amber, reviewed=green, flagged=red, follow_up=purple
- **Mistake tags**: red-tinted chips
- **Emotion tags**: blue-tinted chips

### 8.2 Typography

- Table data: `IBM Plex Mono` 12px (tabular numerals for alignment)
- Labels: `IBM Plex Mono` 9-10px uppercase tracking
- Section headers: `Cinzel` 14-16px gold
- Page title: `Cinzel` 22px gold (consistent with existing pages)
- Body text (notes, thesis): `Instrument Sans` 13px
- KPI values: `IBM Plex Mono` 20-24px bold

### 8.3 Spacing & Layout

- Page padding: `20px 24px` (consistent with other pages)
- Card gaps: 12px
- Table cell padding: `8px 10px`
- Drawer padding: `20px`
- Section spacing: `16px` between major sections
- Filter bar height: 40px (collapsed), auto (expanded)

### 8.4 Responsive Behavior

- **Desktop (>1024px)**: full layout, drawer slides over content
- **Tablet (641-1023px)**: table columns reduce (hide fees, session), drawer becomes full-width overlay
- **Mobile (≤640px)**: table becomes card list, drawer becomes full-page, calendar becomes week view, tabs become scrollable

---

## 9. Implementation Phases

### Phase 1: Foundation (Data + Shell + Log)
- SQLite schema migrations (all new tables + columns including `trade_executions` and `account`)
- Enhanced journal service (CRUD with new fields)
- JournalPage shell with tab navigation
- TradeLog tab with basic filtering and sorting
- TradeDrawer with Summary tab + embedded StockChart (entry/exit/stop markers)
- Enhanced trade form (all new fields)
- Review status auto-computation

### Phase 2: Executions + Process Scoring + Mistakes
- Trade executions CRUD (scale-in/out events)
- Executions tab in TradeDrawer (add/edit/remove legs, VWAP computation)
- Execution markers on StockChart (all legs as arrows)
- ProcessScoreCard component (5 sliders)
- MistakeSelector + EmotionSelector components
- Process tab in TradeDrawer
- Mistakes tab in TradeDrawer
- Taxonomy API endpoint
- Review status integration with process score

### Phase 3: Screenshots + Notes
- Screenshot upload API + storage
- ScreenshotUploader component
- Notes tab in TradeDrawer (notes + screenshots + lesson + follow-up)
- Completion sidebar in TradeDrawer

### Phase 4: Daily Notes + Calendar
- Daily journal API + service
- DailyNotes tab (split view with form)
- CalendarReview tab (month grid + day detail)
- Link trades ↔ daily journals

### Phase 5: Overview + Review Queue
- Overview tab (KPI cards, shortcuts, insights preview)
- ReviewQueue tab (prioritized items)
- Enhanced stats endpoint
- Queue count badge

### Phase 6: Analytics + Playbooks + Monthly Reviews
- Analytics endpoint (group_by breakdowns)
- Analytics tab (dimension selector, table, chart)
- Playbook CRUD API
- Playbooks tab (list + detail + linked trades)
- Monthly review template (extension of weekly review pattern)

### Phase 7: Insights + Resources + Polish
- Insights engine (pattern detection)
- InsightCard component
- Resources CRUD
- Resources section (in Playbooks tab or sidebar)
- Guided flow prompts and nudges
- Mock data seeder
- Mobile responsive polish
- Performance optimization (virtualized tables for large datasets)

### Phase 8: Import / Data Quality Center
- CSV import UI (upload, field mapping, preview, confirm)
- CSV parser supporting common broker export formats (TD Ameritrade, Interactive Brokers, Schwab, TradeStation)
- Field mapping interface (drag source columns to target fields)
- Duplicate detection (same symbol + date + price = likely duplicate)
- Validation warnings panel (missing fields, suspicious prices, orphaned executions)
- Import session history (track what was imported when)
- "Needs review" flags on imported trades
- Broker API sync placeholder page (architecture + "coming soon" with broker list)

### Phase 9: AI Trade Summaries
- AI-generated trade summary for reviewed trades (uses Claude Haiku, same pattern as earnings previews)
- Auto-generates: 2-3 sentence recap, key takeaway, suggested improvement
- Shown in trade detail drawer Summary tab
- "Generate Summary" button (not automatic — user-triggered)
- Weekly AI digest: top patterns, biggest lessons, focus areas
- Uses existing `ANTHROPIC_API_KEY` and Claude Haiku (cost: ~$0.001 per summary)

---

## 10. Integration Points

### 10.1 Existing Dashboard Integration
- **UCT20**: "Journal this trade" button on open positions → pre-fills symbol, entry price, entry date
- **Screener**: "Add to journal" action on candidates → pre-fills symbol, setup from scanner data
- **TickerPopup**: "Journal" button → opens trade form pre-filled with symbol
- These are stretch goals for post-V1 but the API supports them from day one.

### 10.2 Data Sources
- **Live prices**: `useLivePrices` for open position current P&L in the trade log
- **Chart bars**: `StockChart` component embedded in trade detail for visual context (stretch)
- **Wire data**: market regime from latest push for `market_context` auto-fill suggestion

### 10.3 Import Architecture (Future)
The schema is designed to accept imported trades. Key future-proofing:
- `fees` field for broker-provided commission data
- `shares` field for exact position sizing
- `entry_time`/`exit_time` for intraday precision
- `asset_class` for multi-asset support
- No hard-coded assumptions about equity-only trading

---

## 11. Performance Considerations

- **Trade log**: paginated (50/page), not loaded all at once. SWR with 60s refresh.
- **Analytics**: server-side aggregation, not client-side. Results cached 30s.
- **Calendar**: loads one month at a time. Prefetches adjacent months.
- **Screenshots**: served as WebP thumbnails (200px wide) in lists, full size on click. Lazy loaded.
- **Insights**: computed server-side, cached 5 minutes. Not real-time.
- **SQLite WAL mode**: already enabled, handles concurrent reads well.

---

## 12. Out of Scope (All Phases)

These are explicitly excluded from this spec:
- Voice notes (audio storage complexity, niche use case)
- Social/sharing features (not aligned with private journal philosophy)
- Mobile native app features (PWA is sufficient)
- Export to PDF (CSV export covers the core need)
- Full broker API sync (placeholder page in Phase 8, actual integrations are separate projects per broker)

**Now in scope (moved from deferred):**
- Scale-in/scale-out execution tracking → Phase 2 (new `trade_executions` table)
- Multi-account support → Phase 1 (`account` column on `journal_entries`)
- CSV import → Phase 8 (field mapping UI, validation, dedup)
- Monthly review template → Phase 6 (extension of weekly)
- AI-generated trade summaries → Phase 9 (Claude Haiku, user-triggered)
