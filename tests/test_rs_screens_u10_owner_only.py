"""RS screens unit U10: the owner-only value of ``RS_SCREENS_ENABLED``.

The flag takes three values, parsed by the helper the Focus screener flags use
(``api.routers.auth._breadth_dc_scope``): off, ``admin`` (the owner's private look) and on
for everyone. Under ``admin`` the DATA is computed for everyone (``rs_post_pass.enabled``:
the build's extra columns, the pass, the membership record) and the member-facing SURFACES
exist only for an admin (``rs_post_pass.surfaces_on(user)``: the five starters and the
hidden marks, the four views and the dark filter keys in ``meta``, the method page).

Why each rail exists:
  * the one direction that can cost anything is ``admin`` reaching a member: an unreleased
    screen shipped to the whole roster by the value that was meant to be the cautious one.
    So a member under ``admin`` is compared, byte for byte, with the same member under the
    flag off, on every route the page reads;
  * the owner's look must be the real thing, so an admin under ``admin`` is compared, byte
    for byte, with what everyone is served under ``1``;
  * each comparison has a control (on differs from off), so none can pass by every route
    answering the same thing whatever the flag says;
  * the data readers must be ON under ``admin``, or the owner would look at five empty
    screens, and the nightly membership record must take the five as well as the lists
    members still see, so "new today" works for both on the first day of a full release.
"""
from __future__ import annotations

import json
import os
from contextlib import closing
from pathlib import Path

import pytest

from api.services import feature_flag_index as ffi
from api.services.screener import filters as F
from api.services.screener import membership, methodology
from api.services.screener import rs_post_pass as pp
from api.services.screener import saved_screens as ss
from api.services.screener import snapshot_builder as sb
from api.services.screener import snapshot_db

ROOT = Path(__file__).resolve().parents[1]
FOCUS = "SCREENER_FOCUS_LAYOUT_ENABLED"

MEMBER = {"id": "u1", "role": "member", "plan": "pro"}
ADMIN = {"id": "u1", "role": "admin", "plan": "pro"}

FIVE = ("starter_rs_top_rating", "starter_rs_new_high", "starter_rs_nh_before_price",
        "starter_rs_leaders", "starter_rs_exit_warning_5")
#: The nine RS starters a member is served while the five are not (flag off, or `admin`).
TODAY_RS = ("starter_rs_new_high", "starter_rs_nh_before_price", "starter_rs_nh_red_day",
            "starter_rs_green_on_red", "starter_rs_cross_up_21ema",
            "starter_rs_mansfield_positive", "starter_rs_leaders_equal_weight",
            "starter_rs_exit_warning_5", "starter_rs_quicksand_5")

OFF = (None, "0", "false", "no", "off", " OFF ")
OWNER = ("admin", " Admin ", "ADMIN")
EVERYONE = ("1", "true", "yes", "on", " TRUE ")
#: Not a spelling of anything: each must read as off, never as the opposite of it.
UNKNOWN = ("", "flase", "2", "enabled", "owner", "admins", "admin,1", "everyone")


def _set(monkeypatch, value, name=None):
    name = name or pp.FLAG
    if value is None:
        monkeypatch.delenv(name, raising=False)
    else:
        monkeypatch.setenv(name, value)


def _reads():
    """(data on, served with no user, served to a member, served to an admin)."""
    return (pp.enabled(), pp.surfaces_on(), pp.surfaces_on(MEMBER), pp.surfaces_on(ADMIN))


# ───────────────────────── the three values ─────────────────────────

@pytest.mark.parametrize("value", OFF + UNKNOWN)
def test_off_and_every_unknown_value_is_off_for_everyone(monkeypatch, value):
    _set(monkeypatch, value)
    assert _reads() == (False, False, False, False), value


@pytest.mark.parametrize("value", OWNER)
def test_admin_computes_the_data_for_everyone_and_serves_only_an_admin(monkeypatch, value):
    _set(monkeypatch, value)
    assert _reads() == (True, False, False, True), value


@pytest.mark.parametrize("value", EVERYONE)
def test_on_is_everything_for_everyone(monkeypatch, value):
    _set(monkeypatch, value)
    assert _reads() == (True, True, True, True), value


def test_only_the_admin_role_is_an_admin_and_a_caller_with_no_user_is_a_member(monkeypatch):
    """The admin test is the one the rest of the screener applies to a user dict
    (`premarket.served_to`, the New today route): `role == "admin"`, nothing looser."""
    _set(monkeypatch, "admin")
    assert pp.surfaces_on({"id": "u1", "role": "admin"}) is True
    for user in (None, {}, {"id": "u1"}, {"role": "member"}, {"role": "Admin"}, {"role": "administrator"},
                 {"role": None}, {"is_admin": True}, {"plan": "admin"}, "admin", ["admin"], 1):
        assert pp.surfaces_on(user) is False, user
    assert pp.enabled() is True, "a user the reader cannot read never turns the data off"


@pytest.mark.parametrize("value", OFF + OWNER + EVERYONE + UNKNOWN)
def test_the_value_is_parsed_exactly_as_a_focus_flag_parses_it(monkeypatch, value):
    """One grammar: the same raw value in a Focus screener flag reads the same way."""
    from api.routers import auth
    _set(monkeypatch, value)
    _set(monkeypatch, value, FOCUS)
    scope = auth._breadth_dc_scope(FOCUS, auth.SCREENER_FLAGS[FOCUS])
    focus = lambda is_admin: auth._screener_flags(is_admin=is_admin)[FOCUS.lower()]  # noqa: E731
    assert _reads() == (scope != auth._SCOPE_OFF, focus(False), focus(False), focus(True)), value


def test_it_is_the_focus_helper_that_reads_it_and_it_reads_per_call(monkeypatch):
    """No second parser: the readers ask `auth._breadth_dc_scope` each time they are asked."""
    from api.routers import auth
    asked, answer = [], {"scope": auth._SCOPE_OFF}
    monkeypatch.setattr(auth, "_breadth_dc_scope",
                        lambda name, default_on: asked.append((name, default_on)) or answer["scope"])
    assert _reads() == (False, False, False, False)
    answer["scope"] = auth._ADMIN_ONLY
    assert _reads() == (True, False, False, True)
    answer["scope"] = auth._SCOPE_ALL
    assert _reads() == (True, True, True, True)
    assert asked == [("RS_SCREENS_ENABLED", False)] * 12
    assert pp.RS_SCREENS_FLAGS == {"RS_SCREENS_ENABLED": False}, "the default is off"


def test_a_flag_that_cannot_be_read_is_off(monkeypatch):
    from api.routers import auth

    def _broken(name, default_on):
        raise RuntimeError("unreadable")
    monkeypatch.setenv(pp.FLAG, "1")
    monkeypatch.setattr(auth, "_breadth_dc_scope", _broken)
    assert _reads() == (False, False, False, False)


# ───────────────────────── the data is on under `admin` ─────────────────────────

@pytest.mark.parametrize("value,data", [(None, False), ("0", False), ("flase", False),
                                        ("admin", True), ("1", True)])
def test_every_data_call_site_follows_the_data_reader(monkeypatch, value, data):
    _set(monkeypatch, value)
    # the build's two extra steps (thirteen columns)
    assert sb.rs_screens_enabled() is data
    # the pass at the end of a build: it runs, or the build's stats carry no key for it
    ran = []
    with monkeypatch.context() as mp:
        mp.setattr(pp, "run", lambda **k: ran.append(k) or {"ok": True, "populated": {}})
        assert (sb._rs_post_pass({}) is not None) is data
    # (unit U8 also hands the build's own SPY read to the pass; this test is about the gate)
    assert [k["source"] for k in ran] == (["build"] if data else [])
    # the pass itself (its own gate, before it opens the database)
    monkeypatch.setattr(pp, "_run", lambda receipt, session, now: receipt.update(ok=True))
    monkeypatch.setattr(pp, "_record", lambda receipt: None)
    receipt = pp.run("2026-11-12")
    assert receipt["enabled"] is data
    assert (receipt["reason"] == "disabled") is (not data)


@pytest.mark.parametrize("value,data", [(None, False), ("admin", True), ("1", True)])
def test_the_pass_after_the_rating_job_runs_under_admin(monkeypatch, value, data):
    """`api.main._run_rs_post_pass`: the 04:15 and 04:40 ET doors, and the re-record."""
    import api.main as m
    from api.services.screener import distribution
    _set(monkeypatch, value)
    events = []
    monkeypatch.setattr(pp, "run", lambda **k: events.append("pass") or {"ok": True, "rewritten": True})
    monkeypatch.setattr(distribution, "invalidate", lambda: None)
    monkeypatch.setattr(distribution, "distributions", lambda: {})
    monkeypatch.setattr(membership, "rerecord_all", lambda: events.append("membership") or {})
    m._run_rs_post_pass("rating")
    assert events == (["pass", "membership"] if data else [])


def _rs_v2(monkeypatch, on=True):
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", on)


def _recorded(monkeypatch):
    """The specs `membership.record_all` records, by hash (the record itself is stubbed)."""
    seen = {}
    monkeypatch.setattr(ss, "all_specs", lambda: [])
    monkeypatch.setattr(membership, "_build_identity", lambda: ("2026-11-13", "2026-11-13"))

    def _record(spec, **k):
        seen[membership.spec_hash(spec)] = spec
        return "ok"
    monkeypatch.setattr(membership, "record", _record)
    out = membership.record_all()
    assert out["errors"] == 0, out
    return seen


def _hashes(starters):
    return {membership.spec_hash(s["spec"]) for s in starters}


def test_the_nightly_membership_record_takes_the_five_under_admin_and_under_on(monkeypatch):
    _rs_v2(monkeypatch)
    _set(monkeypatch, None)
    off_list = ss.starters()
    off = set(_recorded(monkeypatch))
    assert off == _hashes(off_list), "off: exactly the starters a member is served, as before"
    _set(monkeypatch, "1")
    on_list = ss.starters()
    on = set(_recorded(monkeypatch))
    assert on == _hashes(on_list)
    five = _hashes([s for s in on_list if s["id"] in FIVE])
    assert len(five) == 5 and five <= on and not (five <= off)
    _set(monkeypatch, "admin")
    assert ss.starters() == off_list, "control: a caller with no user is a member"
    owner = set(_recorded(monkeypatch))
    # the five (so "new today" has a first record on the day of a full release) ...
    assert five <= owner
    # ... and every list a member is still served while the look is private
    assert off <= owner
    assert owner == off | on


def test_the_record_list_is_the_served_list_while_there_is_one_list(monkeypatch):
    _rs_v2(monkeypatch)
    for value in (None, "0", "1", "flase"):
        _set(monkeypatch, value)
        assert ss.starters_to_record() == ss.starters(), value
    # without RS_V2 the five do not exist (they read its columns): nothing is added
    _rs_v2(monkeypatch, on=False)
    _set(monkeypatch, "admin")
    assert _hashes(ss.starters_to_record()) == _hashes(ss.starters())


# ───────────────────────── the surfaces: byte for byte ─────────────────────────

ROUTES = ("/api/screener/saved-screens", "/api/screener/meta", "/api/screener/methodology",
          "/api/screener/fields", "/api/screener/fields?options=1",
          "/api/screener/methodology?column=rs_rating_pos")
#: The three the flag changes. `fields` is the registry itself (`filters.field_catalog`):
#: it lists every key whatever the flag says, so it is the same in all six cells, and the
#: per-column method of an RS screens column is published whatever the flag says too.
GATED = ROUTES[:3]


@pytest.fixture
def served(monkeypatch):
    """`read(value, user)` -> {route: the response body's bytes}, on a pod whose other RS
    flags are on (as production is), over the screener router and its own dependencies."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    from api.services.screener import distribution
    _rs_v2(monkeypatch)
    monkeypatch.setattr(F, "_rs_history_on", lambda: True)
    monkeypatch.setattr(F, "_rs_v3_on", lambda: True)
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": None})
    monkeypatch.setattr(screener_mod.scr_saved, "list_for", lambda uid: [])
    for name in ("SCREENER_PREMARKET_ENABLED", "SCREENER_NEW_TODAY_ENABLED", FOCUS):
        monkeypatch.delenv(name, raising=False)
    who = {}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(who["user"])
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who["user"])
    client = TestClient(app)

    def read(value, user):
        _set(monkeypatch, value)
        who["user"] = user
        out = {}
        for route in ROUTES:
            r = client.get(route)
            assert r.status_code == 200, (route, value, r.text[:200])
            out[route] = r.content
        return out
    return read


def _differing(a, b):
    return [route for route in ROUTES if a[route] != b[route]]


def test_a_member_under_admin_is_served_exactly_what_the_flag_off_serves(served):
    off = served(None, MEMBER)
    assert _differing(served("admin", MEMBER), off) == []
    # the flag-off answer is the same whoever asks and however off is spelled
    assert _differing(served(None, ADMIN), off) == []
    assert _differing(served("0", MEMBER), off) == []
    assert _differing(served("flase", ADMIN), off) == []
    # control: the same member under `1` IS served something else, on each gated route
    assert _differing(served("1", MEMBER), off) == list(GATED)


def test_an_admin_under_admin_is_served_exactly_what_everyone_is_served_under_on(served):
    on = served("1", MEMBER)
    assert _differing(served("admin", ADMIN), on) == []
    assert _differing(served("1", ADMIN), on) == []
    # control: the member beside that admin, under the same value, is not
    assert _differing(served("admin", MEMBER), on) == list(GATED)


def test_what_the_owner_sees_is_the_five_and_what_a_member_sees_is_todays_nine(served):
    """The two equalities above compare whole payloads; this names what is in them."""
    owner, member = served("admin", ADMIN), served("admin", MEMBER)

    def rs_ids(body, hidden):
        return [s["id"] for s in json.loads(body[ROUTES[0]])["starters"]
                if s["id"].startswith("starter_rs_") and bool(s.get("hidden")) is hidden]
    assert rs_ids(owner, False) == list(FIVE)
    assert len(rs_ids(owner, True)) == 6
    assert rs_ids(member, False) == list(TODAY_RS) and rs_ids(member, True) == []
    for s in json.loads(member[ROUTES[0]])["starters"]:
        assert not ({"controls", "row", "empty", "hidden"} & set(s)), s["id"]

    def meta(body):
        doc = json.loads(body[ROUTES[1]])
        return ({f["key"] for f in doc["filters"]}, {v["key"] for v in doc["views"]},
                {c for v in doc["views"] for c in v["columns"]}, {f["key"] for f in doc["comparable_fields"]})
    keys, views, columns, comparable = meta(owner)
    assert set(F.RS_SCREENS_KEYS) <= keys and set(F.RS_SCREENS_VIEWS) <= views
    keys, views, columns, comparable = meta(member)
    screens = set(F.RS_SCREENS_KEYS)
    assert not (screens & keys) and not (set(F.RS_SCREENS_VIEWS) & views)
    assert not (screens & columns) and not (screens & comparable)
    assert [s["id"] for s in json.loads(owner[ROUTES[2]])["rs_screens"]["screens"]] == list(FIVE)
    assert "rs_screens" not in json.loads(member[ROUTES[2]])


def test_the_services_fail_closed_for_a_caller_that_passes_no_user(monkeypatch):
    """`starters()`, `meta()` and `all_methods()` with no user answer as for a member: the
    warm-up at boot, the concept vocabulary and any later caller that forgets the user."""
    from api.services.screener import distribution
    _rs_v2(monkeypatch)
    monkeypatch.setattr(F, "_rs_history_on", lambda: True)
    monkeypatch.setattr(F, "_rs_v3_on", lambda: True)
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": None})

    def read(value, **user):
        _set(monkeypatch, value)
        return json.dumps([ss.starters(**user), F.meta(**user), methodology.all_methods(**user)])
    off, on = read(None), read("1")
    assert off != on
    assert read("admin") == off
    assert read("admin", user=MEMBER) == off
    assert read("admin", user=ADMIN) == on
    assert read("1", user=MEMBER) == on
    # the dark-key family and the views ask the same reader when they are called bare
    _set(monkeypatch, "admin")
    assert set(F.RS_SCREENS_KEYS) <= F.rs_dark_keys(v2_on=True, history_on=True, v3_on=True)
    assert F._rs_screens_on() is False and F._rs_screens_on(MEMBER) is False
    assert F._rs_screens_on(ADMIN) is True
    assert ss.rs_screens_served() is False and ss.rs_screens_served(ADMIN) is True
    assert [s["id"] for s in ss.rs_starters()] == list(TODAY_RS)


# ───────────────────────── end to end: the real build under `admin` ─────────────────────────

class _OwnerOnly(pytest.MonkeyPatch):
    """The U6 harness (`tests/test_rs_screens_u6_e2e.py`) arms the flag with `1`. This
    arms it with `admin` instead and changes nothing else, so the same market is built."""

    def setenv(self, name, value, prepend=None):
        super().setenv(name, "admin" if name == pp.FLAG else value, prepend)


def test_the_real_build_under_admin_fills_what_on_fills_and_a_member_is_offered_none_of_it(tmp_path):
    """The nightly build, the pass and the routes, run for real over U6's synthetic market
    with the flag at `admin`. The rows are the ones the client's golden holds (captured
    under `1`), so the owner looks at the real screens; the scan route answers a member
    too (a column that exists may be filtered by anyone); and that member is offered
    none of it."""
    from tests import test_rs_screens_u6_e2e as e2e
    mp = _OwnerOnly()
    try:
        built = e2e._build(mp, tmp_path, screens_on=True)
        assert os.environ[pp.FLAG] == "admin", "control: this build ran under the owner-only value"
        last = built["passes"][-1]
        assert last["enabled"] and last["ok"] and last["rewritten"], last
        assert built["stats"]["rs_post_pass"]["enabled"] is True
        with closing(snapshot_db.connect()) as conn:
            table = [dict(r) for r in conn.execute("SELECT * FROM screener_rows")]
        filled = {c: sum(1 for r in table if r[c] is not None) for c in e2e.RS_COLUMNS}
        assert not [c for c, n in filled.items() if n == 0], f"never written under admin: {filled}"

        member = e2e._client(mp)
        golden = json.loads(e2e.ROWS_GOLDEN.read_text(encoding="utf-8"))["screens"]
        asked = 0
        for req in e2e._requests():
            if req["choices"]:
                continue
            out = member.post("/api/screener/scan", json=req["body"])
            assert out.status_code == 200, (req["starter"], out.text[:200])
            want, got = golden[req["starter"]], out.json()
            assert got["total"] == want["total"] > 0, req["starter"]
            assert [r["ticker"] for r in got["rows"][:len(want["rows"])]] == [r["ticker"] for r in want["rows"]]
            asked += 1
        assert asked == 5

        starters = member.get("/api/screener/saved-screens").json()["starters"]
        ids = [s["id"] for s in starters]
        assert [i for i in ids if i.startswith("starter_rs_")] == list(TODAY_RS)
        assert not [s["id"] for s in starters if {"controls", "row", "empty", "hidden"} & set(s)]
        meta = member.get("/api/screener/meta").json()
        assert not ({f["key"] for f in meta["filters"]} & set(e2e.RS_COLUMNS))
        assert not ({v["key"] for v in meta["views"]} & set(F.RS_SCREENS_VIEWS))
        assert "rs_screens" not in member.get("/api/screener/methodology").json()
    finally:
        mp.undo()
        e2e._forget_caches()


# ───────────────────────── the ledger ─────────────────────────

def test_the_gate_is_still_one_the_ledger_index_can_see():
    """The read goes through the Focus helper, which reads the name from a variable; the
    index finds a gate by a literal. The one-row table in `rs_post_pass` is that literal:
    without it the ledger row would describe a gate the index says does not exist."""
    gates = ffi.gates(ffi.repo_roots(ROOT), ROOT)
    assert pp.FLAG in gates
    assert "api/services/screener/rs_post_pass.py" in gates[pp.FLAG]["sites"]
    assert ffi.needs_declaration(pp.FLAG, gates[pp.FLAG]["default"]), "it ships off"


def test_the_ledger_row_states_the_three_values_and_the_rollback():
    row = json.loads((ROOT / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"][pp.FLAG]
    note = row["note"]
    # 2026-11-15: the owner set `admin` on web (armed for admins only), then released the
    # screens to every member the same day (the value 1). The row says who is served, and
    # how to take the screens back from members without turning the data off.
    assert row["status"] == "armed" and row["where"] == ["web"]
    assert note.startswith("ARMED FOR EVERYONE") and "released to all members" in note
    assert "ARMED FOR ADMINS ONLY" not in note
    assert "set admin" in note and "17:29:56Z" in note
    for words in ("THREE VALUES", "unset/0/false/no/off = off for everyone",
                  "1/true/yes/on = everyone", "admin = ", "_breadth_dc_scope",
                  "An unrecognised value takes the default (off)",
                  "rs_post_pass.enabled", "rs_post_pass.surfaces_on", "PER CALL", "Rollback:"):
        assert words in note, words
    assert "only the literal 1 arms it" not in note, "the old grammar is no longer true"
    assert "—" not in note


# ── surfaces added by later units follow the same reader (integration, 2026-11-14) ──────────

def test_the_one_row_route_exists_only_for_a_user_the_screens_are_shown_to(monkeypatch):
    """`GET /api/screener/row/{ticker}` (unit U8, "Why isn't a stock here?") is part of the
    RS screens: under `admin` it answers a member 404, exactly as with the flag off."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    monkeypatch.setattr(screener_mod.scr_query, "rows_for",
                        lambda tickers, columns, user=None:
                        {t: {"row": {"ticker": t}, "stale": False} for t in tickers})
    who = {}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(who["user"])
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who["user"])
    client = TestClient(app)

    def status(value, user):
        _set(monkeypatch, value)
        who["user"] = user
        return client.get("/api/screener/row/AAPL?columns=ticker").status_code

    assert status(None, ADMIN) == 404 and status(None, MEMBER) == 404
    assert status("admin", MEMBER) == 404
    assert status("admin", ADMIN) == 200
    assert status("1", MEMBER) == 200


def test_the_market_line_rides_the_saved_screens_payload_only_for_a_served_user(served):
    import json
    route = "/api/screener/saved-screens"
    assert "rs_market" not in json.loads(served(None, MEMBER)[route])
    assert "rs_market" not in json.loads(served("admin", MEMBER)[route])
    assert "rs_market" in json.loads(served("admin", ADMIN)[route])
    assert "rs_market" in json.loads(served("1", MEMBER)[route])


def test_the_batch_rows_route_exists_only_for_a_user_the_screens_are_shown_to(monkeypatch):
    """`GET /api/screener/rows` (unit U12, the dropped names' reasons) follows the one-row
    route: under `admin` a member gets 404 and the table is never read for them."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    read = []
    monkeypatch.setattr(screener_mod.scr_query, "rows_for",
                        lambda tickers, columns, user=None:
                        read.append(list(tickers)) or
                        {t: {"row": {"ticker": t}, "stale": False} for t in tickers})
    who = {}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(who["user"])
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who["user"])
    client = TestClient(app)

    def status(value, user):
        _set(monkeypatch, value)
        who["user"] = user
        return client.get("/api/screener/rows?tickers=AAPL,MSFT&columns=ticker").status_code

    assert status(None, ADMIN) == 404 and status(None, MEMBER) == 404
    assert status("admin", MEMBER) == 404
    assert read == [], "a route that does not exist for this user read the table"
    assert status("admin", ADMIN) == 200
    assert status("1", MEMBER) == 200
    assert len(read) == 2
