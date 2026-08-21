"""Analyst pass — Wave 2's one per-ticker network job.

Two halves, one file (Task 6 = store + client, Task 7 = the cadenced job):

  * STORE  — SQLite at ``SCREENER_ANALYST_DB_PATH`` (default
    ``/data/screener_analyst.db``), table ``analyst_rows`` (one row per
    ticker, upserted) + ``analyst_runs`` (the receipt table, one row per
    ``run_pass`` call). ``contextlib.closing`` on every connection (the
    ssetf lesson — a connection left to the garbage collector can hold a WAL
    sidecar open on Windows).
  * CLIENT — ``fetch_one(ticker)``, four independent ``earnings_estimates
    ._fmp_get`` legs. This is the SCREENER's LEAN NIGHTLY client — a
    different consumer from ``analyst_grades.get_analyst_grades`` (the
    request-path composition behind the research page), reading the SAME
    provider for DIFFERENT columns with no overlap. A leg that raises nulls
    only its own slice; ``fetch_one`` returns ``None`` only when every leg
    came back empty.
  * JOB — ``run_pass(now=None)``: targets = actives (member watchlists ∪
    UCT20 ∪ scanner candidates ∪ top-500 by dollar_vol_30d, intersected with
    the cap universe) ∪ one-seventh of the remaining universe (the "tail"),
    rotated so the whole tail is covered once a week. Order within the run
    is stalest-first. A fixed 04:45 ET wall-clock deadline, checked BETWEEN
    tickers (the scan sweep's ``run_sweep`` idiom — never mid-fetch), stops
    the run from STARTING another ticker; everything not yet started is
    counted as ``budget_stop``, never silently dropped.

⛔ SEAM NOTE (reported per the binding ruling): the plan's brief assumed the
forward-estimates leg's per-year field was ``estimatedEpsAvg``. The real FMP
field, verified against ``annual_financials._forward_estimates_fmp`` (which
already calls this same endpoint), is ``epsAvg`` — that is what this module
reads.
"""
from __future__ import annotations

import contextlib
import datetime
import logging
import math
import os
import re
import sqlite3
import time

from api.services import earnings_estimates as ee

log = logging.getLogger(__name__)

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _ET = datetime.timezone.utc

# 8 days — a row older than this is treated as not-computable rather than
# served stale into the nightly snapshot build.
_FRESHNESS_SECONDS = 8 * 86400


def _note(failures, source, outcome) -> None:
    """Count a miss under ``{source: {outcome: count}}`` — the shape every
    Wave-2 reader already reports (``context_joins._note`` /
    ``fundamentals_bulk._note``); this module owns its own copy rather than
    reaching into a sibling's private helper."""
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


# ─────────────────────────────────────────────────────────────────────────
# The ONE clock this module reads. Monkeypatch this, never
# ``datetime.datetime.now`` inline, in tests — a half-frozen clock (one
# source patched, another left live) manufactures false positives/negatives
# (lesson_a_half_faked_clock_manufactures_false_positives). ``run_pass``
# additionally accepts an explicit ``now`` for the run's anchor (day index +
# deadline date); the between-ticker deadline CHECK still reads this
# function each iteration, exactly like ``scan_evaluator.run_sweep``.
# ─────────────────────────────────────────────────────────────────────────
def _now_et() -> datetime.datetime:
    return datetime.datetime.now(_ET)


def _deadline_et(day_anchor: datetime.datetime) -> datetime.datetime:
    """04:45 ET on ``day_anchor``'s calendar date — the wall-clock stop past
    which ``run_pass`` will not START another ticker.

    FIXED, not derived from market open like ``scan_evaluator.sweep_deadline``
    — this pass has no session dependency, it just needs to be well clear of
    the 05:00 ET scan sweep and the builder's own nightly window. Accepts a
    naive datetime (assumed already ET) or any tz-aware one (converted).
    """
    if day_anchor.tzinfo is None:
        day_anchor = day_anchor.replace(tzinfo=_ET)
    else:
        day_anchor = day_anchor.astimezone(_ET)
    return day_anchor.replace(hour=4, minute=45, second=0, microsecond=0)


# ─────────────────────────────────────────────────────────────────────────
# STORE (Task 6)
# ─────────────────────────────────────────────────────────────────────────
_SCHEMA = """
CREATE TABLE IF NOT EXISTS analyst_rows (
  ticker             TEXT PRIMARY KEY,
  consensus          TEXT,
  pt_target          REAL,
  upgrades_30d       INTEGER,
  downgrades_30d     INTEGER,
  eps_next_y_growth  REAL,
  fetched_at         INTEGER
);
CREATE TABLE IF NOT EXISTS analyst_runs (
  started_at    INTEGER,
  finished_at   INTEGER,
  actives       INTEGER,
  tail_slice    INTEGER,
  fetched       INTEGER,
  errors        INTEGER,
  budget_stop   INTEGER
);
"""


def get_db_path() -> str:
    p = os.environ.get("SCREENER_ANALYST_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/screener_analyst.db"
    os.makedirs("./data", exist_ok=True)
    return "./data/screener_analyst.db"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db() -> None:
    with contextlib.closing(connect()) as conn:
        conn.executescript(_SCHEMA)
        conn.commit()


def upsert(ticker: str, row: dict, now: float) -> None:
    """Write one ticker's fetched slice. ``row`` keys are the store's OWN
    column names (``consensus``, not ``analyst_consensus`` — see
    ``read_analyst_fields`` for the rename at the snapshot boundary)."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return
    with contextlib.closing(connect()) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO analyst_rows "
            "(ticker, consensus, pt_target, upgrades_30d, downgrades_30d, "
            " eps_next_y_growth, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ticker, row.get("consensus"), row.get("pt_target"),
             row.get("upgrades_30d"), row.get("downgrades_30d"),
             row.get("eps_next_y_growth"), int(now)))
        conn.commit()


def stalest(tickers, n: int | None = None) -> list:
    """Order ``tickers`` by ascending ``fetched_at`` (never-fetched first —
    the ``snapshot_builder._stalest`` idiom), capped to ``n``. A table that
    does not exist yet (fresh DB) degrades to "everyone is never-fetched"
    rather than raising."""
    tickers = [str(t).upper() for t in (tickers or []) if t]
    if not tickers:
        return []
    try:
        with contextlib.closing(connect()) as conn:
            fetched = {r["ticker"]: r["fetched_at"] for r in
                       conn.execute("SELECT ticker, fetched_at FROM analyst_rows")}
    except Exception:
        fetched = {}
    ordered = sorted(
        tickers,
        key=lambda t: (fetched.get(t) is not None, fetched.get(t) or 0))
    return ordered[:n] if n else ordered


def read_analyst_fields(targets, failures=None) -> dict:
    """``{TICKER: {five snapshot columns}}`` for rows fetched within the
    last 8 days. A stale or never-fetched ticker is simply ABSENT from the
    result (never a confident-but-wrong value) — ``build_row``'s merge loop
    already treats a missing key as not-computable.

    ⭐ The one rename in this module: the store's ``consensus`` column
    becomes the snapshot's ``analyst_consensus`` here, at the read boundary
    — the store owns its own column name, the snapshot owns its.
    ``pt_upside_pct`` is NOT emitted; that derivation belongs to the
    builder (Task 10), which has the price this needs.
    """
    targets = [str(t).upper() for t in (targets or []) if t]
    if not targets:
        return {}
    cutoff = time.time() - _FRESHNESS_SECONDS
    try:
        rows: dict = {}
        with contextlib.closing(connect()) as conn:
            for i in range(0, len(targets), 900):
                chunk = targets[i:i + 900]
                ph = ", ".join("?" for _ in chunk)
                for r in conn.execute(
                        f"SELECT * FROM analyst_rows WHERE ticker IN ({ph})", chunk):
                    rows[r["ticker"]] = dict(r)
    except Exception as e:
        _note(failures, "analyst_pass", e)
        return {}
    out = {}
    for t in targets:
        r = rows.get(t)
        if not r or r.get("fetched_at") is None or r["fetched_at"] < cutoff:
            continue
        out[t] = {
            "analyst_consensus": r.get("consensus"),
            "pt_target": r.get("pt_target"),
            "upgrades_30d": r.get("upgrades_30d"),
            "downgrades_30d": r.get("downgrades_30d"),
            "eps_next_y_growth": r.get("eps_next_y_growth"),
        }
    return out


# ─────────────────────────────────────────────────────────────────────────
# CLIENT (Task 6) — four independent legs over earnings_estimates._fmp_get
# ─────────────────────────────────────────────────────────────────────────
def _num(v):
    """A finite float, or None. NaN/inf/junk all become None."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _first(data):
    return data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None


def _fetch_consensus_label(ticker: str):
    """``/stable/grades-consensus`` → the ``consensus`` label, or None when
    the bucket total is 0 (mirrors ``analyst_grades._consensus``'s zero-total
    refusal — an uncorroborated label with nobody behind it is not a real
    consensus)."""
    row = _first(ee._fmp_get("/stable/grades-consensus", {"symbol": ticker}, timeout=4))
    if not row:
        return None
    buckets = ("strongBuy", "buy", "hold", "sell", "strongSell")
    total = sum(int(row.get(k) or 0) for k in buckets)
    if total == 0:
        return None
    return row.get("consensus") or None


def _fetch_pt_target(ticker: str):
    """``/stable/price-target-consensus`` → ``targetConsensus``, falling
    back to ``targetMedian``. None when both are null."""
    row = _first(ee._fmp_get("/stable/price-target-consensus", {"symbol": ticker}, timeout=4))
    if not row:
        return None
    val = _num(row.get("targetConsensus"))
    if val is None:
        val = _num(row.get("targetMedian"))
    return val


def _fetch_grade_actions_30d(ticker: str):
    """``/stable/grades?limit=40`` → (upgrades, downgrades) among rows whose
    ``action`` is upgrade/downgrade and whose ``date`` is within 30 days of
    today (inclusive: ``date >= today - 30d``). ``(0, 0)`` is a REAL answer
    when the leg returned rows; ``(None, None)`` only when the leg itself
    failed (not a list)."""
    data = ee._fmp_get("/stable/grades", {"symbol": ticker, "limit": 40}, timeout=4)
    if not isinstance(data, list):
        return None, None
    cutoff = _now_et().date() - datetime.timedelta(days=30)
    upgrades = downgrades = 0
    for row in data:
        if not isinstance(row, dict):
            continue
        action = (row.get("action") or "").lower()
        if action not in ("upgrade", "downgrade"):
            continue
        ds = str(row.get("date") or "")[:10]
        try:
            d = datetime.date.fromisoformat(ds)
        except ValueError:
            continue
        if d < cutoff:
            continue
        if action == "upgrade":
            upgrades += 1
        else:
            downgrades += 1
    return upgrades, downgrades


def _fetch_eps_growth(ticker: str):
    """``/stable/analyst-estimates?period=annual&limit=4`` → (next-FY
    ``epsAvg`` / current-FY ``epsAvg`` − 1) × 100, None when either fiscal
    year is missing or the current-FY base is ≤ 0 (a negative-base growth
    number is meaningless — the same refusal ``earnings_growth_fmp``
    documents elsewhere in this codebase).

    ⛔ FIELD NAME: the plan's brief assumed ``estimatedEpsAvg``. The real FMP
    field — verified against ``annual_financials._forward_estimates_fmp``,
    which already calls this endpoint — is ``epsAvg``. Read from there.
    """
    data = ee._fmp_get("/stable/analyst-estimates",
                        {"symbol": ticker, "period": "annual", "limit": 4}, timeout=4)
    if not isinstance(data, list):
        return None
    by_fy: dict = {}
    for row in data:
        if not isinstance(row, dict):
            continue
        m = re.match(r"(\d{4})-\d{2}-\d{2}", str(row.get("date") or "")[:10])
        if not m:
            continue
        fy = int(m.group(1))
        eps = _num(row.get("epsAvg"))
        if eps is None:
            continue
        by_fy.setdefault(fy, eps)
    years = sorted(by_fy)
    if len(years) < 2:
        return None
    cur_eps, next_eps = by_fy[years[0]], by_fy[years[1]]
    if cur_eps is None or next_eps is None or cur_eps <= 0:
        return None
    return round((next_eps / cur_eps - 1) * 100, 2)


def fetch_one(ticker: str) -> dict | None:
    """One ticker's analyst slice — four independent legs. A leg that
    raises nulls ONLY its own slice (caught here, logged, moves on);
    ``fetch_one`` itself returns None only when EVERY leg came back empty."""
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return None

    consensus = pt_target = upgrades = downgrades = eps_growth = None

    try:
        consensus = _fetch_consensus_label(ticker)
    except Exception as exc:  # noqa: BLE001
        log.warning("[analyst_pass] consensus leg failed for %s: %s", ticker, exc)
    try:
        pt_target = _fetch_pt_target(ticker)
    except Exception as exc:  # noqa: BLE001
        log.warning("[analyst_pass] price-target leg failed for %s: %s", ticker, exc)
    try:
        upgrades, downgrades = _fetch_grade_actions_30d(ticker)
    except Exception as exc:  # noqa: BLE001
        log.warning("[analyst_pass] grade-actions leg failed for %s: %s", ticker, exc)
        upgrades = downgrades = None
    try:
        eps_growth = _fetch_eps_growth(ticker)
    except Exception as exc:  # noqa: BLE001
        log.warning("[analyst_pass] eps-growth leg failed for %s: %s", ticker, exc)

    if consensus is None and pt_target is None and upgrades is None and eps_growth is None:
        return None

    return {
        "consensus": consensus,
        "pt_target": pt_target,
        "upgrades_30d": upgrades,
        "downgrades_30d": downgrades,
        "eps_next_y_growth": eps_growth,
    }


# ─────────────────────────────────────────────────────────────────────────
# JOB (Task 7) — actives() + the cadenced, deadline-bounded pass
# ─────────────────────────────────────────────────────────────────────────
def _cap_universe() -> set:
    """The cap-universe ticker set, read directly rather than through
    ``snapshot_builder._load_universe`` — ``snapshot_builder`` will import
    THIS module in Task 10, so reaching back into it here would be a
    circular import waiting to happen the day that lazy-import boundary
    moves. Mirrors its two-path fallback exactly (duplicated on purpose)."""
    import json
    for p in ("api/data/cap_universe.json",
              os.path.join(os.path.dirname(__file__), "..", "..", "data",
                           "cap_universe.json")):
        if os.path.exists(p):
            with open(p) as fh:
                data = json.load(fh)
            return {t.upper() for t in data if isinstance(t, str)}
    return set()


def _actives_watchlists(failures=None) -> set:
    """Every symbol on any member watchlist — read-only, one query."""
    try:
        from api.services import auth_db
        with contextlib.closing(auth_db.get_connection()) as conn:
            rows = conn.execute("SELECT DISTINCT UPPER(sym) AS sym FROM watchlist_items")
            return {r["sym"] for r in rows if r["sym"]}
    except Exception as e:  # noqa: BLE001
        _note(failures, "watchlists", e)
        return set()


def _actives_uct20(failures=None) -> set:
    """UCT20 membership — ticker/sym/symbol coalesce, the
    ``context_joins.read_uct20`` idiom (the ticker key is polymorphic
    across wire pushes)."""
    try:
        from api.services import engine
        lead = engine.get_leadership() or []
    except Exception as e:  # noqa: BLE001
        _note(failures, "uct20", e)
        return set()
    out = set()
    for it in lead:
        if isinstance(it, dict):
            s = it.get("ticker") or it.get("sym") or it.get("symbol") or ""
            if s:
                out.add(str(s).upper())
    return out


def _actives_candidates(failures=None) -> set:
    """Current scanner candidates — every bucket of
    ``engine.get_candidates()["candidates"]``, same ticker/sym/symbol
    coalesce as the UCT20 leg."""
    try:
        from api.services import engine
        data = engine.get_candidates() or {}
    except Exception as e:  # noqa: BLE001
        _note(failures, "candidates", e)
        return set()
    buckets = data.get("candidates")
    if not isinstance(buckets, dict):
        _note(failures, "candidates", "empty")
        return set()
    out = set()
    for bucket in buckets.values():
        if not isinstance(bucket, list):
            continue
        for it in bucket:
            if isinstance(it, dict):
                s = it.get("ticker") or it.get("sym") or it.get("symbol") or ""
            elif isinstance(it, str):
                s = it
            else:
                s = ""
            if s:
                out.add(str(s).upper())
    if not out:
        _note(failures, "candidates", "empty")
    return out


def _actives_top_dollar_vol(failures=None, limit: int = 500) -> set:
    """Top ``limit`` tickers by ``dollar_vol_30d`` off the screener
    snapshot itself — liquidity-led actives beyond whatever the other three
    lists already cover."""
    try:
        from . import snapshot_db
        with contextlib.closing(snapshot_db.connect()) as conn:
            rows = conn.execute(
                "SELECT ticker FROM screener_rows WHERE dollar_vol_30d IS NOT NULL "
                "ORDER BY dollar_vol_30d DESC LIMIT ?", (limit,))
            return {r["ticker"].upper() for r in rows if r["ticker"]}
    except Exception as e:  # noqa: BLE001
        _note(failures, "top_dollar_vol", e)
        return set()


def actives(failures: dict | None = None) -> set:
    """Union of member watchlists ∪ UCT20 ∪ current scanner candidates ∪
    top-500 by dollar_vol_30d, intersected with the cap universe.

    Each leg is independently guarded — a dead leg costs only its own
    membership and is COUNTED (never silently dropped from the union, and
    never allowed to raise out of this function).

    ⛔ The cap-universe intersection only NARROWS what the four legs found.
    If the universe itself fails to load, the raw union is returned
    UNFILTERED rather than emptied — a missing universe file must not zero
    out a whole night's actives; the failure is still counted.
    """
    union = set()
    union |= _actives_watchlists(failures)
    union |= _actives_uct20(failures)
    union |= _actives_candidates(failures)
    union |= _actives_top_dollar_vol(failures)

    try:
        universe = _cap_universe()
    except Exception as e:  # noqa: BLE001
        _note(failures, "cap_universe", e)
        universe = set()
    if universe:
        union &= universe
    return union


def _tail_slice(tail_sorted: list, day_index: int) -> list:
    """One-seventh of the (sorted) tail for ``day_index``'s night — the
    whole tail is covered exactly once across 7 consecutive day-indices,
    with no ticker repeated twice in the same week."""
    return tail_sorted[day_index % 7::7]


def run_pass(now: datetime.datetime | None = None) -> dict:
    """Fetch analyst data for today's targets = actives ∪ this night's tail
    slice, stalest-first, stopping at a fixed 04:45 ET wall-clock deadline.

    ``now`` anchors the run's day (tail rotation index + the deadline's
    calendar date) — pass it explicitly in tests. The between-ticker
    deadline CHECK itself reads ``_now_et()`` (mockable) each iteration,
    exactly like ``scan_evaluator.run_sweep``: checked BETWEEN tickers,
    never mid-fetch, so a ticker is either fully fetched or not started at
    all. Returns (and persists to ``analyst_runs``) the receipt:
    ``{started_at, finished_at, actives, tail_slice, fetched, errors,
    budget_stop}``, where ``fetched + errors + budget_stop`` always equals
    the number of targets this run considered.
    """
    started = now if now is not None else _now_et()
    deadline = _deadline_et(started)

    init_db()

    act = actives()
    universe = _cap_universe()
    tail_all = sorted(universe - act)
    day_index = started.toordinal()
    tail_today = _tail_slice(tail_all, day_index)

    targets = sorted(act | set(tail_today))
    ordered = stalest(targets)

    # ⚠️ Flag default "0" in code — the scan-sweep precedent for a
    # budget-spending job. Railway sets SCREENER_ANALYST_PASS_ENABLED=1 at
    # ship; the pacing gap below is independent of that flag (it applies
    # whenever this function actually runs, gated or not).
    gap = float(os.environ.get("SCREENER_ANALYST_GAP_SECONDS", "0.25"))

    fetched = errors = budget_stop = 0
    for i, ticker in enumerate(ordered):
        if _now_et() >= deadline:
            budget_stop += len(ordered) - i
            break
        try:
            row = fetch_one(ticker)
        except Exception as exc:  # noqa: BLE001
            log.warning("[analyst_pass] fetch_one raised for %s: %s", ticker, exc)
            row = None
        if row is None:
            errors += 1
        else:
            upsert(ticker, row, now=_now_et().timestamp())
            fetched += 1
        if gap > 0 and i < len(ordered) - 1:
            time.sleep(gap)

    finished = _now_et()
    receipt = {
        "started_at": int(started.timestamp()),
        "finished_at": int(finished.timestamp()),
        "actives": len(act),
        "tail_slice": len(tail_today),
        "fetched": fetched,
        "errors": errors,
        "budget_stop": budget_stop,
    }
    _record_run(receipt)
    log.info("[analyst_pass] run_pass receipt: %s", receipt)
    return receipt


def _record_run(receipt: dict) -> None:
    try:
        with contextlib.closing(connect()) as conn:
            conn.execute(
                "INSERT INTO analyst_runs (started_at, finished_at, actives, "
                "tail_slice, fetched, errors, budget_stop) VALUES (?,?,?,?,?,?,?)",
                (receipt["started_at"], receipt["finished_at"], receipt["actives"],
                 receipt["tail_slice"], receipt["fetched"], receipt["errors"],
                 receipt["budget_stop"]))
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("[analyst_pass] failed to record run receipt: %s", exc)


def enabled() -> bool:
    """This pass's own flag, default OFF in code — the scan-sweep precedent
    (``scan_evaluator.enabled()``) for a budget-spending nightly job. Task
    11 wraps ``run_pass`` in this gate when registering the scheduled job.

    ⚠️ RAILWAY DIVERGENCE, DOCUMENTED HERE AT THE READ SITE: Railway sets
    ``SCREENER_ANALYST_PASS_ENABLED=1`` at ship, so a LOCAL run of this pass
    is OFF unless you set it too — the same deliberate divergence
    ``scan_evaluator.enabled()`` documents for ``SCAN_SWEEP_ENABLED``."""
    return os.environ.get("SCREENER_ANALYST_PASS_ENABLED", "0") == "1"
