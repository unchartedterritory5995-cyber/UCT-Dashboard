"""TERMINAL-NEXT lane T3 -- the command grammar's server half.

Rails, each failing for its own reason:
  * telemetry is COUNTS ONLY: a key that could carry free text is refused and stored nowhere;
  * every read and write is OWNER-SCOPED: member B never sees or resets member A's rows;
  * an alias may never shadow a real ticker (409), and the refusal stores nothing;
  * MOVE diffs against the member's own last visit, and an outage is reported, not read as quiet;
  * every route carries BOTH gates (paid 402 + the terminal-next cohort mark);
  * and the dark flag: with TERMINAL_GRAMMAR_ENABLED unset every route is a 404.

NO NETWORK: every outbound service is monkeypatched.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import get_current_user_with_plan  # noqa: E402
from api.routers import terminal_grammar as router_mod  # noqa: E402
from api.services import rollout_gate as rg  # noqa: E402
from api.services import terminal_grammar as tg  # noqa: E402

A = {"id": "t3-member-a", "email": "a@example.test", "role": "admin"}
B = {"id": "t3-member-b", "email": "b@example.test", "role": "admin"}
FREE = {"id": "t3-free", "email": "f@example.test", "role": "member"}


@pytest.fixture(autouse=True)
def _clean_rows():
    conn = tg._conn()
    try:
        for t in ("terminal_command_counts", "terminal_aliases", "terminal_visits"):
            conn.execute(f"DELETE FROM {t} WHERE user_id LIKE 't3-%'")
        conn.commit()
    finally:
        conn.close()
    yield


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("TERMINAL_GRAMMAR_ENABLED", "1")
    app = FastAPI()
    app.include_router(router_mod.router)
    state = {"user": A}
    app.dependency_overrides[get_current_user_with_plan] = lambda: state["user"]
    app.dependency_overrides[rg.require_terminal_next] = lambda: state["user"]
    return TestClient(app), state


# ── telemetry ───────────────────────────────────────────────────────────────────

def test_counts_accumulate_per_key_and_per_member(client):
    c, state = client
    for _ in range(3):
        assert c.post("/api/terminal/commands/event", json={"key": "gp"}).status_code == 200
    c.post("/api/terminal/commands/event", json={"key": "SEMIS"})
    stats = c.get("/api/terminal/commands/stats").json()["stats"]
    assert stats["GP"]["n"] == 3 and stats["SEMIS"]["n"] == 1
    state["user"] = B
    assert c.get("/api/terminal/commands/stats").json()["stats"] == {}


@pytest.mark.parametrize("key", ["NVDA GP", "why is it up", "gp?", "1GP", "$NVDA", "a" * 17])
def test_a_key_that_could_carry_free_text_is_refused_and_stored_nowhere(client, key):
    c, _ = client
    r = c.post("/api/terminal/commands/event", json={"key": key})
    assert r.status_code in (400, 422)
    assert tg.command_stats(A["id"]) == {}


def test_the_distinct_key_ceiling_holds(monkeypatch):
    monkeypatch.setattr(tg, "MAX_KEYS_PER_MEMBER", 2)
    assert tg.record_event(A["id"], "GP") and tg.record_event(A["id"], "FA")
    assert tg.record_event(A["id"], "CN") is False
    assert tg.record_event(A["id"], "GP") is True          # an existing key still counts
    assert set(tg.command_stats(A["id"])) == {"GP", "FA"}


def test_reset_forgets_the_callers_counts_only(client):
    c, state = client
    tg.record_event(A["id"], "GP")
    tg.record_event(B["id"], "GP")
    assert c.delete("/api/terminal/commands/stats").json() == {"reset": 1}
    assert tg.command_stats(A["id"]) == {}
    assert tg.command_stats(B["id"])["GP"]["n"] == 1


# ── aliases ─────────────────────────────────────────────────────────────────────

def test_alias_roundtrip_is_owner_scoped(client, monkeypatch):
    monkeypatch.setattr(tg, "_is_known_ticker", lambda n: False)
    c, state = client
    assert c.put("/api/terminal/aliases/semis", json={"expansion": "SMH   GP"}).json() == \
        {"name": "SEMIS", "expansion": "SMH GP"}
    assert c.get("/api/terminal/aliases").json() == {"aliases": {"SEMIS": "SMH GP"}}
    state["user"] = B
    assert c.get("/api/terminal/aliases").json() == {"aliases": {}}
    assert c.delete("/api/terminal/aliases/SEMIS").status_code == 404
    state["user"] = A
    assert c.delete("/api/terminal/aliases/SEMIS").status_code == 200
    assert tg.list_aliases(A["id"]) == {}


def test_an_alias_named_after_a_real_ticker_is_refused_and_not_stored(client, monkeypatch):
    monkeypatch.setattr(tg, "_is_known_ticker", lambda n: n == "NVDA")
    c, _ = client
    r = c.put("/api/terminal/aliases/NVDA", json={"expansion": "SMH GP"})
    assert r.status_code == 409 and "real ticker" in r.json()["detail"]
    assert tg.list_aliases(A["id"]) == {}


def test_the_ticker_check_reads_the_real_universe():
    """CONTROL for the monkeypatched tests: the unpatched check answers from the universe."""
    from api.routers.ticker_search import _UNIVERSE
    assert _UNIVERSE, "universe empty -- the refusal would be vacuous"
    assert tg._is_known_ticker(_UNIVERSE[0]) is True
    assert tg._is_known_ticker("ZZQX9") is False


# ── MOVE / since last visit ──────────────────────────────────────────────────────

def _patch_sources(monkeypatch, facts, catalysts, *, intel_raises=False):
    import api.services.watchlist_intelligence as wi
    from api.services.catalyst import store

    def fake_intel(tickers, changes=None, observed=None):
        if intel_raises:
            raise RuntimeError("vendor down")
        return {t: {"status": "ok", "notable": bool(facts), "facts": list(facts), "context": {}} for t in tickers}
    monkeypatch.setattr(wi, "get_intelligence_for_symbols", fake_intel)
    monkeypatch.setattr(store, "history_for_ticker", lambda s, limit=50: list(catalysts))


def test_move_says_what_is_new_since_the_members_last_visit(client, monkeypatch):
    c, state = client
    f1 = {"kind": "filing", "label": "8-K", "as_of": "2026-10-01"}
    _patch_sources(monkeypatch, [f1], [])
    first = c.get("/api/terminal/move/nvda").json()
    assert first["sym"] == "NVDA" and first["since_last_visit"]["first_visit"] is True
    f2 = {"kind": "analyst", "label": "Upgrade", "as_of": "2026-10-02"}
    _patch_sources(monkeypatch, [f1, f2], [{"market_date": "2026-10-02", "tag": "Catalyst"}])
    second = c.get("/api/terminal/move/NVDA").json()
    assert second["since_last_visit"]["first_visit"] is False
    assert second["since_last_visit"]["new"] == ["analyst|Upgrade|2026-10-02", "cat|2026-10-02|Catalyst"]
    # Member B's first visit is THEIR first visit.
    state["user"] = B
    assert c.get("/api/terminal/move/NVDA").json()["since_last_visit"]["first_visit"] is True


def test_move_reports_an_outage_rather_than_a_quiet_tape(client, monkeypatch):
    c, _ = client
    _patch_sources(monkeypatch, [], [], intel_raises=True)
    body = c.get("/api/terminal/move/NVDA").json()
    assert body["intelligence"]["status"] == "unavailable"


def test_move_refuses_a_non_ticker(client):
    c, _ = client
    assert c.get("/api/terminal/move/12AB").status_code == 400


# ── V18 sector target ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("sector,etf", [("Technology", "XLK"), ("Financial Services", "XLF"),
                                        ("Consumer Cyclical", "XLY"), ("Basic Materials", "XLB"), (None, None)])
def test_sector_etf_mapping_covers_yfinance_spellings(sector, etf):
    assert tg.sector_etf_for(sector) == etf


def test_compare_target_route(client, monkeypatch):
    import api.services.fundamentals as fund
    c, _ = client
    monkeypatch.setattr(fund, "get_fundamentals", lambda s: {"sector": "Technology"})
    assert c.get("/api/terminal/compare-target?sym=nvda").json()["comparator"] == "XLK"
    monkeypatch.setattr(fund, "get_fundamentals", lambda s: {"sector": "Shipping"})
    assert c.get("/api/terminal/compare-target?sym=ZIM").status_code == 404


# ── the gates ───────────────────────────────────────────────────────────────────

def test_a_free_member_is_refused_402(client):
    c, state = client
    state["user"] = FREE
    assert c.get("/api/terminal/commands/stats").status_code == 402


def test_every_route_carries_the_terminal_next_cohort_gate():
    app = FastAPI()
    app.include_router(router_mod.router)
    gated = set(rg.cohort_gated_routes(app, rg.TERMINAL_NEXT_COHORT))
    served = {(m, r.path) for r in app.routes if r.path.startswith("/api/terminal/")
              for m in r.methods}
    assert served and gated == served


#: Every route the router serves, with a request that would otherwise succeed or validate.
_ALL_ROUTES = [
    ("post", "/api/terminal/commands/event", {"json": {"key": "GP"}}),
    ("get", "/api/terminal/commands/stats", {}),
    ("delete", "/api/terminal/commands/stats", {}),
    ("get", "/api/terminal/aliases", {}),
    ("put", "/api/terminal/aliases/SEMIS", {"json": {"expansion": "SMH GP"}}),
    ("delete", "/api/terminal/aliases/SEMIS", {}),
    ("get", "/api/terminal/move/NVDA", {}),
    ("get", "/api/terminal/compare-target?sym=NVDA", {}),
]


@pytest.mark.parametrize("method,path,kw", _ALL_ROUTES)
def test_the_dark_flag_unset_makes_every_route_a_404_and_writes_nothing(client, monkeypatch, method, path, kw):
    c, _ = client
    monkeypatch.delenv("TERMINAL_GRAMMAR_ENABLED", raising=False)
    r = getattr(c, method)(path, **kw)
    assert r.status_code == 404, f"{method.upper()} {path} answered {r.status_code} with the flag OFF"
    assert tg.command_stats(A["id"]) == {} and tg.list_aliases(A["id"]) == {}


def test_the_census_of_routes_is_complete():
    """The dark-flag rail above must name EVERY served route, or one could escape it."""
    app = FastAPI()
    app.include_router(router_mod.router)
    served = {(m, r.path) for r in app.routes if r.path.startswith("/api/terminal/") for m in r.methods}
    named = {(m.upper(), path.split("?")[0].replace("/SEMIS", "/{name}").replace("/NVDA", "/{sym}"))
             for m, path, _ in _ALL_ROUTES}
    assert named == served
