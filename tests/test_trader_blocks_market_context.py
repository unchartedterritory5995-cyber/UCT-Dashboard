"""P2a market context stamp (spec §P2 item 3), on the EXISTING marketcontext widget (IR-S6).
Hermetic: every source is patched at trader_blocks' own seams (pre-flight S22), except in the
R-W0-1 rails below, which run the REAL seams against cold and warm local holds and record any
reach toward a vendor."""
from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

NOW = datetime(2026, 10, 13, 17, 26, tzinfo=timezone.utc)          # 1:26 PM ET (EDT)
MODEL = Path("app/src/pages/charts/widgets/marketContextModel.js")
BREADTH = {"market_phase": "Uptrend", "exposure": {"score": 32.04, "score_delta": -4.0},
           "breadth_score": 47.56, "distribution_days": 3, "pct_above_50ma": 41.26,
           "pct_above_200ma": 55.0, "wire_date": "2026-10-13"}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def sources(monkeypatch):
    """Every market source, patched at trader_blocks' seams. Tests change the dict to vary them."""
    from api.services.journal_two import trader_blocks as tb
    s = {"breadth": dict(BREADTH),
         "regime": {"value": "orange", "source": "UCT Exposure Rating", "asOf": "2026-10-13",
                    "missing": None, "detail": None},
         "quotes": {"SPY": {"price": 600.5, "change_pct": -0.42, "observed_at": 1791912360, "market_closed": False}}}
    monkeypatch.setattr(tb, "_breadth", lambda: s["breadth"])
    monkeypatch.setattr(tb, "_regime_field", lambda memo: s["regime"])
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols: s["quotes"])
    return s


def _client_readings(payload: dict) -> dict:
    node = shutil.which("node")
    assert node, "node is not on PATH"
    js = (f"import({json.dumps(MODEL.resolve().as_uri())}).then((m) => "
          f"process.stdout.write(JSON.stringify(m.readingsFrom({json.dumps(payload)}))))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    return json.loads(r.stdout.decode("utf-8"))


@pytest.mark.parametrize("payload", [
    BREADTH,
    {},
    {"market_phase": "", "exposure": {"score": None}, "breadth_score": "x", "distribution_days": None},
    # 101.25 * 10 = 1012.5: JavaScript's Math.round gives 1013, Python's round() gives 1012 (it rounds
    # half to even). This row is what makes the rail able to see the two roundings differ.
    {"exposure": {"score": 101.25, "score_delta": 0.05}, "pct_above_50ma": 9.99, "pct_above_200ma": True},
])
def test_readings_mirror_the_client_derivation(payload):
    """ONE FACT IN TWO FILES: the server's readings_from and the client's readingsFrom, run on the SAME
    payload, answer the same keys and values (a /charts capture and a note stamp read identically)."""
    from api.services.journal_two import trader_blocks as tb
    client = _client_readings(payload)
    assert client                                                          # non-vacuity
    assert tb.readings_from(payload) == client


def test_params_carry_the_readings_and_the_sourced_fields(sources):
    from api.services.journal_two import trader_blocks as tb
    p = tb.market_context_params({}, user_id="u1", now=NOW)
    r = p["readings"]
    assert r["exposureScore"] == 32.0 and r["breadthScore"] == 47.6 and r["marketPhase"] == "Uptrend"
    assert r["regime"] == {"value": "orange", "source": "UCT Exposure Rating", "asOf": "2026-10-13", "missing": None}
    assert r["spy"]["value"] == {"price": 600.5, "changePct": -0.42, "closed": False}
    assert r["spy"]["asOf"] == "2026-10-13T17:26:00Z"
    assert r["qqq"] == {"value": None, "source": None, "asOf": None, "missing": "No QQQ quote could be read just now."}
    assert r["vix"] == {"value": None, "source": None, "asOf": None, "missing": "VIX unavailable"}
    assert p["wireDate"] == "2026-10-13" and p["updated"] == "1:26 PM ET"


def test_a_missing_source_is_a_sentence_never_an_object(sources):
    """IR-S4: entry_context answers `detail` as a DICT on a cold breadth; nothing stored may be one."""
    from api.services.journal_two import trader_blocks as tb
    sources["regime"] = {"value": None, "source": "uct_regime", "asOf": None, "missing": "wire_unavailable",
                         "detail": {"liveUnavailable": "cold"}}
    sources["quotes"] = {}
    r = tb.market_context_params({}, user_id="u1", now=NOW)["readings"]
    for key in ("regime", "spy", "qqq", "vix"):
        assert isinstance(r[key]["missing"], str) and r[key]["missing"], key
        assert "detail" not in r[key], key
    assert r["regime"]["missing"] == "The morning wire has not published an exposure rating yet."


def test_a_create_captures_and_an_update_does_not(sources, monkeypatch):
    """IR-S11: 'Update layout' must never stamp today's market into an older note."""
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    block = {"block": "marketcontext", "enabled": True, "settings": {"fields": "regime"}}
    node, reason = js.BLOCK_BUILDERS["marketcontext"](block, {"ticker": None, "now": NOW, "memo": {},
                                                               "mode": "create", "user_id": "u1"})
    assert reason is None and node["attrs"]["widgetId"] == "marketcontext"
    assert node["attrs"]["params"]["fields"] == "regime" and node["attrs"]["params"]["readings"]["regime"]["value"] == "orange"
    monkeypatch.setattr(tb, "market_context_params", lambda *a, **k: pytest.fail("an update must read nothing"))
    node, _ = js.BLOCK_BUILDERS["marketcontext"](block, {"ticker": None, "now": NOW, "memo": {},
                                                          "mode": "update", "user_id": "u1"})
    assert node["attrs"]["params"] == {"uncaptured": True, "fields": "regime"}


def test_the_stamp_node_is_buildable(sources, db_path):
    """Both the captured stamp (a create) and the uncaptured one (an update writes it) pass the
    note store's own build check."""
    from api.services.journal_two import journal_styles as js, notes
    for mode in ("create", "update"):
        node, _ = js.BLOCK_BUILDERS["marketcontext"]({"block": "marketcontext", "settings": {}},
                                                      {"ticker": None, "now": NOW, "memo": {}, "mode": mode,
                                                       "user_id": "u1"})
        notes._refuse_unbuildable(notes._validate_body_json({"type": "doc", "content": [node]}))


def test_route_off_free_paid(db_path, sources, monkeypatch):
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    url = "/api/j2/trader-blocks/market-context"
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", raising=False)
    assert TestClient(app).get(url).status_code == 404
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "free"}
    assert TestClient(app).get(url).status_code == 402
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    got = TestClient(app).get(url)
    assert got.status_code == 200 and got.json()["readings"]["regime"]["value"] == "orange"


# ── R-W0-1: the composer's market read is CACHE-ONLY ─────────────────────────────────────────────
# A note create never makes a blocking vendor call. The quotes come from live_prices' shared
# per-ticker cache, else the last close of a HELD daily bar, else a sentence; never get_live_prices'
# bounded fetch (an 8 s valve wait plus an 8 s-per-phase vendor call). The breadth comes from what
# the pod holds (engine's cache, the state file, the pushed wire); a cold engine.get_breadth's next
# step is morning_wire_engine.fetch_breadth, a vendor call with no bound, so it is never asked.
# ⛔ Each vendor door RECORDS its call rather than only raising: market_context_params swallows a
# raising source (one source never takes the stamp down), so a raise alone would read as green.

@pytest.fixture
def held(monkeypatch):
    """Cold local holds, and every vendor door that could be reached from them recording a call."""
    from api.routers import live_prices
    from api.services import bars_sqlite, engine
    from api.services.cache import TTLCache
    calls: list[str] = []

    def door(name):
        def reached(*a, **k):
            calls.append(name)
            raise AssertionError(f"the composer reached {name}")
        return reached

    ns = types.SimpleNamespace(calls=calls, real_get_breadth=engine.get_breadth,
                               engine=engine, live_prices=live_prices, bars_sqlite=bars_sqlite)
    monkeypatch.setattr(engine, "cache", TTLCache())                 # no breadth, no wire_data cached
    monkeypatch.setattr(engine, "_load_state", lambda: {})
    monkeypatch.setattr(engine, "_load_wire_data", lambda: None)
    monkeypatch.setattr(engine, "get_breadth", door("engine.get_breadth on a cold hold (its next step is the live fetch)"))
    fake = types.ModuleType("morning_wire_engine")
    fake.fetch_breadth = door("morning_wire_engine.fetch_breadth")
    monkeypatch.setitem(sys.modules, "morning_wire_engine", fake)
    monkeypatch.setattr(live_prices, "cache", TTLCache(max_size=100))
    for name in ("get_live_prices", "_fetch_snapshots", "_get_client", "_session_closes"):
        monkeypatch.setattr(live_prices, name, door(f"live_prices.{name}"))
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda ticker, tf, n: [])
    return ns


def _create(block_settings=None):
    from api.services.journal_two import journal_styles as js
    node, reason = js.BLOCK_BUILDERS["marketcontext"](
        {"block": "marketcontext", "enabled": True, "settings": block_settings or {}},
        {"ticker": None, "now": NOW, "memo": {}, "mode": "create", "user_id": "u1"})
    assert reason is None
    return node["attrs"]["params"]


def test_a_cold_create_reaches_no_vendor_and_says_why_each_field_is_empty(held):
    p = _create()
    assert held.calls == []
    r = p["readings"]
    assert r["regime"]["missing"] == "The morning wire has not published an exposure rating yet."
    assert r["spy"]["missing"] == "No SPY quote could be read just now."
    assert r["qqq"]["missing"] == "No QQQ quote could be read just now."
    assert r["vix"]["missing"] == "VIX unavailable"
    assert r["marketPhase"] is None and r["exposureScore"] is None and p["wireDate"] is None


def test_a_warm_quote_cache_and_a_held_daily_bar_are_read_and_nothing_else(held, monkeypatch):
    lp, bs, eng = held.live_prices, held.bars_sqlite, held.engine
    lp.cache.set(lp._px_key("SPY"), {"price": 600.5, "change_pct": -0.42, "observed_at": 1791912360,
                                      "market_closed": False}, ttl=60)
    # QQQ is not in the quote cache; its last two DAILY bars are held (ts YYYYMMDD; o, h, l, c, v).
    monkeypatch.setattr(bs, "get_bars", lambda ticker, tf, n: [
        (20261008, 470.0, 482.0, 469.0, 480.0, 1), (20261009, 481.0, 487.0, 479.0, 486.0, 1)]
        if (ticker, tf) == ("QQQ", "D") else [])
    # The wire's breadth is held in engine's cache: the real get_breadth answers from it.
    monkeypatch.setattr(eng, "get_breadth", held.real_get_breadth)
    eng.cache.set("breadth", dict(BREADTH), ttl=60)

    r = _create()["readings"]
    assert held.calls == []
    assert r["spy"] == {"value": {"price": 600.5, "changePct": -0.42, "closed": False},
                        "source": "live price", "asOf": "2026-10-13T17:26:00Z", "missing": None}
    assert r["qqq"] == {"value": {"price": 486.0, "changePct": 1.25, "closed": True},
                        "source": "last close", "asOf": "2026-10-09T20:00:00Z", "missing": None}
    assert r["exposureScore"] == 32.0 and r["marketPhase"] == "Uptrend"
    assert r["regime"]["value"] == "orange" and r["regime"]["asOf"] == "2026-10-13"
    assert r["regime"]["missing"] is None


def test_a_closed_market_cache_row_is_dated_by_its_session_close(held):
    lp = held.live_prices
    lp.cache.set(lp._px_key("SPY"), {"price": 598.0, "change_pct": 0.3, "observed_at": None,
                                      "session_close_at": 1791489600, "market_closed": True}, ttl=60)
    r = _create()["readings"]
    assert held.calls == []
    assert r["spy"]["value"] == {"price": 598.0, "changePct": 0.3, "closed": True}
    assert r["spy"]["asOf"] == "2026-10-08T20:00:00Z"


def test_an_update_layout_on_a_written_note_lands_uncaptured_and_an_empty_switch_captures(
        db_path, held, monkeypatch):
    """R-RC-1 end to end on the real block: preview == apply, an empty note switched to a style is
    create-equivalent (captures), a note with words gets the block UNCAPTURED (no market read)."""
    from api.services.journal_two import journal_styles as js, notes
    lp = held.live_prices
    lp.cache.set(lp._px_key("SPY"), {"price": 600.5, "change_pct": -0.42, "observed_at": 1791912360,
                                      "market_closed": False}, ttl=60)
    s = js.create_style("u1", {"name": "Context", "kindId": "thesis",
        "blocks": [{"block": "marketcontext", "enabled": True, "settings": {"fields": "indexes"}}],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Thesis"}]}]}})

    def stamp(note):
        found = [n for n in note["bodyJson"]["content"] if n.get("type") == "widgetEmbed"]
        assert len(found) == 1
        return found[0]["attrs"]["params"]

    words = notes.create_note("u1", {"title": "mine", "bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "MY WORDS"}]}]}})
    assert js.plan_style_update("u1", words["id"], style_id=s["id"])["mode"] == "update"
    note, _ = js.apply_style_update("u1", words["id"], style_id=s["id"], expected_updated_at=words["updatedAt"])
    assert stamp(note) == {"uncaptured": True, "fields": "indexes"}

    blank = notes.create_note("u1", {"title": "blank"})
    assert js.plan_style_update("u1", blank["id"], style_id=s["id"])["mode"] == "create"
    note, _ = js.apply_style_update("u1", blank["id"], style_id=s["id"], expected_updated_at=blank["updatedAt"])
    p = stamp(note)
    assert p["fields"] == "indexes" and p["readings"]["spy"]["value"]["price"] == 600.5
    assert held.calls == []
