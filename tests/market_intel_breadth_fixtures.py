"""Synthetic breadth world for Market Intelligence and Agent leak tests — NOT a test module.

`synthetic_breadth_world(monkeypatch, sentinel=None, session=LAST_SEALED)` replaces the canonical
breadth functions that `market_intel.breadth_reads` reads (`availability`, `build_breadth_bars`,
`resolve`) with in-memory fakes and forbids sockets. Every value is FAKE.

`sentinel`: when given, EVERY metric's value on `session` is this number — a value no model would
produce, so a leak test can assert it never appears in any later model input (e.g. 73.4567 →
"73.5%" for a percent metric). Shared by tests/test_market_intel_breadth.py and the Agent's
multi-turn leak tests so the two can never drift.
"""
from __future__ import annotations

import socket
import time
from datetime import date, timedelta
from typing import Optional

from api.services import breadth_metrics as bm
from api.services.market_intel import breadth_reads as br

FIRST, LAST_SEALED = "2026-06-01", "2026-10-09"
HOLIDAY, MISSING = "2026-07-03", "2026-08-20"     # no bar on these weekdays
PROVISIONAL = ("2026-10-12", "2026-10-13")         # appended after the sealed watermark (99999 = must never surface)
PROVISIONAL_VALUE = 99999.0


def sessions() -> list[str]:
    d, end, out = date.fromisoformat(FIRST), date.fromisoformat(LAST_SEALED), []
    while d <= end:
        s = d.isoformat()
        if d.weekday() < 5 and s not in (HOLIDAY, MISSING):
            out.append(s)
        d += timedelta(days=1)
    return out


SESSIONS = sessions()


def value(metric: str, i: int) -> float:
    """The synthetic reading of `metric` at session index `i` (always inside the metric's domain)."""
    m = bm.get(metric)
    if m["unit"] == bm.UNIT_PERCENT:
        return round(20.0 + (i * 7 % 60) + 0.25, 2)          # 20.25 … 79.25
    if m["unit"] == bm.UNIT_RATIO:
        return round(0.5 + (i % 9) * 0.25, 2)
    if m["domain"] == bm.DOMAIN_SIGNED:
        return float((i * 37 % 401) - 200)                     # −200 … +200
    return float(100 + (i * 13 % 900))


def bars(metric: str, sentinel: Optional[float] = None, session: str = LAST_SEALED) -> list[dict]:
    rows = []
    for i, s in enumerate(SESSIONS):
        v = sentinel if (sentinel is not None and s == session) else value(metric, i)
        rows.append({"t": s, "o": 0, "h": 0, "l": 0, "c": v})
    rows += [{"t": p, "o": 0, "h": 0, "l": 0, "c": PROVISIONAL_VALUE} for p in PROVISIONAL]
    return rows


def _availability() -> dict:
    return {u: {"state": "available", "rows": len(SESSIONS), "first": FIRST, "last": LAST_SEALED,
                "floor": FIRST, "authority": "breadth-v2" if u == "us" else "exchange-breadth-v1"}
            for u in br.SLICE1_UNIVERSES}


def _metric_for(sym: str) -> str:
    return next(m for m in br.SLICE1_METRICS if sym.endswith(":" + bm.get(m)["code"]))


def synthetic_breadth_world(monkeypatch, sentinel: Optional[float] = None, session: str = LAST_SEALED,
                            forbid_network: bool = True) -> dict:
    # forbid_network=True installs a LOOPBACK-ONLY guard: any non-loopback connect fails the test.
    """Install the fakes; returns a mutable `state` the test can steer:
    avail (per-universe availability rows), unpublished (metric CODES), slow (seconds), raise (bool),
    empty (metric keys with no series), calls (every build_breadth_bars call)."""
    state = {"avail": _availability(), "unpublished": set(), "slow": 0.0, "raise": False,
             "empty": set(), "calls": []}

    def fake_build(sym, tf="D", n=400):
        state["calls"].append((sym, tf, n))
        if state["slow"]:
            time.sleep(state["slow"])
        if state["raise"]:
            raise RuntimeError("store down")
        metric = _metric_for(sym)
        if metric in state["empty"]:
            return {"ticker": sym, "tf": tf, "bars": []}
        return {"ticker": sym, "tf": tf, "bars": bars(metric, sentinel, session)}

    def fake_resolve(sym, published_only=True):
        return None if sym.split(":")[-1] in state["unpublished"] else {"symbol": sym}

    monkeypatch.setattr(br._bs, "availability", lambda: state["avail"])
    monkeypatch.setattr(br._bs, "build_breadth_bars", fake_build)
    monkeypatch.setattr(br._bs, "resolve", fake_resolve)
    monkeypatch.setattr(br._bs, "_et_today", lambda: "2026-10-11")
    if forbid_network:
        install_loopback_only_guard(monkeypatch)
    return state


_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def install_loopback_only_guard(monkeypatch) -> None:
    """Refuse every non-loopback connect. Loopback stays allowed: Windows asyncio builds its
    self-pipe with a 127.0.0.1 socketpair, which a FastAPI TestClient needs (Agent review 2026-10-11)."""
    real_connect, real_create = socket.socket.connect, socket.create_connection

    def _host(address):
        return address[0] if isinstance(address, tuple) and address else address

    def guarded_connect(self, address):
        if self.family == getattr(socket, "AF_UNIX", object()) or _host(address) in _LOOPBACK:
            return real_connect(self, address)
        raise AssertionError(f"breadth reads must not open a network connection ({_host(address)!r})")

    def guarded_create(address, *a, **k):
        if _host(address) in _LOOPBACK:
            return real_create(address, *a, **k)
        raise AssertionError(f"breadth reads must not open a network connection ({_host(address)!r})")

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket, "create_connection", guarded_create)
