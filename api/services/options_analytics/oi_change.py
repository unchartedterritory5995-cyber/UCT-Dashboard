"""OIC: one stock's open interest, contract by contract, against the session before.

WHERE THE DATA COMES FROM
  Our own options log. `api/services/research/options_screener.py` already turns each logged
  session's contracts file into `options_log/<YYYY>/<date>.screen.sqlite.gz` in R2 (the
  terminal-next-monitor job `options-screen`, weekdays 16:30 ET): one row per contract that has
  an ask, open interest or volume, with `oi` and `vol`, indexed by underlying. This module reads
  the TWO newest of those files and nothing else. No vendor call, no flow-worker read.

WHAT A SESSION'S FILE HOLDS
  Open interest is a once-a-day clearing-house figure, published the morning AFTER the session
  it counts. So the file logged on day D holds the positions as they stood at the close of the
  session before D, and "file D against file D-1" is what was opened or closed DURING session
  D-1. The traded volume that belongs beside that change is therefore the EARLIER file's volume
  (session D-1's own), never the newer file's.

THE REQUEST PATH NEVER FETCHES A FILE (builder rule 5)
  A screen file is ~50 MB gzipped / ~160 MB opened. The first read after a new session lands
  has to mirror one or two of them, so that work runs in ONE background thread: the request
  answers `computing` (or keeps serving the pair it already holds) and the panel asks again.
  The held pair lives in this module. Once both files are on disk a stock's read is two
  indexed lookups (milliseconds) and is kept per (pair, stock). What is kept is the rows an
  answer can carry (`MAX_ROWS` per side) and the counts, never every contract: an index
  fund has thousands of contracts, and the answers of `ANSWERS_KEPT` stocks are held at once.

DISK
  The screener's own store keeps ONE session on disk and deletes any other the moment it
  fetches a newer one, so the earlier session is mirrored into this module's OWN directory
  (one file, the older one evicted) and the newest is read from the screener's store, which
  both features share.

HONEST LIMITS, CARRIED IN THE ANSWER
  * A contract that is in the newer file and not in the earlier one is `new`: it has no
    earlier figure, so it carries no change and no percent, and it is left out of the totals.
  * A contract with no open interest reported on either side is counted, never read as 0.
  * A contract in the earlier file and not the newer one (expired, or no longer quoted) is
    counted with its open interest, and left out of the totals.
  * Trading sessions between the two files that have no file are named (`skipped_sessions`).
  * Nothing here says who opened or closed, or in which direction.

Gate: the route (`api/routers/options_screener.py`) sits behind the screener's own switch and
paid dependency. This module adds no switch.
"""
from __future__ import annotations

import datetime as _dt
import gzip
import os
import shutil
import sqlite3
import tempfile
import threading
import time
from collections import OrderedDict
from typing import Optional

from api.services.research import options_screener as osc

#: The most rows one answer carries (the panel draws fewer at first). The rest are counted.
MAX_ROWS = 50
#: How long a request waits for the one background build before it answers `computing`.
WAIT_S = 2.0
#: How long the held pair is served before the listing is looked at again (in the background).
RECHECK_S = 600.0
#: After a failed build, how long requests are told so before another build is tried.
ERROR_HOLD_S = 30.0
#: Stocks whose computed answer is kept for the held pair.
ANSWERS_KEPT = 128
SIDES = ("any", "call", "put")
SOURCE = ("UCT options log (the vendor's end-of-day options snapshot, recorded once a trading "
          "day after the close)")
COVERAGE = ("Every listed contract of the stock that had an ask, open interest or volume in the "
            "day's log. Contracts with none of the three are not in the log's screen file.")


class BadQuery(ValueError):
    """A ticker or side that cannot be read; the route answers 422 with the words."""


def cache_dir() -> str:
    return os.path.join(tempfile.gettempdir(), "uct_options_oi_change")


# ── the two files ───────────────────────────────────────────────────────────────

def _mirror_earlier(session: str, root: Optional[str] = None) -> str:
    """The earlier session's screen file, opened, in this module's own directory. Fetched from
    R2 once per session; any other session's file in the directory is removed."""
    from api import flow_backup
    root = root or cache_dir()
    os.makedirs(root, exist_ok=True)
    db = os.path.join(root, f"{session}.screen.sqlite")
    if not os.path.exists(db):
        client, bucket = flow_backup._r2_client(), flow_backup._bucket()
        if client is None or not bucket:
            raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
        gz = db + ".gz"
        client.download_file(bucket, osc.derived_keys(session)["screen"], gz + ".part")
        os.replace(gz + ".part", gz)
        with gzip.open(gz, "rb") as src, open(db + ".part", "wb") as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        os.replace(db + ".part", db)
        os.remove(gz)
    keep = os.path.basename(db)
    for name in os.listdir(root):
        if name != keep:
            try:
                os.remove(os.path.join(root, name))
            except OSError:
                pass
    return db


def _skipped(earlier: str, newer: str) -> list:
    """Trading sessions strictly between the two files. Each one has no screen file."""
    from api.services import session_calendar
    out, d, end = [], _dt.date.fromisoformat(earlier), _dt.date.fromisoformat(newer)
    try:
        while True:
            d += _dt.timedelta(days=1)
            if d >= end:
                break
            if session_calendar.is_trading_day(d):
                out.append(d.isoformat())
    except Exception:  # noqa: BLE001 -- past the calendar's horizon: name none rather than guess
        return []
    return out


def prepare(store=None) -> dict:
    """BLOCKING (lists R2, may download and open up to two screen files). Runs only in the
    background build and in tests. Returns the pair to hold."""
    store = store or osc.get_store()
    sessions = sorted(store.screen_sessions())
    if not sessions:
        return {"status": "no_sessions"}
    newer = sessions[-1]
    if len(sessions) < 2:
        return {"status": "one_session", "session": newer}
    earlier = sessions[-2]
    newer_path = store.screen_db(newer)
    if isinstance(store, osc.R2Store):
        earlier_path = _mirror_earlier(earlier)
    else:
        earlier_path = store.screen_db(earlier)
    if newer_path is None or earlier_path is None:
        raise RuntimeError("a screen file of the options log could not be read")
    return {"status": "ok", "session": newer, "prior_session": earlier,
            "path": newer_path, "prior_path": earlier_path,
            "skipped_sessions": _skipped(earlier, newer)}


# ── one background build, the pair held here ────────────────────────────────────

_lock = threading.Lock()
_held: Optional[dict] = None
_held_at = 0.0
_inflight: Optional[threading.Event] = None
_failed: Optional[tuple] = None          # (monotonic seconds, the exception's type name)
_answers: "OrderedDict[tuple, dict]" = OrderedDict()
builds_started = 0                        # read by the tests: one build, however many requests


def reset() -> None:
    """Tests only: forget the held pair, any failure and every kept answer."""
    global _held, _held_at, _inflight, _failed, builds_started
    with _lock:
        _held, _held_at, _inflight, _failed, builds_started = None, 0.0, None, None, 0
        _answers.clear()


def _build_bg(store, done: threading.Event) -> None:
    global _held, _held_at, _inflight, _failed
    try:
        pair = prepare(store)
        with _lock:
            if _held is None or (_held.get("session"), _held.get("prior_session")) != (
                    pair.get("session"), pair.get("prior_session")):
                _answers.clear()
            _held, _held_at, _failed = pair, time.monotonic(), None
    except Exception as e:  # noqa: BLE001 -- held by name for ERROR_HOLD_S, then tried again
        with _lock:
            _failed = (time.monotonic(), type(e).__name__)
    finally:
        with _lock:
            _inflight = None
        done.set()


def _pair(store, wait_s: float) -> dict:
    """The held pair; `computing` while the first build runs; `unavailable` after a failed one.
    Starts at most ONE background build, and only when nothing fresh is held."""
    global _inflight, builds_started
    now = time.monotonic()
    with _lock:
        held = _held
        fresh = held is not None and now - _held_at < RECHECK_S
        failed = _failed if (_failed and now - _failed[0] < ERROR_HOLD_S) else None
        if not fresh and _inflight is None and failed is None:
            _inflight = threading.Event()
            builds_started += 1
            threading.Thread(target=_build_bg, args=(store, _inflight), daemon=True,
                             name="options-oi-change").start()
        waiting = _inflight
    if held is not None:
        return held                       # the last pair keeps answering while the listing is re-read
    if failed is not None:
        return {"status": "unavailable", "error": failed[1]}
    if waiting is not None:
        waiting.wait(wait_s)
    with _lock:
        if _held is not None:
            return _held
        if _failed is not None:
            return {"status": "unavailable", "error": _failed[1]}
    return {"status": "computing"}


def _drop_held() -> None:
    global _held, _held_at
    with _lock:
        _held, _held_at = None, 0.0
        _answers.clear()


# ── one stock ───────────────────────────────────────────────────────────────────

def _read(path: str, sym: str) -> tuple:
    """(rows by contract, file meta) for one underlying from one screen file."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = {r[0]: r for r in con.execute(
            "SELECT contract, exp, cp, strike_m, oi, vol FROM contracts WHERE underlying = ?", (sym,))}
        meta = dict(con.execute("SELECT k, v FROM meta").fetchall())
    finally:
        con.close()
    return rows, meta


def _iso(exp: int) -> str:
    return f"{exp // 10000:04d}-{exp // 100 % 100:02d}-{exp % 100:02d}"


def _side() -> dict:
    return {"contracts": 0, "oi": 0, "prior_oi": 0, "change": 0}


def compute(sym: str, pair: dict) -> dict:
    """Everything one stock's answer needs: the changed and new contracts ranked, cut to the
    `MAX_ROWS` biggest for each side, and counted in full. Pure over the two files."""
    cur, meta = _read(pair["path"], sym)
    prev, prev_meta = _read(pair["prior_path"], sym)
    newer_day = int(pair["session"].replace("-", ""))
    volume_present = prev_meta.get("volume_present") == "1"
    totals = {"C": _side(), "P": _side()}
    new = {"contracts": 0, "oi": 0}
    not_reported = unchanged = 0
    ranked = []
    for contract, (_, exp, cp, strike_m, oi, _vol) in cur.items():
        before = prev.get(contract)
        base = {"contract": contract, "expiration": _iso(exp), "strike": strike_m / 1000,
                "type": "call" if cp == "C" else "put", "oi": oi}
        if before is None:
            if oi is None:
                not_reported += 1
            elif oi > 0:
                new["contracts"] += 1
                new["oi"] += oi
                ranked.append((oi, contract, {**base, "kind": "new", "prior_oi": None,
                                              "change": None, "change_pct": None, "volume": None}))
            continue
        prior_oi, vol = before[4], before[5]
        if oi is None or prior_oi is None:
            not_reported += 1
            continue
        t = totals[cp]
        t["contracts"] += 1
        t["oi"] += oi
        t["prior_oi"] += prior_oi
        t["change"] += oi - prior_oi
        change = oi - prior_oi
        if change == 0:
            unchanged += 1
            continue
        ranked.append((abs(change), contract, {
            **base, "kind": "change", "prior_oi": prior_oi, "change": change,
            "change_pct": round(change / prior_oi * 100, 1) if prior_oi > 0 else None,
            "volume": vol if volume_present else None}))
    gone = {"contracts": 0, "prior_oi": 0, "expired": 0}
    for contract, before in prev.items():
        if contract in cur:
            continue
        gone["contracts"] += 1
        gone["prior_oi"] += before[4] or 0
        gone["expired"] += before[1] < newer_day      # its last day was before the newer session
    ranked.sort(key=lambda t: (-t[0], t[1]))
    every = [r for _, _, r in ranked]
    by_side = {"any": every,
               "call": [r for r in every if r["type"] == "call"],
               "put": [r for r in every if r["type"] == "put"]}
    return {"known": bool(cur or prev), "prior_has_symbol": bool(prev), "has_symbol": bool(cur),
            "rows": {k: v[:MAX_ROWS] for k, v in by_side.items()},
            "matched": {k: len(v) for k, v in by_side.items()},
            "summary": {"call": totals["C"], "put": totals["P"],
                        "contracts": totals["C"]["contracts"] + totals["P"]["contracts"],
                        "unchanged": unchanged},
            "new": new, "gone": gone, "not_reported": not_reported,
            "volume_present": volume_present, "built_at": meta.get("built_at")}


def normalize(sym: str, side: Optional[str]) -> tuple:
    s = str(sym or "").strip().upper()
    if not osc._SYM.match(s):
        raise BadQuery(f"not a ticker symbol: {s[:12] or '(empty)'}")
    sd = str(side or "any").strip().lower()
    if sd not in SIDES:
        raise BadQuery("side must be call, put or any")
    return s, sd


def oi_change(sym: str, side: Optional[str] = None, *, store=None, wait_s: Optional[float] = None) -> dict:
    """One stock's answer. Never fetches a file on the request (see the module docstring)."""
    s, sd = normalize(sym, side)
    wait_s = WAIT_S if wait_s is None else wait_s
    base = {"symbol": s, "side": sd, "source": SOURCE, "coverage": COVERAGE, "max_rows": MAX_ROWS}
    pair = _pair(store, wait_s)
    if pair["status"] != "ok":
        return {**base, **{k: v for k, v in pair.items() if k in ("status", "session", "error")}}
    key = (pair["session"], pair["prior_session"], s)
    with _lock:
        got = _answers.get(key)
        if got is not None:
            _answers.move_to_end(key)
    if got is None:
        try:
            got = compute(s, pair)
        except (sqlite3.Error, OSError):
            # A held file is gone (a newer session landed and the screener's store replaced it).
            # Forget the pair; the next request starts one build for the new pair.
            _drop_held()
            return {**base, "status": "computing"}
        with _lock:
            _answers[key] = got
            while len(_answers) > ANSWERS_KEPT:
                _answers.popitem(last=False)
    return _answer(base, pair, got, sd)


def _answer(base: dict, pair: dict, got: dict, sd: str) -> dict:
    """The `ok` answer for one side, from the held pair and one stock's computed record."""
    rows = got["rows"][sd]
    return {**base, "status": "ok", "session": pair["session"], "prior_session": pair["prior_session"],
            "skipped_sessions": pair["skipped_sessions"], "known": got["known"],
            "has_symbol": got["has_symbol"], "prior_has_symbol": got["prior_has_symbol"],
            "rows": rows, "matched": got["matched"][sd], "shown": len(rows),
            "summary": got["summary"], "new": got["new"], "gone": got["gone"],
            "not_reported": got["not_reported"], "volume_present": got["volume_present"],
            "volume_session": pair["prior_session"], "built_at": got["built_at"]}


def held_change(sym: str, side: Optional[str] = None) -> tuple:
    """READ ONLY: `(answer, how)` from the pair this module ALREADY holds. It never starts the
    background build, never waits on one, never lists or downloads a file, never drops the held
    pair and changes no module state (it does not even keep the answer it computes). The held
    pair answers whatever its age: this never looks for a newer session.

    how: 'held'      the answer `oi_change` would give from the held pair (status 'ok',
                     'no_sessions' or 'one_session')
         'not_held'  no pair is held (no request has prepared one on this pod); answer None
         'failed'    no pair is held and the last build failed; the answer is the `unavailable`
                     one, with the exception's class name
         'file_gone' a pair is held but one of its two files could not be read; answer None
    Raises BadQuery for a symbol or a side that is not one."""
    s, sd = normalize(sym, side)
    base = {"symbol": s, "side": sd, "source": SOURCE, "coverage": COVERAGE, "max_rows": MAX_ROWS}
    with _lock:
        pair, failed = _held, _failed
        got = None
        if pair is not None and pair.get("status") == "ok":
            got = _answers.get((pair["session"], pair["prior_session"], s))
    if pair is None:
        if failed is not None:
            return {**base, "status": "unavailable", "error": failed[1]}, "failed"
        return None, "not_held"
    if pair.get("status") != "ok":
        return {**base, **{k: v for k, v in pair.items() if k in ("status", "session", "error")}}, "held"
    if got is None:
        try:
            got = compute(s, pair)
        except (sqlite3.Error, OSError):
            return None, "file_gone"
    return _answer(base, pair, got, sd), "held"
