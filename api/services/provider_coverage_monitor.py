"""Continuous per-field DATA COVERAGE monitor + bounded self-heal + alert.

Generalizes `api/services/fundamentals_monitor.py`'s detect -> self-heal ->
alert-on-change pattern from ONE surface (the fundamentals widget) to the
per-FIELD fill-rate across the research/earnings data surfaces. Same
skeleton, same idioms — see that module first if this one is unfamiliar.

── Why this exists ───────────────────────────────────────────────────────────
On 2026-08-05, two Finnhub endpoints (`/stock/upgrade-downgrade`,
`/stock/transcripts/list`) were found to have been returning HTTP 403 on
EVERY call for months — 100% blank in production — discovered only because a
human happened to look. The same night also turned up a 48h-cached blank
Financials tab, a 7-day logo-miss retry job with no scheduler caller, and a
nightly implied-move capture silently returning `{'captured': 0}`. Every one
of those was a **200 response with an empty/null field**, which no uptime
check or "did the endpoint 200" probe would ever catch. This module measures
FILL RATE, not response status, so a field going quietly blank surfaces on a
dashboard the next cycle instead of surviving until someone happens to open
the app and notice a hole.

── What "coverage" means here ────────────────────────────────────────────────
Each cycle samples a rotating slice of tickers (`_sample_tickers` — same
priority + warm + bounded-cold-tail idiom as fundamentals_monitor) plus a
couple of calendar-scoped and store-scoped reads, and computes, per FIELD,
what fraction of the sample actually has a value. A field is flagged as a
DEFECT this cycle when:
  • it is exactly 0% with a non-empty sample ("blank" — the class that hid
    for months; always alerts, no floor lookup needed), or
  • it is below its hand-tuned absolute floor (`_FIELD_SPECS[field]["floor"]`
    — these encode "how sparse is this field allowed to legitimately be",
    e.g. analyst_actions floors at 50% because most tickers have no recent
    rating action, vs. ticker_name at 95%), or
  • it DROPPED sharply against its own recent history (a persisted SQLite
    median baseline) even while still nominally above its floor — the
    "95% -> 10%" signal is the alarm; a field that sits at a steady 40%
    forever is not, and floors alone can't tell those apart without history.

── Cost / safety bounds (read before adding a field) ─────────────────────────
  • Runs on a background daemon thread only — NEVER the request path.
  • Fields backed by a TTL cache (`earnings_intel_*`, `tmeta_*`) are measured
    by calling the SAME cached function the request path uses — a warm hit
    costs nothing, matching fundamentals_monitor's philosophy.
  • `analyst_actions` (`finnhub_recent_action`) has NO cache at all, so its
    check is bounded to a small fixed subsample
    (`_ANALYST_ACTIONS_SUBSAMPLE`), never the full `_SAMPLE`.
  • `transcript` coverage is measured WARM-ONLY (a bare `cache.get` peek,
    zero network/LLM cost) — forcing a cold transcript generation purely to
    monitor it would spend real Claude-summarization budget on every cycle
    for no user benefit. A cold cycle with nothing yet viewed reports
    `sample=0` (honest "not measured"), not a fabricated rate.
  • `calendar_hour_resolved` / `enrichment_with_em` read ALREADY-COMPUTED,
    cached state (`_days_for_date`, `calendar_enrichment_status()`) — this
    module never triggers a fresh calendar build.
  • `implied_fiscal_year` is a read-only SQLite query against
    `implied_snapshots` — no network at all.
  • `market_cap` / `avg_vol` call `calendar.get_day_metrics` for ONE recent
    past date (its own 24h cache for past dates bounds this to at most one
    Finviz/Massive call per day, not per cycle).
  • Any Finnhub-touching call in this module goes through code that already
    routes through `api.services.finnhub_client`'s shared token bucket
    (`get_earnings_intel`, `finnhub_recent_action`, `_base_meta`) — this
    module makes no raw Finnhub calls of its own.

── Self-heal ──────────────────────────────────────────────────────────────────
Mirrors fundamentals_monitor exactly: cache INVALIDATION only, never a
forced re-fetch. When a cache-backed field is in defect, the specific
tickers found missing that field this cycle have their cache entry
invalidated (`earnings_intel_{SYM}`, `tmeta_{SYM}`, `transcript_summary_{SYM}`
— all exact-key invalidates, never a prefix sweep) so the NEXT natural view
(or the next monitor cycle) reads fresh instead of repeating the same stale
value. Fields with no single owning cache key (calendar/implied/day-metrics
aggregates) have nothing sensible to invalidate and are left alone — heal=None.

── Alerting ────────────────────────────────────────────────────────────────────
Alert-on-CHANGE only (newly-breached fields), Discord + in-app, identical
routing to fundamentals_monitor. See `api/routers/provider_coverage.py` for
the status endpoint and Task 23 for the alert-routing rules (owner channel
ONLY — never the public TSDR webhook).

Gated by `PROVIDER_COVERAGE_MONITOR_ENABLED=1` (default OFF).
"""
from __future__ import annotations

import logging
import os
import random
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# ── Config (env-tunable) ──────────────────────────────────────────────────────
_CYCLE_SECONDS = int(os.environ.get("PROVIDER_COVERAGE_MONITOR_CYCLE_SECONDS", "3600"))  # 1h
_SAMPLE = int(os.environ.get("PROVIDER_COVERAGE_MONITOR_SAMPLE", "25"))
_COLD_TAIL = int(os.environ.get("PROVIDER_COVERAGE_MONITOR_COLD_TAIL", "6"))
# Offset past fundamentals_monitor's 180s startup delay so the two monitors'
# first cycles don't contend for the same warm-cache write locks at boot.
_STARTUP_DELAY = int(os.environ.get("PROVIDER_COVERAGE_MONITOR_STARTUP_DELAY", "240"))

# finnhub_recent_action has no cache at all — bound its per-cycle cost hard,
# independent of _SAMPLE.
_ANALYST_ACTIONS_SUBSAMPLE = int(os.environ.get("PROVIDER_COVERAGE_ANALYST_SUBSAMPLE", "8"))

# Drop-detection thresholds: a field must fall AT LEAST this many percentage
# points below its own recent median baseline, AND land at or below half that
# baseline, to count as a "drop" defect (independent of the absolute floor).
# Both conditions together are what makes 95%->10% fire while 40%->35% does
# not (see module docstring).
_DROP_ABS_PP = 0.30
_DROP_REL_FACTOR = 0.5
_BASELINE_WINDOW = 20        # trailing non-null readings used for the median
_HISTORY_RETENTION_DAYS = 30

# Always-audited liquid names — a degradation on these is impossible to miss.
_PRIORITY = (
    "AAPL", "NVDA", "MSFT", "AMZN", "META", "GOOGL", "AVGO", "TSLA", "JPM", "WMT",
    "NKE", "MU", "AMD", "ORCL", "NFLX", "COST", "HD", "UNH", "XOM", "PG",
)

_DATA_DIR = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(os.getcwd(), "data"))
DB_PATH = os.environ.get("PROVIDER_COVERAGE_DB", os.path.join(_DATA_DIR, "provider_coverage.db"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS coverage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field TEXT NOT NULL,
  observed REAL,
  sample INTEGER NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coverage_history_field_ts ON coverage_history(field, ts);
-- The alert-on-CHANGE baseline. Durable because `_state` is a module dict and
-- this pod redeploys several times a day: an in-memory set makes every boot
-- rediscover a standing defect as "newly breached" (2026-08-09 — one unchanged
-- pair of defects announced three times in twenty minutes).
CREATE TABLE IF NOT EXISTS defect_state (
  field TEXT PRIMARY KEY,
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
    "last_cycle_at": None,
    "fields": {},                # field -> {observed, sample, floor}
    "defects_current": [],       # defects still standing after the last cycle
    "_prev_defect_fields": [],   # for alert-on-change (don't re-spam a persistent defect)
    "last_alert_at": None,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Field registry ─────────────────────────────────────────────────────────────
def _heal_intel(missing_syms: list[str]) -> None:
    from api.services.cache import cache
    for s in missing_syms:
        cache.invalidate(f"earnings_intel_{s}")


def _heal_meta(missing_syms: list[str]) -> None:
    from api.services.cache import cache
    for s in missing_syms:
        cache.invalidate(f"tmeta_{s}")


def _heal_transcript(missing_syms: list[str]) -> None:
    from api.services.cache import cache
    for s in missing_syms:
        cache.invalidate(f"transcript_summary_{s}")


# floor: hand-tuned absolute fill-rate floor per field (None = rely on the
# blank + drop detectors alone — used for enrichment_with_em, whose actual
# contract per calendar.py's own docstring is "with_em must be > 0 when
# total > 0", which the blank detector already enforces exactly).
# finnhub_touching: whether a defect on this field COULD be explained by the
# shared Finnhub token bucket shedding calls this cycle (used to tag
# provider_throttled vs data_missing).
# heal: bounded cache-invalidation self-heal, or None if there is no single
# owning cache key to invalidate.
_FIELD_SPECS: dict[str, dict] = {
    "price_target":          {"floor": 0.80, "finnhub_touching": True,  "heal": _heal_intel},
    "consensus":             {"floor": 0.80, "finnhub_touching": True,  "heal": _heal_intel},
    "beat_history":          {"floor": 0.85, "finnhub_touching": True,  "heal": _heal_intel},
    "transcript":            {"floor": 0.70, "finnhub_touching": False, "heal": _heal_transcript},
    # 0.80, not the old 0.50: this now measures whether the grades PROVIDERS
    # answer for a sample led by megacaps, which is a near-1.0 proposition when
    # healthy. The 0.50 was tuned for a recency reading ("most tickers have no
    # recent rating action") that this field no longer takes — see
    # _analyst_actions_rate.
    "analyst_actions":       {"floor": 0.80, "finnhub_touching": True,  "heal": None},
    "ticker_name":           {"floor": 0.95, "finnhub_touching": True,  "heal": _heal_meta},
    "ticker_industry":       {"floor": 0.90, "finnhub_touching": True,  "heal": _heal_meta},
    "calendar_hour_resolved": {"floor": 0.60, "finnhub_touching": True,  "heal": None},
    "enrichment_with_em":    {"floor": None, "finnhub_touching": True,  "heal": None},
    "implied_fiscal_year":   {"floor": 0.90, "finnhub_touching": False, "heal": None},
    "market_cap":            {"floor": 0.70, "finnhub_touching": False, "heal": None},
    "avg_vol":               {"floor": 0.70, "finnhub_touching": False, "heal": None},
}


# ── History store (SQLite, for drop-vs-absolute detection) ─────────────────────
def _connect_history() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.executescript(_SCHEMA)
    return conn


def _record_history(field: str, observed: float | None, sample: int, ts: str) -> None:
    try:
        with _connect_history() as conn:
            conn.execute(
                "INSERT INTO coverage_history (field, observed, sample, ts) VALUES (?, ?, ?, ?)",
                (field, observed, sample, ts),
            )
    except Exception:  # pragma: no cover - history is best-effort, never fatal
        _logger.warning("[coverage-monitor] history write failed for %s", field, exc_info=True)


def _recent_baseline(field: str, k: int | None = None) -> float | None:
    """Median of the last `k` NON-NULL observed readings for `field`,
    excluding this cycle's own (not-yet-recorded) row. Median rather than
    mean so one anomalous cycle can't drag the baseline down and mask the
    very drop it should be catching."""
    k = k or _BASELINE_WINDOW
    try:
        with _connect_history() as conn:
            rows = conn.execute(
                "SELECT observed FROM coverage_history WHERE field = ? AND observed IS NOT NULL "
                "ORDER BY ts DESC LIMIT ?",
                (field, k),
            ).fetchall()
    except Exception:  # pragma: no cover
        return None
    vals = sorted(r[0] for r in rows if r[0] is not None)
    if not vals:
        return None
    mid = len(vals) // 2
    if len(vals) % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


def _load_prev_defect_fields() -> set[str]:
    """The set of fields that were already in defect as of the last cycle —
    from disk, so a redeploy doesn't turn a standing defect back into news."""
    try:
        with _connect_history() as conn:
            rows = conn.execute("SELECT field FROM defect_state").fetchall()
        return {r[0] for r in rows}
    except Exception:  # pragma: no cover - fall back to the in-memory copy
        _logger.warning("[coverage-monitor] defect_state read failed", exc_info=True)
        return set(_state.get("_prev_defect_fields") or [])


def _save_prev_defect_fields(fields: set[str], ts: str) -> None:
    """Replace the persisted set. A field that recovered must LEAVE it, or its
    next genuine breach is silent — the worse of the two failure directions."""
    keep = sorted(fields)
    try:
        with _connect_history() as conn:
            if keep:
                placeholders = ",".join("?" * len(keep))
                conn.execute(
                    f"DELETE FROM defect_state WHERE field NOT IN ({placeholders})",
                    tuple(keep),
                )
            else:
                conn.execute("DELETE FROM defect_state")
            for f in keep:
                # DO NOTHING, not REPLACE: `since` should stay the moment the
                # breach STARTED, so it can date a long-standing defect.
                conn.execute(
                    "INSERT INTO defect_state (field, since) VALUES (?, ?) "
                    "ON CONFLICT(field) DO NOTHING",
                    (f, ts),
                )
    except Exception:  # pragma: no cover
        _logger.warning("[coverage-monitor] defect_state write failed", exc_info=True)


def _prune_history() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=_HISTORY_RETENTION_DAYS)).isoformat()
    try:
        with _connect_history() as conn:
            conn.execute("DELETE FROM coverage_history WHERE ts < ?", (cutoff,))
    except Exception:  # pragma: no cover
        pass


# ── Defect classification (pure — the primary unit-test surface) ──────────────
def _evaluate_field(field: str, observed: float | None, sample: int,
                     baseline: float | None, provider_moved: bool) -> dict | None:
    """Decide whether `field`'s reading this cycle is a defect.

    `observed`/`sample` of (None, 0) means "not measured" — NEVER treated as
    a 0% reading (`Number(null) === 0` class). Returns a defect record or
    None. `provider_moved` is already resolved by the caller to "did the
    Finnhub token bucket shed calls during this cycle AND is this field
    Finnhub-touching" — kept a plain bool here so this function stays pure
    and trivially unit-testable.
    """
    if observed is None or sample <= 0:
        return None
    spec = _FIELD_SPECS[field]

    kind = None
    if observed == 0.0:
        kind = "blank"
    elif spec["floor"] is not None and observed < spec["floor"]:
        kind = "floor_breach"
    elif (baseline is not None
          and (baseline - observed) >= _DROP_ABS_PP
          and observed <= baseline * _DROP_REL_FACTOR):
        kind = "drop"

    if kind is None:
        return None

    provider = "provider_throttled" if provider_moved else "data_missing"
    return {
        "field": field,
        "observed": round(observed, 4),
        "floor": spec["floor"],
        "sample": sample,
        "provider": provider,
        "kind": kind,
    }


# ── Provider-attribution (Finnhub token-bucket denial snapshot) ────────────────
def _denial_snapshot() -> dict:
    snap: dict = {}
    try:
        from api.services.finnhub_client import fh_budget_denied_total
        snap["finnhub"] = fh_budget_denied_total()
    except Exception:  # pragma: no cover
        snap["finnhub"] = None
    # AlphaVantage's shared client (Task 15, `alphavantage_client.py`) may not
    # exist yet in every worktree — best-effort, never fatal.
    try:
        from api.services import alphavantage_client
        snap["alphavantage"] = alphavantage_client.av_budget_denied_total()
    except Exception:
        snap["alphavantage"] = None
    return snap


def _denial_moved(before: dict, after: dict) -> set[str]:
    moved = set()
    for k, v in after.items():
        b = before.get(k)
        if b is not None and v is not None and v > b:
            moved.add(k)
    return moved


# ── Sampling (same three-tier idiom as fundamentals_monitor) ──────────────────
def _load_universe() -> list[str]:
    try:
        import json
        cap_path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
        if os.path.exists(cap_path):
            with open(cap_path) as f:
                u = json.load(f)
            if isinstance(u, dict):
                u = u.get("tickers") or []
            return list(u) if isinstance(u, list) else []
    except Exception:  # pragma: no cover
        _logger.warning("[coverage-monitor] cap_universe load failed", exc_info=True)
    return []


def _sample_tickers(n: int) -> list[str]:
    """Priority liquid names + WARM (`earnings_intel_*`, already-cached)
    tickers + a small bounded COLD long-tail. See fundamentals_monitor's
    `_sample_tickers` docstring for the full rationale — this is the same
    idiom, warm-sourced from a different cache family."""
    out = [s.upper() for s in _PRIORITY[:min(len(_PRIORITY), max(1, n // 2))]]
    have = set(out)

    try:
        from api.services.cache import cache
        warm = []
        prefix = "earnings_intel_"
        for k in cache.keys_with_prefix(prefix):
            t = k[len(prefix):].upper()
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

    pool = [s.upper() for s in _load_universe() if s and s.upper() not in have]
    if pool:
        k = min(_COLD_TAIL, max(0, n - len(out)), len(pool))
        out += random.sample(pool, k)
    return out[:n]


# ── Per-field measurement ──────────────────────────────────────────────────────
def _intel_map(syms: list[str]) -> dict[str, dict | None]:
    """One `get_earnings_intel` call per ticker (cached 6h success / short
    fail TTL — a warm hit is free). Shared across price_target/consensus/
    beat_history so those three fields cost ONE fetch per ticker, not three."""
    from api.services.earnings_estimates import get_earnings_intel
    out: dict[str, dict | None] = {}
    for s in syms:
        try:
            out[s] = get_earnings_intel(s)
        except Exception:
            out[s] = None
    return out


def _meta_map(syms: list[str]) -> dict[str, dict]:
    from api.services.ticker_meta import _base_meta
    out: dict[str, dict] = {}
    for s in syms:
        try:
            out[s] = _base_meta(s) or {}
        except Exception:
            out[s] = {}
    return out


def _rate_from_map(m: dict[str, object], predicate) -> dict:
    n = 0
    hits = 0
    missing: list[str] = []
    for sym, val in m.items():
        n += 1
        try:
            ok = bool(predicate(val))
        except Exception:
            ok = False
        if ok:
            hits += 1
        else:
            missing.append(sym)
    observed = (hits / n) if n > 0 else None
    return {"observed": observed, "sample": n, "missing": missing}


def _transcript_rate(syms: list[str]) -> dict:
    """WARM-ONLY peek — never forces a cold (LLM-costing) transcript
    generation just to measure coverage. See module docstring."""
    from api.services.cache import cache
    n = 0
    hits = 0
    missing: list[str] = []
    for s in syms:
        val = cache.get(f"transcript_summary_{s}")
        if val is None:
            continue  # never generated this session — excluded, not a miss
        n += 1
        if isinstance(val, dict) and val.get("available"):
            hits += 1
        else:
            missing.append(s)
    observed = (hits / n) if n > 0 else None
    return {"observed": observed, "sample": n, "missing": missing}


def _analyst_actions_rate(syms: list[str]) -> dict:
    """Can the analyst-grades providers ANSWER? — bounded subsample (this path
    has no cache of its own).

    Measures reachability via `analyst_grades_available`, NOT recency via
    `finnhub_recent_action`. "Was this megacap re-rated in the last ~2 calendar
    days" is a fact about the tape, not about our data: it is legitimately 0/8
    on a weekend, so a 50% floor over it could never report green and alerted
    every Sunday night. See that function's docstring for the live evidence.
    """
    from api.services.catalyst.analyst_actions import analyst_grades_available
    sub = syms[:_ANALYST_ACTIONS_SUBSAMPLE]
    n = 0
    hits = 0
    missing: list[str] = []
    for s in sub:
        n += 1
        try:
            ok = bool(analyst_grades_available(s))
        except Exception:
            ok = False
        if ok:
            hits += 1
        else:
            missing.append(s)
    observed = (hits / n) if n > 0 else None
    return {"observed": observed, "sample": n, "missing": missing}


def _calendar_hour_rate(today: object = None, lookback_days: int = 5) -> dict:
    """bmo/amc (resolved) vs tbd (unresolved) session fraction over the most
    recent finished weekdays. Reads `_days_for_date` only — a pure cache
    lookup (cold cache -> None), never triggers a calendar build."""
    from api.routers.calendar import _days_for_date
    if today is None:
        today = datetime.now(_ET).date()
    resolved = tbd = 0
    checked = 0
    d = today - timedelta(days=1)
    scanned = 0
    while checked < lookback_days and scanned < 14:
        scanned += 1
        if d.weekday() < 5:
            try:
                day = _days_for_date(d.isoformat())
            except Exception:
                day = None
            if day:
                resolved += len(day.get("bmo") or []) + len(day.get("amc") or [])
                tbd += len(day.get("tbd") or [])
                checked += 1
        d -= timedelta(days=1)
    total = resolved + tbd
    observed = (resolved / total) if total > 0 else None
    return {"observed": observed, "sample": total}


def _enrichment_with_em_rate() -> dict:
    """Reads the already-published `_ENRICH_STATS` telemetry (via the public
    `calendar_enrichment_status`) for the most recent date with `total > 0` —
    never triggers a fresh enrichment build."""
    from api.routers.calendar import calendar_enrichment_status
    try:
        status = calendar_enrichment_status() or {}
    except Exception:
        return {"observed": None, "sample": 0}
    dates = status.get("dates") or {}
    for ds in sorted(dates, reverse=True):
        d = dates[ds] or {}
        total = int(d.get("total") or 0)
        if total > 0:
            with_em = int(d.get("with_em") or 0)
            return {"observed": with_em / total, "sample": total}
    return {"observed": None, "sample": 0}


def _implied_fiscal_rate(window_days: int = 21) -> dict:
    """Read-only query against `implied_snapshots` (Task 4's fiscal-identity
    fix) — no network. `sample=0` (not 0.0) whenever the store is empty,
    e.g. the documented ZERO-MIGRATION WINDOW before IMPLIED_STORE_ENABLED=1
    ships."""
    try:
        from api.services import implied_store
        cutoff = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()
        conn = sqlite3.connect(implied_store.DB_PATH, timeout=5)
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS total, "
                "SUM(CASE WHEN fiscal_year IS NOT NULL AND fiscal_quarter IS NOT NULL "
                "THEN 1 ELSE 0 END) AS with_fiscal "
                "FROM implied_snapshots WHERE captured_at >= ?",
                (cutoff,),
            ).fetchone()
        finally:
            conn.close()
        total = int(row[0] or 0)
        with_fiscal = int(row[1] or 0)
        observed = (with_fiscal / total) if total > 0 else None
        return {"observed": observed, "sample": total}
    except Exception:
        return {"observed": None, "sample": 0}


def _day_metrics_rate(field: str, today: object = None, tries: int = 5) -> dict:
    """`market_cap` (`mc_b`) / `avg_vol` fill rate over the most recent
    finished weekday's `/api/calendar/day-metrics` payload — reuses that
    endpoint's own 24h-for-past-dates cache, so this costs at most one
    Finviz/Massive call per calendar day, not per monitor cycle."""
    from api.routers.calendar import get_day_metrics
    if today is None:
        today = datetime.now(_ET).date()
    d = today - timedelta(days=1)
    for _ in range(tries):
        if d.weekday() < 5:
            try:
                m = get_day_metrics(d.isoformat())
            except Exception:
                m = None
            if m:
                total = len(m)
                hits = sum(1 for v in m.values() if isinstance(v, dict) and v.get(field) is not None)
                return {"observed": (hits / total) if total > 0 else None, "sample": total}
        d -= timedelta(days=1)
    return {"observed": None, "sample": 0}


# ── Alerting ──────────────────────────────────────────────────────────────────
def _alert(defects: list[dict]) -> None:
    """Fire an in-app admin alert (throttled) + a Discord webhook for a
    newly-breached coverage field. Best-effort — mirrors
    fundamentals_monitor._alert exactly, including the OWNER-channel-only
    routing (never DISCORD_TSDR_WEBHOOK_URL, which is the public,
    allowlist-gated community channel)."""
    summary = ", ".join(f"{d['field']}={d['observed']:.0%}(floor {d['floor']:.0%}, {d['kind']})"
                        if d.get("floor") is not None
                        else f"{d['field']}={d['observed']:.0%}({d['kind']})"
                        for d in defects[:15])

    try:
        from api.services import chart_health_alerts
        chart_health_alerts.emit(
            "provider_coverage_regression", "critical",
            f"Provider coverage monitor: {len(defects)} field(s) newly breached — {summary}",
            {"defects": defects[:15]},
        )
    except Exception:  # pragma: no cover
        pass

    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "🔴 Provider coverage regression",
            "description": (f"**{len(defects)}** field(s) newly breached this cycle.\n"
                            f"**Details:** {summary}"),
            "color": 0xE23B3B,
            "timestamp": _now_iso(),
        })
    except Exception:  # pragma: no cover
        pass

    with _state_lock:
        _state["last_alert_at"] = _now_iso()


# ── Cycle ─────────────────────────────────────────────────────────────────────
def run_cycle(now=None) -> dict:
    """Sample, measure every field, classify defects, self-heal cache-backed
    ones, persist history, and alert on newly-breached fields."""
    syms = _sample_tickers(_SAMPLE)

    denied_before = _denial_snapshot()

    intel = _intel_map(syms)
    meta = _meta_map(syms)

    results: dict[str, dict] = {
        "price_target":           _rate_from_map(intel, lambda v: bool(v and v.get("price_target"))),
        "consensus":              _rate_from_map(intel, lambda v: bool(v and v.get("consensus"))),
        "beat_history":           _rate_from_map(intel, lambda v: bool(v and len(v.get("beat_history") or []) >= 4)),
        "ticker_name":            _rate_from_map(meta, lambda v: bool((v or {}).get("name"))),
        "ticker_industry":        _rate_from_map(meta, lambda v: bool((v or {}).get("industry"))),
        "transcript":             _transcript_rate(syms),
        "analyst_actions":        _analyst_actions_rate(syms),
        "calendar_hour_resolved": _calendar_hour_rate(),
        "enrichment_with_em":     _enrichment_with_em_rate(),
        "implied_fiscal_year":    _implied_fiscal_rate(),
        "market_cap":             _day_metrics_rate("mc_b"),
        "avg_vol":                _day_metrics_rate("avg_vol"),
    }

    denied_after = _denial_snapshot()
    moved = _denial_moved(denied_before, denied_after)

    ts = _now_iso()
    defects: list[dict] = []
    fields_state: dict[str, dict] = {}
    for field in _FIELD_SPECS:
        r = results[field]
        observed, sample = r["observed"], r["sample"]
        spec = _FIELD_SPECS[field]
        baseline = _recent_baseline(field)
        provider_moved = bool(spec["finnhub_touching"] and "finnhub" in moved)

        defect = _evaluate_field(field, observed, sample, baseline, provider_moved)
        _record_history(field, observed, sample, ts)  # AFTER baseline lookup
        fields_state[field] = {"observed": observed, "sample": sample, "floor": spec["floor"]}

        if defect:
            defects.append(defect)
            heal = spec.get("heal")
            missing = r.get("missing") or []
            if heal and missing:
                try:
                    heal(missing)
                except Exception:  # pragma: no cover
                    _logger.warning("[coverage-monitor] heal failed for %s", field, exc_info=True)

    cur_fields = {d["field"] for d in defects}
    prev_fields = _load_prev_defect_fields()   # from DISK — survives a redeploy
    newly = [d for d in defects if d["field"] not in prev_fields]
    _save_prev_defect_fields(cur_fields, ts)

    with _state_lock:
        _state["cycles_completed"] += 1
        _state["last_cycle_at"] = ts
        _state["fields"] = fields_state
        _state["defects_current"] = defects
        _state["_prev_defect_fields"] = sorted(cur_fields)

    _prune_history()

    if newly:
        _alert(newly)

    _logger.info("[coverage-monitor] cycle: %d fields, %d defects, %d newly-alerted",
                 len(results), len(defects), len(newly))
    return {"checked_fields": len(results), "defects": len(defects), "newly_alerted": len(newly)}


def _run_forever() -> None:
    enabled = os.environ.get("PROVIDER_COVERAGE_MONITOR_ENABLED", "0") == "1"
    with _state_lock:
        _state["enabled"] = enabled
    if not enabled:
        _logger.info("[coverage-monitor] disabled (PROVIDER_COVERAGE_MONITOR_ENABLED=0)")
        return

    with _state_lock:
        _state["running"] = True
        _state["started_at"] = _now_iso()
    _logger.info("[coverage-monitor] started — cycle every %ds, %d tickers/cycle",
                 _CYCLE_SECONDS, _SAMPLE)

    time.sleep(_STARTUP_DELAY)
    while True:
        try:
            run_cycle()
        except Exception:  # pragma: no cover - one bad cycle must not kill the daemon
            _logger.exception("[coverage-monitor] cycle crashed (caught — looping)")
        slept = 0
        while slept < _CYCLE_SECONDS:
            time.sleep(10)
            slept += 10


def start() -> None:
    """Spawn the daemon thread. Idempotent."""
    if getattr(start, "_started", False):
        return
    start._started = True
    threading.Thread(target=_run_forever, daemon=True, name="provider-coverage-monitor").start()


def get_state() -> dict:
    """Public, JSON-safe state — filters `_`-prefixed internal bookkeeping
    keys (fundamentals_monitor.get_state() does NOT do this and leaks
    `_prev_flagged_syms`; do not repeat that here)."""
    with _state_lock:
        return {k: v for k, v in _state.items() if not k.startswith("_")}
