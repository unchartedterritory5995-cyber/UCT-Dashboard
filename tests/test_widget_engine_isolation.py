"""Task 8.5 isolation rail: a widget run reads the session member's rows and nothing else.

Two members share symbols, setups, days and tags. Member B's numbers are distinctive (7,777 and
up) so any leak shows in A's totals. For every source and each of a split, a filter, and
`accounts={"id": <B's account>}`: A's result holds no row, count or label of B's, and B's account
id gives exactly A's "all my accounts" result (absent, never B's).
"""
from __future__ import annotations

import re

import pytest

from tests.test_widget_sources import (
    add_account, add_checkin, add_note, add_position, add_strategy, add_trade, add_user,
    raw_plan, run,
)
from api.services import auth_db

A, B = "u-iso-A", "u-iso-B"
DAYS = ("2026-10-19", "2026-10-20", "2026-10-21")
RANGE = {"from": "2026-10-19", "to": "2026-10-23"}


@pytest.fixture
def two(monkeypatch, tmp_path):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "iso.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    add_user(c, A)
    add_user(c, B)
    acc_a = add_account(c, A, "Main", size=10_000)
    acc_b = add_account(c, B, "Main", size=10_000)           # same name, B's own id
    a_tids = []
    for i, d in enumerate(DAYS):
        a_tids.append(add_trade(c, A, day=d, pnl=100.0 + i, setup="Shared", symbol="NVDA",
                                mistakes=["chased"], account=acc_a, r=None, stop=100.0))
        add_trade(c, B, day=d, pnl=7777.0 + i, setup="Shared", symbol="NVDA",
                  mistakes=["chased"], account=acc_b)
        add_trade(c, B, day=d, pnl=8888.0, setup="B only", symbol="BONLY", account=acc_b)
    # A child row of B's keyed on A's trade ref must never reach A.
    c.execute("INSERT INTO j2_trade_excursions (user_id, trade_ref, symbol, true_r, computed_at)"
              " VALUES (?, ?, 'NVDA', 99.0, 'x')", (B, f"id:{a_tids[0]}"))
    c.execute("INSERT INTO j2_trade_adherence (user_id, trade_ref, setup, checked_rule_ids,"
              " total_rules, adherence_pct, updated_at) VALUES (?, ?, 'Shared', '[]', 2, 0.9, 'x')",
              (B, f"id:{a_tids[0]}"))
    c.execute("INSERT INTO j2_trade_plan_links (user_id, trade_ref, symbol, source_kind,"
              " match_tier, plan_json, matched_at) VALUES (?, ?, 'NVDA', 'note', 'exact', '{}', 'x')",
              (B, f"id:{a_tids[0]}"))
    c.commit()
    add_position(c, A, symbol="NVDA", setup="Shared", mark=110.0, account=acc_a)
    add_position(c, B, symbol="NVDA", setup="Shared", mark=9000.0, account=acc_b)
    add_position(c, B, symbol="BONLY", setup="B only", mark=9000.0, account=acc_b)
    add_strategy(c, B, day=DAYS[0], pnl=7000.0, account=acc_b)
    add_strategy(c, B, day="2026-10-22", pnl=7000.0, account=acc_b)
    n_a = add_note(c, A, updated_at="2026-10-19T10:00:00Z")
    n_b = add_note(c, B, updated_at="2026-10-19T11:00:00Z")
    add_checkin(c, A, n_a, day=DAYS[0], mood=2, focus=2)
    add_checkin(c, B, n_b, day=DAYS[0], mood=5, focus=5)
    add_checkin(c, B, n_b, day="2026-10-22", mood=5, focus=5)
    c.execute("INSERT INTO j2_day_notes (id, user_id, date, created_at, updated_at)"
              " VALUES ('dn-b', ?, '2026-10-23', 'x', 'x')", (B,))
    c.commit()
    try:
        yield c, acc_a, acc_b
    finally:
        c.close()


def digest(res):
    return ([(g.key, g.label, g.key2, g.label2, g.flagged, g.values.n,
              tuple((x.value, x.n, x.have) for x in g.values.cells)) for g in res.groups],
            tuple((x.value, x.n, x.have) for x in res.total.cells), res.count, res.footnotes,
            [(cv.have, cv.total, cv.hint) for cv in res.coverage])


CASES = {
    "closed_trades": dict(
        measures=("net_pnl", "trades", "total_r"),
        split={"by": "setup"},
        filter=[{"field": "mistake", "op": "has_any", "values": ["chased"]}],
        a_total=303.0, a_labels={"Shared"}),
    "open_positions": dict(
        measures=("open_positions", "unrealised_pnl"),
        split={"by": "symbol"},
        filter=[{"field": "setup", "op": "in", "values": ["Shared"]}],
        a_total=1.0, a_labels={"NVDA"}),
    "trading_days": dict(
        measures=("avg_day_pnl", "green_day_pct"),
        split={"by": "weekday"},
        filter=[{"field": "trade_count", "op": "gte", "values": [1]}],
        # quiet sessions are rows too; B's Thursday option close must not make one active
        a_total=101.0, a_labels={"Monday", "Tuesday", "Wednesday", "Thursday", "Friday"}),
}


@pytest.mark.parametrize("source", sorted(CASES))
@pytest.mark.parametrize("mode", ["split", "filter", "accounts"])
def test_member_a_never_sees_member_b(two, source, mode):
    c, acc_a, acc_b = two
    case = CASES[source]
    base = dict(source=source, measures=case["measures"], range=RANGE)
    if mode == "split":
        base["split"] = case["split"]
    elif mode == "filter":
        base["filters"] = case["filter"]
    sc_all, res_all = run(c, raw_plan(**base), uid=A)

    # Nothing of B's in A's rows, labels or totals.
    assert all(r.get("symbol") != "BONLY" for r in sc_all.rows)
    assert all((g.label or "") != "B only" for g in res_all.groups)
    assert res_all.total.cells[0].value == pytest.approx(case["a_total"])
    if mode == "split":
        assert {g.label for g in res_all.groups} == case["a_labels"]
        if source == "trading_days":
            thu = next(g for g in res_all.groups if g.label == "Thursday")
            assert thu.values.cells[0].value is None and thu.values.cells[0].n == 0
    for r in sc_all.rows:
        for k in ("net", "day_net", "unrealised", "best_trade"):
            v = r.get(k)
            assert v is None or abs(v) < 7000, (k, v)
    if source == "closed_trades":
        first = next(r for r in sc_all.rows if r["day"] == DAYS[0])
        assert first["r"] is None and first["plan_linked"] is False, "B's child rows reached A"
        assert first["adherence_pct"] is None, "B's adherence row reached A"
    if source == "trading_days":
        by_day = {r["day"]: r for r in sc_all.rows}
        assert by_day[DAYS[0]]["mood"] == 2.0 and by_day["2026-10-22"]["mood"] is None
        assert by_day["2026-10-22"]["trade_count"] == 0
        assert by_day["2026-10-23"]["had_day_note"] is False

    # B's account id reads as absent: exactly A's "all my accounts" result.
    raw_b = raw_plan(**base, accounts={"id": acc_b})
    sc_b, res_b = run(c, raw_b, uid=A)
    assert digest(res_b) == digest(res_all)
    assert sc_b.account_id is None and len(sc_b.rows) == len(sc_all.rows)
    # And through the viewer setting too.
    sc_s, res_s = run(c, raw_plan(**base), uid=A, settings={"accountId": acc_b})
    assert digest(res_s) == digest(res_all) and sc_s.account_id is None
    # A's own account narrows (here: to the same rows, every A row is in it).
    sc_a, res_a = run(c, raw_plan(**base, accounts={"id": acc_a}), uid=A)
    assert sc_a.account_id == acc_a and digest(res_a) == digest(res_all)


def test_filtering_on_b_account_id_gives_a_nothing(two):
    c, _acc_a, acc_b = two
    sc, res = run(c, raw_plan(measures=("trades",), range=RANGE, filters=[
        {"field": "account", "op": "in", "values": [acc_b]}]), uid=A)
    assert sc.rows == [] and res.total.cells[0].value == 0


def test_b_sees_only_b(two):
    c, _acc_a, _acc_b = two
    _sc, res = run(c, raw_plan(measures=("net_pnl",), range=RANGE, split={"by": "setup"}), uid=B)
    assert {g.label for g in res.groups} == {"Shared", "B only"}
    assert res.total.cells[0].value == pytest.approx(7777 * 3 + 3 + 8888 * 3)


@pytest.mark.parametrize("source", ["closed_trades", "open_positions"])
def test_split_by_account_shows_only_a_accounts(two, source):
    c, acc_a, acc_b = two
    measures = {"closed_trades": ("trades",), "open_positions": ("open_positions",)}[source]
    _sc, res = run(c, raw_plan(source=source, measures=measures, range=RANGE,
                               split={"by": "account"}), uid=A)
    assert [(g.key, g.label) for g in res.groups] == [(acc_a, "Main")]
    assert all(g.key != acc_b for g in res.groups)


def test_own_account_narrows_for_real(two):
    """Non-vacuous: A has a second account with different rows, so narrowing must change the
    answer, and B's account id must still read as all of A's accounts."""
    c, acc_a, acc_b = two
    acc_a2 = add_account(c, A, "Second", size=5_000)
    add_trade(c, A, day=DAYS[0], pnl=40.0, setup="Shared", account=acc_a2)
    add_position(c, A, symbol="SEC", setup="Shared", mark=101.0, account=acc_a2)
    base = dict(measures=("net_pnl", "trades"), range=RANGE)
    _sc, all_res = run(c, raw_plan(**base), uid=A)
    _sc, a1 = run(c, raw_plan(**base, accounts={"id": acc_a}), uid=A)
    _sc, a2 = run(c, raw_plan(**base, accounts={"id": acc_a2}), uid=A)
    _sc, ab = run(c, raw_plan(**base, accounts={"id": acc_b}), uid=A)
    assert all_res.total.cells[0].value == pytest.approx(343.0)
    assert a1.total.cells[0].value == pytest.approx(303.0)
    assert a2.total.cells[0].value == pytest.approx(40.0) and a2.total.cells[1].value == 1
    assert digest(ab) == digest(all_res)
    _sc, p2 = run(c, raw_plan(source="open_positions", measures=("open_positions",),
                              range=RANGE, accounts={"id": acc_a2}), uid=A)
    assert p2.total.cells[0].value == 1
    _sc, d2 = run(c, raw_plan(source="trading_days", measures=("avg_day_pnl",), range=RANGE,
                              accounts={"id": acc_a2}), uid=A)
    assert d2.total.cells[0].value == pytest.approx(40.0)


# ── Task 8.12: public pages ──

@pytest.mark.parametrize("mode", ["share", "publish", "gallery", "example"])
def test_another_members_def_id_is_neutral_in_every_public_mode_and_reads_no_database(monkeypatch, tmp_path, mode):
    """A note body naming member B's `defId` (with or without `share: true`) reduces to the neutral line or is
    dropped, never to B's widget, and a public reduction opens no database connection at all. B's widget row
    EXISTS in the database first, so "no read" is shown against data that was there to be read; and the spy is
    proved live by calling the patched seams once (a spy nobody has seen fire is not a rail)."""
    import copy
    import json
    import sqlite3
    from api.services.journal_two import public_note_payload as pnp

    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "iso812.db"))
    auth_db.init_db()
    foreign = "B-DEF-ID-FOREIGN-7777"
    c = auth_db.get_connection()
    add_user(c, B)
    c.execute("INSERT INTO j2_widget_definitions (id, user_id, name, plan_json, plan_version, rev, placed_rev,"
              " created_at, updated_at) VALUES (?, ?, 'B-WIDGET-NAME-7777', '{}', 1, 1, 1, 'x', 'x')",
              (foreign, B))
    c.commit()
    assert c.execute("SELECT COUNT(*) FROM j2_widget_definitions WHERE id = ?", (foreign,)).fetchone()[0] == 1

    seen: list[str] = []
    real_get, real_connect = auth_db.get_connection, sqlite3.connect

    def spy_get(*a, **k):
        seen.append("auth_db.get_connection")
        return real_get(*a, **k)

    def spy_connect(*a, **k):
        seen.append("sqlite3.connect")
        return real_connect(*a, **k)

    monkeypatch.setattr(auth_db, "get_connection", spy_get)
    monkeypatch.setattr(sqlite3, "connect", spy_connect)
    # `journal_two.db` has no connection helper of its own (it opens through auth_db.get_connection), so the
    # two seams above cover it.

    for share in (None, False, "true", True):
        params = {"asOf": "2026-10-20T14:00:00Z", "title": "B only", "defId": foreign, "defRef": foreign,
                  "summary": "B-SUMMARY-7777", "scopeLabel": "B-SCOPE-7777", "accountId": "B-ACC-7777",
                  "def": {"plan_version": 1, "note": foreign}, "footnotes": ["B-FOOT-7777"],
                  "sourceDetail": "B-DETAIL-7777", "value": {"v1": 7777.0, "n": 3}}
        if share is not None:
            params["share"] = share
        body = {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {
            "v": 1, "widgetId": "builtWidget", "mode": "snapshot", "params": params}}]}
        out = pnp.reduce(copy.deepcopy(body), mode=mode, owner_id="A", note_id="N", attachment_base="/b/",
                         facts={}, note_links=None)
        blob = json.dumps(out)
        for leak in (foreign, "B-SUMMARY-7777", "B-SCOPE-7777", "B-ACC-7777", "B-FOOT-7777", "B-DETAIL-7777",
                     "B-WIDGET-NAME-7777"):
            assert leak not in blob, (mode, share, leak)
        if share is not True:
            assert "widgetEmbed" not in blob, (mode, share)
            if mode != "example":
                assert pnp.ACCOUNT_NEUTRAL_LINE in blob, (mode, share)
    assert seen == [], seen                                  # no read, with B's row there to be read

    # positive control: the spy fires on both seams, so the empty list above means something
    auth_db.get_connection().execute("SELECT 1").fetchone()
    sqlite3.connect(":memory:").close()
    assert "auth_db.get_connection" in seen and "sqlite3.connect" in seen, seen


# ── Task 9.11: routine and tracker blocks on public pages ──

@pytest.mark.parametrize("mode", ["share", "publish", "gallery", "example"])
def test_another_members_routine_and_tracker_ids_are_the_account_line_and_read_no_database(monkeypatch, tmp_path, mode):
    """A hand-made body naming member B's routine and tracker ids reduces to the account line (dropped in an
    example note) and a public reduction opens no database connection. B's rows exist first; the spy is proved
    live by firing both seams once."""
    import copy
    import json
    import sqlite3
    from api.services.journal_two import public_note_payload as pnp

    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "iso911.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    add_user(c, B)
    c.commit()

    seen: list[str] = []
    real_get, real_connect = auth_db.get_connection, sqlite3.connect

    def spy_get(*a, **k):
        seen.append("auth_db.get_connection")
        return real_get(*a, **k)

    def spy_connect(*a, **k):
        seen.append("sqlite3.connect")
        return real_connect(*a, **k)

    monkeypatch.setattr(auth_db, "get_connection", spy_get)
    monkeypatch.setattr(sqlite3, "connect", spy_connect)

    for widget_id, foreign in (("routine", "B-ROUTINE-ID-9911"), ("tracker", "B-TRACKER-ID-9911")):
        for share in (None, False, "true", True):
            params = {"routineId": foreign, "trackerId": foreign, "day": "2026-10-20",
                      "name": "B-ROUTINE-NAME-9911", "days": {"2026-10-20": "B-DAYSTATE-9911"}}
            if share is not None:
                params["share"] = share
            body = {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {
                "v": 1, "widgetId": widget_id, "mode": "snapshot", "params": params,
                "searchText": "B-ROUTINE-NAME-9911", "caption": "B-ATTR-9911"}}]}
            out = pnp.reduce(copy.deepcopy(body), mode=mode, owner_id="A", note_id="N",
                             attachment_base="/b/", facts={}, note_links=None)
            blob = json.dumps(out)
            for leak in (foreign, "B-ROUTINE-NAME-9911", "B-DAYSTATE-9911", "B-ATTR-9911"):
                assert leak not in blob, (mode, widget_id, share, leak)
            assert "widgetEmbed" not in blob, (mode, widget_id, share)
            if mode != "example":
                assert pnp.ACCOUNT_NEUTRAL_LINE in blob, (mode, widget_id, share)
    assert seen == [], seen

    auth_db.get_connection().execute("SELECT 1").fetchone()
    sqlite3.connect(":memory:").close()
    assert "auth_db.get_connection" in seen and "sqlite3.connect" in seen, seen


# -- wave 9 (Task 9.8): routine and tracker history, and the trading-days fields that name one ---

def _tools_two(monkeypatch, tmp_path):
    """A and B each with a routine and a tracker, B's ticked and logged on the same days with
    distinctive names and values; B also has check-ins."""
    from datetime import datetime, timezone
    from api.services.journal_two import routines, trackers
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "iso-tools.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    add_user(c, A)
    add_user(c, B)

    def at(d):
        y, m, dd = (int(x) for x in d.split("-"))
        return datetime(y, m, dd, 17, tzinfo=timezone.utc)

    out = {}
    for uid, name, val in ((A, "Mine", 5.0), (B, "B ONLY routine", 7777.0)):
        r = routines.create(uid, name=name, items=[name + " item"], schedule={"kind": "every"},
                            now=at(DAYS[0]))
        t = trackers.create(uid, name=name.replace("routine", "tracker"), kind="number",
                            now=at(DAYS[0]))
        for d in DAYS:
            routines.set_tick(uid, r["id"], d, r["items"][0]["id"], True, now=at(d))
            trackers.set_value(uid, t["id"], d, val, now=at(d))
            add_trade(c, uid, day=d, pnl=100.0 if uid == A else 7777.0)
        out[uid] = (r["id"], t["id"])
    n_b = add_note(c, B, updated_at="2026-10-19T11:00:00Z")
    add_checkin(c, B, n_b, day=DAYS[0], mood=5, focus=5)
    return c, out


@pytest.mark.parametrize("source,measures,split", [
    ("routine_history", ("routine_days_done", "routine_consistency"), "routine"),
    ("routine_history", ("routine_days_done",), "item"),
    ("tracker_history", ("tracker_entries", "tracker_max"), "tracker"),
])
def test_tool_sources_read_only_the_members_rows(monkeypatch, tmp_path, source, measures, split):
    c, ids = _tools_two(monkeypatch, tmp_path)
    try:
        for mode in ("plain", "split", "list"):
            kw = dict(source=source, measures=measures, range=RANGE)
            if mode == "split":
                kw["split"] = {"by": split}
            if mode == "list":
                kw["view"] = {"type": "list"}
            sc, res = run(c, raw_plan(**kw), uid=A)
            assert sc.rows, "control: A has rows of its own"
            for r in sc.rows:
                assert r.get("routine") in (None, ids[A][0]) and "B ONLY" not in str(r)
                assert r.get("tracker") in (None, ids[A][1], "checkin:mood", "checkin:focus")
                assert r.get("value") is None or r["value"] < 7000
            assert all("B ONLY" not in (g.label or "") + (g.label2 or "") for g in res.groups)
            if source == "tracker_history":
                assert not any(r["tracker"].startswith("checkin:") for r in sc.rows)  # B's only
                assert res.total.cells[0].value == 3.0 and res.total.cells[1].value == 5.0
            else:
                assert res.total.cells[0].value == 3.0                 # A's three days, not six
        # B, through the same code, sees B's own
        sc_b, _ = run(c, raw_plan(source=source, measures=measures, range=RANGE), uid=B)
        assert sc_b.rows and all("Mine" not in str(r) for r in sc_b.rows)
    finally:
        c.close()


def test_ref_fields_never_read_another_members_routine_or_tracker(monkeypatch, tmp_path):
    c, ids = _tools_two(monkeypatch, tmp_path)
    try:
        rid_b, tid_b = ids[B]
        rid_a, tid_a = ids[A]
        for kind, by, ref in (("routine", "routine_done", rid_b),
                              ("tracker", "tracker_bucket", tid_b)):
            sc, res = run(c, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                      split={"by": by, "ref": ref}, range=RANGE), uid=A)
            assert all(r[by] is None for r in sc.rows), kind
            assert res.groups == [], kind
            # control: A's own ref fills the column on the same rows
            own = rid_a if kind == "routine" else tid_a
            sc2, res2 = run(c, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                        split={"by": by, "ref": own}, range=RANGE), uid=A)
            filled = {r["day"] for r in sc2.rows if r[by] not in (None, "not_done")}
            assert filled == set(DAYS), kind                       # A's ticked / logged days
            assert [g.values.cells[0].value for g in res2.groups
                    if g.label != "Not done"] == [pytest.approx(100.0)], kind
        sc, res = run(c, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                  filters=[{"field": "tracker_value", "op": "gte", "values": [0],
                                            "ref": tid_b}], range=RANGE), uid=A)
        assert res.count == 0 and all(r["tracker_value"] is None for r in sc.rows)
        # A's mood ref reads A's check-ins only: A has none, B's mood 5 never shows
        sc, res = run(c, raw_plan(source="trading_days", measures=("avg_day_pnl",),
                                  split={"by": "tracker_bucket", "ref": "checkin:mood"},
                                  range=RANGE), uid=A)
        assert res.groups == []
    finally:
        c.close()


def test_the_routine_lookup_itself_is_scoped_to_the_member(monkeypatch, tmp_path):
    """The routine read behind both tool paths answers only the member's own routines. (The child
    tables are scoped too, so a leak here alone would still show no B day; this rail proves the
    first layer by itself.)"""
    from api.services.journal_two.widget_engine import sources
    c, ids = _tools_two(monkeypatch, tmp_path)
    try:
        plain = {"filters": []}
        assert sources._scan_routine_ids(c, A, plain) == ([ids[A][0]], 1)
        # naming B's routine in a filter never reaches it
        only_b = {"filters": [{"field": "routine", "op": "in", "values": [ids[B][0]]}]}
        assert sources._scan_routine_ids(c, A, only_b) == ([], 0)
        assert sources._scan_routine_ids(c, B, only_b) == ([ids[B][0]], 1)
    finally:
        c.close()


# -- wave 10 (Task 10.5): formulas and goals ----------------------------------------------------

def _w10_run(monkeypatch, uid, raw, settings=None):
    from datetime import datetime, timezone

    from api.services.journal_two import notebook_widgets as nw
    from api.services.journal_two.widget_engine import run as wrun
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "iso-w10",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    return wrun.run_plan(uid, raw, settings or {}, lane="run",
                         now=datetime(2026, 10, 23, 20, 0, tzinfo=timezone.utc))


def test_two_members_with_one_formula_plan_hash_never_share_a_cache_entry(two, monkeypatch):
    from api.services.journal_two.widget_engine import run as wrun
    wrun._reset_state()
    raw = {"v": 1, "source": "closed_trades", "range": RANGE,
           "formulas": [{"id": "f1", "name": "Double", "expr": "[net] * 2", "format": "money"}],
           "measures": [{"formula": "f1", "agg": "sum"}]}
    a = _w10_run(monkeypatch, A, raw)
    b = _w10_run(monkeypatch, B, raw)
    assert a["value"]["v1"] == 2 * (100 + 101 + 102)
    assert b["value"]["v1"] == 2 * (7777 + 7778 + 7779 + 3 * 8888)
    assert _w10_run(monkeypatch, A, raw)["value"]["v1"] == a["value"]["v1"]
    wrun._reset_state()


def test_member_b_goal_is_never_read_for_a(two, monkeypatch):
    import json

    from api.services.journal_two.widget_engine import run as wrun
    from api.services.journal_two.widget_engine import sources as wsources
    c, acc_a, acc_b = two
    wrun._reset_state()
    c.execute("UPDATE j2_accounts SET goals = ? WHERE id = ?", (json.dumps({"weekly": 9999}), acc_b))
    c.commit()
    assert wrun._goal_target(c, A, None, "weekly") == (None, 1)
    assert wrun._goal_target(c, A, acc_b, "weekly") == (None, 1)       # B's id reads A's own
    monkeypatch.setattr(wsources.CATALOG, "view_allowed", lambda plan: None)
    raw = {"v": 1, "source": "closed_trades", "range": {"token": "this_week"},
           "measures": [{"key": "net_pnl"}], "view": {"type": "progress"},
           "display": {"targetGoal": True}}
    for settings in ({}, {"accountId": acc_b}):
        out = _w10_run(monkeypatch, A, raw, settings)
        assert out["target"] is None and "9999" not in json.dumps(out)
    assert _w10_run(monkeypatch, B, raw)["target"] == 9999.0
    wrun._reset_state()


# -- wave 10 (Task 10.6): options strategies and their legs --------------------------------------

def test_member_b_strategies_and_legs_never_reach_a(two):
    """A's options rows, counts and `dte_entry` hold nothing of B's: B's strategies (7,000 each,
    on A's days and A's underlying), B's legs, and B's account id. The legs table has no
    `user_id`, so the leg read must name only A's own scanned strategy ids (traced below)."""
    import uuid

    from tests.test_widget_options_source import add_opt
    c, acc_a, acc_b = two
    a1 = add_opt(c, A, entry="2026-10-19T14:00:00Z", closed_at="2026-10-20T19:00:00Z",
                 pnl=50.0, account=acc_a, legs=("2026-11-20",))
    a_open = add_opt(c, A, status="open", entry="2026-10-21T14:00:00Z", account=acc_a,
                     legs=("2026-12-18",))
    b1 = add_opt(c, B, entry="2026-10-19T14:00:00Z", closed_at="2026-10-21T19:00:00Z",
                 pnl=9000.0, account=acc_b, legs=("2026-10-24",))
    b_ids = {b1} | {r[0] for r in c.execute("SELECT id FROM j2_option_strategies WHERE user_id = ?",
                                            (B,)).fetchall()}
    # a leg of B's strategy with the earliest expiration of all, inserted by hand
    c.execute("INSERT INTO j2_option_legs (id, strategy_id, leg_index, side, contract_type, strike,"
              " expiration, qty, entry_price) VALUES (?, ?, 9, 'buy', 'put', 1, '2026-10-19', 1, 1)",
              (str(uuid.uuid4()), b1))
    c.commit()
    seen: list[str] = []
    c.set_trace_callback(seen.append)
    try:
        for mode in ("plain", "split", "filter", "accounts_b", "setting_b"):
            raw = raw_plan(source="options_strategies", measures=("strategies", "net_pnl"),
                           range=RANGE)
            settings = None
            if mode == "split":
                raw.update(split={"by": "underlying"}, view={"type": "bar"})
            elif mode == "filter":
                raw["filters"] = [{"field": "underlying", "op": "in", "values": ["SPY"]}]
            elif mode == "accounts_b":
                raw["accounts"] = {"id": acc_b}
            elif mode == "setting_b":
                settings = {"accountId": acc_b}
            sc, res = run(c, raw, uid=A, settings=settings)
            assert {r["_tid"] for r in sc.rows} == {a1, a_open}, mode
            assert res.count == 2 and res.total.cells[0].value == 2.0, mode
            assert res.total.cells[1].value == 50.0, mode           # never B's 7,000 or 9,000
            assert {r["_tid"]: r["dte_entry"] for r in sc.rows} == {a1: 32.0, a_open: 58.0}, mode
            assert sc.account_id is None or sc.account_id == acc_a, mode
            if mode == "split":
                assert [(g.label, g.values.cells[0].value) for g in res.groups] == [("SPY", 2.0)]
    finally:
        c.set_trace_callback(None)
    legs = [s for s in seen if "j2_option_legs" in s]
    assert legs, "control: the trace saw the leg reads"
    for s in legs:
        assert a1 in s and a_open in s, s[:200]
        assert not any(b in s for b in b_ids), "a leg read named one of B's strategy ids"
    # control: B's own read does see B's leg (the expiration above is real data, not a typo)
    sc_b, _res = run(c, raw_plan(source="options_strategies", measures=("strategies",),
                                 range=RANGE), uid=B)
    assert {r["_tid"]: r["dte_entry"] for r in sc_b.rows}[b1] == 0.0


def test_a_leg_naming_a_strategy_is_that_strategys_leg(two):
    """The legs table has no owner column: a leg row naming A's strategy id IS a leg of A's
    strategy (the options service only ever writes a leg after checking the strategy's owner).
    So it is read for A, and only because A's own scan returned that id; the same row naming an
    id A's scan did not return (B's) is never read for A (the test above)."""
    import uuid

    from tests.test_widget_options_source import add_opt
    c, acc_a, _acc_b = two
    a1 = add_opt(c, A, entry="2026-10-19T14:00:00Z", closed_at="2026-10-20T19:00:00Z",
                 pnl=50.0, legs=("2026-11-20",))
    c.execute("INSERT INTO j2_option_legs (id, strategy_id, leg_index, side, contract_type, strike,"
              " expiration, qty, entry_price) VALUES (?, ?, 5, 'buy', 'put', 1, '2026-10-30', 1, 1)",
              (str(uuid.uuid4()), a1))
    c.commit()
    sc, _res = run(c, raw_plan(source="options_strategies", measures=("strategies",),
                               range=RANGE), uid=A)
    assert [(r["_tid"], r["dte_entry"]) for r in sc.rows] == [(a1, 11.0)]
    sc_b, res_b = run(c, raw_plan(source="options_strategies", measures=("strategies",),
                                  range=RANGE), uid=B)
    assert a1 not in {r["_tid"] for r in sc_b.rows}


# -- wave 10 (Task 10.7): notes, their folders, kinds and property definitions ---------------------

def test_member_b_notes_folders_kinds_and_properties_never_reach_a(two):
    """A's notes widget holds nothing of B's: B's notes (same days, folder name, kind name, tags
    and ticker), B's folder and kind NAMES (even on an A note that names B's ids, inserted by hand),
    and B's property definitions (a filter or a sum naming B's property id is the one unavailable
    notice, and never narrows). Every folder, kind and property read is scoped to A (traced)."""
    from api.services.journal_two import note_properties
    from tests.test_widget_notes_source import add_folder, add_kind, add_n, add_prop
    c, _acc_a, _acc_b = two
    fa = add_folder(c, A, "Ideas")
    fb = add_folder(c, B, "B-FOLDER-CANARY")
    ka = add_kind(c, A, "Setup")
    kb = add_kind(c, B, "B-KIND-CANARY")
    pa = add_prop(c, A, "Conviction")
    pb = add_prop(c, B, "Conviction")
    a_ids = {r[0] for r in c.execute("SELECT id FROM j2_notes WHERE user_id = ?", (A,))}
    assert len(a_ids) == 1                          # the fixture's check-in note (no folder, kind)
    a_ids |= {add_n(c, A, created=f"{d}T15:00:00Z", folder=fa, kind=ka, tags=["shared"],
                   ticker="NVDA", props={pa: 2, pb: 2}) for d in DAYS}
    a_ids.add(add_n(c, A, created=f"{DAYS[0]}T16:00:00Z", folder=fb, kind=kb))   # B's ids, by hand
    for d in DAYS:
        add_n(c, B, created=f"{d}T15:00:00Z", folder=fb, kind=kb, tags=["shared"], ticker="NVDA",
              props={pb: 7777}, title="B-TITLE-CANARY")
    seen: list[str] = []
    c.set_trace_callback(seen.append)
    try:
        for mode in ("plain", "folder", "kind", "tag", "ticker", "list", "prop_b", "sum_b"):
            raw = raw_plan(source="notes", measures=("notes",), range=RANGE)
            if mode in ("folder", "kind", "tag", "ticker"):
                raw.update(split={"by": mode}, view={"type": "bar"})
            elif mode == "list":
                raw["view"] = {"type": "list"}
            elif mode == "prop_b":
                raw["filters"] = [{"field": "property", "op": "gte", "values": [100], "prop": pb}]
            elif mode == "sum_b":
                raw["measures"] = [{"key": "notes"}, {"key": "property_sum", "prop": pb}]
            sc, res = run(c, raw, uid=A)
            assert {r["_tid"] for r in sc.rows} == a_ids, mode
            assert res.count == 5 and res.total.cells[0].value == 5.0, mode
            blob = repr([(g.key, g.label) for g in res.groups]) + repr(sc.rows)
            for canary in ("B-FOLDER-CANARY", "B-KIND-CANARY", "B-TITLE-CANARY", "7777"):
                assert canary not in blob, (mode, canary)
            if mode in ("prop_b", "sum_b"):
                assert sc.notices == ["That property isn't available; it is not used in this widget."]
            if mode == "sum_b":
                assert res.total.cells[1].value is None
            if mode == "folder":
                assert {g.label: g.values.cells[0].value for g in res.groups} == {
                    "Ideas": 3.0, "No folder": 2.0}
            if mode == "kind":
                assert {g.label: g.values.cells[0].value for g in res.groups} == {
                    "Setup": 3.0, "No kind": 2.0}
    finally:
        c.set_trace_callback(None)
    scoped = [s for s in seen if re.search(r"FROM (j2_note_folders|j2_note_kinds|j2_note_properties"
                                           r"|j2_notes)\b", s)]
    assert scoped, "control: the trace saw the reads"
    for s in scoped:
        assert f"'{A}'" in s and f"'{B}'" not in s, s[:240]
    # A's own property narrows (control: the scoping above is not "never filters")
    sc, res = run(c, raw_plan(source="notes", measures=("notes",), range=RANGE,
                              filters=[{"field": "property", "op": "gte", "values": [2],
                                        "prop": pa}]), uid=A)
    assert res.count == 3 and sc.notices == []
    # control: B's own read sees B's names and numbers
    sc_b, res_b = run(c, raw_plan(source="notes", measures=("notes",), range=RANGE,
                                  split={"by": "folder"}, view={"type": "bar"}), uid=B)
    assert {g.label: g.values.cells[0].value for g in res_b.groups} == {
        "B-FOLDER-CANARY": 3.0, "No folder": 1.0} and res_b.count == 4
    assert note_properties.get_property_def(A, pb, conn=c) is None
    # an A note naming B's kind id (by hand) reads as no kind; A's own kinds read for A
    assert kb not in {r.get("kind") for r in run(c, raw_plan(source="notes", measures=("notes",),
                                                             range=RANGE), uid=A)[0].rows}
