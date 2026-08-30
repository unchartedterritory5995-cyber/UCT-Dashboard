"""GET /api/market-calendar — the NYSE closure dates, DERIVED not retyped.

🔴 WHY THIS ROUTE HAS A RAIL AT ALL. Its whole reason to exist is that the
browser must not carry its own copy of the closure list: a second authority
over one value is this repo's most repeated defect, and the copies diverge in
whichever year somebody refreshes only one. A route that quietly stopped
deriving from `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` — a literal list pasted in
"temporarily", a filter that drops a year — would look correct and would be
exactly the failure the route was built to prevent, so the derivation itself
is what is asserted here, not a sample of dates.
"""
import re

from fastapi.testclient import TestClient

from api.main import app
from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD

client = TestClient(app)


def _payload() -> dict:
    r = client.get("/api/market-calendar")
    assert r.status_code == 200, r.text
    return r.json()


def test_it_serves_every_date_the_one_closure_table_holds_and_no_others():
    # ⭐ EQUALITY, NOT CONTAINMENT. `assert "2026-11-26" in holidays` passes for
    # a hand-typed list that happens to include Thanksgiving and is missing
    # Juneteenth — which is the shape of the bug, not the absence of one.
    expected = {
        f"{str(d)[0:4]}-{str(d)[4:6]}-{str(d)[6:8]}" for d in _NYSE_HOLIDAYS_YYYYMMDD
    }
    assert set(_payload()["holidays"]) == expected


def test_the_list_is_ascending_so_a_consumer_can_reason_about_its_ends():
    days = _payload()["holidays"]
    assert days == sorted(days)
    assert len(days) == len(set(days)), "a duplicated date means two sources, not one"


def test_covers_through_is_the_end_of_the_last_year_the_table_enumerates():
    # ⛔ THE HORIZON IS THE LOAD-BEARING FIELD. Without it, a date past the end
    # of the table is indistinguishable from a date the exchange is open — so
    # the year this hand-maintained list stops being refreshed, every consumer
    # silently goes holiday-blind and nothing says so. The frontend refuses to
    # draw a countdown past this date, which is what turns a stale table into a
    # visible absence instead of a confident wrong answer.
    last_year = max(str(d)[0:4] for d in _NYSE_HOLIDAYS_YYYYMMDD)
    assert _payload()["covers_through"] == f"{last_year}-12-31"


def test_it_is_public_so_a_free_member_still_gets_a_verified_countdown():
    # The Dashboard is a FREE_PAGE and Zone A renders for free-tier members.
    # A 401/402 here would turn the countdown off for them permanently — the
    # suppression path firing for a reason that has nothing to do with the
    # calendar. `TestClient` above carries no session cookie.
    assert client.get("/api/market-calendar").status_code == 200


def test_the_dates_are_iso_and_none_are_malformed():
    for d in _payload()["holidays"]:
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", d), d


def test_it_names_where_it_read_from_so_the_next_engineer_finds_the_one_table():
    assert _payload()["source"] == "bars_fetch._NYSE_HOLIDAYS_YYYYMMDD"


def test_CONTROL_the_equality_check_can_actually_fail(monkeypatch):
    # A rail nobody has seen fire is not a rail. Perturb the ONE table and the
    # route's answer must move with it — proving it derives rather than
    # carrying a copy that would stay right while the source changed.
    import api.routers.market_calendar as mc

    extra = frozenset(_NYSE_HOLIDAYS_YYYYMMDD | {20260102})
    monkeypatch.setattr(mc, "_NYSE_HOLIDAYS_YYYYMMDD", extra)
    assert "2026-01-02" in _payload()["holidays"]
