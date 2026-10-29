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
`force=True` still computes now (tests, an explicit refresh). `warm()` starts a background compute.
⛔ After a deploy the first (cold) compute measured MINUTES in production (2026-10-29: >140 s; the
same compute on a local copy of the scan with a production-sized archive took ~5 s, so the cost is
the volume, not the code). So the member route asks with `wait_s`: a cold cache starts the compute in
the background, waits that long, and answers WARMING rather than holding a request open past the
CDN's timeout. Ask AI and Compass keep the blocking default.

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
# At most this many of the MAX_HITS go to one setup: production's 2026-10-29 scan had 12,376 hits,
# and the rank (history first) would fill all 200 with one setup and say nothing about the others.
PER_SETUP_MAX = 25
REFRESH_S = 900           # a cached answer this old is refreshed in the background
STALE_MAX_S = 3 * 3600    # older than this is not served: the request computes (or waits on one)
CACHE_TTL_S = REFRESH_S   # the name older readers know

_LOCK = threading.Lock()          # guards _CACHE and _STATE
_READY = threading.Condition(_LOCK)  # notified whenever a compute stores an answer
_COMPUTE = threading.Lock()       # ONE compute at a time, in a request or in the background
_CACHE: dict = {"at": 0.0, "value": None}
_STATE: dict = {"refreshing": False}

#: today(wait_s=...) returns this when the cache is cold and the background compute has not landed.
WARMING = object()


def clear_cache() -> None:
    with _LOCK:
        _CACHE.update(at=0.0, value=None)


def _internal_ids() -> tuple:
    from api.services.pattern_engine.detectors.registry import INTERNAL_PATTERN_IDS

    return tuple(sorted(INTERNAL_PATTERN_IDS))


def _detections(now: Optional[float] = None) -> list:
    """Active daily detections that map to an archive setup, the BEST one per (sym, pattern_id)
    (highest confidence, then newest): (sym, pattern_id, direction, confidence, detected_at).

    ⛔ Narrowed IN SQL, never in Python (2026-10-29): the window holds ~97k rows on a local copy of
    the scan, and turning each into a Python tuple holds the GIL — production logged the web pod's
    bar stream stalling 3-5 s while this read ran. Filtering to the mapped detectors and keeping one
    row per (sym, pattern_id) returns ~13k rows for the same SQL time (SQLite releases the GIL while
    it scans). _compute's per-(sym, setup) rule is unchanged: it picks among these rows exactly as it
    picked among all of them, because the dropped rows could never win."""
    from api.services.pattern_engine import pattern_db
    from api.services.wisdom.archive import setup_map

    mapped = setup_map.pattern_ids()
    if not mapped:
        return []
    cutoff = int(now if now is not None else time.time()) - WINDOW_SECS
    internal = _internal_ids()
    # ⛔ THE UNARY `+` IS LOAD-BEARING: it takes tf/status/category/pattern_id out of index
    # selection, so the planner walks idx_pd_detected over the 7-day window. Without it SQLite
    # chose idx_pd_status (no ANALYZE stats), whose "active" statuses match most of a table holding
    # MONTHS of detections, and read each ~9 KB row whole: production's stall watchdog caught the
    # refresh thread inside this query for minutes on 2026-10-29. Same rows either way.
    where = (
        f"+tf = 'D' AND +status IN ({','.join('?' * len(ACTIVE_STATUSES))}) AND detected_at >= ? "
        f"AND (+category IS NULL OR +category NOT IN ({','.join('?' * len(EXCLUDED_CATEGORIES))})) "
        f"AND +pattern_id IN ({','.join('?' * len(mapped))})")
    params: list = [*ACTIVE_STATUSES, cutoff, *EXCLUDED_CATEGORIES, *mapped]
    if internal:
        where += f" AND +pattern_id NOT IN ({','.join('?' * len(internal))})"
        params.extend(internal)
    sql = ("SELECT sym, pattern_id, direction, confidence, detected_at FROM ("
           " SELECT sym, pattern_id, direction, confidence, detected_at, ROW_NUMBER() OVER ("
           "  PARTITION BY sym, pattern_id ORDER BY confidence DESC, detected_at DESC) AS rn"
           f" FROM pattern_detections WHERE {where}) WHERE rn = 1")
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
    kept: list = []
    per_setup: dict = {}
    for h in hits:  # rank order kept; a setup stops taking slots once it holds PER_SETUP_MAX
        if len(kept) >= MAX_HITS:
            break
        n = per_setup.get(h["setup"], 0)
        if n < PER_SETUP_MAX:
            per_setup[h["setup"]] = n + 1
            kept.append(h)
    return {"market_state": state, "market_rule": "QQQ close vs its 50/200-day averages",
            "n_detections": len(dets), "n_hits": len(hits), "hits": kept,
            "note": ("The team's archive beside today's scanner hits: measured after the fact, "
                     "display only, not advice. 'Closest' = same setup, same market state, newest first.")}


def _refresh(now: Optional[float] = None) -> Optional[dict]:
    """Compute and cache. Caller holds _COMPUTE. Never raises."""
    try:
        from api.services.wisdom.archive import setup_map

        t = time.time()
        log.info("[wisdom] rhymes refresh: reading the scan")
        dets = _detections(now)
        t_read = time.time()
        log.info("[wisdom] rhymes refresh: %d detections read in %.1fs", len(dets), t_read - t)
        state = setup_map.market_state()
        value = _compute(dets, state)
        log.info("[wisdom] rhymes refresh: %d hits computed in %.1fs (market %s; %.1fs total)",
                 value.get("n_hits", 0), time.time() - t_read, state, time.time() - t)
        with _LOCK:
            _CACHE.update(at=t, value=value)
            _READY.notify_all()
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


def today(*, now: Optional[float] = None, force: bool = False, wait_s: Optional[float] = None):
    """Today's rhyming hits, or None (flag off, no scan, store unavailable). Never raises.

    `wait_s`: on a cold cache, compute in the BACKGROUND and wait at most this long; WARMING if the
    answer has not landed by then. None (the default) computes in this call, as before."""
    if not flags.archive_enabled():  # the gate first: off touches no store
        return None
    if not force:
        with _LOCK:
            value, age = _CACHE["value"], time.time() - _CACHE["at"]
        if value is not None and age < STALE_MAX_S:
            if age >= REFRESH_S:
                _start_background()
            return value  # served WITHOUT reading the scan
        if wait_s is not None:
            _start_background()
            with _READY:
                _READY.wait_for(lambda: _CACHE["value"] is not None and time.time() - _CACHE["at"] < STALE_MAX_S,
                                timeout=max(0.0, float(wait_s)))
                return _CACHE["value"] if _CACHE["value"] is not None else WARMING
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
