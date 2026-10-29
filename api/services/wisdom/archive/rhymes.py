"""THIS RHYMES — the team archive's precedent beside TODAY's scanner hits.

For every active daily detection the universe scan holds (patterns.db, the same "active" window
the screener's pattern join reads), the setup it maps to in the archive (the one vocabulary map,
setup_map.setup_for_pattern) and what the team's own history says about it:

  * the setup's measured record — n scored, 20-day win rate, edge R and its verdict ("measured
    edge" only at |z| >= EDGE_Z on at least MIN_CONTEXT_N calls), and the cut for TODAY's market
    state when that cut rests on enough calls;
  * the ticker's own archive history — how many calls, and the newest one;
  * the three closest past calls of that setup: same setup, same market state, newest first. The
    archive stores no extension or index context per call, so "closest" is that, and says so.

⛔ DISPLAY ONLY (owner decision 3, 2026-10-16). Nothing here feeds what fires, its confidence,
HIST_SCORE or confirmed_only. It reads patterns.db and never writes it.
⛔ NO PRICE LEVELS. No entry, stop or target leaves this module, for any call of any age.
⛔ THE GATE: WISDOM_ARCHIVE_ENABLED, read FIRST and per call. Off means None before any store read.
⛔ Internal detectors (INTERNAL_PATTERN_IDS) and candlestick shapes never appear, the same exclusions
the screener's join applies, read from the same authorities.

Ranking: the archive has history on this ticker > the setup's edge is measured > more scored calls
> higher detection confidence.

⛔ CACHING — STALE-WHILE-REFRESH, ONE COMPUTE AT A TIME (2026-10-29). Measured in production that
day: GET /rhymes ran >130 s and never answered, so the Desk's Today view never loaded. Two causes:
  1. The cache KEY was built from the active detections, so EVERY request — hit or miss — first ran
     the full detection read: ~97k rows of a table whose `status` / `detected_at` sit behind five
     large JSON columns, so SQLite reads each ~9 KB row whole (27 s cold, 1.7 s warm on a local
     copy). And the key moved with every new detection during the session, so it rarely hit.
  2. Nothing stopped N members from each running that compute at once.
Now a cached answer is served WITHOUT touching the scan; once it is REFRESH_S old a single
background thread recomputes and members keep the previous answer meanwhile; only a cold (or
STALE_MAX_S-old) cache computes in the request, and concurrent cold callers wait on ONE compute.
`force=True` still computes now (tests, an explicit refresh). `warm()` starts a background compute
so the first member to open Today does not pay for it (the archive routes call it).

NOT BUILT, ON PURPOSE: a "this rhymes" ALERT. Pushing a hit to a member is a new S7 alert type,
which trips the alert taxonomy's parity rail (test_alert_taxonomy_filing_watch_parity) and needs the
S7 owner's CP3 sign-off. Until then this is pull-only: the route, the Today view, Ask AI and Compass.

Consumers: GET /api/wisdom/archive/rhymes (paid), the "Today" view on /trader-archive, the Ask AI
archive block (a bounded line when the question asks what is rhyming), and the Compass tool
`trader_archive_rhymes` (chat + voice, one implementation in archive/tools.py).
"""
from __future__ import annotations

import contextlib
import logging
import threading
import time
from typing import Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

WINDOW_SECS = 7 * 24 * 3600          # the screener's / memory.py's active window
ACTIVE_STATUSES = ("forming", "ready", "triggered")
EXCLUDED_CATEGORIES = ("candlestick",)
CLOSEST_N = 3
MAX_HITS = 200
REFRESH_S = 900           # a cached answer this old is refreshed in the background
STALE_MAX_S = 3 * 3600    # older than this is not served: the request computes (or waits on one)
CACHE_TTL_S = REFRESH_S   # the name older readers know

_LOCK = threading.Lock()          # guards _CACHE and _STATE
_COMPUTE = threading.Lock()       # ONE compute at a time, in a request or in the background
_CACHE: dict = {"at": 0.0, "value": None}
_STATE: dict = {"refreshing": False}


def clear_cache() -> None:
    with _LOCK:
        _CACHE.update(at=0.0, value=None)


def _internal_ids() -> tuple:
    from api.services.pattern_engine.detectors.registry import INTERNAL_PATTERN_IDS

    return tuple(sorted(INTERNAL_PATTERN_IDS))


def _detections(now: Optional[float] = None) -> list:
    """Active daily detections: (sym, pattern_id, direction, confidence, detected_at)."""
    from api.services.pattern_engine import pattern_db

    cutoff = int(now if now is not None else time.time()) - WINDOW_SECS
    internal = _internal_ids()
    sql = (
        "SELECT sym, pattern_id, direction, confidence, detected_at FROM pattern_detections "
        f"WHERE tf = 'D' AND status IN ({','.join('?' * len(ACTIVE_STATUSES))}) AND detected_at >= ? "
        f"AND (category IS NULL OR category NOT IN ({','.join('?' * len(EXCLUDED_CATEGORIES))}))")
    params: list = [*ACTIVE_STATUSES, cutoff, *EXCLUDED_CATEGORIES]
    if internal:
        sql += f" AND pattern_id NOT IN ({','.join('?' * len(internal))})"
        params.extend(internal)
    with contextlib.closing(pattern_db.get_connection()) as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [(r[0], r[1], r[2], r[3], r[4]) for r in rows]


def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _closest(conn, setup: str, state: Optional[str], limit: int = CLOSEST_N) -> list:
    """The newest scored calls of one setup in one market state, without price levels."""
    from api.services.wisdom.archive import service
    from api.services.wisdom.archive.askai import _speaker

    sql = ("SELECT call_id, record_id, author_id, ticker, direction, setup, action, posted, outcome_json "
           "FROM wisdom_archive_calls WHERE setup = ? COLLATE NOCASE "
           "AND json_extract(outcome_json, '$.r20') IS NOT NULL")
    params: list = [setup]
    if state:
        sql += " AND json_extract(outcome_json, '$.regime') = ?"
        params.append(state)
    sql += " ORDER BY posted DESC, call_id DESC LIMIT ?"
    params.append(limit)
    out = []
    for r in conn.execute(sql, tuple(params)):
        c = service._call_dict(r)
        o = c.get("outcome") or {}
        out.append({"ticker": c.get("ticker"), "posted": c.get("posted"), "trader": _speaker(c.get("author_id")),
                    "direction": c.get("direction"), "r20": o.get("r20"), "sim_R": o.get("sim_R"),
                    "regime": o.get("regime"), "record_id": c.get("record_id")})
    return out


def _setup_view(pb: dict, state: Optional[str]) -> dict:
    from api.services.wisdom.archive import team_record

    _, min_n = team_record._thresholds()
    st = (pb.get("stats") or {}).get("all") or {}
    cut = ((pb.get("context") or {}).get("market") or {}).get(state) if state else None
    cut = cut if cut and int(cut.get("n_scored") or 0) >= min_n else None
    return {
        "setup_id": pb.get("setup_id"), "name": pb.get("name"),
        "n_scored": st.get("n_scored"), "win20": st.get("win20"), "med_edge20": st.get("med_edge20"),
        "mean_edgeR": st.get("mean_edgeR"), "edgeR_z": st.get("edgeR_z"),
        "verdict": team_record.verdict(st),
        "today_cut": None if cut is None else {k: cut.get(k) for k in
                                               ("n_scored", "win20", "mean_edgeR", "edgeR_z")},
    }


def _compute(dets: list, state: Optional[str]) -> dict:
    from api.services.wisdom.archive import service, setup_map
    from api.services.wisdom.archive.askai import _speaker
    from api.services.wisdom.core import store

    # one hit per (ticker, archive setup): the most confident detection of it
    best: dict = {}
    for sym, pid, direction, conf, det_at in dets:
        setup = setup_map.setup_for_pattern(pid)
        if not setup:
            continue
        key = (sym, setup)
        cur = best.get(key)
        if cur is None or (conf or 0, det_at or 0) > (cur["confidence"] or 0, cur["detected_at"] or 0):
            best[key] = {"ticker": sym, "setup": setup, "pattern_id": pid, "direction": direction,
                         "confidence": conf, "detected_at": det_at}

    hits: list = []
    with store.read() as conn:
        setups: dict = {}
        closest: dict = {}
        history: dict = {}  # per TICKER, not per (ticker, setup): one ticker can map to many setups
        for (sym, setup), h in best.items():
            if setup not in setups:
                try:
                    pb = service.playbook(conn, setup)
                except service.ItemError:
                    pb = None
                setups[setup] = _setup_view(pb, state) if pb else None
                # fetched deep enough that dropping the hit's own ticker still leaves CLOSEST_N
                closest[setup] = _closest(conn, setup, state, limit=CLOSEST_N * 4) if pb else []
            sv = setups[setup]
            if sv is None:
                continue  # a mapped setup the import never carried: nothing to say
            if sym not in history:
                try:
                    history[sym] = (service.ticker_summary(conn, sym), service.last_call(conn, sym))
                except service.ItemError:
                    history[sym] = None
            if history[sym] is None:
                continue
            summary, last = history[sym]
            last_out = None
            if last:
                o = last.get("outcome") or {}
                last_out = {"posted": last.get("posted"), "trader": _speaker(last.get("author_id")),
                            "setup": last.get("setup"), "direction": last.get("direction"),
                            "r20": o.get("r20"), "record_id": last.get("record_id")}
            hits.append({**h, "name": sv["name"], "playbook": sv,
                         "ticker_history": {"n_calls": summary["n_calls"], "n_scored": summary["n_scored"],
                                            "mean_r20": summary["mean_r20"], "last_call": last_out},
                         "closest": [c for c in closest[setup] if c["ticker"] != sym][:CLOSEST_N]})

    def rank(h):
        return (1 if h["ticker_history"]["n_calls"] else 0,
                1 if h["playbook"]["verdict"] == "measured edge" else 0,
                int(h["playbook"]["n_scored"] or 0),
                _num(h["confidence"]) or 0.0)

    hits.sort(key=rank, reverse=True)
    return {"market_state": state, "market_rule": "QQQ close vs its 50/200-day averages",
            "n_detections": len(dets), "n_hits": len(hits), "hits": hits[:MAX_HITS],
            "note": ("The team's archive beside today's scanner hits: measured after the fact, "
                     "display only, not advice. 'Closest' = same setup, same market state, newest first.")}


def _refresh(now: Optional[float] = None) -> Optional[dict]:
    """Compute and cache. Caller holds _COMPUTE. Never raises."""
    try:
        from api.services.wisdom.archive import setup_map

        t = time.time()
        value = _compute(_detections(now), setup_map.market_state())
        with _LOCK:
            _CACHE.update(at=t, value=value)
        return value
    except Exception:  # noqa: BLE001 — a missing scan or store answers None, never an error
        log.exception("[wisdom] archive rhymes failed")
        return None


def _background() -> None:
    try:
        with _COMPUTE:
            with _LOCK:
                fresh = _CACHE["value"] is not None and time.time() - _CACHE["at"] < REFRESH_S
            if not fresh:  # a request may have computed while this thread waited for the lock
                _refresh()
    finally:
        with _LOCK:
            _STATE["refreshing"] = False


def _start_background() -> bool:
    """Start one background refresh unless one is already running. True when one started."""
    with _LOCK:
        if _STATE["refreshing"]:
            return False
        _STATE["refreshing"] = True
    try:
        threading.Thread(target=_background, name="wisdom-rhymes-refresh", daemon=True).start()
    except Exception:  # noqa: BLE001 — a thread that cannot start must not leave the flag set
        with _LOCK:
            _STATE["refreshing"] = False
        log.exception("[wisdom] archive rhymes refresh could not start")
        return False
    return True


def warm() -> None:
    """Compute in the background if nothing usable is cached. Flag-gated; never raises."""
    if not flags.archive_enabled():
        return
    with _LOCK:
        fresh = _CACHE["value"] is not None and time.time() - _CACHE["at"] < REFRESH_S
    if not fresh:
        _start_background()


def today(*, now: Optional[float] = None, force: bool = False) -> Optional[dict]:
    """Today's rhyming hits, or None (flag off, no scan, store unavailable). Never raises."""
    if not flags.archive_enabled():  # the gate first: off touches no store
        return None
    if not force:
        with _LOCK:
            value, age = _CACHE["value"], time.time() - _CACHE["at"]
        if value is not None and age < STALE_MAX_S:
            if age >= REFRESH_S:
                _start_background()
            return value  # served WITHOUT reading the scan
    with _COMPUTE:  # cold, too stale, or forced: concurrent callers wait on ONE compute
        if not force:
            with _LOCK:
                value, age = _CACHE["value"], time.time() - _CACHE["at"]
            if value is not None and age < STALE_MAX_S:
                return value  # another caller computed it while this one waited
        return _refresh(now)


def format_line(payload: Optional[dict], *, limit: int = 5, max_chars: int = 900) -> str:
    """One bounded line for Ask AI: the top rhyming hits, each cited by record id. "" when none."""
    if not payload or not payload.get("hits"):
        return ""
    from api.services.wisdom.archive.askai import _pct

    parts = []
    for h in payload["hits"][:limit]:
        pb = h["playbook"]
        bit = f"{h['ticker']} {pb.get('name') or h['setup']}: team record {pb.get('n_scored') or 0} scored, {pb['verdict']}"
        last = (h.get("ticker_history") or {}).get("last_call")
        if last:
            r20 = _pct(last.get("r20"))
            bit += (f"; team last called {h['ticker']} [{last['trader']} · {(last.get('posted') or '')[:10]}"
                    f" · {last.get('record_id')}]{(' r20 ' + r20) if r20 else ''}")
        parts.append(bit)
    line = ("TODAY'S SCANNER HITS THAT RHYME WITH THE ARCHIVE (market state "
            f"{payload.get('market_state') or 'unknown'}; display only, not advice): " + " | ".join(parts))
    return line[:max_chars]
