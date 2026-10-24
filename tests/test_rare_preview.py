"""The rare-pattern admin preview: chart rows, the approval store, the release rule and the admin routes.

What is railed here:
  * flag OFF: structures_for, shape_draw_rows and the universe-scan hook are byte-identical (the preview code is
    proved NOT CALLED, not merely silent) and every route answers 404;
  * flag ON: structures_for only APPENDS preview rows, each labelled with its buy point (+$0.10) and admin-only:
    ids in neither display set, member literals None, member_rows drops them even with the id forced into the
    member set and the tier forced trusted;
  * the approve / reject store: instances upsert per (pattern, ticker, base start), verdicts append, the LATEST
    verdict per instance counts;
  * the release rule (>= 12 approvals at >= 80%) is pinned, and meeting it releases nothing;
  * routes: anon 401, member 403, admin only; bad ids / verdicts refused; the scan pass records instances.
"""
from __future__ import annotations

import importlib
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from api.services import auto_structures as AS
from api.services.pattern_engine.detectors import registry
from tests import rare_fixtures as F

FLAG = "AUTO_STRUCTURES_RARE_PREVIEW_ENABLED"


# ============================================================ chart rows
def _structures(monkeypatch, bars, flag, shapes=False):
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: [dict(x) for x in bars])
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    monkeypatch.setattr(AS, "last_bar_complete", lambda t, now=None: True)
    monkeypatch.setattr(AS, "_ipo_first_t_shared", lambda t: None)
    for name, on in ((FLAG, flag), ("AUTO_STRUCTURES_SHAPES_ENABLED", shapes)):
        if on:
            monkeypatch.setenv(name, "1")
        else:
            monkeypatch.delenv(name, raising=False)
    AS._CACHE.clear()
    try:
        return AS.structures_for("SYN")
    finally:
        AS._CACHE.clear()


def _explode(*a, **k):
    raise AssertionError("the rare preview ran while its flag was off")


def test_flag_off_structures_are_byte_identical_and_the_preview_is_never_called(monkeypatch):
    b = F.cup_bars()
    want = json.dumps(_structures(monkeypatch, b, False), sort_keys=True)
    monkeypatch.setattr(AS, "rare_preview_rows", _explode)
    monkeypatch.setattr(AS, "rare_preview_drawings", _explode)
    got = json.dumps(_structures(monkeypatch, b, False), sort_keys=True)
    assert got == want
    assert all(r["pattern_id"] not in ("draw:cup-no-handle", "draw:htf") for r in json.loads(got))


def test_flag_off_shape_rows_are_unchanged(monkeypatch):
    # with the preview off, the shapes flag still draws its saucer / IPO rows exactly as before
    b = F.cup_bars()
    monkeypatch.delenv(FLAG, raising=False)
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    a = AS.shape_draw_rows("SYN", b)
    monkeypatch.setattr(AS, "RARE_SHAPE_OWNED", ("draw:saucer", "draw:ipo-base", "draw:double-bottom"))
    assert AS.shape_draw_rows("SYN", b) == a       # the skip list is not consulted while off


def test_the_shapes_flag_keeps_its_saucer_row_while_the_preview_is_off(monkeypatch):
    # a series whose saucer fires (tests/test_shape_draw.py's own fixture): with the preview off, the shapes
    # flag serves the saucer row; with it on, the preview serves it instead (one row, the preview's buy point)
    from tests.test_shape_draw import SAU_PTS, series
    b = series(SAU_PTS)
    off = _structures(monkeypatch, b, False, shapes=True)
    sau = [r for r in off if r["pattern_id"] == "draw:saucer"]
    assert len(sau) == 1 and "rare_preview" not in sau[0]["geometry"]["extras"]
    on = _structures(monkeypatch, b, True, shapes=True)
    sau_on = [r for r in on if r["pattern_id"] == "draw:saucer"]
    assert len(sau_on) == 1 and sau_on[0]["geometry"]["extras"]["rare_preview"] is True
    d = sau_on[0]["geometry"]["extras"]["draw_shape"]
    assert d["buy_point"] == round(sau[0]["geometry"]["extras"]["draw_shape"]["pivot"] + 0.10, 2)


@pytest.mark.parametrize("make, pid", [(F.cup_bars, "draw:cup-no-handle"), (F.htf_bars, "draw:htf")])
def test_flag_on_only_appends_admin_only_rows_labelled_with_the_buy_point(monkeypatch, make, pid):
    b = make()
    off = _structures(monkeypatch, b, False)
    on = _structures(monkeypatch, b, True)
    assert on[:len(off)] == off
    extra = on[len(off):]
    assert extra and {r["pattern_id"] for r in extra} <= set(AS.RARE_PREVIEW_IDS)
    row = next(r for r in extra if r["pattern_id"] == pid)
    d = row["geometry"]["extras"]["draw_shape"]
    assert row["levels"]["entry"] == d["buy_point"] == d["pivot"]
    assert d["label"] == "Buy point %.2f" % d["buy_point"]
    assert row["display_tier"] == "experimental"
    assert row["geometry"]["extras"]["rare_preview"] is True
    assert AS.member_rows(extra) == []


def test_the_preview_owns_the_saucer_and_ipo_rows_so_a_chart_never_carries_two(monkeypatch):
    b = F.cup_bars()
    rows = _structures(monkeypatch, b, True, shapes=True)
    ids = [r["pattern_id"] for r in rows]
    for pid in AS.RARE_PREVIEW_IDS:
        assert ids.count(pid) <= 1


def test_the_preview_ids_are_admin_only_by_construction(monkeypatch):
    for pid in AS.RARE_PREVIEW_IDS:
        assert pid not in registry.DISPLAY_MEMBER_SET and pid not in registry.DISPLAY_TEAM_SET
        assert AS._member_shape_round(pid) is None
        assert pid in AS.SHAPE_DRAW_IDS
    assert AS.MEMBER_CUP_NO_HANDLE_ROUND is None and AS.MEMBER_HTF_ROUND is None
    assert AS.MEMBER_SAUCER_ROUND is None and AS.MEMBER_IPO_BASE_ROUND is None
    # fail closed even if the id were forced into the member set and the tier forced trusted
    rows = AS.rare_preview_rows("SYN", F.cup_bars())
    assert rows
    monkeypatch.setattr(registry, "DISPLAY_MEMBER_SET", frozenset(registry.DISPLAY_MEMBER_SET) | set(AS.RARE_PREVIEW_IDS))
    forced = [{**r, "display_tier": "trusted"} for r in rows]
    assert AS.member_rows(forced) == []
    # control: the same forcing on a confirmed double-bottom-style literal would pass -- the literal is the gate
    monkeypatch.setattr(AS, "MEMBER_CUP_NO_HANDLE_ROUND", rows[0]["geometry"]["extras"]["draw_round"])
    monkeypatch.setattr(AS, "MEMBER_SHAPE_LABELS", (rows[0]["geometry"]["extras"]["draw_shape"]["label"],
                                                    rows[0]["geometry"]["extras"]["draw_shape"]["low_label"]))
    assert [r["pattern_id"] for r in AS.member_rows(forced)] == ["draw:cup-no-handle"]


def test_a_forming_last_bar_is_dropped_first(monkeypatch):
    b = F.cup_bars()
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: True)
    rows = AS.rare_preview_rows("SYN", b)
    assert all(r["end_t"] == b[-2]["t"] for r in rows)


# ============================================================ store + release rule
@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    import api.services.rare_preview as rp
    importlib.reload(rp)
    return rp


def _drawing(start=20240102, end=20240301, bp=100.4):
    return {"start_t": start, "end_t": end, "buy_point": bp, "buy_label": "Cup w/o handle · Buy point %.2f" % bp,
            "pivot": bp, "low": 80.0, "marks": [], "label": "Buy point %.2f" % bp}


def test_the_release_rule_is_pinned():
    import api.services.rare_preview as rp
    assert rp.RELEASE_MIN_APPROVALS == 12 and rp.RELEASE_MIN_APPROVE_RATE == 0.80
    assert rp.release_rule_met(12, 3)          # 12 of 15 = 80%
    assert not rp.release_rule_met(11, 0)      # too few approvals
    assert not rp.release_rule_met(12, 4)      # 75%
    assert rp.release_rule_met(40, 10)
    assert not rp.release_rule_met(0, 0)


def test_instances_upsert_and_the_latest_verdict_counts(store):
    rp = store
    iid = rp.record_instance("draw:cup-no-handle", "abc", _drawing(end=20240301), now=1)
    assert iid == "draw:cup-no-handle|ABC|20240102"
    assert rp.record_instance("draw:cup-no-handle", "ABC", _drawing(end=20240301), now=2) == iid
    rp.record_instance("draw:cup-no-handle", "ABC", _drawing(end=20240304, bp=101.0), now=3)
    rows = rp.list_instances()
    assert len(rows) == 1
    r = rows[0]
    assert (r["first_asof_t"], r["last_asof_t"], r["buy_point"], r["seen_count"]) == (20240301, 20240304, 101.0, 2)
    assert r["drawing"]["buy_point"] == 101.0 and r["verdict"] is None
    rp.add_verdict(iid, "reject", note="W", by_user="u", now=10)
    rp.add_verdict(iid, "approve", by_user="u", now=11)
    assert rp.list_instances()[0]["verdict"]["verdict"] == "approve"
    st = rp.release_status()["draw:cup-no-handle"]
    assert (st["approved"], st["rejected"], st["rule_met"], st["released"]) == (1, 0, False, False)
    with pytest.raises(ValueError):
        rp.add_verdict(iid, "maybe")
    with pytest.raises(KeyError):
        rp.add_verdict("draw:htf|ZZZ|20240102", "approve")


def test_meeting_the_rule_releases_nothing(store):
    rp = store
    for k in range(13):
        iid = rp.record_instance("draw:htf", "T%02d" % k, _drawing(start=20240102 + k))
        rp.add_verdict(iid, "approve")
    st = rp.release_status()["draw:htf"]
    assert st["rule_met"] is True and st["released"] is False
    assert AS.MEMBER_HTF_ROUND is None
    assert AS.member_rows(AS.rare_preview_rows("SYN", F.htf_bars())) == []


def test_the_scan_pass_records_instances_only_while_on(store, monkeypatch):
    rp = store
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    monkeypatch.setattr(AS, "_ipo_first_t_shared", lambda t: None)
    bars = {"AAA": F.cup_bars(), "BBB": F.bars_from([10.0] * 400), "CCC": F.htf_bars()}
    monkeypatch.delenv(FLAG, raising=False)
    assert rp.record_universe(list(bars), bars_fn=lambda s: bars[s])["ran"] is False
    assert rp.list_instances() == []
    monkeypatch.setenv(FLAG, "1")
    res = rp.record_universe(list(bars), bars_fn=lambda s: bars[s], sleep=lambda s: None)
    assert res["ran"] and res["scanned"] == 3 and res["found"] >= 2
    pats = {(r["ticker"], r["pattern_id"]) for r in rp.list_instances()}
    assert ("AAA", "draw:cup-no-handle") in pats and ("CCC", "draw:htf") in pats
    n = len(rp.list_instances())
    rp.record_universe(list(bars), bars_fn=lambda s: bars[s], sleep=lambda s: None)
    assert len(rp.list_instances()) == n            # the same as-of again adds nothing


def test_the_universe_scan_hook_is_a_no_op_while_off(monkeypatch):
    import logging
    import api.main as M
    import api.services.rare_preview as rp
    monkeypatch.delenv(FLAG, raising=False)
    monkeypatch.setattr(rp, "record_universe", _explode)
    M._record_rare_preview(["AAA"], logging.getLogger("t"))          # does not raise: never called
    called = []
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setattr(rp, "record_universe", lambda syms: called.append(list(syms)) or {})
    M._record_rare_preview(["AAA"], logging.getLogger("t"))
    assert called == [["AAA"]]


# ============================================================ routes
@pytest.fixture
def client(store):
    from api.main import app
    from api.services.auth_db import init_db as auth_init_db
    auth_init_db()
    return TestClient(app)


def _login(client, role):
    from api.services.auth_db import get_connection
    from api.services.auth_service import create_session, create_user
    user = create_user(f"rare_{uuid.uuid4()}@example.com", "password123")
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user["id"]))
        conn.execute("INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'active')",
                     (uuid.uuid4().hex, user["id"]))
        conn.commit()
    finally:
        conn.close()
    client.cookies.set("uct_session", create_session(user["id"]))


URL = "/api/patterns/admin/rare-preview"


def test_routes_are_admin_only_and_dark(client, store, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    assert client.get(f"{URL}/instances").status_code == 401
    _login(client, "member")
    assert client.get(f"{URL}/instances").status_code == 403
    assert client.post(f"{URL}/scan").status_code == 403
    _login(client, "admin")
    assert client.get(f"{URL}/instances").status_code == 200
    monkeypatch.delenv(FLAG, raising=False)
    assert client.get(f"{URL}/instances").status_code == 404
    assert client.post(f"{URL}/instances/draw:htf|ABC|20240102/verdict", json={"verdict": "approve"}).status_code == 404
    assert client.post(f"{URL}/scan").status_code == 404


def test_the_admin_flow_lists_and_stores_verdicts(client, store, monkeypatch):
    rp = store
    monkeypatch.setenv(FLAG, "1")
    _login(client, "admin")
    iid = rp.record_instance("draw:cup-no-handle", "ABC", _drawing())
    j = client.get(f"{URL}/instances").json()
    assert [i["instance_id"] for i in j["instances"]] == [iid]
    assert j["release"]["draw:cup-no-handle"]["rule"] == {"min_approvals": 12, "min_approve_rate": 0.8}
    assert [p["id"] for p in j["patterns"]] == list(AS.RARE_PREVIEW_IDS)
    r = client.post(f"{URL}/instances/{iid}/verdict", json={"verdict": "approve", "note": " clean U "})
    assert r.status_code == 200 and r.json()["release"]["draw:cup-no-handle"]["approved"] == 1
    v = rp.list_instances()[0]["verdict"]
    assert (v["verdict"], v["note"]) == ("approve", "clean U")
    assert client.post(f"{URL}/instances/{iid}/verdict", json={"verdict": "maybe"}).status_code == 422
    assert client.post(f"{URL}/instances/not-an-id/verdict", json={"verdict": "approve"}).status_code == 422
    assert client.post(f"{URL}/instances/draw:htf|ZZZ|20240102/verdict",
                       json={"verdict": "approve"}).status_code == 404
    assert client.get(f"{URL}/instances?pattern=draw:nope").status_code == 422
    assert client.get(f"{URL}/instances?pattern=draw:htf").json()["instances"] == []


def test_the_scan_route_starts_one_pass(client, store, monkeypatch):
    rp = store
    monkeypatch.setenv(FLAG, "1")
    _login(client, "admin")
    seen = []
    monkeypatch.setattr(rp, "start_background_pass", lambda syms: seen.append(len(syms)) or True)
    r = client.post(f"{URL}/scan")
    assert r.status_code == 200 and r.json()["started"] is True
    assert seen and seen[0] > 0
