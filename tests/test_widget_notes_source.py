"""Task 10.7 -- the Notes widget source.

Seeded through `auth_db.init_db` (the Task 8.5 fixtures in `tests.test_widget_sources`) on a temp
sqlite file; nothing here reaches `C:\\data`.

Facts it pins (W10-R6, W10-R7, W10-R52 and the brief): a note's `created` / `updated` day is its ET
calendar date through the one ET-day authority (`timeutil.compute_trading_day_et`, which never moves a
weekend or an evening); trashed and sample notes are never read; note properties filter ONLY through
`note_properties.property_filter_sql`, and a property that is not one of the member's own is ONE notice
and never narrows; no body, plain text or title column is selected for measuring (the title is read
only for list rows and drill rows); the scan searches an index; notes never read the sample book.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import date, datetime, timezone

import pytest

from api.services.journal_two import note_properties, notes as j2_notes
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import aggregate, plan, sources
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import run as wrun
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    NOW, TODAY, UID, add_trade, add_user, conn,
)

RUN_NOW = datetime(2026, 10, 29, 15, 30, tzinfo=timezone.utc)      # ET day = 2026-10-29
RUN_TODAY = date(2026, 10, 29)
NOTE_KIND = "builtin:note_kind"
OTHER = "u-wnotes-other"


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-wnotes-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    # W10-R62: "Kind of note" is offered only while journal styles are on; these tests read kinds
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    wrun._reset_state()
    yield
    wrun._reset_state()


# -- seeding ------------------------------------------------------------------------------------

def add_n(c, uid, *, created="2026-10-20T15:00:00Z", updated=None, folder=None, tags=None,
          ticker=None, kind=None, props=None, deleted=None, archived=None, import_source=None,
          title="A note", account=None, nid=None, commit=True, created_kind=None):
    nid = nid or str(uuid.uuid4())
    if kind is not None:
        props = {**(props or {}), NOTE_KIND: kind}
    c.execute(
        "INSERT INTO j2_notes (id, user_id, account_id, folder_id, title, body_json, body_plain,"
        " ticker, tags, kind_id, properties_json, created_at, updated_at, deleted_at, archived_at,"
        " import_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (nid, uid, account, folder, title,
         json.dumps({"type": "doc", "content": [{"type": "text", "text": "BODY-CANARY"}]}),
         "BODY-CANARY plain", ticker, json.dumps(tags or []), created_kind,
         json.dumps(props) if props else None, created, updated or created, deleted, archived,
         import_source))
    if commit:
        c.commit()
    return nid


def add_folder(c, uid, name, *, parent="", fid=None):
    fid = fid or str(uuid.uuid4())
    c.execute("INSERT INTO j2_note_folders (id, user_id, name, parent_id, created_at)"
              " VALUES (?, ?, ?, ?, ?)", (fid, uid, name, parent, NOW))
    c.commit()
    return fid


def add_kind(c, uid, name, *, kid=None):
    kid = kid or str(uuid.uuid4())
    c.execute("INSERT INTO j2_note_kinds (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
              (kid, uid, name, NOW))
    c.commit()
    return kid


def add_prop(c, uid, name="Conviction", type_="number"):
    return note_properties.create_property_def(uid, name, type_, conn=c)["id"]


def raw(measures=("notes",), **kw):
    p = {"v": 1, "source": "notes",
         "measures": [m if isinstance(m, dict) else {"key": m} for m in measures],
         "range": kw.pop("range", {"token": "all"})}
    p.update(kw)
    return p


def scan_eval(c, r, *, uid=UID, today=RUN_TODAY):
    p = plan.validate_plan(r, sources.CATALOG)
    rng = plan.resolve_range(p["range"], today)
    sc = sources.scan(c, p, {}, rng, uid, today=today)
    return p, sc, aggregate.evaluate(sc.rows, p, sources.CATALOG)


def run_out(r, *, lane="run", sample=False, uid=UID, now=RUN_NOW, settings=None):
    return wrun.run_plan(uid, r, settings or {}, lane=lane, now=now, sample=sample)


def groups(res):
    return {g.label: g.values.cells[0].value for g in res.groups}


# -- the brief's tests -----------------------------------------------------------------------------

def test_trashed_and_sample_notes_excluded(conn):
    live = add_n(conn, UID)
    other = add_n(conn, UID)
    add_n(conn, UID, archived="2026-10-22T00:00:00Z")                 # archived (W10-R59)
    add_n(conn, UID, deleted="2026-10-22T00:00:00Z")                  # trashed
    add_n(conn, UID, archived="2026-10-22T00:00:00Z", deleted="2026-10-23T00:00:00Z")  # both
    add_n(conn, UID, import_source="sample")                          # the sample notebook
    _p, sc, res = scan_eval(conn, raw())
    assert {r["_tid"] for r in sc.rows} == {live, other}
    assert res.count == 2 and res.total.cells[0].value == 2.0
    out = run_out(raw())
    assert out["count"] == 2 and out["value"]["v1"] == 2.0
    # the notes list's own count, for the same book, with the sample left out
    assert j2_notes.count_notes(UID, exclude_sample=True, conn=conn) == 2
    # control: an imported note that is not the sample is the member's own
    add_n(conn, UID, import_source="notion")
    assert scan_eval(conn, raw())[2].count == 3
    assert j2_notes.count_notes(UID, exclude_sample=True, conn=conn) == 3


def test_the_scan_asks_the_notes_lists_own_predicate(conn, monkeypatch):
    """W10-R59: derived from `notes._notes_filter_sql`, never restated: a rule the list learns
    reaches the widget. Control: the widget's SQL carries exactly the list's clause."""
    p = plan.validate_plan(raw(), sources.CATALOG)
    rng = plan.resolve_range(p["range"], RUN_TODAY)
    where, _params = j2_notes._notes_filter_sql(UID, exclude_sample=True)
    sql, params = wcompile.compile_scan(sources.NOTES, p, {}, rng, UID)
    assert ("FROM j2_notes n" + where) in sql and "archived_at IS NULL" in where
    real = j2_notes._notes_filter_sql

    def taught(user_id, **kw):
        s, ps = real(user_id, **kw)
        return s + " AND ticker IS NOT 'LEARNED'", ps

    monkeypatch.setattr(j2_notes, "_notes_filter_sql", taught)
    sql2, _ = wcompile.compile_scan(sources.NOTES, p, {}, rng, UID)
    assert "ticker IS NOT 'LEARNED'" in sql2


def test_created_day_is_et(conn):
    late = add_n(conn, UID, created="2026-10-28T03:30:00Z", updated="2026-10-29T01:15:00Z")
    _p, sc, _res = scan_eval(conn, raw(view={"type": "list"}))
    row = next(r for r in sc.rows if r["_tid"] == late)
    assert row["created"] == "2026-10-27" and row["day"] == "2026-10-27"   # 23:30 ET on Oct 27
    assert row["updated"] == "2026-10-28"                                   # 21:15 ET on Oct 28
    assert row["created_hour"] == 23.0 and row["updated_hour"] == 21.0
    assert row["weekday"] == "Tuesday" and row["month"] == "2026-10"
    on = scan_eval(conn, raw(range={"from": "2026-10-27", "to": "2026-10-27"}))[2]
    assert on.count == 1
    after = scan_eval(conn, raw(range={"from": "2026-10-28", "to": "2026-10-28"}))[2]
    assert after.count == 0
    # the ET calendar date, never a trading day: a Saturday note stays on Saturday
    sat = add_n(conn, UID, created="2026-10-24T18:00:00Z")
    _p, sc, _res = scan_eval(conn, raw())
    assert next(r for r in sc.rows if r["_tid"] == sat)["created"] == "2026-10-24"
    # the one ET-day authority decides it (W10-R52), never a second conversion
    assert sources._note_day is sources.timeutil.compute_trading_day_et
    assert sources._note_hour is sources.timeutil.compute_hour_et


def test_split_by_folder_kind_tag_ticker_with_none_labels(conn):
    ideas = add_folder(conn, UID, "Ideas")
    setup = add_kind(conn, UID, "Setup")
    add_n(conn, UID, folder=ideas, kind=setup, tags=["earnings", "swing"], ticker="NVDA",
          created_kind="trade_plan")                       # created as a trade plan: not read
    add_n(conn, UID, folder=ideas, kind="thesis", tags=["earnings"], ticker="NVDA")
    add_n(conn, UID, folder="", kind=None, tags=[], ticker="", created_kind="thesis")
    by = lambda key: groups(scan_eval(conn, raw(split={"by": key}, view={"type": "bar"}))[2])  # noqa: E731
    assert by("folder") == {"Ideas": 2.0, "No folder": 1.0}
    assert by("kind") == {"Setup": 1.0, "Thesis": 1.0, "No kind": 1.0}
    assert by("tag") == {"earnings": 2.0, "swing": 1.0, "No tags": 1.0}
    assert by("ticker") == {"NVDA": 2.0, "No ticker": 1.0}
    # a filter on each narrows (SQL and its Python twin agree)
    assert scan_eval(conn, raw(filters=[{"field": "folder", "op": "in", "values": [ideas]}]))[2] \
        .count == 2
    assert scan_eval(conn, raw(filters=[{"field": "tag", "op": "has_any",
                                         "values": ["swing"]}]))[2].count == 1
    assert scan_eval(conn, raw(filters=[{"field": "ticker", "op": "in",
                                         "values": ["nvda"]}]))[2].count == 2   # case-insensitive
    assert scan_eval(conn, raw(filters=[{"field": "kind", "op": "in",
                                         "values": ["thesis"]}]))[2].count == 1
    assert scan_eval(conn, raw(filters=[{"field": "kind", "op": "in",
                                         "values": ["thesis", setup]}]))[2].count == 2
    assert scan_eval(conn, raw(filters=[{"field": "kind", "op": "not_in",
                                         "values": ["thesis"]}]))[2].count == 2
    assert scan_eval(conn, raw(filters=[{"field": "kind", "op": "in",
                                         "values": ["trade_plan"]}]))[2].count == 0


def test_a_note_whose_kind_changed_lands_in_its_new_kind(conn, monkeypatch):
    """W10-R60: `kind_id` is provenance and never updated; the current kind is the
    `builtin:note_kind` property, set through the note's own write door."""
    seen: list[str] = []
    note = j2_notes.create_note(UID, {"title": "plan"}, conn=conn,
                                properties={NOTE_KIND: "thesis"})
    conn.commit()
    by = lambda: groups(scan_eval(conn, raw(split={"by": "kind"},             # noqa: E731
                                            view={"type": "bar"}))[2])
    assert by() == {"Thesis": 1.0}
    j2_notes.update_note(UID, note["id"], {"properties": {NOTE_KIND: "trade_plan"}}, conn=conn)
    conn.commit()
    assert conn.execute("SELECT kind_id FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()[0] \
        in (None, "thesis")                                 # the provenance column did not follow
    assert by() == {"Trade plan": 1.0}
    # a one-kind filter narrows in SQL through the one property filter authority
    conn.set_trace_callback(seen.append)
    try:
        res = scan_eval(conn, raw(filters=[{"field": "kind", "op": "in",
                                            "values": ["trade_plan"]}]))[2]
    finally:
        conn.set_trace_callback(None)
    assert res.count == 1
    assert any("json_extract(properties_json" in s and "builtin:note_kind" in s for s in seen)
    assert scan_eval(conn, raw(filters=[{"field": "kind", "op": "in",
                                         "values": ["thesis"]}]))[2].count == 0


def test_property_filter_through_property_filter_sql(conn, monkeypatch):
    pid = add_prop(conn, UID)
    for v in (1, 3, 5):
        add_n(conn, UID, props={pid: v})
    add_n(conn, UID)                                                   # no value
    add_n(conn, UID, props={pid: 9}, deleted="2026-10-22T00:00:00Z")   # trashed
    add_n(conn, UID, props={pid: 9}, import_source="sample")           # sample
    calls: list[tuple] = []
    real = note_properties.property_filter_sql

    def spy(user_id, conds, c, *, strict=True):
        calls.append((user_id, json.dumps(conds, sort_keys=True), strict))
        return real(user_id, conds, c, strict=strict)

    monkeypatch.setattr(note_properties, "property_filter_sql", spy)
    for op, values, cond in (
            ("gte", [3], [{"propertyId": pid, "op": "gte", "value": 3}]),
            ("eq", [1], [{"propertyId": pid, "op": "eq", "value": 1}]),
            ("between", [2, 4], [{"propertyId": pid, "op": "gte", "value": 2},
                                 {"propertyId": pid, "op": "lte", "value": 4}])):
        calls.clear()
        f = [{"field": "property", "op": op, "values": values, "prop": pid}]
        res = scan_eval(conn, raw(filters=f))[2]
        assert calls and all(u == UID and s is False for u, _c, s in calls), op
        assert {c for _u, c, _s in calls} == {json.dumps(cond, sort_keys=True)}, op
        listed = j2_notes.count_notes(UID, property_filter=cond, exclude_sample=True, conn=conn)
        assert res.count == listed, (op, res.count, listed)
    assert scan_eval(conn, raw(filters=[{"field": "property", "op": "gte", "values": [3],
                                         "prop": pid}]))[2].count == 2
    # two property filters AND together
    f2 = [{"field": "property", "op": "gte", "values": [2], "prop": pid},
          {"field": "property", "op": "lte", "values": [3], "prop": pid}]
    assert scan_eval(conn, raw(filters=f2))[2].count == 1
    # control: the filter does narrow (3 valued notes, 4 live in all)
    assert scan_eval(conn, raw())[2].count == 4


def test_foreign_property_is_one_notice_and_no_narrowing(conn):
    add_user(conn, OTHER)
    theirs = add_prop(conn, OTHER)
    gone = add_prop(conn, UID, "Old")
    note_properties.delete_property_def(UID, gone, conn=conn)
    for v in (1, 5):
        add_n(conn, UID, props={theirs: v, gone: v})
    add_n(conn, UID)
    f = [{"field": "property", "op": "gte", "values": [3], "prop": theirs},
         {"field": "property", "op": "gte", "values": [3], "prop": gone}]
    out = run_out(raw(measures=("notes", {"key": "property_sum", "prop": theirs}), filters=f))
    assert out["count"] == 3                                            # never narrowed
    assert out["notice"].count(sources.S_PROP_GONE) == 1, out["notice"]
    assert out["notice"] == sources.S_PROP_GONE
    assert out["value"]["v1"] == 3.0 and out["value"]["v2"] is None    # never B's numbers
    assert sources.S_PROP_GONE == "That property isn't available; it is not used in this widget."
    # a FILTER alone naming another member's property is the notice too (not only a sum)
    only = run_out(raw(filters=[{"field": "property", "op": "gte", "values": [3],
                                 "prop": theirs}]))
    assert only["count"] == 3 and only["notice"] == sources.S_PROP_GONE
    # control: the member's own property narrows and says nothing
    mine = add_prop(conn, UID, "Mine")
    add_n(conn, UID, props={mine: 4})
    own = run_out(raw(filters=[{"field": "property", "op": "gte", "values": [3], "prop": mine}]))
    assert own["count"] == 1 and not own["notice"]


def test_property_sum_and_non_number_notice(conn):
    num = add_prop(conn, UID, "Size")
    txt = add_prop(conn, UID, "Why", "text")
    add_n(conn, UID, props={num: 2, txt: "breakout"})
    add_n(conn, UID, props={num: 3.5})
    add_n(conn, UID)
    out = run_out(raw(measures=({"key": "property_sum", "prop": num},)))
    assert out["value"]["v1"] == 5.5 and out["count"] == 3 and not out["notice"]
    assert out["measures"][0]["unit"] == "notes"
    bad = run_out(raw(measures=({"key": "property_sum", "prop": txt},)))
    assert bad["value"]["v1"] is None
    assert bad["notice"] == sources.S_PROP_NOT_NUMBER == "That property isn't a number you can add up."
    # a number property no note holds yet is "no data", never 0
    empty = add_prop(conn, UID, "Unused")
    none = run_out(raw(measures=({"key": "property_sum", "prop": empty},)))
    assert none["value"]["v1"] is None and not none["notice"]


def _note_statements(seen: list[str]) -> list[str]:
    return [s for s in seen if re.search(r"\bj2_notes\b", s)]


def test_no_body_column_selected(conn):
    pid = add_prop(conn, UID)
    folder = add_folder(conn, UID, "Ideas")
    add_n(conn, UID, folder=folder, props={pid: 2}, title="TITLE-CANARY")
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        for r in (raw(), raw(split={"by": "folder"}, view={"type": "bar"}),
                  raw(measures=({"key": "property_sum", "prop": pid},),
                      filters=[{"field": "property", "op": "gte", "values": [1], "prop": pid}])):
            scan_eval(conn, r)
    finally:
        conn.set_trace_callback(None)
    reads = _note_statements(seen)
    assert any("FROM j2_notes n" in s for s in reads), "control: the trace saw the scan"
    for s in seen:
        assert "body_json" not in s and "body_plain" not in s, s[:200]
        assert not re.search(r"\btitle\b", s), s[:200]                # not read to measure
    # a list reads the titles, and only through the one by-id title read
    seen.clear()
    conn.set_trace_callback(seen.append)
    try:
        _p, sc, _res = scan_eval(conn, raw(view={"type": "list"}))
    finally:
        conn.set_trace_callback(None)
    assert sc.rows[0]["title"] == "TITLE-CANARY"
    titled = [s for s in seen if re.search(r"\btitle\b", s)]
    assert len(titled) == 1 and titled[0].startswith("SELECT id, title FROM j2_notes"), titled
    assert all("body_json" not in s and "body_plain" not in s for s in seen)


def _query_plan(c, sql, params) -> list[str]:
    return [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()]


def test_scan_uses_an_index(conn):
    pid = add_prop(conn, UID)
    for i in range(30):
        add_n(conn, UID, created=f"2026-10-{1 + i % 28:02d}T15:00:00Z", props={pid: i},
              commit=False)
    conn.commit()
    conn.execute("ANALYZE")
    shapes = [raw(), raw(range={"from": "2026-10-05", "to": "2026-10-20"}),
              raw(filters=[{"field": "tag", "op": "has_any", "values": ["x"]},
                           {"field": "ticker", "op": "contains", "values": ["NV"]}]),
              raw(accounts={"id": "acc-x"})]
    for r in shapes:
        p = plan.validate_plan(r, sources.CATALOG)
        rng = plan.resolve_range(p["range"], RUN_TODAY)
        extra = note_properties.property_filter_sql(
            UID, [{"propertyId": pid, "op": "gte", "value": 3}], conn, strict=False)
        for ex in (("", []), extra):
            sql, params = wcompile.compile_scan(sources.NOTES, p, {}, rng, UID, extra=ex)
            details = _query_plan(conn, sql, params)
            assert any(d.startswith("SEARCH n USING INDEX") and "(user_id=?" in d
                       for d in details), details
            assert not any(re.match(r"SCAN (n|j2_notes)\b", d) for d in details), details
    # control: the check can fail -- the same scan forbidden its indexes is a full SCAN
    sql, params = wcompile.compile_scan(sources.NOTES, plan.validate_plan(raw(), sources.CATALOG),
                                        {}, plan.resolve_range({"token": "all"}, RUN_TODAY), UID)
    bare = sql.replace("FROM j2_notes n", "FROM j2_notes n NOT INDEXED")
    assert bare != sql
    assert any(re.match(r"SCAN n\b", d) for d in _query_plan(conn, bare, params))


def test_hour_of_created_through_formula(conn):
    add_n(conn, UID, created="2026-10-28T03:30:00Z")                  # 23:30 ET
    add_n(conn, UID, created="2026-10-27T14:05:00Z")                  # 10:05 ET
    f = [{"id": "f1", "name": "Hour", "expr": "Hour([created])"},
         {"id": "f2", "name": "Late", "expr": "Hour([created]) >= 20"}]
    out = run_out(raw(measures=({"formula": "f1", "agg": "max"}, {"formula": "f1", "agg": "min"}),
                      formulas=f))
    assert out["value"]["v1"] == 23.0 and out["value"]["v2"] == 10.0
    late = run_out(raw(formulas=f, filters=[{"field": "formula:f2", "op": "is",
                                             "values": [True]}]))
    assert late["count"] == 1


def test_list_rows_label_kind_note(conn):
    add_n(conn, UID, title="Earnings plan", created="2026-10-20T15:00:00Z")
    out = run_out(raw(view={"type": "list"}))
    assert out["rows"][0]["label"] == "Earnings plan"
    assert out["rows"][0]["label2"] == "2026-10-20"
    assert out["labelKind"] == "note"
    # control: a split is not a list of notes, so it is not marked
    split = run_out(raw(split={"by": "ticker"}, view={"type": "bar"}))
    assert "labelKind" not in split
    assert sources.NOTES.list_labels == ("title", "created")


def test_never_sample(conn):
    for _ in range(3):
        add_n(conn, UID)
    assert wrun.wants_sample(conn, UID)                      # 0 trades: other sources would
    out = run_out(raw(), lane="preview", sample=True)
    assert out["sample"] is False and out["count"] == 3 and out["value"]["v1"] == 3.0
    with pytest.raises(ValueError):
        wrun.sample_rows("notes")


def test_empty_sentence_exact(conn):
    out = run_out(raw())
    assert out["count"] == 0
    assert out["empty"] == "No notes match."
    # no fabricated zero for an empty property sum either
    pid = add_prop(conn, UID)
    assert run_out(raw(measures=({"key": "property_sum", "prop": pid},)))["value"]["v1"] is None


# -- the source's shape ------------------------------------------------------------------------

def test_notes_source_fields_and_measures():
    src = sources.SOURCES["notes"]
    assert src is sources.NOTES and src.label == "Notes" and src.unit == "notes"
    assert src.description == "Every note you have written."
    f = src.fields
    assert set(f) == {"created", "updated", "weekday", "month", "folder", "tag", "ticker", "kind",
                      "property"}
    assert (f["created"].label, f["created"].type, f["created"].hour_key) == (
        "Created", "day", "created_hour")
    assert (f["updated"].label, f["updated"].hour_key) == ("Updated", "updated_hour")
    assert (f["folder"].label_from, f["folder"].none_label) == ("folder_name", "No folder")
    assert (f["kind"].label, f["kind"].label_from, f["kind"].none_label) == (
        "Note kind", "kind_name", "No kind")
    assert (f["tag"].type, f["tag"].none_label) == ("tag", "No tags")
    assert (f["ticker"].type, f["ticker"].ci, f["ticker"].none_label) == ("text", True, "No ticker")
    assert f["property"].split is False and f["property"].filterable is True
    assert all(f[k].split for k in f if k != "property")
    ms = sources.CATALOG.measures_for("notes")
    assert set(ms) == {"notes", "property_sum"}
    assert (ms["notes"].label, ms["notes"].kind, ms["notes"].unit) == ("Notes", "count", "notes")
    assert (ms["property_sum"].label, ms["property_sum"].kind) == ("Sum of a property", "sum")
    # a real property id (what `create_property_def` mints) is a valid `prop`
    pid = uuid.uuid4().hex
    p = plan.validate_plan(raw(measures=({"key": "property_sum", "prop": pid},),
                               filters=[{"field": "property", "op": "gte", "values": [1],
                                         "prop": pid}]), sources.CATALOG)
    assert p["measures"][0]["prop"] == pid and p["filters"][0]["prop"] == pid and p["v"] == 3


def test_a_folder_or_kind_that_is_not_the_members_reads_as_none(conn):
    add_user(conn, OTHER)
    their_folder = add_folder(conn, OTHER, "B-FOLDER-CANARY")
    their_kind = add_kind(conn, OTHER, "B-KIND-CANARY")
    add_n(conn, UID, folder=their_folder, kind=their_kind)
    for key, none in (("folder", "No folder"), ("kind", "No kind")):
        res = scan_eval(conn, raw(split={"by": key}, view={"type": "bar"}))[2]
        assert groups(res) == {none: 1.0}, key
        assert scan_eval(conn, raw(filters=[{"field": key, "op": "in",
                                             "values": [their_folder, their_kind]}]))[2].count == 0


def test_capped_at_5000_newest_first(conn):
    rows = [(str(uuid.uuid4()), UID, f"20{10 + i // 360:02d}-{1 + (i // 30) % 12:02d}-"
             f"{1 + i % 28:02d}T15:00:{i % 60:02d}Z") for i in range(5001)]
    conn.executemany("INSERT INTO j2_notes (id, user_id, title, created_at, updated_at)"
                     " VALUES (?, ?, 't', ?, ?3)", rows)
    conn.commit()
    _p, sc, res = scan_eval(conn, raw())
    assert sc.capped is True and len(sc.rows) <= 5000 and res.count == len(sc.rows)
    days = [r["day"] for r in sc.rows]
    assert days == sorted(days, reverse=True)
    out = run_out(raw())
    assert out["capped"] is True
    assert out["notice"].startswith(f"Based on your newest {out['count']:,} notes"), out["notice"]


def test_a_capped_read_states_the_notes_it_kept(conn):
    """The SQL reads past the range's last day (the pre-filter is widened), so a full read can keep
    fewer notes than the cap: the notice must state what was KEPT, never the cap."""
    rows = [(str(uuid.uuid4()), UID, f"2026-10-21T15:{i // 60 % 60:02d}:{i % 60:02d}Z")
            for i in range(2000)]                                    # ET Oct 21: past the range
    rows += [(str(uuid.uuid4()), UID, f"2026-10-20T15:{i // 60 % 60:02d}:{i % 60:02d}.{i:04d}Z")
             for i in range(4000)]                                   # ET Oct 20: in range
    conn.executemany("INSERT INTO j2_notes (id, user_id, title, created_at, updated_at)"
                     " VALUES (?, ?, 't', ?, ?3)", rows)
    conn.commit()
    out = run_out(raw(range={"from": "2026-10-10", "to": "2026-10-20"}))
    assert out["capped"] is True and out["count"] == 3001, out["count"]
    assert out["notice"].startswith("Based on your newest 3,001 notes"), out["notice"]


def test_the_scan_asks_the_deadline(conn, monkeypatch):
    for i in range(600):
        add_n(conn, UID, created=f"2026-10-{1 + i % 28:02d}T15:00:00Z", commit=False)
    conn.commit()
    asked = []
    monkeypatch.setattr(wcompile, "check_deadline", lambda: asked.append(1))
    scan_eval(conn, raw())
    # both Python loops (the cut to the ET day, the rows) ask every 256 rows
    assert len(asked) >= 2 * (600 // 256 + 1), len(asked)


def test_a_line_and_a_heat_map_run_along_a_notes_day():
    for by in ("created", "updated"):
        for view in ("line", "heat"):
            p = plan.validate_plan(raw(split={"by": by}, view={"type": view}), sources.CATALOG)
            assert sources.CATALOG.view_allowed(p) is None, (by, view)
    assert sources.CATALOG.auto_view({"source": "notes", "split": {"by": "created"}}) == "line"
    with pytest.raises(plan.PlanError) as e:
        plan.validate_plan(raw(split={"by": "folder"}, view={"type": "line"}), sources.CATALOG)
    assert e.value.sentence == sources.S_VIEW_LINE
    with pytest.raises(plan.PlanError) as e:
        plan.validate_plan(raw(split={"by": "month"}, view={"type": "heat"}), sources.CATALOG)
    assert e.value.sentence == sources.S_VIEW_HEAT


# -- carry-overs -------------------------------------------------------------------------------

def test_the_folder_and_kind_stamps_are_bounded_and_move_on_a_rename(conn):
    """10.4 N-4: 2,000 folders once made a 238 KB stamp. A fixed-size digest, still moved by a
    rename, a move or a new folder (and a kind rename)."""
    fids = [str(uuid.uuid4()) for _ in range(2000)]
    conn.executemany("INSERT INTO j2_note_folders (id, user_id, name, parent_id, created_at)"
                     " VALUES (?, ?, ?, '', ?)",
                     [(f, UID, "folder " + "x" * 80 + str(i), NOW) for i, f in enumerate(fids)])
    kid = add_kind(conn, UID, "Thesis-ish")
    conn.commit()
    before = wrun.data_stamp(conn, UID, "notes")
    assert len(before) < 400, len(before)
    conn.execute("UPDATE j2_note_folders SET name = 'renamed' WHERE id = ?", (fids[1234],))
    conn.commit()
    renamed = wrun.data_stamp(conn, UID, "notes")
    assert renamed != before and len(renamed) == len(before)
    conn.execute("UPDATE j2_note_folders SET parent_id = ? WHERE id = ?", (fids[0], fids[1234]))
    conn.commit()
    moved = wrun.data_stamp(conn, UID, "notes")
    assert moved != renamed
    conn.execute("UPDATE j2_note_kinds SET name = 'Setup-ish' WHERE id = ?", (kid,))
    conn.commit()
    assert wrun.data_stamp(conn, UID, "notes") != moved
    # another member's folders never move this member's stamp
    add_user(conn, OTHER)
    same = wrun.data_stamp(conn, UID, "notes")
    add_folder(conn, OTHER, "theirs")
    assert wrun.data_stamp(conn, UID, "notes") == same


def test_a_cached_card_follows_trash_archive_restore_and_a_deleted_property(conn):
    """I-3: the notes stamp reads what those writes change, so the cached card follows them."""
    a = add_n(conn, UID)
    b = add_n(conn, UID)
    assert run_out(raw())["count"] == 2
    j2_notes.delete_note(UID, a, conn=conn)
    conn.commit()
    assert run_out(raw())["count"] == 1                                # trashed
    j2_notes.restore_note(UID, a, conn=conn)
    conn.commit()
    assert run_out(raw())["count"] == 2                                # restored
    j2_notes.set_note_archived(UID, b, True, conn=conn)
    conn.commit()
    assert run_out(raw())["count"] == 1                                # archived
    j2_notes.set_note_archived(UID, b, False, conn=conn)
    conn.commit()
    assert run_out(raw())["count"] == 2                                # unarchived
    pid = add_prop(conn, UID)
    conn.execute("UPDATE j2_notes SET properties_json = ? WHERE id = ?",
                 (json.dumps({pid: 5}), a))
    conn.commit()
    flt = raw(filters=[{"field": "property", "op": "gte", "values": [1], "prop": pid}])
    assert run_out(flt)["count"] == 1 and not run_out(flt)["notice"]
    note_properties.delete_property_def(UID, pid, conn=conn)
    after = run_out(flt)
    assert after["count"] == 2 and after["notice"] == sources.S_PROP_GONE


def test_narrow_asks_the_cards_check():
    """10.6 re-review N-1: a "last N trades" card cut from a covering scan writes its formula filter
    over the rows with the card's own `check` (the run's budget). Dropping it goes red."""
    rows = [{"_tid": f"t{i}", "id": f"{i:07d}", "day": f"2026-{1 + i % 9:02d}-{1 + i % 27:02d}",
             "net": float(i % 7 - 3), "flagged": False} for i in range(600)]
    rows.sort(key=lambda r: r["day"], reverse=True)
    base = sources.Scan("closed_trades", rows, False, rows[-1]["day"], len(rows), None)
    p = plan.validate_plan({"v": 1, "source": "closed_trades", "measures": [{"key": "trades"}],
                            "range": {"token": "last_20_trades"},
                            "formulas": [{"id": "f1", "name": "Green", "expr": "[net] > 0"}],
                            "filters": [{"field": "formula:f1", "op": "is", "values": [True]}]},
                           sources.CATALOG)
    rng = plan.resolve_range(p["range"], RUN_TODAY)
    asked = []
    out = wrun._narrow("closed_trades", base, p, rng, lambda: asked.append(1))
    assert len(asked) >= 600 // 256, len(asked)
    assert out.count == 20 + sum(1 for r in out.rows if r.get("flagged"))
    assert all(r["net"] > 0 for r in out.rows)


def test_a_goal_progress_view_with_no_number_target_is_allowed():
    """10.5's handoff, part 2 (landed in 10.6): `view_allowed` takes a goal target as a target."""
    goal = {"v": 1, "source": "closed_trades", "measures": [{"key": "net_pnl"}],
            "range": {"token": "this_week"}, "view": {"type": "progress"},
            "display": {"targetGoal": True}}
    assert sources.CATALOG.view_allowed(plan.validate_plan(goal, sources.CATALOG)) is None
    bare = {**goal, "display": {}}
    with pytest.raises(plan.PlanError) as e:
        plan.validate_plan(bare, sources.CATALOG)
    assert e.value.sentence == sources.S_VIEW_PROGRESS


def test_an_unfit_property_filter_is_one_notice_and_no_narrowing(conn):
    txt = add_prop(conn, UID, "Why", "text")
    add_n(conn, UID, props={txt: "breakout"})
    add_n(conn, UID)
    out = run_out(raw(filters=[{"field": "property", "op": "gte", "values": [3], "prop": txt}]))
    assert out["count"] == 2 and out["notice"] == sources.S_PROP_FILTER_UNFIT
    assert sources.S_PROP_FILTER_UNFIT == (
        "That filter can't be used with this property; it is not used in this widget.")
    ok = run_out(raw(filters=[{"field": "property", "op": "contains", "values": ["break"],
                               "prop": txt}]))
    assert ok["count"] == 1 and not ok["notice"]


def test_hostile_property_text_is_bound_never_spliced(conn):
    """The fuzz corpus through a REAL text property: the value reaches SQL only as a bound
    parameter of `property_filter_sql`'s fragment, and the note that holds the text is found."""
    from tests.test_widget_engine_fuzz import CORPUS, _outside_literals
    txt = add_prop(conn, UID, "Why", "text")
    for value in CORPUS:
        add_n(conn, UID, props={txt: value}, commit=False)
    conn.commit()
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        for value in CORPUS:
            f = [{"field": "property", "op": "eq", "values": [value], "prop": txt}]
            _p, sc, _res = scan_eval(conn, raw(filters=f))
            assert len(sc.rows) == 1, value
    finally:
        conn.set_trace_callback(None)
    assert any("json_extract(properties_json" in s for s in seen), "control: the fragment ran"
    for s in seen:
        bare = _outside_literals(s)
        for value in CORPUS:
            assert value not in bare, (value, s[:200])


def test_select_checkbox_and_date_properties_filter_through_the_authority(conn):
    status = note_properties.create_property_def(
        UID, "Status", "select", [{"id": "active", "label": "Active"},
                                  {"id": "closed", "label": "Closed"}], conn=conn)["id"]
    done = add_prop(conn, UID, "Done", "checkbox")
    review = add_prop(conn, UID, "Review", "date")
    add_n(conn, UID, props={status: "active", done: True, review: "2026-11-02"})
    add_n(conn, UID, props={status: "closed", done: False, review: "2026-10-01"})
    add_n(conn, UID)
    cases = (
        ({"field": "property", "op": "eq", "values": ["active"], "prop": status},
         [{"propertyId": status, "op": "eq", "value": "active"}]),
        ({"field": "property", "op": "is", "values": [True], "prop": done},
         [{"propertyId": done, "op": "eq", "value": True}]),
        ({"field": "property", "op": "gte", "values": ["2026-10-15"], "prop": review},
         [{"propertyId": review, "op": "gte", "value": "2026-10-15"}]),
    )
    for f, cond in cases:
        res = scan_eval(conn, raw(filters=[f]))[2]
        assert res.count == 1 == j2_notes.count_notes(UID, property_filter=cond,
                                                      exclude_sample=True, conn=conn), f
    setups = note_properties.create_property_def(
        UID, "Setups", "multi_select", [{"id": "flag", "label": "Flag"},
                                        {"id": "base", "label": "Base"}], conn=conn)["id"]
    add_n(conn, UID, props={setups: ["flag", "base"]})
    add_n(conn, UID, props={setups: ["base"]})
    out = run_out(raw(filters=[{"field": "property", "op": "eq", "values": ["flag"],
                                "prop": setups}]))
    assert out["count"] == 1 and not out["notice"]
    assert out["count"] == j2_notes.count_notes(
        UID, property_filter=[{"propertyId": setups, "op": "contains", "value": "flag"}],
        exclude_sample=True, conn=conn)
    # every op the plan offers maps onto the authority's own operators
    for op in sources.PROPERTY_OPS:
        vals = [1, 2] if op == "between" else [True] if op == "is" else [1]
        for c in sources.property_conditions(status, op, vals):
            assert c["op"] in note_properties._VALID_OPS, op
    assert set(sources.NOTES.fields["property"].ops) == set(sources.PROPERTY_OPS)


# -- W10-R62: the kind field is offered only while note kinds are ---------------------------------

def _catalog_fields(monkeypatch, on: bool) -> list[str]:
    import api.routers.notebook_widget_definitions as wdr
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1" if on else "0")
    notes = next(s for s in wdr._static_vocabulary(True, True)["sources"] if s["key"] == "notes")
    return [f["key"] for f in notes["fields"]]


@pytest.mark.parametrize("on", [False, True])
def test_kind_is_offered_only_while_note_kinds_are(conn, monkeypatch, on):
    """Off: no kind in the catalog, `?field=kind` is refused, and a plan that filters, splits or
    has a formula read by kind is the plain unknown-field sentence (never a 500). On: all three."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import api.routers.notebook_widget_definitions as wdr
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    # the predicate is note_kinds' own reader, asked of the kind property
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1" if on else "0")
    assert sources.note_kinds_offered() is on
    assert sources.field_offered("notes", "kind") is on
    assert sources.field_offered("notes", "folder") is True        # control: ungated fields stay
    fields = _catalog_fields(monkeypatch, on)
    assert ("kind" in fields) is on and "folder" in fields
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W8_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W10_ENABLED", "1")
    user = {"id": UID, "email": "p@example.test", "role": "member", "plan": "pro"}
    app = FastAPI()
    app.include_router(wdr.router)
    app.dependency_overrides[get_current_user] = lambda: dict(user)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/api/j2/widget-definitions/vocabulary", params={"field": "kind"})
    if on:
        assert r.status_code == 200 and {"id": "thesis", "name": "Thesis"} in r.json()["values"]
    else:
        assert r.status_code == 400 and r.json()["detail"]["message"] == wdr.S_VOCAB_FIELD
    assert c.get("/api/j2/widget-definitions/vocabulary",
                 params={"field": "folder"}).status_code == 200            # control
    shapes = [raw(split={"by": "kind"}, view={"type": "bar"}),
              raw(filters=[{"field": "kind", "op": "in", "values": ["thesis"]}]),
              raw(formulas=[{"id": "f1", "name": "K", "expr": '[kind] = "thesis"'}],
                  filters=[{"field": "formula:f1", "op": "is", "values": [True]}])]
    for r_ in shapes:
        if on:
            assert plan.validate_plan(r_, sources.CATALOG)["source"] == "notes"
        else:
            with pytest.raises(plan.PlanError) as e:
                plan.validate_plan(r_, sources.CATALOG)
            assert e.value.sentence == plan.S_UNKNOWN_FIELD
        out = c.post("/api/j2/widget-definitions/preview", json={"plan": r_})
        assert out.status_code == (200 if on else 400), out.text
        if not on:
            assert out.json()["detail"]["message"] == plan.S_UNKNOWN_FIELD
    # control: a notes plan that never names kind is unaffected either way
    assert plan.validate_plan(raw(split={"by": "folder"}, view={"type": "bar"}),
                              sources.CATALOG)["source"] == "notes"


# -- W10-R66: what a property filter and a property sum offer, served from ONE table ------------

def test_property_filter_types_build_through_the_one_authority(conn):
    """Every (type, op) the builder is served (`sources.PROPERTY_FILTER_TYPES`) is one of the plan's
    property ops AND builds a real predicate through `note_properties.property_filter_sql` for a
    property of that type; a type the authority cannot filter (a relation) is not in the table."""
    sample = {"number": 3, "date": "2026-10-20", "checkbox": True, "text": "x", "url": "x",
              "select": None, "multi_select": None}
    assert set(sources.PROPERTY_FILTER_TYPES) <= set(note_properties._VALID_TYPES)
    assert "relation" not in sources.PROPERTY_FILTER_TYPES
    for type_, d in sources.PROPERTY_FILTER_TYPES.items():
        assert d["ops"] and set(d["ops"]) <= set(sources.PROPERTY_OPS), type_
        assert d["valueType"] in {"number", "day", "bool", "text", "enum"} and d["label"], type_
        opts = [{"label": "A"}] if type_ in ("select", "multi_select") else None
        pdef = note_properties.create_property_def(UID, f"P {type_}", type_, options=opts, conn=conn)
        value = pdef["options"][0]["id"] if opts else sample[type_]
        for op in d["ops"]:
            values = [value, value] if op == "between" else [value]
            conds = sources.property_conditions(pdef["id"], op, values, type_)
            sql, params = note_properties.property_filter_sql(UID, conds, conn, strict=True)
            assert sql and params, (type_, op)


def test_property_sum_types_are_the_ones_summed(conn):
    """`PROP_SUM_TYPES` is what `_summed_properties` accepts: a number property is summed, any
    other type is the not-a-number notice."""
    assert sources.PROP_SUM_TYPES == ("number",)
    num = add_prop(conn, UID, "Risk", "number")
    txt = add_prop(conn, UID, "Why", "text")
    for prop, summed in ((num, True), (txt, False)):
        notices: list[str] = []
        got = sources._summed_properties(conn, UID, {"measures": [{"key": "property_sum", "prop": prop}]},
                                         notices)
        assert (got == [prop]) is summed
        assert (sources.S_PROP_NOT_NUMBER in notices) is (not summed)


def test_a_comparison_outside_the_served_table_does_not_run(conn):
    """Fix 2 (W10-R66, the engine half): a hand-made plan asking a property a comparison the served
    table does not offer for its type is dropped with the unfit notice and never narrows, even where
    the lower authority would build it ("contains" on a date is a LIKE over the stored text); the
    same plan with a served comparison does narrow."""
    pid = add_prop(conn, UID, "Review date", "date")
    assert "contains" in sources.PROPERTY_OPS
    assert "contains" not in sources.PROPERTY_FILTER_TYPES["date"]["ops"]
    # the lower authority WOULD answer it: the guard is the served table, not a refusal below
    sql, _ = note_properties.property_filter_sql(
        UID, sources.property_conditions(pid, "contains", ["2026-10"], "date"), conn, strict=True)
    assert "LIKE" in sql
    add_n(conn, UID, props={pid: "2026-10-20"})
    add_n(conn, UID, props={pid: "2026-09-01"})
    add_n(conn, UID)
    bad = run_out(raw(filters=[{"field": "property", "op": "contains", "values": ["2026-10"], "prop": pid}]))
    assert bad["count"] == 3 and bad["notice"] == sources.S_PROP_FILTER_UNFIT
    good = run_out(raw(filters=[{"field": "property", "op": "gte", "values": ["2026-10-01"], "prop": pid}]))
    assert good["count"] == 1 and not good["notice"]
