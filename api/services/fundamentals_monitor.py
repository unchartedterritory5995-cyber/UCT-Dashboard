"""Continuous fundamentals-accuracy monitor + self-heal + alert.

The structural safety net behind the fundamentals widget, mirroring
`bars_reconciliation` for price data. The per-request pipeline is now
correct (verified across the universe 2026-07-02), and it self-freshens
(earnings-window fast path) and can't serve poison (NaN sanitizer). But
nothing actively *catches* a FUTURE regression — a code change that
reintroduces the forward-quarter off-by-one, a provider that silently
starts returning bad data, or a single ticker that drifts. This module
closes that gap: every cycle it samples a rotating slice of the universe,
runs the same invariant checks that verified the fix, self-heals a stale
cache entry, and alerts (Discord + in-app) on a regression that survives
the heal.

Runs WEB-side (started from main.py's lifespan) — the same reasoning as
bars_reconciliation: the heal is a cache invalidation and the cache users
read lives on the web pod, so healing must happen there. Load is bounded
and light: `_SAMPLE` (~30) cached-or-cheap `get_earnings_table` calls once
per `_CYCLE_SECONDS` (default 1h).

Gated by `FUNDAMENTALS_MONITOR_ENABLED=1` (default OFF).
"""
from __future__ import annotations

import json
import logging
import math
import os
import random
import threading
import time
from datetime import datetime, timezone

from api.services.cache import cache
from api.services.earnings_table import get_earnings_table, _label_from_period_end, _next_q_label

_logger = logging.getLogger(__name__)

# ── Config (env-tunable) ──────────────────────────────────────────────────────
_CYCLE_SECONDS = int(os.environ.get("FUNDAMENTALS_MONITOR_CYCLE_SECONDS", "7200"))  # 2h
_SAMPLE = int(os.environ.get("FUNDAMENTALS_MONITOR_SAMPLE", "30"))
# Cold long-tail fetches per cycle are the ONLY external-quota cost (they can hit
# the shared AlphaVantage 25/day deep-history budget the widget itself uses), so
# bound them small; the rest of the sample is priority + warm (cache-hit) tickers.
_COLD_TAIL = int(os.environ.get("FUNDAMENTALS_MONITOR_COLD_TAIL", "6"))
_STARTUP_DELAY = int(os.environ.get("FUNDAMENTALS_MONITOR_STARTUP_DELAY", "180"))

# Always-audited liquid names — a degradation on these is impossible to miss.
_PRIORITY = (
    "AAPL", "NVDA", "MSFT", "AMZN", "META", "GOOGL", "AVGO", "TSLA", "JPM", "WMT",
    "NKE", "MU", "AMD", "ORCL", "NFLX", "COST", "HD", "UNH", "XOM", "PG",
)

# Invariant violations that should NEVER occur — any one is a regression signal.
_CRITICAL_KINDS = ("exception", "bad_shape", "nan", "dup_quarter", "label_mismatch")

# ── State (for the status endpoint) ───────────────────────────────────────────
_state_lock = threading.Lock()
_state = {
    "enabled": False,
    "running": False,
    "started_at": None,
    "cycle_seconds": _CYCLE_SECONDS,
    "sample_per_cycle": _SAMPLE,
    "cycles_completed": 0,
    "checked_total": 0,
    "healed_total": 0,
    "flagged_total": 0,
    "flagged_current": [],          # tickers still failing after the last cycle's heal
    "_prev_flagged_syms": [],       # for alert-on-change (don't re-spam persistent flags)
    "blank_sales_last_cycle": 0,
    "last_cycle_at": None,
    "last_alert_at": None,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Invariant checks ──────────────────────────────────────────────────────────
def _has_nonfinite(obj) -> bool:
    """True if any float in the (nested) payload is NaN/inf — the sanitizer
    should make this impossible; a hit means it regressed."""
    if isinstance(obj, float):
        return not math.isfinite(obj)
    if isinstance(obj, dict):
        return any(_has_nonfinite(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_nonfinite(v) for v in obj)
    return False


def check_ticker(sym: str, now=None) -> dict:
    """Run the fundamentals-widget invariants on what USERS actually see
    (`get_earnings_table`, cache-backed). Returns
    {sym, ok, issues:[{kind,detail}], blank_sales}. `blank_sales` (annual rows
    with EPS but no revenue) is tallied but NOT a failure — it is legitimate
    for pre-revenue names (miners/clinical biotechs)."""
    sym = (sym or "").upper().strip()
    try:
        data = get_earnings_table(sym, now=now)
    except Exception as e:  # pragma: no cover - defensive; tested via monkeypatch
        return {"sym": sym, "ok": False,
                "issues": [{"kind": "exception", "detail": str(e)[:200]}], "blank_sales": 0}

    if not isinstance(data, dict):
        return {"sym": sym, "ok": False,
                "issues": [{"kind": "bad_shape", "detail": type(data).__name__}], "blank_sales": 0}

    issues: list[dict] = []
    if _has_nonfinite(data):
        issues.append({"kind": "nan", "detail": "non-finite float in payload"})

    q = data.get("quarterly") or []
    a = data.get("annual") or []
    reported = [r for r in q if r.get("reported")]
    forward = [r for r in q if not r.get("reported")]
    rep_labels = [r.get("label") for r in reported if r.get("label")]
    fwd_labels = [r.get("label") for r in forward if r.get("label")]

    # (a) reported quarters unique.
    if len(set(rep_labels)) != len(rep_labels):
        issues.append({"kind": "dup_quarter", "detail": ",".join(rep_labels)})

    # (b) forward quarters unique.
    if len(set(fwd_labels)) != len(fwd_labels):
        issues.append({"kind": "dup_forward", "detail": ",".join(fwd_labels)})

    # (c) no label appears in BOTH the reported and forward sets (a forward
    #     estimate card duplicating an already-reported quarter — the dup class).
    overlap = sorted(set(rep_labels) & set(fwd_labels))
    if overlap:
        issues.append({"kind": "reported_forward_overlap", "detail": ",".join(overlap)})

    # (d) label ↔ period_end consistency — an INDEPENDENT oracle: the label a
    #     forward row carries must match the one its own period_end implies.
    #     Catches a relabeling regression (label assigned by blind sequence while
    #     period_end is real).
    for f in forward:
        pe, lbl = f.get("period_end"), f.get("label")
        if pe and lbl:
            expected = _label_from_period_end(pe)
            if expected and expected != lbl:
                issues.append({"kind": "label_period_mismatch", "detail": f"{lbl}!={expected}@{pe}"})

    # (e) the forward strip is a contiguous fiscal sequence continuing the newest
    #     reported quarter — the check that actually catches the forward-quarter
    #     off-by-one SHIFT (a dropped just-ended quarter), which the per-row
    #     self-consistency check (d) cannot. Verified false-positive-safe across
    #     608 live tickers (only genuine anomalies fire).
    if fwd_labels:
        if rep_labels:
            expected_first = _next_q_label(rep_labels[-1])
            if expected_first and fwd_labels[0] != expected_first:
                issues.append({"kind": "forward_gap",
                               "detail": f"first={fwd_labels[0]} expected={expected_first} (last_rep={rep_labels[-1]})"})
        for prev, nxt in zip(fwd_labels, fwd_labels[1:]):
            if _next_q_label(prev) != nxt:
                issues.append({"kind": "forward_noncontiguous", "detail": f"{prev}->{nxt}"})
                break

    blank_sales = sum(1 for r in a if r.get("eps") is not None and r.get("sales") is None)
    return {"sym": sym, "ok": not issues, "issues": issues, "blank_sales": blank_sales}


# ── Self-heal ─────────────────────────────────────────────────────────────────
def _heal(sym: str, now=None) -> dict:
    """Invalidate the ticker's fundamentals cache families so the next compute
    rebuilds clean, then re-check. If the re-check is clean the anomaly was a
    stale cache; if it persists it is a genuine current-pipeline defect."""
    s = (sym or "").upper().strip()
    try:
        # EXACT-key delete for earnings_table:: (one key per ticker, no trailing
        # separator — a prefix delete would over-match: 'A' would wipe AAPL/AMZN).
        cache.invalidate(f"earnings_table::{s}")
        # mb_year_earnings_{s}_ IS separator-anchored, so prefix delete is safe
        # and correct (it must span the per-year suffix).
        cache.delete_prefix(f"mb_year_earnings_{s}_")
    except Exception:  # pragma: no cover - cache never raises in practice
        pass
    return check_ticker(s, now=now)


# ── Sampling ──────────────────────────────────────────────────────────────────
def _load_universe() -> list[str]:
    try:
        cap_path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
        if os.path.exists(cap_path):
            with open(cap_path) as f:
                u = json.load(f)
            if isinstance(u, dict):
                u = u.get("tickers") or []
            return list(u) if isinstance(u, list) else []
    except Exception:  # pragma: no cover
        _logger.warning("[fund-monitor] cap_universe load failed", exc_info=True)
    return []


def _sample_tickers(n: int) -> list[str]:
    """Priority liquid names + WARM (already-cached) tickers + a small COLD
    long-tail. Warm-biased on purpose: checking a warm ticker is a free cache
    hit and is literally 'what users are viewing', while a cold check can fire a
    scarce AlphaVantage/yfinance deep-history call — so cold is bounded to
    `_COLD_TAIL`/cycle. Deduped, upper-cased, bounded to n. Slow universe
    coverage still happens via the cold tail over many cycles."""
    out = [s.upper() for s in _PRIORITY[:min(len(_PRIORITY), max(1, n // 2))]]
    have = set(out)

    # Warm entries currently in the fundamentals cache (free to re-check).
    try:
        warm = []
        for k in cache.keys_with_prefix("earnings_table::"):
            t = k.split("::", 1)[1].upper() if "::" in k else ""
            if t and t not in have:
                warm.append(t)
        random.shuffle(warm)
        for t in warm:
            if len(out) >= n - _COLD_TAIL:
                break
            have.add(t)
            out.append(t)
    except Exception:  # pragma: no cover
        pass

    # Bounded cold long-tail for slow discovery (the only external-quota cost).
    pool = [s.upper() for s in _load_universe() if s and s.upper() not in have]
    if pool:
        k = min(_COLD_TAIL, max(0, n - len(out)), len(pool))
        out += random.sample(pool, k)
    return out[:n]


# ── Alerting ──────────────────────────────────────────────────────────────────
def _alert(flagged: list[dict]) -> None:
    """Fire an in-app admin alert (throttled) + a Discord webhook for a
    fundamentals regression that survived self-heal. Best-effort."""
    kinds: dict[str, int] = {}
    for f in flagged:
        for i in f.get("issues", []):
            kinds[i["kind"]] = kinds.get(i["kind"], 0) + 1
    summary = ", ".join(f"{k}×{v}" for k, v in sorted(kinds.items())) or "unknown"
    syms = ", ".join(f["sym"] for f in flagged[:15])

    try:
        from api.services import chart_health_alerts
        chart_health_alerts.emit(
            "fundamentals_regression", "critical",
            f"Fundamentals monitor: {len(flagged)} ticker(s) failing invariants after self-heal "
            f"({summary}) — {syms}",
            {"flagged": flagged[:15]},
        )
    except Exception:  # pragma: no cover
        pass

    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "🔴 Fundamentals data regression",
            "description": (f"**{len(flagged)}** ticker(s) still failing invariants after self-heal.\n"
                            f"**Issues:** {summary}\n**Tickers:** {syms}"),
            "color": 0xE23B3B,
            "timestamp": _now_iso(),
        })
    except Exception:  # pragma: no cover
        pass

    with _state_lock:
        _state["last_alert_at"] = _now_iso()


# ── Cycle ─────────────────────────────────────────────────────────────────────
def run_cycle(now=None) -> dict:
    """Sample the universe, check invariants, self-heal transient issues, and
    alert on any that persist. Returns a per-cycle summary."""
    syms = _sample_tickers(_SAMPLE)
    checked = healed = blank_sales = 0
    flagged: list[dict] = []

    for sym in syms:
        res = check_ticker(sym, now=now)
        checked += 1
        blank_sales += res.get("blank_sales", 0)
        if res["ok"]:
            continue
        recheck = _heal(sym, now=now)
        if recheck["ok"]:
            healed += 1
            _logger.info("[fund-monitor] healed %s (was: %s)", sym,
                         ",".join(i["kind"] for i in res["issues"]))
            continue
        flagged.append({"sym": sym, "issues": recheck["issues"]})
        _logger.warning("[fund-monitor] PERSISTENT %s: %s", sym,
                        ",".join(i["kind"] for i in recheck["issues"]))

    # Alert only on NEWLY-flagged tickers, not every cycle: a persistent upstream
    # anomaly (e.g. a stale forward quarter that self-heal can't fix because the
    # source data itself is the problem) stays visible in `flagged_current` via
    # the status endpoint but must not re-spam Discord hourly.
    cur_syms = {f["sym"] for f in flagged}
    prev_syms = set(_state.get("_prev_flagged_syms") or [])
    newly = [f for f in flagged if f["sym"] not in prev_syms]

    with _state_lock:
        _state["cycles_completed"] += 1
        _state["checked_total"] += checked
        _state["healed_total"] += healed
        _state["flagged_total"] += len(flagged)
        _state["flagged_current"] = flagged
        _state["_prev_flagged_syms"] = sorted(cur_syms)
        _state["blank_sales_last_cycle"] = blank_sales
        _state["last_cycle_at"] = _now_iso()

    if newly:
        _alert(newly)

    _logger.info("[fund-monitor] cycle: %d checked, %d healed, %d persistent-flagged, %d blank-sales",
                 checked, healed, len(flagged), blank_sales)
    return {"checked": checked, "healed": healed, "flagged": len(flagged), "blank_sales": blank_sales}


def _run_forever() -> None:
    enabled = os.environ.get("FUNDAMENTALS_MONITOR_ENABLED", "0") == "1"
    with _state_lock:
        _state["enabled"] = enabled
    if not enabled:
        _logger.info("[fund-monitor] disabled (FUNDAMENTALS_MONITOR_ENABLED=0)")
        return

    with _state_lock:
        _state["running"] = True
        _state["started_at"] = _now_iso()
    _logger.info("[fund-monitor] started — cycle every %ds, %d tickers/cycle",
                 _CYCLE_SECONDS, _SAMPLE)

    time.sleep(_STARTUP_DELAY)  # let boot warmers grab the write locks first
    while True:
        try:
            run_cycle()
        except Exception:  # pragma: no cover - one bad cycle must not kill the daemon
            _logger.exception("[fund-monitor] cycle crashed (caught — looping)")
        slept = 0
        while slept < _CYCLE_SECONDS:
            time.sleep(10)
            slept += 10


def start() -> None:
    """Spawn the daemon thread. Idempotent."""
    if getattr(start, "_started", False):
        return
    start._started = True
    threading.Thread(target=_run_forever, daemon=True, name="fundamentals-monitor").start()


def get_state() -> dict:
    with _state_lock:
        return dict(_state)
