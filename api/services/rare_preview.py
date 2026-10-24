"""Rare-pattern admin preview: every live instance the daily scan sees, and the owner's approve / reject verdicts.

Dark: nothing here runs while AUTO_STRUCTURES_RARE_PREVIEW_ENABLED is off (auto_structures.rare_preview_enabled);
the routes answer 404 and the daily scan skips the pass.

WHAT IT IS. Four patterns -- cup without handle, high tight flag, IPO base (drawing round 3), saucer -- are too
rare for more blind 2 x 25 rounds: the held-out pool cannot supply enough fresh cases. Instead the owner reviews
them live. After the nightly pattern universe scan, `record_universe` draws each preview shape on every
scanned ticker (auto_structures.rare_preview_drawings, the same code the admin chart rows use) and records each
instance it sees. The admin page /admin/rare-preview shows every instance on the real chart with Approve /
Reject; a verdict is stored here.

STORAGE. Two tables in the pattern-vision DB (pattern_vision.store.get_db_path, the same file as the gold-set
review), deliberately separate from pattern_detections, the judge's verdicts and its exemplars:
    rare_preview_instances  one row per (pattern, ticker, base start): first / last as-of seen, buy point,
                            the drawing as last seen
    rare_preview_verdicts   append-only owner verdicts; an instance's LATEST verdict is the one that counts

RELEASE RULE (stated here, in docs/feature_flags.json and on the page). A pattern may be released to members
only after AT LEAST RELEASE_MIN_APPROVALS (12) owner approvals AND an approve rate of AT LEAST
RELEASE_MIN_APPROVE_RATE (80%) over its decided instances (latest verdict per instance). Meeting the rule
releases NOTHING: `release_status` only reports it. Release is a LATER commit that sets the pattern's member
literal (auto_structures.MEMBER_<SHAPE>_ROUND) by hand and adds its id to the registry display sets. Nothing in
this module, the scan or the routes writes any of those.
"""
from __future__ import annotations

import json
import logging
import threading
import time

from api.services.pattern_vision import store as _pv

_log = logging.getLogger(__name__)
_WRITE_LOCK = threading.Lock()

#: The release rule. Literals ON PURPOSE: changing either is an owner decision, railed by a test.
RELEASE_MIN_APPROVALS = 12
RELEASE_MIN_APPROVE_RATE = 0.80
#: The verdicts the owner can give.
VERDICTS = ("approve", "reject")
#: Owner notes are capped (the gold-set review's cap).
MAX_NOTE = 2000
#: The scan yields the GIL between tickers (this pass runs on the web pod's scheduler thread at night).
YIELD_EVERY = 25
YIELD_SECONDS = 0.01


def _connect():
    c = _pv.connect()
    c.execute("""CREATE TABLE IF NOT EXISTS rare_preview_instances (
        instance_id TEXT PRIMARY KEY, pattern_id TEXT NOT NULL, ticker TEXT NOT NULL, start_t INTEGER NOT NULL,
        first_asof_t INTEGER, last_asof_t INTEGER, buy_point REAL, label TEXT, drawing_json TEXT,
        seen_count INTEGER DEFAULT 0, first_seen_at INTEGER, last_seen_at INTEGER)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_rpi_pattern ON rare_preview_instances(pattern_id, last_asof_t)")
    c.execute("""CREATE TABLE IF NOT EXISTS rare_preview_verdicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT NOT NULL, pattern_id TEXT NOT NULL,
        verdict TEXT NOT NULL, note TEXT, by_user TEXT, created_at INTEGER)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_rpv_instance ON rare_preview_verdicts(instance_id)")
    return c


def instance_id(pattern_id: str, ticker: str, start_t) -> str:
    """One instance = one base of one pattern on one ticker (the same base seen on later days updates it)."""
    return f"{pattern_id}|{(ticker or '').upper()}|{int(start_t)}"


def record_instance(pattern_id: str, ticker: str, drawing: dict, now=None) -> str:
    """Upsert one seen instance from its drawing (rare_preview_drawings). Returns its instance id."""
    now = int(now if now is not None else time.time())
    iid = instance_id(pattern_id, ticker, drawing["start_t"])
    asof = int(drawing["end_t"])
    with _WRITE_LOCK, _connect() as c:
        c.execute(
            "INSERT INTO rare_preview_instances (instance_id,pattern_id,ticker,start_t,first_asof_t,last_asof_t,"
            "buy_point,label,drawing_json,seen_count,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?) "
            "ON CONFLICT(instance_id) DO UPDATE SET "
            "first_asof_t=MIN(first_asof_t, excluded.first_asof_t), "
            "last_asof_t=MAX(last_asof_t, excluded.last_asof_t), "
            "buy_point=CASE WHEN excluded.last_asof_t >= last_asof_t THEN excluded.buy_point ELSE buy_point END, "
            "label=CASE WHEN excluded.last_asof_t >= last_asof_t THEN excluded.label ELSE label END, "
            "drawing_json=CASE WHEN excluded.last_asof_t >= last_asof_t THEN excluded.drawing_json "
            "ELSE drawing_json END, "
            "seen_count=seen_count + (CASE WHEN excluded.last_asof_t > last_asof_t THEN 1 ELSE 0 END), "
            "last_seen_at=excluded.last_seen_at",
            (iid, pattern_id, (ticker or "").upper(), int(drawing["start_t"]), asof, asof,
             float(drawing["buy_point"]), drawing.get("buy_label") or drawing.get("label"),
             json.dumps(drawing, sort_keys=True), now, now))
        c.commit()
    return iid


def instance_exists(iid: str) -> bool:
    with _connect() as c:
        return c.execute("SELECT 1 FROM rare_preview_instances WHERE instance_id=?", (iid,)).fetchone() is not None


def add_verdict(iid: str, verdict: str, *, note=None, by_user=None, now=None) -> int:
    """Append one owner verdict (approve / reject + optional note). Raises ValueError on a bad verdict, KeyError
    on an unknown instance. Writes ONLY rare_preview_verdicts."""
    if verdict not in VERDICTS:
        raise ValueError("verdict must be one of %s" % (VERDICTS,))
    if note is not None and len(note) > MAX_NOTE:
        raise ValueError("note too long")
    with _WRITE_LOCK, _connect() as c:
        row = c.execute("SELECT pattern_id FROM rare_preview_instances WHERE instance_id=?", (iid,)).fetchone()
        if row is None:
            raise KeyError(iid)
        cur = c.execute(
            "INSERT INTO rare_preview_verdicts (instance_id,pattern_id,verdict,note,by_user,created_at) "
            "VALUES (?,?,?,?,?,?)",
            (iid, row["pattern_id"], verdict, note, by_user, int(now if now is not None else time.time())))
        c.commit()
        return cur.lastrowid


def _latest_verdicts(c) -> dict:
    latest = {}
    for r in c.execute("SELECT * FROM rare_preview_verdicts ORDER BY created_at, id").fetchall():
        latest[r["instance_id"]] = dict(r)
    return latest


def list_instances(pattern_id=None, limit=500) -> list:
    """Instances, newest as-of first, each with its latest verdict (or None) and its drawing."""
    q = "SELECT * FROM rare_preview_instances"
    args: list = []
    if pattern_id:
        q += " WHERE pattern_id=?"
        args.append(pattern_id)
    q += " ORDER BY last_asof_t DESC, instance_id LIMIT ?"
    args.append(int(limit))
    with _connect() as c:
        rows = [dict(r) for r in c.execute(q, args).fetchall()]
        latest = _latest_verdicts(c)
    for r in rows:
        try:
            r["drawing"] = json.loads(r.pop("drawing_json") or "null")
        except ValueError:
            r["drawing"] = None
        r["verdict"] = latest.get(r["instance_id"])
    return rows


def release_rule_met(approved: int, rejected: int) -> bool:
    """The release rule, pure: >= RELEASE_MIN_APPROVALS approvals AND approve rate >= RELEASE_MIN_APPROVE_RATE."""
    decided = approved + rejected
    return (approved >= RELEASE_MIN_APPROVALS and decided > 0
            and approved / decided >= RELEASE_MIN_APPROVE_RATE)


def release_status() -> dict:
    """Per preview pattern: {approved, rejected, decided, approve_rate, rule_met, released}. `released` reports
    whether the pattern's member literal is set TODAY (a later, hand-written commit); `rule_met` never sets it."""
    from api.services import auto_structures as A
    counts = {pid: {"approved": 0, "rejected": 0} for pid in A.RARE_PREVIEW_IDS}
    with _connect() as c:
        for v in _latest_verdicts(c).values():
            pc = counts.get(v["pattern_id"])
            if pc is not None:
                pc["approved" if v["verdict"] == "approve" else "rejected"] += 1
    out = {}
    for pid, pc in counts.items():
        a, r = pc["approved"], pc["rejected"]
        out[pid] = {"approved": a, "rejected": r, "decided": a + r,
                    "approve_rate": round(a / (a + r), 4) if a + r else None,
                    "rule_met": release_rule_met(a, r),
                    "released": A._member_shape_round(pid) is not None,
                    "rule": {"min_approvals": RELEASE_MIN_APPROVALS, "min_approve_rate": RELEASE_MIN_APPROVE_RATE}}
    return out


# ================================================================ the scan
_SCAN_LOCK = threading.Lock()
_scan_state = {"running": False, "started_at": None, "finished_at": None, "scanned": 0, "found": 0,
               "error": None}


def scan_state() -> dict:
    return dict(_scan_state)


def record_universe(symbols, *, bars_fn=None, sleep=time.sleep, now=None) -> dict:
    """Draw every preview shape on each of `symbols` (their latest COMPLETE daily bars) and record every
    instance. Returns {scanned, found, ran}. Reads bars only (bars_sqlite, the same 600 bars the admin chart
    rows read); writes only rare_preview_instances. One pass at a time (a second caller returns ran=False).
    No-op while the flag is off. Yields the GIL every YIELD_EVERY tickers. Never raises."""
    from api.services import auto_structures as A
    if not A.rare_preview_enabled():
        return {"ran": False, "reason": "disabled", "scanned": 0, "found": 0}
    if not _SCAN_LOCK.acquire(blocking=False):
        return {"ran": False, "reason": "a pass is already running", "scanned": 0, "found": 0}
    bars_fn = bars_fn or A._daily_bars
    scanned = found = 0
    _scan_state.update(running=True, started_at=int(time.time()), finished_at=None, scanned=0, found=0,
                       error=None)
    try:
        for k, sym in enumerate(symbols or []):
            try:
                rows = A.rare_preview_rows(sym, bars_fn(sym))
                for r in rows:
                    record_instance(r["pattern_id"], r["sym"], r["geometry"]["extras"]["draw_shape"], now=now)
                    found += 1
            except Exception:  # noqa: BLE001 -- one ticker costs that ticker only
                _log.debug("[rare-preview] %s failed", sym, exc_info=True)
            scanned += 1
            _scan_state.update(scanned=scanned, found=found)
            if (k + 1) % YIELD_EVERY == 0:
                sleep(YIELD_SECONDS)
    except Exception as e:  # noqa: BLE001
        _scan_state["error"] = f"{type(e).__name__}: {e}"
        _log.exception("[rare-preview] pass failed")
    finally:
        _scan_state.update(running=False, finished_at=int(time.time()))
        _SCAN_LOCK.release()
    return {"ran": True, "scanned": scanned, "found": found}


def start_background_pass(symbols) -> bool:
    """Start `record_universe(symbols)` on a daemon thread (the admin-triggered pass). False when a pass is
    already running or the flag is off."""
    from api.services import auto_structures as A
    if not A.rare_preview_enabled() or _scan_state["running"]:
        return False
    threading.Thread(target=record_universe, args=(list(symbols),), name="rare-preview-pass",
                     daemon=True).start()
    return True
