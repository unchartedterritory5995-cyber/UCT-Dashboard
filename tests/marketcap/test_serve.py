import json
import sqlite3

from fastapi.testclient import TestClient

from api.services.marketcap import build as B
from api.services.marketcap import serve


def _fixture(tmp_path):
    p = tmp_path / "b.db"
    db = sqlite3.connect(p)
    db.executescript(B.SCHEMA)
    db.execute("INSERT INTO manifest VALUES('build_id','MCAP_V1-test')")
    for t in ("GOOGL", "GOOG"):
        db.execute("INSERT INTO ticker_map VALUES(?,?,?,?,?,?,?,?,?)", (t, 1652044, None, "2004-08-19", None, "MASSIVE_LIST_DATE", None, 0, "[]"))
    db.execute("INSERT INTO ticker_map VALUES('ARM',1973239,NULL,'2023-09-14',NULL,'MASSIVE_LIST_DATE','TICKER_REUSE_DIFFERENT_ISSUER',1902,'[]')")
    db.executemany("INSERT INTO cap_daily VALUES(?,?,?)", [(1652044, 20240102, 1.7e12), (1652044, 20240103, 1.71e12)])
    db.execute("INSERT INTO gap_run VALUES(1973239,20030910,20110329,'TICKER_REUSE_DIFFERENT_ISSUER',1902)")
    db.execute("INSERT INTO regime VALUES('cik:1652044','2004-08-19','2026-09-29','[\"A\",\"B\",\"C\"]','MULTI_LISTED',NULL,'',?)",
               (json.dumps([["A", "GOOGL", 1.0, "listed"], ["B", "GOOGL", 1.0, "x"], ["C", "GOOG", 1.0, "listed"]]),))
    db.commit()
    return str(p)


def test_goog_and_googl_are_the_same_company_series(tmp_path, monkeypatch):
    monkeypatch.setenv("MCAP_PIT_V1_BUILD", _fixture(tmp_path))
    serve.authority.cache_clear()
    from api.services.marketcap.dark_app import create_app
    c = TestClient(create_app())
    a, b = c.get("/api/marketcap/pit/GOOGL").json(), c.get("/api/marketcap/pit/GOOG").json()
    assert a["points"] == b["points"] == [["2024-01-02", 1.7e12], ["2024-01-03", 1.71e12]]
    assert a["company_level"] and a["build_id"] == "MCAP_V1-test"
    arm = c.get("/api/marketcap/pit/ARM").json()
    assert arm["points"] == [] and arm["gaps"][0]["reason"] == "TICKER_REUSE_DIFFERENT_ISSUER"
    assert c.get("/api/marketcap/pit/NOPE").status_code == 404


def test_authority_is_dark_without_a_build(monkeypatch):
    monkeypatch.delenv("MCAP_PIT_V1_BUILD", raising=False)
    serve.authority.cache_clear()
    try:
        serve.authority()
        assert False
    except RuntimeError as e:
        assert "dark" in str(e)
