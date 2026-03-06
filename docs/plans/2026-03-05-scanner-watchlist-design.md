# UCT Scanner & Watchlist System — Design

**Date:** 2026-03-05
**Scope:** Three-phase system to surface scanner candidates in the dashboard, enrich them with UCT Intelligence analysis, and build toward a persistent watchlist.

---

## Problem

The existing `/screener` page shows the Leadership 20 reshuffled as a flat table — essentially the same data as UCT 20 with less context. It has no connection to the new `scanner_candidates.py` module, which already runs three setup scans (PULLBACK_MA, REMOUNT, GAPPER_NEWS) and writes `candidates.json` daily. There is no watchlist capability anywhere in the dashboard. Scanner output is invisible to the operator.

## Goal

Build a Scanner Hub that:
1. Surfaces `candidates.json` output in the dashboard, grouped by setup type
2. Enriches each candidate with UCT Intelligence analysis (grade, thesis, regime fit)
3. Evolves into a watchlist system where candidates are curated, persisted, and referenced throughout the dashboard and morning wire

---

## Phase 1 — Scanner Hub in Dashboard (current build)

### What Changes

**Backend — new endpoint:**
`GET /api/candidates` — reads `C:\Users\Patrick\uct-intelligence\data\candidates.json`, returns the full payload. TTL: 30 minutes. Falls back to empty structure if file missing.

**Frontend — upgrade existing Screener page:**
Replace the current Leadership-20-reshuffled table in `app/src/pages/Screener.jsx` with the Scanner Hub layout:

- **Header bar:** generated_at timestamp + leading sectors used + total candidate count
- **Three setup tabs:** Pullback MA | Remount | Gappers (tab switcher, Pullback active by default)
- **Candidate rows** (per tab): SetupBadge · TickerPopup(ticker) · company · sector · RSI · SMA distance · change% · also_qualified_as chips
- **Empty state:** "No candidates — scanner runs at 7:00 AM CT" with last-run timestamp
- **Refresh:** 30-minute polling via useSWR

No new page or route needed — the existing `/screener` route and NavBar entry are reused.

### Data Flow

```
scanner_candidates.py (7:00 AM CT)
  → writes data/candidates.json (uct-intelligence)
  → Morning wire engine reads it, includes in payload (optional Phase 1b)

GET /api/candidates (uct-dashboard FastAPI)
  → reads candidates.json from Railway volume or local path
  → returns {generated_at, leading_sectors_used, candidates: {pullback_ma, gapper_news, remount}, counts, scan_meta}

Screener.jsx
  → useSWR('/api/candidates', 30min refresh)
  → renders tab switcher + candidate rows
  → TickerPopup wraps each ticker for hover/modal chart
```

### Files Modified (Phase 1)

| File | Change |
|------|--------|
| `api/routers/screener.py` | Add `/api/candidates` endpoint |
| `api/services/engine.py` | Add `get_candidates()` — reads candidates.json, caches 30min |
| `app/src/pages/Screener.jsx` | Full replacement — Scanner Hub with tabs |
| `app/src/pages/Screener.module.css` | New styles for tabs, setup badges, candidate rows |

---

## Phase 2 — UCT Intelligence Analysis Enrichment (next)

### What It Does

After `scanner_candidates.py` completes its three scans, a post-scan enrichment step runs each candidate through the UCT Intelligence stack:

**Per-candidate analysis inputs:**
- `get_knowledge_context(setup_type, sector)` — matching KB entries for this setup + sector
- `get_regime_history(days=1)` — today's regime (phase, dist days, trend score)
- `earnings_in_days` — proximity warning if earnings within 7 days
- `get_leadership_snapshots(ticker)` — has this ticker appeared in UCT 20 recently?

**Per-candidate analysis outputs (added to each candidate dict):**
- `uct_grade`: "A+" / "A" / "B+" / "B" / "C" — setup quality given current regime
- `uct_thesis`: 1-2 sentence synthesis from KB (e.g. "Stage 2 leader in leading sector pulling back to rising 21 EMA on declining volume — textbook entry zone if market holds")
- `regime_fit`: "FAVORABLE" / "CAUTION" / "AVOID" — does the setup work in today's phase?
- `earnings_flag`: bool — true if earnings within 7 days
- `kb_match_count`: int — number of KB entries matched (confidence indicator)

**Implementation:** New function `enrich_candidates(candidates_dict)` in `scanner_candidates.py`. Called automatically at end of `run_scanner()`. Enriched data saved back to `candidates.json`.

**Dashboard:** Phase 2 adds UCT grade badge and one-line thesis to each candidate row in the Scanner Hub. Regime fit shown as colored label (green/yellow/red).

---

## Phase 3 — Watchlist Layer (future)

### Architecture

**New DB table** in `uct_intelligence.db`:
```sql
CREATE TABLE watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    added_date TEXT NOT NULL,
    source TEXT,           -- 'PULLBACK_MA', 'REMOUNT', 'MANUAL', etc.
    uct_grade TEXT,
    thesis TEXT,
    regime_fit TEXT,
    notes TEXT,
    status TEXT DEFAULT 'ACTIVE',  -- 'ACTIVE', 'TRIGGERED', 'REMOVED'
    entry_price REAL,
    stop_price REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**New API endpoints:**
- `GET /api/watchlist` — return active watchlist entries
- `POST /api/watchlist` — add ticker (from scanner or manual)
- `DELETE /api/watchlist/{ticker}` — remove / mark triggered

**New dashboard page:** `/watchlist` — persistent curated list with promote-from-scanner button on each candidate row in the Scanner Hub.

**Morning wire integration:** `payload["watchlist"]` injected before Claude call so the narrative can reference "your current watchlist names."

---

## Design Principles

- **Non-breaking:** Phase 1 replaces content in the existing Screener page — no route changes, no NavBar changes
- **Graceful degradation:** If `candidates.json` doesn't exist or is stale, show empty state with timestamp — never crash
- **Reuse existing patterns:** TickerPopup, TileCard, SetupBadge, useSWR polling — no new component primitives
- **Scanner is the source of truth:** Dashboard reads the file the scanner writes — no direct Finviz calls from the dashboard
- **Phase boundaries are clean:** Each phase ships independently and adds value without requiring the next phase
