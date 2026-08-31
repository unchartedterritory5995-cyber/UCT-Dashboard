"""The signposts endpoint is keyed by the frontend door manifest. If the two
drift, Zone D renders cards with no numbers — a silent, plausible failure.

⛔ The endpoint requires auth (`Depends(get_current_user)`). A bare
unauthenticated `TestClient` always gets 401, and a test that only asserts
`status_code in (200, 401)` then skips its own body under `if status_code ==
200` PASSES WITHOUT EVER EXERCISING THE 200 PATH — a rail that cannot fail.
Every test below forces the real 200 path via `app.dependency_overrides` on
`get_current_user` (the same idiom `tests/test_admin_chart_health.py` uses:
fake the GATE'S INPUT, never the gate itself, so the real auth/route code
still runs) and clears the override in a fixture teardown so it can never
leak into another test module.
"""
import pathlib
import re

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user
from api.services.cache import cache as _cache

DOORS_JS = pathlib.Path("app/src/pages/dashboard/doors.js")


def _door_keys() -> set[str]:
    src = DOORS_JS.read_text(encoding="utf-8")
    return set(re.findall(r"key:\s*'([a-z0-9_]+)'", src))


def _as(user: dict) -> TestClient:
    """Present `user` to the REAL `get_current_user`-gated route, by faking
    only that dependency's input."""
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def auth_client():
    client = _as({"id": 1, "role": "user", "email": "member@test"})
    yield client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _clear_signposts_cache():
    """The endpoint self-caches its whole response under ONE global key
    (`dashboard_signposts`, 60s TTL). Without clearing it, the first test to
    populate it would silently serve every later test a stale cached body —
    including the raising-service test below, which needs its monkeypatch to
    actually be exercised, not skipped by a warm cache from a prior test."""
    _cache.invalidate("dashboard_signposts")
    yield
    _cache.invalidate("dashboard_signposts")


def test_signposts_requires_auth():
    """Without the override, the real 401 gate still fires — this is the
    assertion the brief's own vacuous version never made."""
    client = TestClient(app)
    r = client.get("/api/dashboard/signposts")
    assert r.status_code == 401


def test_signposts_covers_every_door(auth_client):
    r = auth_client.get("/api/dashboard/signposts")
    assert r.status_code == 200
    assert set(r.json().keys()) == _door_keys()


def test_every_card_has_label_value_tone(auth_client):
    r = auth_client.get("/api/dashboard/signposts")
    assert r.status_code == 200
    for card in r.json().values():
        assert set(card.keys()) == {"label", "value", "tone"}
        assert isinstance(card["label"], str) and card["label"]


def test_door_manifest_is_not_empty():
    assert len(_door_keys()) == 8


def test_one_failing_card_does_not_break_the_others(auth_client, monkeypatch):
    """A raising service must yield exactly ONE null card, never a 500 for the
    whole endpoint. Discriminates the brief's per-block try/except design:
    patch engine.get_breadth to raise and confirm every other key still comes
    back well-formed with breadth alone nulled out."""
    from api.services import engine

    def _boom():
        raise RuntimeError("breadth service is down")

    monkeypatch.setattr(engine, "get_breadth", _boom)

    r = auth_client.get("/api/dashboard/signposts")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == _door_keys()
    assert body["breadth"]["value"] is None
    for card in body.values():
        assert set(card.keys()) == {"label", "value", "tone"}


# ---------------------------------------------------------------------------
# The desk door — moved off the client
# ---------------------------------------------------------------------------
#
# 🔴 IT WAS REFUSED HERE FOR THE WRONG REASON AND THE STAND-IN WAS BROKEN.
# `desk` sat in this module's null list beside `journal` and `community`, but
# its objection was CACHE SHAPE (`desk_store.list_posts` has no TTLCache), not
# per-user data — the number is the same for every member, and this endpoint
# already owns a 60s cache, so the read happens at most once a minute for
# everybody. Meanwhile the client fill it was left to was blank Mon–Fri (it
# borrowed `TheWeek`'s SWR key, and that hero mounts only at the weekend) and
# structurally "0" the rest of the time, because `published_at` is a unix EPOCH
# INT and `Date.parse` of an integer is NaN.

def _desk(client) -> dict:
    return client.get("/api/dashboard/signposts").json()["desk"]


def test_desk_counts_posts_inside_the_48h_window(auth_client, monkeypatch):
    import time as _time

    from api.services import desk_store

    now = _time.time()
    monkeypatch.setattr(desk_store, "list_posts", lambda limit=12: [
        {"published_at": int(now - 3600)},          # 1h ago      ✓
        {"published_at": int(now - 47 * 3600)},     # 47h ago     ✓
        {"published_at": int(now - 49 * 3600)},     # 49h ago     ✗ outside
        {"published_at": int(now - 400 * 3600)},    # weeks ago   ✗
    ])
    assert _desk(auth_client) == {"label": "New", "value": 2, "tone": "neutral"}


def test_desk_reads_EPOCH_SECONDS_which_is_what_the_store_actually_holds(auth_client, monkeypatch):
    # ⛔ THE EXACT BUG THE CLIENT VERSION HAD, PINNED. Its fixture built ISO
    # strings the endpoint never sends, so it passed while production counted
    # nothing. An int must be understood; a string date must NOT be silently
    # coerced into a number and counted.
    import time as _time

    from api.services import desk_store

    now = _time.time()
    monkeypatch.setattr(desk_store, "list_posts", lambda limit=12: [
        {"published_at": int(now - 60)},                       # a real row  ✓
        {"published_at": "2026-08-30T12:00:00Z"},              # not the shape ✗
        {"published_at": None},                                # ✗
        {},                                                    # ✗
        {"published_at": True},                                # bool is an int in Python ✗
    ])
    assert _desk(auth_client)["value"] == 1


def test_desk_does_not_count_a_future_dated_row(auth_client, monkeypatch):
    # A clock problem is not a new article, and counting it would inflate the
    # number with nothing on screen to say why.
    import time as _time

    from api.services import desk_store

    now = _time.time()
    monkeypatch.setattr(desk_store, "list_posts", lambda limit=12: [
        {"published_at": int(now + 86_400)},
        {"published_at": int(now - 60)},
    ])
    assert _desk(auth_client)["value"] == 1


def test_desk_is_a_real_ZERO_not_a_null_when_nothing_is_recent(auth_client, monkeypatch):
    # ⭐ The distinction the door renders differently: `0` prints a number,
    # `None` prints a plain link. "Nothing published in 48h" is an ANSWER.
    import time as _time

    from api.services import desk_store

    now = _time.time()
    monkeypatch.setattr(desk_store, "list_posts",
                        lambda limit=12: [{"published_at": int(now - 500 * 3600)}])
    assert _desk(auth_client)["value"] == 0


def test_a_raising_desk_store_leaves_the_door_null_and_the_other_seven_intact(auth_client, monkeypatch):
    # Every block here is independently best-effort; a SQLite problem in one
    # must not take the response down.
    from api.services import desk_store

    def boom(**kw):
        raise RuntimeError("desk.db is locked")

    monkeypatch.setattr(desk_store, "list_posts", boom)
    body = auth_client.get("/api/dashboard/signposts").json()
    assert body["desk"]["value"] is None
    assert set(body) == _door_keys()


def test_journal_and_community_STAY_null_here(auth_client):
    # ⛔ THE REFUSAL THAT MUST NOT DRIFT WITH IT. `desk` moved because it is the
    # same number for everybody. These two are per-user, and this payload is
    # cached under ONE global key shared by every logged-in member — writing a
    # member's count here would serve it to everyone else for the next 60s.
    body = auth_client.get("/api/dashboard/signposts").json()
    assert body["journal"]["value"] is None
    assert body["community"]["value"] is None


# ---------------------------------------------------------------------------
# The UCT 20 door — it was bare because it read one tier too shallow
# ---------------------------------------------------------------------------
#
# 🔴 THE DEFECT, IN ONE SENTENCE: the block peeked `cache.get("uct20_portfolio")`
# — the FIRST tier of `engine.get_uct20_portfolio_data()` — to stay off that
# function's network tail, and skipped the middle tier, which is the only one
# that is reliably warm. Nothing on the pod warms `uct20_portfolio` (it is not
# in `main.py::_warm_dashboard_caches`, and `/api/push` INVALIDATES it every
# morning), while `wire_data` — which carries the whole portfolio — is seeded
# into the cache at boot from `/data/wire_data.json`. So the door filled only
# when an unrelated request had already re-derived the key: a coin flip,
# re-tossed daily. Measured live 2026-08-30: `/api/uct20/portfolio` returned 20
# open positions while `/api/dashboard/signposts` returned `uct20: null`.
#
# ⛔ THE FIXTURE MATCHES THE REAL WIRE PAYLOAD, and that is not a formality —
# the `desk` door above was structurally zero for its whole life because its
# fixture built ISO strings where the store emits epoch ints. Verified against
# the live `wire_data.json`: `uct20_portfolio.open_positions[]` rows carry
# `{symbol, entry_date, entry_price, current_price, pct_return, dollar_pnl,
# days_held}` and `entry_date` is an ISO `'YYYY-MM-DD'` STRING.

def _open_position(symbol: str, entry_date, **over) -> dict:
    """One row in the real shape of `wire_data.uct20_portfolio.open_positions`."""
    row = {
        "symbol": symbol,
        "entry_date": entry_date,
        "entry_price": 208.25,
        "current_price": 218.4,
        "pct_return": 4.87,
        "dollar_pnl": 121.85,
        "days_held": 1,
    }
    row.update(over)
    return row


def _wire_with(positions) -> dict:
    """A wire_data payload carrying a portfolio in the shape /api/push stores."""
    return {
        "date": "2026-08-29",
        "uct20_portfolio": {
            "account_size": 50000.0,
            "open_count": len(positions),
            "open_positions": positions,
            "trades": [],
            "equity_curve": [],
        },
    }


@pytest.fixture
def cold_uct20_key():
    """The production state this door has to survive: `uct20_portfolio` COLD.

    Cleared before AND after, because `get_uct20_portfolio_warm()` writes the
    key when it resolves from wire_data — a warm leftover would let a later
    test pass for the wrong reason."""
    _cache.invalidate("uct20_portfolio")
    yield
    _cache.invalidate("uct20_portfolio")


def _uct20(client) -> dict:
    return client.get("/api/dashboard/signposts").json()["uct20"]


def test_uct20_fills_from_wire_data_when_its_OWN_cache_key_is_cold(
    auth_client, monkeypatch, cold_uct20_key
):
    """⭐ THE REGRESSION RAIL FOR THE BARE DOOR. Cold key + warm wire_data is
    exactly a fresh pod, and exactly the state after every morning push."""
    from api.services import engine

    monkeypatch.setattr(engine, "_load_wire_data", lambda: _wire_with([
        _open_position("CRWD", "2026-08-27"),
        _open_position("NVDA", "2026-08-27"),
        _open_position("AVGO", "2026-08-27"),
        _open_position("ANET", "2026-08-28"),
        _open_position("PLTR", "2026-08-28"),
    ]))
    assert _uct20(auth_client) == {"label": "New", "value": 2, "tone": "neutral"}


def test_uct20_counts_only_the_MOST_RECENT_entry_date_not_the_whole_book(
    auth_client, monkeypatch, cold_uct20_key
):
    """The definition, pinned: this is the same number a member can count off
    /uct-20, where `UCT20.jsx` badges a row NEW when its `entry_date` equals the
    max `entry_date` across open positions. Counting the book would say 4."""
    from api.services import engine

    monkeypatch.setattr(engine, "_load_wire_data", lambda: _wire_with([
        _open_position("CRWD", "2026-08-27"),
        _open_position("NVDA", "2026-08-27"),
        _open_position("AVGO", "2026-08-27"),
        _open_position("ANET", "2026-08-28"),
    ]))
    assert _uct20(auth_client)["value"] == 1


def test_uct20_reads_ISO_DATE_STRINGS_which_is_what_the_wire_actually_carries(
    auth_client, monkeypatch, cold_uct20_key
):
    """⛔ THE `desk` LESSON APPLIED HERE. `entry_date` is an ISO string in the
    live payload. A row carrying something else must be SKIPPED, never coerced
    — and must not take the card down: `max()` over a mixed str/int list raises,
    which the outer `except` would turn into a silent null door."""
    from api.services import engine

    monkeypatch.setattr(engine, "_load_wire_data", lambda: _wire_with([
        _open_position("CRWD", "2026-08-28"),      # the real shape   ✓
        _open_position("BOGUS", 1756339200),       # epoch int        ✗
        _open_position("NADA", None),              # missing          ✗
        {"symbol": "SHAPELESS"},                   # no entry_date    ✗
    ]))
    assert _uct20(auth_client)["value"] == 1


def test_uct20_is_a_real_ZERO_when_the_book_is_empty(
    auth_client, monkeypatch, cold_uct20_key
):
    """⭐ The distinction the door renders differently: `0` prints a number,
    `None` prints a plain link. A tracked-but-empty book is an ANSWER."""
    from api.services import engine

    monkeypatch.setattr(engine, "_load_wire_data", lambda: _wire_with([]))
    assert _uct20(auth_client)["value"] == 0


def test_uct20_is_NULL_when_no_warm_source_holds_the_portfolio(
    auth_client, monkeypatch, cold_uct20_key
):
    """A bare door is honest. "We do not know" must not render as "0 new"."""
    from api.services import engine

    monkeypatch.setattr(engine, "_load_wire_data", lambda: None)
    assert _uct20(auth_client)["value"] is None


def test_uct20_never_calls_the_NETWORK_CAPABLE_resolver(
    auth_client, monkeypatch, cold_uct20_key
):
    """⛔ THE CONSTRAINT THIS ENDPOINT EXISTS UNDER. `get_uct20_portfolio_data()`
    ends in a direct `uct_intelligence.api` call that fetches bars for every
    ever-held symbol. Simplifying the door to call it would look identical in
    every other test here and would put real network work on the request path,
    so this one makes that function EXPLODE and still demands a filled door."""
    from api.services import engine

    def _forbidden():
        raise AssertionError("signposts must not call the network-capable resolver")

    monkeypatch.setattr(engine, "get_uct20_portfolio_data", _forbidden)
    monkeypatch.setattr(engine, "_load_wire_data", lambda: _wire_with([
        _open_position("CRWD", "2026-08-28"),
        _open_position("NVDA", "2026-08-28"),
    ]))
    assert _uct20(auth_client)["value"] == 2


def test_uct20_still_prefers_its_own_cache_key_over_wire_data(
    auth_client, monkeypatch, cold_uct20_key
):
    """Tier order unchanged: a freshly-pushed `uct20_portfolio` (written by
    whatever last called the full resolver) still wins over the wire snapshot."""
    from api.services import engine

    _cache.set("uct20_portfolio", {
        "open_positions": [_open_position("HOT", "2026-08-29")],
    }, ttl=60)
    monkeypatch.setattr(engine, "_load_wire_data", lambda: _wire_with([
        _open_position("STALE", "2026-08-28"),
        _open_position("ALSO_STALE", "2026-08-28"),
    ]))
    assert _uct20(auth_client)["value"] == 1


def test_a_raising_wire_load_leaves_uct20_null_and_the_other_seven_intact(
    auth_client, monkeypatch, cold_uct20_key
):
    from api.services import engine

    def boom():
        raise RuntimeError("volume not mounted")

    monkeypatch.setattr(engine, "_load_wire_data", boom)
    body = auth_client.get("/api/dashboard/signposts").json()
    assert body["uct20"]["value"] is None
    assert set(body) == _door_keys()


# ---------------------------------------------------------------------------
# The calendar door — order-dependent, but deliberately left as it is
# ---------------------------------------------------------------------------
#
# `amc_tonight` has NO warm mirror: `engine._normalize_earnings` builds it from
# a LIVE EarningsWhispers fetch plus a live Finnhub calendar call, and
# `wire_data["earnings"]` carries only `bmo` + `amc` (verified against the live
# payload, whose earnings keys are exactly {"bmo", "amc"}). Reading a different
# roster on a cold key would silently swap the door's DEFINITION depending on
# cache state — worse than a bare door. The one thing that must not drift is
# that a warm-but-quiet night and a cold key stay distinguishable.

def test_calendar_is_a_real_ZERO_on_a_quiet_night_and_NULL_on_a_cold_key(auth_client):
    _cache.invalidate("earnings")
    try:
        _cache.set("earnings", {"bmo": [], "amc": [], "amc_tonight": []}, ttl=60)
        _cache.invalidate("dashboard_signposts")
        assert auth_client.get("/api/dashboard/signposts").json()["calendar"] == {
            "label": "On deck", "value": 0, "tone": "neutral"}

        _cache.invalidate("earnings")
        _cache.invalidate("dashboard_signposts")
        assert auth_client.get(
            "/api/dashboard/signposts").json()["calendar"]["value"] is None
    finally:
        _cache.invalidate("earnings")
