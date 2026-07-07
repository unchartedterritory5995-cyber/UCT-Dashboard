"""
flow_scoreboard.py — Public Flow Scoreboard: verified performance stats for
every Top Flow pick the tracker has ever flagged.

GET /api/flow-scoreboard  (also /api/flow-scoreboard/)
    → aggregate hit-rates, grade-calibration table, recent standouts and the
      "honest tape" (last picks including losers), computed from
      api.top_flow_tracker's active + archived picks.

Honesty rules (LOCKED — this is a public trust asset):
  * Losers are NEVER excluded from aggregate stats.
  * Picks with fewer than 2 daily snapshots are "too new" — reported
    separately and excluded from rates (they have no outcome yet), never
    silently dropped.
  * All gains are CONTRACT-price gains (the option's price), not the
    underlying stock move.
  * No auth on the GET — read-only, cacheable, public.

Caching: module-level 5-minute TTL on the computed payload (same idea as
flow_router's _RESPONSE_CACHE, sized for exactly one entry since the
endpoint has no parameters).
"""

from __future__ import annotations

import re
import time
import logging
from datetime import date, datetime, timezone
from statistics import median

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flow-scoreboard", tags=["flow-scoreboard"])

# ── Tunables ─────────────────────────────────────────────────────────────────

GRADE_ORDER = ["A+", "A", "B", "C", "D"]
OI_RISE_FACTOR = 1.1              # later OI must exceed first OI × this to count as "OI confirmed"
RECENT_WINDOW_DAYS = 45           # recent_winners lookback
RECENT_WINNERS_LIMIT = 12
RECENT_PICKS_LIMIT = 15
MIN_HISTORY_SNAPSHOTS = 2         # fewer than this = "too new"
CACHE_TTL_SECONDS = 300           # 5 min

METHODOLOGY = (
    "Every Top Flow pick is saved the day it is flagged and tracked with daily "
    "end-of-day snapshots of the option contract's price and open interest until "
    "expiration. Entry = the contract's price when the pick was flagged. All gains "
    "are contract-price gains (the option's price, not the underlying stock's move). "
    "Peak gain = the best daily closing price since the flag versus entry; current "
    "gain = the latest snapshot versus entry. A pick counts as OI-confirmed when its "
    "open interest later rises more than 10% above the level on its first snapshot — "
    "evidence the flagged positioning was opened, not closed. Win rates count the "
    "share of picks whose peak gain reached the threshold. Losers are never removed "
    "from the sample; picks with fewer than two snapshots are reported as 'too new' "
    "and excluded from rates only until they have an outcome to measure."
)

# ── Parsing helpers (pure) ───────────────────────────────────────────────────

_GRADE_RE = re.compile(r"^(A\+|A|B|C|D)$")


def clean_grade(raw) -> str:
    """Normalize a stored grade ('A+ 🚀', 'A', 'b') to one of GRADE_ORDER, or ''."""
    if not raw or not isinstance(raw, str):
        return ""
    token = raw.strip().split()[0] if raw.strip() else ""
    token = re.sub(r"[^A-Za-z+]", "", token).upper()
    return token if _GRADE_RE.match(token) else ""


def parse_pick_date(raw):
    """Parse 'M/D/YYYY', 'M/D/YY' or 'YYYY-MM-DD' → date. None on failure.

    The tracker has stored both formats over its life (frontend saves send
    M/D/YYYY; server-side defaults used ISO), so the scoreboard accepts both.
    """
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    if "-" in s:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    parts = s.split("/")
    if len(parts) < 3:
        return None
    try:
        m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
        if y < 100:
            y += 2000
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


def _as_price(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


# ── Per-pick stats (pure) ────────────────────────────────────────────────────

def pick_stats(pick: dict):
    """Compute outcome stats for one pick from its daily snapshot history.

    Returns a dict, or None when the pick is "too new" (fewer than
    MIN_HISTORY_SNAPSHOTS usable snapshots) or has no usable entry price.
    """
    history = pick.get("history") or []

    # Usable snapshots: positive price. Keep original order but sort by parsed
    # date when available (insertion order is the tiebreak).
    snaps = []
    for i, h in enumerate(history):
        px = _as_price(h.get("price"))
        if px is None:
            continue
        snaps.append((parse_pick_date(h.get("date", "")), i, px, h))
    if len(snaps) < MIN_HISTORY_SNAPSHOTS:
        return None
    snaps.sort(key=lambda t: (t[0] or date.min, t[1]))

    prices = [s[2] for s in snaps]

    # Entry = contract price at save. Defensive fallback: if the stored entry
    # is missing/zero, use the first tracked snapshot price (documented in
    # METHODOLOGY as "when the pick was flagged").
    entry = _as_price(pick.get("entry")) or prices[0]

    peak = max(prices)
    latest = prices[-1]
    max_gain_pct = (peak - entry) / entry * 100.0
    current_gain_pct = (latest - entry) / entry * 100.0

    # Days tracked: calendar span of the snapshot dates; fall back to the
    # number of snapshot intervals when dates don't parse.
    first_dt, last_dt = snaps[0][0], snaps[-1][0]
    if first_dt and last_dt and last_dt >= first_dt:
        days_tracked = (last_dt - first_dt).days
    else:
        days_tracked = len(snaps) - 1

    # OI confirmation from the pick's own history: any LATER snapshot's OI
    # exceeding the first snapshot's OI × OI_RISE_FACTOR.
    oi_series = []
    for _, _, _, h in snaps:
        try:
            oi = float(h.get("oi") or 0)
        except (TypeError, ValueError):
            oi = 0.0
        oi_series.append(oi)
    first_oi = oi_series[0]
    oi_evaluable = first_oi > 0
    oi_confirmed = oi_evaluable and any(
        later > first_oi * OI_RISE_FACTOR for later in oi_series[1:]
    )

    return {
        "id": pick.get("id", ""),
        "sym": pick.get("sym", ""),
        "cp": pick.get("cp", ""),
        "strike": pick.get("strike", 0),
        "exp": pick.get("exp", ""),
        "grade": clean_grade(pick.get("grade", "")),
        "dateSaved": pick.get("dateSaved", ""),
        "date_saved_parsed": parse_pick_date(pick.get("dateSaved", "")),
        "entry": round(entry, 4),
        "peak_price": round(peak, 4),
        "latest_price": round(latest, 4),
        "max_gain_pct": round(max_gain_pct, 1),
        "current_gain_pct": round(current_gain_pct, 1),
        "days_tracked": days_tracked,
        "oi_confirmed": oi_confirmed,
        "oi_evaluable": oi_evaluable,
    }


# ── Aggregation (pure) ───────────────────────────────────────────────────────

def _rate(count: int, total: int):
    return round(count / total * 100.0, 1) if total else None


def _bucket_stats(stats: list) -> dict:
    """Aggregate stats over a list of pick_stats dicts. Losers always included."""
    n = len(stats)
    if n == 0:
        return {
            "picks": 0,
            "win_rate_10": None, "win_rate_25": None, "win_rate_50": None,
            "pct_doubled": None,
            "avg_max_gain": None, "median_max_gain": None,
            "oi_confirmed_rate": None, "oi_evaluated": 0,
        }
    gains = [s["max_gain_pct"] for s in stats]
    oi_eval = [s for s in stats if s["oi_evaluable"]]
    oi_conf = sum(1 for s in oi_eval if s["oi_confirmed"])
    return {
        "picks": n,
        "win_rate_10": _rate(sum(1 for g in gains if g >= 10), n),
        "win_rate_25": _rate(sum(1 for g in gains if g >= 25), n),
        "win_rate_50": _rate(sum(1 for g in gains if g >= 50), n),
        "pct_doubled": _rate(sum(1 for g in gains if g >= 100), n),
        "avg_max_gain": round(sum(gains) / n, 1),
        "median_max_gain": round(median(gains), 1),
        "oi_confirmed_rate": _rate(oi_conf, len(oi_eval)),
        "oi_evaluated": len(oi_eval),
    }


_PUBLIC_FIELDS = (
    "sym", "cp", "strike", "exp", "grade", "dateSaved", "entry",
    "peak_price", "max_gain_pct", "days_tracked", "oi_confirmed",
)


def _public_row(s: dict, include_current: bool = False) -> dict:
    row = {k: s[k] for k in _PUBLIC_FIELDS}
    if include_current:
        row["current_gain_pct"] = s["current_gain_pct"]
        row["latest_price"] = s["latest_price"]
    return row


def compute_scoreboard(picks: list, today: date | None = None) -> dict:
    """Compute the full public scoreboard payload from raw tracker picks.

    Pure: no I/O, injectable `today` for tests.
    """
    today = today or date.today()

    qualified = []
    too_new = 0
    for p in picks:
        s = pick_stats(p)
        if s is None:
            too_new += 1
        else:
            qualified.append(s)

    overall = _bucket_stats(qualified)

    by_grade = []
    for g in GRADE_ORDER:
        bucket = [s for s in qualified if s["grade"] == g]
        row = {"grade": g}
        row.update(_bucket_stats(bucket))
        by_grade.append(row)

    # Recent standouts — best peak gains among picks saved in the last
    # RECENT_WINDOW_DAYS. Only positive peaks qualify as "winners".
    recent = [
        s for s in qualified
        if s["date_saved_parsed"] and (today - s["date_saved_parsed"]).days <= RECENT_WINDOW_DAYS
    ]
    recent_winners = sorted(
        (s for s in recent if s["max_gain_pct"] > 0),
        key=lambda s: s["max_gain_pct"],
        reverse=True,
    )[:RECENT_WINNERS_LIMIT]

    # The honest tape — last picks by save date REGARDLESS of outcome.
    recent_picks = sorted(
        qualified,
        key=lambda s: (s["date_saved_parsed"] or date.min),
        reverse=True,
    )[:RECENT_PICKS_LIMIT]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window": (
            f"All Top Flow picks since tracking began — {len(picks)} flagged, "
            f"{len(qualified)} with at least {MIN_HISTORY_SNAPSHOTS} daily snapshots "
            f"(scored), {too_new} too new to score."
        ),
        "methodology": METHODOLOGY,
        "picks_tracked": len(qualified),
        "too_new": too_new,
        "overall": overall,
        "by_grade": by_grade,
        "recent_winners": [_public_row(s) for s in recent_winners],
        "recent_picks": [_public_row(s, include_current=True) for s in recent_picks],
    }


# ── Response cache (module-level, 5-min TTL) ─────────────────────────────────

_CACHE: dict = {"ts": 0.0, "payload": None}


def _invalidate_cache() -> None:
    """For tests / future admin hooks."""
    _CACHE["ts"] = 0.0
    _CACHE["payload"] = None


def _get_payload() -> dict:
    now = time.time()
    if _CACHE["payload"] is not None and (now - _CACHE["ts"]) < CACHE_TTL_SECONDS:
        return _CACHE["payload"]

    from api.top_flow_tracker import get_all

    try:
        data = get_all()
    except Exception as e:  # tracker unavailable — serve an empty (honest) board
        logger.error("[flow-scoreboard] tracker read failed: %s", e)
        data = {"active": [], "archived": []}

    picks = list(data.get("active", [])) + list(data.get("archived", []))
    payload = compute_scoreboard(picks)
    _CACHE["ts"] = now
    _CACHE["payload"] = payload
    return payload


# ── Routes (public, read-only) ───────────────────────────────────────────────

@router.get("")
def get_scoreboard():
    """Public Flow Scoreboard — no auth by design (read-only trust asset)."""
    return _get_payload()


@router.get("/", include_in_schema=False)
def get_scoreboard_slash():
    return _get_payload()
