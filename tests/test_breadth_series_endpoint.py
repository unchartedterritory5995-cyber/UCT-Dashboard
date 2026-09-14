"""B1 — the dark columnar breadth series endpoint (D-035).

⛔ THE LOAD-BEARING CASE IS THE DEPENDENCY ORDER. With the flag unset this route must
answer **404 to every caller class**, including a paid one. Put `require_paid` first and an
anonymous probe gets 401/402 instead — which advertises that a paid route exists here
before it has shipped. FastAPI 0.115.6 resolves dependencies in DECLARATION ORDER
(`fastapi/dependencies/utils.py:592`), so the order is the mechanism, not a detail, and
`test_the_flag_dependency_precedes_require_paid_by_position` asserts the positions directly
rather than inferring them from three status codes.

⛔ Scoped runs only on this box — name the file:

    python -m pytest tests/test_breadth_series_endpoint.py -q
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import breadth_monitor as rt
from api.services import breadth_monitor as svc
from api.services.cache import cache
from tests.authclients import FREE_MEMBER, PAID_MEMBER, authorize

URL = "/api/breadth-monitor/series"

# Two stored sessions plus one reconstructed, with a deliberate NaN and a key that is
# absent from one row — the two ways a value can fail to exist.
ROWS = [
    {"date": "2026-01-02", "breadth_score": 41.0, "pct_above_50sma": 55.5,
     "new_52w_highs": 12, "up_4pct_today_list": ["AAA"]},
    {"date": "2026-01-03", "breadth_score": float("nan"), "pct_above_50sma": 60.0},
    {"date": "2026-01-06", "breadth_score": 44.0, "pct_above_50sma": 61.25,
     "new_52w_highs": 9, "_reconstructed": True},
]


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.delete_prefix("breadth_history_")
    yield
    cache.delete_prefix("breadth_history_")


@pytest.fixture
def stub_history(monkeypatch):
    """`get_history_deep` is the ONE history reader; the endpoint must not have a second."""
    calls = []

    def fake(days=90, end=None, anchor="le"):
        calls.append({"days": days, "end": end, "anchor": anchor})
        return [dict(r) for r in ROWS]

    monkeypatch.setattr(svc, "get_history_deep", fake)
    monkeypatch.setattr(svc, "date_bounds", lambda: {"min": "2026-01-02", "max": "2026-01-06"})
    return calls


def _app(user=PAID_MEMBER):
    app = FastAPI()
    app.include_router(rt.router)
    authorize(app, user)
    return TestClient(app)


def _on(monkeypatch):
    monkeypatch.setenv(rt.SERIES_FLAG, "1")


def _off(monkeypatch):
    monkeypatch.delenv(rt.SERIES_FLAG, raising=False)


# ── 1. the ordering rail ───────────────────────────────────────────────────────

@pytest.mark.parametrize("who", [None, FREE_MEMBER, PAID_MEMBER])
def test_flag_unset_is_404_for_every_caller_class(monkeypatch, stub_history, who):
    """Anonymous, free and PAID all get 404 — a paid 402 would advertise the route."""
    _off(monkeypatch)
    app = FastAPI()
    app.include_router(rt.router)
    if who is not None:
        authorize(app, who)
    assert TestClient(app).get(URL, params={"keys": "breadth_score"}).status_code == 404


def test_the_flag_dependency_precedes_require_paid_by_position():
    """⛔ Asserted by POSITION, not by status code.

    Three green status codes are also compatible with a route that happens to 404 for
    another reason. This reads the route's own dependant list, so a reorder fails here
    even if every HTTP case somehow still passed.
    """
    route = next(r for r in rt.router.routes if getattr(r, "path", "") == URL)
    names = [d.call.__name__ for d in route.dependant.dependencies]
    assert "require_series_flag" in names, names
    assert "require_paid" in names, names
    assert names.index("require_series_flag") < names.index("require_paid"), (
        "the flag check must resolve BEFORE require_paid, or an unset flag answers a paid "
        "caller with 402 and advertises the route: %s" % names)


def test_flag_on_free_is_402_and_paid_is_200(monkeypatch, stub_history):
    _on(monkeypatch)
    assert _app(FREE_MEMBER).get(URL, params={"keys": "breadth_score"}).status_code == 402
    assert _app(PAID_MEMBER).get(URL, params={"keys": "breadth_score"}).status_code == 200


# ── 2. shape ───────────────────────────────────────────────────────────────────

def test_columnar_shape_each_date_once_ascending_and_aligned(monkeypatch, stub_history):
    _on(monkeypatch)
    b = _app().get(URL, params={"keys": "breadth_score,pct_above_50sma",
                                "from": "2026-01-02", "to": "2026-01-06"}).json()
    assert b["dates"] == ["2026-01-02", "2026-01-03", "2026-01-06"]
    assert len(b["dates"]) == len(set(b["dates"])), "a date appeared twice"
    assert b["dates"] == sorted(b["dates"]), "dates are not ascending"
    assert b["sessions"] == len(b["dates"]) == 3
    for k, col in b["series"].items():
        assert len(col) == len(b["dates"]), f"{k} is not aligned to dates"
    assert b["reconstructed"] == ["2026-01-06"]


def test_non_finite_and_absent_are_null_never_zero(monkeypatch, stub_history):
    """⛔ The whole point. A 0 here is a breadth reading a member would act on."""
    _on(monkeypatch)
    b = _app().get(URL, params={"keys": "breadth_score,new_52w_highs",
                                "from": "2026-01-02", "to": "2026-01-06"}).json()
    assert b["series"]["breadth_score"] == [41.0, None, 44.0], "NaN did not become null"
    assert b["series"]["new_52w_highs"] == [12, None, 9], "an absent key did not become null"
    # ⛔ `assert X or True` can never fail; the holes are asserted directly instead.
    assert b["series"]["breadth_score"][1] is None
    assert b["series"]["new_52w_highs"][1] is None


def test_ticker_lists_are_not_served(monkeypatch, stub_history):
    """`get_history_deep` strips `_list` keys; assert the endpoint inherits that rather
    than re-stripping (a second stripper would be a second authority)."""
    _on(monkeypatch)
    b = _app().get(URL, params={"keys": "up_4pct_today_list,breadth_score",
                                "from": "2026-01-02", "to": "2026-01-06"}).json()
    assert "up_4pct_today_list" not in b["series"], "a ticker array was served as a series"
    assert "up_4pct_today_list" in b["missing"], "it must be REPORTED absent, not silently dropped"
    assert "breadth_score" in b["series"], "a real key was lost alongside the list key"


# ── 3. partial success, caps, bounds ───────────────────────────────────────────

def test_unknown_key_is_partial_success_not_400(monkeypatch, stub_history):
    _on(monkeypatch)
    b = _app().get(URL, params={"keys": "breadth_score,not_a_metric",
                                "from": "2026-01-02", "to": "2026-01-06"}).json()
    assert b["missing"] == ["not_a_metric"]
    assert "breadth_score" in b["series"], "one bad key must not lose the good ones"


def test_all_unknown_keys_still_200_with_empty_series(monkeypatch, stub_history):
    _on(monkeypatch)
    r = _app().get(URL, params={"keys": "nope,also_nope",
                                "from": "2026-01-02", "to": "2026-01-06"})
    assert r.status_code == 200
    b = r.json()
    assert b["series"] == {}
    assert sorted(b["missing"]) == ["also_nope", "nope"]
    # ⛔ NON-VACUITY: an empty `series` must not come with an empty `dates` — that would
    # pass this test for the wrong reason (nothing was read at all).
    assert b["dates"], "empty series with empty dates proves nothing"


def test_nine_keys_is_400_and_eight_is_fine(monkeypatch, stub_history):
    _on(monkeypatch)
    c = _app()
    eight = ",".join(f"k{i}" for i in range(8))
    assert c.get(URL, params={"keys": eight, "from": "2026-01-02", "to": "2026-01-06"}).status_code == 200
    r = c.get(URL, params={"keys": eight + ",k8", "from": "2026-01-02", "to": "2026-01-06"})
    assert r.status_code == 400 and "8" in r.json()["detail"]


def test_a_repeated_key_does_not_consume_the_budget_twice(monkeypatch, stub_history):
    _on(monkeypatch)
    keys = ",".join(["breadth_score"] * 9)
    assert _app().get(URL, params={"keys": keys, "from": "2026-01-02",
                                   "to": "2026-01-06"}).status_code == 200


def test_from_after_to_is_400(monkeypatch, stub_history):
    _on(monkeypatch)
    r = _app().get(URL, params={"keys": "breadth_score", "from": "2026-02-01", "to": "2026-01-06"})
    assert r.status_code == 400 and "after" in r.json()["detail"]


def test_span_over_the_session_cap_is_400_and_names_the_cap(monkeypatch, stub_history):
    """⛔ The cap is what makes a cold deep read unreachable (D-042), so it is checked
    BEFORE the read — a post-read rejection has already paid the 55 s it prevents."""
    _on(monkeypatch)
    r = _app().get(URL, params={"keys": "breadth_score", "from": "1990-01-01", "to": "2026-01-06"})
    assert r.status_code == 400
    assert str(rt.series_max_sessions()) in r.json()["detail"], "the cap must be in the message"
    assert not stub_history, "the reader ran before the cap rejected — the cap is decorative"


def test_a_full_cap_span_is_never_rejected_for_being_a_few_holidays_long(monkeypatch, stub_history):
    """×1.6 is deliberately generous in the safe direction: a genuine 365-session request
    must not 400 because a year holds ~252 sessions in 365 calendar days."""
    _on(monkeypatch)
    days = rt.series_max_calendar_days()
    frm = (date.fromisoformat("2026-01-06") - timedelta(days=days - 1)).isoformat()
    assert _app().get(URL, params={"keys": "breadth_score", "from": frm,
                                   "to": "2026-01-06"}).status_code == 200


def test_the_cap_is_configurable(monkeypatch, stub_history):
    _on(monkeypatch)
    monkeypatch.setenv("BREADTH_SERIES_MAX_SESSIONS", "30")
    assert rt.series_max_sessions() == 30
    r = _app().get(URL, params={"keys": "breadth_score", "from": "2025-01-01", "to": "2026-01-06"})
    assert r.status_code == 400 and "30-session" in r.json()["detail"]


def test_a_bad_cap_value_falls_back_rather_than_crashing(monkeypatch):
    monkeypatch.setenv("BREADTH_SERIES_MAX_SESSIONS", "not-a-number")
    assert rt.series_max_sessions() == rt._SERIES_DEFAULT_SESSIONS


def test_defaults_when_from_and_to_are_omitted(monkeypatch, stub_history):
    _on(monkeypatch)
    b = _app().get(URL, params={"keys": "breadth_score"}).json()
    assert b["to"] == "2026-01-06", "to defaults to the latest stored session"
    assert b["from"] == ROWS[-1]["date"] or b["from"] <= b["to"]
    assert any(c["days"] == rt._SERIES_DEFAULT_SESSIONS for c in stub_history), \
        "the documented default is the 365 most recent stored sessions"


# ── 4. parity with the one history reader ──────────────────────────────────────

def test_values_match_get_history_deep_for_the_same_window(monkeypatch, stub_history):
    """Parity, not re-implementation: every served value comes from the same rows, and
    the reconstructed flags survive unchanged."""
    _on(monkeypatch)
    b = _app().get(URL, params={"keys": "pct_above_50sma",
                                "from": "2026-01-02", "to": "2026-01-06"}).json()
    direct = svc.get_history_deep(10, end="2026-01-06", anchor="le")
    assert b["series"]["pct_above_50sma"] == [r["pct_above_50sma"] for r in direct]
    assert b["reconstructed"] == [r["date"] for r in direct if r.get("_reconstructed")]
    assert b["reconstructed"], "no reconstructed row in the fixture — the check is vacuous"


# ── 5. cache ───────────────────────────────────────────────────────────────────

def test_second_identical_request_is_a_cache_hit(monkeypatch, stub_history):
    """Asserted through the cache layer, never by timing."""
    _on(monkeypatch)
    c = _app()
    p = {"keys": "breadth_score", "from": "2026-01-02", "to": "2026-01-06"}
    c.get(URL, params=p)
    reads_before = len(stub_history)
    assert reads_before > 0, "the first request never read history — the rest is vacuous"
    c.get(URL, params=p)
    assert len(stub_history) == reads_before, "the second request re-read history"


def test_key_order_does_not_change_the_cache_key(monkeypatch, stub_history):
    _on(monkeypatch)
    c = _app()
    base = {"from": "2026-01-02", "to": "2026-01-06"}
    c.get(URL, params={**base, "keys": "breadth_score,pct_above_50sma"})
    reads = len(stub_history)
    c.get(URL, params={**base, "keys": "pct_above_50sma,breadth_score"})
    assert len(stub_history) == reads, "reordered keys produced a different cache key"


def test_a_snapshot_write_invalidates_the_cached_series(monkeypatch, stub_history):
    """The key lives under `breadth_history_` precisely so the EXISTING invalidation
    clears it — no new path to forget."""
    _on(monkeypatch)
    p = {"keys": "breadth_score", "from": "2026-01-02", "to": "2026-01-06"}
    _app().get(URL, params=p)
    keyed = [k for k in cache.keys() if k.startswith("breadth_history_series_")] \
        if hasattr(cache, "keys") else None
    if keyed is not None:
        assert keyed, "nothing was cached — the invalidation check would be vacuous"
    cache.delete_prefix("breadth_history_")          # what a snapshot write calls
    reads = len(stub_history)
    _app().get(URL, params=p)
    assert len(stub_history) > reads, "the cached response survived a snapshot write"


def test_the_response_is_private_and_short_lived(monkeypatch, stub_history):
    _on(monkeypatch)
    r = _app().get(URL, params={"keys": "breadth_score", "from": "2026-01-02", "to": "2026-01-06"})
    assert r.headers["Cache-Control"] == "private, max-age=60"
    assert json.loads(r.content)["sessions"] == 3, "the body must survive the Response wrapper"
