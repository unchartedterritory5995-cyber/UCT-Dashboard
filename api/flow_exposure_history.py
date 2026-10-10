"""FT-054: the intraday per-strike exposure store ("positions N minutes ago").

Runs on FLOW-WORKER, where flow.db and the OPRA consumer live. It reads ONLY what flow-worker
already writes: today's classified prints in flow.db (the same rows the tape, Market Tide and the
dealer-positioning attribution read). It opens no socket, subscribes to nothing and never touches
`api/massive_ws_worker.py` (partner-owned).

What it keeps, per (session, symbol, strike), cumulative from the first print it saw today:
  * call_net / put_net: customer-signed contracts (a print at the ask is +, at the bid is -).
  * dealer_gamma: the dealers' side of those prints in gamma dollars per 1% move, computed with the
    house formula (`gex_service.contract_gex`), the opposite sign of the customer: a customer who
    buys leaves the dealer short gamma.
  * prints, unsided (no ask/bid side, left out of the nets), ungreeked (a side but no solvable IV,
    counted into the nets but not into dealer_gamma). A print without the input is COUNTED, never 0.

Durability: every FLOW_EXPOSURE_HISTORY_INTERVAL_MIN minutes (default 5) the strikes that moved
since the last write are written to a bounded SQLite file in flow-worker's data dir
(FLOW_EXPOSURE_HISTORY_DB_PATH, default /data/flow_exposure_history.db). Only CHANGED strikes are
written, so a snapshot costs what the tape did, not the size of the book. A restart reloads the
cumulative state and the flow-id watermark from the file and carries on from there.

Settling: the consumer reclassifies a print's side for up to ~60 s after writing it, so a row is
read only once it is FLOW_EXPOSURE_HISTORY_SETTLE_SEC (default 120 s) old. "Now" is therefore the
tape as of about two minutes ago, and the answer says so.

Retention: today's session plus the one before it. Older sessions are deleted on every rollover.

Gate: FLOW_EXPOSURE_HISTORY_ENABLED, default OFF, read per call. Off: the job does nothing and the
route answers 404 before identity is read.
"""
from __future__ import annotations

import logging
import math
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query

from api.flow_admin_auth import require_flow_user

log = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")
_TRUE = ("1", "true", "yes", "on")
SOURCES = ("stocks", "indexes")

KEEP_SESSIONS = 2
#: Rows read from flow.db per tick. Bounds the CPU one tick can take from the consumer's process
#: (the IV solve is per contract per tick, not per print); a backlog drains over later ticks.
MAX_ROWS_PER_TICK = 20_000
#: Hard ceiling on stored rows per session. Past it the session stops writing and says so.
MAX_ROWS_PER_SESSION = 2_000_000

METHOD = ("Computed by UCT from our own OPRA tape (the prints flow-worker already records): per "
          "strike, customer contracts signed by side (at the ask +, at the bid -), and the dealers' "
          "side of them in gamma dollars per 1% move (gamma x contracts x 100 x spot squared x "
          "0.01, with gamma from Black-Scholes at an IV solved from the print). Summed over every "
          "expiration since the first print we saw today. This is today's flow only, not open "
          "interest: it shows how positioning moved during the session.")


def is_enabled() -> bool:
    return os.environ.get("FLOW_EXPOSURE_HISTORY_ENABLED", "").strip().lower() in _TRUE


def _db_path() -> str:
    return os.environ.get("FLOW_EXPOSURE_HISTORY_DB_PATH", "/data/flow_exposure_history.db")


def _flow_db_path() -> str:
    return os.environ.get("FLOW_DB_PATH", "/data/flow.db")


def interval_sec() -> float:
    try:
        return max(60.0, float(os.environ.get("FLOW_EXPOSURE_HISTORY_INTERVAL_MIN", "5")) * 60.0)
    except ValueError:
        return 300.0


def settle_sec() -> float:
    try:
        return max(0.0, float(os.environ.get("FLOW_EXPOSURE_HISTORY_SETTLE_SEC", "120")))
    except ValueError:
        return 120.0


# ── the store ──────────────────────────────────────────────────────────────────

_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS strike_exposure ("
    " session TEXT NOT NULL, ts INTEGER NOT NULL, symbol TEXT NOT NULL, strike REAL NOT NULL,"
    " call_net INTEGER NOT NULL, put_net INTEGER NOT NULL, dealer_gamma REAL NOT NULL,"
    " prints INTEGER NOT NULL, unsided INTEGER NOT NULL, ungreeked INTEGER NOT NULL,"
    " PRIMARY KEY (session, symbol, strike, ts))",
    "CREATE TABLE IF NOT EXISTS snapshots ("
    " session TEXT NOT NULL, ts INTEGER NOT NULL, flow_id INTEGER NOT NULL, rows INTEGER NOT NULL,"
    " PRIMARY KEY (session, ts))",
)


@contextmanager
def _store(path: Optional[str] = None):
    p = path or _db_path()
    d = os.path.dirname(p)
    if d:
        os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(p, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        for s in _SCHEMA:
            conn.execute(s)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def prune(conn, keep: int = KEEP_SESSIONS) -> int:
    """Delete every session but the `keep` most recent. Returns rows deleted."""
    sessions = [r[0] for r in conn.execute(
        "SELECT DISTINCT session FROM snapshots ORDER BY session DESC")]
    sessions += [r[0] for r in conn.execute(
        "SELECT DISTINCT session FROM strike_exposure") if r[0] not in sessions]
    sessions = sorted(set(sessions), reverse=True)
    gone = sessions[keep:]
    n = 0
    for s in gone:
        n += conn.execute("DELETE FROM strike_exposure WHERE session = ?", (s,)).rowcount
        n += conn.execute("DELETE FROM snapshots WHERE session = ?", (s,)).rowcount
    return n


# ── the maths ──────────────────────────────────────────────────────────────────

def _gamma(spot: float, strike: float, t_days: float, sigma: float, r: float = 0.045) -> Optional[float]:
    if spot <= 0 or strike <= 0 or t_days <= 0 or sigma <= 0:
        return None
    t = t_days / 365.0
    vst = sigma * math.sqrt(t)
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma * sigma) * t) / vst
    return math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (spot * vst)


def _f(v) -> Optional[float]:
    try:
        x = float(str(v).replace(",", "").replace("$", ""))
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _time_days(dte, created_time: str) -> Optional[float]:
    """Calendar days to expiry for the model: the DTE column plus what is left of the print's own
    session (16:00 ET), floored at 15 minutes so a 0DTE print near the bell stays solvable."""
    d = _f(dte)
    if d is None or d < 0:
        return None
    left = 15.0
    try:
        t = datetime.strptime((created_time or "").strip(), "%I:%M:%S %p")
        left = max(15.0, (16 * 60) - (t.hour * 60 + t.minute + t.second / 60.0))
    except ValueError:
        pass
    return d + left / 1440.0


def _side_sign(side: str) -> int:
    s = (side or "").strip().upper()
    if s in ("A", "AA"):
        return 1
    if s in ("B", "BB"):
        return -1
    return 0


def aggregate_rows(rows) -> dict:
    """Fold flow.db rows into per-(symbol, strike) increments.

    rows: dicts with Symbol, CallPut, Strike, ExpirationDate, Volume, Price, Side, Spot, Dte,
    CreatedTime. The IV is solved ONCE per contract per batch, at the contract's last print in the
    batch, and that gamma is applied to the contract's net signed contracts in the batch."""
    from api.bs_iv import implied_vol
    from api.gex_service import contract_gex

    per_contract: dict = {}
    for r in rows:
        sym = (r.get("Symbol") or "").strip().upper()
        cp = (r.get("CallPut") or "").strip().upper()[:1]
        strike = _f(r.get("Strike"))
        vol = _f(r.get("Volume"))
        if not sym or cp not in ("C", "P") or strike is None or vol is None or vol <= 0:
            continue
        key = (sym, cp, strike, (r.get("ExpirationDate") or "").strip())
        c = per_contract.get(key)
        if c is None:
            c = per_contract[key] = {"net": 0, "prints": 0, "unsided": 0, "last": None}
        c["prints"] += 1
        sign = _side_sign(r.get("Side"))
        if sign == 0:
            c["unsided"] += 1
            continue
        c["net"] += sign * int(vol)
        c["last"] = r

    out: dict = {}
    for (sym, cp, strike, _exp), c in per_contract.items():
        inc = out.setdefault((sym, strike), [0, 0, 0.0, 0, 0, 0])
        inc[0 if cp == "C" else 1] += c["net"]
        inc[3] += c["prints"]
        inc[4] += c["unsided"]
        if c["net"] == 0 or c["last"] is None:
            continue
        last = c["last"]
        spot, price = _f(last.get("Spot")), _f(last.get("Price"))
        t_days = _time_days(last.get("Dte"), last.get("CreatedTime"))
        g = None
        if spot and price and t_days:
            iv = implied_vol(price, spot, strike, t_days, cp == "C")
            if iv:
                g = _gamma(spot, strike, t_days, iv)
        if g is None:
            inc[5] += c["prints"] - c["unsided"]
            continue
        # The dealer is on the other side of the customer: customer +n -> dealer -n.
        inc[2] += -contract_gex(g, c["net"], spot)
    return out


# ── the recorder ───────────────────────────────────────────────────────────────

class Recorder:
    """Cumulative per-strike state for one session, its flow-id watermark and its write cadence."""

    def __init__(self, store_path: Optional[str] = None, flow_path: Optional[str] = None):
        self.store_path = store_path
        self.flow_path = flow_path
        self.session: Optional[str] = None
        self.state: dict = {}
        self.dirty: set = set()
        self.last_id = 0
        self.pending: list = []          # [(epoch_s, max_flow_id)] awaiting settle
        self.last_write = 0.0
        self.rows_written = 0
        self.capped = False
        self._lock = threading.Lock()

    # restart survival
    def load(self, session: str) -> None:
        self.session, self.state, self.dirty, self.capped = session, {}, set(), False
        with _store(self.store_path) as c:
            prune(c)
            row = c.execute("SELECT MAX(flow_id) FROM snapshots").fetchone()
            self.last_id = int(row[0] or 0) if row else 0
            for sym, strike, cn, pn, dg, pr, un, ug in c.execute(
                    "SELECT e.symbol, e.strike, e.call_net, e.put_net, e.dealer_gamma, e.prints,"
                    " e.unsided, e.ungreeked FROM strike_exposure e JOIN ("
                    "  SELECT symbol, strike, MAX(ts) AS mts FROM strike_exposure WHERE session = ?"
                    "  GROUP BY symbol, strike) m ON e.symbol = m.symbol AND e.strike = m.strike"
                    " AND e.ts = m.mts WHERE e.session = ?", (session, session)):
                self.state[(sym, strike)] = [cn, pn, dg, pr, un, ug]
            self.rows_written = int(c.execute(
                "SELECT COUNT(*) FROM strike_exposure WHERE session = ?", (session,)).fetchone()[0])
            last = c.execute("SELECT MAX(ts) FROM snapshots WHERE session = ?", (session,)).fetchone()
            self.last_write = float(last[0] or 0) if last else 0.0
        self.pending = []

    def _flow_conn(self):
        conn = sqlite3.connect(self.flow_path or _flow_db_path(), timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def tick(self, now: Optional[datetime] = None, force_write: bool = False) -> dict:
        """One pass: roll the session if the ET date changed, read settled rows, write a snapshot
        when the interval has passed. Returns what it did."""
        with self._lock:
            now = now or datetime.now(_ET)
            now_s = now.timestamp()
            session = now.astimezone(_ET).date().isoformat()
            if session != self.session:
                self.load(session)
            mdy = f"{now.astimezone(_ET).month}/{now.astimezone(_ET).day}/{now.astimezone(_ET).year}"
            ingested = 0
            fc = self._flow_conn()
            try:
                mx = fc.execute("SELECT MAX(id) FROM flow").fetchone()[0] or 0
                self.pending.append((now_s, int(mx)))
                settled = [p for p in self.pending if now_s - p[0] >= settle_sec()]
                if settled:
                    water = max(p[1] for p in settled)
                    self.pending = [p for p in self.pending if now_s - p[0] < settle_sec()]
                    if water > self.last_id:
                        ph = ",".join("?" * len(SOURCES))
                        rows = [dict(r) for r in fc.execute(
                            f"SELECT id, Symbol, CallPut, Strike, ExpirationDate, Volume, Price, Side,"
                            f" Spot, Dte, CreatedTime FROM flow WHERE id > ? AND id <= ?"
                            f" AND source IN ({ph}) AND CreatedDate = ? ORDER BY id LIMIT ?",
                            (self.last_id, water, *SOURCES, mdy, MAX_ROWS_PER_TICK))]
                        if len(rows) >= MAX_ROWS_PER_TICK:
                            new_last = rows[-1]["id"]
                            # a backlog: keep the unread part settled for the next tick
                            self.pending.insert(0, (now_s - settle_sec(), water))
                        else:
                            new_last = water
                        for k, inc in aggregate_rows(rows).items():
                            cur = self.state.setdefault(k, [0, 0, 0.0, 0, 0, 0])
                            for i in range(6):
                                cur[i] += inc[i]
                            self.dirty.add(k)
                        ingested = len(rows)
                        self.last_id = new_last
            finally:
                fc.close()
            wrote = 0
            if force_write or now_s - self.last_write >= interval_sec():
                wrote = self._write(int(now_s))
            return {"session": session, "ingested": ingested, "wrote": wrote,
                    "last_id": self.last_id, "capped": self.capped}

    def _write(self, ts: int) -> int:
        rows = [(self.session, ts, k[0], k[1], v[0], v[1], round(v[2], 2), v[3], v[4], v[5])
                for k, v in ((k, self.state[k]) for k in self.dirty)]
        if self.rows_written + len(rows) > MAX_ROWS_PER_SESSION:
            self.capped = True
            rows = []
        with _store(self.store_path) as c:
            c.executemany("INSERT OR REPLACE INTO strike_exposure VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
            c.execute("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)",
                      (self.session, ts, self.last_id, len(rows)))
        self.rows_written += len(rows)
        self.dirty = set()
        self.last_write = float(ts)
        return len(rows)


_RECORDER: Optional[Recorder] = None


def run_tick() -> Optional[dict]:
    """The scheduler entry point (flow-worker, every 60 s). Does nothing while the gate is off."""
    global _RECORDER
    if not is_enabled():
        return None
    try:
        if _RECORDER is None:
            _RECORDER = Recorder()
        return _RECORDER.tick()
    except Exception as e:  # noqa: BLE001 -- a failed tick is logged; the next one retries
        log.warning("[exposure-history] tick failed: %s", e)
        return None


# ── the read ───────────────────────────────────────────────────────────────────

def read_overlay(symbol: str, minutes_ago: list, now: Optional[datetime] = None,
                 store_path: Optional[str] = None) -> dict:
    """Per-strike exposure now and as it stood N minutes ago, for the latest stored session."""
    sym = symbol.strip().upper()
    now = now or datetime.now(_ET)
    with _store(store_path) as c:
        row = c.execute("SELECT MAX(session) FROM snapshots").fetchone()
        session = row[0] if row else None
        snaps = [r[0] for r in c.execute(
            "SELECT ts FROM snapshots WHERE session = ? ORDER BY ts", (session,))] if session else []
        rows = c.execute(
            "SELECT ts, strike, call_net, put_net, dealer_gamma, prints, unsided, ungreeked"
            " FROM strike_exposure WHERE session = ? AND symbol = ? ORDER BY ts",
            (session, sym)).fetchall() if session else []

    def as_of(t: Optional[int]) -> dict:
        out: dict = {}
        if t is None:
            return out
        for ts, k, cn, pn, dg, pr, un, ug in rows:
            if ts > t:
                break
            out[k] = {"call_net": cn, "put_net": pn, "dealer_gamma": dg, "prints": pr,
                      "unsided": un, "ungreeked": ug}
        return out

    latest = snaps[-1] if snaps else None
    series = [{"label": "now", "minutes_ago": 0, "as_of": _iso(latest), "strikes": as_of(latest)}]
    for m in minutes_ago:
        target = (latest or int(now.timestamp())) - m * 60
        older = [s for s in snaps if s <= target]
        t = older[-1] if older else None
        entry = {"label": f"{m} minutes ago", "minutes_ago": m, "as_of": _iso(t),
                 "strikes": as_of(t)}
        if t is None:
            entry["note"] = (f"No snapshot is {m} minutes older than the latest one yet. "
                             f"History starts at {_iso(snaps[0]) or 'the first snapshot'}.")
        series.append(entry)
    strikes = sorted({k for s in series for k in s["strikes"]})
    return {
        "symbol": sym, "session": session, "label": "computed", "method": METHOD,
        "interval_minutes": round(interval_sec() / 60.0, 2),
        "settle_note": (f"Prints are read once they are {int(settle_sec())} seconds old, after the "
                        "feed has finished correcting their side, so now means the tape as of "
                        "about that long ago."),
        "first_snapshot": _iso(snaps[0]) if snaps else None,
        "strikes": strikes,
        "series": [{**s, "strikes": {str(k): v for k, v in s["strikes"].items()}} for s in series],
        "empty": not rows,
    }


def _iso(ts: Optional[int]) -> Optional[str]:
    return datetime.fromtimestamp(ts, _ET).isoformat() if ts else None


# ── the route (flow-worker; web reaches it through the flow proxy's /api/flow prefix) ──

router = APIRouter(tags=["flow-exposure-history"])


def _armed() -> None:
    if not is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _paid(user: dict = Depends(require_flow_user)) -> dict:
    if user.get("via") == "push_secret":
        return user
    from api.middleware.auth_middleware import is_paid_user
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Options analytics require a paid plan")
    return user


@router.get("/api/flow/exposure-history/{sym}", dependencies=[Depends(_armed)])
def exposure_history(sym: str, ago: str = Query("30,60", max_length=40),
                     _user: dict = Depends(_paid)):
    """FT-054: per-strike intraday exposure now vs N minutes ago. Plain def: SQLite blocks."""
    s = (sym or "").strip().upper()
    if not s or len(s) > 10 or not all(ch.isalnum() or ch in ".-" for ch in s):
        raise HTTPException(status_code=422, detail="not a ticker symbol")
    try:
        mins = sorted({int(x) for x in ago.split(",") if x.strip()})
    except ValueError:
        raise HTTPException(status_code=422, detail="ago is a comma list of minutes")
    if not mins or any(m < 1 or m > 390 for m in mins) or len(mins) > 4:
        raise HTTPException(status_code=422, detail="ago takes 1 to 4 values between 1 and 390")
    try:
        return read_overlay(s, mins)
    except sqlite3.Error as e:
        raise HTTPException(status_code=503, detail=f"The exposure history could not be read: {type(e).__name__}") from e
