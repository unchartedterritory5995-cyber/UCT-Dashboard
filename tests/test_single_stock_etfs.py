import logging
import httpx
import pytest
from api.services import single_stock_etfs as ss

def test_num_formats():
    assert ss._num("1234567") == 1234567.0
    assert ss._num("1,234,567") == 1234567.0
    assert ss._num("12.34") == 12.34
    assert ss._num("-") is None
    assert ss._num("") is None
    assert ss._num(None) is None
    assert ss._num("n/a") is None

def test_fetch_never_logs_token(monkeypatch, caplog):
    monkeypatch.setenv("FINVIZ_API_KEY", "SECRET-TOKEN-XYZ")
    def boom(url, **kw):
        req = httpx.Request("GET", url + "?auth=SECRET-TOKEN-XYZ")
        resp = httpx.Response(401, request=req)
        raise httpx.HTTPStatusError("401 Unauthorized", request=req, response=resp)
    monkeypatch.setattr(ss.httpx, "get", boom)
    with caplog.at_level(logging.DEBUG):
        rows = ss._fetch_finviz_market()
    assert rows == []
    assert "SECRET-TOKEN-XYZ" not in caplog.text

def test_fetch_missing_key_returns_empty(monkeypatch, caplog):
    monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
    assert ss._fetch_finviz_market() == []


# ── Store ────────────────────────────────────────────────────────────────────

@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setenv("SSETF_DB_PATH", str(tmp_path / "ssetf.db"))
    import importlib
    importlib.reload(ss)
    yield ss
    ss.invalidate_cache()


def _seed(s):
    with s._write_conn() as c:
        c.executemany(
            "INSERT INTO etfs (etf_ticker, underlying, direction, factor, name, price,"
            " avg_volume, avg_dollar_vol, vol_source, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                ("NBIL", "NBIS", "long", 2.0, "GraniteShares 2x Long NBIS", 50.0, 1e6, 5e7, "finviz", 1),
                ("NEBX", "NBIS", "long", 2.0, "Tradr 2X Long NBIS", 40.0, 3e5, 1.2e7, "finviz", 1),
                ("NBIZ", "NBIS", "short", 2.0, "Tradr 2X Short NBIS", 30.0, 3e5, 9e6, "finviz", 1),
            ],
        )


def test_lookup_forward_and_reverse(tmp_db):
    _seed(tmp_db)
    fam = tmp_db.lookup("NBIS")
    assert fam["underlying"] == "NBIS"
    assert [r["ticker"] for r in fam["long"]] == ["NBIL", "NEBX"]  # liquidity desc
    assert fam["best_long"] == "NBIL" and fam["best_short"] == "NBIZ"
    assert tmp_db.lookup("nbil")["underlying"] == "NBIS"  # reverse, case-insensitive


def test_lookup_empty_shape(tmp_db):
    fam = tmp_db.lookup("KO")
    assert fam == {"underlying": None, "long": [], "short": [], "best_long": None, "best_short": None}


def test_lookup_cache_and_invalidation(tmp_db):
    assert tmp_db.lookup("NBIS")["underlying"] is None  # cached empty
    _seed(tmp_db)
    assert tmp_db.lookup("NBIS")["underlying"] is None  # still cached
    tmp_db.invalidate_cache()
    assert tmp_db.lookup("NBIS")["underlying"] == "NBIS"


def test_status_shape(tmp_db):
    _seed(tmp_db)
    tmp_db._meta_set("last_status", "ok")
    st = tmp_db.status()
    assert st["etf_count"] == 3 and st["family_count"] == 1
    assert st["last_status"] == "ok"
    assert isinstance(st["quarantine"], list)


def test_lookup_returns_are_mutation_safe(tmp_db):
    _seed(tmp_db)
    fam1 = tmp_db.lookup("NBIS")
    fam1["long"].append({"ticker": "HACK"})
    fam1["best_long"] = "HACK"
    fam2 = tmp_db.lookup("NBIS")            # cache-hit path
    assert all(r["ticker"] != "HACK" for r in fam2["long"])
    assert fam2["best_long"] == "NBIL"
    empty1 = tmp_db.lookup("KO")
    empty1["long"].append({"ticker": "HACK"})
    assert tmp_db.lookup("XOM")["long"] == []   # sentinel not poisoned
