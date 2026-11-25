"""The live store's proof is PER TICKER, never the market's watermark alone (2026-11-25 wide sweep, review).

On jumps, REST answers lacked the minute that had just closed 24 s after the close while the push stream had it,
and the tail was stamped `current`: `verified_through` came from `bars_live_store.proven_through_s(t, "1")`, the
MARKET-WIDE watermark + 60 s. That watermark says the stream delivered that minute for the market, not that THIS
ticker's minute (a late AM aggregate) is in the store. Now a covered ticker is proven through:
  * the end of its own newest row this tier wrote (its minute landed: a liquid name proves itself at once), or
  * `now - LIVE_LATE_S` (a minute that closed that long ago with nothing delivered for the ticker had no trade),
whichever is later, and never past the market's watermark. All data synthetic.
"""
import sqlite3
import time as _real_time
import types
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch, bars_live_store as bls, bars_sqlite

_ET = ZoneInfo("America/New_York")


def M(hh, mm, ss=0) -> int:
    return int(datetime(2026, 11, 10, hh, mm, ss, tzinfo=_ET).timestamp())


E1 = M(9, 7, 30) * 1000
FFB = M(9, 10)


def _row(sym, t, o=10.0, h=11.0, l=9.0, c=10.5, v=100):
    return [sym, t, o, h, l, c, v]


class _Clock:
    def __init__(self, monkeypatch):
        self.now = M(10, 7, 30)
        fake = types.SimpleNamespace(**{k: getattr(_real_time, k) for k in dir(_real_time) if not k.startswith("__")})
        fake.time = lambda: float(self.now)
        monkeypatch.setattr(bls, "time", fake)
        reads = types.SimpleNamespace(**{k: getattr(_real_time, k) for k in dir(_real_time) if not k.startswith("__")})
        reads.time = lambda: float(self.now)
        monkeypatch.setattr(bars_fetch, "_time", reads)
        clock = self

        class _DT(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime.fromtimestamp(clock.now, tz)

            @classmethod
            def utcnow(cls):
                return datetime.utcfromtimestamp(clock.now)
        monkeypatch.setattr(bls, "datetime", _DT)
        monkeypatch.setattr(bars_fetch, "datetime", _DT)


@pytest.fixture
def live(monkeypatch, tmp_path):
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setenv("BARS_LIVE_1M_ENABLED", "1")
    db = sqlite3.connect(str(tmp_path / "bars.db"), check_same_thread=False)
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: db)
    state = {"gate": None}

    def _many(tf, by):
        n = sum(len(v) for v in by.values())
        return n if state["gate"] is None else state["gate"](tf, by, n)
    monkeypatch.setattr(bars_sqlite, "put_bars_many", _many)
    monkeypatch.setattr(bars_sqlite, "put_bars", lambda s, tf, bars: len(bars))
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda s, tf: None)
    clock = _Clock(monkeypatch)
    bls._reset_for_tests()
    bars_fetch.set_request_interactive(True)
    yield types.SimpleNamespace(clock=clock, state=state)
    bars_fetch.set_request_interactive(False)
    bls._reset_for_tests()


def _push(m1=(), wm=None, seq=1, rows=()):
    p = {"epoch_ms": E1, "seq": seq, "first_full_bucket_ms": FFB * 1000, "watermark_ms": wm,
         "rows": [list(r) for r in rows], "minutes": [], "m1": [list(r) for r in m1]}
    return bls.ingest(p)


def _begin(*syms, five=False):
    """Open the epoch (its first push), then cover `syms` (a new epoch uncovers every ticker)."""
    _push(m1=[], wm=M(10, 0) * 1000, seq=1)
    for s_ in syms:
        (bls._covered5 if five else bls._covered1).add(s_)


def test_a_covered_names_own_minute_not_delivered_yet_is_not_proven_by_the_markets_watermark(live):
    _begin("AAA", "BBB")
    live.clock.now = M(10, 7, 3)
    _push(m1=[_row("AAA", M(10, 6)), _row("BBB", M(10, 6))], wm=M(10, 6) * 1000, seq=2)
    live.clock.now = M(10, 8, 24)                              # 24 s after 10:07 closed
    _push(m1=[_row("BBB", M(10, 7))], wm=M(10, 7) * 1000, seq=3)   # the market's 10:07 is in; AAA's is not yet
    assert bls.proven_through_s("BBB", "1") == M(10, 8)        # BBB's own minute landed: proven at once
    got = bls.proven_through_s("AAA", "1")
    assert got is not None and got < M(10, 8), "the market's watermark vouched for AAA's 10:07, not in the store"
    assert got == M(10, 8, 24) - 30                            # through now - LIVE_LATE_S, no further
    assert bls.LIVE_LATE_S == 30


def test_its_own_minute_landing_proves_it_at_once(live):
    _begin("AAA", "BBB")
    live.clock.now = M(10, 8, 24)
    _push(m1=[_row("BBB", M(10, 7))], wm=M(10, 7) * 1000, seq=2)
    _push(m1=[_row("AAA", M(10, 7))], wm=M(10, 7) * 1000, seq=3)
    assert bls.proven_through_s("AAA", "1") == M(10, 8)


def test_a_thin_name_with_no_print_is_proven_live_late_s_after_the_minute_closed(live):
    _begin("AAA", "BBB")
    live.clock.now = M(10, 6, 3)
    _push(m1=[_row("AAA", M(10, 5)), _row("BBB", M(10, 5))], wm=M(10, 5) * 1000, seq=2)
    live.clock.now = M(10, 8, 10)
    _push(m1=[_row("BBB", M(10, 7))], wm=M(10, 7) * 1000, seq=3)
    assert bls.proven_through_s("AAA", "1") == M(10, 7, 40)    # 10:07 closed 10 s ago: not proven yet
    live.clock.now = M(10, 8, 30)
    assert bls.proven_through_s("AAA", "1") == M(10, 8)        # 30 s on, nothing came: no trade, proven
    live.clock.now = M(10, 8, 50)
    assert bls.proven_through_s("AAA", "1") == M(10, 8)        # never past the market's watermark


def test_the_tail_one_short_of_a_late_minute_is_unproven_in_the_tail_status(live):
    _begin("AAA", "BBB")
    live.clock.now = M(10, 7, 3)
    _push(m1=[_row("AAA", M(10, 6)), _row("BBB", M(10, 6))], wm=M(10, 6) * 1000, seq=2)
    live.clock.now = M(10, 8, 24)
    _push(m1=[_row("BBB", M(10, 7))], wm=M(10, 7) * 1000, seq=3)
    st = bars_fetch.intraday_tail_status("AAA", "1", M(10, 6), now=M(10, 8, 24), session="rth")
    assert st["tail_status"] == "current" and st.get("tolerance_unproven") is True, st   # the router answers unverified
    st = bars_fetch.intraday_tail_status("BBB", "1", M(10, 7), now=M(10, 8, 24), session="rth")
    assert st["tail_status"] == "current" and not st.get("tolerance_unproven"), st


def test_5m_the_same_rule(live):
    live.clock.now = M(10, 6, 3)
    _begin("AAA", "BBB", five=True)
    _push(rows=[_row("AAA", M(10, 0)), _row("BBB", M(10, 0))], wm=M(10, 4) * 1000, seq=2)
    live.clock.now = M(10, 10, 20)                             # the 10:05 bucket closed 20 s ago
    _push(rows=[_row("BBB", M(10, 5))], wm=M(10, 9) * 1000, seq=3)
    assert bls.proven_through_s("BBB", "5") == M(10, 10)
    assert bls.proven_through_s("AAA", "5") == M(10, 10, 20) - 30
    live.clock.now = M(10, 10, 31)
    assert bls.proven_through_s("AAA", "5") == M(10, 10)


def test_a_row_the_store_did_not_take_proves_nothing(live):
    _begin("AAA", "BBB")
    live.clock.now = M(10, 7, 3)
    _push(m1=[_row("AAA", M(10, 6)), _row("BBB", M(10, 6))], wm=M(10, 6) * 1000, seq=2)
    live.state["gate"] = lambda tf, by, n: n - 1               # the impossible-bar gate refused one row
    live.clock.now = M(10, 8, 5)
    _push(m1=[_row("AAA", M(10, 7)), _row("BBB", M(10, 7))], wm=M(10, 7) * 1000, seq=3)
    assert bls.proven_through_s("AAA", "1") < M(10, 8)


def test_a_minute_that_lands_after_the_quiet_floor_vouched_for_it_is_counted(live):
    _begin("AAA", "BBB")
    live.clock.now = M(10, 7, 3)
    _push(m1=[_row("AAA", M(10, 6)), _row("BBB", M(10, 6))], wm=M(10, 6) * 1000, seq=2)
    live.clock.now = M(10, 8, 40)                              # AAA's 10:07 arrives 40 s after it closed
    _push(m1=[_row("AAA", M(10, 7)), _row("BBB", M(10, 7))], wm=M(10, 7) * 1000, seq=3)
    assert bls.status()["late_rows"] == 2                      # both later than LIVE_LATE_S: LIVE_LATE_S is too short
