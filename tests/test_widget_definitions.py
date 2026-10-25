"""Task 8.8 - the widget store: stored widgets, revisions, If-Match and the 30-day purge.

Real auth.db schema (db.ensure_schema through auth_db.init_db) in a tmp dir, a small
stub catalog (sources.CATALOG is Task 8.5's), and an injected `now`: nothing sleeps.
"""
from __future__ import annotations

import importlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import pytest


# -- a small stub catalog (same shape tests/test_widget_plan.py uses) ---------

@dataclass(frozen=True)
class _Field:
    label: str
    type: str | None = None
    ops: frozenset | None = None


@dataclass(frozen=True)
class _Source:
    label: str
    fields: dict


@dataclass(frozen=True)
class _Measure:
    label: str
    sources: frozenset
    unit: str = "dollars"


@dataclass
class _Catalog:
    sources: dict = field(default_factory=lambda: {
        "closed_trades": _Source("Closed trades", {
            "setup": _Field("Setup", "text"), "side": _Field("Side", "enum")}),
        "open_positions": _Source("Open positions", {"setup": _Field("Setup")}),
        "trading_days": _Source("Trading days", {"weekday": _Field("Weekday")}),
    })
    measures: dict = field(default_factory=lambda: {
        "net_pnl": _Measure("Net P&L", frozenset({"closed_trades", "trading_days"})),
        "win_rate": _Measure("Win rate", frozenset({"closed_trades"}), "percent"),
    })
    accents: tuple = ("gold", "green", "red")

    def view_allowed(self, plan):
        return None


CAT = _Catalog()
T0 = datetime(2026, 10, 24, 15, 0, 0, tzinfo=timezone.utc)
A, B = "u-widget-a", "u-widget-b"


def plan(measure="net_pnl", **over) -> dict:
    p = {"v": 1, "source": "closed_trades", "measures": [{"key": measure}]}
    p.update(over)
    return p


@pytest.fixture
def W(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import widget_definitions as wd
    yield wd
    importlib.reload(auth_db)


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def _rows(sql, args=()):
    c = _conn()
    try:
        return [tuple(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


def _mk(W, uid=A, name="Setups", p=None, now=T0):
    return W.create(uid, name, p or plan(), catalog=CAT, now=now)


# -- the tests ----------------------------------------------------------------

def test_create_get_update_owned_only(W):
    d = _mk(W)
    assert set(d) >= {"id", "name", "plan", "rev", "placedRev", "archived", "usedIn",
                      "lastAnswer", "summary"}
    assert d["rev"] == 1 and d["placedRev"] == 1 and d["usedIn"] == 0
    assert d["archived"] is False and d["lastAnswer"] is None and d["summary"]
    assert W.get(A, d["id"])["name"] == "Setups"

    # member B: absent, every door
    assert W.get(B, d["id"]) is None
    assert W.revs(B, d["id"]) is None
    assert W.resolve_for_run(B, d["id"], 1) == (None, None, None)
    with pytest.raises(W.NotFound):
        W.update(B, d["id"], if_match=1, name="mine now", apply="only", catalog=CAT, now=T0)
    with pytest.raises(W.NotFound):
        W.archive(B, d["id"], now=T0)
    with pytest.raises(W.NotFound):
        W.name_rev(B, d["id"], 1, "kept")
    with pytest.raises(W.NotFound):
        W.restore_rev(B, d["id"], 1, if_match=1, catalog=CAT, now=T0)
    # ...and A's row is untouched
    after = W.get(A, d["id"])
    assert after["name"] == "Setups" and after["archived"] is False
    assert W.list_defs(B, now=T0) == []


def test_if_match_conflict(W):
    d = _mk(W)
    W.update(A, d["id"], if_match=1, plan=plan("win_rate"), apply="update_all",
             catalog=CAT, now=T0 + timedelta(minutes=5))
    with pytest.raises(W.Conflict) as e:
        W.update(A, d["id"], if_match=1, plan=plan(), apply="update_all",
                 catalog=CAT, now=T0 + timedelta(minutes=10))
    assert e.value.sentence == "Changed in another tab. Reload to see the newer version."
    assert W.get(A, d["id"])["plan"]["measures"] == [{"key": "win_rate"}]


def test_update_all_sets_placed_rev_save_new_creates_copy(W):
    d = _mk(W)
    only = W.update(A, d["id"], if_match=1, plan=plan("win_rate"), apply="only",
                    catalog=CAT, now=T0 + timedelta(minutes=2))
    assert only["rev"] == 2 and only["placedRev"] == 1

    allx = W.update(A, d["id"], if_match=2, plan=plan(), apply="update_all",
                    catalog=CAT, now=T0 + timedelta(minutes=4))
    assert allx["rev"] == 3 and allx["placedRev"] == 3 and allx["lastAnswer"] == "update_all"

    copy = W.update(A, d["id"], if_match=3, plan=plan("win_rate"), name="Win rate copy",
                    apply="save_new", catalog=CAT, now=T0 + timedelta(minutes=6))
    assert copy["id"] != d["id"] and copy["rev"] == 1 and copy["name"] == "Win rate copy"
    assert copy["plan"]["measures"] == [{"key": "win_rate"}]
    orig = W.get(A, d["id"])
    assert orig["rev"] == 3 and orig["placedRev"] == 3 and orig["name"] == "Setups"
    assert orig["plan"]["measures"] == [{"key": "net_pnl"}]
    assert orig["lastAnswer"] == "save_new"
    assert len(W.list_defs(A, now=T0 + timedelta(minutes=6))) == 2


def test_coalesce_within_60s_and_new_rev_after(W):
    d = _mk(W)
    t1 = T0 + timedelta(minutes=2)
    r = W.update(A, d["id"], if_match=d["etag"], plan=plan("win_rate"), apply="update_all",
                 catalog=CAT, now=t1)                                    # rev 2, placed 2
    # an "update everywhere" save 59 s later rewrites revision 2 in place (etag still moves)
    a = W.update(A, d["id"], if_match=r["etag"], plan=plan(), apply="update_all",
                 catalog=CAT, now=t1 + timedelta(seconds=59))
    assert a["rev"] == 2 and a["placedRev"] == 2 and a["etag"] == r["etag"] + 1
    revs = W.revs(A, d["id"])
    assert [x["rev"] for x in revs] == [2, 1]
    assert revs[0]["plan"]["measures"] == [{"key": "net_pnl"}]
    # 61 s after THAT save: a new revision
    t2 = t1 + timedelta(seconds=59 + 61)
    b = W.update(A, d["id"], if_match=a["etag"], plan=plan("win_rate"), apply="update_all",
                 catalog=CAT, now=t2)
    assert b["rev"] == 3
    # an "only here" save never rewrites the PLACED revision (3): a new one instead...
    c = W.update(A, d["id"], if_match=b["etag"], plan=plan(), apply="only",
                 catalog=CAT, now=t2 + timedelta(seconds=5))
    assert c["rev"] == 4 and c["placedRev"] == 3
    assert W.resolve_for_run(A, d["id"], 3)[0]["measures"] == [{"key": "win_rate"}]
    # ...and the next "only" save within 60 s of revision 4 (not placed) coalesces into it
    e = W.update(A, d["id"], if_match=c["etag"], plan=plan("win_rate"), apply="only",
                 catalog=CAT, now=t2 + timedelta(seconds=30))
    assert e["rev"] == 4
    # a NAMED latest revision is never rewritten: the next save is a new one
    W.name_rev(A, d["id"], 4, "Before earnings")
    f = W.update(A, d["id"], if_match=e["etag"], plan=plan(), apply="only",
                 catalog=CAT, now=t2 + timedelta(seconds=40))
    assert f["rev"] == 5
    named = {x["rev"]: x["named"] for x in W.revs(A, d["id"])}
    assert named[4] == "Before earnings"


def test_two_tabs_inside_the_coalesce_window_second_gets_conflict(W):
    """R-15: a coalesced save keeps `rev`, so If-Match compares the etag (save_seq)."""
    d = _mk(W)
    r = W.update(A, d["id"], if_match=d["etag"], plan=plan("win_rate"), apply="only",
                 catalog=CAT, now=T0 + timedelta(seconds=120))
    seen = r["etag"]                                   # both tabs read this
    a = W.update(A, d["id"], if_match=seen, name="Tab A name", apply="only",
                 catalog=CAT, now=T0 + timedelta(seconds=130))
    assert a["rev"] == r["rev"]                        # coalesced: same member-visible rev
    before = _rows("SELECT * FROM j2_widget_definitions WHERE id = ?", (d["id"],))
    revs_before = _rows("SELECT * FROM j2_widget_definition_revs WHERE definition_id = ?", (d["id"],))
    with pytest.raises(W.Conflict) as e:
        W.update(A, d["id"], if_match=seen, name="Tab B name", apply="only",
                 catalog=CAT, now=T0 + timedelta(seconds=140))
    assert e.value.sentence == "Changed in another tab. Reload to see the newer version."
    assert _rows("SELECT * FROM j2_widget_definitions WHERE id = ?", (d["id"],)) == before
    assert _rows("SELECT * FROM j2_widget_definition_revs WHERE definition_id = ?",
                 (d["id"],)) == revs_before
    assert W.get(A, d["id"])["name"] == "Tab A name"
    # restore_rev compares the etag too
    with pytest.raises(W.Conflict):
        W.restore_rev(A, d["id"], 1, if_match=seen, catalog=CAT, now=T0 + timedelta(seconds=150))


def test_two_notes_only_saves_never_coalesce(W):
    """R-16: saves from two different notes inside 60 s are two revisions."""
    d = _mk(W)
    x = W.update(A, d["id"], if_match=d["etag"], plan=plan("win_rate"), apply="only",
                 origin="note-x", catalog=CAT, now=T0 + timedelta(seconds=120))
    assert x["rev"] == 2                               # note X now stores def_rev=2
    y = W.update(A, d["id"], if_match=x["etag"], plan=plan("net_pnl"), apply="only",
                 origin="note-y", catalog=CAT, now=T0 + timedelta(seconds=150))
    assert y["rev"] == 3
    p, ran, _ = W.resolve_for_run(A, d["id"], 2)
    assert ran == 2 and p["measures"] == [{"key": "win_rate"}]
    # the same note saving again inside the window coalesces with its own revision
    y2 = W.update(A, d["id"], if_match=y["etag"], plan=plan("win_rate"), apply="only",
                  origin="note-y", catalog=CAT, now=T0 + timedelta(seconds=160))
    assert y2["rev"] == 3
    # My tools (no origin) never coalesces with a note's revision
    m = W.update(A, d["id"], if_match=y2["etag"], plan=plan(), apply="only",
                 catalog=CAT, now=T0 + timedelta(seconds=170))
    assert m["rev"] == 4
    m2 = W.update(A, d["id"], if_match=m["etag"], plan=plan("win_rate"), apply="only",
                  catalog=CAT, now=T0 + timedelta(seconds=180))
    assert m2["rev"] == 4


def test_restore_refuses_a_too_new_current_widget(W):
    d = _mk(W)
    r = W.update(A, d["id"], if_match=d["etag"], plan=plan("win_rate"), apply="only",
                 catalog=CAT, now=T0 + timedelta(seconds=120))
    c = _conn()
    try:
        c.execute("UPDATE j2_widget_definitions SET plan_version = 9, plan_json = ? WHERE id = ?",
                  (json.dumps({"v": 9}), d["id"]))
        c.commit()
    finally:
        c.close()
    with pytest.raises(W.PlanTooNew):
        W.restore_rev(A, d["id"], 1, if_match=r["etag"], catalog=CAT, now=T0 + timedelta(seconds=300))
    assert W.get(A, d["id"])["rev"] == 2


def test_list_reads_without_a_write_unless_there_is_something_to_purge(W, monkeypatch):
    d = _mk(W)
    calls = []
    real = W._write

    def spy(conn):
        calls.append(1)
        return real(conn)
    monkeypatch.setattr(W, "_write", spy)
    assert [x["id"] for x in W.list_defs(A, now=T0)] == [d["id"]]
    assert calls == []
    monkeypatch.setattr(W, "_write", real)
    W.archive(A, d["id"], now=T0)
    W.soft_delete(A, d["id"], typed_name="Setups", now=T0)
    monkeypatch.setattr(W, "_write", spy)
    W.list_defs(A, deleted=True, now=T0 + timedelta(days=1))
    assert calls == []                                 # deleted, but not 30 days ago
    W.list_defs(A, deleted=True, now=T0 + timedelta(days=31))
    assert calls == [1]


def test_write_with_a_caller_connection_commits_unless_the_caller_holds_a_transaction(W):
    c = _conn()
    try:
        d = W.create(A, "Own txn", plan(), catalog=CAT, now=T0, conn=c)
        assert not c.in_transaction                    # committed by the call
        c.execute("BEGIN IMMEDIATE")
        W.archive(A, d["id"], now=T0, conn=c)
        assert c.in_transaction                        # joined; the caller commits
        c.rollback()
    finally:
        c.close()
    assert W.get(A, d["id"])["archived"] is False


def test_name_rev_sentence_and_save_new_copy_name(W):
    d = _mk(W, name="Setups")
    with pytest.raises(W.WidgetError) as e:
        W.name_rev(A, d["id"], 1, 42)
    assert e.value.sentence == "Give this version a name."
    copy = W.update(A, d["id"], if_match=d["etag"], apply="save_new", catalog=CAT, now=T0)
    assert copy["name"] == "Setups copy"
    long = _mk(W, name="x" * 200)
    c2 = W.update(A, long["id"], if_match=long["etag"], apply="save_new", catalog=CAT, now=T0)
    assert len(c2["name"]) == 200 and c2["name"] == "x" * 200


def test_keeps_50_unnamed_plus_named(W):
    d = _mk(W)
    W.name_rev(A, d["id"], 1, "The first one")
    etag = d["etag"]
    for i in range(1, 60):
        out = W.update(A, d["id"], if_match=etag, plan=plan("win_rate" if i % 2 else "net_pnl"),
                       apply="only", catalog=CAT, now=T0 + timedelta(minutes=2 * i))
        etag = out["etag"]
    assert out["rev"] == 60
    kept = W.revs(A, d["id"])
    unnamed = [r["rev"] for r in kept if r["named"] is None]
    named = [r["rev"] for r in kept if r["named"] is not None]
    assert len(unnamed) == 50 and unnamed == list(range(60, 10, -1))
    assert named == [1]
    # placed_rev (1) is named here; the stored row still exists for a run
    assert W.resolve_for_run(A, d["id"], None)[1] == 1


def test_restore_saves_new_rev(W):
    d = _mk(W)
    W.update(A, d["id"], if_match=1, plan=plan("win_rate"), apply="update_all",
             catalog=CAT, now=T0 + timedelta(minutes=5))
    r = W.restore_rev(A, d["id"], 1, if_match=2, catalog=CAT, now=T0 + timedelta(seconds=5 * 60 + 10))
    # a restore is always a NEW revision, even inside the coalesce window
    assert r["rev"] == 3 and r["plan"]["measures"] == [{"key": "net_pnl"}]
    assert [x["rev"] for x in W.revs(A, d["id"])] == [3, 2, 1]
    with pytest.raises(W.Conflict):
        W.restore_rev(A, d["id"], 2, if_match=2, catalog=CAT, now=T0 + timedelta(minutes=9))
    with pytest.raises(W.NotFound):
        W.restore_rev(A, d["id"], 99, if_match=3, catalog=CAT, now=T0 + timedelta(minutes=9))


def test_count_cap_sentence(W):
    c = _conn()
    try:
        for i in range(W.COUNT_CAP):
            c.execute(
                "INSERT INTO j2_widget_definitions (id, user_id, name, plan_json, plan_version, rev,"
                " placed_rev, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?)",
                (f"seed-{i}", A, f"w{i}", json.dumps(plan()), T0.isoformat(), T0.isoformat()))
        c.commit()
    finally:
        c.close()
    with pytest.raises(W.WidgetError) as e:
        _mk(W)
    assert e.value.sentence == "You have 100 widgets. Archive one in My tools to make room."
    # save_new counts too
    with pytest.raises(W.WidgetError):
        W.update(A, "seed-0", if_match=1, plan=plan(), apply="save_new", catalog=CAT, now=T0)
    # an archived widget makes room; unarchiving it again is refused at the cap
    W.archive(A, "seed-0", now=T0)
    made = _mk(W)
    assert made["rev"] == 1
    with pytest.raises(W.WidgetError) as e2:
        W.unarchive(A, "seed-0", now=T0)
    assert e2.value.sentence == "You have 100 widgets. Archive one in My tools to make room."
    # another member is not capped by A's widgets
    assert _mk(W, uid=B)["rev"] == 1


def test_delete_needs_archive_and_typed_name(W):
    d = _mk(W, name="Setups")
    with pytest.raises(W.WidgetError):
        W.soft_delete(A, d["id"], typed_name="Setups", now=T0)          # not archived
    W.archive(A, d["id"], now=T0)
    assert W.get(A, d["id"])["archived"] is True
    with pytest.raises(W.WidgetError):
        W.soft_delete(A, d["id"], typed_name="setups", now=T0)          # not the name
    W.soft_delete(A, d["id"], typed_name="Setups", now=T0)
    assert W.get(A, d["id"]) is None
    assert W.resolve_for_run(A, d["id"], 1) == (None, None, None)
    assert [x["id"] for x in W.list_defs(A, deleted=True, now=T0)] == [d["id"]]
    assert W.list_defs(A, archived=True, now=T0) == []
    W.undelete(A, d["id"], now=T0 + timedelta(days=1))
    back = W.get(A, d["id"])
    assert back is not None and back["archived"] is True
    W.unarchive(A, d["id"], now=T0 + timedelta(days=1))
    assert [x["id"] for x in W.list_defs(A, now=T0 + timedelta(days=1))] == [d["id"]]


def test_recently_deleted_purged_after_30_days(W):
    old = _mk(W, name="Old")
    young = _mk(W, name="Young")
    other = _mk(W, uid=B, name="Old")
    for uid, d, when in ((A, old, T0), (A, young, T0 + timedelta(days=20)), (B, other, T0)):
        W.archive(uid, d["id"], now=when)
        W.soft_delete(uid, d["id"], typed_name=d["name"], now=when)
    later = T0 + timedelta(days=31)
    listed = W.list_defs(A, deleted=True, now=later)
    assert [x["id"] for x in listed] == [young["id"]]
    assert _rows("SELECT id FROM j2_widget_definitions WHERE id = ?", (old["id"],)) == []
    assert _rows("SELECT rev FROM j2_widget_definition_revs WHERE definition_id = ?", (old["id"],)) == []
    # member B's own old row is B's to purge, on B's own list
    assert _rows("SELECT id FROM j2_widget_definitions WHERE id = ?", (other["id"],)) != []
    with pytest.raises(W.NotFound):
        W.undelete(A, old["id"], now=later)


def test_too_new_plan_get_flags_and_refuses_update(W):
    d = _mk(W)
    newer = {"v": 99, "source": "closed_trades", "measures": [{"key": "future_measure"}]}
    c = _conn()
    try:
        c.execute("UPDATE j2_widget_definitions SET plan_json = ?, plan_version = 99 WHERE id = ?",
                  (json.dumps(newer), d["id"]))
        c.execute("UPDATE j2_widget_definition_revs SET plan_json = ?, summary = ? WHERE definition_id = ?",
                  (json.dumps(newer), "A summary written by a newer app.", d["id"]))
        c.commit()
    finally:
        c.close()
    got = W.get(A, d["id"])
    assert got["tooNew"] is True and got["plan"] == newer
    assert got["summary"] == "A summary written by a newer app."
    with pytest.raises(W.PlanTooNew) as e:
        W.update(A, d["id"], if_match=1, name="x", apply="only", catalog=CAT, now=T0)
    assert e.value.sentence == "This widget was made with a newer version of the app. Reload to use it."
    # stored as the member saved it, never rewritten
    assert json.loads(_rows("SELECT plan_json FROM j2_widget_definitions WHERE id = ?",
                            (d["id"],))[0][0]) == newer
    # an incoming plan from a newer app is refused too
    with pytest.raises(W.PlanTooNew):
        W.create(A, "n", {"v": 2, "source": "closed_trades", "measures": [{"key": "net_pnl"}]},
                 catalog=CAT, now=T0)


def test_resolve_for_run_prefers_placed_rev(W):
    d = _mk(W)
    W.update(A, d["id"], if_match=1, plan=plan("win_rate"), apply="update_all",
             catalog=CAT, now=T0 + timedelta(minutes=2))                 # rev 2, placed 2
    W.update(A, d["id"], if_match=2, plan=plan(), apply="only",
             catalog=CAT, now=T0 + timedelta(minutes=4))                 # rev 3, placed 2
    p, ran, latest = W.resolve_for_run(A, d["id"], 1)                    # an older placement
    assert (ran, latest) == (2, 3) and p["measures"] == [{"key": "win_rate"}]
    p, ran, latest = W.resolve_for_run(A, d["id"], 3)                    # placed at the newest
    assert (ran, latest) == (3, 3) and p["measures"] == [{"key": "net_pnl"}]
    p, ran, latest = W.resolve_for_run(A, d["id"], None)
    assert (ran, latest) == (2, 3)
    # an archived widget still runs where it is placed
    W.archive(A, d["id"], now=T0 + timedelta(minutes=5))
    assert W.resolve_for_run(A, d["id"], 3)[1] == 3
    assert W.resolve_for_run(A, "no-such-id", 1) == (None, None, None)


# -- the builder's create key (wave 8 consolidation, ruling R-43) ---------------

KEY = "3f2b8c1e-9d4a-4b7e-8f21-6a5c0d9e1b72"


def _keys(uid=None):
    if uid is None:
        return _rows("SELECT user_id, key, definition_id FROM j2_widget_create_keys ORDER BY user_id")
    return _rows("SELECT key, definition_id FROM j2_widget_create_keys WHERE user_id = ?", (uid,))


def _defs(uid):
    return _rows("SELECT id FROM j2_widget_definitions WHERE user_id = ?", (uid,))


def test_create_key_two_posts_with_one_key_make_one_widget(W):
    first = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    again = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0 + timedelta(minutes=3))
    assert again["id"] == first["id"]
    assert len(_defs(A)) == 1                                   # never a second widget
    assert _keys(A) == [(KEY, first["id"])]
    assert "replayed" not in first
    assert again["replayed"] is True and again["createdEtag"] == first["etag"]
    # the replay is the widget as it is NOW (renamed since), not a copy of the first answer
    W.update(A, first["id"], if_match=first["etag"], name="Renamed", apply="only", catalog=CAT,
             now=T0 + timedelta(minutes=5))
    third = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0 + timedelta(minutes=6))
    assert third["name"] == "Renamed" and third["etag"] > first["etag"] and third["createdEtag"] == first["etag"]


def test_create_key_is_per_member(W):
    a = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    b = W.create_with_key(B, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    assert a["id"] != b["id"]
    assert len(_defs(A)) == 1 and len(_defs(B)) == 1
    assert sorted(_keys()) == sorted([(A, KEY, a["id"]), (B, KEY, b["id"])])
    assert "replayed" not in b                                  # B's key never answers A's widget
    # and each member's repeat finds its OWN widget, never the other's (nor a second one of its own)
    assert W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)["id"] == a["id"]
    assert W.create_with_key(B, "Edge", plan(), key=KEY, catalog=CAT, now=T0)["id"] == b["id"]
    assert len(_defs(A)) == 1 and len(_defs(B)) == 1


def test_create_key_malformed_is_ignored_and_the_post_behaves_as_before(W):
    for bad in (None, "", "not-a-key", KEY.replace("-4b7e-", "-1b7e-"), KEY + "0", 12345, " " * 3,
                "3f2b8c1e9d4a4b7e8f216a5c0d9e1b72"):
        made = W.create_with_key(A, "Edge", plan(), key=bad, catalog=CAT, now=T0)
        assert "replayed" not in made
    assert len(_defs(A)) == 8                                   # each one a plain create
    assert _keys() == []                                        # and nothing remembered
    # case and surrounding space are not a different key
    W.create_with_key(A, "Edge", plan(), key=f"  {KEY.upper()} ", catalog=CAT, now=T0)
    again = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    assert again["replayed"] is True and len(_defs(A)) == 9


def test_create_key_with_a_different_payload_is_refused_and_writes_nothing(W):
    """R-48: a key never lets one widget's save land on, or return, another widget."""
    first = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    for name, p in (("Edge", plan("win_rate")), ("Other name", plan()), (None, plan())):
        with pytest.raises(W.KeyReused) as e:
            W.create_with_key(A, name, p, key=KEY, catalog=CAT, now=T0)
        assert e.value.sentence == W.S_KEY_REUSED and e.value.status == 409
    assert _defs(A) == [(first["id"],)]                         # never a second widget, never an update
    assert W.get(A, first["id"])["plan"]["measures"] == [{"key": "net_pnl"}]
    assert [r[0] for r in _rows("SELECT rev FROM j2_widget_definition_revs WHERE definition_id = ?",
                                (first["id"],))] == [1]
    # and the same payload still answers the original
    assert W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)["id"] == first["id"]


def test_create_key_replay_never_asks_the_count_cap(W, monkeypatch):
    first = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    monkeypatch.setattr(W, "COUNT_CAP", 1)
    assert W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)["id"] == first["id"]
    with pytest.raises(W.WidgetError) as e:                     # a NEW key still meets the cap
        W.create_with_key(A, "Edge", plan(), key=KEY.replace("3f2b", "4f2b"), catalog=CAT, now=T0)
    assert e.value.sentence == W.S_CAP
    assert _keys(A) == [(KEY, first["id"])]                     # a refused create remembers nothing


def test_create_key_expires_after_24_hours(W):
    first = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    inside = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT,
                               now=T0 + timedelta(seconds=W.CREATE_KEY_TTL_S))
    assert inside["id"] == first["id"]
    later = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT,
                              now=T0 + timedelta(seconds=W.CREATE_KEY_TTL_S + 1))
    assert later["id"] != first["id"] and "replayed" not in later
    assert _keys(A) == [(KEY, later["id"])]                     # the expired row went; the new one is kept
    # expired keys of OTHER members go in the same sweep
    W.create_with_key(B, "Edge", plan(), key=KEY, catalog=CAT, now=T0 + timedelta(days=2))
    W.create_with_key(A, "Edge", plan(), key=KEY.replace("3f2b", "5f2b"), catalog=CAT,
                      now=T0 + timedelta(days=3, seconds=1))
    assert [r[0] for r in _keys()] == [A]


def test_create_key_of_a_deleted_widget_makes_a_new_one(W):
    first = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    W.archive(A, first["id"], now=T0)
    assert W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)["id"] == first["id"]   # archived: same
    W.soft_delete(A, first["id"], typed_name="Edge", now=T0)
    fresh = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    assert fresh["id"] != first["id"] and "replayed" not in fresh
    assert _keys(A) == [(KEY, fresh["id"])]


def test_create_key_an_invalid_plan_is_refused_and_remembers_nothing(W):
    with pytest.raises(W.PlanError):
        W.create_with_key(A, "Edge", {"v": 1, "source": "nope", "measures": []}, key=KEY, catalog=CAT, now=T0)
    assert _keys() == [] and _defs(A) == []


def test_account_purge_removes_the_create_keys(W):
    from api.services.journal_two import account_purge as ap
    W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    W.create_with_key(B, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    assert "j2_widget_create_keys" in ap._DIRECT_USER_TABLES
    c = _conn()
    try:
        report = ap.purge_user_data(A, c)
    finally:
        c.close()
    assert report["ok"] is True
    assert _keys(A) == []
    assert [r[0] for r in _keys()] == [B]                       # the other member's key is untouched


# -- the save_new PUT's key (ruling R-49) ----------------------------------------

KEY2 = "7a1c2e3f-4b5d-4e6f-a7b8-c9d0e1f2a3b4"


def test_save_new_key_two_puts_make_one_copy(W):
    src = _mk(W, name="Edge")
    copy = W.update_with_key(A, src["id"], key=KEY2, if_match=src["etag"], name="Edge 2", plan=plan(),
                             apply="save_new", catalog=CAT, now=T0)
    again = W.update_with_key(A, src["id"], key=KEY2, if_match=src["etag"], name="Edge 2", plan=plan(),
                              apply="save_new", catalog=CAT, now=T0)
    assert copy["id"] != src["id"] and again["id"] == copy["id"] and again["replayed"] is True
    assert len(_defs(A)) == 2                                   # the source and ONE copy
    assert _keys(A) == [(KEY2, copy["id"])]


def test_save_new_key_is_looked_up_before_if_match(W):
    """The source changed after the first send landed: the retry is still a replay, never a 409."""
    src = _mk(W, name="Edge")
    copy = W.update_with_key(A, src["id"], key=KEY2, if_match=src["etag"], plan=plan(), apply="save_new",
                             catalog=CAT, now=T0)
    W.update(A, src["id"], if_match=src["etag"], name="Renamed", apply="only", catalog=CAT,
             now=T0 + timedelta(minutes=2))
    again = W.update_with_key(A, src["id"], key=KEY2, if_match=src["etag"], plan=plan(), apply="save_new",
                              catalog=CAT, now=T0 + timedelta(minutes=3))
    assert again["id"] == copy["id"] and len(_defs(A)) == 2


def test_save_new_key_with_a_different_payload_is_refused(W):
    src = _mk(W, name="Edge")
    other = _mk(W, name="Other")
    W.update_with_key(A, src["id"], key=KEY2, if_match=src["etag"], plan=plan(), apply="save_new",
                      catalog=CAT, now=T0)
    for def_id, etag, p in ((src["id"], src["etag"], plan("win_rate")), (other["id"], other["etag"], plan())):
        with pytest.raises(W.KeyReused):
            W.update_with_key(A, def_id, key=KEY2, if_match=etag, plan=p, apply="save_new",
                              catalog=CAT, now=T0)
    # a create with that key is a different request too
    with pytest.raises(W.KeyReused):
        W.create_with_key(A, "Edge", plan(), key=KEY2, catalog=CAT, now=T0)
    assert len(_defs(A)) == 3


def test_save_new_key_is_ignored_for_every_other_answer(W):
    src = _mk(W, name="Edge")
    got = W.update_with_key(A, src["id"], key=KEY2, if_match=src["etag"], name="Renamed", apply="only",
                            catalog=CAT, now=T0)
    assert got["id"] == src["id"] and "replayed" not in got
    assert _keys() == []


# -- round 2 (M-1, M-4) -----------------------------------------------------------

def test_create_key_resend_after_a_validator_change_is_still_a_replay(W, monkeypatch):
    """M-1: the hash is over the request AS SENT. A deploy that changes how a plan validates (a new default
    field, a renamed token) between a lost answer and the resend must never refuse the resend."""
    raw = plan()
    first = W.create_with_key(A, "Edge", raw, key=KEY, catalog=CAT, now=T0)
    real = W.validate_plan
    monkeypatch.setattr(W, "validate_plan", lambda p, cat: {**real(p, cat), "newDefault": True})
    again = W.create_with_key(A, "Edge", dict(raw), key=KEY, catalog=CAT, now=T0 + timedelta(minutes=5))
    assert again["id"] == first["id"] and again["replayed"] is True
    src = _mk(W, name="Src")
    copy = W.update_with_key(A, src["id"], key=KEY2, if_match=src["etag"], plan=plan(), apply="save_new",
                             catalog=CAT, now=T0)
    monkeypatch.setattr(W, "validate_plan", lambda p, cat: {**real(p, cat), "other": 1})
    assert W.update_with_key(A, src["id"], key=KEY2, if_match=src["etag"], plan=plan(), apply="save_new",
                             catalog=CAT, now=T0)["id"] == copy["id"]


def test_create_key_two_sends_racing_make_one_widget(W):
    """M-4: the second send waits on the first's write lock (BEGIN IMMEDIATE), then replays it."""
    import threading
    import time as _t
    held = _conn()
    held.execute("BEGIN IMMEDIATE")
    first = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0, conn=held)  # in the open txn
    out = {}

    def second():
        out["got"] = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)

    t = threading.Thread(target=second)
    t.start()
    _t.sleep(0.3)
    assert t.is_alive()                                         # waiting on the lock, not racing past it
    held.commit()
    held.close()
    t.join(5)
    assert out["got"]["id"] == first["id"] and out["got"]["replayed"] is True
    assert len(_defs(A)) == 1


def test_create_key_primary_key_is_the_backstop(W):
    """M-4: even without the lock, one (member, key) can hold only one row."""
    import sqlite3
    made = W.create_with_key(A, "Edge", plan(), key=KEY, catalog=CAT, now=T0)
    c = _conn()
    try:
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("INSERT INTO j2_widget_create_keys (user_id, key, definition_id, payload_sha, etag, created_at)"
                      " VALUES (?, ?, ?, 'x', 1, ?)", (A, KEY, made["id"], T0.isoformat()))
    finally:
        c.close()
