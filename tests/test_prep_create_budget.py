"""R-T12-C: a Daily prep create (and a prep part's "Capture now") runs its reads under ONE budget,
trader_blocks.PREP_CREATE_BUDGET_S. The Task 15b probe measured a create holding a request worker for
the serial sum of every read (200-280 s with each read stalled 20 s); these rails hold the bound.

  * every read stalled past the budget: the create returns within the budget plus ONE in-flight read
    plus overhead (the stated margin), and every block that did not finish lands UNCAPTURED (the IR-S11
    shape), never a partial snapshot; regime_at_write stays absent;
  * a scan cut off part way is never frozen as the list; blocks that finished keep their snapshot;
  * the regime read stops at HELD data: no default engine.get_breadth, ever, on this path;
  * Capture now with stalled reads answers the route's failure shape within the same bound.

The budget is shrunk for speed (the constant is read at call time, so the patch reaches it)."""
from __future__ import annotations

import importlib
import os
import tempfile
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

REGIME = "builtin:regime_at_write"
PREP = ("prepWire", "prepEarnings", "prepMovers", "prepLevels")
BUDGET = 0.3        # seconds, patched over PREP_CREATE_BUDGET_S
STALL = 0.5         # each stalled read sleeps past the budget
#: The stated margin. A read already running is not interrupted, so the bound is the budget plus the ONE
#: read in flight (STALL) plus fixed overhead (imports, the note insert, a loaded box). Without the budget
#: the stalled create below makes 10+ stalled reads (>= 5 s), so this cannot pass by accident.
MARGIN = STALL + 1.0

#: Every read the Daily prep builders reach that leaves process memory (the Task 15b probe's LEGS).
LEGS = (("api.services.engine", "_load_wire_data"), ("api.services.engine", "_load_state"),
        ("api.services.member_interest", "_watchlist_syms"), ("api.services.member_interest", "_flagged_syms"),
        ("api.services.member_interest", "_position_syms"), ("api.services.member_interest", "_uct20_syms"),
        ("api.services.bars_sqlite", "get_bars"), ("api.services.journal_two.setups_board", "build_cards"))


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
def small_budget(monkeypatch):
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "PREP_CREATE_BUDGET_S", BUDGET)
    return BUDGET


@pytest.fixture
def stalled(monkeypatch):
    """Every leg sleeps STALL, then answers as it really would. Returns the call log."""
    calls: list[str] = []
    for mod_name, attr in LEGS:
        mod = importlib.import_module(mod_name)
        real = getattr(mod, attr)

        def slow(*a, _real=real, _key=f"{mod_name}.{attr}", **k):
            calls.append(_key)
            time.sleep(STALL)
            return _real(*a, **k)
        monkeypatch.setattr(mod, attr, slow)
    return calls


def _embeds(note):
    out, stack = {}, list((note["bodyJson"] or {}).get("content") or [])
    while stack:
        n = stack.pop(0)
        if isinstance(n, dict) and n.get("type") == "widgetEmbed":
            out[n["attrs"]["widgetId"]] = n["attrs"]
        elif isinstance(n, dict) and isinstance(n.get("content"), list):
            stack[0:0] = n["content"]
    return out


def _daily_prep(user="u1"):
    from api.services.journal_two import journal_styles as js
    t0 = time.monotonic()
    n, _ = js.create_styled_note(user, {"kindId": "daily_prep", "title": "Prep"})
    return n, time.monotonic() - t0


def _fast_market(monkeypatch, regime="green"):
    """Every market read answered at once (the test_regime_at_write fixture's seams)."""
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "_breadth", lambda: {})
    monkeypatch.setattr(tb, "_regime_field", lambda memo: {"value": regime, "source": "UCT Exposure Rating",
                                                           "asOf": "2026-10-13", "missing": None, "detail": None})
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols, now=None: {})


# ── every read stalled: bounded, and nothing partial ──────────────────────────────────────────

def test_a_create_with_every_read_stalled_returns_within_the_budget_and_freezes_nothing_partial(
        db_path, small_budget, stalled):
    n, took = _daily_prep()
    assert stalled, "non-vacuity: the stalled reads were reached"
    assert took < BUDGET + MARGIN, (took, stalled)
    blocks = _embeds(n)
    assert set(PREP) <= set(blocks) and "marketcontext" in blocks                 # the note is still whole
    for wid in PREP:
        assert "snapshot" not in blocks[wid]["params"], (wid, blocks[wid]["params"])   # uncaptured
    mc = blocks["marketcontext"]
    assert mc["params"].get("uncaptured") is True and mc["capturedAt"] is None and "readings" not in mc["params"]
    assert REGIME not in (n["propertiesJson"] or {})


def test_a_scan_cut_off_part_way_is_never_frozen_and_finished_blocks_keep_theirs(
        db_path, small_budget, monkeypatch):
    """The movers scan runs out of budget part way: the block lands UNCAPTURED (never the first k names
    frozen as if they were the list). Blocks that finished inside the budget keep their snapshot."""
    from api.services.journal_two import trader_blocks as tb
    _fast_market(monkeypatch)
    names = [f"N{i:03d}" for i in range(tb.MOVERS_SCAN_MAX)]
    monkeypatch.setattr(tb, "_my_names", lambda uid: list(names))
    read: list[str] = []

    def quote(sym, now=None):
        read.append(sym)
        time.sleep(0.02)                                   # 200 x 0.02 s = 4 s, far past the budget
        return {"price": 10.0, "change_pct": 1.0, "source": "last close", "asOf": "2026-10-12T20:00:00Z"}
    monkeypatch.setattr(tb, "_cached_quote", quote)
    n, took = _daily_prep()
    blocks = _embeds(n)
    assert 0 < len(read) < len(names), len(read)            # non-vacuity: cut off PART way through
    assert "snapshot" not in blocks["prepMovers"]["params"]                    # never a partial list
    assert "snapshot" not in blocks["prepLevels"]["params"]                    # after the budget: uncaptured
    for wid in ("prepWire", "prepEarnings"):                                   # CONTROL: finished in budget
        assert "snapshot" in blocks[wid]["params"], wid
    assert blocks["marketcontext"]["capturedAt"] and "readings" in blocks["marketcontext"]["params"]
    assert n["propertiesJson"][REGIME] == "green"                              # the stamp froze it: kept
    assert took < BUDGET + MARGIN, took


def test_CONTROL_inside_the_budget_every_block_keeps_its_snapshot(db_path, monkeypatch):
    """The real budget, no stall: every prep block and the stamp captured (the rails above can fail)."""
    from api.services.journal_two import trader_blocks as tb
    _fast_market(monkeypatch)
    monkeypatch.setattr(tb, "_my_names", lambda uid: ["AAA", "BBB"])
    n, _ = _daily_prep()
    blocks = _embeds(n)
    for wid in PREP:
        assert isinstance(blocks[wid]["params"].get("snapshot"), dict), wid
    assert blocks["marketcontext"]["capturedAt"] and n["propertiesJson"][REGIME] == "green"


# ── the regime read stops at held data ─────────────────────────────────────────────────────────

def _spy_breadth(monkeypatch, held):
    from api.services import engine
    calls: list[bool] = []

    def get_breadth(held_only: bool = False):
        calls.append(held_only)
        return held
    monkeypatch.setattr(engine, "get_breadth", get_breadth)
    return calls


@pytest.mark.parametrize("held, want", [
    (None, None),                                                               # nothing held
    ({"exposure": {"score": 95, "as_of": "2026-10-13"}, "wire_date": "2026-10-13"}, "green"),
])
def test_the_create_regime_read_never_asks_the_default_breadth(db_path, monkeypatch, held, want):
    """R-T12-C ruling 3: held-only, then nothing. The OLD path asked the default engine.get_breadth
    (which can go on to morning_wire_engine.fetch_breadth) whenever the held read answered."""
    from api.services.journal_two import trader_blocks as tb
    monkeypatch.setattr(tb, "_quotes", lambda user_id, symbols, now=None: {})
    calls = _spy_breadth(monkeypatch, held)
    n, _ = _daily_prep()
    assert calls, "non-vacuity: the breadth was read"
    assert all(calls), calls                                                    # never held_only=False
    assert (n["propertiesJson"] or {}).get(REGIME) == want


# ── Capture now: the same budget, the route's failure shape ────────────────────────────────────

def _route(monkeypatch):
    from api.routers import notebook_journal_styles as r
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    return TestClient(app)


@pytest.mark.parametrize("part", ["wire", "earnings", "movers", "levels"])
def test_capture_now_with_stalled_reads_answers_the_failure_shape_within_the_budget(
        db_path, small_budget, stalled, monkeypatch, part):
    from api.services import engine
    from api.services.cache import cache
    from api.services.journal_two import trader_blocks as tb
    cache.set(engine.EARNINGS_CACHE_KEY, {"date": "2026-10-13", "bmo": [{"sym": "AAA"}]}, ttl=60)
    monkeypatch.setenv("NOTEBOOK_SETUPS_BOARD_ENABLED", "1")
    if part == "movers":
        monkeypatch.setattr(tb, "_my_names", lambda uid: [f"N{i:03d}" for i in range(20)])
    try:
        t0 = time.monotonic()
        got = _route(monkeypatch).get(f"/api/j2/trader-blocks/prep/{part}")
        took = time.monotonic() - t0
    finally:
        cache.invalidate(engine.EARNINGS_CACHE_KEY)
    body = got.json()
    assert stalled, "non-vacuity: the stalled reads were reached"
    assert got.status_code == 200 and body["part"] == part
    assert body["missing"] == "source_error" and body["detail"] == tb.PREP_GAPS["source_error"]
    assert not ({"items", "cards", "bmo", "headline"} & set(body)), body          # no partial read
    assert took < BUDGET + MARGIN, took
