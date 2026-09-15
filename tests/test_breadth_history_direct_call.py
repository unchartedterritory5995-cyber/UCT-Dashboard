"""`get_breadth_history` must survive being called as a plain Python function.

`api/main.py`'s boot warm task calls `get_breadth_history(days=90)` directly,
bypassing FastAPI's request pipeline — so every parameter left at its default
holds a `Query(...)` sentinel rather than a value. `anchor` survived only by
accident (the line that constrains it to "le"/"ge" rejects a Query instance);
`end` did not, because `end or None` sees a Query object as truthy and hands the
sentinel to a `<` comparison against a date string.

The warm task is wrapped in try/except, so this never broke a request. It
silently meant the breadth-history cache was never pre-warmed and the first
request after every deploy paid full cold compute — a failure whose only
symptom was `[dashboard-warm] breadth failed` in a log buffer that holds ten
minutes.

⚠️ SINCE SESSION 7 THIS FUNCTION RETURNS A PRE-RENDERED `Response`, NOT A DICT.
That is a deliberate, declared contract change: the route renders the JSON itself so
FastAPI's `jsonable_encoder` never walks 376,240 scalar cells on a request that has
the bytes already. The one direct caller in the app (`api/main.py::_breadth`)
discards the return value, so nothing in production reads it — but these rails did,
and they now decode the body instead. Their SUBJECT is unchanged: what the endpoint
forwards to the service layer.
"""
import json

import pytest

from api.routers import breadth_monitor as bm


def _body(resp):
    """The payload, whatever the endpoint wraps it in."""
    return json.loads(resp.body)


@pytest.fixture
def captured(monkeypatch):
    """Capture exactly what the endpoint forwards to the service layer."""
    seen = {}

    def _deep(days, end=None, anchor="le"):
        seen["days"] = days
        seen["end"] = end
        seen["anchor"] = anchor
        return [{"date": "2026-09-10"}]

    monkeypatch.setattr(bm.svc, "get_history_deep", _deep)
    monkeypatch.setattr(bm.svc, "date_bounds", lambda: {"min": "2020-01-01", "max": "2026-09-10"})
    monkeypatch.setattr(bm.svc, "next_trading_day", lambda d: "2026-09-11")
    monkeypatch.setattr(bm, "breadth_self_heal", None, raising=False)
    # ⛔ THE BODY CACHE MUST NOT CARRY BETWEEN CASES. Without this, the second test
    # in this file hit the entry the first one wrote, the service was never called,
    # and `captured` came back EMPTY — a test that silently stopped exercising the
    # thing it was named for. Found by exactly that failure.
    from api.services.cache import cache
    cache.delete_prefix("breadth_history_")
    yield seen
    cache.delete_prefix("breadth_history_")


def test_the_boot_warm_calls_shape_passes_real_values(captured):
    """THE REGRESSION. This is the exact call api/main.py::_breadth makes."""
    out = bm.get_breadth_history(days=90)

    assert isinstance(captured["days"], int) and captured["days"] == 90
    assert captured["end"] is None, (
        "a Query sentinel reached the service layer as `end` -- this is the defect"
    )
    assert captured["anchor"] == "le"
    assert _body(out)["rows"] == [{"date": "2026-09-10"}]


def test_a_fully_defaulted_direct_call_also_works(captured):
    """Nothing should depend on the caller happening to pass `days`."""
    out = bm.get_breadth_history()
    assert captured["days"] == 90
    assert captured["end"] is None
    assert _body(out)["days"] == 90


def test_next_date_is_none_when_the_window_is_latest(captured):
    """`next_date` is gated on `end` being set. With `end` left as a truthy
    Query sentinel this returned a step-forward date for a window that is
    already at the newest row -- a wrong value, not just a crash."""
    out = bm.get_breadth_history(days=90)
    assert _body(out)["next_date"] is None


def test_real_query_values_still_reach_the_service(captured):
    """Control: the request path must be untouched. A real caller passing
    strings must still have them honoured, not normalised away."""
    bm.get_breadth_history(days=30, end="2026-08-01", anchor="ge")
    assert captured["days"] == 30
    assert captured["end"] == "2026-08-01"
    assert captured["anchor"] == "ge"


def test_a_bogus_anchor_still_falls_back(captured):
    bm.get_breadth_history(days=30, end="2026-08-01", anchor="sideways")
    assert captured["anchor"] == "le"
