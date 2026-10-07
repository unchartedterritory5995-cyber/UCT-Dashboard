"""TERM-055 (FB-D5-01) M half — the RAW (as-traded) price view, dark behind
RAW_PRICE_VIEW_ENABLED. Offline: the vendor call is monkeypatched."""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import bars as bars_mod
from api.services import massive
from api.services import raw_price_view as rpv
from api.services.cache import cache

ET = ZoneInfo("America/New_York")


def _t(day: str) -> int:
    """Massive daily `t`: unix ms at the session's ET midnight."""
    return int(dt.datetime.fromisoformat(day).replace(tzinfo=ET).timestamp() * 1000)


# A 10-for-1 split effective 2024-06-10 (NVDA's shape).
RAW = [{"t": _t("2024-06-06"), "o": 1200.0, "h": 1210.0, "l": 1190.0, "c": 1209.98, "v": 40_000_000},
       {"t": _t("2024-06-07"), "o": 1200.0, "h": 1215.0, "l": 1180.0, "c": 1208.88, "v": 41_000_000},
       {"t": _t("2024-06-10"), "o": 120.37, "h": 123.1, "l": 117.01, "c": 121.79, "v": 314_000_000}]
ADJ = [{"t": _t("2024-06-06"), "o": 120.0, "h": 121.0, "l": 119.0, "c": 120.998, "v": 400_000_000},
       {"t": _t("2024-06-07"), "o": 120.0, "h": 121.5, "l": 118.0, "c": 120.888, "v": 410_000_000},
       {"t": _t("2024-06-10"), "o": 120.37, "h": 123.1, "l": 117.01, "c": 121.79, "v": 314_000_000}]


@pytest.fixture
def vendor(monkeypatch):
    calls = []

    def fake(symbol, f, t, *, adjusted=False, map_symbol=True):
        calls.append((symbol, f, t, adjusted))
        return ADJ if adjusted else RAW

    monkeypatch.setattr(massive, "get_daily_agg", fake)
    cache.delete_prefix("raw_price_view:")
    yield calls
    cache.delete_prefix("raw_price_view:")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(bars_mod.router)
    app.dependency_overrides[bars_mod.require_bars_access] = lambda: {"id": "u"}
    return TestClient(app)


def test_the_gate_is_off_unless_set(monkeypatch):
    monkeypatch.delenv(rpv.FLAG, raising=False)
    assert rpv.enabled() is False
    for v in ("1", "true", "on"):
        monkeypatch.setenv(rpv.FLAG, v)
        assert rpv.enabled() is True
    monkeypatch.setenv(rpv.FLAG, "0")
    assert rpv.enabled() is False


def test_pair_rows_pairs_by_session_and_states_the_factor():
    rows = rpv.pair_rows(RAW, ADJ)
    assert [r["t"] for r in rows] == ["2024-06-06", "2024-06-07", "2024-06-10"]
    assert [r["factor"] for r in rows] == [10.0, 10.0, 1.0]
    assert rows[1]["raw"]["c"] == 1208.88 and rows[1]["adjusted"]["c"] == 120.888


def test_pair_rows_drops_a_session_only_one_side_has():
    rows = rpv.pair_rows(RAW, ADJ[1:])
    assert [r["t"] for r in rows] == ["2024-06-07", "2024-06-10"]


def test_route_is_404_while_the_gate_is_off(monkeypatch, client, vendor):
    monkeypatch.delenv(rpv.FLAG, raising=False)
    r = client.get("/api/adjustment-basis/NVDA/raw?around=2024-06-10")
    assert r.status_code == 404
    assert vendor == []                      # the vendor is never asked while dark


def test_route_on_answers_the_paired_window_from_ONE_vendor_both_flags(monkeypatch, client, vendor):
    monkeypatch.setenv(rpv.FLAG, "1")
    r = client.get("/api/adjustment-basis/nvda/raw?around=2024-06-10")
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "NVDA" and body["available"] is True and body["source"] == "massive"
    assert (body["from"], body["to"]) == ("2024-05-27", "2024-06-24")
    assert [r["factor"] for r in body["rows"]] == [10.0, 10.0, 1.0]
    assert sorted(c[3] for c in vendor) == [False, True]          # same window, both flags
    assert {(c[0], c[1], c[2]) for c in vendor} == {("NVDA", "2024-05-27", "2024-06-24")}


def test_a_vendor_failure_is_unavailable_never_a_fabricated_row(monkeypatch, client):
    monkeypatch.setenv(rpv.FLAG, "1")
    monkeypatch.setattr(massive, "get_daily_agg", lambda *a, **k: [])
    body = client.get("/api/adjustment-basis/ZZZQ/raw?around=2023-01-03").json()
    assert body["available"] is False and body["rows"] == []
