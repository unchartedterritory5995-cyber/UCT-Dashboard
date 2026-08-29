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
    # Override exists so a local stack can point at a scratch copy instead of
    # the real volume — the same escape hatch TWEET_DB_PATH and
    # BREADTH_INTRADAY_DB provide. On this dev box `/data` resolves to C:\data,
    # which is shared with running services, so without it there is no way to
    # seed a throwaway history for a browser pass.
    override = os.environ.get("BREADTH_MONITOR_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/breadth_monitor.db"
    # Local dev: project root / data /
    local = Path(__file__).parent.parent.parent / "data" / "breadth_monitor.db"
    local.parent.mkdir(exist_ok=True)
    return str(local)


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_db_path(), timeout=10)
    c.row_factory = sqlite3.Row
    # WAL so a breadth push write doesn't block dashboard reads (and vice-versa).
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA busy_timeout=5000")
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
        from api.services.cache import cache
        cache.delete_prefix("breadth_history_")  # fresh data → drop cached history
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


# A component only counts toward the score if its input is actually present.
# See `_score_breakdown`.
_SCORE_WEIGHTS = {
    "pct_above_50sma": 20, "ratio_5day": 15, "magna": 10, "hi_ratio": 10,
    "cboe_putcall": 10, "aaii_spread": 10, "vix": 10, "stage2": 10, "adv_decline": 5,
}

_SCORE_LABELS = {
    "pct_above_50sma": "% above 50 SMA", "ratio_5day": "5-day up/down ratio",
    "magna": "13%/34d up share", "hi_ratio": "52w highs / universe",
    "cboe_putcall": "CBOE put/call (contrarian)", "aaii_spread": "AAII spread (contrarian)",
    "vix": "VIX (inverted)", "stage2": "Stage 2 share", "adv_decline": "Advance/decline",
}

# Below this much available weight the remainder is not a market read, it is a
# handful of inputs extrapolated to a 0-100 headline. Say nothing instead.
_SCORE_MIN_WEIGHT = 60


def _score_breakdown(row: dict) -> tuple[Optional[float], list[dict]]:
    """Composite breadth score 0-100 AND the per-component attribution, from one
    pass. The total and the breakdown can never disagree because there is only
    one calculation.

    ⚠️ RENORMALIZED over the inputs that are actually present. `_lerp(None)`
    returns 0, so before 2026-08-07 a MISSING component scored the same as a
    maximally bearish one: absence was indistinguishable from the worst possible
    reading. Measured on real rows, one absent input cost 10-15 points of a
    0-100 headline — 2026-08-07 reads 95.3, or 85.3 with only `cboe_putcall`
    missing. That mattered immediately, because cboe_putcall legitimately
    returns None whenever CBOE has not published by the 4:15 PM collector run.

    Same family as the NAAIM freeze: a gap rendered as a number nobody can
    tell apart from data. Now a component that cannot be measured is dropped
    from BOTH sides of the ratio, and the score reports what the available
    inputs actually say.
    """
    earned = 0.0
    have = 0
    components: list[dict] = []

    def take(key, val, lo, hi):
        nonlocal earned, have
        present = val is not None
        pts = 0.0
        if present:
            have += _SCORE_WEIGHTS[key]
            pts = _lerp(val, lo, hi, _SCORE_WEIGHTS[key])
            earned += pts
        components.append({
            "key": key, "label": _SCORE_LABELS[key], "weight": _SCORE_WEIGHTS[key],
            "points": pts, "max_points": _SCORE_WEIGHTS[key],
            "present": present, "value": val,
        })

    take("pct_above_50sma", row.get("pct_above_50sma"), 30, 65)
    take("ratio_5day", row.get("ratio_5day"), 0.7, 1.5)

    mu, md = row.get("magna_up"), row.get("magna_down")
    take("magna", (mu / (mu + md) * 100) if (mu is not None and md is not None
                                             and (mu + md) > 0) else None, 40, 70)

    take("hi_ratio", row.get("hi_ratio"), 0.5, 5.0)
    # Contrarian: a higher put/call is more fearful, which is a better setup.
    take("cboe_putcall", row.get("cboe_putcall"), 0.65, 0.85)
    # Contrarian: invert, so a -30 spread (very bearish) earns full points.
    spread = row.get("aaii_spread")
    take("aaii_spread", (-spread) if spread is not None else None, -30, 20)
    vix = row.get("vix")
    take("vix", (30 - vix) if vix is not None else None, 0, 12)

    s2, uni = row.get("stage2_count"), row.get("universe_count")
    take("stage2", (s2 / uni * 100) if (s2 is not None and uni and uni > 0) else None, 5, 25)

    # Binary, not interpolated: the advance/decline component is a coin flip on
    # the sign, which is why it cannot go through `take`'s lerp.
    ad = row.get("adv_decline")
    ad_pts = 0.0
    if ad is not None:
        have += _SCORE_WEIGHTS["adv_decline"]
        if ad > 0:
            ad_pts = float(_SCORE_WEIGHTS["adv_decline"])
            earned += ad_pts
    components.append({
        "key": "adv_decline", "label": _SCORE_LABELS["adv_decline"],
        "weight": _SCORE_WEIGHTS["adv_decline"], "points": ad_pts,
        "max_points": _SCORE_WEIGHTS["adv_decline"],
        "present": ad is not None, "value": ad,
    })

    if have < _SCORE_MIN_WEIGHT:
        return None, components
    return round(min(100, max(0, earned / have * 100)), 1), components


def _compute_breadth_score(row: dict) -> Optional[float]:
    """Composite market breadth health score 0-100. See `_score_breakdown`."""
    return _score_breakdown(row)[0]


def score_components(date: str, days: int = 90) -> dict:
    """The score attribution for `date`, plus the prior session's, so a caller
    can draw the delta in one request. An unrecorded date answers ok:false —
    absence is not an error, same as `session_path`.

    `days` is the window the CLIENT already loaded, not a window of this
    function's own choosing. `get_history` caches five minutes PER `days` value
    and startup warms only `days=90`; the Views tab legitimately produces
    90/180/365. A hardcoded 400 here was therefore a fourth window nothing warms
    and no other surface shares, so every five minutes the first Attribution
    render paid a cold ~415-row fetch plus a full derivation pass on a
    single-process pod, with no single-flight guard in front of it. Taking the
    caller's window makes this share a cache entry the page has already paid
    for. (`get_history` was measured spiking 28s uncached — see CLAUDE.md.)
    """
    hist = get_history(days)
    idx = next((i for i, r in enumerate(hist) if r.get("date") == date), None)
    if idx is None:
        return {"ok": False, "date": date, "reason": "no stored session for that date"}

    total, components = _score_breakdown(hist[idx])
    prev = None
    if idx + 1 < len(hist):
        p_total, p_components = _score_breakdown(hist[idx + 1])
        prev = {"date": hist[idx + 1].get("date"), "total": p_total, "components": p_components}

    return {
        "ok": True, "date": date, "total": total,
        "min_weight_met": total is not None,
        "components": components, "prev": prev,
    }


# The derivation loop below reaches BACKWARD past the row it is computing:
# `w10` needs 9 prior rows, `qqq_day_pct` needs 1, and the `is_ftd` drawdown
# window reaches 15. Fetching exactly `days` rows meant the oldest rows of every
# fetch were computed against a truncated window, so the SAME DATE returned
# different numbers depending on how many days the caller asked for. Measured
# 2026-08-08, days=30 vs days=200 over their 30-day overlap:
#
#     ratio_5day       4/30 disagreed   (2026-06-26: 3.77 vs 1.16)
#     ratio_10day      9/30
#     avg_10d_cpc      8/30             (None vs 0.92 — a manufactured absence)
#     breadth_score    2/30             (89.9 vs 83.5; it consumes the above)
#
# Worst case was `get_latest()`, which calls get_history(1): every rolling
# metric on the newest row came from a single row, `qqq_day_pct` was forced to
# None by the i==0 branch, and `is_ftd` could never fire because of `i >= 3`.
_ROLLING_WARMUP = 15


def get_history(days: int = 90) -> list:
    """Return last N trading days, newest first. Ratios computed from stored data.

    Fetches `days + _ROLLING_WARMUP` rows, derives over all of them, and returns
    only the newest `days`. The warm-up rows exist to be looked back AT, never
    to be returned — that is what makes a derived value a property of its date
    rather than of the request.

    Cached (5 min) keyed by `days`: breadth data updates once daily (afternoon
    push), so this recomputed the full rolling-metric pass on EVERY request for
    no benefit — costly under load and the reason the /api/breadth-monitor cold
    hit was slow. 5-min staleness is imperceptible for daily data.
    """
    from api.services.cache import cache
    ck = f"breadth_history_{days}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT date, metrics, created_at FROM breadth_snapshots ORDER BY date DESC LIMIT ?",
                (days + _ROLLING_WARMUP,),
            ).fetchall()
            # The cumulative A/D line has no window — it is a running total from
            # the first snapshot ever stored. Seeding it at 0 at whatever row the
            # fetch happened to start on made it disagree with itself on all 30
            # overlapping dates (1538 vs 11640). Sum the rows we did not fetch.
            adv_decline_seed = 0
            if rows:
                adv_decline_seed = c.execute(
                    "SELECT COALESCE(SUM(json_extract(metrics, '$.adv_decline')), 0) "
                    "FROM breadth_snapshots WHERE date < ?",
                    (rows[-1]["date"],),
                ).fetchone()[0] or 0
    except Exception as e:
        print(f"[breadth_monitor] get_history error: {e}")
        return []

    result = []
    for row in rows:
        m = json.loads(row["metrics"])
        m["date"] = row["date"]
        m["_created_at"] = row["created_at"]   # expose for "last updated" display
        # Strip large list keys — served on demand via drill endpoint
        for k in [k for k in list(m.keys()) if k.endswith("_list")]:
            del m[k]
        result.append(m)

    # Need oldest-first to compute rolling windows, then reverse back
    result_asc = list(reversed(result))

    adv_decline_cum = adv_decline_seed  # running total from the FIRST snapshot

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

        # Manual override: allow PATCH /field to force is_ftd on a specific date
        if row.get("manual_ftd") is True:
            row["is_ftd"] = True

        row["breadth_score"] = _compute_breadth_score(row)

    # Return newest-first, dropping the warm-up rows off the OLD end. They were
    # fetched to be looked back at, not to be served.
    out = list(reversed(result_asc))[:days]
    cache.set(ck, out, ttl=300)
    return out


def derive_live_row(metrics: dict, recent: list) -> dict:
    """Give a provisional intraday row the derived fields `get_history` adds.

    `recent` is stored history, newest first. The rolling ratios, the hi/lo
    ratios, the day-change percentages and the composite score are computed
    here by the SAME functions the stored rows go through — a live breadth
    score produced by a second implementation would be a different score
    wearing the same name, which is the whole failure this design exists to
    avoid.

    `is_ftd` is deliberately never set true intraday: a Follow-Through Day is a
    statement about a finished session's close and volume, so calling one at
    11 AM would be a guess dressed as a signal.
    """
    row = dict(metrics)
    asc = list(reversed(recent))                    # oldest first
    row["ratio_5day"] = _ratio(asc[-4:] + [row], "up_4pct_today", "down_4pct_today")
    row["ratio_10day"] = _ratio(asc[-9:] + [row], "up_4pct_today", "down_4pct_today")
    # The put/call print is an EOD number, so today's 10-day average is still
    # the one the last stored row carries — not a window with a value repeated.
    row["avg_10d_cpc"] = recent[0].get("avg_10d_cpc") if recent else None

    uni = row.get("universe_count")
    for src, dst in (("new_52w_highs", "hi_ratio"), ("new_52w_lows", "lo_ratio")):
        n = row.get(src)
        row[dst] = round(n / uni * 100, 2) if n is not None and uni else None

    prev = recent[0] if recent else {}
    for sym in ("qqq", "spy"):
        curr_c, prev_c = row.get(f"{sym}_close"), prev.get(f"{sym}_close")
        row[f"{sym}_day_pct"] = (round((curr_c - prev_c) / prev_c * 100, 2)
                                 if curr_c and prev_c else None)

    ad, cum = row.get("adv_decline"), prev.get("adv_decline_cum")
    row["adv_decline_cum"] = (cum + ad) if ad is not None and cum is not None else None

    row["is_ftd"] = False
    row["breadth_score"] = _compute_breadth_score(row)
    return row


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
        from api.services.cache import cache
        cache.delete_prefix("breadth_history_")
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
        from api.services.cache import cache
        cache.delete_prefix("breadth_history_")
        return cur.rowcount > 0
    except Exception as e:
        print(f"[breadth_monitor] delete_snapshot error: {e}")
        return False


def get_latest() -> Optional[dict]:
    history = get_history(1)
    return history[0] if history else None


# ── Scanner universe ──────────────────────────────────────────────────────────

# Maps DB list key → short tag shown in the Custom Scan filter/table
_UNIVERSE_LIST_TAGS = {
    "new_52w_highs_list":    "52wh",
    "new_ath_list":          "ath",
    "new_20d_highs_list":    "20dh",
    "hvc_52w_list":          "hvc",
    "stage2_list":           "s2",
    "stage4_list":           "s4",
    "up_50pct_month_list":   "up50m",
    "up_25pct_month_list":   "up25m",
    "up_25pct_quarter_list": "up25q",
    "magna_up_list":         "magna",
    "up_4pct_today_list":    "up4d",
    "down_4pct_today_list":  "dn4d",
    "new_52w_lows_list":     "52wl",
}


def get_universe_stocks(date_str: str = None) -> dict:
    """Pool all named *_list fields from the latest (or given) breadth snapshot.

    Returns a dict with:
      date          -- snapshot date (YYYY-MM-DD)
      universe_count-- total universe size tracked by breadth collector
      stocks        -- list of {ticker, name, close, vr, a50, atr, pct_1d, tags[]}
                       only stocks appearing in at least one named list are included
    """
    try:
        with _conn() as c:
            if date_str:
                row = c.execute(
                    "SELECT date, metrics FROM breadth_snapshots WHERE date = ?", (date_str,)
                ).fetchone()
            else:
                row = c.execute(
                    "SELECT date, metrics FROM breadth_snapshots ORDER BY date DESC LIMIT 1"
                ).fetchone()
        if not row:
            return {"date": None, "universe_count": 0, "stocks": []}

        snap_date = row["date"]
        m = json.loads(row["metrics"])

        # Build 1d-pct lookup from universe_list (contains ALL stocks)
        pct_map: dict = {}
        for item in (m.get("universe_list") or []):
            t = item.get("t")
            if t:
                pct_map[t] = item.get("pct", 0.0)

        # Pool all named lists → merge by ticker
        stocks: dict = {}
        for list_key, tag in _UNIVERSE_LIST_TAGS.items():
            for item in (m.get(list_key) or []):
                t = item.get("t")
                if not t:
                    continue
                if t not in stocks:
                    stocks[t] = {
                        "ticker": t,
                        "name":   item.get("n") or "",
                        "close":  item.get("c"),
                        "vr":     item.get("vr"),
                        "a50":    item.get("a50"),
                        "atr":    item.get("atr"),
                        "pct_1d": pct_map.get(t, item.get("pct", 0.0)),
                        "tags":   [],
                    }
                stocks[t]["tags"].append(tag)
                # Fill missing enrichment fields from whichever list has them
                s = stocks[t]
                if not s["name"]  and item.get("n"):  s["name"]  = item["n"]
                if s["close"] is None and item.get("c"):   s["close"] = item["c"]
                if s["vr"]    is None and item.get("vr"):  s["vr"]   = item["vr"]
                if s["a50"]   is None and item.get("a50") is not None: s["a50"] = item["a50"]
                if s["atr"]   is None and item.get("atr"): s["atr"]  = item["atr"]

        stock_list = sorted(stocks.values(), key=lambda x: x["ticker"])
        return {
            "date":            snap_date,
            "universe_count":  m.get("universe_count", 0),
            "stocks":          stock_list,
        }
    except Exception as e:
        print(f"[breadth_monitor] get_universe_stocks error: {e}")
        return {"date": None, "universe_count": 0, "stocks": []}


def get_drill_list(date_str: str, metric_key: str) -> Optional[list]:
    """Return a single *_list metric for a given date, or None if not found."""
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metrics FROM breadth_snapshots WHERE date = ?", (date_str,)
            ).fetchone()
            if not row:
                return None
            m = json.loads(row["metrics"])
            return m.get(metric_key)
    except Exception as e:
        print(f"[breadth_monitor] get_drill_list error: {e}")
        return None
