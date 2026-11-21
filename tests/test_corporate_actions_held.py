"""CACT, the Terminal's corporate actions panel (`api/services/corporate_actions_held.py` and the
route in `api/routers/corporate_actions.py`).

What is held here:
  * the route is one GET, paid: signed out is 401, a free plan is 402, and neither reaches the
    service; a string that is not a ticker is 400 and does not reach it either;
  * the answer comes ONLY from the chart markers blob on the volume: no vendor read, no build
    and no background refresh is started, whatever is or is not held;
  * a stock nothing is held for answers 200 `not_held` with a sentence, never an error and
    never an empty `ok`; a blob from an older build, or one that cannot be read, is `not_held`;
  * rows are newest first, figures are passed through as held, a row without a day or a
    dividend without a positive amount is dropped;
  * at most `ROW_CAP` rows per kind, with the held total beside them;
  * `held_at` is when the blob was written, as a UTC instant.

Every date, ratio and amount below is made up. Nothing here reaches a vendor.
"""
from __future__ import annotations

import json
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import corporate_actions as route
from api.services import corporate_actions_held as held
from api.services import earnings_estimates as ee
from api.services import reference_corp_actions

FREE_USER = {"id": "ca-free", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "ca-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
URL = "/api/research/corporate-actions/NVDA"
SAVED_AT = 1794924131.0          # 2026-11-17T14:02:11+00:00


def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def volume(tmp_path, monkeypatch):
    """An empty markers folder, and every vendor read and build replaced by one that fails the test."""
    monkeypatch.setattr(ee, "_MARKERS_DISK_DIR", str(tmp_path))

    def forbidden(*a, **k):
        raise AssertionError("the corporate actions route asked a vendor or started a build")

    for owner, name in ((ee, "get_chart_markers"), (ee, "_build_chart_markers"), (ee, "_schedule_markers_refresh"),
                        (ee, "_markers_disk_write"), (reference_corp_actions, "fetch_ticker_splits"),
                        (reference_corp_actions, "fetch_ticker_dividends")):
        monkeypatch.setattr(owner, name, forbidden)
    return tmp_path


def _hold(folder, ticker, data, *, version=None, saved_at=SAVED_AT):
    blob = {"v": ee._MARKERS_DISK_VERSION if version is None else version, "data": data, "saved_at": saved_at}
    pathlib.Path(folder, f"{ticker}.json").write_text(json.dumps(blob), encoding="utf-8")


def test_the_route_is_one_paid_get_and_a_refused_caller_never_reaches_the_service(monkeypatch):
    asked = []
    monkeypatch.setattr(held, "held_actions", lambda ticker: asked.append(ticker) or {"status": "ok", "sym": ticker})
    (r,) = route.router.routes
    assert r.path == "/api/research/corporate-actions/{ticker}" and r.methods == {"GET"}
    assert route.require_paid in {d.call for d in r.dependant.dependencies}
    assert route.require_paid.__module__ == "api.routers.corporate_actions"      # its own gate, not a borrowed one
    assert _client(None).get(URL).status_code == 401
    refused = _client(FREE_USER).get(URL)
    assert refused.status_code == 402 and refused.json() == {"detail": "Corporate actions require a paid plan"}
    assert asked == []
    assert _client(PAID_USER).get("/api/research/corporate-actions/nvda").json() == {"status": "ok", "sym": "NVDA"}
    assert asked == ["NVDA"]


def test_the_handler_is_a_plain_def_so_the_file_read_stays_off_the_event_loop():
    import inspect
    assert not inspect.iscoroutinefunction(route.get_corporate_actions)


@pytest.mark.parametrize("junk", ["<script>", "A B", "ABCDEFGHIJKLMNOPQRSTU", "%20"])
def test_a_string_that_is_not_a_ticker_is_refused_before_the_service(monkeypatch, junk):
    asked = []
    monkeypatch.setattr(held, "held_actions", lambda ticker: asked.append(ticker) or {})
    resp = _client(PAID_USER).get(f"/api/research/corporate-actions/{junk}")
    assert resp.status_code in (400, 404) and asked == []


def test_a_symbol_nothing_is_held_for_answers_not_held_in_words(volume):
    resp = _client(PAID_USER).get("/api/research/corporate-actions/ZZZQ")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "not_held" and body["sym"] == "ZZZQ" and body["held_at"] is None
    assert body["reason"].startswith("No splits or dividends are held on this server for ZZZQ.")
    assert "never asks the data vendor" in body["reason"]
    assert body["splits"] == {"rows": [], "total": 0, "window_years": 45}
    assert body["dividends"] == {"rows": [], "total": 0, "window_years": 5, "basis": "split_adjusted"}
    assert list(volume.iterdir()) == []                                          # and it held nothing afterwards either


def test_a_held_record_is_served_newest_first_with_its_figures_untouched(volume):
    _hold(volume, "NVDA", {
        "earnings": [],
        "splits": [{"date": "2021-07-20", "ratio": "4:1", "from_factor": 1, "to_factor": 4.0, "source": "massive"},
                   {"date": "2024-06-10", "ratio": "10:1", "from_factor": 1, "to_factor": 10.0, "source": "massive"}],
        "dividends": [{"date": "2025-03-12", "amount": 0.01, "source": "massive"},
                      {"date": "2026-09-10", "amount": 0.0125, "source": "massive"},
                      {"date": "2025-12-04", "amount": 0.01, "source": "massive"}],
    })
    body = held.held_actions("NVDA")
    assert body["status"] == "ok" and "reason" not in body
    assert body["held_at"] == "2026-11-17T14:02:11+00:00" and body["source"] == "massive" and body["row_cap"] == held.ROW_CAP
    assert body["splits"] == {"rows": [{"date": "2024-06-10", "ratio": "10:1", "to_factor": 10.0},
                                       {"date": "2021-07-20", "ratio": "4:1", "to_factor": 4.0}], "total": 2, "window_years": 45}
    assert [r["date"] for r in body["dividends"]["rows"]] == ["2026-09-10", "2025-12-04", "2025-03-12"]
    assert body["dividends"]["rows"][0] == {"date": "2026-09-10", "amount": 0.0125}
    assert body["dividends"]["basis"] == "split_adjusted" and body["dividends"]["total"] == 3
    assert _client(PAID_USER).get(URL).json() == body                             # the route adds and removes nothing


def test_rows_are_capped_and_the_held_total_is_kept_beside_them(volume):
    days = [f"{2022 + i // 300}-{1 + (i % 300) // 28:02d}-{1 + (i % 28):02d}" for i in range(200)]
    assert len(set(days)) == 200
    _hold(volume, "KO", {"earnings": [], "splits": [], "dividends": [{"date": d, "amount": 0.5} for d in days]})
    section = held.held_actions("KO")["dividends"]
    assert held.ROW_CAP == 60
    assert len(section["rows"]) == 60 and section["total"] == 200
    assert [r["date"] for r in section["rows"]] == sorted(days, reverse=True)[:60]


def test_a_row_without_a_day_or_a_dividend_without_a_positive_amount_is_dropped(volume):
    _hold(volume, "AAA", {
        "earnings": [],
        "splits": [{"date": "not-a-day", "ratio": "2:1"}, {"ratio": "3:1"}, "junk", {"date": "2020-01-02", "ratio": ""}],
        "dividends": [{"date": "2025-01-02", "amount": 0}, {"date": "2025-02-03", "amount": None},
                      {"date": "2025-03-04", "amount": "0.5"}, {"date": "2025-04-05", "amount": True},
                      {"date": "2025-05-06", "amount": 0.25}],
    })
    body = held.held_actions("AAA")
    assert body["splits"]["rows"] == [{"date": "2020-01-02", "ratio": None, "to_factor": None}]
    assert body["dividends"]["rows"] == [{"date": "2025-05-06", "amount": 0.25}] and body["dividends"]["total"] == 1


def test_a_held_record_with_neither_in_it_is_ok_and_empty_not_not_held(volume):
    _hold(volume, "BBB", {"earnings": [{"date": "2026-01-02"}], "splits": [], "dividends": []})
    body = held.held_actions("BBB")
    assert body["status"] == "ok" and body["splits"]["total"] == 0 and body["dividends"]["total"] == 0


def test_an_older_build_or_an_unreadable_blob_is_not_held(volume, monkeypatch):
    _hold(volume, "OLD", {"earnings": [], "splits": [{"date": "2020-01-02", "ratio": "2:1"}], "dividends": []},
          version=ee._MARKERS_DISK_VERSION - 1)
    assert held.held_actions("OLD")["status"] == "not_held"
    pathlib.Path(volume, "BAD.json").write_text("{not json", encoding="utf-8")
    assert held.held_actions("BAD")["status"] == "not_held"

    def boom(ticker):
        raise OSError("volume went away")

    monkeypatch.setattr(held, "_read_held", boom)
    assert held.held_actions("NVDA")["status"] == "not_held"                      # never raises
    assert held.held_actions("")["status"] == "not_held"


def test_a_record_with_no_write_time_says_so_with_none(volume):
    _hold(volume, "CCC", {"earnings": [], "splits": [{"date": "2020-01-02", "ratio": "2:1", "to_factor": 2.0}], "dividends": []},
          saved_at=0)
    body = held.held_actions("CCC")
    assert body["status"] == "ok" and body["held_at"] is None


def test_the_route_is_mounted_on_the_app():
    main = pathlib.Path(__file__).resolve().parents[1].joinpath("api", "main.py").read_text(encoding="utf-8")
    assert "from api.routers import corporate_actions as corporate_actions_router" in main
    assert "app.include_router(corporate_actions_router.router)" in main
