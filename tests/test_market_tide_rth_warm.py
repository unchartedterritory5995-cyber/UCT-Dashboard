"""L2 (terminal backend fixes, 2026-10-05): the market tide is rebuilt on a fixed RTH cadence by
the scheduler, not only when a member happens to look, and a tape running behind is logged."""
import ast
import datetime as dt
import logging
import pathlib
from zoneinfo import ZoneInfo

import pytest

from api.services.options_analytics import market_tide as mt

ET = ZoneInfo("America/New_York")
MON_RTH = dt.datetime(2026, 10, 5, 11, 0, tzinfo=ET)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    mt.clear_cache()
    built = []

    def fake_build(scope, now=None):
        built.append(scope)
        return {"scope": scope, "tape_behind": scope == "etfs", "data_through": "10:41"}

    monkeypatch.setattr(mt, "build", fake_build)
    yield built
    mt.clear_cache()


def test_in_rth_every_scope_is_rebuilt(_clean):
    out = mt.warm_rth(MON_RTH)
    assert out == {s: "built" for s in mt.SCOPES}
    assert sorted(_clean) == sorted(mt.SCOPES)
    assert all(s in mt._CACHE for s in mt.SCOPES)
    assert not mt._REFRESHING


@pytest.mark.parametrize("when", [
    dt.datetime(2026, 10, 5, 9, 15, tzinfo=ET),     # before the open
    dt.datetime(2026, 10, 5, 16, 30, tzinfo=ET),    # after the close
    dt.datetime(2026, 10, 4, 11, 0, tzinfo=ET),     # Sunday
])
def test_outside_the_session_nothing_is_built(_clean, when):
    assert set(mt.warm_rth(when).values()) == {"closed"}
    assert _clean == []


def test_a_scope_a_request_is_already_refreshing_is_left_alone(_clean):
    mt._REFRESHING.add("stocks")
    out = mt.warm_rth(MON_RTH)
    assert out["stocks"] == "skipped" and "stocks" not in _clean


def test_a_tape_running_behind_is_logged(_clean, caplog):
    with caplog.at_level(logging.WARNING):
        mt.warm_rth(MON_RTH)
    assert any("etfs tape behind" in r.getMessage() and "10:41" in r.getMessage() for r in caplog.records)


def test_a_failed_build_is_reported_not_raised(monkeypatch):
    monkeypatch.setattr(mt, "build", lambda scope, now=None: (_ for _ in ()).throw(RuntimeError("tape down")))
    out = mt.warm_rth(MON_RTH)
    assert all(v.startswith("error: RuntimeError") for v in out.values())


def test_the_job_is_registered_on_the_tide_switch():
    src = pathlib.Path("api/main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    ids = [kw.value.value for n in ast.walk(tree) if isinstance(n, ast.Call)
           for kw in n.keywords if kw.arg == "id" and isinstance(kw.value, ast.Constant)]
    assert "market_tide_rth_warm" in ids
    assert "exposure_gate_watch" in ids      # control: the walk sees a sibling job
