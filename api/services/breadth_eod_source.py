"""TERM-042 (FB-A11-04) — the authoritative EOD breadth row, re-sourced server-side.

WHAT IS RE-SOURCED, AND WHAT IS NOT
    Today the day's breadth row is written by `breadth_collector.py` on the owner's
    PC (uct-intelligence, not this repo): it downloads a year of yfinance daily bars
    (`auto_adjust=True`, an X-class input) at ~4:15 PM ET and POSTs the row to
    `/api/breadth-monitor/push`. When the PC is off, the day has no row.

    This module computes the PRICE-DERIVED half of that row on the web pod from
    bars.db (Massive/Polygon daily aggregates, R-class), through the live method's
    own engine: `breadth_live._metrics_at_close` -> `compute_metrics`. There is no
    second implementation of any metric; the definitions are the ones `reconcile`
    already grades against the collector every session.

    NOT re-sourced here, named so nothing reads silence as coverage:
      * `NOT_LIVE` (sentiment, VIX family, index closes, `uct_exposure`, distance
        days, `atr_ext_7`) — other feeds, still carried by the collector's push.
      * `new_ath` — needs each name's full price history; `compute_metrics`
        publishes None for it and so does this row.
      * the UNIVERSE DEFINITION — which names are measured stays the collector's
        `universe_list`. The server measures the newest collector list STRICTLY
        BEFORE the session, so a day without the PC still has a population, and the
        parity run grades exactly the population `server` mode would publish.

MODES — `BREADTH_EOD_SOURCE` (text, read per call; unset/unknown = `collector`)
    collector  today's source, byte-for-byte. No thread, no store, no compute.
    shadow     the parallel run: after each session's bars land, compute the row
               and GRADE it against the collector's stored row with the live
               reconciliation's own grader (`breadth_live.grade`, per-metric tiers
               from `_ACCURACY`). Writes only `breadth_eod_shadow.db`. Never touches
               `breadth_snapshots`.
    server     `shadow`, plus: for sessions on/after `BREADTH_EOD_SERVER_FROM`
               (ISO date, REQUIRED — without it server mode refuses to write and
               runs as shadow) the server row becomes the stored row. Keys it owns
               are the computed price metrics and their drill lists; the collector's
               other keys are kept, and a later collector push is merged UNDER the
               server's keys instead of replacing them (`on_push`). History before
               the FROM date is never rewritten.

INST-7, stated rather than hidden
    The two computations share the POPULATION (the collector's list) and the
    METHOD (verbatim mirror), and differ in the price INPUT — which is the thing
    being re-sourced, so agreement on it is informative. A stored row that the
    self-heal already rewrote from bars.db (`_healed`) shares the input too, and is
    graded `not_comparable`, never counted as a pass.

DRILL LISTS
    Every `*_list` the server writes comes from `members`, the same boolean masks
    that produced the counts (`compute_metrics(..., members=)`), shaped by
    `breadth_live.drill_items` — the live drill's own item builder.

COST
    One `_metrics_at_close` = one windowed bars.db read (~380 sessions x universe)
    plus numpy; seconds, on a daemon thread off the request path and off the event
    loop, at most `_MAX_PER_TICK` sessions per tick. It makes NO vendor call: the
    bars arrive through the existing bars sync. It runs on `web` because
    `breadth_snapshots` lives on web's volume.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from contextlib import closing
from datetime import date, datetime, timezone
from typing import Optional

MODE_ENV = "BREADTH_EOD_SOURCE"
SERVER_FROM_ENV = "BREADTH_EOD_SERVER_FROM"
MODE_COLLECTOR = "collector"
MODE_SHADOW = "shadow"
MODE_SERVER = "server"
# ⭐ The mode table `feature_flag_index.mode_flags` reads by AST (the third flag
# axis): default AND vocabulary as literals, in the expression the code uses.
BREADTH_EOD_MODE_FLAGS = {
    "BREADTH_EOD_SOURCE": (MODE_COLLECTOR, (MODE_COLLECTOR, MODE_SHADOW, MODE_SERVER)),
}
DEFAULT_MODE, MODES = BREADTH_EOD_MODE_FLAGS[MODE_ENV]

# Intraday internals `compute_metrics` emits that the daily row has never carried
# (`breadth_live.RATIO_INTERNAL_KEYS`' comment: "computed each read but never
# written to the daily row"). A from-open count at the close is not the metric the
# live row means, so the server row does not start publishing them.
LIVE_ONLY = ("up_from_open", "down_from_open", "up_on_volume", "down_on_volume")

_MAX_PER_TICK = int(os.environ.get("BREADTH_EOD_SOURCE_PER_TICK", "3"))
_TICK_SECONDS = int(os.environ.get("BREADTH_EOD_SOURCE_SECS", "900"))
_START_DELAY = int(os.environ.get("BREADTH_EOD_SOURCE_DELAY", "120"))
_SHADOW_DAYS = int(os.environ.get("BREADTH_EOD_SHADOW_DAYS", "10"))
# bars.db carries a DEVELOPING daily bar all session; a session's own row is not
# computed until the evening, when its closes are final and ingested.
_READY_HHMM = os.environ.get("BREADTH_EOD_READY_ET", "20:00")
# A low-coverage session is retried, but not every tick forever.
_RETRY_LOW_COVERAGE_S = 6 * 3600


# ── configuration ────────────────────────────────────────────────────────────

def mode() -> str:
    """The configured source. Anything unrecognised is TODAY'S source: this flag
    moves the authority over a published row, so a typo must not move it."""
    raw = (os.environ.get(MODE_ENV) or "").strip().lower()
    return raw if raw in MODES else DEFAULT_MODE


def server_from() -> Optional[str]:
    raw = (os.environ.get(SERVER_FROM_ENV) or "").strip()
    try:
        return date.fromisoformat(raw).isoformat() if raw else None
    except ValueError:
        return None


UNIVERSE_ENV = "BREADTH_EOD_UNIVERSE"


def universe_source() -> str:
    """Which list a `server`-mode write measures over: `server` (default — the
    server-built list, collector list as fallback) or `collector` (the newest
    collector list only, the original behaviour). Shadow always runs both."""
    raw = (os.environ.get(UNIVERSE_ENV) or "").strip().lower()
    return "collector" if raw == "collector" else "server"


def server_writes(date_iso: str) -> bool:
    """True only when `server` mode is armed AND the session is on/after FROM."""
    frm = server_from()
    return mode() == "server" and frm is not None and date_iso >= frm


# ── which keys the server row owns ───────────────────────────────────────────

def owned_keys(computed: dict) -> list:
    """The computed keys the server row publishes: every non-None metric the
    reconciliation grades (`_ACCURACY`) or an index field, minus diagnostics and
    the live-only internals. Derived from the grader's own table, never typed."""
    from api.services import breadth_live as bl
    from api.services import breadth_eod_extras as bee
    graded = set(bl._ACCURACY) | set(bee.KEYS)
    return sorted(
        k for k, v in (computed or {}).items()
        if v is not None and not k.startswith("_") and k not in LIVE_ONLY
        and (k in graded or bl._is_index_field(k))
    )


def _grade(key: str, server, stored) -> tuple:
    """(grade, accuracy, tolerance) — an extras key under its own tolerance
    (`breadth_eod_extras.TOLERANCE`), every other key under the reconciliation's."""
    from api.services import breadth_live as bl
    from api.services import breadth_eod_extras as bee
    if key in bee.TOLERANCE:
        return bee.grade(key, server, stored), "extras", bee.TOLERANCE[key]
    return bl.grade(server, stored, key), bl.accuracy_of(key), bl._tolerance_for(key)


def list_key(metric: str) -> str:
    """The stored `*_list` key a metric's names live under (the drill-key
    aliases, inverted: `universe_count` -> `universe_list`)."""
    from api.services import breadth_live as bl
    inverse = {v: k for k, v in bl._DRILL_KEY_ALIASES.items()}
    return inverse.get(metric, metric + "_list")


# ── the computation ──────────────────────────────────────────────────────────

def _collector_universe_before(date_iso: str) -> tuple:
    """(tickers, from_date) — the newest COLLECTOR-sourced `universe_list`
    strictly before `date_iso`. A server row's list is skipped: it is the priced
    subset, and reading it back would shrink the population session by session."""
    from api.services import breadth_monitor as bm
    try:
        with closing(bm._conn()) as c:
            cur = c.execute(
                "SELECT s.date, s.metrics FROM breadth_snapshots s "
                "LEFT JOIN breadth_snapshot_numeric n ON n.date = s.date "
                "WHERE s.date < ? AND COALESCE(n.source, 'collector') != 'server' "
                "ORDER BY s.date DESC LIMIT 15", (date_iso,))
            for d, blob in cur:
                try:
                    m = json.loads(blob)
                except (TypeError, ValueError):
                    continue
                if m.get("_source") == "server":
                    continue
                tickers = sorted({str(i.get("t")).upper() for i in (m.get("universe_list") or [])
                                  if isinstance(i, dict) and i.get("t")})
                if len(tickers) > 100:
                    return tickers, d
    except Exception as e:                        # noqa: BLE001 - reported, never raised
        print(f"[breadth-eod] universe read failed: {type(e).__name__}: {e}")
    return [], None


def server_universe_for(date_iso: str) -> tuple:
    """(tickers, from_label) — the SERVER-built list for this session
    (`breadth_server_universe`), or ([], reason) when it cannot be built."""
    try:
        from api.services import breadth_server_universe as bsu
        res = bsu.build(date_iso)
    except Exception as e:                        # noqa: BLE001
        return [], f"server universe failed: {type(e).__name__}: {e}"
    if not res.get("ok"):
        return [], f"server universe unavailable: {res.get('reason')}"
    return list(res["tickers"]), f"server:{res.get('basis_date')}"


def extras_for(date_iso: str, tickers: list, conn=None) -> dict:
    """The non-price keys for the session (`breadth_eod_extras`). Never raises."""
    try:
        from api.services import breadth_eod_extras as bee
        return bee.compute_extras(date_iso, tickers, conn)
    except Exception as e:                        # noqa: BLE001
        return {"_extras_errors": {"import": f"{type(e).__name__}: {e}"}}


def compute(date_iso: str, conn=None, universe: Optional[tuple] = None) -> dict:
    """The server-computed row for one completed session. Never writes.

    `universe` = `(tickers, from_label)` measures over that list; omitted, the
    COLLECTOR's newest list before the session (the original behaviour)."""
    from api.services import breadth_live as bl
    try:
        conn = conn or bl._bars_conn()
        ts = bl._ts_int(date.fromisoformat(date_iso))
        if not conn.execute("SELECT 1 FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts = ?",
                            (ts,)).fetchone():
            return {"ok": False, "date": date_iso,
                    "reason": "no SPY daily bar for this session in bars.db"}
        if universe is not None:
            tickers, uni_from = universe
            if not tickers:
                return {"ok": False, "date": date_iso, "reason": uni_from or "empty universe"}
        else:
            tickers, uni_from = _collector_universe_before(date_iso)
            if not tickers:
                return {"ok": False, "date": date_iso,
                        "reason": "no collector universe_list before this session"}
        members, capture = {}, {}
        metrics = bl._metrics_at_close(conn, tickers, ts, members=members, capture=capture)
    except Exception as e:                        # noqa: BLE001
        return {"ok": False, "date": date_iso, "reason": f"{type(e).__name__}: {e}"}
    if not metrics:
        return {"ok": False, "date": date_iso,
                "reason": "bars.db cannot support this session (history or prices missing)"}
    # ⭐ (2026-10-10) the rest of the collector's push — indices, volatility, Fear & Greed,
    # distribution days, exposure/phase, all-time highs, ATR extension — produced here
    # (`breadth_eod_extras`). A price metric the engine computed is never overridden.
    for k, v in (extras_for(date_iso, tickers, conn) or {}).items():
        if metrics.get(k) is None:
            metrics[k] = v
    priced = int(metrics.get("universe_count") or 0)
    coverage = priced / len(tickers)
    return {"ok": True, "date": date_iso, "metrics": metrics, "members": members,
            "capture": capture, "universe_size": len(tickers), "universe_from": uni_from,
            "coverage": round(coverage, 4), "coverage_ok": coverage >= bl.MIN_LIVE_COVERAGE,
            "dividend_basis": bl.dividend_basis_enabled()}


# ── parity: the reconciliation's grader, per metric, disagreements by name ───

def _recent_before(date_iso: str) -> list:
    from api.services import breadth_monitor as bm
    try:
        return [r for r in bm.get_history(12, end=date_iso) if (r.get("date") or "") < date_iso]
    except Exception:
        return []


def grade_row(server: dict, stored: dict, recent: Optional[list] = None) -> dict:
    """Grade every server-owned metric against the stored row with
    `breadth_live.grade` — the same tiers `reconcile` asserts. Failures are listed
    BY NAME, and the published rating (`breadth_score`) is compared both ways."""
    from api.services import breadth_live as bl
    from api.services import breadth_monitor as bm
    owned = owned_keys(server)
    fields, passed, failed, server_only = {}, [], [], []
    for k in owned:
        g, accuracy, tolerance = _grade(k, server.get(k), stored.get(k))
        if g is None:
            server_only.append(k)
            continue
        fields[k] = {"stored": stored.get(k), "server": server.get(k), "delta": g["delta"],
                     "rel_pct": g["rel_pct"], "pass": g["pass"],
                     "accuracy": accuracy, "tolerance": tolerance}
        (passed if g["pass"] else failed).append(k)
    collector_only = sorted(
        k for k, v in stored.items()
        if v is not None and k != "date" and not k.startswith("_")
        and not k.endswith("_list") and k not in owned)
    recent = recent if recent is not None else []
    base = bm.numeric_of(stored)
    try:
        s_col = bm.derive_live_row(base, recent).get("breadth_score")
        s_srv = bm.derive_live_row({**base, **{k: server[k] for k in owned
                                               if not isinstance(server[k], str)}},
                                   recent).get("breadth_score")
    except Exception:                             # noqa: BLE001
        s_col = s_srv = None
    return {"fields": fields, "passed": passed, "failed": failed,
            "server_only": server_only, "collector_only": collector_only,
            "breadth_score": {"collector": s_col, "server": s_srv,
                              "delta": (round(s_srv - s_col, 1)
                                        if s_col is not None and s_srv is not None else None)}}


def not_comparable_reason(stored: dict) -> Optional[str]:
    """Why a stored row cannot corroborate the server row (INST-7), or None."""
    if stored.get("_source") == "server":
        return "stored row is itself server-computed"
    if stored.get("_healed"):
        return "stored row is a bars.db self-heal (same input as the server row)"
    return None


# ── the shadow store — its own file, never breadth_snapshots ─────────────────

def _shadow_path() -> str:
    override = os.environ.get("BREADTH_EOD_SHADOW_DB")
    if override:
        return override
    from api.services import breadth_monitor as bm
    return os.path.join(os.path.dirname(bm._db_path()), "breadth_eod_shadow.db")


#: The two parallel runs: `eod_shadow` measures over the COLLECTOR's universe (the
#: original parity run); `eod_shadow_su` over the SERVER-built universe
#: (`breadth_server_universe`) — the run that decides whether the PC can be retired
#: (2026-10-10, owner: "not rely on my PC").
TABLE_COLLECTOR_UNIVERSE = "eod_shadow"
TABLE_SERVER_UNIVERSE = "eod_shadow_su"
_TABLES = (TABLE_COLLECTOR_UNIVERSE, TABLE_SERVER_UNIVERSE)


def _shadow_conn(table: str = TABLE_COLLECTOR_UNIVERSE) -> sqlite3.Connection:
    if table not in _TABLES:
        raise ValueError(f"unknown shadow table {table!r}")
    c = sqlite3.connect(_shadow_path(), timeout=5)
    c.execute(f"""CREATE TABLE IF NOT EXISTS {table} (
        date TEXT PRIMARY KEY, computed_at REAL NOT NULL, status TEXT NOT NULL,
        reason TEXT, stored_hash TEXT, coverage REAL, universe_size INTEGER,
        universe_from TEXT, dividend_basis INTEGER, report TEXT NOT NULL)""")
    return c


def _hash(stored: Optional[dict]) -> Optional[str]:
    if stored is None:
        return None
    from api.services import breadth_monitor as bm
    blob = json.dumps(bm.numeric_of(stored), sort_keys=True, default=str)
    # GRADER_VERSION rides in the hash so a change to WHAT is graded (2: the extras
    # keys, 2026-10-10) re-grades every recent session once instead of keeping the
    # old report as "current".
    return hashlib.sha256(f"{GRADER_VERSION}|{blob}".encode()).hexdigest()[:16]


GRADER_VERSION = 2


def _record(date_iso: str, status: str, reason: Optional[str], stored: Optional[dict],
            result: dict, report: dict, table: str = TABLE_COLLECTOR_UNIVERSE) -> dict:
    rec = {"date": date_iso, "computed_at": time.time(), "status": status, "reason": reason,
           "stored_hash": _hash(stored), "coverage": result.get("coverage"),
           "universe_size": result.get("universe_size"),
           "universe_from": result.get("universe_from"),
           "dividend_basis": int(bool(result.get("dividend_basis"))), "report": report}
    with closing(_shadow_conn(table)) as c:
        c.execute(f"INSERT OR REPLACE INTO {table} VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (rec["date"], rec["computed_at"], status, reason, rec["stored_hash"],
                   rec["coverage"], rec["universe_size"], rec["universe_from"],
                   rec["dividend_basis"], json.dumps(report, default=str)))
        c.commit()
    return rec


def shadow_records(limit: int = 60, table: str = TABLE_COLLECTOR_UNIVERSE) -> list:
    try:
        with closing(_shadow_conn(table)) as c:
            rows = c.execute(
                "SELECT date, computed_at, status, reason, stored_hash, coverage, "
                f"universe_size, universe_from, dividend_basis, report FROM {table} "
                "ORDER BY date DESC LIMIT ?", (int(limit),)).fetchall()
    except Exception:
        return []
    keys = ("date", "computed_at", "status", "reason", "stored_hash", "coverage",
            "universe_size", "universe_from", "dividend_basis", "report")
    out = []
    for r in rows:
        rec = dict(zip(keys, r))
        rec["report"] = json.loads(rec["report"] or "{}")
        out.append(rec)
    return out


def _shadow_current(date_iso: str, stored: dict,
                    table: str = TABLE_COLLECTOR_UNIVERSE) -> bool:
    """True when the stored row already has an up-to-date shadow record: same
    stored-row hash (a re-push or a heal re-grades it), and a low-coverage
    attempt only counts as current for `_RETRY_LOW_COVERAGE_S`."""
    try:
        with closing(_shadow_conn(table)) as c:
            row = c.execute(f"SELECT stored_hash, status, computed_at FROM {table} "
                            "WHERE date = ?", (date_iso,)).fetchone()
    except Exception:
        return False
    if row is None or row[0] != _hash(stored):
        return False
    if row[1] in ("insufficient_coverage", "unavailable"):
        return time.time() - float(row[2]) < _RETRY_LOW_COVERAGE_S
    return True


def grade_and_record(date_iso: str, stored: dict, result: dict,
                     table: str = TABLE_COLLECTOR_UNIVERSE,
                     extra: Optional[dict] = None) -> dict:
    """Grade a computed result against a stored collector row and record it.
    `extra` rides in the report (the server-universe run's list comparison)."""
    extra = dict(extra or {})
    why = not_comparable_reason(stored)
    if why:
        return _record(date_iso, "not_comparable", why, stored, result, extra, table)
    if not result.get("coverage_ok"):
        return _record(date_iso, "insufficient_coverage",
                       f"bars.db priced {result.get('coverage')} of the universe "
                       f"(floor {_min_coverage()})", stored, result, extra, table)
    report = grade_row(result["metrics"], stored, _recent_before(date_iso))
    report["server_metrics"] = {k: result["metrics"][k] for k in owned_keys(result["metrics"])}
    report.update(extra)
    return _record(date_iso, "graded", None, stored, result, report, table)


def _min_coverage() -> float:
    from api.services import breadth_live as bl
    return bl.MIN_LIVE_COVERAGE


def shadow_date(date_iso: str) -> dict:
    """Compute the server row for one session and grade it. Writes the shadow
    store only."""
    from api.services import breadth_monitor as bm
    stored = bm.raw_row(date_iso)
    if stored is None:
        return {"date": date_iso, "computed": False, "status": "no_collector_row"}
    if _shadow_current(date_iso, stored):
        return {"date": date_iso, "computed": False, "status": "current"}
    result = compute(date_iso)
    if not result.get("ok"):
        return {"date": date_iso, "computed": True, "status": "unavailable",
                "reason": result.get("reason")}
    rec = grade_and_record(date_iso, stored, result)
    return {"date": date_iso, "computed": True, "status": rec["status"],
            "failed": (rec["report"] or {}).get("failed")}


def _stored_universe(stored: dict) -> list:
    return sorted({str(i.get("t")).upper() for i in (stored.get("universe_list") or [])
                   if isinstance(i, dict) and i.get("t")})


def shadow_server_universe(date_iso: str) -> dict:
    """The second parallel run: the same session measured over the SERVER-built
    universe, graded against the collector row, the two lists compared by name.
    Writes the shadow store only."""
    from api.services import breadth_monitor as bm
    from api.services import breadth_server_universe as bsu
    run = "server_universe"
    stored = bm.raw_row(date_iso)
    if stored is None:
        return {"date": date_iso, "computed": False, "status": "no_collector_row", "run": run}
    if _shadow_current(date_iso, stored, TABLE_SERVER_UNIVERSE):
        return {"date": date_iso, "computed": False, "status": "current", "run": run}
    uni = server_universe_for(date_iso)
    extra = {"universe_compare": bsu.compare(uni[0], _stored_universe(stored))}
    result = compute(date_iso, universe=uni)
    if not result.get("ok"):
        _record(date_iso, "unavailable", result.get("reason"), stored, result, extra,
                TABLE_SERVER_UNIVERSE)
        return {"date": date_iso, "computed": True, "status": "unavailable",
                "reason": result.get("reason"), "run": run}
    rec = grade_and_record(date_iso, stored, result, TABLE_SERVER_UNIVERSE, extra)
    return {"date": date_iso, "computed": True, "status": rec["status"], "run": run,
            "failed": (rec["report"] or {}).get("failed")}


# ── server mode: the row, and the push merge ─────────────────────────────────

def build_server_row(result: dict, existing: Optional[dict]) -> dict:
    """The stored row `server` mode writes: the collector's keys (if its push
    already landed) with every server-owned metric and its drill list replaced."""
    from api.services import breadth_live as bl
    metrics = result["metrics"]
    owned = owned_keys(metrics)
    row = dict(existing or {})
    row.pop("_healed", None)
    for k in owned:
        row[k] = metrics[k]
    cap = result.get("capture") or {}
    members = result.get("members") or {}
    for k in owned:
        if k in bl.DRILLABLE and k in members:
            row[list_key(k)] = bl.drill_items(members[k], cap.get("levels") or {},
                                              cap.get("prices") or {}, cap.get("vols") or {})
    row["date"] = result["date"]
    row["_source"] = "server"
    row["_source_detail"] = {
        "owned": owned, "input": "bars.db (massive daily aggregates)",
        "universe_from": result.get("universe_from"),
        "universe_size": result.get("universe_size"), "coverage": result.get("coverage"),
        "dividend_basis": bool(result.get("dividend_basis")),
        "measured": metrics.get("_measured"),
        "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "collector_keys_kept": sorted(k for k in (existing or {})
                                      if k not in owned and not k.startswith("_")
                                      and k != "date" and not k.endswith("_list")),
    }
    return row


def write_server_row(date_iso: str) -> dict:
    """`server` mode's write for one session. Refuses unless armed for the date,
    covered, and not degraded; grades against a collector row that already landed."""
    from api.services import breadth_monitor as bm
    if not server_writes(date_iso):
        return {"date": date_iso, "computed": False, "status": "not_armed_for_date"}
    existing = bm.raw_row(date_iso)
    if existing and existing.get("_source") == "server":
        return {"date": date_iso, "computed": False, "status": "current"}
    # ⭐ (2026-10-10) the SERVER-built universe first, so a session the PC never pushed
    # still has its own population; the collector's newest list is the fallback.
    result = {"ok": False}
    if universe_source() == "server":
        uni = server_universe_for(date_iso)
        if uni[0]:
            result = compute(date_iso, universe=uni)
    if not result.get("ok"):
        result = compute(date_iso)
    if not result.get("ok"):
        return {"date": date_iso, "computed": True, "status": "unavailable",
                "reason": result.get("reason")}
    if not result.get("coverage_ok"):
        return {"date": date_iso, "computed": True, "status": "insufficient_coverage",
                "coverage": result.get("coverage")}
    row = build_server_row(result, existing)
    if bm.snapshot_looks_degraded(row):
        return {"date": date_iso, "computed": True, "status": "refused_degraded"}
    if existing:
        try:
            grade_and_record(date_iso, existing, result)
        except Exception as e:                    # noqa: BLE001 - parity is best-effort here
            print(f"[breadth-eod] parity record failed: {e}")
    ok = bm.store_snapshot(date_iso, row, source="server")
    return {"date": date_iso, "computed": True, "status": "written" if ok else "store_failed"}


def on_push(date_str: str, metrics: dict) -> tuple:
    """The push route's hook: `(metrics_to_store, source)`.

    Identity — the same dict and `collector` — unless `server` mode is armed and
    the stored row for this date is server-written. Then the collector's push
    contributes only the keys the server does not own (sentiment, `new_ath`, ...),
    and the late collector row is graded against the server row first."""
    if mode() != "server":
        return metrics, "collector"
    from api.services import breadth_monitor as bm
    existing = bm.raw_row(date_str)
    if not existing or existing.get("_source") != "server":
        return metrics, "collector"
    owned = list((existing.get("_source_detail") or {}).get("owned") or [])
    try:
        # Graded here, before the merge, because this is the only moment the
        # collector's own values for the server-owned keys exist anywhere.
        report = grade_row({k: existing.get(k) for k in owned}, metrics,
                           _recent_before(date_str))
        detail = existing.get("_source_detail") or {}
        _record(date_str, "graded", "collector push after server row", metrics,
                {"coverage": detail.get("coverage"), "universe_size": detail.get("universe_size"),
                 "universe_from": detail.get("universe_from"),
                 "dividend_basis": detail.get("dividend_basis")}, report)
    except Exception as e:                        # noqa: BLE001
        print(f"[breadth-eod] late-push parity failed: {e}")
    merged = {k: v for k, v in metrics.items() if not k.startswith("_")}
    for k in owned:
        merged[k] = existing.get(k)
        lk = list_key(k)
        if lk in existing:
            merged[lk] = existing[lk]
    merged["_source"] = "server"
    merged["_source_detail"] = existing.get("_source_detail")
    return merged, "server"


# ── parity report ────────────────────────────────────────────────────────────

#: How many sessions are enough to switch to `server` — DECIDED 2026-10-07 under the
#: owner's delegation (`docs/terminal-research/12-decisions/2026-10-07-owner-delegated-
#: decisions.md`, TERM-042): the newest TEN completed sessions (two trading weeks), in a
#: row, each GRADED with every owned metric passing. A session that could not be graded
#: (healed, low coverage, not comparable) breaks the run rather than being skipped: the
#: switch is earned on sessions that were actually compared, never on gaps.
SWITCH_CLEAN_SESSIONS = 10


def _clean(rec: dict) -> bool:
    fields = ((rec.get("report") or {}).get("fields") or {})
    return (rec.get("status") == "graded" and bool(fields)
            and all(f.get("pass") for f in fields.values()))


def switch_readiness(recs: list, required: int = SWITCH_CLEAN_SESSIONS) -> dict:
    """Whether the parallel run has earned `BREADTH_EOD_SOURCE=server`. `recs` is
    `shadow_records()` (newest first). Reads only; it switches nothing — setting
    the variable stays a person's act on Railway. `current` rows (re-reads of an
    unchanged session) are not in the store, so every record is one session."""
    run, broke_on = 0, None
    for r in recs:
        if _clean(r):
            run += 1
            continue
        broke_on = {"date": r.get("date"), "status": r.get("status"),
                    "reason": r.get("reason") or ("a metric failed" if r.get("status") == "graded"
                                                  else None)}
        break
    ready = run >= required
    return {"required_consecutive_clean": required, "consecutive_clean": run,
            "ready": ready, "broken_by": broke_on,
            "sentence": (f"Ready: the newest {run} sessions all graded clean; set "
                         f"BREADTH_EOD_SOURCE=server with BREADTH_EOD_SERVER_FROM = the next session."
                         if ready else
                         f"Not yet: {run} of {required} consecutive clean sessions.")}


def parity_report(limit: int = 60, table: str = TABLE_COLLECTOR_UNIVERSE) -> dict:
    """Per metric across every GRADED session: n, passes, the failing sessions by
    DATE, and the worst delta. Sessions that could not be graded are listed by
    name with their reason. `switch` carries the decided bar
    (`SWITCH_CLEAN_SESSIONS` consecutive clean sessions) as a reading, never an act.
    The server-universe run also lists each session's universe comparison."""
    recs = shadow_records(max(int(limit), SWITCH_CLEAN_SESSIONS), table)
    if table == TABLE_SERVER_UNIVERSE:
        out = parity_report_rows(recs)
        out["universe_compare"] = [{"date": r["date"], **((r["report"] or {})
                                                          .get("universe_compare") or {})}
                                   for r in recs]
        return out
    return parity_report_rows(recs)


def parity_report_rows(recs: list) -> dict:
    """`parity_report`'s body over already-read shadow records."""
    graded = [r for r in recs if r["status"] == "graded"]
    per: dict = {}
    for r in graded:
        for k, f in ((r["report"] or {}).get("fields") or {}).items():
            e = per.setdefault(k, {"n": 0, "pass": 0, "failed_on": [], "max_abs_delta": 0.0,
                                   "max_rel_pct": 0.0, "accuracy": f.get("accuracy"),
                                   "tolerance": f.get("tolerance")})
            e["n"] += 1
            if f.get("pass"):
                e["pass"] += 1
            else:
                e["failed_on"].append(r["date"])
            e["max_abs_delta"] = max(e["max_abs_delta"], abs(float(f.get("delta") or 0)))
            rel = f.get("rel_pct")
            if rel is not None and rel != float("inf"):
                e["max_rel_pct"] = max(e["max_rel_pct"], float(rel))
    scores = [{"date": r["date"], **((r["report"] or {}).get("breadth_score") or {})}
              for r in graded]
    collector_only = sorted({k for r in graded
                             for k in (r["report"] or {}).get("collector_only") or []})
    return {"sessions_graded": len(graded),
            "switch": switch_readiness(recs),
            "metrics_with_failures": sorted(k for k, e in per.items() if e["failed_on"]),
            "per_metric": dict(sorted(per.items())),
            "breadth_score": scores,
            "collector_only_keys": collector_only,
            "not_graded": [{"date": r["date"], "status": r["status"], "reason": r["reason"]}
                           for r in recs if r["status"] != "graded"]}


# ── the scheduled job ────────────────────────────────────────────────────────

_tick_lock = threading.Lock()
_status: dict = {"started": False, "last_tick": None, "last_results": []}


def candidate_sessions(now: Optional[datetime] = None, days: Optional[int] = None) -> list:
    """The newest completed sessions in bars.db, newest first. Today's session is
    included only after `_READY_HHMM` ET, because bars.db carries a developing
    daily bar during the session."""
    from api.services import breadth_live as bl
    now = now or bl._now_et()
    today = now.date().isoformat()
    hh, mm = (int(x) for x in _READY_HHMM.split(":"))
    ready = (now.hour, now.minute) >= (hh, mm)
    try:
        rows = bl._bars_conn().execute(
            "SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' ORDER BY ts DESC LIMIT ?",
            (int(days or _SHADOW_DAYS) + 1,)).fetchall()
    except Exception:
        return []
    out = []
    for (ts,) in rows:
        d = bl._iso(int(ts))
        if d > today or (d == today and not ready):
            continue
        out.append(d)
    return out[: int(days or _SHADOW_DAYS)]


def tick(now: Optional[datetime] = None) -> dict:
    """One pass: `collector` does nothing; otherwise at most `_MAX_PER_TICK`
    sessions are computed (server write where armed, shadow grade elsewhere)."""
    m = mode()
    if m == "collector":
        return {"mode": m, "ran": False}
    if not _tick_lock.acquire(blocking=False):
        return {"mode": m, "ran": False, "busy": True}
    try:
        results, budget = [], _MAX_PER_TICK
        for d in candidate_sessions(now):
            if budget <= 0:
                break
            res = write_server_row(d) if server_writes(d) else shadow_date(d)
            if res.get("computed"):
                budget -= 1
            results.append(res)
            if budget > 0 and not server_writes(d):
                # the server-universe parallel run (graded the same way)
                try:
                    res2 = shadow_server_universe(d)
                except Exception as e:            # noqa: BLE001 - never stops the main run
                    res2 = {"date": d, "run": "server_universe", "status": "error",
                            "reason": f"{type(e).__name__}: {e}"}
                if res2.get("computed"):
                    budget -= 1
                results.append(res2)
        _status.update(last_tick=time.time(), last_results=results)
        return {"mode": m, "ran": True, "results": results}
    finally:
        _tick_lock.release()


def status() -> dict:
    return {"mode": mode(), "server_from": server_from(), "job": dict(_status)}


def start_job() -> bool:
    """Start the daemon loop. Returns False and starts NOTHING when the mode is
    `collector` (the default) — flag-off is today's process, thread for thread."""
    if mode() == "collector" or _status.get("started"):
        return False
    _status["started"] = True

    def _run():
        time.sleep(max(0, _START_DELAY))
        while True:
            try:
                tick()
            except Exception as e:                # noqa: BLE001 - the loop must survive
                print(f"[breadth-eod] tick error (non-fatal): {type(e).__name__}: {e}")
            time.sleep(max(60, _TICK_SECONDS))

    threading.Thread(target=_run, name="breadth_eod_source", daemon=True).start()
    return True
