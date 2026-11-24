"""THE FIVE 02:xx SCREENER SIDE PULLS: their schedule, their nightly receipts, and the one catch-up a lost fire gets.

THE PULLS (`PULLS`, in nightly order; each its own module's runner, unchanged):
  analyst_pass     02:00  FMP analyst fields, per ticker, to its own 04:45 deadline (`analyst_pass.run_pass`)
  insider_capture  02:40  OpenInsider cluster buys (`insider_capture.run_capture`)
  finviz_universe  02:45  one whole-market Finviz export (`finviz_universe.run_pull`)
  earnings_dates   02:50  FMP earnings calendar, 84 one-day reads (`earnings_dates.run_pull`)
  opt_flow         02:55  the flow-worker's options aggregate from R2 (`opt_flow.run_pull`)
The 03:00 build (`screener_snapshot_nightly`) reads what they wrote. `api/main.py` registers each cron from
`PULLS[name].run_at` (the one copy of its time) and its wrapper runs it through `run_nightly`.

WHY A CATCH-UP. The job store is in memory: a fire that lands while the pod restarts for a deploy is lost (the new
container schedules the NEXT night), so the 03:00 build read yesterday's file and nothing said so.

  * `behind(name)`: the pull's file is older than the night's expected one, the last `run_at` slot (`file_moment`:
    the artifact's write time, or the newest captured / fetched row of the store).
  * `missed(name)`: behind AND no nightly run finished since that slot (`run_nightly` records each run's start and
    end). A nightly that ran and was refused (a short Finviz export, an R2 object missing, a dead scrape) did the
    vendor read: its receipt says so and NOTHING repeats it.
  * `catch_up(name)`: repeats a MISSED read only, ONCE per night at most (its attempt is recorded before the read,
    so a catch-up that fails or is killed is not tried again that night, and a failed one never makes the file
    current), only inside scan_period's quiet span, never across the 03:00 build's start (`CLEARANCE_S`: how long a
    run may take; the analyst pass runs to its own deadline, so it starts only after the build has read its files),
    and never at the same time as its own nightly (`_locks[name]`, which `run_nightly` takes too).
  * `catch_up_all(names)`: the one boot catch-up (`api/main.py`: a DATE job `CATCHUP_BOOT_DELAY_S` after boot). It
    takes the pulls ONE AFTER ANOTHER (nightly order, the analyst pass last), so no two run at once.
  * `build_read()`: the 03:00 build calls it as it reads the side files, and its receipt names every file that was
    stale then (`stats["side_files"]`, printed by the job); the last one is kept here in memory (no disk write on
    the build's path).

Receipts live in `<DATA_DIR>/screener_side_pulls.json` (memory only where there is no data directory). Nothing on a
member's request starts a pull.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import tempfile
import threading
import time
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Pull:
    name: str
    job_id: str
    run_at: tuple
    #: Seconds one run may take, so a catch-up never runs across the build's start; None = the run goes on to its own
    #: deadline (the analyst pass), so its catch-up starts only after the build has read the side files.
    clearance_s: Optional[int]


#: THE SCHEDULE, in nightly order. Clearances: the Finviz export's own request times out at 90 s, the 84 earnings
#: reads run six at a time at 10 s each, the scrape and the R2 read are one request each; the margin is the builder's.
PULLS = {p.name: p for p in (
    Pull("analyst_pass", "screener_analyst_pass", (2, 0), None),
    Pull("insider_capture", "screener_insider_capture", (2, 40), 300),
    Pull("finviz_universe", "screener_finviz_universe", (2, 45), 300),
    Pull("earnings_dates", "screener_earnings_dates", (2, 50), 300),
    Pull("opt_flow", "screener_opt_flow_pull", (2, 55), 180),
)}
#: The order the boot catch-up takes them: the short ones first, the analyst pass (which runs to its deadline) last.
CATCHUP_ORDER = ("insider_capture", "finviz_universe", "earnings_dates", "opt_flow", "analyst_pass")
#: The boot catch-up, this long after registration: after the rating catch-up (300 s) and the patterns catch-up
#: (360 s), before INS CLUSTER's (600 s), so that a pod restarted in the 02:xx pulls can still feed that night's build.
#: Light work (one export, one scrape, 84 small calendar reads, one R2 object), and it runs only when a pull is behind.
CATCHUP_BOOT_DELAY_S = 420
#: After the build starts it reads the side files in its first minutes; a catch-up does not start inside this margin.
BUILD_READ_MARGIN_S = 900
#: The analyst pass's catch-up needs at least this long before the pass's own deadline to be worth starting.
ANALYST_MIN_ROOM_S = 600

DISK_FILE = "screener_side_pulls.json"
DISK_VERSION = 1

_locks = {name: threading.Lock() for name in PULLS}
_store_lock = threading.Lock()
_state: dict = {"loaded": False, "doc": None}


# ── the clock ───────────────────────────────────────────────────────────────────────────────────────

def last_slot(name: str, now: Optional[datetime] = None) -> datetime:
    """The pull's most recent scheduled fire at or before `now` (New York; daily)."""
    from api.services import catchup_slots as cs
    return cs.last_fire(cs.trigger(PULLS[name].run_at), now)


def _now_ts() -> float:
    """The receipts' clock (epoch seconds): the one place this module reads the real time for a record."""
    return time.time()


def _iso(ts: Optional[float]) -> Optional[str]:
    return None if ts is None else datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


def _ts(iso: object) -> Optional[float]:
    try:
        got = datetime.fromisoformat(str(iso))
    except ValueError:
        return None
    return got.timestamp() if got.tzinfo is not None else None


# ── each pull's file and runner (the modules' own paths and entry points) ───────────────────────────

def _mtime(path: str) -> Optional[float]:
    try:
        return os.path.getmtime(path) if path and os.path.exists(path) else None
    except OSError:
        return None


def _max_in(db: str, sql: str) -> Optional[float]:
    if not db or not os.path.exists(db):
        return None
    try:
        with closing(sqlite3.connect(db, timeout=5)) as conn:
            v = conn.execute(sql).fetchone()[0]
    except sqlite3.Error:
        return None
    return float(v) if isinstance(v, (int, float)) else None


def file_moment(name: str) -> Optional[float]:
    """When the pull last wrote what the build reads (epoch seconds), or None when nothing is there. A local read."""
    from api.services.screener import (analyst_pass, earnings_dates, finviz_universe, insider_capture,
                                       opt_flow)
    if name == "finviz_universe":
        return _mtime(finviz_universe._artifact_path())
    if name == "earnings_dates":
        return _mtime(earnings_dates._artifact_path())
    if name == "opt_flow":
        return _mtime(opt_flow._artifact_path())
    if name == "insider_capture":
        return _max_in(insider_capture._db_path(), "SELECT MAX(captured_at) FROM cluster_latest")
    if name == "analyst_pass":
        # the newest fetched row, NOT the run receipt: the pass writes `analyst_runs` only when it ends (it runs on
        # to 04:45), so at the 03:00 build a healthy night's receipt row does not exist yet
        return _max_in(analyst_pass.get_db_path(), "SELECT MAX(fetched_at) FROM analyst_rows")
    raise KeyError(name)


def _runner(name: str) -> Callable[[], dict]:
    from api.services.screener import (analyst_pass, earnings_dates, finviz_universe, insider_capture,
                                       opt_flow)
    return {"analyst_pass": analyst_pass.run_pass, "insider_capture": insider_capture.run_capture,
            "finviz_universe": finviz_universe.run_pull, "earnings_dates": earnings_dates.run_pull,
            "opt_flow": opt_flow.run_pull}[name]


def _outcome(name: str, receipt: object) -> str:
    r = receipt if isinstance(receipt, dict) else {}
    if name == "analyst_pass":
        return "ran"
    if r.get("wrote") or r.get("ok"):
        return "wrote"
    return "refused" + (f": {r['reason']}" if r.get("reason") else "") + (f": {r['error']}" if r.get("error") else "")


def _summary(receipt: object) -> dict:
    """The receipt's plain values only (never the earnings pull's whole row map)."""
    r = receipt if isinstance(receipt, dict) else {}
    return {k: v for k, v in r.items() if v is None or isinstance(v, (bool, int, float, str))}


# ── the receipts (one small JSON file, last good kept) ──────────────────────────────────────────────

def _path() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return os.path.join(base, DISK_FILE) if os.path.isdir(base) else None


def _doc() -> dict:
    """The receipts (read from disk once). Call under `_store_lock`."""
    if not _state["loaded"]:
        _state["loaded"] = True
        got = None
        path = _path()
        if path and os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    got = json.load(fh)
            except (OSError, ValueError):
                got = None
        if not (isinstance(got, dict) and got.get("v") == DISK_VERSION and isinstance(got.get("pulls"), dict)):
            got = {"v": DISK_VERSION, "pulls": {}, "build_read": None}
        _state["doc"] = got
    return _state["doc"]


def _save(doc: dict) -> None:
    path = _path()
    if not path:
        return
    try:
        fd, tmp = tempfile.mkstemp(prefix=".side_pulls_", suffix=".tmp", dir=os.path.dirname(path))
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, sort_keys=True)
        os.replace(tmp, path)
    except OSError as exc:
        log.warning("[side-pulls] receipts not written (%s); kept in memory", type(exc).__name__)


def _record(name: str, kind: str, rec: dict) -> None:
    with _store_lock:
        doc = _doc()
        doc["pulls"].setdefault(name, {})[kind] = rec
        snapshot = json.loads(json.dumps(doc))
    _save(snapshot)


def receipts(name: str) -> dict:
    """{"nightly": {...}, "catch_up": {...}} of one pull (either absent before its first run here)."""
    with _store_lock:
        return json.loads(json.dumps(_doc()["pulls"].get(name) or {}))


def last_build_read() -> Optional[dict]:
    with _store_lock:
        return json.loads(json.dumps(_doc().get("build_read")))


def reset_for_tests() -> None:
    with _store_lock:
        _state.update({"loaded": False, "doc": None})


# ── behind / missed (pure) ──────────────────────────────────────────────────────────────────────────

def behind(name: str, moment: Optional[float], now: Optional[datetime] = None) -> bool:
    """Pure: is the pull's file older than the night's expected one (written before the last slot, or absent)?"""
    return moment is None or moment < last_slot(name, now).timestamp()


def missed(name: str, moment: Optional[float], recs: dict, now: Optional[datetime] = None) -> bool:
    """Pure: behind AND no nightly run of this pull finished since the last slot (so its read never happened)."""
    if not behind(name, moment, now):
        return False
    finished = _ts(((recs or {}).get("nightly") or {}).get("finished_at"))
    return finished is None or finished < last_slot(name, now).timestamp()


def _clear_of_build(name: str, now: datetime, build_at: tuple) -> bool:
    """True when a run of this pull started at `now` can neither be running at a build start nor start inside the
    build's first `BUILD_READ_MARGIN_S` (the minutes it reads the side files)."""
    from api.services import catchup_slots as cs
    pull = PULLS[name]
    if pull.clearance_s is None:
        from api.services.screener import analyst_pass
        ends = analyst_pass._deadline_et(now)
    else:
        ends = now + timedelta(seconds=pull.clearance_s)
    start = cs.last_fire(cs.trigger(build_at), now)
    if start is not None and now < start + timedelta(seconds=BUILD_READ_MARGIN_S):
        return False
    following = cs.next_fire(cs.trigger(build_at), now)
    return following is None or ends <= following


# ── the entries ─────────────────────────────────────────────────────────────────────────────────────

def _run(name: str, kind: str, slot: datetime, source: str) -> dict:
    """One run of the pull under its lock (held by the caller): its attempt recorded first, its end after."""
    rec = {"slot": slot.isoformat(), "source": source, "started_at": _iso(_now_ts()), "finished_at": None,
           "outcome": None, "summary": {}}
    _record(name, kind, rec)
    receipt: dict = {}
    try:
        receipt = _runner(name)() or {}
        rec["outcome"] = _outcome(name, receipt)
    except Exception as exc:  # noqa: BLE001 -- a pull that raises is said; its file stays as it was
        rec["outcome"] = f"failed: {type(exc).__name__}"
        log.warning("[side-pulls] %s %s failed: %s", name, kind, exc)
    rec["finished_at"], rec["summary"] = _iso(_now_ts()), _summary(receipt)
    _record(name, kind, rec)
    return {"outcome": rec["outcome"], "receipt": receipt}


def run_nightly(name: str, now: Optional[datetime] = None) -> dict:
    """THE NIGHTLY ENTRY (`api/main.py`'s wrapper for each cron): the pull's own runner, under its lock (a catch-up
    of the same pull holding it makes this a skip, said), its start and end recorded. Returns the runner's receipt,
    or {"skipped": "running"}."""
    from api.services import catchup_slots as cs
    if not _locks[name].acquire(blocking=False):
        return {"skipped": "running"}
    try:
        return _run(name, "nightly", last_slot(name, cs.as_ny(now)), "nightly")["receipt"]
    finally:
        _locks[name].release()


def catch_up(name: str, *, build_at: tuple, now: Optional[datetime] = None) -> dict:
    """ONE PULL'S CATCH-UP. Returns {"started": bool, "reason": ...}; reasons when nothing starts: current (the file
    is the night's), nightly_ran (the read happened and was refused or failed: not repeated), tried (this night's
    catch-up already ran), not_quiet, build_window (it would run across the build's start or inside its first
    minutes), past_deadline (the analyst pass's own deadline is too near), running (its nightly holds the lock)."""
    from api.services import catchup_slots as cs
    now = cs.as_ny(now)
    slot = last_slot(name, now)
    moment, recs = file_moment(name), receipts(name)
    if not behind(name, moment, now):
        return {"started": False, "reason": "current"}
    if not missed(name, moment, recs, now):
        return {"started": False, "reason": "nightly_ran"}
    tried = (recs.get("catch_up") or {}).get("slot")
    if tried == slot.isoformat():
        return {"started": False, "reason": "tried"}
    if not cs.quiet(now):
        return {"started": False, "reason": "not_quiet"}
    if not _clear_of_build(name, now, build_at):
        return {"started": False, "reason": "build_window"}
    if PULLS[name].clearance_s is None:
        from api.services.screener import analyst_pass
        if analyst_pass._deadline_et(now) - now < timedelta(seconds=ANALYST_MIN_ROOM_S):
            return {"started": False, "reason": "past_deadline"}
    if not _locks[name].acquire(blocking=False):
        return {"started": False, "reason": "running"}
    try:
        out = _run(name, "catch_up", slot, "catch_up")
    finally:
        _locks[name].release()
    return {"started": True, "reason": "behind", "outcome": out["outcome"]}


def catch_up_all(names, *, build_at: tuple, now: Optional[datetime] = None,
                 clock: Callable[[], datetime] = None) -> dict:
    """THE BOOT CATCH-UP (`api/main.py`: a DATE job `CATCHUP_BOOT_DELAY_S` after boot): `catch_up` for each named
    pull (the registered ones), ONE AFTER ANOTHER in `CATCHUP_ORDER`, each deciding at its own turn (`clock`, the
    real time unless a moment is given). Never raises. Returns {name: catch_up's answer}."""
    from api.services import catchup_slots as cs
    clock = clock or (lambda: now if now is not None else cs.now_ny())
    out = {}
    for name in CATCHUP_ORDER:
        if name not in names:
            continue
        try:
            out[name] = catch_up(name, build_at=build_at, now=clock())
        except Exception as exc:  # noqa: BLE001 -- one pull's error never costs the others
            out[name] = {"started": False, "reason": f"error: {type(exc).__name__}"}
            log.warning("[side-pulls] %s catch-up error: %s", name, exc)
    return out


def build_read(now: Optional[datetime] = None) -> dict:
    """FOR THE BUILD (`snapshot_builder`, as it reads the side files): each pull's file time against the night's
    expected one, and the names of the stale ones. Recorded here as the last build read. Never raises.
    {"stale": [names], "files": {name: {"file_at", "expected_from", "stale"}}}."""
    try:
        from api.services import catchup_slots as cs
        now = cs.as_ny(now)
        files = {}
        for name in PULLS:
            moment, slot = file_moment(name), last_slot(name, now)
            files[name] = {"file_at": _iso(moment), "expected_from": slot.isoformat(),
                           "stale": behind(name, moment, now)}
        out = {"stale": [n for n, f in files.items() if f["stale"]], "files": files}
        with _store_lock:     # kept in memory beside the receipts; the build's own stats carry it
            _doc()["build_read"] = {"at": now.isoformat(), **out}
        return out
    except Exception as exc:  # noqa: BLE001 -- the receipt is an aid; it never costs the build
        return {"error": f"{type(exc).__name__}: {exc}"[:200]}
