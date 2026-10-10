"""TERM-045 (owner ruling T-14): the SEC Official List of Section 13(f) Securities, joined to
the ticker's 13F holders. Fixture files only; SEC and FMP are never reached."""
import json
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import sec_13f_list as L
from api.services.fundamentals_pit.sec_client import SecError


def line(cusip, name, desc, opt=False, status=""):
    s = f"{cusip:<9}{'*' if opt else ' '}{name:<30}{desc:<27}{status:<3}"
    return f"{s:<79}E"


# Real rows from 13flist2026q3.txt (measured 2026-10-10), plus filler so it looks like a list.
APPLE = [line("037833100", "APPLE INC", "COM", opt=True),
         line("037833900", "APPLE INC", "CALL"),
         line("037833950", "APPLE INC", "PUT")]
ADDED = line("F70289107", "PASQAL HLDG SA", "ORDINARY SHARE", status="*A*")
GONE = line("C00948304", "AGRIFORCE GROWING SYSTEMS LT", "COM", status="*D*")
FILLER = [line(f"9{i:05d}10{i % 10}", f"FILLER CO {i}", "COM") for i in range(150)]
LIST_TEXT = "\n".join(APPLE + [ADDED, GONE] + FILLER) + "\n"


@pytest.fixture
def armed(tmp_path, monkeypatch):
    monkeypatch.setenv(L.ENABLED_ENV, "1")
    monkeypatch.setenv("SEC_13F_LIST_PATH", str(tmp_path / "lists"))
    L._parsed.clear()
    yield tmp_path / "lists"
    L._parsed.clear()


def _write(d, y, q, text=LIST_TEXT):
    d.mkdir(parents=True, exist_ok=True)
    (d / f"13flist{y}q{q}.txt").write_text(text, encoding="latin-1")


# -- parsing -------------------------------------------------------------------

def test_parse_reads_the_fixed_width_layout():
    r = L.parse_line(APPLE[0])
    assert r == {"cusip": "037833100", "has_listed_options": True, "issuer": "APPLE INC",
                 "description": "COM", "status": None}
    assert L.parse_line(ADDED)["status"] == "added"
    assert L.parse_line(GONE)["status"] == "deleted"
    assert L.parse_line("") is None and L.parse_line("<html>not a list</html>") is None
    assert len(L.parse(LIST_TEXT)) == 155


def test_quarter_candidates_walk_back_across_the_year():
    assert L.quarter_candidates(date(2026, 2, 10)) == [(2026, 1), (2025, 4), (2025, 3), (2025, 2)]
    assert L.url_for(2026, 3) == "https://www.sec.gov/files/investment/13flist2026q3.txt"


# -- refresh (job path) --------------------------------------------------------

def test_refresh_does_nothing_while_dark(monkeypatch):
    monkeypatch.delenv(L.ENABLED_ENV, raising=False)
    calls = []
    assert L.refresh(get=lambda u: calls.append(u))["skipped"] is True
    assert calls == []


def test_refresh_falls_back_past_an_unpublished_quarter_and_caches_on_disk(armed):
    calls = []

    def get(url):
        calls.append(url)
        if url.endswith("13flist2026q4.txt"):
            raise SecError(url, 404, "not found")
        return LIST_TEXT.encode("latin-1")

    r = L.refresh(today=date(2026, 10, 10), get=get)
    assert r["state"] == "fetched" and r["quarter"] == "2026Q3" and r["rows"] == 155
    assert (armed / "13flist2026q3.txt").exists()
    meta = json.loads((armed / "13flist2026q3.txt.meta.json").read_text())
    assert meta["url"].endswith("13flist2026q3.txt")
    again = L.refresh(today=date(2026, 10, 10), get=get)
    assert again["state"] == "cached" and again["quarter"] == "2026Q3"
    # the unpublished q4 is asked again (it may publish); the cached q3 is never re-downloaded
    assert sum(1 for u in calls if u.endswith("2026q3.txt")) == 1


def test_refresh_rejects_a_body_that_is_not_a_list(armed):
    r = L.refresh(today=date(2026, 10, 10), get=lambda u: b"<html>maintenance</html>")
    assert r["state"] == "rejected"
    assert not armed.exists() or not any(armed.glob("13flist*.txt"))


def test_refresh_records_a_transport_failure_without_raising(armed):
    def get(url):
        raise SecError(url, 503, "busy")
    assert L.refresh(today=date(2026, 10, 10), get=get)["state"] == "unavailable"


def test_the_download_is_byte_capped():
    class Resp:
        headers = {}

        def read(self, n=-1):
            return b"x" * (n if n and n > 0 else L.MAX_BYTES + 10)

        def close(self):
            pass

    with pytest.raises(ValueError):
        with L._Capped(Resp()) as r:
            r.read()


def test_the_transport_is_the_fair_access_client_with_a_timeout(monkeypatch):
    from api.services.fundamentals_pit import sec_client
    seen = {}

    def fake(url, retries=4, timeout=60.0, opener=None):
        seen.update(url=url, retries=retries, timeout=timeout, opener=opener)
        return b"ok"
    monkeypatch.setattr(sec_client, "get_bytes", fake)
    assert L._sec_get("https://www.sec.gov/files/investment/13flist2026q3.txt") == b"ok"
    assert seen["timeout"] == L.TIMEOUT_S and seen["opener"] is L._capped_opener


# -- request path --------------------------------------------------------------

def test_overlay_is_a_no_op_while_dark(monkeypatch):
    monkeypatch.delenv(L.ENABLED_ENV, raising=False)
    p = {"sym": "AAPL"}
    assert L.overlay(p, "AAPL") is p


def test_overlay_with_nothing_downloaded_says_not_ingested(armed, monkeypatch):
    monkeypatch.setattr(L, "cusip_for", lambda s: pytest.fail("no lookup before a list exists"))
    out = L.overlay({"sym": "AAPL"}, "AAPL")
    assert out["thirteen_f_list"]["state"] == "not_ingested"


def test_overlay_joins_the_tickers_cusip_to_the_newest_list(armed, monkeypatch):
    _write(armed, 2026, 2, "\n".join(FILLER))           # an older list without Apple
    _write(armed, 2026, 3)
    monkeypatch.setattr(L, "cusip_for", lambda s: "037833100")
    payload = {"sym": "AAPL", "thirteen_f": {"quarter": "2026Q2", "holders": []}}
    out = L.overlay(payload, "aapl")
    b = out["thirteen_f_list"]
    assert b["state"] == "ok" and b["quarter"] == "2026Q3" and b["on_list"] is True
    assert b["security"]["description"] == "COM" and b["security"]["has_listed_options"] is True
    assert [s["cusip"] for s in b["issuer_securities"]] == ["037833100", "037833900", "037833950"]
    assert b["holders_quarter"] == "2026Q2"
    assert "thirteen_f_list" not in payload                               # never mutates


def test_overlay_states_not_on_list_deleted_and_no_cusip(armed, monkeypatch):
    _write(armed, 2026, 3)
    monkeypatch.setattr(L, "cusip_for", lambda s: "999999999")
    assert L.overlay({"sym": "ZZZ"}, "ZZZ")["thirteen_f_list"]["state"] == "not_on_list"
    monkeypatch.setattr(L, "cusip_for", lambda s: "C00948304")             # deleted this quarter
    assert L.overlay({"sym": "AGRI"}, "AGRI")["thirteen_f_list"]["state"] == "not_on_list"
    monkeypatch.setattr(L, "cusip_for", lambda s: None)
    assert L.overlay({"sym": "X"}, "X")["thirteen_f_list"]["state"] == "no_cusip"


def test_annotate_positions_joins_13f_rows_by_cusip(armed):
    _write(armed, 2026, 3)
    lst = L.current_list()
    out = L.annotate_positions([{"cusip": "037833100", "shares": 5}, {"cusip": "000000000", "shares": 1}], lst)
    assert out[0]["on_list"] is True and out[0]["list_issuer"] == "APPLE INC"
    assert out[1]["on_list"] is False and out[1]["shares"] == 1           # kept, never dropped


def test_cusip_from_fmp_reads_the_profile_field(monkeypatch):
    from api.services import fmp_client

    class R:
        degraded = None
        value = [{"symbol": "AAPL", "cusip": "037833100"}]
    monkeypatch.setattr(fmp_client, "get_company_profile", lambda s, timeout=None: R())
    assert L._cusip_from_fmp("AAPL") == "037833100"
    R.value = [{"symbol": "AAPL", "cusip": ""}]
    assert L._cusip_from_fmp("AAPL") is None


def test_the_ownership_route_carries_the_block_only_when_armed(armed, monkeypatch):
    from api.routers import research as R
    from api.services import edgar_ownership
    monkeypatch.setattr(R, "get_ownership", lambda s: {"sym": s.upper(), "thirteen_f": None})
    monkeypatch.setattr(edgar_ownership, "is_enabled", lambda: False)
    monkeypatch.setattr(L, "cusip_for", lambda s: "037833100")
    _write(armed, 2026, 3)
    app = FastAPI()
    app.include_router(R.router)
    c = TestClient(app)
    assert c.get("/api/research/ownership/AAPL").json()["thirteen_f_list"]["state"] == "ok"
    monkeypatch.delenv(L.ENABLED_ENV)
    assert "thirteen_f_list" not in c.get("/api/research/ownership/AAPL").json()
