"""⛔⛔ ISOLATION PROOF -- economic series never enter the stock-bars machinery.

Owner: "do not run stock-bars add-ons against econ sources". An `ECON:` id routed
through the bars lane would reach the provider fetch (a Massive call for a symbol
that cannot exist), the delisted lookup, the add-today append, tail status, the
market-calendar gap filling, the proxies and the warm pools -- and could only ever
come back as fabricated or empty candles.

Each system below is proven two ways where it matters: the guarded path touches
NOTHING (every downstream hook is replaced by a recorder), and a NEGATIVE CONTROL
with the guard removed shows the recorder would have caught it.
"""
from __future__ import annotations

import ast
import re
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[2]
ECON_IDS = ["ECON:USCPI", "econ:USCPI", "Econ:uscpi", "ECON:NOPE", " ECON:USCPI"]


# ── /api/bars, /api/bars-history, /api/bars/warm, serve_bars (the tier's entry) ─

@pytest.fixture
def bars(monkeypatch):
    """The bars router with EVERY downstream hook replaced by a recorder."""
    from api.routers import bars as B
    from api.services import bars_fetch as BF
    from api.services import delisted_registry
    calls: list[str] = []

    def rec(name):
        def f(*a, **k):
            calls.append(name)
            raise AssertionError(f"econ reached {name}")
        return f

    for name in ("_get_bars_inner", "_get_bars_since_response", "_get_bars_to_response",
                 "_augment_daily_with_today", "_augment_with_tail_status", "_augment_with_bar_close_state",
                 "fetch_index_bars", "_proxy_bars_to_tier", "_proxy_bars_history_to_worker",
                 "_bars_proxy_should_route", "_is_market_indicator"):
        monkeypatch.setattr(B, name, rec(name))
    for name in ("_get_bars_inner", "serve_warm_from_cache", "kick_snapshot_warm", "set_request_interactive",
                 "_get_delisted_bars_response", "warm_bars_async"):
        monkeypatch.setattr(BF, name, rec("bars_fetch." + name))
    monkeypatch.setattr(delisted_registry, "resolve", rec("delisted_registry.resolve"))
    # every proxy armed: the guard must answer BEFORE any routing decision
    monkeypatch.setenv("BARS_ORIGIN_URL", "http://tier.invalid")
    monkeypatch.setenv("BARS_PROXY_ENABLED", "1")
    monkeypatch.setenv("BARS_PROXY_PCT", "100")
    monkeypatch.setenv("BARS_HISTORY_ORIGIN_URL", "http://worker.invalid")
    monkeypatch.setenv("BARS_HISTORY_PROXY_ENABLED", "1")
    from api.bars_auth import require_bars_access
    app = FastAPI()
    app.include_router(B.router)
    app.dependency_overrides[require_bars_access] = lambda: {"id": 1, "plan": "pro"}
    return B, TestClient(app, raise_server_exceptions=False), calls


@pytest.mark.parametrize("sym", ["ECON:USCPI", "econ:USCPI", "ECON%3AUSCPI", "ECON:NOPE"])
@pytest.mark.parametrize("tf", ["D", "5", "W"])
def test_api_bars_econ_is_an_explicit_404_before_anything(bars, sym, tf):
    B, c, calls = bars
    r = c.get(f"/api/bars/{sym}?tf={tf}")
    assert r.status_code == 404
    assert r.json()["error"] == "economic series are served by /api/econ"
    assert r.headers["cache-control"] == "no-store"
    assert calls == []


@pytest.mark.parametrize("sym", ["ECON:USCPI", "econ:uscpi"])
def test_api_bars_history_econ_is_404_and_never_proxied(bars, sym):
    B, c, calls = bars
    assert c.get(f"/api/bars-history/{sym}?tf=D").status_code == 404
    assert calls == []


@pytest.mark.parametrize("sym", ECON_IDS)
def test_serve_bars_core_refuses_econ(bars, sym):
    """`serve_bars` is what the bars-api TIER and in-process callers call directly."""
    B, _, calls = bars
    for fn in (lambda: B.serve_bars(sym, "D"), lambda: B.serve_bars(sym, "5", since="1"),
               lambda: B.serve_bars(sym, "D", to="2026-01-01"), lambda: B.serve_bars(sym, "D", warm=1),
               lambda: B.serve_bars_history(sym, "D")):
        assert fn().status_code == 404
    assert calls == []


def test_warm_endpoint_never_kicks_econ(bars):
    B, c, calls = bars
    r = c.post("/api/bars/warm", json={"ticker": "ECON:USCPI", "tf": "D"})
    assert r.json() == {"ok": True, "kicked": False} and calls == []


def test_NEGATIVE_CONTROL_without_the_guard_econ_reaches_the_stock_machinery(bars, monkeypatch):
    """Remove the guard: the same request reaches the add-ons / provider path, and the
    recorders see it. This is what the tests above would catch."""
    B, c, calls = bars
    monkeypatch.setattr(B, "is_econ_symbol", lambda t: False)
    c.get("/api/bars/ECON:USCPI?tf=D")
    assert calls, "the recorder must see the unguarded path"


def test_is_econ_symbol_shape():
    from api.routers.bars import is_econ_symbol
    for s in ECON_IDS:
        assert is_econ_symbol(s)
    for s in ("USCPI", "AAPL", "US:MCO", "$IDX:ai", "UCTA50", "ECONX", "", None, "SECON:X"):
        assert not is_econ_symbol(s)


# ── delisting cleanup (watchlist_prebuilt) ─────────────────────────────────

def test_prebuilt_delist_cleanup_exempts_econ_ids(monkeypatch):
    from api.services import watchlist_prebuilt as W
    for s in ECON_IDS:
        assert W._is_synthetic_ticker(s)
    monkeypatch.setattr(W, "_read_overlay", lambda: {"delisted": ["ECON:USCPI", "DEAD"]})
    out = W._apply_overlay([{"name": "Macro", "tickers": ["ECON:USCPI", "DEAD", "AAPL"]}])
    assert out[0]["tickers"] == ["ECON:USCPI", "AAPL"]


# ── watchlist warm paths (web list-open, worker prewarm ring, seeder) ───────

def _auth_db(tmp_path):
    p = tmp_path / "auth.db"
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE watchlist_items (sym TEXT)")
    c.execute("CREATE TABLE ticker_tags (sym TEXT)")
    c.executemany("INSERT INTO watchlist_items VALUES (?)", [("AAPL",), ("ECON:USCPI",), ("econ:USUNRATE",)])
    c.execute("INSERT INTO ticker_tags VALUES ('ECON:USGDP')")
    c.commit(); c.close()

    def conn():
        k = sqlite3.connect(p)
        k.row_factory = sqlite3.Row
        return k
    return conn


def test_watchlist_open_never_warms_econ(monkeypatch):
    from api.middleware.auth_middleware import get_current_user
    from api.routers import bars as B
    from api.routers import watchlists as WL
    warmed = []
    monkeypatch.setattr(B, "warm_bars_async", lambda t, **k: warmed.extend(t))
    items = [{"id": "1", "sym": "ECON:USCPI"}, {"id": "2", "sym": "aapl"}, {"id": "3", "sym": "econ:USGDP"}]
    monkeypatch.setattr(WL.watchlist_service, "get_watchlist", lambda wl, uid: {"id": wl, "items": items})
    monkeypatch.setattr(WL.watchlist_service, "get_or_create_flagged_list", lambda uid: {"items": items})
    app = FastAPI(); app.include_router(WL.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1"}
    c = TestClient(app)
    assert c.get("/api/watchlists/w1").status_code == 200
    assert c.get("/api/watchlists/flagged").status_code == 200
    assert warmed == ["AAPL", "AAPL"]


def test_worker_prewarm_ring_never_collects_econ(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.services import bars_prewarm
    monkeypatch.setattr(auth_db, "get_connection", _auth_db(tmp_path))
    assert bars_prewarm._collect_watchlist_and_tag_tickers() == {"AAPL"}


def test_seeder_tier2_never_seeds_econ(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.services import bars_seeder
    monkeypatch.setattr(auth_db, "get_connection", _auth_db(tmp_path))
    out = bars_seeder._build_tier2(set())
    assert "AAPL" in out and not any(s.upper().startswith("ECON:") for s in out)


# ── universe builders: econ ids and econ display symbols are not in them ────

def test_universes_carry_no_econ_symbols(monkeypatch):
    from api.services import bars_fetch, bars_universe_crawler, cap_universe
    from api.services import breadth_monitor
    from api.services.econ import registry as R
    monkeypatch.setattr(breadth_monitor, "get_latest", lambda: None)
    econ_display = {e["symbol"] for e in R.load_registry() if e["status"] == "enabled"}
    for name, uni in (("cap_universe", cap_universe.symbols()), ("etfs", cap_universe.etf_symbols()),
                      ("warm-universe", bars_fetch._build_universe_ticker_list()),
                      ("crawler", bars_universe_crawler.load_universe())):
        u = {str(s).upper() for s in uni}
        assert u, name
        assert not {s for s in u if s.startswith("ECON:")}, name
        assert not (u & econ_display), f"{name} carries an enabled econ display symbol"


def test_no_stock_bars_module_imports_the_econ_package():
    """The prewarm/crawler/seeder/warm/bars modules cannot enumerate the econ registry."""
    targets = ["api/routers/bars.py", "api/services/bars_fetch.py", "api/services/bars_prewarm.py",
               "api/services/bars_seeder.py", "api/services/bars_universe_crawler.py",
               "api/services/deep_history_warm.py", "api/services/barspack.py", "api/bars_api_main.py"]
    for rel in targets:
        for mod in _imports(REPO / rel):
            assert not mod.startswith("api.services.econ"), f"{rel} imports {mod}"


# ── the econ door imports nothing from the bars machinery ──────────────────

FORBIDDEN_FOR_ECON = ("api.routers.bars", "api.services.bars", "api.bars_api_main", "api.index_bars",
                      "api.services.massive", "api.services.market_calendar", "api.services.todaypack",
                      "api.services.delisted_registry", "api.services.intraday", "api.services.tail",
                      "api.services.breadth", "api.services.market_indicators", "api.services.barspack")


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = set()
    pkg = ".".join(path.relative_to(REPO).with_suffix("").parts[:-1])
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            out |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            base = n.module or ""
            if n.level:
                parts = pkg.split(".")[: len(pkg.split(".")) - (n.level - 1)]
                base = ".".join(parts + ([base] if base else []))
            out.add(base)
            out |= {f"{base}.{a.name}" for a in n.names}
    return out


@pytest.mark.parametrize("rel", ["api/routers/econ.py", "api/services/econ/serving.py",
                                 "api/services/econ/publish.py"])
def test_econ_serving_imports_nothing_from_bars(rel):
    bad = [m for m in _imports(REPO / rel) if m.startswith(FORBIDDEN_FOR_ECON)]
    assert not bad, f"{rel} imports stock-bars machinery: {bad}"
    allowed_ext = {m for m in _imports(REPO / rel) if m.startswith("api.") and not m.startswith("api.services.econ")}
    assert allowed_ext <= {"api.bars_auth", "api.bars_auth.require_bars_access", "api.services",
                           "api.services.data_sync"}, allowed_ext


def test_NEGATIVE_CONTROL_import_census_sees_a_bars_import(tmp_path, monkeypatch):
    fake = REPO / "api" / "routers" / "_econ_isolation_probe.py"
    fake.write_text("from api.routers.bars import serve_bars\nfrom .bars import is_econ_symbol\n", encoding="utf-8")
    try:
        mods = _imports(fake)
        assert any(m.startswith(FORBIDDEN_FOR_ECON) for m in mods)
        assert "api.routers.bars.is_econ_symbol" in mods          # relative import resolved
    finally:
        fake.unlink()


# ── Cloudflare edge router ─────────────────────────────────────────────────

WORKER = REPO / "edge" / "bars-edge-router" / "worker.js"


def _edge_regex() -> re.Pattern:
    src = WORKER.read_text(encoding="utf-8")
    m = re.search(r"url\.pathname\.match\(/(.+?)/\);", src)
    assert m, "the worker's path match must stay a regex literal"
    return re.compile(m.group(1).replace("\\/", "/"))


@pytest.mark.parametrize("path", ["/api/econ/catalog", "/api/econ/series/USCPI", "/api/econ/series/ECON:USCPI",
                                  "/api/econ/status", "/api/economics/x"])
def test_edge_never_intercepts_the_econ_api(path):
    assert _edge_regex().match(path) is None


def test_edge_routes_an_econ_symbol_on_the_bars_path_to_web():
    """If `/api/bars/ECON:X` ever hits the edge it goes to WEB (the colon rule), where
    the guard above answers 404 -- never to the bars tier's provider path."""
    assert _edge_regex().match("/api/bars/ECON:USCPI")
    src = WORKER.read_text(encoding="utf-8")
    m = re.search(r"const isBreadth\s*=(.*?);", src, re.S)
    assert m and 'ticker.includes(":")' in m.group(1)
    assert "if (isBreadth) return fetch(target(WEB_ORIGIN), opts);" in src
    assert "/api/econ" not in src
    pkg = (REPO / "edge" / "bars-edge-router" / "package.json").read_text(encoding="utf-8")
    assert "/api/bars/*" in pkg and "econ" not in pkg


# ── ticker search: econ rows only on the enabled + entitled path (Phase 2) ──
#
# Phase 1 rail ("search never reads the econ registry") REPLACED by the Phase 2
# contract: `/api/ticker-search` may read the econ catalogue ONLY when
# ECON_ENABLED=1 AND the caller passes the bars entitlement (`meets_plan_gate`,
# the same rule as `require_bars_access`). Flag unset / anonymous / free: no econ
# row, and the econ serving layer is not touched at request time. The stock
# symbol-search INDEX (`ticker_search_index`) never imports econ at all.

def test_symbol_search_INDEX_never_imports_econ_and_the_router_only_lazily():
    hits = [p for p in (REPO / "api").rglob("*search*.py")
            if any(m.startswith("api.services.econ") for m in _imports(p))]
    assert [h.relative_to(REPO).as_posix() for h in hits] == ["api/routers/ticker_search.py"]
    # every econ import in the router is FUNCTION-LOCAL (read at request time on the
    # gated path only), never a module-level import
    tree = ast.parse((REPO / "api/routers/ticker_search.py").read_text(encoding="utf-8"))
    top = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    assert not any((getattr(n, "module", "") or "").startswith("api.services.econ")
                   or any(a.name.startswith("api.services.econ") for a in n.names) for n in top)


class _Tripwire:
    def __init__(self):
        self.touched = []

    def __getattr__(self, name):
        self.touched.append(name)
        raise AssertionError(f"econ serving touched at request time: {name}")


@pytest.fixture
def search_client(monkeypatch):
    import sys
    import api.bars_auth as bars_auth
    import api.routers.ticker_search as ts
    import api.services.econ as econ_pkg
    wire = _Tripwire()
    monkeypatch.setattr(econ_pkg, "serving", wire, raising=False)
    monkeypatch.setitem(sys.modules, "api.services.econ.serving", wire)

    def as_(user):
        for mod in (bars_auth, ts):
            monkeypatch.setattr(mod, "validate_session", lambda _t, _u=user: dict(_u) if _u else None)
            monkeypatch.setattr(mod, "get_user_plan", lambda _i, _u=user: (_u or {}).get("plan", "free"))
    app = FastAPI()
    app.include_router(ts.router)
    return TestClient(app), wire, as_


_PAID = {"id": "p", "email": "p@x", "role": "member", "plan": "pro"}
_FREE = {"id": "f", "email": "f@x", "role": "member", "plan": "free"}


def _search(client, user, **params):
    return client.get("/api/ticker-search", params={"q": "CPI", "limit": 20, **params},
                      cookies={"uct_session": "t"} if user else {})


@pytest.mark.parametrize("flag,user", [(None, _PAID), (None, None), ("1", None), ("1", _FREE)],
                         ids=["dark-paid", "dark-anon", "on-anon", "on-free"])
def test_search_never_touches_econ_unless_enabled_AND_entitled(search_client, monkeypatch, flag, user):
    client, wire, as_ = search_client
    if flag:
        monkeypatch.setenv("ECON_ENABLED", flag)
    else:
        monkeypatch.delenv("ECON_ENABLED", raising=False)
    as_(user)
    for params in ({}, {"type": "all_economic"}, {"type": "economic"}):
        r = _search(client, user, **params)
        assert r.status_code == 200
        assert not any(str(x.get("ticker", "")).startswith("ECON:") or x.get("type") == "economic"
                       for x in r.json()["results"])
    assert wire.touched == []


def test_NEGATIVE_CONTROL_enabled_and_entitled_does_read_the_catalogue(search_client, monkeypatch):
    """The tripwire must fire on the one path allowed to read econ — proving the
    test above would catch a leak rather than passing vacuously."""
    client, wire, as_ = search_client
    monkeypatch.setenv("ECON_ENABLED", "1")
    as_(_PAID)
    r = _search(client, _PAID, type="economic")
    assert r.status_code == 200 and r.json() == {"results": []}   # the tripwire's refusal is swallowed (fail closed)
    assert wire.touched == ["catalog"]
