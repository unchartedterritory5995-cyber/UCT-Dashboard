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

import concurrent.futures as _cf
import datetime as _dt
import logging
import os
import time as _time

from api.services import implied_move, implied_store
from api.services.cache import TTLCache, cache
from api.services.serve_stale import ServeStale

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

# ── request-path fan-out bounds (the repo's 524 class) ─────────────────────────
#
# `gather_inputs` reaches THREE external providers (beat history, estimate
# revisions, and the realized-move average behind iv_premium — `_rs` is a pure
# cache lookup and never fetches). They run CONCURRENTLY on a small dedicated
# pool, mirroring `earnings_enrichment.enrich_earnings_response`'s
# ThreadPoolExecutor(+timeout) fan-out. Unlike that helper, this pool is
# MODULE-LEVEL and NEVER shut down: `ThreadPoolExecutor.__exit__` calls
# `shutdown(wait=True)`, which blocks until every submitted job finishes — a
# `with ThreadPoolExecutor(...) as pool:` block would silently undo a
# per-future `result(timeout=)` bound (a hung yfinance call reached through
# `_avg_abs_realized` would still pin the request thread at cleanup). This
# mirrors `api/services/yf_util.py`'s `_POOL`: the calling thread is freed even
# when the worker itself keeps running past the timeout — the leaked thread
# finishes on its own and is never joined.
#
# max_workers=6 (not 3): one request's three legs at a time is zero slack — a
# handful of concurrently-hung `_avg_abs_realized` calls across different
# symbols would permanently consume every worker (a request queued behind them
# would time out on ALL its inputs, not just iv_premium, silently nulling every
# grade until restart). 6 gives one full request's worth of headroom even if a
# previous request already leaked workers.
#
# CHOICE (documented per the review): `_avg_abs_realized`'s yfinance leg is
# bounded via `yfinance_pool.run_in_pool(..., timeout=5)` — the SAME
# nested-timeout precedent `_revisions` already relies on
# (`research.estimates._fetch` wraps its own yfinance call the identical way).
# That bound, not this pool's own `_SOURCE_TIMEOUT`, is what actually frees a
# `_GATHER_POOL` worker: `fut.result(timeout=)` below only bounds how long the
# CALLING thread waits, not how long the submitted callable keeps running once
# started — without the inner bound, the worker thread itself stays pinned on
# the raw `_yf.Ticker(sym).history()` call indefinitely.
_GATHER_POOL = _cf.ThreadPoolExecutor(max_workers=6, thread_name_prefix="setup-grade-gather")
_SOURCE_TIMEOUT = 6.0   # hard per-source ceiling (seconds)
_GRADE_BUDGET = 10.0    # overall wall-clock ceiling for one gather_inputs call
_REALIZED_YF_TIMEOUT = 5.0  # bound on the yfinance leg inside _avg_abs_realized

# TTL + serve-stale front for `get_setup_grade`, mirroring
# `implied_move.get_expected_move`'s composition exactly: a fresh TTL hit costs
# ~0, an expired-but-recent grade serves instantly while a rebuild runs behind
# the caller, and a cold caller single-flights onto one gather+compute. A
# failed/ungradeable build (`None`) is NEVER remembered — `_grade_is_good` is
# the gate, same contract as `_move_is_good` in implied_move.py.
_GRADE_CACHE = TTLCache()
_GRADE_TTL = 900  # 15 min — matches implied_move's IV-moves-through-session cadence
_GRADE_STALE = ServeStale("setup_grade", max_age_seconds=7200)


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
        # Grade the DISPLAYED score, not the unrounded total — a total like
        # 70.96 rounds for display to 71.0 (the B+ floor); lettering off the
        # unrounded value would show "71.0 · B", which reads as a bug.
        "letter": letter_for(round(total, 1)),
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
    fetch is NEVER cached as a value (lesson_market_cap_cache_poison).

    `get_historical_earnings_moves` reaches a raw `_yf.Ticker(sym).history()`
    call with no timeout of its own — the one genuinely UNBOUNDED leg in this
    module (see `_GATHER_POOL`'s comment). Bounded here at the call site via
    `yfinance_pool.run_in_pool(..., timeout=_REALIZED_YF_TIMEOUT)` rather than
    editing `earnings_enrichment.py` itself, which is shared with the
    calendar's request path — the blast radius of a wrong timeout value stays
    inside this module. A timeout raises `concurrent.futures.TimeoutError`,
    which the caller (`gather_inputs`'s `_run`) already treats as a missing
    input, same as any other exception.
    """
    key = f"setup_grade_realized_{sym.upper()}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    from api.services.earnings_enrichment import get_historical_earnings_moves
    from api.services.engine import _fetch_quarterly_history
    from api.services.yfinance_pool import run_in_pool

    def _fetch():
        return get_historical_earnings_moves(sym, _fetch_quarterly_history(sym))

    raw = run_in_pool(_fetch, timeout=_REALIZED_YF_TIMEOUT)
    val = _num((raw or {}).get("avg_abs_move_pct"))
    if val is not None:
        cache.set(key, val, ttl=_REALIZED_TTL)
    return val


def gather_inputs(sym: str, live_move: dict | None = None) -> dict:
    """Every source is individually isolated AND time-bounded: one dead or
    HUNG provider costs one input (visible as the partial basis), never the
    whole grade and never a stuck request-thread (the repo's 524 class).

    `rs_rank` is a pure cache lookup (`rs_ranking.get_rs_for_ticker` never
    fetches) so it runs inline. The three sources that reach an external
    provider — beat history, estimate revisions, and the realized-move
    average behind iv_premium — run CONCURRENTLY on `_GATHER_POOL`, each
    bounded by `_SOURCE_TIMEOUT` and all together by the overall
    `_GRADE_BUDGET` wall-clock ceiling. A source that times out is scored
    identically to one that raised: a missing input, never a crash and never
    an unbounded wait.
    """
    sym = (sym or "").upper().strip()
    out: dict = {}

    def _run(fn):
        try:
            return fn()
        except Exception:  # noqa: BLE001 — a dead source is a MISSING INPUT, not a 500
            return None, None

    try:
        s, d = score_rs_rank(_rs(sym))
    except Exception:  # noqa: BLE001
        _log.debug("[setup-grade] input rs_rank failed for %s", sym, exc_info=True)
        s, d = None, None
    out["rs_rank"] = None if s is None else (s, d)

    jobs = {
        "beat_streak": lambda: score_beat_streak(_beat_history(sym)),
        "revision_30d": lambda: score_revision_30d(_revisions(sym)),
        "iv_premium": lambda: score_iv_premium((live_move or {}).get("pct"),
                                                _avg_abs_realized(sym)),
    }
    futs = {key: _GATHER_POOL.submit(_run, fn) for key, fn in jobs.items()}
    deadline = _time.monotonic() + _GRADE_BUDGET
    for key, fut in futs.items():
        remaining = max(0.0, deadline - _time.monotonic())
        try:
            s, d = fut.result(timeout=min(_SOURCE_TIMEOUT, remaining))
        except _cf.TimeoutError:
            _log.warning("[setup-grade] input %s timed out for %s", key, sym)
            s, d = None, None
        except Exception:  # noqa: BLE001 — belt-and-suspenders; _run already catches
            _log.debug("[setup-grade] input %s failed for %s", key, sym, exc_info=True)
            s, d = None, None
        out[key] = None if s is None else (s, d)
    return out


def _grade_is_good(payload: dict | None) -> bool:
    """A None/ungradeable build must never become the value the next caller
    sees — same contract as `implied_move._move_is_good`."""
    return payload is not None


def get_setup_grade(sym: str, live_move: dict | None = None) -> dict | None:
    """Cached + serve-stale front for `compute_grade(gather_inputs(...))`:
    fresh TTL wins; else the last good grade serves the gap while a rebuild
    runs behind the caller; else this caller builds synchronously
    (single-flight) — mirrors `implied_move.get_expected_move` exactly.

    KEYING NOTE: the cache key carries a basis dimension (`iv`/`noiv`), not
    just the symbol. A grade built while `live_move` was `None` (3-of-4
    partial basis) and one built once `live_move` is available (full 4-of-4)
    are DIFFERENT payloads — sharing one slot would let a stale partial basis
    sit beside a chain that has already started succeeding for up to the full
    15-min TTL, contradicting the whole reason the grade rides the
    expected-move payload (§ the router-fold rationale: consistency with
    `live` on the SAME response). Two slots means the partial→full transition
    recomputes fresh on the very first request where `live_move` exists,
    instead of waiting out the TTL.
    """
    sym_key = (sym or "").upper().strip()
    key = f"setupgrade::{sym_key}::{'iv' if live_move else 'noiv'}"

    def _build():
        value = compute_grade(gather_inputs(sym, live_move=live_move))
        if value is not None:
            _GRADE_CACHE.set(key, dict(value), _GRADE_TTL)
        return value

    result = _GRADE_STALE.serve(
        key,
        fresh=lambda: _GRADE_CACHE.get(key),
        build=_build,
        good=_grade_is_good,
    )
    return dict(result) if result is not None else None


# ── §12 accountability record ─────────────────────────────────────────────────

# Startup catch-up (2026-08-05 incident) — mirrors implied_store.py's
# CAPTURE_HOUR_ET/capture_due_by exactly, 5 minutes later (this job is meant
# to run right after the implied capture so it rides that evening's freshly
# stored chain read). See implied_store.py's "startup catch-up" section for
# the full rationale (why misfire_grace_time can't cover a process restart)
# and `implied_store.latest_grade_date` for the DB-side half of this
# predicate, used together by api/main.py's IMPLIED_STORE_ENABLED startup
# block.
GRADE_SNAPSHOT_HOUR_ET = 16
GRADE_SNAPSHOT_MINUTE_ET = 40


def grade_snapshot_due_by(now_et: _dt.datetime) -> bool:
    """True iff the §12 snapshot's weekday trigger window has opened as of
    `now_et` (Mon–Fri, at/after 16:40 ET). Pure — same shape and same
    weekday-only/holiday-harmless reasoning as `implied_store.capture_due_by`."""
    if now_et.weekday() >= 5:
        return False
    return (now_et.hour, now_et.minute) >= (GRADE_SNAPSHOT_HOUR_ET, GRADE_SNAPSHOT_MINUTE_ET)


def run_daily_grade_snapshot(now: _dt.datetime | None = None) -> dict:
    """One persisted grade per upcoming reporter per day (spec §6/§12).

    Runs post-close alongside the implied capture (16:40 ET, 5 min after the
    16:35 ET capture) so the recorded grade is scored against THAT evening's
    freshly-stored implied move — `get_expected_move` re-fetches only on a
    cache miss, so this read rides the capture's own warm cache rather than
    re-hitting the chain. Bounded, deduped and exception-isolated per symbol.
    `now` is INJECTED and defaults to ET (matching `implied_store._ET`, the
    timezone every other job in this store already assumes) — no function in
    this module may read the SERVER's naive local clock behind a caller's back.
    """
    now = now or _dt.datetime.now(implied_store._ET)
    today = now.date().isoformat()

    seen: set[str] = set()
    entries: list[tuple[str, str | None]] = []
    for rep in implied_store.upcoming_reporters(days=14, now=now) or []:
        s = (rep.get("sym") or "").upper().strip()
        if not s or s in seen:
            continue
        seen.add(s)
        entries.append((s, rep.get("report_date")))
        if len(entries) >= MAX_SNAPSHOT_SYMBOLS:
            break

    summary = {"recorded": 0, "skipped": 0, "failed": 0}
    for sym, report_date in entries:
        try:
            try:
                live = implied_move.get_expected_move(sym, report_date)
            except Exception:  # noqa: BLE001 — a bad/slow chain read costs iv_premium,
                # never the whole symbol's grading attempt.
                _log.debug("[setup-grade] live-move fetch failed for %s", sym, exc_info=True)
                live = None
            grade = get_setup_grade(sym, live_move=live)
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
