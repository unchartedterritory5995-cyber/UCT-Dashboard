"""Up Vol / HVC / >7xATR on US / Nasdaq / NYSE, every new session (2026-11-23).

⭐⭐ WHY (owner, 2026-11-23): "set both flags and build the nightly job". The rebuilt series
(`breadth_universe_extras`) is a one-time build that ends where its inputs end (US 2026-11-20;
Nasdaq / NYSE 2026-10-01, where the rebuild's venue ledger stops). This job carries all three
columns forward from there, one session at a time, for as long as the authorities publish.

⭐ HOW EACH SESSION IS MEASURED (no second implementation of anything):
  • the members: the AUTHORITY's own list for that session, so the population is exactly the one
    behind the published `universe_count`:
      us             → US V2's publication provenance (`v2_live_session.provenance.membership.us`)
      nasdaq / nyse  → Exchange Breadth V1's live store (`membership`, status NASDAQ / NYSE)
  • the numbers: the rebuild's own engine (`breadth_universe_extras_engine`: provider day files,
    split + dividend adjusted, `recompute_from_frame` + `atr_ext`). Measured 2026-11-23: it gives
    0 difference vs the rebuilt series on US overlap sessions; bars.db did not (see the engine).
    Nasdaq / NYSE differ from the rebuilt series only by the member list (the authority's own list
    is ~1-2% larger than the rebuild's ledger split), so there is a small seam after 2026-10-01.

⛔ ONLY THE THREE KEYS, ONLY AFTER THE REBUILT SERIES ENDS. A session the rebuilt series holds is
never recomputed here (that series wins in `breadth_universe_extras.values`).
⛔ A session the engine cannot price (coverage below `breadth_live.MIN_LIVE_COVERAGE`) is NOT
written; it stays "n/a" and is retried on a later tick (at most `MAX_ATTEMPTS` per process).
⛔ Never during the regular session (09:00-16:30 ET, weekdays): the work is heavy and waits.

Runs on the web pod when BREADTH_UNIVERSE_EXTRAS=1; BREADTH_UNIVERSE_EXTRAS_FORWARD=0 stops it
(the rows already written keep serving). The store is mirrored to R2 so a fresh volume restores.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sqlite3
import threading
import time
from typing import Optional

VERSION = "universe-extras-forward-v1"
UNIVERSES = ("us", "nasdaq", "nyse")
_DATA = os.environ.get("DATA_DIR", "/data")
STORE_PATH = os.path.join(_DATA, "breadth_universe_extras_forward_v1.json")
R2_KEY = "breadth_universe_extras/forward_v1.json.gz"
MAX_PER_TICK = 150
MAX_ATTEMPTS = 3
TICK_SECONDS = 600
START_DELAY = 300

_lock = threading.Lock()
_tick_lock = threading.Lock()
_view: dict = {}
_attempts: dict = {}
_status: dict = {"started": False, "last_tick": None, "last": None}


def enabled() -> bool:
    from api.services import breadth_universe_extras as uex
    off = os.environ.get("BREADTH_UNIVERSE_EXTRAS_FORWARD", "").strip().lower() in ("0", "false", "no", "off")
    return uex.enabled() and not off


# ── the store ─────────────────────────────────────────────────────────────────
def _write_bytes(body: bytes) -> None:
    os.makedirs(os.path.dirname(STORE_PATH) or ".", exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(body)
    os.replace(tmp, STORE_PATH)


def _restore_from_r2() -> bool:
    try:
        from api.services import data_sync
        raw = data_sync.get_bytes(R2_KEY)
        if not raw:
            return False
        body = gzip.decompress(raw)
        if json.loads(body).get("version") != VERSION:
            return False
        _write_bytes(body)
        return True
    except Exception:
        return False


def _store() -> dict:
    """{"version", "rows": {universe: {date: {key: value}}}, "_token"} — {} when absent."""
    try:
        st = os.stat(STORE_PATH)
    except FileNotFoundError:
        if not _restore_from_r2():
            return {}
        st = os.stat(STORE_PATH)
    key = (st.st_mtime_ns, st.st_size)
    with _lock:
        if _view.get("key") == key:
            return _view["data"]
    with open(STORE_PATH, "rb") as fh:
        raw = fh.read()
    try:
        doc = json.loads(raw)
    except ValueError:
        doc = {}
    if doc.get("version") != VERSION:
        doc = {}
    doc["_token"] = hashlib.sha256(raw).hexdigest()[:12] if doc else ""
    with _lock:
        _view.update(key=key, data=doc)
    return doc


def values(universe: str, date_iso: str) -> Optional[dict]:
    return ((_store().get("rows") or {}).get(universe) or {}).get(date_iso)


def token() -> str:
    s = _store()
    return f"f{s['_token']}" if s.get("rows") else ""


def _save(rows: dict) -> None:
    body = json.dumps({"version": VERSION, "rows": rows,
                       "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                      sort_keys=True, separators=(",", ":")).encode()
    _write_bytes(body)
    try:
        from api.services import data_sync
        data_sync.put_bytes(R2_KEY, gzip.compress(body, mtime=0), "application/gzip")
    except Exception as e:  # noqa: BLE001 - the local store already serves
        print(f"[uex-forward] R2 mirror failed (non-fatal): {type(e).__name__}: {e}")


# ── the authorities' member lists ─────────────────────────────────────────────
def _us_conn():
    from api.services import breadth_authority as ba
    return sqlite3.connect(f"file:{ba.live_replica_path()}?mode=ro", uri=True)


def _exch_conn():
    from api.services import breadth_exchange_authority as ea
    v = ea._view()
    if not v:
        return None
    return sqlite3.connect("file:%s?mode=ro&immutable=1" % v["paths"]["live"], uri=True)


def sessions(universe: str) -> list:
    """Every session the universe's authority holds a member list for."""
    try:
        if universe == "us":
            c = _us_conn()
            try:
                return [r[0] for r in c.execute("SELECT date FROM v2_live_session ORDER BY date")]
            finally:
                c.close()
        c = _exch_conn()
        if c is None:
            return []
        try:
            return [r[0] for r in c.execute(
                "SELECT DISTINCT date FROM membership WHERE upper(status)=? ORDER BY date", (universe.upper(),))]
        finally:
            c.close()
    except Exception:
        return []


def members(universe: str, date_iso: str) -> Optional[list]:
    try:
        if universe == "us":
            c = _us_conn()
            try:
                r = c.execute("SELECT provenance FROM v2_live_session WHERE date=?", (date_iso,)).fetchone()
            finally:
                c.close()
            if not r:
                return None
            return list((json.loads(r[0]).get("membership") or {}).get("us") or []) or None
        c = _exch_conn()
        if c is None:
            return None
        try:
            got = [r[0] for r in c.execute("SELECT ticker FROM membership WHERE date=? AND upper(status)=?",
                                           (date_iso, universe.upper()))]
        finally:
            c.close()
        return got or None
    except Exception:
        return None


# ── measuring ─────────────────────────────────────────────────────────────────
def _calendar() -> list:
    from api.services import breadth_live as bl
    return [bl._iso(int(t)) for (t,) in bl._bars_conn().execute(
        "SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' ORDER BY ts")]


def measure(targets: list, fetch=None, calendar: Optional[list] = None) -> dict:
    """{(universe, date): result} for every target, over ONE frame (the rebuild's engine). Never writes
    the store. A target whose member list, day file or coverage is missing gets {"ok": False, ...}."""
    from api.services import breadth_live as bl
    from api.services import breadth_universe_extras_engine as E
    out, mem = {}, {}
    for u, d in targets:
        m = members(u, d)
        if m:
            mem[(u, d)] = m
        else:
            out[(u, d)] = {"ok": False, "reason": "no authority member list"}
    if not mem:
        return out
    cal = calendar if calendar is not None else _calendar()
    lo, hi = min(d for _, d in mem), max(d for _, d in mem)
    if lo not in cal:
        out.update({k: {"ok": False, "reason": "session not in the calendar"} for k in mem})
        return out
    i0 = max(0, cal.index(lo) - E.LOOKBACK)
    days = {}
    for d in [x for x in cal[i0:] if x <= hi]:
        g = E.grouped_day(d, fetch)
        if g:
            days[d] = g
    span = sorted(days)
    E.prune(cal[max(0, len(cal) - E.KEEP_DAYS)])
    keep = set()
    for m in mem.values():
        keep |= {E.norm(t) for t in m}
    frame, tickers = E.build_frame(span, days, E.splits(span[0], fetch), keep)
    for (u, d), m in mem.items():
        if d not in days:
            out[(u, d)] = {"ok": False, "reason": "no provider day file yet"}
            continue
        r = E.measure(frame, tickers, d, m)
        if r.get("ok") and r["members"] and r["measured"] / r["members"] < bl.MIN_LIVE_COVERAGE:
            r = {"ok": False, "reason": f"coverage {round(r['measured'] / r['members'], 4)}"}
        elif r.get("ok") and not r["values"]:
            r = {"ok": False, "reason": "no value for any key"}
        out[(u, d)] = r
    return out


def pending() -> list:
    """(universe, date) the rebuilt series and this store both lack, oldest first."""
    from api.services import breadth_universe_extras as uex
    base = uex._series().get("rows") or {}
    have = _store().get("rows") or {}
    out = []
    for u in UNIVERSES:
        last = max(base.get(u) or {"": 0})
        for d in sessions(u):
            if d > last and d not in (have.get(u) or {}):
                out.append((d, u))
    return [(u, d) for d, u in sorted(out)]


def _in_session(now=None) -> bool:
    from api.services import breadth_live as bl
    now = now or bl._now_et()
    return now.weekday() < 5 and (9, 0) <= (now.hour, now.minute) < (16, 30)


def tick(now=None, budget: int = MAX_PER_TICK, fetch=None, calendar: Optional[list] = None) -> dict:
    if not enabled():
        return {"ran": False, "reason": "off"}
    if _in_session(now):
        return {"ran": False, "reason": "regular session"}
    if not _tick_lock.acquire(blocking=False):
        return {"ran": False, "reason": "busy"}
    try:
        rows = json.loads(json.dumps(_store().get("rows") or {}))
        todo = [k for k in pending() if _attempts.get(k, 0) < MAX_ATTEMPTS][:budget]
        for k in todo:
            _attempts[k] = _attempts.get(k, 0) + 1
        try:
            res = measure(todo, fetch, calendar) if todo else {}
        except Exception as e:  # noqa: BLE001 - retried next tick
            res = {k: {"ok": False, "reason": f"{type(e).__name__}: {e}"} for k in todo}
        done, refused = [], []
        for (u, d), r in sorted(res.items(), key=lambda x: (x[0][1], x[0][0])):
            if r.get("ok"):
                rows.setdefault(u, {})[d] = r["values"]
                done.append([u, d])
            else:
                refused.append([u, d, r.get("reason")])
        if done:
            _save(rows)
        out = {"ran": True, "written": done, "refused": refused}
        _status.update(last_tick=time.time(), last=out)
        return out
    finally:
        _tick_lock.release()


def status() -> dict:
    return {"enabled": enabled(), **_status, "pending": len(pending()) if enabled() else None}


def start_job() -> bool:
    """Start the loop. Starts NOTHING unless BREADTH_UNIVERSE_EXTRAS is on (and this job not switched off)."""
    if not enabled() or _status.get("started"):
        return False
    _status["started"] = True

    def _run():
        time.sleep(START_DELAY)
        while True:
            try:
                tick()
            except Exception as e:  # noqa: BLE001 - the loop must survive
                print(f"[uex-forward] tick error (non-fatal): {type(e).__name__}: {e}")
            time.sleep(TICK_SECONDS)

    threading.Thread(target=_run, name="breadth_universe_extras_forward", daemon=True).start()
    return True
