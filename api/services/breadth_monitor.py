"""api/services/breadth_monitor.py

SQLite service for the UCT Market Breadth Monitor.

DB location:
  Railway (persistent volume): /data/breadth_monitor.db
  Local dev:                   data/breadth_monitor.db (project root)

Schema:
  breadth_snapshots
    date        TEXT PRIMARY KEY  -- YYYY-MM-DD
    metrics     JSON NOT NULL     -- dict of all collected metrics
    created_at  TEXT              -- UTC timestamp
"""

import json
import os
import sqlite3
from pathlib import Path
from typing import Optional

# ── DB path ───────────────────────────────────────────────────────────────────

def _db_path() -> str:
    if os.path.exists("/data"):
        return "/data/breadth_monitor.db"
    # Local dev: project root / data /
    local = Path(__file__).parent.parent.parent / "data" / "breadth_monitor.db"
    local.parent.mkdir(exist_ok=True)
    return str(local)


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_db_path())
    c.row_factory = sqlite3.Row
    return c


# ── Init ──────────────────────────────────────────────────────────────────────

def init_db() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS breadth_snapshots (
                date       TEXT PRIMARY KEY,
                metrics    TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        c.commit()


# ── Write ─────────────────────────────────────────────────────────────────────

def store_snapshot(date_str: str, metrics: dict) -> bool:
    try:
        with _conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO breadth_snapshots (date, metrics) VALUES (?, ?)",
                (date_str, json.dumps(metrics)),
            )
            c.commit()
        return True
    except Exception as e:
        print(f"[breadth_monitor] store error: {e}")
        return False


# ── Read ──────────────────────────────────────────────────────────────────────

def _lerp(val, lo, hi, max_pts):
    """Linear interpolation: map val in [lo..hi] -> [0..max_pts], clamped."""
    if val is None:
        return 0
    if val <= lo:
        return 0
    if val >= hi:
        return max_pts
    return round((val - lo) / (hi - lo) * max_pts, 1)


def _compute_breadth_score(row: dict) -> Optional[float]:
    """Composite market breadth health score 0-100."""
    score = 0.0

    # 1. % above 50 SMA (20pts)
    score += _lerp(row.get("pct_above_50sma"), 30, 65, 20)

    # 2. 5-day up/down ratio (15pts)
    score += _lerp(row.get("ratio_5day"), 0.7, 1.5, 15)

    # 3. MAGNA ratio — up / (up + down) (10pts)
    mu = row.get("magna_up")
    md = row.get("magna_down")
    if mu is not None and md is not None and (mu + md) > 0:
        score += _lerp(mu / (mu + md) * 100, 40, 70, 10)

    # 4. 52W Hi ratio % (10pts)
    score += _lerp(row.get("hi_ratio"), 0.5, 5.0, 10)

    # 5. CBOE P/C contrarian (10pts) — higher P/C = more fearful = bullish setup
    score += _lerp(row.get("cboe_putcall"), 0.65, 0.85, 10)

    # 6. AAII Spread contrarian (10pts) — more bearish spread = more bullish setup
    spread = row.get("aaii_spread")
    if spread is not None:
        score += _lerp(-spread, -30, 20, 10)  # invert: -30 spread (very bearish) maps to 10pts

    # 7. VIX (10pts) — lower VIX = calmer market = higher score
    vix = row.get("vix")
    if vix is not None:
        score += _lerp(30 - vix, 0, 12, 10)  # 30-VIX: VIX=18 -> 12pts input -> 10pts out

    # 8. Stage 2 % of universe (10pts)
    s2 = row.get("stage2_count")
    uni = row.get("universe_count")
    if s2 is not None and uni and uni > 0:
        score += _lerp(s2 / uni * 100, 5, 25, 10)

    # 9. Daily A/D direction (5pts)
    ad = row.get("adv_decline")
    if ad is not None and ad > 0:
        score += 5

    return round(min(100, max(0, score)), 1)


def get_history(days: int = 90) -> list:
    """Return last N trading days, newest first. Ratios computed from stored data."""
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT date, metrics, created_at FROM breadth_snapshots ORDER BY date DESC LIMIT ?",
                (days,),
            ).fetchall()
    except Exception as e:
        print(f"[breadth_monitor] get_history error: {e}")
        return []

    result = []
    for row in rows:
        m = json.loads(row["metrics"])
        m["date"] = row["date"]
        m["_created_at"] = row["created_at"]   # expose for "last updated" display
        result.append(m)

    # Need oldest-first to compute rolling windows, then reverse back
    result_asc = list(reversed(result))

    adv_decline_cum = 0  # running total for cumulative A/D line

    for i, row in enumerate(result_asc):
        w5  = result_asc[max(0, i - 4):  i + 1]
        w10 = result_asc[max(0, i - 9):  i + 1]

        # Existing rolling metrics
        row["ratio_5day"]  = _ratio(w5,  "up_4pct_today", "down_4pct_today")
        row["ratio_10day"] = _ratio(w10, "up_4pct_today", "down_4pct_today")
        row["avg_10d_cpc"] = _rolling_avg(w10, "cboe_putcall", 2)

        # Hi/Lo ratio: new 52W highs as % of universe
        nh = row.get("new_52w_highs")
        nl = row.get("new_52w_lows")
        uni = row.get("universe_count")
        if nh is not None and uni and uni > 0:
            row["hi_ratio"] = round(nh / uni * 100, 2)
        else:
            row["hi_ratio"] = None
        if nl is not None and uni and uni > 0:
            row["lo_ratio"] = round(nl / uni * 100, 2)
        else:
            row["lo_ratio"] = None

        # Day-over-day % change for QQQ and SPY
        if i > 0:
            prev = result_asc[i - 1]
            for sym in ("qqq", "spy"):
                curr_c = row.get(f"{sym}_close")
                prev_c = prev.get(f"{sym}_close")
                if curr_c and prev_c and prev_c != 0:
                    row[f"{sym}_day_pct"] = round((curr_c - prev_c) / prev_c * 100, 2)
                else:
                    row[f"{sym}_day_pct"] = None
        else:
            row["qqq_day_pct"] = None
            row["spy_day_pct"] = None

        # Cumulative A/D line
        ad = row.get("adv_decline")
        if ad is not None:
            adv_decline_cum += ad
            row["adv_decline_cum"] = adv_decline_cum
        else:
            row["adv_decline_cum"] = None

        # FTD detection: simplified O'Neil Follow-Through Day
        # Criteria: QQQ up >= 1.25% on above-avg volume, on Day 4+ of rally from a prior trough
        row["is_ftd"] = False
        qqq_pct = row.get("qqq_day_pct")
        up_vol   = row.get("up_vol_ratio")
        if qqq_pct is not None and qqq_pct >= 1.25 and up_vol is not None and up_vol >= 1.3 and i >= 3:
            # Walk backwards from the PRIOR day (j=i-1) counting consecutive up days
            rally_days = 1  # count current day
            for j in range(i - 1, max(i - 10, -1), -1):
                prev_pct = result_asc[j].get("qqq_day_pct")
                if prev_pct is not None and prev_pct > 0:
                    rally_days += 1
                else:
                    break
            # Check drawdown: use closes BEFORE the current day's rally (exclude current day)
            window = result_asc[max(0, i - 15): i]  # exclude current day
            prior_closes = [r.get("qqq_close") for r in window if r.get("qqq_close")]
            if prior_closes and len(prior_closes) >= 4:
                recent_high = max(prior_closes)
                recent_low  = min(prior_closes)
                drawdown = (recent_low - recent_high) / recent_high * 100
                if rally_days >= 4 and drawdown <= -3.0:
                    row["is_ftd"] = True

        row["breadth_score"] = _compute_breadth_score(row)

    # Return newest-first
    return list(reversed(result_asc))


def _rolling_avg(window: list, key: str, decimals: int = 1) -> Optional[float]:
    vals = [r[key] for r in window if r.get(key) is not None]
    if len(vals) < 3:
        return None
    return round(sum(vals) / len(vals), decimals)


def _ratio(window: list, key_up: str, key_dn: str) -> Optional[float]:
    ups = [r[key_up] for r in window if r.get(key_up) is not None]
    dns = [r[key_dn] for r in window if r.get(key_dn) is not None]
    if not ups or not dns:
        return None
    total_dn = sum(dns)
    if total_dn == 0:
        return None
    return round(sum(ups) / total_dn, 2)


def patch_field(date_str: str, key: str, value) -> bool:
    """Update a single field in an existing snapshot's metrics JSON."""
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metrics FROM breadth_snapshots WHERE date = ?", (date_str,)
            ).fetchone()
            if not row:
                return False
            m = json.loads(row["metrics"])
            m[key] = value
            c.execute(
                "UPDATE breadth_snapshots SET metrics = ? WHERE date = ?",
                (json.dumps(m), date_str),
            )
            c.commit()
        return True
    except Exception as e:
        print(f"[breadth_monitor] patch_field error: {e}")
        return False


def delete_snapshot(date_str: str) -> bool:
    """Delete a snapshot row by date. Returns True if a row was deleted."""
    try:
        with _conn() as c:
            cur = c.execute(
                "DELETE FROM breadth_snapshots WHERE date = ?", (date_str,)
            )
            c.commit()
        return cur.rowcount > 0
    except Exception as e:
        print(f"[breadth_monitor] delete_snapshot error: {e}")
        return False


def get_latest() -> Optional[dict]:
    history = get_history(1)
    return history[0] if history else None
