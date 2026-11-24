"""The READ ONLY readers of terminal data wave 10, beside their services: `stock_stats_held.held_stats`,
`volume_footprint_held.held_footprint`, `factor_exposure_held.held_exposure` and `setup_history_held.held_signals`.

No network and no real store: each service holds its answer by working it out itself, over the invented bar reads its own
test file stands in for. Every figure is invented. Pinned per reader: nothing held is `not_held` and nothing is worked out;
the answer the SERVICE holds comes back exactly (the same object for the three price studies, whose least-recently-asked
order does not move); a held answer for an earlier session is still returned, with its own `session`; and the reader never
reads a price, starts a build or a thread, while the service's own reader works the stock out on the same cold hold (so the
rail can fail). SETH's reader returns the newest session's answer and attaches the universe lines with the service's own
`universe_lines` from the study it holds, or says the study is not held, or not this library's.
"""
from __future__ import annotations

import datetime as dt
import threading

import pytest

from api.services import factor_exposure as FX, factor_exposure_held as fxh
from api.services import held_build, held_reads, market_history
from api.services import setup_history as SH, setup_history_held as shh
from api.services import stock_stats as SS, stock_stats_held as ssh
from api.services import volume_footprint as VF, volume_footprint_held as vfh
from api.services.market_intel import price_reads
from tests import test_setup_history as T_SH
from tests.test_factor_exposure import _fex_world
from tests.test_stock_stats import _world as _stats_world
from tests.test_volume_footprint import _vfp_world

#: what a held read must never reach: each service's route reader, builders and reads
FORBIDDEN = {
    SS: ("get_stock_stats", "build", "_read_bars", "_read_closes", "_market_answer", "market_corrections", "bench_closes"),
    VF: ("get_volume_footprint", "build", "_read_bars", "_read_earnings", "earnings"),
    FX: ("get_factor_exposure", "build", "_read_bars", "fund_set", "read_funds"),
    SH: ("get_stock", "get_study", "build_study", "_build_stock", "_read_bars", "_market", "_universe"),
    market_history: ("get_market_history",),
    price_reads: ("daily_bars", "daily_closes"),
    held_build.HeldBuild: ("get", "_start", "_run"),
    held_reads.KeyedHeld: ("get",),
}
READERS = ((ssh.held_stats, "ZZQA"), (vfh.held_footprint, "ZZQA"), (fxh.held_exposure, "ZZQA"), (shh.held_signals, "QZSA"))


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    for svc in (SS, VF, FX, SH):
        svc.reset_for_tests()
    monkeypatch.setattr(SS, "_is_trading_day", lambda d: d.weekday() < 5)
    monkeypatch.setattr(SH, "_universe", lambda: list(T_SH.SYMS))
    monkeypatch.setattr(SH, "_market", lambda wait_s: T_SH._market())
    monkeypatch.setattr(SH, "evening_key", lambda now: T_SH.KEY)
    monkeypatch.setattr(SH, "now_et", lambda: T_SH.SATURDAY)
    monkeypatch.setattr(SH, "HISTORY_YEARS", 2)
    yield tmp_path
    SH._STUDY.drain(10)
    SH._STOCK.drain(10)
    for svc in (SS, VF, FX, SH):
        svc.reset_for_tests()


def _forbid(mp, reached):
    for owner, names in FORBIDDEN.items():
        for name in names:
            assert callable(getattr(owner, name)), (owner, name)
            label = f"{getattr(owner, '__name__', owner)}.{name}"
            mp.setattr(owner, name, lambda *a, _n=label, **kw: reached.append(_n) or (_ for _ in ()).throw(AssertionError(_n)))
    real_start = threading.Thread.start
    mp.setattr(threading.Thread, "start", lambda self: reached.append(f"thread {self.name}") or real_start(self))


def _stock(sym="QZSA"):
    ans = SH.get_stock(sym)
    if ans.get("status") == "computing":
        SH._STOCK.drain(30)
        ans = SH.get_stock(sym)
    return ans


def test_nothing_held_is_not_held_and_nothing_is_worked_out_or_started():
    reached = []
    with pytest.MonkeyPatch.context() as mp:
        _forbid(mp, reached)
        for reader, sym in READERS:
            assert reader(sym) == (None, "not_held"), reader.__qualname__
    assert reached == []


def test_each_price_study_reader_returns_the_services_own_answer_and_moves_nothing(monkeypatch):
    _stats_world(monkeypatch)
    _vfp_world(monkeypatch)
    _fex_world(monkeypatch)
    for svc, reader, route in ((SS, ssh.held_stats, SS.get_stock_stats), (VF, vfh.held_footprint, VF.get_volume_footprint),
                               (FX, fxh.held_exposure, FX.get_factor_exposure)):
        served = route("ZZQA")
        route("ZZQB")                                                   # a second symbol, asked for after the first
        order = list(svc._cache)
        reached = []
        with pytest.MonkeyPatch.context() as mp:
            _forbid(mp, reached)
            got, how = reader("ZZQA")
            assert reader("ZZQC") == (None, "not_held")
        assert how == "held" and got is served and reached == [], svc.__name__
        assert list(svc._cache) == order, svc.__name__                 # the least-recently-asked order did not move


def test_an_earlier_sessions_answer_is_still_returned_with_its_own_session_and_a_no_prices_answer_is_held(monkeypatch):
    _stats_world(monkeypatch)
    SS.get_stock_stats("ZZQA")
    monkeypatch.setattr(SS, "session_key", lambda now: "2031-06-09")   # a later evening: the service would work it out again
    got, how = ssh.held_stats("ZZQA")
    assert how == "held" and got["session"] == "2031-06-02"
    monkeypatch.setattr(SS, "_read_bars", lambda sym: {"status": "unavailable", "reason": "no_price_history", "symbol": sym})
    assert SS.get_stock_stats("ZZQX")["status"] == "not_held"
    got, how = ssh.held_stats("ZZQX")
    assert how == "held" and got["status"] == "not_held"
    # a failed read is never held by the service, so the reader says nothing is held
    monkeypatch.setattr(SS, "_read_bars", lambda sym: {"status": "unavailable", "reason": "read_failed", "symbol": sym})
    assert SS.get_stock_stats("ZZQY")["status"] == "unavailable" and ssh.held_stats("ZZQY") == (None, "not_held")


def test_the_services_own_readers_work_the_stock_out_on_the_same_cold_hold(monkeypatch):
    w = _stats_world(monkeypatch)
    assert ssh.held_stats("ZZQA")[1] == "not_held" and w["reads"] == []
    SS.get_stock_stats("ZZQA")
    assert w["reads"] == ["ZZQA"] and ssh.held_stats("ZZQA")[1] == "held"
    w = _vfp_world(monkeypatch)
    assert vfh.held_footprint("ZZQA")[1] == "not_held" and w["reads"] == []
    VF.get_volume_footprint("ZZQA")
    assert w["reads"] == ["ZZQA"] and vfh.held_footprint("ZZQA")[1] == "held"
    w = _fex_world(monkeypatch)
    assert fxh.held_exposure("ZZQA")[1] == "not_held" and w["reads"] == [] and FX._funds == {}
    FX.get_factor_exposure("ZZQA")
    assert "SPY" in w["reads"] and "ZZQA" in w["reads"] and fxh.held_exposure("ZZQA")[1] == "held"
    seen = []
    monkeypatch.setattr(SH, "_read_bars", T_SH._reader(seen))
    assert shh.held_signals("QZSA")[1] == "not_held" and seen == []
    _stock()
    assert ("QZSA", None) in seen and shh.held_signals("QZSA")[1] == "held"


def test_the_setup_reader_attaches_the_routes_own_universe_lines_from_the_held_study(monkeypatch):
    monkeypatch.setattr(SH, "_read_bars", T_SH._reader())
    SH.get_study()
    SH._STUDY.drain(30)
    served = _stock()
    assert served["status"] == "ok" and served["universe"]["state"] == "ok"
    reached = []
    with pytest.MonkeyPatch.context() as mp:
        _forbid(mp, reached)
        got, how = shh.held_signals("QZSA")
    assert how == "held" and reached == []
    assert {k: v for k, v in got.items() if k != "universe"} == {k: v for k, v in served.items() if k not in ("universe", "check")}
    assert got["universe"] == served["universe"]                       # the service's own universe_lines over the same study


def test_the_setup_reader_says_a_study_not_held_or_not_this_librarys(monkeypatch, fresh):
    monkeypatch.setattr(SH, "_read_bars", T_SH._reader())
    _stock()
    SH._STUDY.drain(30)
    SH._STUDY.reset()                                                  # no study held: memory and its disk copy gone
    (fresh / "setup_history" / "setup_history_v1.json").unlink(missing_ok=True)
    got, how = shh.held_signals("QZSA")
    assert how == "held" and got["universe"] == {"state": "not_held"}
    SH.get_study()
    SH._STUDY.drain(30)
    assert shh.held_signals("QZSA")[0]["universe"]["state"] == "ok"
    monkeypatch.setattr(SH, "library_version", lambda: "another")      # a study built under another library
    assert shh.held_signals("QZSA")[0]["universe"] == {"state": "unavailable", "detail": None}


def test_the_setup_reader_returns_the_newest_sessions_answer(monkeypatch):
    monkeypatch.setattr(SH, "_read_bars", T_SH._reader())
    first = _stock()
    later = dt.date.fromisoformat(T_SH.KEY) + dt.timedelta(days=3)
    monkeypatch.setattr(SH, "evening_key", lambda now: later.isoformat())
    second = _stock()
    assert first["session"] == T_SH.KEY and second["session"] == later.isoformat()
    assert len([k for k in SH._STOCK.keys() if k[0] == "QZSA"]) == 2
    assert shh.held_signals("QZSA")[0]["session"] == later.isoformat()


def test_each_reader_says_read_only():
    for reader, _sym in READERS:
        assert reader.__doc__.startswith("READ ONLY"), reader.__qualname__
