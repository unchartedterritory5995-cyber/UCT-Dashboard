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
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols, now=None: s["quotes"])
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
    assert node["attrs"]["capturedAt"] == "2026-10-13T17:26:00Z"
    monkeypatch.setattr(tb, "market_context_params", lambda *a, **k: pytest.fail("an update must read nothing"))
    node, _ = js.BLOCK_BUILDERS["marketcontext"](block, {"ticker": None, "now": NOW, "memo": {},
                                                          "mode": "update", "user_id": "u1"})
    assert node["attrs"]["params"] == {"uncaptured": True, "fields": "regime"}
    # R-T3-2 I2: no capture date either; the client renders capturedAt as "captured <day>".
    assert node["attrs"]["capturedAt"] is None


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

    ns = types.SimpleNamespace(calls=calls, engine=engine, live_prices=live_prices, bars_sqlite=bars_sqlite)
    # engine.get_breadth stays REAL: a cold hold makes its Priority 3 import morning_wire_engine,
    # which is the recording door below.
    monkeypatch.setattr(engine, "cache", TTLCache())                 # no breadth, no wire_data cached
    monkeypatch.setattr(engine, "_load_state", lambda: {})
    monkeypatch.setattr(engine, "_load_wire_data", lambda: None)
    fake = types.ModuleType("morning_wire_engine")
    fake.fetch_breadth = door("morning_wire_engine.fetch_breadth")
    monkeypatch.setitem(sys.modules, "morning_wire_engine", fake)
    monkeypatch.setattr(live_prices, "cache", TTLCache(max_size=100))
    for name in ("get_live_prices", "_fetch_snapshots", "_get_client", "_session_closes"):
        monkeypatch.setattr(live_prices, name, door(f"live_prices.{name}"))
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda ticker, tf, n: [])
    return ns


def _create(block_settings=None, now=NOW):
    from api.services.journal_two import journal_styles as js
    node, reason = js.BLOCK_BUILDERS["marketcontext"](
        {"block": "marketcontext", "enabled": True, "settings": block_settings or {}},
        {"ticker": None, "now": now, "memo": {}, "mode": "create", "user_id": "u1"})
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
    # QQQ is not in the quote cache; its daily bars through the last completed session (Mon 10/12;
    # NOW is Tue 10/13 13:26 ET) are held (ts YYYYMMDD; o, h, l, c, v).
    _bars(monkeypatch, bs, [(20261009, 470.0, 482.0, 469.0, 480.0, 1), (20261012, 481.0, 487.0, 479.0, 486.0, 1)])
    # The wire's breadth is held in engine's cache: the real get_breadth answers from it.
    eng.cache.set("breadth", dict(BREADTH), ttl=60)

    r = _create()["readings"]
    assert held.calls == []
    assert r["spy"] == {"value": {"price": 600.5, "changePct": -0.42, "closed": False},
                        "source": "live price", "asOf": "2026-10-13T17:26:00Z", "missing": None}
    assert r["qqq"] == {"value": {"price": 486.0, "changePct": 1.25, "closed": True},
                        "source": "last close", "asOf": "2026-10-12T20:00:00Z", "missing": None}
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
    # R-T3-2 m2: a row read while the market is closed is a last close, never a "live price".
    assert r["spy"]["source"] == "last close"


def test_a_live_cache_row_with_no_observation_time_is_dated_by_the_capture(held):
    """R-T3-2 m2: "sourced and dated, or a sentence". A live row the vendor did not time is dated by
    the capture (its 15 s TTL bounds its age), never stored with both asOf and missing null."""
    lp = held.live_prices
    lp.cache.set(lp._px_key("SPY"), {"price": 600.5, "change_pct": -0.42, "observed_at": None,
                                      "market_closed": False}, ttl=60)
    r = _create()["readings"]
    assert held.calls == []
    assert r["spy"] == {"value": {"price": 600.5, "changePct": -0.42, "closed": False},
                        "source": "live price", "asOf": "2026-10-13T17:26:00Z", "missing": None}


# ── R-T3-2 I1: the "last close" is a SETTLED session's close, never today's forming bar ─────────────
# NOW is Tue 2026-10-13 13:26 ET, mid-session: the last completed session is Mon 10/12.

def _bars(monkeypatch, bs, rows, sym="QQQ"):
    """One symbol's held daily bars (oldest first, as bars_sqlite answers), whatever depth is asked."""
    monkeypatch.setattr(bs, "get_bars", lambda ticker, tf, n: list(rows)[-n:] if (ticker, tf) == (sym, "D") else [])


# ── R-T3-3 Important 1: an UNDATED closed cache row is never dated by the capture ─────────────────
# live_prices._last_session_row leaves session_close_at None AND change_pct a fabricated 0.0 while its
# grouped session map is warming or disagrees. Such a row is routed to _last_close (calendar-checked,
# change from the prior bar); with no held bar the field is the sentence. The reviewer's probe:
SATURDAY = datetime(2026, 10, 17, 14, 0, tzinfo=timezone.utc)        # Sat 10/17 10:00 ET
_UNDATED_CLOSED = {"price": 598.0, "change_pct": 0.0, "observed_at": None, "session_close_at": None,
                   "market_closed": True}


def test_an_undated_closed_cache_row_takes_fridays_settled_close_instead(held, monkeypatch):
    lp = held.live_prices
    lp.cache.set(lp._px_key("SPY"), dict(_UNDATED_CLOSED), ttl=60)
    _bars(monkeypatch, held.bars_sqlite, [(20261015, 0, 0, 0, 595.0, 1), (20261016, 0, 0, 0, 598.0, 1)], sym="SPY")
    spy = _create(now=SATURDAY)["readings"]["spy"]
    assert held.calls == []
    assert spy == {"value": {"price": 598.0, "changePct": 0.5042, "closed": True},
                   "source": "last close", "asOf": "2026-10-16T20:00:00Z", "missing": None}


def test_an_undated_closed_cache_row_with_no_held_bar_is_the_sentence(held):
    lp = held.live_prices
    lp.cache.set(lp._px_key("SPY"), dict(_UNDATED_CLOSED), ttl=60)
    spy = _create(now=SATURDAY)["readings"]["spy"]
    assert held.calls == []
    assert spy == {"value": None, "source": None, "asOf": None, "missing": "No SPY quote could be read just now."}


def test_the_capture_time_never_dates_a_closed_row():
    """The field builder itself: a closed row with no date of its own is a sentence (only a LIVE row
    may be dated by the capture)."""
    from api.services.journal_two import trader_blocks as tb
    assert tb._index_field("SPY", dict(_UNDATED_CLOSED), SATURDAY) == {
        "value": None, "source": None, "asOf": None, "missing": "No SPY quote could be read just now."}


# ── R-T3-3 Minor 2: the session boundaries, against the REAL session_calendar ─────────────────────
# Each case: `now` (built in ET; run as ET and as UTC), the held bars (the bar store holds nothing
# after "today", and may hold today's forming bar), the last completed session, and its close time.
# Expected values are HARD-CODED, never derived from the calendar under test.
_ET = __import__("zoneinfo").ZoneInfo("America/New_York")
_BOUNDARIES = [
    ("saturday", datetime(2026, 10, 17, 12, 0, tzinfo=_ET), (20261014, 20261015, 20261016),
     "2026-10-16", "2026-10-16T20:00:00Z"),
    ("monday pre-market", datetime(2026, 10, 19, 8, 0, tzinfo=_ET), (20261015, 20261016, 20261019),
     "2026-10-16", "2026-10-16T20:00:00Z"),
    ("thanksgiving midday", datetime(2026, 11, 26, 12, 0, tzinfo=_ET), (20261123, 20261124, 20261125),
     "2026-11-25", "2026-11-25T21:00:00Z"),
    ("thanksgiving evening", datetime(2026, 11, 26, 20, 0, tzinfo=_ET), (20261123, 20261124, 20261125),
     "2026-11-25", "2026-11-25T21:00:00Z"),
    ("half-day 12:59", datetime(2026, 11, 27, 12, 59, tzinfo=_ET), (20261124, 20261125, 20261127),
     "2026-11-25", "2026-11-25T21:00:00Z"),
    ("half-day 13:00", datetime(2026, 11, 27, 13, 0, tzinfo=_ET), (20261124, 20261125, 20261127),
     "2026-11-27", "2026-11-27T18:00:00Z"),
    ("normal 15:59:59", datetime(2026, 10, 13, 15, 59, 59, tzinfo=_ET), (20261009, 20261012, 20261013),
     "2026-10-12", "2026-10-12T20:00:00Z"),
    ("normal 16:00:00", datetime(2026, 10, 13, 16, 0, 0, tzinfo=_ET), (20261009, 20261012, 20261013),
     "2026-10-13", "2026-10-13T20:00:00Z"),
]


@pytest.mark.parametrize("zone", ["ET", "UTC"])
@pytest.mark.parametrize("name,now,days,session,close_iso", _BOUNDARIES, ids=[c[0] for c in _BOUNDARIES])
def test_the_last_close_respects_every_session_boundary(monkeypatch, zone, name, now, days, session, close_iso):
    from api.services import bars_sqlite
    from api.services.journal_two import trader_blocks as tb
    now = now if zone == "ET" else now.astimezone(timezone.utc)
    closes = {d: 100.0 + i for i, d in enumerate(days)}
    _bars(monkeypatch, bars_sqlite, [(d, 0, 0, 0, c, 1) for d, c in closes.items()])
    assert tb._last_completed_session(now).isoformat() == session
    got = tb._last_close("QQQ", now)
    assert got is not None and got["asOf"] == close_iso
    assert got["price"] == closes[int(session.replace("-", ""))]


def test_todays_forming_daily_bar_is_never_taken_as_a_close(held, monkeypatch):
    _bars(monkeypatch, held.bars_sqlite, [(20261009, 0, 0, 0, 480.0, 1), (20261012, 0, 0, 0, 484.0, 1),
                                          (20261013, 0, 0, 0, 999.0, 1)])
    q = _create()["readings"]["qqq"]
    assert held.calls == []
    assert q["value"]["price"] == 484.0                     # Monday's close, not today's 999
    assert q["asOf"] == "2026-10-12T20:00:00Z"
    assert q["asOf"] <= "2026-10-13T17:26:00Z"              # never dated after the capture


def test_yesterdays_settled_bar_is_the_last_close(held, monkeypatch):
    _bars(monkeypatch, held.bars_sqlite, [(20261009, 0, 0, 0, 480.0, 1), (20261012, 0, 0, 0, 484.0, 1)])
    q = _create()["readings"]["qqq"]
    assert held.calls == []
    assert q == {"value": {"price": 484.0, "changePct": 0.8333, "closed": True},
                 "source": "last close", "asOf": "2026-10-12T20:00:00Z", "missing": None}


def test_a_bar_older_than_the_last_completed_session_is_a_sentence_not_a_stale_close(held, monkeypatch):
    _bars(monkeypatch, held.bars_sqlite, [(20261008, 0, 0, 0, 480.0, 1), (20261009, 0, 0, 0, 484.0, 1)])
    q = _create()["readings"]["qqq"]
    assert held.calls == []
    assert q == {"value": None, "source": None, "asOf": None, "missing": "No QQQ quote could be read just now."}


# ── R-T3-2 m1: engine.get_breadth(held_only=True), the ONE authority on "held" ─────────────────────

def test_get_breadth_held_only_on_a_cold_engine_is_none_and_never_fetches(held):
    assert held.engine.get_breadth(held_only=True) is None
    assert held.calls == []


def test_get_breadth_held_only_answers_a_held_wire(held, monkeypatch):
    monkeypatch.setattr(held.engine, "_load_wire_data",
                        lambda: {"date": "2026-10-13", "breadth": {"breadth_score": 47.56}, "exposure": {"score": 32.04}})
    got = held.engine.get_breadth(held_only=True)
    assert held.calls == []
    assert got["breadth_score"] == 47.56 and got["exposure"]["score"] == 32.04 and got["wire_date"] == "2026-10-13"


def test_get_breadth_default_is_unchanged_a_cold_engine_still_reaches_the_live_fetch(held):
    """The default call keeps its Priority 3 (local dev): the held_only seam changed nothing else."""
    got = held.engine.get_breadth()
    assert held.calls == ["morning_wire_engine.fetch_breadth"]
    assert isinstance(got, dict) and got["pct_above_50ma"] is None       # the except branch's payload


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
