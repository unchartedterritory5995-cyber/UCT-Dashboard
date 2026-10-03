"""FT-068 fails-to-deliver: parsing RECORDED SEC cnsfails files
(tests/fixtures/ftd, read 2026-10-02 through fundamentals_pit.sec_client and
trimmed to five symbols; data rows byte-for-byte, the two trailer lines dropped),
the trailer reconciliation, the ingest job's states, the series honesty and the
dark route. No network: the SEC transport is replaced by a reader of those files."""
from __future__ import annotations

import inspect
import io
import zipfile
from datetime import date
from pathlib import Path

import pytest

from api.services import ftd_dataset as ftd

FIX = Path(__file__).resolve().parent / "fixtures" / "ftd"
FILES = {"cnsfails202609a": FIX / "cnsfails202609a_trimmed.zip",
         "cnsfails202608b": FIX / "cnsfails202608b_trimmed.zip"}


class NotFound(Exception):
    status = 404


def recorded_get(url: str) -> bytes:
    for name, path in FILES.items():
        if url.endswith(f"/{name}.zip"):
            return path.read_bytes()
    raise NotFound(url)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("FTD_DB_PATH", str(tmp_path / "ftd.db"))
    return tmp_path


def _text_zip(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("x.txt", text)
    return buf.getvalue()


class TestParse:
    def test_the_recorded_file_parses_into_dated_rows(self):
        rows, trailer = ftd.parse(FILES["cnsfails202609a"].read_bytes())
        assert trailer is None and len(rows) == 25
        gme = [r for r in rows if r[2] == "GME" and r[0] == "2026-09-02"]
        assert gme == [("2026-09-02", "36467W109", "GME", 2570429, "GAMESTOP CORP (HLDG CO) CL A", 18.81)]
        assert {r[2] for r in rows} <= {"AAPL", "GME", "AMC", "TSLA", "NVDA"}

    def test_the_trailer_is_read_and_the_header_skipped(self):
        rows, trailer = ftd.parse(_text_zip(
            "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE\n"
            "20260901|037833100|AAPL|100|APPLE INC|200.00\n"
            "20260902|037833100|AAPL|50|APPLE INC|.\n"
            "Trailer record count 2\nTrailer total quantity of shares 150\n"))
        assert trailer == 2 and [r[3] for r in rows] == [100, 50] and rows[1][5] is None

    def test_file_names_skip_halves_that_have_not_ended(self):
        names = ftd.file_names(date(2026, 10, 2), months=2)
        assert names == ["cnsfails202609b", "cnsfails202609a", "cnsfails202608b", "cnsfails202608a"]
        assert ftd.file_names(date(2026, 10, 20), months=1)[0] == "cnsfails202610a"


class TestIngest:
    def test_recorded_files_ingest_ok_and_an_unposted_one_is_not_published(self, store, monkeypatch):
        monkeypatch.setenv("FTD_DATASET_ENABLED", "1")
        out = ftd.run_ingest(today=date(2026, 10, 2), get=recorded_get)
        got = dict(out["fetched"])
        assert got == {"cnsfails202609b": "not_published", "cnsfails202609a": "ok", "cnsfails202608b": "ok"}

    def test_a_file_that_does_not_reconcile_is_marked(self, store):
        blob = _text_zip("20260901|037833100|AAPL|100|APPLE INC|200.00\nTrailer record count 5\n")
        rec = ftd.ingest_file("cnsfails202609a", get=lambda u: blob)
        assert rec["state"] == "count_mismatch" and "says 5 rows; 1 parsed" in rec["reason"]

    def test_a_transport_failure_is_an_error_state_never_raised(self, store):
        def boom(url):
            raise OSError("reset")
        assert ftd.ingest_file("cnsfails202609a", get=boom)["state"] == "error"

    def test_the_job_is_a_no_op_while_dark(self, monkeypatch):
        monkeypatch.delenv("FTD_DATASET_ENABLED", raising=False)
        assert ftd.run_ingest(get=lambda u: pytest.fail("fetched while dark")) == {"skipped": "flag off"}


class TestSeries:
    def test_nothing_ingested_is_its_own_state(self, store):
        assert ftd.series("GME")["state"] == "not_ingested"

    def test_balances_are_listed_never_summed_and_the_window_is_stated(self, store, monkeypatch):
        monkeypatch.setenv("FTD_DATASET_ENABLED", "1")
        ftd.run_ingest(today=date(2026, 10, 2), get=recorded_get)
        out = ftd.series("gme")
        assert out["state"] == "ok" and out["window"]["from"].startswith("2026-08")
        assert out["window"]["through"].startswith("2026-09")
        assert out["peak"]["quantity"] == max(p["quantity"] for p in out["points"])
        assert out["latest"] == out["points"][-1]
        assert "never summed" in out["basis"] and "total" not in out
        p = next(p for p in out["points"] if p["settle_date"] == "2026-09-02")
        assert p["value"] == round(2570429 * 18.81, 2)

    def test_a_symbol_absent_from_ingested_files_is_none_reported_with_the_window(self, store, monkeypatch):
        monkeypatch.setenv("FTD_DATASET_ENABLED", "1")
        ftd.run_ingest(today=date(2026, 10, 2), get=recorded_get)
        out = ftd.series("MSFT")
        assert out["state"] == "none_reported" and "between 2026-08" in out["reason"]


class TestRoute:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_depth as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    def test_dark_by_default_is_a_404(self, client, monkeypatch):
        _, c = client
        monkeypatch.delenv("FTD_DATASET_ENABLED", raising=False)
        assert c.get("/api/research/ftd/GME").status_code == 404

    def test_armed_serves_the_series(self, client, store, monkeypatch):
        _, c = client
        monkeypatch.setenv("FTD_DATASET_ENABLED", "1")
        r = c.get("/api/research/ftd/gme")
        assert r.status_code == 200 and r.json()["state"] == "not_ingested"

    def test_the_handler_is_sync_and_the_payload_key_rides_only_when_on(self, client, monkeypatch):
        from api.routers import auth
        route, _ = client
        assert not inspect.iscoroutinefunction(route.ftd_route)
        monkeypatch.delenv("FTD_DATASET_ENABLED", raising=False)
        assert "ftd_dataset_enabled" not in auth._research_depth_flags()
        monkeypatch.setenv("FTD_DATASET_ENABLED", "1")
        assert auth._research_depth_flags()["ftd_dataset_enabled"] is True
