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
    monkeypatch.setattr(ss, "_spawn_rebuild", lambda trig: None)  # no stray self-heal threads escaping test boundaries
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


# ── Rebuild ──────────────────────────────────────────────────────────────────

def _mkrows(n_etf=10, vol="1,000,000", price="50.00"):
    rows = [{"Ticker": "TSLA", "Company": "Tesla, Inc.", "Sector": "Consumer Cyclical",
             "Industry": "Auto Manufacturers", "Average Volume": "9,999,999", "Price": "200.00"},
            {"Ticker": "NBIS", "Company": "Nebius Group NV", "Sector": "Technology",
             "Industry": "Software", "Average Volume": "5,000,000", "Price": "40.00"}]
    for i in range(n_etf):
        rows.append({"Ticker": f"LG{i:02d}", "Company": f"Issuer{i} 2X Long NBIS Daily ETF",
                     "Sector": "Financial", "Industry": "Exchange Traded Fund",
                     "Average Volume": vol, "Price": price})
    return rows


def test_rebuild_happy_path(tmp_db, monkeypatch):
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    rec = tmp_db.rebuild(trigger="test")
    assert rec["status"] == "ok" and rec["counts"]["etfs_written"] == 10
    assert tmp_db.lookup("NBIS")["best_long"] is not None
    assert tmp_db.status()["last_status"] == "ok"


def test_header_gate_refuses_html_login_page(tmp_db, monkeypatch):
    import csv as _csv, io as _io
    # Two-line HTML => DictReader yields 1 row with a garbage header, so the
    # HEADER gate (not fetch_empty) must trip — this is the 200-HTML login page.
    html = "<html>\n<body>login</body>\n</html>"
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market",
                        lambda: list(_csv.DictReader(_io.StringIO(html))))
    rec = tmp_db.rebuild(trigger="test")
    assert rec["status"] == "refused_headers"
    assert tmp_db.status()["last_status"] == "refused_headers"
    assert tmp_db.status()["etf_count"] == 0  # garbage never seeds the table


def test_liquidity_gate_refuses_all_zero_volume(tmp_db, monkeypatch):
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    assert tmp_db.rebuild(trigger="test")["status"] == "ok"
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(vol="-"))
    rec = tmp_db.rebuild(trigger="test")
    assert rec["status"] == "refused_liquidity"
    assert tmp_db.status()["etf_count"] == 10  # previous table survives


def test_shrink_guard_and_force(tmp_db, monkeypatch):
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(n_etf=10))
    tmp_db.rebuild(trigger="test")
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(n_etf=3))
    assert tmp_db.rebuild(trigger="test")["status"] == "refused_shrink"
    assert tmp_db.rebuild(trigger="test", force_shrink=True)["status"] == "ok"
    assert tmp_db.status()["etf_count"] == 3


def test_two_consecutive_refusals_emit_one_alert(tmp_db, monkeypatch):
    calls = []
    monkeypatch.setattr(tmp_db.chart_health_alerts, "emit",
                        lambda *a, **k: calls.append(a) or True)
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(n_etf=10))
    tmp_db.rebuild(trigger="test")
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows(n_etf=1))
    tmp_db.rebuild(trigger="test"); tmp_db.rebuild(trigger="test"); tmp_db.rebuild(trigger="test")
    assert len(calls) == 1 and calls[0][0] == "ssetf_rebuild_refused"


def test_override_add_and_exclude(tmp_db, monkeypatch):
    with tmp_db._write_conn() as c:
        c.execute("INSERT INTO overrides VALUES ('LG00','exclude',NULL,NULL,NULL,NULL,1)")
        c.execute("INSERT INTO overrides VALUES ('NEWZ','add','NBIS','short',2.0,NULL,1)")
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    tmp_db.rebuild(trigger="test")
    fam = tmp_db.lookup("NBIS")
    assert all(r["ticker"] != "LG00" for r in fam["long"])
    assert fam["best_short"] == "NEWZ"          # injected despite absence from export


def test_quarantine_rewrite(tmp_db, monkeypatch):
    rows = _mkrows()
    rows.append({"Ticker": "QQ01", "Company": "Corgi NBIS 2x Daily ETF",  # no direction
                 "Sector": "Financial", "Industry": "Exchange Traded Fund",
                 "Average Volume": "100,000", "Price": "20.00"})
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: rows)
    tmp_db.rebuild(trigger="test")
    assert any(q["etf_ticker"] == "QQ01" for q in tmp_db.status()["quarantine"])
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    tmp_db.rebuild(trigger="test")
    assert tmp_db.status()["quarantine"] == []   # derived data: rewritten per run


def test_error_path_stamps_status_and_keeps_table(tmp_db, monkeypatch):
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", lambda: _mkrows())
    assert tmp_db.rebuild(trigger="test")["status"] == "ok"
    # malformed add override: NULL underlying violates etfs NOT NULL at swap time
    with tmp_db._write_conn() as c:
        c.execute("INSERT INTO overrides VALUES ('BADZ','add',NULL,NULL,NULL,NULL,1)")
    rec = tmp_db.rebuild(trigger="test")
    assert rec["status"] == "error" and rec.get("error")
    st = tmp_db.status()
    assert st["last_status"] == "error"
    assert st["etf_count"] == 10          # previous table fully intact (atomic)


def test_concurrent_rebuild_single_flight(tmp_db, monkeypatch):
    import threading as th
    started, release = th.Event(), th.Event()
    def slow_fetch():
        started.set(); release.wait(timeout=5); return _mkrows()
    monkeypatch.setattr(tmp_db, "_fetch_finviz_market", slow_fetch)
    results = {}
    t1 = th.Thread(target=lambda: results.update(a=tmp_db.rebuild(trigger="t1")))
    t1.start(); started.wait(timeout=5)
    results["b"] = tmp_db.rebuild(trigger="t2")
    release.set(); t1.join(timeout=10)
    assert results["b"]["status"] == "already_running"
    assert results["a"]["status"] == "ok"


def test_backfill_uses_bars_sqlite(tmp_db, monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars",
                        lambda t, tf, n: [(1, 1, 1, 1, 10.0, 1000), (2, 1, 1, 1, 20.0, 2000)])
    assert tmp_db._backfill_dollar_vol("NEWZ") == (10.0 * 1000 + 20.0 * 2000) / 2


def test_backfill_none_on_empty_or_error(tmp_db, monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda t, tf, n: [])
    assert tmp_db._backfill_dollar_vol("NEWZ") is None
    monkeypatch.setattr(bars_sqlite, "get_bars",
                        lambda t, tf, n: (_ for _ in ()).throw(RuntimeError()))
    assert tmp_db._backfill_dollar_vol("NEWZ") is None


def test_self_heal_no_empty_table_cooldown_bypass(tmp_db, monkeypatch):
    fired = []
    monkeypatch.setattr(tmp_db, "_spawn_rebuild", lambda trig: fired.append(trig))
    tmp_db._meta_set("last_attempt_at", int(__import__("time").time()) - 60)  # 1 min ago
    tmp_db._maybe_self_heal()      # empty table, but attempt 1 min ago -> NO spawn
    assert fired == []
    tmp_db._meta_set("last_attempt_at", int(__import__("time").time()) - 400)  # >5 min
    tmp_db._maybe_self_heal()
    assert fired == ["self_heal"]
