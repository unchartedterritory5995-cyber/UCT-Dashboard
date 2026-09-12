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
import sqlite3
import threading
import time
from datetime import datetime, timezone

from api.services.cache import cache
from api.services.earnings_table import (
    get_earnings_table, _label_from_period_end, _next_q_label,
    expected_latest_reported_label, reported_staleness,
)

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

# Quarters behind the generic reporting expectation before a strip counts as
# stale. 1 is an ordinary late filer; 2 means a quarter is genuinely missing.
_STALE_QUARTERS = int(os.environ.get("FUNDAMENTALS_MONITOR_STALE_QUARTERS", "2"))

# Invariant violations that mean OUR pipeline regressed — these, and only these,
# page Discord.
#
# The split is "who is supposed to guarantee this?". Every kind below is an
# invariant OUR OWN code enforces: `_fmp_forward_quarters` filters a forward row
# whose label is already reported (`reported_forward_overlap`) or already seen
# (`dup_forward`), `_build_quarterly` dedups by (year, quarter)
# (`dup_quarter`), and the sanitizer makes `nan` impossible. One of these
# surfacing means a guard stopped working — exactly what this monitor exists to
# catch.
#
# `forward_gap`, `forward_noncontiguous` and `stale_reported` are the other
# half: they describe a HOLE in what a provider handed us, which our code then
# faithfully reproduces. Real, worth recording, and not something a page at
# 23:00 can act on — they stay in `flagged_current` and are served by
# /api/admin/fundamentals-health.
#
# ⚰️ This tuple existed since 2026-07-03 and was referenced NOWHERE, so every
# kind paged equally — the 2026-09-11 investigation's "a few alerts a day".
# It also read `label_mismatch`, which check_ticker has never emitted; wiring it
# as written would have silently demoted the real `label_period_mismatch`
# regression signal to non-paging.
_CRITICAL_KINDS = ("exception", "bad_shape", "nan", "dup_quarter", "dup_forward",
                   "reported_forward_overlap", "label_period_mismatch")

# ── Durable defect state ──────────────────────────────────────────────────────
# `_state` is a module dict and this pod redeploys several times a day, so an
# in-memory suppression set makes every boot rediscover a standing defect as
# news. Same lesson provider_coverage_monitor recorded on 2026-08-09.
_DATA_DIR = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(os.getcwd(), "data"))
DB_PATH = os.environ.get("FUNDAMENTALS_MONITOR_DB", os.path.join(_DATA_DIR, "fundamentals_monitor.db"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS defect_state (
  sym   TEXT PRIMARY KEY,
  kinds TEXT NOT NULL,
  since TEXT NOT NULL
);
"""

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
    "_prev_flagged_syms": [],       # in-memory MIRROR of defect_state (fallback only)
    "skipped_funds_last_cycle": 0,  # ETFs/CEFs passed over — no quarterly strip to check
    "blank_sales_last_cycle": 0,
    "last_cycle_at": None,
    "last_alert_at": None,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.executescript(_SCHEMA)
    return conn


def _load_defect_syms() -> set[str]:
    """Tickers already known to be in defect, from disk — so a redeploy does not
    turn a standing defect back into news."""
    try:
        with _connect() as conn:
            return {r[0] for r in conn.execute("SELECT sym FROM defect_state").fetchall()}
    except Exception:  # pragma: no cover - fall back to the in-memory mirror
        _logger.warning("[fund-monitor] defect_state read failed", exc_info=True)
        return set(_state.get("_prev_flagged_syms") or [])


def _save_defect_state(checked: set[str], flagged: dict[str, list[str]], ts: str) -> None:
    """Record this cycle's outcome for the tickers it ACTUALLY CHECKED.

    ⛔ The difference from provider_coverage_monitor's version, and the whole
    point of this fix: that monitor evaluates its entire population every cycle,
    so "absent from the defect set" means recovered. This one SAMPLES ~30 of
    ~3,700 names, so absent almost always means "not looked at this cycle".
    Clearing those is precisely the bug — a standing defect would leave the set
    the moment it went unsampled and page again on its next appearance.

    A ticker that WAS checked and came back clean must still leave the set, or
    its next genuine breach is silent — the worse of the two directions."""
    if not checked:
        return
    try:
        with _connect() as conn:
            recovered = sorted(checked - set(flagged))
            if recovered:
                conn.execute(
                    "DELETE FROM defect_state WHERE sym IN (%s)" % ",".join("?" * len(recovered)),
                    tuple(recovered),
                )
            for sym, kinds in sorted(flagged.items()):
                # DO UPDATE only the kinds: `since` stays the moment the defect
                # STARTED, so a long-standing one can be dated.
                conn.execute(
                    "INSERT INTO defect_state (sym, kinds, since) VALUES (?, ?, ?) "
                    "ON CONFLICT(sym) DO UPDATE SET kinds=excluded.kinds",
                    (sym, ",".join(sorted(kinds)), ts),
                )
    except Exception:  # pragma: no cover
        _logger.warning("[fund-monitor] defect_state write failed", exc_info=True)


def _is_fund(sym: str) -> bool:
    """True for an ETF or closed-end fund — a name with no quarterly EPS strip
    to be wrong about.

    In a 300-ticker sample of the monitor's own universe (2026-09-12), 17 of the
    24 names whose reported strip was stale were CEFs — Nuveen, PIMCO, Eaton
    Vance, BlackRock. They can never satisfy these invariants, so they were a
    permanent and meaningless share of the alert volume.

    Reuses the profile lookup that already backs dark-pool ETF detection
    (cached per name per day, `isEtf or isFund`). Fails to False: an unknown
    name is treated as an operating company, so a provider outage can never
    silence a real regression."""
    try:
        from api.darkpool_eod import _ticker_meta
        return (_ticker_meta(sym) or {}).get("isEtf") is True
    except Exception:  # pragma: no cover - profile lookup is best-effort
        return False


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

    # (f) the REPORTED half is not stale. The completeness guard in
    #     `_build_and_cache` only ever asked whether there were ZERO reported
    #     quarters, so a strip whose newest actual was two quarters old passed as
    #     complete, held the full TTL, persisted to the snapshot store, and was
    #     served as current. Measured 2026-09-12: MMC's newest reported quarter
    #     was 2025 Q4 because FMP's feed stops at 2026-01-29, Finnhub returns
    #     nothing, and Yahoo stops earlier still. ~2.3% of the universe is in
    #     this state, including S&P 500 names (BK, HOLX).
    behind = reported_staleness(q, now=now)
    if behind >= _STALE_QUARTERS:
        issues.append({"kind": "stale_reported",
                       "detail": f"reported through {rep_labels[-1] if rep_labels else '?'}; "
                                 f"expected {expected_latest_reported_label(now=now)} "
                                 f"({behind} quarters behind)"})

    blank_sales = sum(1 for r in a if r.get("eps") is not None and r.get("sales") is None)
    return {"sym": sym, "ok": not issues, "issues": issues, "blank_sales": blank_sales}


# ── Self-heal ─────────────────────────────────────────────────────────────────
def _heal(sym: str, now=None) -> dict:
    """Invalidate the ticker's fundamentals cache families so the next compute
    rebuilds clean, then re-check. If the re-check is clean the anomaly was a
    stale cache; if it persists it is a genuine current-pipeline defect."""
    s = (sym or "").upper().strip()
    try:
        # Clears memory AND the persistent disk snapshot — with the
        # stale-while-revalidate serve path a memory-only invalidate would
        # re-serve the same bad payload from disk and the re-check would lie.
        from api.services.earnings_table import invalidate as _et_invalidate
        _et_invalidate(s)
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
    checked = healed = blank_sales = skipped_funds = 0
    flagged: list[dict] = []
    seen: set[str] = set()

    for sym in syms:
        res = check_ticker(sym, now=now)
        checked += 1
        seen.add(sym)
        blank_sales += res.get("blank_sales", 0)
        if res["ok"]:
            continue
        recheck = _heal(sym, now=now)
        if recheck["ok"]:
            healed += 1
            _logger.info("[fund-monitor] healed %s (was: %s)", sym,
                         ",".join(i["kind"] for i in res["issues"]))
            continue
        # An ETF/CEF has no quarterly EPS strip, so it can never satisfy these
        # invariants. Consulted only for a ticker that already FAILED, so the
        # profile lookup costs nothing on the clean majority.
        if _is_fund(sym):
            skipped_funds += 1
            _logger.info("[fund-monitor] skipped %s (fund/ETF — no quarterly strip)", sym)
            continue
        flagged.append({"sym": sym, "issues": recheck["issues"]})
        _logger.warning("[fund-monitor] PERSISTENT %s: %s", sym,
                        ",".join(i["kind"] for i in recheck["issues"]))

    # Page only on a NEWLY-seen defect that indicates OUR pipeline regressed.
    # Everything else — an upstream hole, a stale provider feed — is recorded in
    # `flagged_current` and served by /api/admin/fundamentals-health, because a
    # page cannot act on it and re-firing one is what made these alerts noise.
    #
    # "Newly" is read from DISK and written back only for the tickers this cycle
    # actually checked: the sample rotates, so the previous in-memory set said
    # "not flagged last cycle" about names it had simply never looked at.
    ts = _now_iso()
    prev_syms = _load_defect_syms()
    by_sym = {f["sym"]: [i["kind"] for i in f["issues"]] for f in flagged}
    alertable = [f for f in flagged
                 if any(i["kind"] in _CRITICAL_KINDS for i in f["issues"])]
    newly = [f for f in alertable if f["sym"] not in prev_syms]
    _save_defect_state(seen, by_sym, ts)

    with _state_lock:
        _state["cycles_completed"] += 1
        _state["checked_total"] += checked
        _state["healed_total"] += healed
        _state["flagged_total"] += len(flagged)
        _state["flagged_current"] = flagged
        _state["_prev_flagged_syms"] = sorted(by_sym)
        _state["skipped_funds_last_cycle"] = skipped_funds
        _state["blank_sales_last_cycle"] = blank_sales
        _state["last_cycle_at"] = ts

    if newly:
        _alert(newly)

    _logger.info("[fund-monitor] cycle: %d checked, %d healed, %d persistent-flagged, "
                 "%d fund-skipped, %d paged, %d blank-sales",
                 checked, healed, len(flagged), skipped_funds, len(newly), blank_sales)
    return {"checked": checked, "healed": healed, "flagged": len(flagged),
            "skipped_funds": skipped_funds, "paged": len(newly), "blank_sales": blank_sales}


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
