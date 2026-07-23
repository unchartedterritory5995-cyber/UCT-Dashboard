"""Source 11 (enrichment, not discovery): the Brain's setup-grade.

Attaches the FIRM's own historical edge to a candidate whose situation maps to
a named setup the trading brain has stats on — e.g. an earnings/news gapper is
an Episodic Pivot, which the brain has graded across hundreds of logged trades
(win-rate + expectancy). This is what turns "the news feed flagged $X" into
"$X is the setup type we've historically made money on."

Unlike a source pull, this discovers no tickers — it enriches candidates the
move-detectors already found. Every candidate it grades already has a real move
or hard signal (it only fires on earnings/scanner/gap+news/52w-high names), so
it adds NO new gate: it's pure ranking + narrative color.

Reads through `brain_service` (the shared facade over the installed Brain Pack).
Fail-soft in every direction:
  - brain not installed / flag off            -> no-op (no brain_grade attached)
  - a setup with < 5 logged trades            -> no grade (honest: no edge yet)
  - any exception                             -> swallowed, candidate untouched

So the catalyst engine behaves identically whether or not the pack is present;
where the pack IS present, graded names carry the firm's real expectancy into
the curator + synthesis. Gated on CATALYST_BRAIN_ENABLED (default on).
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.environ.get("CATALYST_BRAIN_ENABLED", "1").lower() in ("1", "true", "yes")


def _f(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


# Scanner bucket / alert label -> canonical brain setup name. The brain's
# resolve_setup_name() handles further aliasing; anything not matched here just
# doesn't get a scanner-based inference (the signal-based rules below still run).
_SCANNER_SETUP_MAP = {
    "GAPPER_NEWS": "Episodic Pivot",
    "GAPPER": "Episodic Pivot",
    "REMOUNT": "Remount",
    "PULLBACK_MA": "20 EMA Pullback",
    "PULLBACK": "20 EMA Pullback",
}


def _infer_setup(c: dict) -> str | None:
    """Best-effort map of a candidate's situation to a named firm setup.

    Priority: an explicit scanner bucket, then earnings-gap (PEG), then a
    news-driven gap-up out of a move (Episodic Pivot), then a break to new
    highs (Flat Base Breakout). Returns None when nothing maps confidently —
    we never guess a setup just to force a grade.
    """
    min_up = _f("CATALYST_BRAIN_MIN_GAP", 3.0)
    gap = c.get("gap_pct")
    gap_f = float(gap) if isinstance(gap, (int, float)) else 0.0

    # 1. Scanner already named a bucket — most reliable signal.
    setup = c.get("scanner_setup")
    if setup:
        st = (setup.get("setup_type") or "").upper()
        for key, name in _SCANNER_SETUP_MAP.items():
            if key in st:
                return name

    # 2. Earnings gap-up = Power Earnings Gap (the accurate name; if the firm
    #    hasn't logged enough PEGs the grade simply won't attach).
    if c.get("earnings_just_reported") and gap_f >= min_up:
        return "Power Earnings Gap"

    # 3. Fresh-catalyst gap-up with no earnings = Episodic Pivot (news gapper
    #    out of a base — the firm's most-logged catalyst setup).
    has_news = bool(c.get("rss") or c.get("tweets")
                    or c.get("hunter_confirmed") or c.get("analyst_meta"))
    if gap_f >= min_up and has_news and not c.get("earnings_just_reported"):
        return "Episodic Pivot"

    # 4. Break to new highs = Flat Base Breakout.
    if c.get("near_52w_high"):
        return "Flat Base Breakout"

    return None


def _grade_one(setup_name: str):
    """Return the brain's setup_winrate dict for setup_name, or None on any
    unavailability (pack missing / thin sample / error)."""
    try:
        from api.services import brain_service
        if not brain_service.available():
            return None
        perf = brain_service.setup_winrate(setup_name, "ALL")
    except Exception:
        return None
    if not isinstance(perf, dict) or not perf.get("ok"):
        return None
    return perf


def enrich(candidates: list[dict]) -> int:
    """Attach `brain_grade` to every candidate whose setup the brain can grade.

    In place. Returns the count graded (for source stats). No-op + returns 0
    when disabled or the pack isn't installed. Never raises."""
    if not _enabled() or not candidates:
        return 0
    try:
        from api.services import brain_service
        if not brain_service.available():
            return 0
    except Exception:
        return 0

    # Memoize per-setup lookups — many candidates share a setup (all the news
    # gappers are Episodic Pivots), so we hit the brain once per distinct setup.
    cache: dict[str, dict | None] = {}
    graded = 0
    for c in candidates:
        setup = _infer_setup(c)
        if not setup:
            continue
        if setup not in cache:
            cache[setup] = _grade_one(setup)
        perf = cache[setup]
        if not perf:
            continue
        c["brain_grade"] = {
            "setup": perf.get("setup") or setup,
            "win_rate_pct": perf.get("win_rate_pct"),
            "sample": perf.get("total_trades"),
            "expectancy": perf.get("expectancy"),
            "avg_gain_pct": perf.get("avg_gain_pct"),
            "avg_loss_pct": perf.get("avg_loss_pct"),
        }
        graded += 1
    return graded
