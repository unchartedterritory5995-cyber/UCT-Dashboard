# Journal 2.0 — Calendar Tab — Design Spec

**Phase 1 of the J2.0 Enhanced Suite (Calendar → Accounts → Analytics)**

**Date:** 2026-04-18
**Author:** Patrick (with Claude)
**Status:** Draft for review

---

## 1. Goals

A new **Calendar** tab inside Journal 2.0 that:

1. Shows daily P&L performance as a heatmap across **Year / Month / Week** views.
2. Each cell surfaces the day's headline numbers (P&L $, % return, R-sum, trade count).
3. Clicking a day routes to a **dedicated day-detail page** for serious daily journaling — trade table, reflection notes, attachments, rules checklist.
4. Designed so that Phase 2 (Accounts) can drop in an Account scope filter with zero refactor.

## 2. Out of scope (explicit non-goals)

- **Multi-account scoping UI** — built into the API as `account_id` param (default `null` = all), but no selector in v1. Lands in Phase 2.
- **Per-account reflection notes** — global per-date for v1 (architectural simplicity; can scope later if real demand emerges).
- **Live unrealized P&L on calendar cells** — calendar is closed-trade history. Live equity belongs to the Analytics tab in Phase 3.
- **Year-over-year comparison overlays** — v2.
- **Calendar export to PDF/iCal** — Polish phase (Generate Report modal handles PDF later).
- **Month / week templates** ("Week 14 review template") — v2.

## 3. Nav placement

Slot the new tab into `JournalTwoRoot.jsx` between **Trade Journal** and **Community**:

```
📊 Open Positions  |  📒 Trade Journal  |  📅 Calendar  |  🌐 Community
```

Hotkey: **`g > a`** (mnemonic: "go > calendAr"). Update `ShortcutCheatSheet.jsx`.

## 4. Trading-day boundary

A trade belongs to a **calendar day in America/New_York** based on its `exit_date` (when P&L is realized).

```python
# api/services/journal_two/calendar.py
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

def to_et_date(iso_utc: str) -> str:
    """Convert a UTC ISO timestamp to an ET YYYY-MM-DD bucket."""
    dt = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
    return dt.astimezone(ET).strftime("%Y-%m-%d")
```

**Why ET:** matches every US brokerage statement. Display can render in user's local timezone in tooltips ("closed at 7:42pm your time"), but the **bucket** is canonical ET.

**Edge case:** trades with `exit_date` after midnight ET (e.g. crypto) bucket to the next ET day. Documented behavior, not a bug.

## 5. Data model

### 5.1 New table: `j2_day_notes`

Stores reflection notes, attachments, and rules-checklist state per (user, date). One row per (user, date); upsert on save.

```sql
CREATE TABLE IF NOT EXISTS j2_day_notes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    date        TEXT NOT NULL,        -- YYYY-MM-DD in ET
    notes       TEXT,                 -- markdown reflection
    attachments TEXT NOT NULL DEFAULT '[]',  -- JSON array of {kind, url, label, addedAt}
    rules       TEXT NOT NULL DEFAULT '[]',  -- JSON array of {id, label, checked}
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_j2_day_notes_user_date
    ON j2_day_notes(user_id, date);
```

**Attachment shape:**
```json
{
  "kind": "link" | "image",
  "url": "https://www.tradingview.com/x/abc123/" | "/uploads/<uuid>.png",
  "label": "NVDA breakout setup",
  "addedAt": "2026-04-18T20:42:00Z"
}
```

**Rules shape:**
```json
{ "id": "<uuid>", "label": "Waited for confirmation", "checked": true }
```

**Cap:** 5 attachments per day, 25 rule items per day (UI-enforced; server validates).

### 5.2 Existing fields used

- `j2_trades.exit_date` — bucketed by `to_et_date()` for calendar aggregation
- `j2_trades.pnl_dollar`, `pnl_percent`, `r_multiple`, `result` — surfaced in cells
- `j2_settings.accountSize` — denominator for `pnl_percent_of_account` derived metric
- (Future, Phase 2) `j2_trades.account_id` — filter param

### 5.3 Image upload backend

Upload images go to local disk under `data/j2_attachments/<user_id>/<date>/<uuid>.<ext>`. Served via existing FastAPI static-file mount (or new `/api/j2/attachments/{user_id}/{date}/{filename}` route with auth).

**Limits:** 5 MB per file, .png/.jpg/.gif/.webp only, scanned for valid image header server-side. **No processing** (no resize/strip-EXIF in v1 — add if abuse appears).

**Per-user storage cap:** soft limit 100 MB, warn at 80 MB. Hard limit not enforced in v1.

## 6. Backend / API

All routes under existing `/api/j2/*` prefix in `api/routers/journal_two.py`. Auth via existing `get_current_user`.

### 6.1 Calendar aggregate

`GET /api/j2/calendar?view=month&year=2026&month=4&account_id=<optional>`

**Returns** the period's day-bucketed P&L summary, plus the per-period totals shown above the grid.

```json
{
  "view": "month",
  "year": 2026,
  "month": 4,
  "days": [
    {
      "date": "2026-04-19",
      "pnlDollar": 83.0,
      "pnlPercent": 0.000166,    // pnl / accountSize at time of last close
      "rSum": 4.2,
      "tradeCount": 4,
      "winners": 4,
      "losers": 0,
      "hasNotes": true            // for cell badge "📝"
    }
  ],
  "totals": {
    "netPnlDollar": 223.0,
    "grossPnlDollar": 223.0,
    "fees": 0.0,                  // future-proofed; always 0 in v1 (no fees field yet)
    "tradeCount": 5,
    "winners": 5,
    "losers": 0,
    "winRate": 1.0,
    "rSum": 11.5
  }
}
```

**View parameters:**
- `view=year&year=2026` → returns 365/366 day buckets
- `view=month&year=2026&month=4` → returns days 1–N for that month
- `view=week&year=2026&week=16` → returns 7 days for ISO 8601 week 16 (Mon–Sun)

### 6.2 Day detail

`GET /api/j2/calendar/day/{date}?account_id=<optional>`

```json
{
  "date": "2026-04-19",
  "metrics": {
    "netPnlDollar": 83.0,
    "grossPnlDollar": 83.0,
    "fees": 0.0,
    "tradeCount": 4,
    "winners": 4,
    "losers": 0,
    "winRate": 1.0,
    "rSum": 4.2,
    "pnlPercent": 0.000166
  },
  "trades": [ /* full j2_trades rows for this date */ ],
  "notes": {
    "notes": "...markdown...",
    "attachments": [...],
    "rules": [...]
  }
}
```

`notes` is `null` if no `j2_day_notes` row exists yet.

### 6.3 Day notes CRUD

`PUT /api/j2/calendar/day/{date}/notes` — upsert the reflection block.

```json
// Request body
{
  "notes": "Patient on entry, scaled out at +2R. Rules followed.",
  "attachments": [...],
  "rules": [...]
}
```

Server validates: `notes` ≤ 10,000 chars, `attachments.length` ≤ 5, `rules.length` ≤ 25. Returns the saved row.

`POST /api/j2/calendar/day/{date}/attachments` — multipart upload for image attachments. Returns `{ url, kind: "image", label }` to merge into `attachments` array client-side.

`DELETE /api/j2/calendar/day/{date}/attachments/{filename}` — remove an uploaded image (also deletes the file from disk).

## 7. Frontend / Components

### 7.1 New files

```
app/src/pages/journal-2-0/
├── tabs/
│   └── CalendarTab.jsx          ← view switcher + period nav + grid mount
├── components/calendar/
│   ├── CalendarHeader.jsx       ← view pills, period nav, totals strip
│   ├── YearView.jsx             ← 52w × 7d heatmap (GitHub style)
│   ├── MonthView.jsx            ← 7-col × 5-6 row grid
│   ├── WeekView.jsx             ← 7-col single-row + per-day trade list
│   ├── DayCell.jsx              ← shared cell renderer
│   ├── DayCellTooltip.jsx       ← hover tooltip
│   ├── DayDetailPage.jsx        ← /calendar/:date route component
│   ├── MiniMonthNav.jsx         ← sidebar mini-calendar on day page
│   ├── DayMetricsRow.jsx        ← Net/Gross/Fees/Trades/W/L/Rate strip
│   ├── DayTradesTable.jsx       ← reuses TradesTable patterns
│   ├── DayReflection.jsx        ← markdown notes editor (textarea v1)
│   ├── DayAttachments.jsx       ← link inputs + image upload zone
│   └── DayRulesChecklist.jsx    ← user-defined rules with checkboxes
├── hooks/
│   ├── useJ2Calendar.js         ← SWR for /api/j2/calendar
│   ├── useJ2DayDetail.js        ← SWR for /api/j2/calendar/day/:date
│   └── useJ2DayNotesMutation.js ← upsert + attachment upload
└── lib/
    └── calendar.js              ← color scale, date helpers, ET conversion
```

### 7.2 Routing

Add to existing `JournalTwoRoot.jsx` nested-tab system: when `nestedTab === 'calendar'`, render `<CalendarTab />`. CalendarTab uses **internal route state** for view + period (URL synced via `useSearchParams`):

- `?view=month&y=2026&m=4` (default)
- `?view=year&y=2026`
- `?view=week&y=2026&w=16`

Day-detail uses a **real React Router route** under the existing app router:

- `/journal-2-0/calendar/2026-04-19` → renders `<DayDetailPage date="2026-04-19" />`

This makes day pages **deep-linkable, browser-back-able, and shareable**. The calendar tab itself doesn't need a URL slug since it lives in the J2.0 nested-tab system.

**Layout continuity:** The day-detail route still renders inside the J2.0 layout shell (top header with Settings pill, BetaBadge, Shortcuts button) but suppresses the nested-tab bar (Open Positions / Trade Journal / Calendar / Community) since the user is in a sub-page. A "← Calendar" link at the top of the page returns to `?nestedTab=calendar`.

### 7.3 Cell anatomy (`DayCell.jsx`)

Layout (top-down, ~100×80px on month view):

```
┌─────────────────────────────┐
│ 19            📝   4 trades │   ← day#, notes-badge, count
│                             │
│        +$83.00              │   ← BIG: P&L $
│        +0.17%   +4.2R       │   ← small: % return + R-sum
└─────────────────────────────┘
   ↑ background tint = % of account intensity
```

**Background fill scale** (linear in `pnlPercent`):
- `>= +1%`     → full green (`var(--gain)` at 90% alpha)
- `+0.5%`      → 60% alpha green
- `+0.1%`      → 25% alpha green
- `0%`         → flat surface
- `-0.1%`      → 25% alpha red
- `-0.5%`      → 60% alpha red
- `<= -1%`     → full red (`var(--loss)`)
- **No trades** → empty, no tint

Toggle in calendar header: **$ / % / R** intensity mode (changes the scale — % default, $ uses similar absolute brackets, R uses `±0.5R / ±1R / ±2R` brackets).

**`hasNotes` badge:** small 📝 icon in top-right when reflection exists for that day.

**Today highlight:** 2px gold border (`var(--ut-gold)`) overlay regardless of P&L color.

### 7.4 Year view (`YearView.jsx`)

GitHub-contributions-style grid: **7 rows (Sun–Sat) × ~52 columns (weeks)**. Each cell is ~14×14px. Tooltip on hover (date + P&L). Click → day-detail page.

Above the grid: a strip of 12 month-name labels aligned to their first column.

Side legend: small color scale legend showing the current intensity mode's brackets.

### 7.5 Month view (`MonthView.jsx`)

7-column × 5-or-6-row grid. Cells ~140×100px on desktop. Rendering:

- Week starts on **Sunday** (matches TWI + US convention)
- Day-of-week header row at top
- Days from prev/next month rendered grayed-out OR omitted (lean toward omitted — cleaner)
- Today gets the gold-border overlay

### 7.6 Week view (`WeekView.jsx`)

7-column single-row grid (taller cells, ~200×280px). Below each cell: scrollable list of that day's trades (Symbol / Side / R / P&L). Useful for power-users reviewing the week in detail.

### 7.7 Day detail page (`DayDetailPage.jsx`)

Two-column layout on desktop (collapses to single column < 900px):

**Sidebar (left, ~280px):**
- Back-to-Calendar link (top)
- `<MiniMonthNav>` — small month grid for jumping between days; current day highlighted; arrow keys (← →) navigate prev/next day
- Below mini-cal: "Trades on Apr 19" compact list (matching TWI's left sidebar)

**Main column:**
1. Page title: `Sunday, April 19, 2026`
2. `<DayMetricsRow>` — Net P&L, Gross, Fees, Trades, Winners, Losers, Win Rate, R-sum
3. `<DayTradesTable>` — full trade table for the day (or "No trades on this day" empty state with a message inviting pre-trade journaling)
4. `<DayReflection>` — markdown textarea (v1: plain textarea with monospace font; v2 considers tiptap)
5. `<DayAttachments>` — TradingView link input + image drop zone
6. `<DayRulesChecklist>` — user-defined rule items, click to check/uncheck

**Auto-save** on blur + every 5 seconds while typing (debounced). Toast on save success/error.

### 7.8 Visual design — color scale module

`lib/calendar.js` exports:

```js
export function intensityClass(value, mode) {
  // mode: 'pct' | 'dollar' | 'r'
  // returns CSS class name from styles
}

export function bucketBackground(value, mode) {
  // returns rgba() string
}
```

Three discrete brackets per direction (low / mid / high) per side (gain / loss). Eight color states + one neutral = nine total. All swap from `var(--gain)` / `var(--loss)` tokens so theme changes propagate.

## 8. State management

- `useJ2Calendar({ view, year, month, week, accountId })` — SWR key `/api/j2/calendar?view=...&account_id=...`. Stale-while-revalidate; refresh on window focus disabled.
- `useJ2DayDetail(date, accountId)` — SWR key per date.
- `useJ2DayNotesMutation(date)` — exposes `{ saveNotes, uploadAttachment, deleteAttachment }`. Optimistic updates against the SWR cache for `useJ2DayDetail`.

## 9. Error handling

- **Network errors on calendar fetch** → red banner above grid: "Couldn't load calendar. [Retry]"
- **Empty period** (no trades, no notes) → still renders empty grid, totals show zeroes
- **Invalid date in URL** (e.g. `/calendar/banana`) → DayDetailPage shows 404-style "Day not found, [back to Calendar]"
- **Future date** → DayDetailPage allows it (pre-trade journaling); trades section is empty with "No trades yet — this day is in the future"
- **Notes save conflict** (two tabs editing same day) → last-write-wins for v1; show toast "Notes saved" but warn if `updated_at` server-side is newer than client's stale value
- **Image upload failure** → toast with reason, attachment not added to list
- **Image upload over 5MB** → client-side reject before upload with friendly message

## 10. Testing strategy

### 10.1 Backend (pytest)

`api/services/journal_two/test_calendar.py` covering:
- `to_et_date()` — DST transitions, midnight crossover, non-US timezones in input
- `aggregate_period()` — year/month/week bucket math, empty period, all-winners/all-losers, mixed
- `account_id=null` returns all-users (current behavior); `account_id=<x>` filters once Phase 2 lands
- `j2_day_notes` upsert — first write creates row, subsequent updates same row, attachments array length capped at 5

### 10.2 Frontend (vitest + RTL)

- `DayCell.test.jsx` — renders P&L correctly, applies right intensity class, shows notes badge when present, today border
- `MonthView.test.jsx` — generates correct grid for months starting on each weekday
- `YearView.test.jsx` — renders 52 columns × 7 rows, leap year handling
- `DayDetailPage.test.jsx` — renders day metrics + trade table; "No trades" empty state; reflection textarea auto-saves on debounce
- `useJ2Calendar.test.js` — SWR cache key stability across re-renders
- `lib/calendar.test.js` — `intensityClass()` brackets match spec table

### 10.3 Integration

- Click a populated day → routes to `/calendar/2026-04-19`, day metrics match what calendar cell showed
- Type notes → blur → toast "Saved" → reload page → notes still there
- Upload image → appears in attachments list → reload → still there
- Add a rule → check it off → reload → checked state persists

## 11. Migration / rollout

- DB: `CREATE TABLE IF NOT EXISTS j2_day_notes` — additive, no migration risk
- Settings: no changes
- Existing routes: untouched
- Frontend: new tab + new route, no change to Open Positions / Trade Journal / Community
- **Rollout**: ship to Railway. Calendar tab visible to all J2.0 users immediately. No feature flag — additive feature, low risk.

## 12. Phase 2 hooks (Accounts integration readiness)

Built into v1 so Phase 2 is plug-in:

- `account_id` query param accepted on every calendar endpoint (defaults to `NULL` = all accounts)
- `useJ2Calendar({ accountId })` already takes the parameter; v1 always passes `undefined`
- Day-notes are global per (user, date) — NOT scoped to account, intentional (see §2)
- When Phase 2 lands, the global Account selector in the header just feeds `accountId` into `useJ2Calendar`

## 13. Implementation phasing within Phase 1

Suggested commit cadence:

1. **Backend foundation** — `j2_day_notes` table + `/api/j2/calendar` endpoint + tests. No frontend yet.
2. **Calendar tab + Month view** — minimal: month grid with cells colored by % P&L, hover tooltip. No detail page yet (cells are non-clickable).
3. **Day detail page** — route + page layout + metrics row + trade table. No notes/attachments/rules yet.
4. **Reflection notes** — textarea + save endpoint + auto-save.
5. **Attachments** — link input + image upload + storage.
6. **Rules checklist** — add/check/edit/delete.
7. **Year + Week views** — add the two extra views to the toggle.
8. **Polish** — color-mode toggle ($ / % / R), keyboard nav on mini-cal, hover-tooltip refinement, mobile responsive pass.

Each step ships standalone to Railway and gets eyeballed. ~3-4 days total for an experienced dev; ~1 week with the polish pass.

## 14. Open questions (answered for now, revisitable)

| Q | A | Revisit when |
|---|---|---|
| Per-account notes? | No, global per-date | Real user demand |
| Image storage backend? | Local disk under `data/j2_attachments/` | Storage hits 1GB or Railway disk gets tight |
| Markdown editor? | Plain textarea v1 | Users complain |
| Year view density? | 14×14px cells | Doesn't fit on common widths |
| Reflection auto-save vs explicit Save button? | Auto-save (debounced) | Users report data loss anxiety |

---

**End of spec.** Ready for review.
