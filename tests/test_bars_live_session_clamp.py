"""The extended-session rule on the LIVE path, and the one-off purge (2026-11-25, the follow-up to #2781).

#2781 clamped the serve path. A print at 20:00:05 ET still opened a live 20:00 minute (and a 20:00 60m eth bar) through
`bar_broadcaster._accept_minute`, the REST developing row (`bar_contract._live_partial`) passed it on, and a client kept
it, because a delta answer never deletes a bar. The store also still held the old SPY 60m rows stamped 20:00. Here:
the live gate, the developing row, the one-off purge (one history_rev bump per series), and the case list the client
mirror (`app/src/data/barStore/extendedSession.js`) is pinned to.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch

_ET = ZoneInfo("America/New_York")
_CASES = json.loads((Path(__file__).parent / "fixtures" / "session_clamp_cases.json").read_text(encoding="utf-8"))


def _s(y, mo, d, h, mi, sec=0) -> int:
    return int(datetime(y, mo, d, h, mi, sec, tzinfo=_ET).timestamp())


def _iso(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=_ET).timestamp())


def test_the_case_list_the_client_mirror_shares():
    for sym in _CASES["clamped"]:
        assert bars_fetch.session_clamp_applies(sym), sym
    for sym in _CASES["exempt"]:
        assert not bars_fetch.session_clamp_applies(sym), sym
    for t in _CASES["inside"]:
        assert bars_fetch.in_extended_session(_iso(t)), t
    for t in _CASES["outside"]:
        assert not bars_fetch.in_extended_session(_iso(t)), t


# ── the live gate ────────────────────────────────────────────────────────────────────────────────────────────────

def _drain(q) -> list:
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


@pytest.mark.asyncio
async def test_a_trade_at_20_00_05_opens_no_live_bar_and_19_59_still_does():
    from api.services.bar_broadcaster import BarBroadcaster
    bb = BarBroadcaster()
    q1, q60 = bb.subscribe("SPY", "1"), bb.subscribe("SPY", "60", "eth")
    bb.push_aggregate("SPY", {"t": _s(2026, 11, 11, 19, 59, 30) * 1000, "p": 600.0, "s": 100, "c": []}, "T")
    await asyncio.sleep(0.05)
    got = _drain(q1)
    assert got and got[-1]["bar"]["t"] == _s(2026, 11, 11, 19, 59) * 1000
    _drain(q60)
    bb.push_aggregate("SPY", {"t": _s(2026, 11, 11, 20, 0, 5) * 1000, "p": 613.77, "s": 300, "c": []}, "T")
    bb.push_minute_bar("SPY", {"t": _s(2026, 11, 11, 20, 0) * 1000, "o": 613.77, "h": 613.77, "l": 613.77,
                               "c": 613.77, "v": 300})
    await asyncio.sleep(0.05)
    late = _drain(q1) + _drain(q60)
    assert not [m for m in late if m["bar"]["t"] >= _s(2026, 11, 11, 20, 0) * 1000], late
    assert bb.get_partial("SPY", "60", "eth") is None or bb.get_partial("SPY", "60", "eth")["t"] < _s(2026, 11, 11, 20, 0) * 1000


@pytest.mark.asyncio
async def test_the_gate_opens_at_04_00_and_a_24_hour_name_is_not_gated():
    from api.services.bar_broadcaster import BarBroadcaster
    bb = BarBroadcaster()
    q = bb.subscribe("SPY", "1")
    bb.push_minute_bar("SPY", {"t": _s(2026, 11, 11, 3, 59) * 1000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1})
    bb.push_minute_bar("SPY", {"t": _s(2026, 11, 11, 4, 0) * 1000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1})
    await asyncio.sleep(0.05)
    assert [m["bar"]["t"] for m in _drain(q)] == [_s(2026, 11, 11, 4, 0) * 1000]
    qb = bb.subscribe("BTC-USD", "1")
    bb.push_minute_bar("BTC-USD", {"t": _s(2026, 11, 14, 21, 0) * 1000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1})
    await asyncio.sleep(0.05)
    assert [m["bar"]["t"] for m in _drain(qb)] == [_s(2026, 11, 14, 21, 0) * 1000], "a Saturday night crypto minute"


# ── the REST developing row ──────────────────────────────────────────────────────────────────────────────────────

def test_the_rest_developing_row_is_never_a_20_00_bar(monkeypatch):
    from api.services import bar_broadcaster, bar_contract

    class _B:
        def __init__(self, t):
            self.t = t

        def get_partial(self, sym, tf, session="rth"):
            return {"t": self.t * 1000, "o": 1, "h": 2, "l": 1, "c": 2, "v": 9, "final": False, "trade_ts": self.t * 1000}

    late = _s(2026, 11, 11, 20, 0)
    monkeypatch.setattr(bar_broadcaster, "get_broadcaster", lambda: _B(late))
    assert bar_contract._live_partial("SPY", "5", "eth", "eth-clock", late + 30) is None
    ok = _s(2026, 11, 11, 19, 55)
    monkeypatch.setattr(bar_broadcaster, "get_broadcaster", lambda: _B(ok))
    assert bar_contract._live_partial("SPY", "5", "eth", "eth-clock", ok + 30) is not None
    monkeypatch.setattr(bar_broadcaster, "get_broadcaster", lambda: _B(late))
    assert bar_contract._live_partial("BTC-USD", "5", "eth", "eth-clock", late + 30) is not None


# ── the one-off purge ────────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    from api.services import bars_sqlite as sq
    monkeypatch.setattr(sq, "_DB_PATH", str(tmp_path / "bars.db"))
    sq.bump_db_epoch()
    sq.init_db()
    yield sq
    sq.bump_db_epoch()


def _bar(t, p=10.0):
    return {"t": t, "o": p, "h": p + 0.1, "l": p - 0.1, "c": p, "v": 100}


def test_the_purge_deletes_the_rows_outside_the_session_and_bumps_history_once(store):
    sq = store
    keep60 = [_s(2026, 11, 11, 4, 0), _s(2026, 11, 11, 19, 0)]
    drop60 = [_s(2026, 11, 11, 20, 0)]                              # the SPY 60m row stamped 20:00 ET
    keep5 = [_s(2026, 11, 11, 19, 55)]
    drop5 = [_s(2026, 11, 11, 20, 0), _s(2026, 11, 14, 10, 0)]      # 20:00, and a Saturday
    sq.put_bars("SPY", "60", [_bar(t) for t in keep60 + drop60])
    sq.put_bars("SPY", "5", [_bar(t) for t in keep5 + drop5])
    sq.put_bars("BTC-USD", "60", [_bar(t) for t in drop60])
    before = {tf: sq.series_meta("SPY", tf)["history_rev"] for tf in ("60", "5")}
    assert sq.purge_off_session_intraday("SPY") == 3
    assert [int(r[0]) for r in sq.get_bars_since("SPY", "60", 0)] == keep60
    assert [int(r[0]) for r in sq.get_bars_since("SPY", "5", 0)] == keep5
    after = {tf: sq.series_meta("SPY", tf)["history_rev"] for tf in ("60", "5")}
    assert all(after[tf] != before[tf] for tf in after), (before, after)
    assert sq.purge_off_session_intraday("SPY") == 0, "idempotent"
    assert {tf: sq.series_meta("SPY", tf)["history_rev"] for tf in ("60", "5")} == after, "bumped once"
    assert sq.purge_off_session_intraday("BTC-USD") == 0
    assert [int(r[0]) for r in sq.get_bars_since("BTC-USD", "60", 0)] == drop60


def test_the_purge_runs_in_the_boot_pass_and_marks_itself_clean(store):
    sq = store
    sq.put_bars("SPY", "60", [_bar(_s(2026, 11, 11, 20, 0)), _bar(_s(2026, 11, 11, 19, 0))])
    sq.purge_mis_keyed_weekly_rows()
    assert [int(r[0]) for r in sq.get_bars_since("SPY", "60", 0)] == [_s(2026, 11, 11, 19, 0)]
    assert sq._marker_set(sq._conn(), sq.OFF_SESSION_CLEAN_MARKER)
