"""Earnings Setup Grade (spec §4.2) — deterministic, published arithmetic.

Grades THIS EVENT. The stock is graded elsewhere (the /research RatingCrown's
0-99 UCT Rating); the two are deliberately different instruments and the UI
gives them different visual identities (chip vs ring).

Four inputs, fixed weights, RENORMALISED over whatever is actually available,
so a missing input yields an honest partial basis ("B+ · 3 of 4 inputs")
instead of a silent recompute or a skeleton that blocks pre-market triage.

EVERY weight and threshold below is published verbatim on /methodology (§12).
Change one here and you MUST change app/src/pages/Methodology.jsx in the same
commit — "documented in code" is not a user-facing posture.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os

from api.services import implied_store
from api.services.cache import cache

_log = logging.getLogger(__name__)

SURFACE = "setup"

WEIGHTS: dict[str, float] = {
    "beat_streak": 0.30,
    "revision_30d": 0.30,
    "rs_rank": 0.25,
    "iv_premium": 0.15,
}

LABELS: dict[str, str] = {
    "beat_streak": "Beat streak",
    "revision_30d": "Estimate revisions (30d)",
    "rs_rank": "Relative strength rank",
    "iv_premium": "Options premium vs typical move",
}

# Descending; the first threshold met wins. Anything under the last one is F.
LETTER_THRESHOLDS: list[tuple[float, str]] = [
    (93, "A+"), (85, "A"), (78, "A-"),
    (71, "B+"), (64, "B"), (57, "B-"),
    (50, "C+"), (43, "C"), (36, "C-"),
    (29, "D+"), (22, "D"), (15, "D-"),
]
FLOOR_LETTER = "F"

# Below this many available inputs the grade is not stated AT ALL. One input is
# not a grade, it is that input wearing a letter.
MIN_INPUTS = 2

# Bound on the nightly snapshot sweep (§6: cheap, but never unbounded).
MAX_SNAPSHOT_SYMBOLS = int(os.environ.get("GRADE_SNAPSHOT_MAX", "120"))

# The realized-move average is stable for closed quarters; 24h matches the
# posture the calendar's past-day enrichment already takes.
_REALIZED_TTL = 24 * 3600


def letter_for(score: float) -> str:
    for floor, letter in LETTER_THRESHOLDS:
        if score >= floor:
            return letter
    return FLOOR_LETTER


def _num(v):
    """None-preserving numeric coercion. `float(None)` raises and `bool(0.0)` is
    False, so neither shortcut is safe here: a genuine 0.0 IS data."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


# ── sub-scores: each returns (0..100 score, human detail) or (None, None) ──────

def score_beat_streak(beat_history) -> tuple[float | None, str | None]:
    rows = [r for r in (beat_history or [])
            if isinstance(r, dict) and r.get("beat") is not None]
    if not rows:
        return None, None
    beats = sum(1 for r in rows if r["beat"])
    return 100.0 * beats / len(rows), f"{beats} of {len(rows)} beats"


def score_revision_30d(revisions) -> tuple[float | None, str | None]:
    for row in revisions or []:
        if not isinstance(row, dict):
            continue
        up, down = _num(row.get("up30")), _num(row.get("down30"))
        if up is None and down is None:
            continue
        up, down = up or 0.0, down or 0.0
        total = up + down
        if total <= 0:
            # Zero revisions is NO SIGNAL, not a neutral 50 — scoring it 50
            # would quietly drag the whole grade toward the middle.
            continue
        return 100.0 * up / total, f"{int(up)} up / {int(down)} down (30d)"
    return None, None


def score_rs_rank(rs) -> tuple[float | None, str | None]:
    rank = _num(rs.get("rs_rank")) if isinstance(rs, dict) else None
    if rank is None:
        return None, None
    return rank, f"RS {int(rank)} of 99"


def score_iv_premium(implied_pct, avg_abs_realized_pct) -> tuple[float | None, str | None]:
    implied, realized = _num(implied_pct), _num(avg_abs_realized_pct)
    if implied is None or realized is None or realized <= 0:
        return None, None
    implied = abs(implied)          # an implied move is a MAGNITUDE, never signed
    ratio = implied / realized
    # ratio 0.5 -> 100 (cheap), 1.0 -> 50 (fair), >= 1.5 -> 0 (rich)
    score = max(0.0, min(100.0, (1.5 - ratio) * 100.0))
    return score, f"±{implied:.1f}% priced vs ±{realized:.1f}% typical"


# ── composition ───────────────────────────────────────────────────────────────

def compute_grade(scored: dict) -> dict | None:
    """Pure. `scored` maps every WEIGHTS key to (score, detail) or None."""
    present = {k: v for k, v in (scored or {}).items() if k in WEIGHTS and v is not None}
    if len(present) < MIN_INPUTS:
        return None
    wsum = sum(WEIGHTS[k] for k in present)
    total = sum(WEIGHTS[k] * present[k][0] for k in present) / wsum
    inputs = [{
        "key": k,
        "label": LABELS[k],
        "weight": WEIGHTS[k],
        "available": k in present,
        "score": round(present[k][0], 1) if k in present else None,
        "detail": present[k][1] if k in present else None,
    } for k in WEIGHTS]
    return {
        "letter": letter_for(total),
        "score": round(total, 1),
        "basis": None if len(present) == len(WEIGHTS)
                 else f"{len(present)} of {len(WEIGHTS)} inputs",
        "inputs_present": len(present),
        "inputs_total": len(WEIGHTS),
        "inputs": inputs,
        "asof": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
    }


# ── impure sources: one seam each, so a test can break exactly one ────────────

def _beat_history(sym: str):
    from api.services.earnings_estimates import get_earnings_intel
    intel = get_earnings_intel(sym)
    return (intel or {}).get("beat_history")


def _revisions(sym: str):
    from api.services.research.estimates import get_estimates
    return (get_estimates(sym) or {}).get("revisions")


def _rs(sym: str):
    from api.services import rs_ranking
    # Pure cache lookup — never triggers the ~17s universe rebuild.
    return rs_ranking.get_rs_for_ticker(sym)


def _avg_abs_realized(sym: str):
    """Average |next-day move| over the stored quarters. Cached 24h; a FAILED
    fetch is NEVER cached as a value (lesson_market_cap_cache_poison)."""
    key = f"setup_grade_realized_{sym.upper()}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    from api.services.earnings_enrichment import get_historical_earnings_moves
    from api.services.engine import _fetch_quarterly_history
    raw = get_historical_earnings_moves(sym, _fetch_quarterly_history(sym))
    val = _num((raw or {}).get("avg_abs_move_pct"))
    if val is not None:
        cache.set(key, val, ttl=_REALIZED_TTL)
    return val


def gather_inputs(sym: str, live_move: dict | None = None) -> dict:
    """Every source is individually isolated: one dead provider costs one input
    (visible as the partial basis), never the whole grade."""
    sym = (sym or "").upper().strip()
    out: dict = {}

    def _try(key, fn):
        try:
            s, d = fn()
        except Exception:  # noqa: BLE001 — a dead source is a MISSING INPUT, not a 500
            _log.debug("[setup-grade] input %s failed for %s", key, sym, exc_info=True)
            s, d = None, None
        out[key] = None if s is None else (s, d)

    _try("beat_streak", lambda: score_beat_streak(_beat_history(sym)))
    _try("revision_30d", lambda: score_revision_30d(_revisions(sym)))
    _try("rs_rank", lambda: score_rs_rank(_rs(sym)))
    _try("iv_premium", lambda: score_iv_premium((live_move or {}).get("pct"),
                                                _avg_abs_realized(sym)))
    return out


def get_setup_grade(sym: str, live_move: dict | None = None) -> dict | None:
    return compute_grade(gather_inputs(sym, live_move=live_move))


# ── §12 accountability record ─────────────────────────────────────────────────

def run_daily_grade_snapshot(now: _dt.datetime | None = None) -> dict:
    """One persisted grade per upcoming reporter per day (spec §6/§12).

    Runs post-close alongside the implied capture so the recorded grade is the
    one computed against that evening's implied move. Bounded, deduped and
    exception-isolated per symbol. `now` is INJECTED — no function in this
    module may read the clock behind a caller's back.
    """
    now = now or _dt.datetime.now()
    today = now.date().isoformat()

    seen: set[str] = set()
    syms: list[str] = []
    for rep in implied_store.upcoming_reporters(days=14, now=now) or []:
        s = (rep.get("sym") or "").upper().strip()
        if not s or s in seen:
            continue
        seen.add(s)
        syms.append(s)
        if len(syms) >= MAX_SNAPSHOT_SYMBOLS:
            break

    summary = {"recorded": 0, "skipped": 0, "failed": 0}
    for sym in syms:
        try:
            grade = get_setup_grade(sym)
            if not grade:
                summary["skipped"] += 1
                continue
            implied_store.record_grade(sym=sym, date=today, surface=SURFACE,
                                       grade=grade["letter"], inputs=grade["inputs"])
            summary["recorded"] += 1
        except Exception:  # noqa: BLE001 — one bad symbol must never truncate the batch
            _log.warning("[setup-grade] snapshot failed for %s", sym, exc_info=True)
            summary["failed"] += 1
    _log.info("[setup-grade] daily snapshot: %s", summary)
    return summary
