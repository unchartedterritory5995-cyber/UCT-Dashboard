"""Spec §P2 item 6 (R-P2b-6): the daily prep pack, server half. Each prep part reads caches only
and names its gap; a raising read never fails a Daily prep note create (pre-flight N10); an older
note offered a prep block by "Update layout" captures (and reads) nothing (IR-S11, part b).

Pre-flight corrections carried here (R-PF-B5, R-PF-N10..N14):
  * B5: quotes come from the cache-only `_cached_quote` (over `_quotes` + `_index_field`), never
    `price_stamp_quote` (it calls the vendor); the regime from the held gate `_regime_field`.
  * N11: "my names" are the member's own (positions, watchlists, flagged), never the UCT 20.
  * N12: levels never freeze sample (example) cards; the gate is `setups_board.enabled()`.
  * N13: the headline is the narrative's first sentence, never the "TODAY'S FOCUS" heading.
  * N14: PREP_PARTS / PREP_BLOCK are railed against the client registry's prep ids.
"""
from __future__ import annotations

import importlib
import os
import re
import sys
import tempfile
import types
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 13, 14, 30, tzinfo=timezone.utc)
CTX = {"ticker": None, "now": NOW, "memo": {}, "mode": "create", "user_id": "u1"}


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


def _held(monkeypatch, payload):
    """engine.get_breadth answering `payload` (None = nothing held), recording each call's held_only."""
    from api.services import engine
    calls: list[bool] = []

    def get_breadth(held_only: bool = False):
        calls.append(held_only)
        return payload
    monkeypatch.setattr(engine, "get_breadth", get_breadth)
    return calls


@pytest.fixture
def cold(monkeypatch):
    """Nothing held anywhere: no rundown, no breadth, no earnings cache, no names, levels off."""
    from api.services import engine
    from api.services.cache import cache
    from api.services.journal_two import regime, trader_blocks as tb
    monkeypatch.setattr(engine, "get_rundown", lambda: {})
    monkeypatch.setattr(regime, "_read_exposure", lambda: None)
    _held(monkeypatch, None)
    monkeypatch.setattr(cache, "get", lambda key, *a, **k: None)
    monkeypatch.setattr(tb, "_my_names", lambda uid: set())
    monkeypatch.delenv("NOTEBOOK_SETUPS_BOARD_ENABLED", raising=False)


# ── each part names its gap ───────────────────────────────────────────────────────────────

def test_each_part_labels_its_gap(cold):
    from api.services.journal_two import trader_blocks as tb
    wire = tb.prep_part("u1", "wire", now=NOW)
    assert wire["missing"] == "no_wire" and wire["detail"]
    assert (wire["headline"], wire["regime"], wire["exposure"]) == (None, None, None)
    earn = tb.prep_part("u1", "earnings", now=NOW)
    assert earn["missing"] == "no_earnings_yet" and earn["detail"] and earn["bmo"] == []
    movers = tb.prep_part("u1", "movers", now=NOW)
    assert movers["missing"] == "no_names" and movers["items"] == [] and movers["unquoted"] == 0
    levels = tb.prep_part("u1", "levels", now=NOW)
    assert levels["needs"] == "the active setups board" and "cards" not in levels
    for got, part in ((wire, "wire"), (earn, "earnings"), (movers, "movers"), (levels, "levels")):
        assert got["part"] == part and got["capturedAt"] == "2026-10-13T14:30:00Z"


def test_unknown_part_raises():
    from api.services.journal_two import trader_blocks as tb
    with pytest.raises(KeyError):
        tb.prep_part("u1", "nope")


# ── earnings ──────────────────────────────────────────────────────────────────────────────

def test_earnings_are_the_members_names_only(monkeypatch):
    from api.services import engine
    from api.services.cache import cache
    from api.services.journal_two import trader_blocks as tb
    payload = {"bmo": [{"sym": "NVDA"}, {"sym": "XOM"}, {"sym": "nvda"}], "amc": [{"sym": "AMD"}],
               "amc_tonight": [{"sym": "TSLA"}, {"sym": "MSFT"}]}
    asked: list[str] = []
    monkeypatch.setattr(cache, "get", lambda key, *a, **k: asked.append(key) or (payload if key == engine.EARNINGS_CACHE_KEY else None))
    monkeypatch.setattr(tb, "_my_names", lambda uid: {"NVDA", "AMD", "TSLA"})
    got = tb.prep_part("u1", "earnings", now=NOW)
    assert (got["bmo"], got["amc"], got["amcTonight"], got["missing"]) == (["NVDA"], ["AMD"], ["TSLA"], None)
    assert asked == [engine.EARNINGS_CACHE_KEY]               # the engine's own key, read from the cache only


def test_earnings_with_no_names_says_so(monkeypatch):
    from api.services.cache import cache
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(cache, "get", lambda key, *a, **k: {"bmo": [{"sym": "NVDA"}], "amc": []})
    monkeypatch.setattr(tb, "_my_names", lambda uid: set())
    got = tb.prep_part("u1", "earnings", now=NOW)
    assert got["missing"] == "no_names" and got["bmo"] == [] and got["detail"]


def test_my_names_are_the_members_own_never_the_uct20(monkeypatch):
    """N11: member_interest.all_mine unions the firm's UCT 20; the prep pack's names leave it out."""
    from api.services import member_interest
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(member_interest, "interest_for", lambda uid: {
        "by_source": {"positions": {"NVDA"}, "watchlist": {"AMD"}, "flagged": {"TSLA"}, "uct20": {"PLTR"}},
        "all_mine": {"NVDA", "AMD", "TSLA", "PLTR"}, "entities": {}})
    assert tb._my_names("u1") == {"NVDA", "AMD", "TSLA"}
    assert "uct20" in member_interest.SOURCES                  # non-vacuity: the source being left out exists


# ── movers ────────────────────────────────────────────────────────────────────────────────

def _q(price, change, source="live price", as_of="2026-10-13T14:29:00Z"):
    return {"price": price, "change_pct": change, "source": source, "asOf": as_of}


def test_movers_are_cached_quotes_sorted_by_size(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    q = {"NVDA": _q(100, 3.0), "AMD": _q(50, -5.0, "last close", "2026-10-12T20:00:00Z"), "MSFT": _q(400, None)}
    seen: list[tuple] = []
    monkeypatch.setattr(tb, "_my_names", lambda uid: {"NVDA", "AMD", "TSLA", "MSFT"})
    monkeypatch.setattr(tb, "_cached_quote", lambda s, now=None: seen.append((s, now)) or q.get(s))
    got = tb.prep_part("u1", "movers", now=NOW)
    assert [i["symbol"] for i in got["items"]] == ["AMD", "NVDA", "MSFT"] and got["unquoted"] == 1
    assert got["items"][0] == {"symbol": "AMD", "price": 50, "changePct": -5.0, "source": "last close",
                               "asOf": "2026-10-12T20:00:00Z"}
    assert got["items"][2]["changePct"] is None                # R-T3-5: unavailable, never 0.0
    assert got["missing"] is None and {n for n, _ in seen} == {"NVDA", "AMD", "TSLA", "MSFT"}
    assert {t for _, t in seen} == {NOW}


def test_movers_keep_the_top_eight_by_size(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    names = {f"S{i:02d}" for i in range(12)}
    monkeypatch.setattr(tb, "_my_names", lambda uid: names)
    monkeypatch.setattr(tb, "_cached_quote", lambda s, now=None: _q(10, float(int(s[1:]))))
    got = tb.prep_part("u1", "movers", now=NOW)
    assert len(got["items"]) == tb.MOVERS_MAX == 8
    assert [i["symbol"] for i in got["items"]] == [f"S{i:02d}" for i in range(11, 3, -1)]


def test_movers_with_no_quote_at_all_say_so(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "_my_names", lambda uid: {"NVDA", "AMD"})
    monkeypatch.setattr(tb, "_cached_quote", lambda s, now=None: None)
    got = tb.prep_part("u1", "movers", now=NOW)
    assert got["missing"] == "no_quotes" and got["unquoted"] == 2 and got["items"] == [] and got["detail"]


def test_cached_quote_is_the_classified_cache_read_never_the_vendor(monkeypatch):
    """B5: `_cached_quote` is `_quotes` (cache, else a held bar) through `_index_field`: the price, its
    change, and its real source and as-of; None when nothing classifies."""
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "price_stamp_quote", lambda *a, **k: pytest.fail("the vendor read"))
    monkeypatch.setattr(tb, "_quotes", lambda uid, syms, now=None: {
        "QQQ": {"price": 486.0, "change_pct": 1.25, "market_closed": True, "source": "last close",
                "asOf": "2026-10-12T20:00:00Z"}})
    assert tb._cached_quote("QQQ", NOW) == {"price": 486.0, "change_pct": 1.25, "source": "last close",
                                            "asOf": "2026-10-12T20:00:00Z"}
    assert tb._cached_quote("ZZZZ", NOW) is None


# ── the wire ──────────────────────────────────────────────────────────────────────────────

def _wire(monkeypatch, html, *, score=95, wire_date="2026-10-13"):
    from api.services import engine
    from api.services.journal_two import regime
    monkeypatch.setattr(engine, "get_rundown", lambda: {"html": html, "date": "2026-10-13"})
    monkeypatch.setattr(regime, "_read_exposure", lambda: {"score": score})
    return _held(monkeypatch, {"exposure": {"score": score}, "wire_date": wire_date})


def test_wire_headline_is_the_first_sentence(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    calls = _wire(monkeypatch, "<p>Tape is firm. Breadth widened.</p>")
    got = tb.prep_part("u1", "wire", now=NOW)
    assert (got["headline"], got["regime"], got["exposure"]) == ("Tape is firm.", "green", 95.0)
    assert (got["wireDate"], got["exposureAsOf"], got["missing"]) == ("2026-10-13", "2026-10-13", None)
    assert calls and all(calls[:1])                            # the first breadth read is the held one


def test_wire_headline_skips_the_focus_heading_and_its_bullets(monkeypatch):
    """N13: the real rundown's `.rd-sections` opens with TODAY'S FOCUS and its bullet lines (no
    sentence end); the headline is the narrative's first sentence."""
    from api.services.journal_two import trader_blocks as tb
    html = """
      <div class="rd-regime-banner"><div class="rd-phase">CONFIRMED UPTREND</div></div>
      <div class="rd-sections rd-monologue">
        <div class="rd-agenda"><span class="rd-agenda-label">TODAY'S FOCUS</span>
          <ul><li>DELL · pullback to 21-EMA near $565 · buy the pullback, not strength</li>
              <li>QQQ · $740.24 21-EMA is the line · stay long above, respect below</li></ul></div>
        <section class="rd-seg"><div class="rd-seg-label">THE MARKET</div>
          <p>Yesterday chips led the drag and that is carrying over. Breadth is thin.</p></section>
      </div>"""
    _wire(monkeypatch, html)
    got = tb.prep_part("u1", "wire", now=NOW)
    assert got["headline"] == "Yesterday chips led the drag and that is carrying over."


def test_wire_without_a_held_breadth_reads_no_regime(monkeypatch):
    """R-W0-1: nothing held, so the regime path (which can go on to the breadth vendor) is never
    entered; the headline still answers."""
    from api.services import engine
    from api.services.journal_two import regime, trader_blocks as tb
    reads: list[str] = []
    monkeypatch.setattr(engine, "get_rundown", lambda: {"html": "<p>Quiet open.</p>", "date": "2026-10-13"})
    monkeypatch.setattr(regime, "_read_exposure", lambda: reads.append("exposure") or {"score": 95})
    calls = _held(monkeypatch, None)
    got = tb.prep_part("u1", "wire", now=NOW)
    assert got["headline"] == "Quiet open." and got["regime"] is None and got["missing"] is None
    assert reads == [] and calls and all(calls)               # only held reads


def test_wire_reads_its_regime_through_the_ONE_held_gate(monkeypatch):
    """H8 / R-M2-1 (d): the wire asks trader_blocks._regime_field, with the compose's memo, as the
    sizer and the market context do; never a second copy of that gate."""
    from api.services.journal_two import trader_blocks as tb
    seen: list[dict] = []
    _wire(monkeypatch, "<p>Tape is firm.</p>", score=12)
    monkeypatch.setattr(tb, "_regime_field", lambda memo: seen.append(memo) or {"value": "red", "asOf": "2026-10-02"})
    memo: dict = {}
    got = tb.prep_part("u1", "wire", now=NOW, memo=memo)
    assert seen == [memo] and got["regime"] == "red"


# ── levels ────────────────────────────────────────────────────────────────────────────────

def _card(sym, example=False):
    return {"noteId": f"n-{sym}", "symbol": sym, "entry": 10.0, "stop": 9.0, "example": example}


def test_levels_are_the_members_cards_with_cache_only_prices(monkeypatch, db_path):
    from api.services.journal_two import setups_board, trader_blocks as tb
    monkeypatch.setenv(setups_board.FLAG, "1")
    seen: dict = {}

    def build_cards(conn, user_id, *, today=None, prices=None, read_plan=None, cap=setups_board.SCAN_CAP):
        seen.update(user=user_id, prices=prices)
        return {"cards": [_card("NVDA"), _card("AMD"), _card("SAMPLE", example=True)], "count": 2}
    monkeypatch.setattr(setups_board, "build_cards", build_cards)
    monkeypatch.setattr(setups_board, "read_prices", lambda syms: pytest.fail("the board's own price read"))
    monkeypatch.setattr(tb, "_cached_quote", lambda s, now=None: _q(11.0, 1.0) if s == "NVDA" else None)
    got = tb.prep_part("u1", "levels", now=NOW)
    assert [c["symbol"] for c in got["cards"]] == ["NVDA", "AMD"]          # N12: no example card frozen
    assert got["total"] == 2 and got["missing"] is None and "needs" not in got
    assert seen["user"] == "u1" and seen["prices"] is not None              # never the production reader
    assert seen["prices"](["NVDA", "AMD"]) == {"NVDA": _q(11.0, 1.0)}       # the cache-only seam


def test_levels_cap_at_one_board_page(monkeypatch, db_path):
    from api.services.journal_two import setups_board, trader_blocks as tb
    monkeypatch.setenv(setups_board.FLAG, "1")
    cards = [_card(f"S{i:02d}") for i in range(setups_board.PAGE_SIZE + 5)]
    monkeypatch.setattr(setups_board, "build_cards", lambda conn, uid, **k: {"cards": cards, "count": len(cards)})
    got = tb.prep_part("u1", "levels", now=NOW)
    assert len(got["cards"]) == setups_board.PAGE_SIZE and got["total"] == setups_board.PAGE_SIZE + 5


def test_levels_with_no_setups_say_so(monkeypatch, db_path):
    from api.services.journal_two import setups_board, trader_blocks as tb
    monkeypatch.setenv(setups_board.FLAG, "1")
    monkeypatch.setattr(setups_board, "build_cards",
                        lambda conn, uid, **k: {"cards": [_card("SAMPLE", example=True)], "count": 0})
    got = tb.prep_part("u1", "levels", now=NOW)
    assert got["cards"] == [] and got["missing"] == "no_setups" and got["detail"]


def test_levels_gate_is_the_boards_own(monkeypatch):
    """N12: the gate is setups_board.enabled(), never a restated flag literal."""
    from api.services.journal_two import setups_board, trader_blocks as tb
    monkeypatch.setattr(setups_board, "enabled", lambda: False)
    monkeypatch.setenv(setups_board.FLAG, "1")
    assert tb.prep_part("u1", "levels", now=NOW)["needs"] == "the active setups board"


# ── N10: a raising read never fails a Daily prep create ───────────────────────────────────

@pytest.mark.parametrize("part, fn", [("wire", "_prep_wire"), ("earnings", "_prep_earnings"),
                                      ("movers", "_prep_movers"), ("levels", "_prep_levels")])
def test_a_raising_read_is_a_missing_snapshot_never_a_failed_create(part, fn, monkeypatch):
    from api.services.journal_two import journal_styles as js, trader_blocks as tb

    def broken(*a, **k):
        raise RuntimeError("the cache could not be read")
    monkeypatch.setattr(tb, fn, broken)
    bid = tb.PREP_BLOCK[part]
    node, reason = js.BLOCK_BUILDERS[bid]({"block": bid, "enabled": True, "settings": {}}, dict(CTX, memo={}))
    snap = node["attrs"]["params"]["snapshot"]
    assert reason is None and node["attrs"]["widgetId"] == bid
    assert snap["part"] == part and snap["missing"] == "source_error" and snap["detail"]


# ── IR-S11 (part b): an older note captures and reads nothing ─────────────────────────────

@pytest.mark.parametrize("part", ["wire", "earnings", "movers", "levels"])
@pytest.mark.parametrize("mode, captured", [("create", True), ("update", False)])
def test_only_a_new_note_captures(part, mode, captured, monkeypatch):
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    asked: list[tuple] = []
    monkeypatch.setattr(tb, "prep_part", lambda uid, p, **k: asked.append((uid, p)) or {"part": p, "missing": None})
    bid = tb.PREP_BLOCK[part]
    node, reason = js.BLOCK_BUILDERS[bid]({"block": bid, "enabled": True, "settings": {}},
                                          dict(CTX, memo={}, mode=mode))
    assert reason is None and node["attrs"]["widgetId"] == bid
    if captured:
        assert node["attrs"]["params"] == {"snapshot": {"part": part, "missing": None}}
        assert asked == [("u1", part)]
    else:
        assert node["attrs"]["params"] == {} and asked == []


@pytest.mark.parametrize("part", ["wire", "earnings", "movers", "levels"])
def test_the_captured_node_is_buildable(part, cold, db_path):
    from api.services.journal_two import journal_styles as js, notes, trader_blocks as tb
    bid = tb.PREP_BLOCK[part]
    for mode in ("create", "update"):
        node, _ = js.BLOCK_BUILDERS[bid]({"block": bid, "settings": {}}, dict(CTX, memo={}, mode=mode))
        notes._refuse_unbuildable(notes._validate_body_json({"type": "doc", "content": [node]}))


# ── R-W0-1: the prep reads are CACHE-ONLY ─────────────────────────────────────────────────
# Each vendor door RECORDS its call: prep_part swallows a raising read (N10), so a raise alone
# would read as green.

@pytest.fixture
def doors(monkeypatch):
    from api.routers import live_prices
    from api.services import bars_sqlite, engine
    from api.services.cache import TTLCache
    from api.services.journal_two import setups_board
    calls: list[str] = []

    def door(name):
        def reached(*a, **k):
            calls.append(name)
            raise AssertionError(f"the prep read reached {name}")
        return reached

    monkeypatch.setattr(engine, "cache", TTLCache())
    monkeypatch.setattr(engine, "_load_state", lambda: {})
    monkeypatch.setattr(engine, "_load_wire_data", lambda: None)
    monkeypatch.setattr(engine, "get_earnings", door("engine.get_earnings"))
    fake = types.ModuleType("morning_wire_engine")
    fake.fetch_breadth = door("morning_wire_engine.fetch_breadth")
    monkeypatch.setitem(sys.modules, "morning_wire_engine", fake)
    monkeypatch.setattr(live_prices, "cache", TTLCache(max_size=100))
    for name in ("get_live_prices", "_fetch_snapshots", "_get_client", "_session_closes"):
        monkeypatch.setattr(live_prices, name, door(f"live_prices.{name}"))
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda ticker, tf, n: [])
    monkeypatch.setattr(setups_board, "read_prices", door("setups_board.read_prices"))
    return calls


def test_a_cold_prep_reaches_no_vendor(doors, monkeypatch, db_path):
    from api.services.cache import cache
    from api.services.journal_two import setups_board, trader_blocks as tb
    monkeypatch.setattr(cache, "get", lambda key, *a, **k: None)
    monkeypatch.setattr(tb, "_my_names", lambda uid: {"NVDA", "AMD"})
    monkeypatch.setenv(setups_board.FLAG, "1")
    got = {p: tb.prep_part("u1", p, now=NOW) for p in tb.PREP_PARTS}
    assert doors == []
    assert got["movers"]["missing"] == "no_quotes" and got["movers"]["unquoted"] == 2
    assert got["wire"]["missing"] == "no_wire" and got["earnings"]["missing"] == "no_earnings_yet"
    assert got["levels"]["missing"] == "no_setups"                       # the board ran, cache-only
    assert all(g["missing"] != "source_error" for g in got.values()), got


def test_CONTROL_the_doors_see_a_vendor_read(doors):
    from api.routers import live_prices
    with pytest.raises(AssertionError):
        live_prices.get_live_prices(tickers="NVDA")
    assert doors == ["live_prices.get_live_prices"]


# ── the route ─────────────────────────────────────────────────────────────────────────────

def test_route_answers_each_part_and_404s_an_unknown_one(cold, monkeypatch, db_path):
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    url = "/api/j2/trader-blocks/prep/{}"
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", raising=False)
    assert TestClient(app).get(url.format("wire")).status_code == 404
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "free"}
    assert TestClient(app).get(url.format("wire")).status_code == 402
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    for part in ("wire", "earnings", "movers", "levels"):
        got = TestClient(app).get(url.format(part))
        assert got.status_code == 200 and got.json()["part"] == part, part
    gone = TestClient(app).get(url.format("nope"))
    assert gone.status_code == 404 and gone.json()["detail"] == r.NOT_FOUND


def test_route_answers_a_raising_read_as_its_gap(cold, monkeypatch, db_path):
    from api.routers import notebook_journal_styles as r
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "_prep_wire", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    got = TestClient(app).get("/api/j2/trader-blocks/prep/wire")
    assert got.status_code == 200 and got.json()["missing"] == "source_error"


# ── N14: one fact in two files ────────────────────────────────────────────────────────────

def test_prep_parts_and_blocks_match_the_registry_and_the_catalog():
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    reg = (ROOT / "app/src/widgets/registry.js").read_text(encoding="utf-8")
    client_prep = re.findall(r"^\s*(prep[A-Z]\w*): blockManifest\(", reg, re.M)
    assert len(client_prep) == 4, client_prep                             # non-vacuity: the read found them
    assert tuple(tb.PREP_BLOCK) == tb.PREP_PARTS
    assert sorted(tb.PREP_BLOCK.values()) == sorted(client_prep)
    assert set(tb.PREP_BLOCK.values()) <= set(tb.BLOCK_IDS) and set(tb.PREP_BLOCK.values()) <= js.KNOWN_BLOCKS
    assert {b for b in tb.BLOCK_IDS if b.startswith("prep")} == set(tb.PREP_BLOCK.values())
