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


# -- fix round 1 (review I-1, I-2, I-3, M-4, M-5; rulings W11-R27, W11-R20) ---------------------------

def _book_setups():
    return tp._book_values({"type": "setup", "source": "closed_trades", "field": "setup"})


def test_sample_mode_never_filters_the_book_with_a_real_value(conn):
    """W11-R27 (review I-1): 3 trades on a setup the Sample data book does not hold. The card is the book's,
    labelled, with the book's own numbers: never a real value over the book, never an empty card."""
    add_user(conn, B)
    _trades(conn, 3, setup="MyRealSetup")
    gid = _row(conn, _template(1))
    book_top = _book_setups()[0]
    assert "MyRealSetup" not in _book_setups()
    for answers in (None, {"p1": "MyRealSetup"}):
        tp._CACHE.clear()
        out = _go(conn, gid, answers=answers)
        card = out["cards"][0]
        assert card["sample"] is True and card["payload"]["sample"] is True
        assert card["payload"]["count"] > 0                                    # the book's rows, not an empty card
        # W11-R27b: what the sheet sends on Use is ALWAYS the member's own value, never the book's
        assert out["slots"][0]["suggested"] == {"value": "MyRealSetup", "label": "MyRealSetup"}
        assert out["slots"][0]["value"] == "MyRealSetup"
        assert out["slots"][0]["sampleValue"] == book_top                      # the book's, said apart
        assert book_top not in json.dumps({k: v for k, v in out["slots"][0].items() if k != "sampleValue"})
    # an answer the book DOES hold runs as given
    tp._CACHE.clear()
    held = _book_setups()[-1]
    out = _go(conn, gid, answers={"p1": held})
    assert out["slots"][0]["value"] == held and out["cards"][0]["payload"]["count"] > 0
    assert "sampleValue" not in out["slots"][0]
    # five trades: real again, the member's own value
    _trades(conn, 2, setup="MyRealSetup")
    tp._CACHE.clear()
    out = _go(conn, gid)
    assert out["cards"][0]["sample"] is False and out["slots"][0]["value"] == "MyRealSetup"
    assert out["cards"][0]["payload"]["count"] == 5


def _symbol_template():
    plan = {"v": 1, "source": "closed_trades", "measures": [{"key": "trades"}], "range": {"token": "all"},
            "filters": [{"field": "symbol", "op": "contains", "values": ["AA"]}]}
    shared = share.share_plan(plan, catalog=S.CATALOG)
    return {"format": 2, "name": "T", "description": "", "definitions": [
        {"key": "d1", "plan": shared.payload["plan"], "name": "Sym", "description": ""}],
        "blocks": [{"block": "built_a", "enabled": True, "settings": {"ref": "inline:d1"}}],
        "routines": [], "trackers": [], "slots": [dict(s) for s in shared.slots]}


def test_refused_answers_raise_naming_the_choice(conn, monkeypatch):
    """Review I-2: an answer the reducer or the plan refuses is a ShareError with `.slot`, in their own words,
    never a card sentence and never the builder's save wording."""
    add_user(conn, B)
    mine = add_account(conn, UID, "Mine")
    _trades(conn, 6)
    acc_plan = {**SETUP_PLAN, "filters": [], "accounts": {"id": mine}}
    shared = share.share_plan(copy.deepcopy(acc_plan), catalog=S.CATALOG)
    acc_gid = _row(conn, {"format": 2, "name": "T", "definitions": [
        {"key": "d1", "plan": shared.payload["plan"], "name": "A", "description": ""}], "routines": [],
        "trackers": [], "blocks": [{"block": "built_a", "enabled": True, "settings": {"ref": "inline:d1"}}],
        "slots": [dict(s) for s in shared.slots]})
    sid = shared.slots[0]["id"]
    resolves = []
    real_resolve = share.resolve_plan
    monkeypatch.setattr(share, "resolve_plan", lambda *a, **k: resolves.append(1) or real_resolve(*a, **k))
    with pytest.raises(share.ShareError) as e:
        _go(conn, acc_gid, answers={sid: [mine]})                         # one account, never a list
    assert e.value.slot == sid and e.value.sentence == share.S_NEED_VALUE.format(label="Account")
    assert resolves == []                                                 # refused BEFORE resolving
    gid = _row(conn, _template(1))
    for big in ("x" * 100_000, "x" * 201):
        with pytest.raises(share.ShareError) as e:
            _go(conn, gid, answers={"p1": big})                           # oversized: refused before resolving
        assert e.value.slot == "p1" and e.value.sentence == "Text can be at most 200 characters."
    assert resolves == []
    with pytest.raises(share.ShareError) as e:
        _go(conn, gid, answers={"p1": ["Flag"] * 51})
    assert e.value.slot == "p1" and e.value.sentence == "A filter can hold up to 50 values."
    with pytest.raises(share.ShareError) as e:
        _go(conn, gid, answers={"p1": {"any": True, "x": 1}})
    assert e.value.slot == "p1"
    # a refusal only `resolve_plan` makes (a contains filter takes one value) is traced to its choice
    sym = _row(conn, _symbol_template())
    with pytest.raises(share.ShareError) as e:
        _go(conn, sym, answers={"p1": ["AA", "BB"]})
    assert e.value.slot == "p1" and e.value.sentence == "This filter takes exactly one value."
    assert len(tp._CACHE) == 0                                                # nothing refused was cached


def test_answers_are_trimmed_to_declared_choices_before_keying(conn, monkeypatch):
    """Review I-3: undeclared ids neither key the cache nor are echoed; one member's junk evicts nobody."""
    add_user(conn, B)
    _trades(conn, 6)
    other = _row(conn, _template(1))
    tp.preview_mine(B, other, conn=conn, now=NOW)                             # another viewer's entry
    gid = _row(conn, _template(1))
    calls = []
    real = tp.gallery_suggest.suggest_for
    monkeypatch.setattr(tp.gallery_suggest, "suggest_for", lambda *a, **k: calls.append(1) or real(*a, **k))
    for i in range(600):
        out = tp.preview_mine(UID, gid, conn=conn, now=NOW, answers={"junk": i, f"p{i + 9}": "x"})
    assert len(tp._CACHE) == 2 and len(calls) == 1                            # one key; the other viewer kept
    assert "junk" not in json.dumps(out) and [s["id"] for s in out["slots"]] == ["p1"]
    with pytest.raises(share.ShareError):
        tp.preview_mine(UID, gid, conn=conn, now=NOW, answers={"p1": "y" * 5000})
    assert len(tp._CACHE) == 2                                                # refused, not cached
    # the 16 KB total has its own sentence, at the largest answer's choice
    many = [dict(s, id=f"p{i}") for i, s in enumerate([{"type": "setup", "any": True}] * 20, start=1)]
    big = {f"p{i}": ["v" * 200] * 5 for i in range(1, 20)}
    big["p20"] = ["w" * 200] * 6
    with pytest.raises(share.ShareError) as e:
        tp.clean_answers(many, big)
    assert e.value.sentence == "Your answers are too long. Shorten one and try again." and e.value.slot == "p20"
    assert tp.clean_answers([{"id": "p1", "type": "setup", "any": True}],
                            {"p1": "Flag", "zz": 1}) == {"p1": "Flag"}


def test_undeclared_pick_id_is_refused_with_its_slot(conn):
    add_user(conn, B)
    payload = _template(1)
    payload["slots"] = []                                                      # the plan names p1; nothing declares it
    with pytest.raises(share.ShareError) as e:
        _go(conn, _row(conn, payload))
    assert e.value.code == "unresolved" and e.value.slot == "p1" and e.value.sentence == share.S_UNRESOLVED


def test_dark_wave_widget_hidden_by_the_one_decider(conn, monkeypatch):
    """W11-R20: a widget whose plan needs a dark wave is hidden in the preview exactly as in the served style:
    `journal_styles._slot_wave_off(block, settings, ctx)` decides, for a template slot and a listed widget."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two.widget_engine import shelf
    add_user(conn, B)
    _trades(conn, 6)
    w10_plan = shelf.revision("shelf:equity-curve", 2)["plan"]
    payload = _template(1)
    payload["definitions"].append({"key": "d9", "plan": w10_plan, "name": "Curve", "description": ""})
    payload["blocks"].append({"block": "built_b", "enabled": True, "settings": {"ref": "inline:d9"}})
    gid = _row(conn, payload)
    widget = _row(conn, {"name": "Curve", "description": "", "plan": w10_plan, "slots": []},
                  item_type="widget_definition")
    assert {c["slot"] for c in _go(conn, gid)["cards"]} == {"built_a", "built_b"}
    assert _go(conn, widget)["cards"][0]["slot"] == "widget"
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W10_ENABLED")
    tp._CACHE.clear()
    assert [c["slot"] for c in _go(conn, gid)["cards"]] == ["built_a"]
    assert _go(conn, widget)["cards"] == []
    ctx = js._slot_ctx(None, conn, payload["blocks"], {d["key"]: d for d in payload["definitions"]})
    assert js._slot_wave_off("built_b", {"ref": "inline:d9"}, ctx) is True          # the decider agrees
    assert js._slot_wave_off("built_a", {"ref": "inline:d1"}, ctx) is False
    seen = []
    real = js._slot_wave_off
    monkeypatch.setattr(js, "_slot_wave_off", lambda *a: seen.append(a) or real(*a))
    tp._CACHE.clear()
    _go(conn, gid)
    _go(conn, widget)
    assert {a[0] for a in seen} >= {"built_a", "built_b"} and all(len(a) == 3 for a in seen)


def test_anonymous_author_credit_reads_mid_sentence(conn):
    add_user(conn, B)
    conn.execute("UPDATE users SET display_name = 'b@example.test' WHERE id = ?", (B,))
    conn.commit()
    assert _go(conn, _row(conn, _template(1), title="Gap fill"))["credit"] == "Based on a UCT member's Gap fill"


def test_use_answer_is_never_a_book_value(conn):
    """W11-R27b: for every choice, under 5 trades or not, `suggested` and an unanswered `value` (what AdoptSheet
    sends on Use) are the member's own value or null, never a value only the Sample data book holds."""
    add_user(conn, B)
    book = set(_book_setups())
    for n, setup in ((0, None), (2, "OwnOne"), (4, "OwnTwo")):
        if n:
            _trades(conn, n, setup=setup)
        tp._CACHE.clear()
        out = _go(conn, _row(conn, _template(1, any_ok=False)))
        slot = out["slots"][0]
        sent = slot["value"] if slot["value"] is not None else (slot["suggested"] or {}).get("value")
        assert sent is None or sent not in book
        assert slot["suggested"] is None or slot["suggested"]["value"] not in book


# -- fix round 3 (re-review m-1, m-2, m-4, m-5) --------------------------------------------------------

def _number_template():
    plan = {"v": 1, "source": "closed_trades", "measures": [{"key": "trades"}], "range": {"token": "all"},
            "filters": [{"field": "net", "op": "gt", "values": [250]}]}
    shared = share.share_plan(plan, catalog=S.CATALOG)
    return {"format": 2, "name": "T", "description": "", "definitions": [
        {"key": "d1", "plan": shared.payload["plan"], "name": "Big", "description": ""}],
        "blocks": [{"block": "built_a", "enabled": True, "settings": {"ref": "inline:d1"}}],
        "routines": [], "trackers": [], "slots": [dict(s) for s in shared.slots]}


def test_crash_inputs_are_refused_with_their_slot(conn, monkeypatch):
    """Re-review m-1: well-formed JSON a route can hand over is REFUSED with the slot, never a crash: a lone
    surrogate in a text answer, and an int too large for a float on a number choice."""
    add_user(conn, B)
    _trades(conn, 6)
    slots = [{"id": "p1", "type": "setup", "any": True, "label": "Setup"}]
    for raw in ('{"p1": "\\ud800"}', '{"p1": ["Flag", "\\udfff"]}'):
        with pytest.raises(share.ShareError) as e:
            tp.clean_answers(slots, json.loads(raw))
        assert e.value.slot == "p1" and e.value.sentence == share.S_BAD_CHARACTER
    gid = _row(conn, _template(1))
    with pytest.raises(share.ShareError) as e:
        _go(conn, gid, answers=json.loads('{"p1": "Fl\\udc00ag"}'))
    assert e.value.slot == "p1" and e.value.sentence == share.S_BAD_CHARACTER
    num = _row(conn, _number_template())
    sid = tp._slots_of(_number_template())[0]["id"]
    resolves = []
    real_resolve = share.resolve_plan
    monkeypatch.setattr(share, "resolve_plan", lambda *a, **k: resolves.append(1) or real_resolve(*a, **k))
    for huge in (10 ** 400, -(10 ** 400)):
        with pytest.raises(share.ShareError) as e:
            _go(conn, num, answers={sid: huge})
        assert e.value.slot == sid and e.value.sentence.startswith("Type a number for")
    assert resolves == []                                                  # refused by the preview's own check
    for fine in (1e308, -1e308, 2 ** 63, 5e-324, -0.0):                     # big but finite: they run
        tp._CACHE.clear()
        assert "cards" in _go(conn, num, answers={sid: fine})
    assert len(tp._CACHE) == 1                                             # nothing refused was cached


def test_refusal_trace_default_uses_the_fields_case_rule(conn):
    """Re-review m-2: the default an answer is reset to when tracing a refusal follows the same case rule
    as the card's run (a symbol is case-insensitive): an own lowercase symbol the book holds stays the
    member's, never swapped for the book's spelling."""
    add_user(conn, B)
    plan = {"v": 1, "source": "closed_trades", "measures": [{"key": "trades"}], "range": {"token": "all"},
            "filters": [{"field": "symbol", "op": "in", "values": ["ZZZ"]}]}
    slots = [dict(s) for s in share.share_plan(plan, catalog=S.CATALOG).slots]
    low = tp._book_values(slots[0])[0].lower()
    for i in range(3):
        add_trade(conn, UID, day=f"2026-10-{10 + i:02d}", symbol=low, pnl=1.0)
    served, used, defaults = tp._choices(slots, {"p1": low}, UID, conn, sample=True)
    assert used["p1"] == low and defaults["p1"] == low and "sampleValue" not in served[0]


def test_standalone_tool_hidden_while_wave_9_is_off(conn, monkeypatch):
    """Re-review m-4: a listed routine or tracker answers as not visible while wave 9 is off, exactly as its
    template slot is hidden: the ONE decider (`journal_styles._slot_wave_off`) is asked."""
    from api.services.journal_two import journal_styles as js
    add_user(conn, B)
    routine = _row(conn, {"name": "Pre", "items": [{"text": "a"}], "schedule": {"kind": "every"}},
                   item_type="routine")
    tracker = _row(conn, {"name": "Sleep", "kind": "duration", "unit": None, "days": "any"},
                   item_type="tracker")
    assert _go(conn, routine)["tools"][0]["name"] == "Pre" and _go(conn, tracker)["tools"]
    monkeypatch.delenv("NOTEBOOK_WIDGETS_W9_ENABLED")
    tp._CACHE.clear()
    seen = []
    real = js._slot_wave_off
    monkeypatch.setattr(js, "_slot_wave_off", lambda *a: seen.append(a[0]) or real(*a))
    assert _go(conn, routine) is None and _go(conn, tracker) is None
    assert seen == ["routine_a", "tracker_a"]
    tpl = _row(conn, _template(0, tools=True))
    assert _go(conn, tpl)["tools"] == []                                     # the template slot agrees


def test_the_sample_decision_is_read_once_and_shared_with_the_batch(conn, monkeypatch):
    """Re-review m-5: one `wants_sample` answer per request decides both the choices and the batch run, so the
    5th trade can never land between the two."""
    add_user(conn, B)
    _trades(conn, 3, setup="MyRealSetup")
    gid = _row(conn, _template(2))
    reads, batch = [], []
    real_ws, real_batch = run.wants_sample, run.run_plans_batch
    monkeypatch.setattr(run, "wants_sample", lambda *a: reads.append(1) or real_ws(*a))
    monkeypatch.setattr(run, "run_plans_batch", lambda *a, **k: batch.append(k.get("sample")) or real_batch(*a, **k))
    out = _go(conn, gid)
    assert reads == [1] and batch == [True]
    assert all(c["sample"] is True and c["payload"]["count"] > 0 for c in out["cards"])
