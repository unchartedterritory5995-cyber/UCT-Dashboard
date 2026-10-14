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
#: The longest chain of reads ONE guarded step can run (review M-1, fix round 2): the check sits between
#: steps, never inside engine.py, and get_breadth(held_only=True) is up to 3 file reads (_load_state,
#: _load_wire_data, _load_wire_data again for wire_date); get_rundown is 2; build_cards 3 SQL reads before
#: its scan. Measured: the first stalled step of a Daily prep create (prepWire's get_rundown on a cold
#: pod) runs 2 stalled reads.
LONGEST_CHAIN = 3
#: The stated margin: a step already running is not interrupted, so the bound is the budget plus the
#: longest unguarded chain (LONGEST_CHAIN stalled reads) plus fixed overhead (the note insert, a loaded
#: box). Without the budget the stalled create makes 10+ stalled reads (>= 5 s): it cannot pass by accident.
MARGIN = STALL * LONGEST_CHAIN + 0.5

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


@pytest.fixture(params=["slow", "dead"])
def stalled(monkeypatch, request):
    """Every leg sleeps STALL, then answers as it really would (`slow`) or raises (`dead`: the Task 15b
    probe's fail mode). Returns the call log."""
    calls: list[str] = []
    dead = request.param == "dead"
    # engine's process-wide caches (a rundown, a breadth) would let a stalled read be skipped depending on
    # which test ran first; every stalled run starts from a cold engine.
    from api.services.cache import cache
    for key in ("wire_data", "breadth", "rundown"):
        cache.invalidate(key)
    request.addfinalizer(lambda: [cache.invalidate(k) for k in ("wire_data", "breadth", "rundown")])
    for mod_name, attr in LEGS:
        mod = importlib.import_module(mod_name)
        real = getattr(mod, attr)

        def slow(*a, _real=real, _key=f"{mod_name}.{attr}", **k):
            calls.append(_key)
            time.sleep(STALL)
            if dead:
                raise OSError(f"{_key} is dead")
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
    # Review I-1: the interface the client reads -- the IR-S11 shape plus WHY.
    assert mc["params"] == {"uncaptured": True, "fields": "all", "reason": "budget"}, mc["params"]
    assert mc["capturedAt"] is None
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
    client = _route(monkeypatch)                  # review M-3: build and import BEFORE the clock starts
    try:
        t0 = time.monotonic()
        got = client.get(f"/api/j2/trader-blocks/prep/{part}")
        took = time.monotonic() - t0
    finally:
        cache.invalidate(engine.EARNINGS_CACHE_KEY)
    body = got.json()
    assert stalled, "non-vacuity: the stalled reads were reached"
    assert got.status_code == 200 and body["part"] == part
    assert body["missing"] == "source_error" and body["detail"] == tb.PREP_GAPS["source_error"]
    assert not ({"items", "cards", "bmo", "headline"} & set(body)), body          # no partial read
    assert took < BUDGET + MARGIN, took


# ── fix round 2 ────────────────────────────────────────────────────────────────────────────────

def _empty_note(user="u1"):
    from api.services.journal_two import notes
    return notes.create_note(user, {"title": "blank"})


def test_the_dry_run_on_an_empty_note_makes_no_read_at_all(db_path, small_budget, stalled):
    """Review I-2: GET .../style-update-plan on an empty note switched to Daily prep lists the blocks
    without running a single reading builder (compose builds the body at write time)."""
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    n = _empty_note()
    t0 = time.monotonic()
    plan = js.plan_style_update("u1", n["id"], style_id="builtin:daily_prep")
    took = time.monotonic() - t0
    assert (plan["insertsOutline"], plan["mode"]) == (True, "create")
    assert stalled == [], stalled                                            # zero stalled reads
    added = [a["block"] for a in plan["add"]]
    assert set(added) == set(PREP) | {"marketcontext", "myRules"} and set(added) & tb.READS_ON_CREATE
    assert took < BUDGET, took


def test_switching_an_empty_note_with_every_read_stalled_runs_on_ONE_clock(
        db_path, small_budget, stalled, monkeypatch):
    """Review I-2: the write is bounded by ONE budget (compose's) plus the stated margin, and what ran
    out lands uncaptured exactly as a create's does. The clocks are COUNTED (each start_budget that set
    a deadline on a memo that had none), because a stall count depends on what engine's caches held."""
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    clocks: list[int] = []
    real_start = tb.start_budget

    def start(memo):
        if tb._DEADLINE not in memo:
            clocks.append(id(memo))
        return real_start(memo)
    monkeypatch.setattr(tb, "start_budget", start)
    n = _empty_note()
    t0 = time.monotonic()
    note, plan = js.apply_style_update("u1", n["id"], style_id="builtin:daily_prep",
                                       expected_updated_at=n["updatedAt"])
    took = time.monotonic() - t0
    assert stalled, "non-vacuity: compose reached the stalled reads"
    assert took < BUDGET + MARGIN, (took, stalled)
    assert len(clocks) == 1, clocks                                             # ONE clock per request
    blocks = _embeds(note)
    for wid in PREP:
        assert "snapshot" not in blocks[wid]["params"], wid
    assert blocks["marketcontext"]["params"].get("reason") == "budget"


def _reads_spy(monkeypatch):
    """Every reading seam trader_blocks has, recording any call (the LEGS plus its own read doors)."""
    from api.services.journal_two import trader_blocks as tb
    seen: list[str] = []
    for mod_name, attr in LEGS:
        mod = importlib.import_module(mod_name)
        real = getattr(mod, attr)
        monkeypatch.setattr(mod, attr, lambda *a, _r=real, _k=f"{mod_name}.{attr}", **k: seen.append(_k) or _r(*a, **k))
    for attr in ("_breadth", "_regime_field", "_quotes", "_cached_quote", "_my_names", "prep_part",
                 "market_context_params", "price_stamp_quote", "recent_closed_trades", "trade_review"):
        real = getattr(tb, attr)
        monkeypatch.setattr(tb, attr, lambda *a, _r=real, _k=attr, **k: seen.append(_k) or _r(*a, **k))
    return seen


def test_READS_ON_CREATE_is_exactly_the_builders_that_read(db_path, monkeypatch):
    """The set _plan skips is derived, not guessed: every builder OUTSIDE it reads nothing in create
    mode, and every builder INSIDE it reads (so the set holds no idle entry)."""
    from datetime import datetime, timezone
    from api.services.journal_two import journal_styles as js, trader_blocks as tb
    seen = _reads_spy(monkeypatch)
    for bid, builder in js.BLOCK_BUILDERS.items():
        kind = js._BLOCK_BY_ID.get(bid) or {"settings": []}
        block = {"block": bid, "enabled": True,
                 "settings": {x["key"]: x["default"] for x in kind.get("settings", [])}}
        seen.clear()
        node, reason = builder(block, {"ticker": "NVDA", "now": datetime.now(timezone.utc), "memo": {},
                                       "mode": "create", "user_id": "u1"})
        if bid in tb.READS_ON_CREATE:
            assert seen and node is not None and reason is None, (bid, seen, reason)
        else:
            assert seen == [], (bid, seen)
    assert tb.READS_ON_CREATE <= set(js.BLOCK_BUILDERS)                            # non-vacuity


def test_a_reading_builder_builds_a_node_even_when_every_read_raises(db_path, monkeypatch):
    """So skipping it in a dry run cannot change what the plan lists: it never answers a skip."""
    from datetime import datetime, timezone
    from api.services.journal_two import journal_styles as js, trader_blocks as tb

    def boom(*_a, **_k):
        raise RuntimeError("unreadable")
    for attr in ("_breadth", "_regime_field", "_quotes", "_cached_quote", "_my_names"):
        monkeypatch.setattr(tb, attr, boom)
    for bid in tb.READS_ON_CREATE:
        node, reason = js.BLOCK_BUILDERS[bid]({"block": bid, "enabled": True, "settings": {}},
                                             {"ticker": None, "now": datetime.now(timezone.utc), "memo": {},
                                              "mode": "create", "user_id": "u1"})
        assert node is not None and reason is None, bid


def test_the_market_context_route_with_stalled_reads_answers_its_failure_within_the_budget(
        db_path, small_budget, stalled, monkeypatch):
    """F-MC-CAPTURE-BUDGET: the hand-inserted stamp's read runs under the same budget; a spent one is
    the router's trader-block read failure (409 + sentence), which the slash command reads as "could
    not be read just now, nothing was added"."""
    from api.routers import notebook_journal_styles as r
    client = _route(monkeypatch)
    t0 = time.monotonic()
    got = client.get("/api/j2/trader-blocks/market-context")
    took = time.monotonic() - t0
    assert stalled, "non-vacuity: the stalled reads were reached"
    assert (got.status_code, got.json()["detail"]) == (409, r.MARKET_CONTEXT_UNREAD_SENTENCE)
    assert took < BUDGET + MARGIN, took


def test_a_spent_budget_raises_out_of_interest_for_after_one_source(monkeypatch):
    """Review M-2: the per-source hook sits OUTSIDE interest_for's per-source catch, so a spent budget
    stops the read after the source in flight; it is never swallowed into "no names"."""
    from api.services import member_interest as mi
    from api.services.journal_two import trader_blocks as tb
    fn = {"positions": "_position_syms", "watchlist": "_watchlist_syms", "flagged": "_flagged_syms",
          "uct20": "_uct20_syms"}
    assert set(fn) == set(mi.SOURCES), mi.SOURCES                 # the map covers the declared vocabulary
    first = fn[mi.SOURCES[0]]                                      # read first (positions, by the registry)
    calls: list[str] = []

    def slow(uid):
        calls.append(first)
        time.sleep(0.05)                                    # spends the 0.02 s budget below
        return {"AAA"}
    for name in fn.values():
        monkeypatch.setattr(mi, name, slow if name == first else (lambda uid, _n=name: calls.append(_n) or set()))
    monkeypatch.setattr(tb, "PREP_CREATE_BUDGET_S", 0.02)
    memo = tb.start_budget({})
    with pytest.raises(tb.BudgetSpent):
        mi.interest_for("u1", before_source=lambda _name: tb._spend(memo))
    assert calls == [first], calls                                 # one source read, then it stopped
    calls.clear()
    token = tb._ACTIVE_BUDGET.set(tb.start_budget({}))           # and through _my_names, the real caller
    try:
        with pytest.raises(tb.BudgetSpent):
            tb._my_names("u1")
    finally:
        tb._ACTIVE_BUDGET.reset(token)
    assert calls == [first], calls


def test_the_regime_read_asks_the_hold_once_per_compose(monkeypatch):
    """Review M-5: memo first; a cold pod's empty hold is remembered, so repeats do not re-read."""
    from api.services import engine
    from api.services.journal_two import trader_blocks as tb
    asked: list[bool] = []
    monkeypatch.setattr(engine, "get_breadth", lambda held_only=False: asked.append(held_only) or None)
    memo: dict = {}
    first, second = tb._regime_field(memo), tb._regime_field(memo)
    assert asked == [True], asked
    assert first == second and first["missing"] == "wire_unavailable" and first.get("value") is None


def test_a_budget_reason_survives_the_save_and_never_reaches_a_stranger(db_path):
    """Review I-1 interface: `reason` is stored and served as written (the server whitelists no param of
    this block), and a public copy keeps none of the market context's params, so it cannot leak there."""
    from api.services.journal_two import notes, public_note_payload as pub
    node = {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "marketcontext", "embedId": "e1",
            "mode": "snapshot", "params": {"uncaptured": True, "fields": "all", "reason": "budget"},
            "capturedAt": None, "annotations": [], "caption": None,
            "layout": {"width": "full", "height": None}, "fallback": None}}
    body = notes._validate_body_json({"type": "doc", "content": [node]})
    notes._refuse_unbuildable(body)
    n = notes.create_note("u1", {"title": "t", "bodyJson": body})
    got = notes.get_note("u1", n["id"])
    assert got["bodyJson"]["content"][0]["attrs"]["params"]["reason"] == "budget"
    assert "marketcontext" not in pub.EMBED_PARAM_KEYS                               # no params published
