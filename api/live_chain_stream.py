"""FT-015 / BRK-01: the streamed option chain, riding the OPRA feed flow-worker already holds.

flow-worker's consumer (`api/massive_ws_worker.py`, PARTNER-OWNED, never edited here) already keeps
two in-process tables, both fed by the ONE Massive OPRA socket it owns:

  * `_RAW_T_HISTORY` {contract: deque[(ts_ns, price)]}: the last 50 prints of EVERY option contract
    that has traded this session (the socket subscribes to `T.*`, all trades).
  * `_nbbo_table` {contract: (bid, ask, ts_ms)}: the live quote for the contracts in its Q pool
    (up to ~950 at once, chosen by where the big flow is, for side classification).

This module READS those two tables (never writes, never subscribes, never opens a socket) and pushes
the rows for one (underlying, expiration) to the browser over SSE, so the chain's Last, Bid and Ask
move between its 60-second polls. What it can and cannot say, stated in every frame:

  * Last: every contract that has printed today, the moment the print reaches flow-worker.
  * Bid / ask: ONLY contracts that are in the Q pool at that moment. A contract outside the pool has
    no streamed quote; the chain keeps its polled quote there and says so. Streaming every quote of
    every chain would need its own quote subscription per contract, which this lane does not open.

Thread safety: the consumer runs on its own thread. A `list(dict)` / `dict.copy()` is one C call
under the GIL, so a snapshot cannot see a half-applied insert; deque indexing is atomic. The
contract index over the print table is built INCREMENTALLY (that dict only grows within a session
and is cleared at session start), so a tick costs the new keys, not the whole table.

Gate: OPTIONS_CHAIN_STREAM_ENABLED (flow-worker env), default OFF, read per request. Off: both
routes answer 404 before identity is read and the chain keeps polling.
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from api.flow_admin_auth import require_flow_user

_TRUE = ("1", "true", "yes", "on")
TICK_SEC = 2.0
HEARTBEAT_SEC = 15.0
MAX_SUBSCRIBERS = int(os.environ.get("OPTIONS_CHAIN_STREAM_MAX_SUBSCRIBERS", "200"))
_SSE_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate",
                "Connection": "keep-alive", "X-Accel-Buffering": "no"}

COVERAGE = ("Last is every print our OPRA feed has seen for that contract today. Bid and ask stream "
            "only for contracts our feed is quoting at that moment (it follows where the big flow "
            "is, up to about 950 contracts market-wide); every other quote is the chain's own "
            "60-second read.")


def is_enabled() -> bool:
    return os.environ.get("OPTIONS_CHAIN_STREAM_ENABLED", "").strip().lower() in _TRUE


# ── the source (the consumer's own tables, read only) ─────────────────────────

def _default_tables():
    from api import massive_ws_worker as mw
    return getattr(mw, "_RAW_T_HISTORY", None), getattr(mw, "_nbbo_table", None)


_tables = _default_tables


def prefix_of(underlying: str, expiration_iso: str) -> Optional[str]:
    """'AAPL', '2026-10-17' -> 'O:AAPL261017' (the OCC root and date, as Massive spells contracts)."""
    u = (underlying or "").strip().upper()
    e = (expiration_iso or "").strip()
    if not u or len(e) != 10 or e[4] != "-" or e[7] != "-":
        return None
    return f"O:{u}{e[2:4]}{e[5:7]}{e[8:10]}"


def _key_of(contract: str) -> Optional[str]:
    """'O:AAPL261017C00200000' -> 'O:AAPL261017'. None when it is not an OCC-shaped option."""
    if not isinstance(contract, str) or not contract.startswith("O:") or len(contract) < 18:
        return None
    tail = contract[-15:]
    if tail[6] not in ("C", "P") or not tail[:6].isdigit() or not tail[7:].isdigit():
        return None
    return contract[:-9]


class _Index:
    """{'O:ROOTYYMMDD': set(contracts)} over the print table, grown from where it left off."""

    def __init__(self):
        self.by_key: dict = {}
        self.n = 0
        self.first = None
        self.ident = None
        self.lock = threading.Lock()

    def update(self, prints: dict) -> None:
        with self.lock:
            keys = list(prints)            # one C call: a consistent snapshot of the key order
            first = keys[0] if keys else None
            if id(prints) != self.ident or len(keys) < self.n or first != self.first:
                self.by_key, self.n = {}, 0  # cleared or replaced: rebuild
            for c in keys[self.n:]:
                k = _key_of(c)
                if k:
                    self.by_key.setdefault(k, set()).add(c)
            self.n, self.first, self.ident = len(keys), first, id(prints)

    def contracts(self, key: str) -> set:
        with self.lock:
            return set(self.by_key.get(key, ()))


_INDEX = _Index()
_CACHE: dict = {}          # key -> (built_at, rows); shared by every viewer of one chain
_SUBS = {"n": 0}


def snapshot(key: str, now: Optional[float] = None) -> dict:
    """{contract: {last, last_ts, bid, ask, quote_ts}} for one 'O:ROOTYYMMDD'. Cached for half a
    tick so N viewers of one chain cost one read."""
    now = now if now is not None else time.monotonic()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < TICK_SEC / 2:
        return hit[1]
    prints, quotes = _tables()
    rows: dict = {}
    if prints is not None:
        _INDEX.update(prints)
        for c in _INDEX.contracts(key):
            h = prints.get(c)
            try:
                ts_ns, px = h[-1]
            except (TypeError, IndexError, ValueError):
                continue
            rows[c] = {"last": px, "last_ts": int(ts_ns // 1_000_000)}
    if quotes is not None:
        for c, q in dict(quotes).items():
            if not c.startswith(key) or _key_of(c) != key:
                continue
            try:
                bid, ask, ts_ms = q
            except (TypeError, ValueError):
                continue
            rows.setdefault(c, {}).update({"bid": bid, "ask": ask, "quote_ts": int(ts_ms)})
    _CACHE[key] = (now, rows)
    if len(_CACHE) > 512:
        for k in sorted(_CACHE, key=lambda k: _CACHE[k][0])[:256]:
            _CACHE.pop(k, None)
    return rows


def diff(prev: dict, cur: dict) -> dict:
    return {c: v for c, v in cur.items() if prev.get(c) != v}


# ── the routes (flow-worker; web forwards /api/live/massive/* through the flow proxy) ──

router = APIRouter(tags=["options-chain-stream"])


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


def _key(sym: str, expiration: str) -> str:
    s = (sym or "").strip().upper()
    if not s or len(s) > 10 or not all(ch.isalnum() or ch == "." for ch in s):
        raise HTTPException(status_code=422, detail="not a ticker symbol")
    k = prefix_of(s.replace(".", ""), expiration)
    if not k:
        raise HTTPException(status_code=422, detail="expiration is YYYY-MM-DD")
    return k


@router.get("/api/live/massive/chain-quotes/{sym}", dependencies=[Depends(_armed)])
def chain_quotes(sym: str, expiration: str = Query(..., max_length=10), _user: dict = Depends(_paid)):
    """One read of the streamed fields for a chain. The client asks this first: 200 means the
    stream is on and worth opening; 404 / 402 mean keep polling."""
    rows = snapshot(_key(sym, expiration))
    return {"symbol": sym.upper(), "expiration": expiration, "quotes": rows,
            "as_of": int(time.time() * 1000), "coverage": COVERAGE, "tick_seconds": TICK_SEC}


@router.get("/api/live/massive/chain-stream/{sym}", dependencies=[Depends(_armed)])
async def chain_stream(request: Request, sym: str, expiration: str = Query(..., max_length=10),
                       _user: dict = Depends(_paid)):
    """SSE: every TICK_SEC, the contracts of this chain whose last / bid / ask moved."""
    key = _key(sym, expiration)
    if _SUBS["n"] >= MAX_SUBSCRIBERS:
        raise HTTPException(status_code=503, detail="The chain stream is at capacity; the chain keeps polling.")
    _SUBS["n"] += 1

    async def gen():
        sent: dict = {}
        last_hb = time.monotonic()
        try:
            yield "event: connected\ndata: " + json.dumps({"coverage": COVERAGE}) + "\n\n"
            while True:
                if await request.is_disconnected():
                    break
                cur = snapshot(key)
                changed = diff(sent, cur)
                if changed:
                    sent.update(changed)
                    yield "data: " + json.dumps({"quotes": changed, "as_of": int(time.time() * 1000)}) + "\n\n"
                    last_hb = time.monotonic()
                elif time.monotonic() - last_hb > HEARTBEAT_SEC:
                    yield "event: heartbeat\ndata: {}\n\n"
                    last_hb = time.monotonic()
                await asyncio.sleep(TICK_SEC)
        finally:
            _SUBS["n"] -= 1

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
