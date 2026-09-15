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
import math
import os
import sqlite3
from bisect import bisect_left, bisect_right
from pathlib import Path
from typing import Optional

# Deep history (reconstructed pre-2026 rows merged in from breadth_daily_ohlc +
# imported sentiment). On by default; set BREADTH_DEEP_HISTORY=0 to make the
# Monitor fall back to the collector-only window with no rebuild.
_DEEP_ENABLED = os.environ.get("BREADTH_DEEP_HISTORY", "1") != "0"

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
        # ⭐ THE NUMERIC PROJECTION — one row per session, the SAME dict a history
        # read ends up with, minus nothing and plus nothing. Measured on the
        # production copy: the blob averages 636,834 bytes of which 99.7 % is
        # `*_list` ticker arrays that every history read parses and immediately
        # deletes; the projection of all 174 sessions is 0.25 MB in total.
        #
        # ⛔ A JSON COLUMN, NOT ~70 TYPED COLUMNS, and the reason is drift rather
        # than convenience. `metrics` has no fixed schema — the newest production
        # row carries 92 keys and older ones carry fewer — so a column list would
        # be a SECOND AUTHORITY over "which metrics exist", and the failure mode
        # is silent: a metric the collector starts writing tomorrow would simply
        # not be stored, and the reader would serve a column of nulls that looks
        # like a quiet market. It is also the shape the readers already consume:
        # `_history_uncached` does `json.loads(...)` then deletes the list keys,
        # so reading this column IS that expression with the expensive half gone.
        c.execute("""
            CREATE TABLE IF NOT EXISTS breadth_snapshot_numeric (
                date       TEXT PRIMARY KEY,
                metrics    TEXT NOT NULL,
                source     TEXT NOT NULL DEFAULT 'collector',
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_bsn_source ON breadth_snapshot_numeric(source)")
        c.commit()


# ── The numeric projection ────────────────────────────────────────────────────

def numeric_of(metrics: dict) -> dict:
    """The stored blob minus exactly the keys a history read throws away.

    ⛔ "NUMERIC" NAMES THE PURPOSE, NOT A TYPE FILTER, and getting that backwards
    breaks parity silently. The readers drop `*_list` and keep everything else —
    including strings like `market_phase` and nulls. Filtering to int/float here
    would produce a store that is *more* numeric and *less* correct, and the
    difference would surface as a missing column in the Monitor rather than as an
    error. One definition, used by the writer, the backfill, the readers and the
    audit, so the four cannot disagree.
    """
    return {k: v for k, v in metrics.items() if not k.endswith("_list")}


def _write_numeric(c, date_str: str, metrics: dict, source: str = "collector") -> None:
    """Write the projection on the caller's connection, INSIDE their transaction.

    ⛔ It takes the connection rather than opening its own precisely so it cannot
    drift: a projection written in a second transaction can be lost while the blob
    survives, and the two tables would then disagree with nothing to report it.
    """
    c.execute(
        "INSERT OR REPLACE INTO breadth_snapshot_numeric (date, metrics, source, updated_at) "
        "VALUES (?, ?, ?, datetime('now'))",
        (date_str, json.dumps(numeric_of(metrics)), source),
    )


# ── Write ─────────────────────────────────────────────────────────────────────

def store_snapshot(date_str: str, metrics: dict) -> bool:
    try:
        with _conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO breadth_snapshots (date, metrics) VALUES (?, ?)",
                (date_str, json.dumps(metrics)),
            )
            _write_numeric(c, date_str, metrics)
            c.commit()
        from api.services.cache import cache
        cache.delete_prefix("breadth_history_")  # fresh data → drop cached history
        return True
    except Exception as e:
        print(f"[breadth_monitor] store error: {e}")
        return False


def raw_row(date_str: str) -> Optional[dict]:
    """The stored metrics blob for one date (no derivation, `_list` keys kept), or
    None. Used by the self-heal to inspect / preserve a day's sentiment fields."""
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metrics FROM breadth_snapshots WHERE date = ?", (date_str,)
            ).fetchone()
        return json.loads(row["metrics"]) if row else None
    except Exception as e:
        print(f"[breadth_monitor] raw_row error: {e}")
        return None


def snapshot_looks_degraded(m: dict) -> bool:
    """True when a snapshot's WHOLE-MARKET price measurements collapsed against a
    real universe — the signature of a failed universe price pull (only a handful
    of names actually priced), as opposed to a genuinely quiet session.

    On any real trading day a 2,000+ name universe has hundreds of stocks in a
    Stage-2 uptrend and at least SOME 4%-movers and new highs/lows. All three
    going to ~0 at once, while `universe_count` still reports the full list, is
    the failure — e.g. 2026-08-31 stored Stage-2=2 / up4=dn4=0 / 52w+20w hi-lo≈0
    on a universe of 2,581 (percentages came back as coarse 1/6, 1/3, 1/2 fractions).
    Index closes + weekly sentiment ride a separate feed and are NOT judged here.
    """
    if not isinstance(m, dict):
        return False

    def g(k):
        try:
            return float(m.get(k) or 0)
        except (TypeError, ValueError):
            return 0.0

    uni = g("universe_count")
    if uni < 500:
        return False   # small/unknown universe — not enough to judge coverage here
    stage2 = g("stage2_count")
    movers = g("up_4pct_today") + g("down_4pct_today")
    hilo = (g("new_52w_highs") + g("new_52w_lows")
            + g("new_20d_highs") + g("new_20d_lows"))
    return stage2 < uni * 0.02 and movers < 6 and hilo < 8


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


def _no_row(date: str, hist: list) -> dict:
    """Why there is no attribution for `date` — MISSING and PROVISIONAL are not
    the same fact, and the reader acts on them differently.

    🔴 Both used to answer *"no stored session for that date"*. But the Views
    tab renders a LIVE row: `/live` computes today's breadth intraday and hands
    it to the page as a row with today's date, and the Score Attribution lens
    asks this endpoint about whatever date the cursor is on. Every time it was
    opened on the live row — the default cursor position for most of a trading
    day — a member read that today's session had never been recorded. It had
    not been recorded YET; the 4:15 collector writes it after the close.

    The distinction is the one `/live` already makes with `superseded`: the
    collector's newest stored date is the boundary. A date past it is a session
    the collector has not reached, which is exactly the provisional row the page
    is showing. A date at or before it that is still absent is genuinely
    missing — a holiday, a gap, a typo.

    Same shape as `session_path` either way: `ok: False`, never an error, plus
    a `provisional` flag so a caller can branch on the fact rather than parse
    the sentence.
    """
    newest = hist[0].get("date") if hist else None
    provisional = bool(newest and date > newest)
    reason = (
        "this session is still provisional — the 4:15 PM collector has not "
        f"written it yet (latest stored session is {newest})"
        if provisional else "no stored session for that date"
    )
    return {"ok": False, "date": date, "provisional": provisional,
            "reason": reason, "latest_stored": newest}


def score_components(date: str, days: int = 90) -> dict:
    """The score attribution for `date`, plus the prior session's, so a caller
    can draw the delta in one request. A date with no row answers ok:false —
    absence is not an error, same as `session_path` — and `_no_row` says WHICH
    kind of absence it is: a session the collector has not written yet
    (`provisional: True`) is not a missing one.

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
        return _no_row(date, hist)

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


def _resolve_anchor_date(c: sqlite3.Connection, end: str, anchor: str) -> Optional[str]:
    """The stored date the returned window's NEWEST row should be.

    `end` is a target the caller typed / picked; the window ENDS on a real
    trading day, so we snap to the nearest one:
      • anchor 'le' (a specific date / typed date): the last session on-or-before
        `end` — the chosen day, or the trading day just before it.
      • anchor 'ge' (a year jump → "start of that year"): the first session
        on-or-after `end` — so `end=YYYY-01-01` lands on that year's first bar.
    A target past the ends of the data clamps to the nearest edge rather than
    returning nothing (an out-of-range jump should still show real rows).
    """
    if anchor == "ge":
        row = c.execute(
            "SELECT MIN(date) FROM breadth_snapshots WHERE date >= ?", (end,)
        ).fetchone()
        d = row[0] if row else None
        if d:
            return d
        # `end` is past the newest data → clamp to the latest stored session.
        row = c.execute("SELECT MAX(date) FROM breadth_snapshots").fetchone()
        return row[0] if row else None
    row = c.execute(
        "SELECT MAX(date) FROM breadth_snapshots WHERE date <= ?", (end,)
    ).fetchone()
    d = row[0] if row else None
    if d:
        return d
    # `end` is before the oldest data → clamp to the earliest stored session.
    row = c.execute("SELECT MIN(date) FROM breadth_snapshots").fetchone()
    return row[0] if row else None


def get_history(days: int = 90, end: Optional[str] = None, anchor: str = "le") -> list:
    """Return N trading days, newest first. Ratios computed from stored data.

    Fetches `days + _ROLLING_WARMUP` rows, derives over all of them, and returns
    only the newest `days`. The warm-up rows exist to be looked back AT, never
    to be returned — that is what makes a derived value a property of its date
    rather than of the request.

    `end` (YYYY-MM-DD) moves the window so its NEWEST row is the session at/near
    that date (see `_resolve_anchor_date` for the `anchor` snap rule) instead of
    the latest — this is what lets the Monitor "teleport" back in time. The
    rolling windows still look BACKWARD from each returned row, so an `end`
    window is derived identically to the same span reached by scrolling.

    Cached (5 min) keyed by `days`+`end`+`anchor`: breadth data updates once
    daily (afternoon push), so this recomputed the full rolling-metric pass on
    EVERY request for no benefit — costly under load and the reason the
    /api/breadth-monitor cold hit was slow. 5-min staleness is imperceptible for
    daily data. The `breadth_history_` prefix keeps it in the set every write
    invalidates.
    """
    from api.services.cache import cache
    from api.services import single_flight
    # The latest window keeps its historical key (`breadth_history_{days}`) so the
    # common read and everything keyed to it are unchanged; a teleported window
    # gets a distinct key under the SAME prefix every write already invalidates.
    ck = f"breadth_history_{days}" if not end else f"breadth_history_{days}_{end}_{anchor}"
    hit = cache.get(ck)
    if hit is not None:
        # ⛔ THIS LABEL WAS MISSING AND THE INSTRUMENT LIED BECAUSE OF IT. A window
        # inside the collector range is delegated here by `_history_deep_uncached`,
        # which has already noted `cache="miss"`. This function noted nothing, so a
        # `days=90` request served entirely from THIS cache was reported as a miss —
        # for every request, indefinitely. `note()` merges, so a later note wins.
        from api.services import breadth_timing as _bt
        _bt.note(cache="hit", cache_tier="plain")
        return hit
    # ⛔ SINGLE-FLIGHT ON THE CACHE KEY. Concurrent readers of the SAME window
    # collapse onto one computation instead of each paying it — see
    # `api/services/single_flight.py` for the measurement (D-042) and for what
    # this deliberately does NOT bound.
    return single_flight.run(ck, lambda: _history_uncached(days, end, anchor, ck))



def _metrics_for_dates(c, dates: list) -> tuple:
    """`({date: metrics-without-_list}, blob_fallbacks)` for the given dates.

    ⭐ THE PROJECTION IS READ FIRST AND THE BLOB COLUMN IS NEVER SELECTED unless a
    date is missing from it. That is the whole optimisation and it is easy to lose
    by accident: a `LEFT JOIN` that mentions `breadth_snapshots.metrics` in its
    select list materialises all 636 KB per row even when nothing reads it, so the
    two tables are queried separately on purpose.

    ⚠️ THE FALLBACK IS COUNTED, NEVER SILENT. A date the backfill has not reached
    still serves correctly off the blob — which is what makes the migration safe
    to deploy before it has run — but a store that is quietly half-populated would
    otherwise present as "the fix did nothing" with no way to tell that from "the
    fix is wrong". The count rides the request timing line.
    """
    out: dict = {}
    if not dates:
        return out, 0
    for i in range(0, len(dates), 400):
        chunk = dates[i:i + 400]
        dq = ",".join("?" * len(chunk))
        for (d, mj) in c.execute(
            f"SELECT date, metrics FROM breadth_snapshot_numeric WHERE date IN ({dq})", chunk
        ).fetchall():
            out[d] = json.loads(mj)
    missing = [d for d in dates if d not in out]
    # ⛔ COUNT THE ROWS THAT CAME BACK, NEVER THE DATES ASKED FOR. A deep window
    # asks about thousands of RECONSTRUCTED dates that have no collector snapshot
    # and are not supposed to have a projection either — scoring those as
    # "missing" would report ~4,529 phantom gaps on a fully-backfilled store and
    # make the instrument's loudest number its most meaningless one.
    fallbacks = 0
    for i in range(0, len(missing), 400):
        chunk = missing[i:i + 400]
        dq = ",".join("?" * len(chunk))
        for (d, mj) in c.execute(
            f"SELECT date, metrics FROM breadth_snapshots WHERE date IN ({dq})", chunk
        ).fetchall():
            m = json.loads(mj)
            for k in [k for k in list(m.keys()) if k.endswith("_list")]:
                del m[k]
            out[d] = m
            fallbacks += 1
    try:
        if fallbacks:
            from api.services import breadth_timing
            breadth_timing.note(numeric_miss=fallbacks)
    except Exception:
        pass
    return out, fallbacks


def _history_uncached(days: int, end: Optional[str], anchor: str, ck: str) -> list:
    """The leader's work for `get_history`. Never call this directly.

    ⭐ It re-checks the cache first: a leader that finished between our miss and
    our arrival has already stored the answer, and recomputing it would make the
    collapse look like it worked while doing the work twice anyway.
    """
    from api.services.cache import cache
    hit = cache.get(ck)
    if hit is not None:
        return hit
    try:
        with _conn() as c:
            anchor_date = _resolve_anchor_date(c, end, anchor) if end else None
            # ⛔ `metrics` is deliberately NOT in these select lists. Selecting it
            # materialises ~636 KB per row into Python for a column the reader was
            # only ever going to strip; the window's dates come from here and the
            # values come from `_metrics_for_dates`.
            if anchor_date is not None:
                rows = c.execute(
                    "SELECT date, created_at FROM breadth_snapshots "
                    "WHERE date <= ? ORDER BY date DESC LIMIT ?",
                    (anchor_date, days + _ROLLING_WARMUP),
                ).fetchall()
            else:
                rows = c.execute(
                    "SELECT date, created_at FROM breadth_snapshots ORDER BY date DESC LIMIT ?",
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

    with _conn() as c:
        by_date, _fallbacks = _metrics_for_dates(c, [r["date"] for r in rows])
    result = []
    for row in rows:
        m = dict(by_date.get(row["date"]) or {})
        m["date"] = row["date"]
        m["_created_at"] = row["created_at"]   # expose for "last updated" display
        result.append(m)

    # Need oldest-first to compute rolling windows, then reverse back
    result_asc = list(reversed(result))
    _derive_ascending(result_asc, adv_decline_seed)

    # Return newest-first, dropping the warm-up rows off the OLD end. They were
    # fetched to be looked back at, not to be served.
    out = list(reversed(result_asc))[:days]
    cache.set(ck, out, ttl=300)
    return out


def _net_new_high_low(row: dict) -> Optional[float]:
    """NEW HIGHS − NEW LOWS. One definition, and both derivation paths call it.

    ⭐⭐ IT IS A FUNCTION RATHER THAN TWO INLINE SUBTRACTIONS FOR ONE REASON: the
    two derivation paths beside it — `_derive_ascending` (stored + reconstructed)
    and `derive_live_row` (intraday) — already compute `hi_ratio`/`lo_ratio`
    INLINE, twice, from these same two inputs. That duplication is survivable for a
    ratio nobody charts on its own. It is not survivable for a series a member
    reads as a signal: the live value and the sealed value would be two definitions
    wearing one name, and the disagreement would surface as a candle that changes
    shape after the close.

    ⛔ AND IT IS `None` WHEN EITHER SIDE IS MISSING, never a one-sided number. A day
    that recorded 137 highs and no low count is a day whose NET we do not know;
    publishing +137 would read as a strongly positive session. `None` is the honest
    answer, and every store here already drops non-finite values.

    ⚠️ SIGNED BY CONSTRUCTION (`breadth_metrics.DOMAIN_SIGNED`). Nothing may clamp
    it at zero or onto a 0-100 axis: −663 is the entire point of the series.
    """
    nh, nl = row.get("new_52w_highs"), row.get("new_52w_lows")
    if nh is None or nl is None:
        return None
    try:
        v = float(nh) - float(nl)
    except (TypeError, ValueError):
        return None
    # ⛔ FINITE OR NOTHING. `_render_json` serialises the history response with
    # `allow_nan=False`, which RAISES on a NaN or an infinity — so one malformed
    # input here would not produce a wrong cell, it would 500 the whole Monitor
    # endpoint for every member. `inf - inf` is NaN, and this reads two values it
    # does not own.
    return v if math.isfinite(v) else None


def _derive_ascending(result_asc: list, adv_decline_seed: float) -> None:
    """Add the derived block to an OLDEST-FIRST list of raw-metric rows, in place.

    The single source of truth for every value the Monitor computes rather than
    stores: the 5/10-day up-down ratios, the 10-day put/call average, hi/lo
    ratios, QQQ/SPY day %, the cumulative A/D line (seeded so it is absolute, not
    window-relative), the Follow-Through-Day flag, and the composite breadth
    score. Both the collector read (`get_history`) and the deep-history merge
    (`get_history_deep`) run rows through this, so a reconstructed date is derived
    identically to a collected one.
    """
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
        row["net_new_high_low"] = _net_new_high_low(row)

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


def _resolve_anchor_merged(all_dates: list, end: str, anchor: str) -> Optional[str]:
    """The window's newest date, chosen from the merged (collector+reconstructed)
    date list. `le` snaps down to the last session ≤ end; `ge` snaps up to the
    first ≥ end; out-of-range clamps to the nearest edge (never empty)."""
    if not all_dates:
        return None
    if anchor == "ge":
        i = bisect_left(all_dates, end)
        return all_dates[i] if i < len(all_dates) else all_dates[-1]
    i = bisect_right(all_dates, end) - 1
    return all_dates[i] if i >= 0 else all_dates[0]


def merged_dates() -> list:
    """Sorted-ASC union of collector + reconstructed session dates. CACHED — the
    DISTINCT scan over the reconstructed OHLC store is the expensive part of a
    teleport, and it only changes when the worker ships a new history chunk. Under
    the `breadth_history_` prefix, so a collector write clears it too."""
    from api.services.cache import cache
    ck = "breadth_history_merged_dates"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    try:
        with _conn() as c:
            coll = [r[0] for r in c.execute(
                "SELECT date FROM breadth_snapshots ORDER BY date ASC").fetchall()]
    except Exception:
        coll = []
    recon = []
    if _DEEP_ENABLED:
        try:
            from api.services import breadth_daily_ohlc as ohlc
            recon = ohlc.distinct_dates()
        except Exception:
            recon = []
    # The reconstructed OHLC store supplies ONLY the deep past — the range BELOW the
    # collector's earliest snapshot. Within (and above) the collector range, the
    # collector is authoritative. Critically, the OHLC store carries a DEVELOPING
    # bar for TODAY, and unioning it here injected a `today` slot into the timeline
    # index that `get_history` (breadth_snapshots) can't fill → the Monitor showed a
    # permanent all-dashes top row whenever the live row was withheld. Clamp recon to
    # < floor so today's row is owned solely by the client-injected live row.
    coll_min = min(coll) if coll else None
    if coll_min:
        recon = [d for d in recon if d < coll_min]
    out = sorted(set(coll) | set(recon))
    cache.set(ck, out, ttl=300)
    return out


def _collector_floor() -> Optional[str]:
    """The earliest collector snapshot date (the boundary below which rows are
    reconstructed). Cached alongside the date universe."""
    from api.services.cache import cache
    ck = "breadth_history_collector_floor"
    hit = cache.get(ck)
    if hit is not None:
        return hit or None
    d = None
    try:
        with _conn() as c:
            row = c.execute("SELECT MIN(date) FROM breadth_snapshots").fetchone()
            d = row[0] if row else None
    except Exception:
        d = None
    cache.set(ck, d or "", ttl=300)
    return d


def _adv_decline_seed_before(oldest: str) -> float:
    """Cumulative-A/D seed for a deep window: the running total of `adv_decline`
    over every merged session before `oldest` (collector value wins where both
    stores have the date), so the A/D line stays absolute across the boundary."""
    coll: dict = {}
    try:
        with _conn() as c:
            for (d, v) in c.execute(
                "SELECT date, json_extract(metrics, '$.adv_decline') "
                "FROM breadth_snapshots WHERE date < ?", (oldest,),
            ).fetchall():
                if v is not None:
                    coll[d] = v
    except Exception:
        pass
    recon: dict = {}
    try:
        from api.services import breadth_daily_ohlc as ohlc
        recon = ohlc.metric_before("adv_decline", oldest)
    except Exception:
        recon = {}
    merged = {**recon, **coll}   # collector wins on any shared date
    return sum(v for v in merged.values() if v is not None)


def get_history_deep(days: int = 90, end: Optional[str] = None, anchor: str = "le") -> list:
    """Monitor history that reaches BEFORE the collector floor (2026-01-02).

    A window lying entirely within the collector range delegates to `get_history`
    unchanged — so the live/default Monitor view is byte-for-byte what it was;
    only a teleport into the past engages the merge. For dates the collector never
    saw, a row is reassembled from the reconstructed close-basis history in
    `breadth_daily_ohlc` (the same store the breadth charts read) with imported
    historical sentiment (`breadth_sentiment_history`) overlaid where public
    archives have it, then run through the SAME derivation as a collected row.

    Reconstructed rows carry `_reconstructed: True` so the UI can mark them (their
    percentage metrics are exact; their COUNT metrics are coverage-scaled
    estimates, and survey/exposure fields are present only where imported).
    """
    if not _DEEP_ENABLED:
        return get_history(days, end, anchor)

    from api.services.cache import cache
    from api.services import single_flight
    from api.services import breadth_timing
    ck = f"breadth_history_deep_{days}_{end or 'latest'}_{anchor}"
    hit = cache.get(ck)
    if hit is not None:
        breadth_timing.note(cache="hit", cache_tier="deep")
        return hit
    breadth_timing.note(cache="miss", cache_tier="miss")
    # ⛔ SINGLE-FLIGHT ON THE CACHE KEY — this is the read D-042 measured at ~55 s
    # cold, so a duplicate of it is the most expensive duplicate in the app.
    return single_flight.run(ck, lambda: _history_deep_uncached(days, end, anchor, ck),
                             on_role=lambda role: breadth_timing.note(coalesced=role == "follower"))


def _history_deep_uncached(days: int, end: Optional[str], anchor: str, ck: str) -> list:
    """The leader's work for `get_history_deep`. Never call this directly.

    ⭐ Its delegations to `get_history` are single-flighted in their own right,
    under the PLAIN key — the two keys are distinct, so a deep leader waiting on a
    plain leader is two different computations collapsing correctly, never a cycle.
    """
    from api.services.cache import cache
    hit = cache.get(ck)
    if hit is not None:
        return hit

    # Merged date universe (collector snapshots + reconstructed history), ASC —
    # cached, because the DISTINCT scan over the ~170k-row OHLC store is the slow
    # part of a teleport, and it only changes when the store grows (worker-side).
    from api.services import breadth_timing as _bt
    with _bt.phase('merged_dates'):
        all_dates = merged_dates()
    if not all_dates:
        return get_history(days, end, anchor)
    with _bt.phase('collector_floor'):
        collector_floor = _collector_floor()

    with _bt.phase('anchor'):
        anchor_date = _resolve_anchor_merged(all_dates, end, anchor) if end else all_dates[-1]
    idx = bisect_right(all_dates, anchor_date) - 1
    if idx < 0:
        return []
    lo = max(0, idx - (days + _ROLLING_WARMUP) + 1)
    window = all_dates[lo:idx + 1]                     # oldest-first
    if not window:
        return []

    # Whole window inside the collector range → the plain read is exact (and keeps
    # its own cache key / behaviour).
    if collector_floor is not None and window[0] >= collector_floor:
        return get_history(days, end, anchor)

    # Collector rows for any collected dates in the window (they win on overlap).
    coll_rows: dict = {}
    try:
        with _conn() as c:
            # Same rule as the plain reader: the projection first, the blob only
            # for dates the backfill has not reached, and never both.
            with _bt.phase('numeric_fetch'):
                coll_rows, _fallbacks = _metrics_for_dates(c, list(window))
    except Exception:
        coll_rows = {}

    recon_needed = [d for d in window if d not in coll_rows]
    # ⭐ THE MATERIALISED RECONSTRUCTED SIDE. This used to assemble 174,187 OHLC
    # rows into 4,529 rows on every cold request; it is now one indexed read of
    # pre-built rows. ⛔ The derivation is NOT the fallback here — it is the
    # BUILDER, and `test_the_request_path_never_derives` fails if this path ever
    # calls it. A date with no materialised row is reported, not silently rebuilt
    # at member expense.
    recon_rows: dict = {}
    recon_missing = 0
    try:
        from api.services import breadth_daily_ohlc as ohlc
        with _bt.phase('reconstructed_fetch'):
            recon_rows, recon_missing = ohlc.reconstructed_for_dates(recon_needed)
        absent = [d for d in recon_needed if d not in recon_rows]
        if absent:
            from api.services import breadth_timing
            breadth_timing.note(reconstructed_missing=len(absent))
    except Exception:
        recon_rows = {}

    # ⛔ A `with`, not a hand-rolled __enter__/__exit__ pair. The manual form skips
    # __exit__ when the body raises, so a merge that failed halfway would report
    # `merge_rows=absent` — the instrument going quiet exactly when something went
    # wrong. `phase()` records in a `finally`, so the span survives the exception.
    with _bt.phase('merge_rows'):
        result_asc = []
        for d in window:
            # ⛔ PRECEDENCE, ASSERTED RATHER THAN IMPLIED: where both a collector row
            # and a reconstructed row exist for one date, the COLLECTOR row wins. That
            # is today's behaviour and it is why the two live in separate tables — a
            # single date-keyed table would have let whichever wrote last decide.
            # Rail: `test_a_collector_row_beats_a_reconstructed_row_for_the_same_date`.
            if d in coll_rows:
                row = dict(coll_rows[d])
            elif d in recon_rows:
                # Pre-built: the closes, the sentiment overlay and the `_reconstructed`
                # provenance flag are all stored together, so this is a dict copy rather
                # than a per-request assembly out of the OHLC store.
                row = dict(recon_rows[d])
            else:
                continue                         # no row for this date, from either side
            row["date"] = d
            result_asc.append(row)

    with _bt.phase('adv_seed'):
        _seed = _adv_decline_seed_before(window[0])
    with _bt.phase('derive'):
        _derive_ascending(result_asc, _seed)

    out = list(reversed(result_asc))[:days]
    with _bt.phase('cache_set'):
        cache.set(ck, out, ttl=300)
    return out


def date_bounds() -> dict:
    """The first/last stored session dates (YYYY-MM-DD), or None when empty.

    The Time Navigator needs the full span to bound its calendar + build its
    year list, independent of whichever window is on screen. Cheap MIN/MAX and
    rarely-changing, so it lives under the same `breadth_history_` prefix every
    write already invalidates.
    """
    from api.services.cache import cache
    ck = "breadth_history_bounds"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    out = {"min": None, "max": None}
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT MIN(date), MAX(date) FROM breadth_snapshots"
            ).fetchone()
            if row:
                out = {"min": row[0], "max": row[1]}
    except Exception as e:
        print(f"[breadth_monitor] date_bounds error: {e}")
    # Extend ONLY the floor with the reconstructed history so the Time Navigator's
    # calendar + year list reach back to it (e.g. ~2008). The max stays whatever the
    # collector last wrote: the OHLC store carries a DEVELOPING today-bar, and letting
    # it push `max` to today created a permanent empty top row in the Monitor (the
    # live/today row is injected client-side from /live, never from this index). Fall
    # back to the OHLC max only when the collector has nothing at all (dev/empty box).
    if _DEEP_ENABLED:
        try:
            from api.services import breadth_daily_ohlc as ohlc
            s = ohlc.stats()
            fmn, fmx = s.get("first"), s.get("last")
            if fmn and (out["min"] is None or fmn < out["min"]):
                out["min"] = fmn
            if fmx and out["max"] is None:
                out["max"] = fmx
        except Exception:
            pass
    cache.set(ck, out, ttl=300)
    return out


def next_trading_day(date_str: Optional[str]) -> Optional[str]:
    """The merged session immediately AFTER `date_str` (newer), or None.

    Feeds the Time Navigator's ▶ one-day step forward: the older neighbour of a
    shown window is already in that window, but the newer one sits outside it.
    Considers both the collector snapshots and the reconstructed history so a step
    forward works anywhere in deep time.
    """
    if not date_str:
        return None
    nxt = None
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT MIN(date) FROM breadth_snapshots WHERE date > ?", (date_str,)
            ).fetchone()
            nxt = row[0] if row and row[0] else None
    except Exception as e:
        print(f"[breadth_monitor] next_trading_day error: {e}")
    if _DEEP_ENABLED:
        try:
            from api.services import breadth_daily_ohlc as ohlc
            # Recon supplies only the deep past (below the collector floor); its
            # developing today-bar must never be offered as the ▶ next step.
            floor = _collector_floor()
            ds = ohlc.distinct_dates()
            if floor:
                ds = [d for d in ds if d < floor]
            i = bisect_right(ds, date_str)
            if i < len(ds):
                cand = ds[i]
                if nxt is None or cand < nxt:
                    nxt = cand
        except Exception:
            pass
    return nxt


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
    row["net_new_high_low"] = _net_new_high_low(row)

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


def patch_fields(date_str: str, values: dict) -> bool:
    """Update SEVERAL fields of one snapshot's metrics JSON in ONE transaction.

    ⭐ ONE transaction, not a loop of `patch_field`, because a pair of fields
    that are only meaningful TOGETHER must land together. `advancing` and
    `declining` are exactly that: the backfill's whole correctness gate is
    `advancing - declining == adv_decline`, and a process that died between two
    single-field writes would leave a row where that sentence cannot even be
    evaluated — a half-written pair reads as "we measured advancers and not
    decliners", which never happened on any session.

    `patch_field` is this with one key, so the read-modify-write and the cache
    drop have a single implementation. Returns False when no row exists for
    `date_str` (absence is not an error here — the caller decides).
    """
    if not values:
        return False
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metrics FROM breadth_snapshots WHERE date = ?", (date_str,)
            ).fetchone()
            if not row:
                return False
            m = json.loads(row["metrics"])
            m.update(values)
            c.execute(
                "UPDATE breadth_snapshots SET metrics = ? WHERE date = ?",
                (json.dumps(m), date_str),
            )
            _write_numeric(c, date_str, m)
            c.commit()
        from api.services.cache import cache
        cache.delete_prefix("breadth_history_")
        return True
    except Exception as e:
        print(f"[breadth_monitor] patch_fields error: {e}")
        return False


def patch_field(date_str: str, key: str, value) -> bool:
    """Update a single field in an existing snapshot's metrics JSON."""
    return patch_fields(date_str, {key: value})


def delete_snapshot(date_str: str) -> bool:
    """Delete a snapshot row by date. Returns True if a row was deleted."""
    try:
        with _conn() as c:
            cur = c.execute(
                "DELETE FROM breadth_snapshots WHERE date = ?", (date_str,)
            )
            c.execute("DELETE FROM breadth_snapshot_numeric WHERE date = ?", (date_str,))
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


def get_snapshot_lists(date_str: str, keys: Optional[list] = None) -> Optional[dict]:
    """Every `*_list` field stored for one date, or just the `keys` asked for.

    ⭐ WHY THIS EXISTS SEPARATELY FROM `get_drill_list`. `get_history` STRIPS the
    list keys (they are large and the page fetches them one cell at a time), and
    the per-key drill route is gated on a MEMBER session. A maintenance job holds
    the PUSH_SECRET bearer and no member account, so before this it could read a
    snapshot's counts and rewrite any field — but could not read the lists it was
    about to rewrite. A read-modify-write patch had no read.

    Returns None when the date has no snapshot at all, so a caller can tell "no
    row" (skip it) from "a row that happens to carry no lists" ({}).
    """
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metrics FROM breadth_snapshots WHERE date = ?", (date_str,)
            ).fetchone()
        if not row:
            return None
        m = json.loads(row["metrics"])
        wanted = set(keys) if keys else None
        return {k: v for k, v in m.items()
                if k.endswith("_list") and isinstance(v, list)
                and (wanted is None or k in wanted)}
    except Exception as e:
        print(f"[breadth_monitor] get_snapshot_lists error: {e}")
        return None


def get_snapshot_counts(date_str: str) -> Optional[dict]:
    """The snapshot's SCALAR metrics — every non-list field, which is where the
    counts live (`down_50pct_month` beside `down_50pct_month_list`).

    ⭐ A caller that edits a list has to be able to check the count that is
    rendered beside it. `count_period_return` and `list_period_return` mask
    identically, so `count == len(list)` holds by construction; a maintenance job
    that cannot READ the count cannot verify that premise before acting on it,
    and would have to rewrite the count on faith.

    Scalars only, so this stays tiny next to the lists it accompanies.
    """
    try:
        with _conn() as c:
            row = c.execute(
                "SELECT metrics FROM breadth_snapshots WHERE date = ?", (date_str,)
            ).fetchone()
        if not row:
            return None
        m = json.loads(row["metrics"])
        return {k: v for k, v in m.items()
                if not k.endswith("_list") and (v is None or isinstance(v, (int, float, str)))}
    except Exception as e:
        print(f"[breadth_monitor] get_snapshot_counts error: {e}")
        return None


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
