"""Notebook widgets wave 11, Task 11.9 (ruling W11-R12): preview with my data.

`template_preview.preview_mine` shows a listed template, widget, routine or tracker over the VIEWER's own data:
each "pick yours" choice at the viewer's answer, else their suggested value, else Any where allowed; at most
`run.MAX_EXAMPLES` widget cards through the examples lane; Sample data (labelled) under 5 trades; routine and
tracker slots as names, items and kinds, never day state; a server-built credit (W11-R24); cached 300 s per
(item, version, viewer, ET day, answers)."""
from __future__ import annotations

import copy
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import gallery_suggest
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import template_preview as tp
from api.services.journal_two.widget_engine import run
from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as S
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    NOW as NOW_ISO, UID, add_account, add_trade, add_user, conn,
)

NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)      # Sat 2026-10-24 ET
B = "u-preview-b"
SETUP_PLAN = {"v": 1, "source": "closed_trades",
              "filters": [{"field": "setup", "op": "in", "values": ["Author's own setup"]}],
              "measures": [{"key": "trades"}], "range": {"token": "all"}}
ALL_WAVES = (1, 2, 3, 4, 5, 6, 8, 9, 10, 11)


@pytest.fixture(autouse=True)
def _on(monkeypatch):
    for w in range(1, 13):
        if w in ALL_WAVES:
            monkeypatch.setenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", "1")
        else:
            monkeypatch.delenv(f"NOTEBOOK_WIDGETS_W{w}_ENABLED", raising=False)
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-preview-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    run._reset_state()
    tp._CACHE.clear()
    yield
    run._reset_state()
    tp._CACHE.clear()


def _shared(plan=SETUP_PLAN, *, any_ok=None):
    out = share.share_plan(copy.deepcopy(plan), catalog=S.CATALOG)
    slots = [dict(s) for s in out.slots]
    if any_ok is not None:
        for s in slots:
            s["any"] = any_ok
    return out.payload["plan"], slots


def _template(n_widgets=1, *, any_ok=None, tools=False, extra_blocks=()):
    plan, slots = _shared(any_ok=any_ok)
    keys = "abcdefghijklmnop"
    blocks = [{"block": f"built_{keys[i]}", "enabled": True, "settings": {"ref": f"inline:d{i + 1}"}}
              for i in range(n_widgets)]
    defs = [{"key": f"d{i + 1}", "plan": plan, "name": f"Win rate {i + 1}", "description": ""}
            for i in range(n_widgets)]
    payload = {"format": 2, "name": "Setup study", "description": "", "blocks": blocks + list(extra_blocks),
               "definitions": defs, "routines": [], "trackers": [], "slots": slots}
    if tools:
        payload["blocks"] += [
            {"block": "routine_a", "enabled": True,
             "settings": {"inline": "r1", "bind": "next-trading-day", "display": "items"}},
            {"block": "tracker_a", "enabled": True,
             "settings": {"inline": "t1", "bind": "week", "display": "chart"}},
            {"block": "tracker_b", "enabled": True,
             "settings": {"ref": "checkin:mood", "bind": "note-day", "display": "chart"}},
        ]
        payload["routines"] = [{"key": "r1", "name": "Pre-market routine",
                                "items": [{"text": "Check news", "negative": False},
                                          {"text": "Mark levels", "negative": False}],
                                "schedule": {"kind": "every"}, "settings": {"done_share": 1.0}}]
        payload["trackers"] = [{"key": "t1", "name": "Sleep", "kind": "duration", "unit": None, "days": "any"}]
    return payload


def _row(c, payload, *, item_type="style", user_id=B, kind="member", status="approved", title="Setup study",
         version=1, handle="hdl-b"):
    gid = uuid.uuid4().hex
    c.execute("INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json,"
              " status, listed_at, created_at, updated_at, preview_json, item_type, payload_json, version)"
              " VALUES (?, ?, ?, ?, '', 'review', '{}', ?, ?, ?, ?, '[]', ?, ?, ?)",
              (gid, user_id, kind, title, status, NOW_ISO, NOW_ISO, NOW_ISO, item_type, json.dumps(payload),
               version))
    if user_id and handle:
        c.execute("INSERT OR IGNORE INTO j2_gallery_authors (user_id, handle, created_at) VALUES (?, ?, ?)",
                  (user_id, handle, NOW_ISO))
    c.commit()
    return gid


def _trades(c, n, setup="Flag"):
    for i in range(n):
        add_trade(c, UID, day=f"2026-10-{10 + i:02d}", setup=setup, pnl=100.0 + i)


def _spy_batch(monkeypatch):
    calls = []
    real = run.run_plans_batch

    def spy(user_id, cards, **kw):
        calls.append((user_id, [k for k, _p in cards]))
        return real(user_id, cards, **kw)
    monkeypatch.setattr(run, "run_plans_batch", spy)
    return calls


def _go(c, gid, **kw):
    kw.setdefault("now", NOW)
    return tp.preview_mine(UID, gid, conn=c, **kw)


def test_preview_runs_at_most_8_cards_through_example_lane(conn, monkeypatch):
    add_user(conn, B)
    _trades(conn, 6)
    gid = _row(conn, _template(9))
    calls = _spy_batch(monkeypatch)
    lanes = []
    real_admit = run.admit

    def admit(uid, lane):
        lanes.append((uid, lane))
        return real_admit(uid, lane)
    monkeypatch.setattr(run, "admit", admit)
    gen_before = run._preview_gen_now(UID)

    out = _go(conn, gid)

    assert calls == [(UID, [f"c{i}" for i in range(run.MAX_EXAMPLES)])]       # ONE batch of at most 8
    assert lanes == [(UID, "example")]                                          # one admission, the examples lane
    assert run._preview_gen_now(UID) == gen_before                            # never supersedes a builder preview
    assert len(out["cards"]) == 9
    ran = [c for c in out["cards"] if "payload" in c]
    assert len(ran) == run.MAX_EXAMPLES
    assert out["cards"][8] == {"slot": "built_i", "title": "Win rate 9", "sentence": tp.S_NOT_PREVIEWED,
                               "sample": False}
    assert all(c["sample"] is False and c["payload"]["sample"] is False for c in ran)
    # the setup choice ran at the member's own suggestion: their 6 Flag trades, never the author's value
    assert out["slots"] == [{"id": "p1", "type": "setup", "label": "Setup", "any": True,
                             "suggested": {"value": "Flag", "label": "Flag"}, "value": "Flag"}]
    assert ran[0]["payload"]["count"] == 6
    assert "Author's own setup" not in json.dumps(out)


def test_fewer_than_5_trades_gets_sample_cards_labelled(conn):
    add_user(conn, B)
    _trades(conn, 3)
    out = _go(conn, _row(conn, _template(2)))
    assert [c["sample"] for c in out["cards"]] == [True, True]
    assert all(c["payload"]["sample"] is True for c in out["cards"])
    # five trades turn them real at once (the batch cache is keyed on the sample switch and the data stamp)
    _trades(conn, 2, setup="Flag")
    tp._CACHE.clear()
    out = _go(conn, _row(conn, _template(1)))
    assert out["cards"][0]["sample"] is False and out["cards"][0]["payload"]["count"] == 5


def test_any_false_slot_without_value_is_a_sentence_not_a_run(conn, monkeypatch):
    add_user(conn, B)                                   # a thin account: no trades, no setups, no routines
    calls = _spy_batch(monkeypatch)
    gid = _row(conn, _template(1, any_ok=False))
    out = _go(conn, gid)
    assert out["slots"][0]["suggested"] is None and out["slots"][0]["any"] is False
    assert out["slots"][0]["value"] is None
    assert out["cards"] == [{"slot": "built_a", "title": "Win rate 1",
                             "sentence": "Pick a setup to see this widget.", "sample": False}]
    assert calls == []                                   # not run: no batch, no zero
    # Any where it is allowed runs (the filter dropped); the member's own answer runs too
    tp._CACHE.clear()
    out = _go(conn, _row(conn, _template(1, any_ok=True)))
    assert out["slots"][0]["value"] == {"any": True} and "payload" in out["cards"][0]
    out = _go(conn, gid, answers={"p1": "Breakout"})
    assert out["slots"][0]["value"] == "Breakout" and "payload" in out["cards"][0]
    # an answer that cannot fill the choice is refused in the reducer's words, naming the choice (W11-R24)
    with pytest.raises(share.ShareError) as e:
        _go(conn, gid, answers={"p1": {"any": True}})
    assert e.value.sentence == share.S_NO_ANY.format(label="Setup") and e.value.slot == "p1"


def test_routine_slots_preview_items_without_day_state(conn, monkeypatch):
    add_user(conn, B)
    # the member HAS day state; none of it may be read
    rid = str(uuid.uuid4())
    conn.execute("INSERT INTO j2_routines (id, user_id, name, items_json, settings_json, created_at, updated_at)"
                 " VALUES (?, ?, 'Mine', '[]', '{}', ?, ?)", (rid, UID, NOW_ISO, NOW_ISO))
    conn.execute("INSERT INTO j2_routine_ticks (user_id, routine_id, day, item_id, ticked, updated_at)"
                 " VALUES (?, ?, '2026-10-23', 'i', 1, ?)", (UID, rid, NOW_ISO))
    conn.commit()
    payload = _template(0, tools=True)
    payload["slots"] = []
    gid = _row(conn, payload)
    seen: list[str] = []
    real_conn = auth_db.get_connection

    def traced():
        c = real_conn()
        c.set_trace_callback(seen.append)
        return c
    monkeypatch.setattr(auth_db, "get_connection", traced)
    conn.set_trace_callback(seen.append)
    try:
        out = _go(conn, gid)
    finally:
        conn.set_trace_callback(None)
    assert seen, "the trace saw nothing: the probe is not on the path"           # non-vacuity
    day_state = [s for s in seen if any(t in s for t in ("j2_routine_ticks", "j2_routine_days",
                                                          "j2_tracker_values", "j2_note_checkins"))]
    assert day_state == []
    assert out["cards"] == []
    assert out["tools"] == [
        {"slot": "routine_a", "kind": "routine", "name": "Pre-market routine",
         "items": [{"text": "Check news"}, {"text": "Mark levels"}], "bind": "next-trading-day",
         "forDayLabel": "For Mon Oct 26"},
        {"slot": "tracker_a", "kind": "tracker", "name": "Sleep", "trackerKind": "duration", "bind": "week",
         "forDayLabel": "For the week of Oct 19"},
        {"slot": "tracker_b", "kind": "tracker", "name": "Check-in mood", "trackerKind": "scale",
         "bind": "note-day", "forDayLabel": "For Sat Oct 24"},
    ]
    # a member's own routine ref is read only for the author; anyone else gets the slot's sentence
    own = {"format": 2, "name": "T", "definitions": [], "routines": [], "trackers": [], "slots": [], "blocks": [
        {"block": "routine_a", "enabled": True, "settings": {"ref": f"routine:{rid}"}}]}
    tp._CACHE.clear()
    mine = _row(conn, own, user_id=UID, handle="hdl-a")
    seen.clear()
    conn.set_trace_callback(seen.append)
    try:
        assert _go(conn, mine)["tools"][0]["name"] == "Mine"
    finally:
        conn.set_trace_callback(None)
    assert any("j2_routines" in q for q in seen)                                 # the owned read happened ...
    assert not any(t in q for q in seen for t in ("j2_routine_ticks", "j2_routine_days"))   # ... and no day state
    assert tp.preview_mine(B, mine, conn=conn, now=NOW)["tools"][0]["name"] == "This routine is not in your account."
    # routine and tracker slots are hidden with wave 9 (one rule: journal_styles._slot_wave_off)
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED")
    tp._CACHE.clear()
    assert _go(conn, gid)["tools"] == []


def test_cache_key_includes_answers_and_et_day(conn, monkeypatch):
    k = tp.cache_key("g1", 1, UID, "2026-10-24", {"p1": "Flag"})
    assert k != tp.cache_key("g1", 1, UID, "2026-10-24", {"p1": "Base"})
    assert k != tp.cache_key("g1", 1, UID, "2026-10-25", {"p1": "Flag"})
    assert k != tp.cache_key("g1", 2, UID, "2026-10-24", {"p1": "Flag"})
    assert k != tp.cache_key("g1", 1, B, "2026-10-24", {"p1": "Flag"})
    assert k != tp.cache_key("g2", 1, UID, "2026-10-24", {"p1": "Flag"})
    assert k == tp.cache_key("g1", 1, UID, "2026-10-24", {"p1": "Flag"})
    assert tp.cache_key("g", 1, UID, "d", {"a": 1, "b": 2}) == tp.cache_key("g", 1, UID, "d", {"b": 2, "a": 1})
    assert tp.CACHE_TTL_S == 300 and tp._CACHE.max_size == 500
    add_user(conn, B)
    _trades(conn, 6)
    gid = _row(conn, _template(1))
    calls = _spy_batch(monkeypatch)
    _go(conn, gid)
    _go(conn, gid, answers={"p1": "Base"})                                     # new answers: computed again
    _go(conn, gid, now=NOW + timedelta(days=1))                                # a new ET day: computed again
    _go(conn, gid, now=NOW + timedelta(hours=2))                               # same ET day, same answers: cached
    assert len(calls) == 3


def test_cache_hit_runs_nothing(conn, monkeypatch):
    add_user(conn, B)
    _trades(conn, 6)
    gid = _row(conn, _template(2, tools=True))
    first = _go(conn, gid)
    calls = _spy_batch(monkeypatch)
    suggests = []
    monkeypatch.setattr(gallery_suggest, "suggest", lambda *a, **k: suggests.append(a) or {})
    seen: list[str] = []
    conn.set_trace_callback(seen.append)
    try:
        second = _go(conn, gid)
    finally:
        conn.set_trace_callback(None)
    assert second == first
    assert calls == [] and suggests == []
    assert not any("j2_trades" in s or "j2_notes" in s for s in seen)         # only the visibility read
    second["cards"][0]["title"] = "mutated"
    assert _go(conn, gid)["cards"][0]["title"] == first["cards"][0]["title"]   # a copy, never the cached object


def test_not_visible_item_is_none(conn, monkeypatch):
    add_user(conn, B)
    assert _go(conn, "no-such-item") is None
    assert _go(conn, "") is None
    pending = _row(conn, _template(1), status="pending")
    assert _go(conn, pending) is None                                           # another member's pending item
    assert tp.preview_mine(B, pending, conn=conn, now=NOW) is not None          # its author may preview it
    hidden = _row(conn, _template(1))
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (hidden,))
    conn.commit()
    assert _go(conn, hidden) is None
    outline = _row(conn, {}, item_type="outline")
    assert _go(conn, outline) is None                                           # not a previewable item type
    tool = _row(conn, {"name": "Sleep", "kind": "duration", "unit": None, "days": "any"}, item_type="tracker")
    assert _go(conn, tool)["tools"][0]["trackerKind"] == "duration"
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W11_ENABLED", "0")                     # wave 11 off: the tool type is absent
    tp._CACHE.clear()
    assert _go(conn, tool) is None
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W11_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")                   # the library off: every style absent
    tp._CACHE.clear()
    assert _go(conn, _row(conn, _template(1))) is None


def test_foreign_def_ref_in_member_template_is_a_sentence(conn, monkeypatch):
    from api.services.journal_two import widget_definitions as wd
    add_user(conn, B)
    _trades(conn, 6)
    b_def = wd.create(B, "B's widget", copy.deepcopy({**SETUP_PLAN, "filters": []}), now=NOW, conn=conn)
    payload = {"format": 2, "name": "T", "blocks": [
        {"block": "built_a", "enabled": True, "settings": {"ref": f"def:{b_def['id']}", "defRev": 1}}],
        "definitions": [], "routines": [], "trackers": [], "slots": []}
    gid = _row(conn, payload)
    reads = []
    for name in ("get", "resolve_for_run"):
        real = getattr(wd, name)
        monkeypatch.setattr(wd, name, lambda *a, _r=real, _n=name, **k: reads.append((_n, a)) or _r(*a, **k))
    out = _go(conn, gid)
    assert out["cards"] == [{"slot": "built_a", "title": "Widget",
                             "sentence": "This widget is not in your account.", "sample": False}]
    assert reads == []                                                          # nothing of B's was read
    # the template's own author previewing it reads their own definition (an owned read) and runs it
    out = tp.preview_mine(B, gid, conn=conn, now=NOW)
    assert out["cards"][0]["title"] == "B's widget" and "payload" in out["cards"][0]
    assert reads and all(a[0] == B for _n, a in reads)


def test_credit_is_built_by_the_server(conn):
    add_user(conn, B)
    member = _row(conn, _template(1), title="Gap fill")
    assert _go(conn, member)["credit"] == "Based on x's Gap fill"               # the author's display label
    official = _row(conn, _template(1), user_id=None, kind="official", title="Pre-market prep")
    assert _go(conn, official)["credit"] == "Based on UCT's Pre-market prep"
    gone = _row(conn, _template(1), title="Old base")
    conn.execute("DELETE FROM j2_gallery_authors WHERE user_id = ?", (B,))
    conn.commit()
    tp._CACHE.clear()
    assert _go(conn, gone)["credit"] == "Based on a former member's Old base"
    assert tp.preview_mine(B, member, conn=conn, now=NOW)["credit"] is None    # the viewer's own item
