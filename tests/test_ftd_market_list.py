"""The Terminal's bare `FTD` (2026-11-27): the biggest fails-to-deliver of the newest ingested period,
`ftd_dataset.market_list` and `GET /api/research/ftd-market`. No network: every file is an invented
cnsfails text in the SEC's own pipe-delimited shape, written through `ingest_file` with a stand-in transport."""
from __future__ import annotations

import inspect
import io
import zipfile

import pytest

from api.services import ftd_dataset as ftd

HEAD = "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE"


def _zip(lines):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("x.txt", "\n".join([HEAD, *lines, f"Trailer record count {len(lines)}"]) + "\n")
    return buf.getvalue()


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("FTD_DB_PATH", str(tmp_path / "ftd.db"))
    with ftd._market_lock:
        ftd._market_held.clear()
    yield tmp_path
    with ftd._market_lock:
        ftd._market_held.clear()


OLD = ["20260815|000000AA1|ZOLD|9999999|OLD PERIOD CO|10.00"]
NEW = [
    "20260901|000000BB1|ZBIG|500000|BIG FAILS INC|2.00",
    "20260902|000000BB1|ZBIG|800000|BIG FAILS INC|2.50",
    "20260914|000000BB1|ZBIG|100000|BIG FAILS INC|3.00",
    "20260902|000000CC1|ZVAL|50000|VALUE CORP|100.00",
    "20260914|000000DD1|ZNOP|300000|NO PRICE TRUST|",
    "20260914|000000EE1||12345|NO SYMBOL ROW|1.00",
]


def _ingest(files):
    for name, lines in files.items():
        ftd.ingest_file(name, get=lambda url, lines=lines: _zip(lines))


class TestTheList:
    def test_nothing_ingested_is_its_own_state(self, store):
        out = ftd.market_list("shares")
        assert out["state"] == "not_ingested" and out["rows"] == [] and "ingested" in out["reason"]

    def test_the_newest_period_only_ranked_by_one_days_balance_never_a_sum(self, store):
        _ingest({"cnsfails202608b": OLD, "cnsfails202609a": NEW})
        out = ftd.market_list("shares")
        assert out["state"] == "ok" and out["file"] == "cnsfails202609a"
        assert out["period"] == {"from": "2026-09-01", "through": "2026-09-14"}
        assert [r["symbol"] for r in out["rows"]] == ["ZBIG", "ZNOP", "ZVAL"]      # no ZOLD, no blank symbol
        big = out["rows"][0]
        assert big["peak"] == {"settle_date": "2026-09-02", "quantity": 800000, "price": 2.5, "value": 2000000.0}
        assert big["latest"]["settle_date"] == "2026-09-14" and big["latest"]["quantity"] == 100000
        assert big["days_listed"] == 3 and out["settle_dates"] == 3                 # 09-01, 09-02, 09-14
        assert big["description"] == "BIG FAILS INC"
        assert "never a sum" in out["basis"] and out["cut"] is False and out["total"] == 3

    def test_by_value_ranks_balance_times_the_files_own_price_and_says_what_has_no_price(self, store):
        _ingest({"cnsfails202609a": NEW})
        out = ftd.market_list("value")
        assert [(r["symbol"], r["peak_value"]["value"]) for r in out["rows"]] == [("ZVAL", 5000000.0), ("ZBIG", 2000000.0)]
        assert out["no_price"] == 1 and out["total"] == 2
        nop = next(r for r in ftd.market_list("shares")["rows"] if r["symbol"] == "ZNOP")
        assert nop["peak"]["price"] is None and nop["peak"]["value"] is None and nop["peak_value"] is None

    def test_the_list_is_capped_from_the_small_end_and_says_so(self, store, monkeypatch):
        monkeypatch.setattr(ftd, "MARKET_CAP", 2)
        _ingest({"cnsfails202609a": NEW})
        out = ftd.market_list("shares")
        assert [r["symbol"] for r in out["rows"]] == ["ZBIG", "ZNOP"] and out["cut"] is True and out["total"] == 3

    def test_worked_out_once_per_file_and_again_after_a_new_ingest(self, store, monkeypatch):
        _ingest({"cnsfails202609a": NEW})
        ftd.market_list("shares")
        calls = []
        real = ftd._market_build
        monkeypatch.setattr(ftd, "_market_build", lambda *a: calls.append(a[1]) or real(*a))
        ftd.market_list("shares")
        ftd.market_list("value")
        assert calls == []                                                     # held: no second build
        _ingest({"cnsfails202609b": ["20260916|000000FF1|ZNEW|42|NEW HALF INC|1.00"]})
        assert [r["symbol"] for r in ftd.market_list("shares")["rows"]] == ["ZNEW"]
        assert calls == ["cnsfails202609b"]

    def test_a_bad_rank_is_refused(self, store):
        with pytest.raises(ValueError):
            ftd.market_list("sum")


class TestTheRoute:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_depth as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    def test_dark_is_a_404_armed_serves_and_a_bad_rank_is_a_422(self, client, store, monkeypatch):
        route, c = client
        monkeypatch.delenv("FTD_DATASET_ENABLED", raising=False)
        assert c.get("/api/research/ftd-market").status_code == 404
        monkeypatch.setenv("FTD_DATASET_ENABLED", "1")
        _ingest({"cnsfails202609a": NEW})
        body = c.get("/api/research/ftd-market?rank=value").json()
        assert body["state"] == "ok" and body["rank"] == "value" and body["rows"][0]["symbol"] == "ZVAL"
        assert c.get("/api/research/ftd-market?rank=sum").status_code == 422
        assert c.get("/api/research/ftd/ZBIG").json()["state"] == "ok"          # the per-stock route is unchanged
        assert not inspect.iscoroutinefunction(route.ftd_market_route)
