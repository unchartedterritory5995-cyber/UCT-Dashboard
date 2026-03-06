# Scanner Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the existing Screener page (currently a plain Leadership-20 table) with a Scanner Hub that displays candidates from `scanner_candidates.py` grouped by setup type (Pullback MA / Remount / Gappers).

**Architecture:** The scanner writes `candidates.json` to `uct-intelligence/data/`. The morning wire engine includes it in the wire_data push payload under `payload["candidates"]`. The dashboard backend reads it via `get_candidates()` from wire_data (Railway) or the local file (dev). The frontend polls `/api/candidates` every 30 minutes and renders a tab-switched candidate list with TickerPopup integration.

**Tech Stack:** FastAPI (backend), React + CSS Modules (frontend), useSWR (data fetching), existing TickerPopup + TileCard components

---

## Task 1: Wire `candidates.json` into the Morning Wire Push Payload

The scanner already writes `candidates.json`. We need the morning wire engine to include it in the payload it pushes to the dashboard, so it's available on Railway.

**Files:**
- Modify: `C:\Users\Patrick\morning-wire\morning_wire_engine.py` — find the `run()` function where `payload` is assembled before the push

**Step 1: Find the payload assembly location**

Search for where `wire_data` or the push payload is built in `morning_wire_engine.py`:

```bash
grep -n "candidates\|wire_data\|payload\|push" C:\Users\Patrick\morning-wire\morning_wire_engine.py | head -40
```

**Step 2: Add candidates loading before the push**

In the `run()` function, after the scanner integration comment block (or just before the Vercel/Discord push calls), add:

```python
# ── Load scanner candidates into payload ──────────────────────────────────
import pathlib as _pl, json as _json
_candidates_path = _pl.Path(r"C:\Users\Patrick\uct-intelligence\data\candidates.json")
try:
    if _candidates_path.exists():
        data["candidates"] = _json.loads(_candidates_path.read_text(encoding="utf-8"))
        print(f"  [scanner] Loaded {data['candidates']['counts']['total']} candidates")
except Exception as _e:
    print(f"  [scanner] candidates.json load failed: {_e}")
```

**Step 3: Verify**

Run a dry test — check `data/wire_data.json` after an engine run to confirm `"candidates"` key is present.

**Step 4: Commit**

```bash
cd C:\Users\Patrick\morning-wire
git add morning_wire_engine.py
git commit -m "feat: include scanner candidates in wire_data push payload"
```

---

## Task 2: Add `get_candidates()` to Backend Service

**Files:**
- Modify: `C:\Users\Patrick\uct-dashboard\api\services\engine.py` — add after `get_screener()` at line 1222

**Step 1: Write the failing test**

Create `C:\Users\Patrick\uct-dashboard\tests\test_candidates.py`:

```python
"""Tests for get_candidates() service function."""
import pytest
from unittest.mock import patch
from api.services.engine import get_candidates
from api.services.cache import cache


def setup_function():
    cache.delete("candidates")


def test_returns_empty_structure_when_no_data():
    """Should return valid empty structure when wire_data has no candidates key."""
    with patch("api.services.engine.get_wire_data", return_value={}):
        result = get_candidates()
    assert result["candidates"]["pullback_ma"] == []
    assert result["candidates"]["gapper_news"] == []
    assert result["candidates"]["remount"] == []
    assert result["counts"]["total"] == 0


def test_returns_candidates_from_wire_data():
    """Should return candidates dict when wire_data contains candidates key."""
    mock_candidates = {
        "generated_at": "2026-03-05 07:00:00 CT",
        "market_date": "2026-03-05",
        "candidates": {
            "pullback_ma": [{"ticker": "NVDA", "price": 124.5, "setup_type": "PULLBACK_MA"}],
            "gapper_news": [],
            "remount": [],
        },
        "counts": {"pullback_ma": 1, "gapper_news": 0, "remount": 0, "total": 1},
        "scan_meta": {"errors": []},
    }
    with patch("api.services.engine.get_wire_data", return_value={"candidates": mock_candidates}):
        result = get_candidates()
    assert result["counts"]["total"] == 1
    assert result["candidates"]["pullback_ma"][0]["ticker"] == "NVDA"


def test_result_is_cached():
    """Second call should hit cache, not re-read wire_data."""
    mock_candidates = {
        "candidates": {"pullback_ma": [], "gapper_news": [], "remount": []},
        "counts": {"total": 0},
    }
    call_count = 0
    def mock_get_wire(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return {"candidates": mock_candidates}
    with patch("api.services.engine.get_wire_data", side_effect=mock_get_wire):
        get_candidates()
        get_candidates()
    assert call_count == 1  # second call served from cache
```

**Step 2: Run test to verify it fails**

```bash
cd C:\Users\Patrick\uct-dashboard
pytest tests/test_candidates.py -v
```

Expected: `ImportError` or `AttributeError` — `get_candidates` doesn't exist yet.

**Step 3: Add `get_candidates()` to engine.py**

Add after `get_screener()` (after line 1221):

```python
# ─── Candidates (scanner output) ──────────────────────────────────────────────

_EMPTY_CANDIDATES = {
    "generated_at": None,
    "market_date": None,
    "is_premarket_window": False,
    "leading_sectors_used": [],
    "leading_sectors_source": "none",
    "note": "",
    "candidates": {"pullback_ma": [], "gapper_news": [], "remount": []},
    "counts": {"pullback_ma": 0, "gapper_news": 0, "remount": 0, "total": 0},
    "scan_meta": {"skipped_rows": 0, "deduplicated_tickers": [], "runtime_seconds": 0, "errors": []},
}


def get_candidates() -> dict:
    """Return scanner candidates from wire_data push or local file fallback.

    Priority:
        1. Cache (1800s / 30min TTL)
        2. wire_data["candidates"] (set by morning wire engine push)
        3. Local candidates.json file (dev fallback)
        4. Empty structure (never raises)
    """
    cached = cache.get("candidates")
    if cached is not None:
        return cached

    result = None

    # 1. Try wire_data push (Railway production path)
    try:
        wire = get_wire_data()
        if wire and wire.get("candidates"):
            result = wire["candidates"]
            _logger.info("candidates: loaded from wire_data (%d total)", result.get("counts", {}).get("total", 0))
    except Exception as e:
        _logger.warning("candidates: wire_data read failed: %s", e)

    # 2. Try local file (dev path)
    if result is None:
        local_paths = [
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "uct-intelligence", "data", "candidates.json"),
            r"C:\Users\Patrick\uct-intelligence\data\candidates.json",
        ]
        for path in local_paths:
            try:
                if os.path.exists(path):
                    with open(path, encoding="utf-8") as f:
                        result = json.load(f)
                    _logger.info("candidates: loaded from local file %s", path)
                    break
            except Exception as e:
                _logger.warning("candidates: local file read failed (%s): %s", path, e)

    # 3. Fallback to empty structure
    if result is None:
        _logger.info("candidates: no data available, returning empty structure")
        result = _EMPTY_CANDIDATES.copy()

    cache.set("candidates", result, ttl=1800)
    return result
```

**Step 4: Run tests**

```bash
pytest tests/test_candidates.py -v
```

Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add api/services/engine.py tests/test_candidates.py
git commit -m "feat: add get_candidates() service with wire_data + local file fallback"
```

---

## Task 3: Add `/api/candidates` Endpoint

**Files:**
- Modify: `C:\Users\Patrick\uct-dashboard\api\routers\screener.py`

**Step 1: Add the endpoint**

Replace the full file content with:

```python
from fastapi import APIRouter, HTTPException
from api.services.engine import get_screener, get_candidates

router = APIRouter()


@router.get("/api/screener")
def screener():
    try:
        return get_screener()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/candidates")
def candidates():
    try:
        return get_candidates()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
```

**Step 2: Verify endpoint is live**

```bash
# Start the backend
cd C:\Users\Patrick\uct-dashboard
uvicorn api.main:app --reload --port 8000
```

In another terminal:
```bash
curl http://localhost:8000/api/candidates
```

Expected: JSON with `candidates`, `counts`, `scan_meta` keys (either real data or empty structure).

**Step 3: Commit**

```bash
git add api/routers/screener.py
git commit -m "feat: add /api/candidates endpoint"
```

---

## Task 4: Replace Screener.jsx with Scanner Hub

**Files:**
- Modify: `C:\Users\Patrick\uct-dashboard\app\src\pages\Screener.jsx` (full replacement)
- Modify: `C:\Users\Patrick\uct-dashboard\app\src\pages\Screener.module.css` (full replacement)

**Step 1: Replace Screener.jsx**

```jsx
import { useState } from 'react'
import useSWR from 'swr'
import TickerPopup from '../components/TickerPopup'
import styles from './Screener.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const TABS = [
  { key: 'pullback_ma', label: 'Pullback MA' },
  { key: 'remount',     label: 'Remount' },
  { key: 'gapper_news', label: 'Gappers' },
]

const BADGE_COLORS = {
  PULLBACK_MA: 'green',
  REMOUNT:     'blue',
  GAPPER_NEWS: 'amber',
}

function SetupBadge({ type }) {
  return (
    <span className={`${styles.badge} ${styles['badge_' + (BADGE_COLORS[type] || 'gray')]}`}>
      {type === 'PULLBACK_MA' ? 'PULLBACK' : type === 'GAPPER_NEWS' ? 'GAPPER' : type}
    </span>
  )
}

function CandidateRow({ c }) {
  const chg = c.change_pct ?? c.gap_pct
  const chgLabel = c.gap_pct != null ? `gap ${c.gap_pct > 0 ? '+' : ''}${c.gap_pct?.toFixed(1)}%`
                                     : chg != null ? `${chg > 0 ? '+' : ''}${chg?.toFixed(1)}%` : null

  return (
    <div className={styles.candidateRow}>
      <SetupBadge type={c.setup_type} />
      <TickerPopup sym={c.ticker}>
        <span className={styles.sym}>{c.ticker}</span>
      </TickerPopup>
      <div className={styles.meta}>
        {c.company && <span className={styles.company}>{c.company}</span>}
        {c.sector  && <span className={styles.sector}>{c.sector}</span>}
      </div>
      <div className={styles.stats}>
        {c.rsi != null && (
          <span className={styles.stat}>RSI <strong>{c.rsi.toFixed(1)}</strong></span>
        )}
        {c.sma20_dist_pct != null && (
          <span className={styles.stat}>
            SMA20 <strong className={c.sma20_dist_pct >= 0 ? styles.pos : styles.neg}>
              {c.sma20_dist_pct > 0 ? '+' : ''}{c.sma20_dist_pct.toFixed(1)}%
            </strong>
          </span>
        )}
        {chgLabel && (
          <span className={`${styles.stat} ${chg > 0 ? styles.pos : styles.neg}`}>
            {chgLabel}
          </span>
        )}
      </div>
      {c.also_qualified_as?.length > 0 && (
        <div className={styles.alsoChips}>
          {c.also_qualified_as.map(t => (
            <span key={t} className={styles.alsoChip}>+{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Screener() {
  const { data, mutate } = useSWR('/api/candidates', fetcher, { refreshInterval: 1800000 })
  const [activeTab, setActiveTab] = useState('pullback_ma')

  const candidates = data?.candidates ?? {}
  const counts     = data?.counts ?? {}
  const meta       = data?.scan_meta ?? {}
  const rows       = candidates[activeTab] ?? []

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.heading}>Scanner</h1>
        <div className={styles.headerRight}>
          {data?.generated_at && (
            <span className={styles.timestamp}>
              {data.generated_at}
              {data.leading_sectors_used?.length > 0 && (
                <> · {data.leading_sectors_used.join(', ')}</>
              )}
            </span>
          )}
          <button className={styles.refreshBtn} onClick={() => mutate()}>Refresh</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
            <span className={styles.tabCount}>{counts[t.key] ?? 0}</span>
          </button>
        ))}
        <span className={styles.totalCount}>{counts.total ?? 0} total</span>
      </div>

      {/* Candidate list */}
      <div className={styles.list}>
        {!data ? (
          <p className={styles.empty}>Loading scanner…</p>
        ) : rows.length === 0 ? (
          <p className={styles.empty}>
            No {TABS.find(t => t.key === activeTab)?.label} candidates
            {meta.errors?.length > 0 && ` · ${meta.errors.length} scan error(s)`}
            {!data.generated_at && ' · Scanner runs at 7:00 AM CT'}
          </p>
        ) : (
          rows.map(c => <CandidateRow key={c.ticker} c={c} />)
        )}
      </div>

      {/* Footer meta */}
      {meta.runtime_seconds > 0 && (
        <div className={styles.footer}>
          {meta.runtime_seconds}s runtime · {meta.skipped_rows} skipped
          {meta.deduplicated_tickers?.length > 0 && (
            <> · deduped: {meta.deduplicated_tickers.join(', ')}</>
          )}
        </div>
      )}

    </div>
  )
}
```

**Step 2: Replace Screener.module.css**

```css
/* ── Page layout ──────────────────────────────────────────────────────── */
.page { padding: 20px 24px; display: flex; flex-direction: column; gap: 0; }

.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.heading { font-family: 'Cinzel', serif; font-size: 22px; font-weight: 800; color: var(--ut-gold); letter-spacing: 4px; text-transform: uppercase; margin: 0; }
.headerRight { display: flex; align-items: center; gap: 12px; }
.timestamp { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-muted); }

.refreshBtn { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 1px; background: var(--bg-elevated); color: var(--ut-green-bright); border: 1px solid var(--ut-green); border-radius: 6px; padding: 6px 14px; cursor: pointer; transition: background 0.15s; }
.refreshBtn:hover { background: var(--ut-green-dim); }

/* ── Tab bar ─────────────────────────────────────────────────────────── */
.tabs { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 0; padding-bottom: 0; }

.tab { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 1px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); padding: 8px 14px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: color 0.15s; margin-bottom: -1px; }
.tab:hover { color: var(--text-bright); }
.tabActive { color: var(--ut-gold) !important; border-bottom-color: var(--ut-gold) !important; }

.tabCount { font-size: 9px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 1px 6px; color: var(--text-muted); }
.tabActive .tabCount { color: var(--ut-gold); border-color: var(--ut-gold); }

.totalCount { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-muted); margin-left: auto; padding-right: 4px; }

/* ── Candidate list ──────────────────────────────────────────────────── */
.list { display: flex; flex-direction: column; }

.candidateRow { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.candidateRow:last-child { border-bottom: none; }
.candidateRow:hover { background: var(--bg-hover); margin: 0 -8px; padding-left: 8px; padding-right: 8px; }

/* ── Setup badge ─────────────────────────────────────────────────────── */
.badge { font-family: 'IBM Plex Mono', monospace; font-size: 8px; font-weight: 700; letter-spacing: 1px; border-radius: 4px; padding: 2px 6px; text-transform: uppercase; white-space: nowrap; }
.badge_green  { background: rgba(0,200,100,0.12); color: var(--ut-green-bright); border: 1px solid var(--ut-green); }
.badge_blue   { background: rgba(80,140,255,0.12); color: #7eb8ff; border: 1px solid #4a80cc; }
.badge_amber  { background: rgba(230,180,50,0.12); color: var(--ut-gold); border: 1px solid var(--ut-gold); }
.badge_gray   { background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border); }

/* ── Ticker ──────────────────────────────────────────────────────────── */
.sym { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 800; color: var(--ut-cream); cursor: pointer; min-width: 60px; }
.sym:hover { color: var(--ut-gold); }

/* ── Meta (company + sector) ─────────────────────────────────────────── */
.meta { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.company { font-family: 'Instrument Sans', sans-serif; font-size: 11px; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sector { font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: var(--text-muted); letter-spacing: 0.5px; }

/* ── Stats ───────────────────────────────────────────────────────────── */
.stats { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.stat { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--text-muted); white-space: nowrap; }
.stat strong { color: var(--text-bright); }
.pos { color: var(--ut-green-bright) !important; }
.neg { color: var(--ut-red, #e05555) !important; }

/* ── Also-qualified chips ────────────────────────────────────────────── */
.alsoChips { display: flex; gap: 4px; }
.alsoChip { font-family: 'IBM Plex Mono', monospace; font-size: 8px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }

/* ── Footer ──────────────────────────────────────────────────────────── */
.footer { font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: var(--text-muted); padding: 12px 0 4px; border-top: 1px solid var(--border); margin-top: 8px; }

/* ── Empty / loading ─────────────────────────────────────────────────── */
.empty { font-family: 'Instrument Sans', sans-serif; font-size: 13px; color: var(--text-muted); padding: 24px 0; text-align: center; }
```

**Step 3: Start dev servers and verify**

```bash
# Terminal 1 — backend
cd C:\Users\Patrick\uct-dashboard
uvicorn api.main:app --reload --port 8000

# Terminal 2 — frontend
cd C:\Users\Patrick\uct-dashboard\app
npm run dev
```

Open `http://localhost:5173/screener` — should show:
- "Scanner" heading in gold
- Three tabs: Pullback MA / Remount / Gappers with counts
- Real candidate rows from `candidates.json`
- Each ticker opens TickerPopup chart on click

**Step 4: Commit**

```bash
git add app/src/pages/Screener.jsx app/src/pages/Screener.module.css
git commit -m "feat: replace Screener page with Scanner Hub (tabs + candidate rows)"
```

---

## Task 5: Deploy to Railway

**Step 1: Build frontend**

```bash
cd C:\Users\Patrick\uct-dashboard\app
npm run build
```

Expected: `dist/` folder updated, no errors.

**Step 2: Push to Railway**

```bash
cd C:\Users\Patrick\uct-dashboard
git push origin main
```

Railway auto-deploys on push. Watch deploy logs for errors.

**Step 3: Verify production**

Open `https://web-production-05cb6.up.railway.app/screener` — confirm Scanner Hub loads with candidate data (may show empty state if scanner hasn't run today yet — that's correct).

---

## Phase 2 Preview (not in this plan — future task)

After Phase 1 is deployed, the next step is UCT Intelligence enrichment:
- Post-scan: run each candidate through `get_knowledge_context(setup_type, sector)` + regime check
- Add `uct_grade`, `uct_thesis`, `regime_fit` fields to each candidate in `candidates.json`
- Dashboard shows grade badge + thesis line under each candidate row
- See `docs/plans/2026-03-05-scanner-watchlist-design.md` for full Phase 2 spec
