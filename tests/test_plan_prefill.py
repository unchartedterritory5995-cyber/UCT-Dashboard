"""Tier 2 part A, /plan (R-T2A-1..3): the member's own levels, a dated price, a link to the source.
Never an invented number.

The harness is the styles tests' own: a per-file `db_path` (a temp auth db, as tests/test_journal_styles_create.py
and tests/test_journal_styles_compose.py each define it) and the trade-plan create through
`journal_styles.create_styled_note`. Notes are made with `notes.create_note`, and a sample note is marked the way
the sample notebook marks one (`sample_marker.SAMPLE_SOURCE`)."""
from __future__ import annotations

import importlib
import json
import os
import tempfile
from types import SimpleNamespace

import pytest

from api.services.journal_two import journal_styles, plan_prefill, sample_marker
from api.services.journal_two import trader_blocks as tb

UID = "u1"
GOOD_QUOTE = {"price": 182.4, "changePct": 1.2, "source": "live price", "asOf": "2026-10-14T14:31:00Z"}


def _nodes(doc, kind):
    out, stack = [], [doc]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "widgetEmbed" and (n.get("attrs") or {}).get("widgetId") == kind:
                out.append(n)
            stack.extend(n.get("content") or [])
    return out


def _text(doc):
    out, stack = [], [doc]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "text":
                out.append(n.get("text", ""))
            stack.extend(reversed(n.get("content") or []))
    return " ".join(out)


def _body(note):
    return note["bodyJson"] if isinstance(note["bodyJson"], dict) else json.loads(note["bodyJson"])


def _para(line):
    return {"type": "paragraph", "content": [{"type": "text", "text": line}]} if line else {"type": "paragraph"}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _no_market_reads(monkeypatch):
    """The trade-plan style also stamps a market context and the sizer's regime: answer those with
    nothing held, so no test here reads a vendor (the compose tests' own seams)."""
    monkeypatch.setattr(tb, "_breadth", lambda: {})
    monkeypatch.setattr(tb, "_regime_field", lambda memo: {"missing": "wire_unavailable"})
    monkeypatch.setattr(tb, "_quotes", lambda *a, **k: {})


@pytest.fixture
def member(db_path):
    from api.services import auth_db
    from api.services.journal_two import notes
    conn = auth_db.get_connection()

    def make_note(ticker, title, body_text="", sample=False, properties=None):
        doc = {"type": "doc", "content": [_para(ln) for ln in body_text.split("\n")] if body_text else [_para("")]}
        n = notes.create_note(UID, {"title": title, "ticker": ticker, "bodyJson": doc}, conn,
                              properties=properties)
        if sample:
            conn.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?", (sample_marker.SAMPLE_SOURCE, n["id"]))
            conn.commit()
        return n

    def trash(note):
        assert notes.delete_note(UID, note["id"], conn)

    yield SimpleNamespace(user_id=UID, conn=conn, make_note=make_note, trash=trash)
    conn.close()


def _plan(member, ticker="NVDA", **payload):
    return journal_styles.create_styled_note(
        member.user_id, {"kindId": "trade_plan", "ticker": ticker, "planPrefill": True, **payload}, member.conn)


def test_plan_prefill_copies_the_members_newest_levels_and_links_the_source(member, monkeypatch):
    src = member.make_note("NVDA", "NVDA base", "Entry: 181.5\nStop: 174\nTarget: 205")
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: dict(GOOD_QUOTE))
    note, _ = _plan(member)
    body = _body(note)
    chart = _nodes(body, "chart")[0]
    roles = {a["role"]: a["price"] for a in chart["attrs"]["annotations"]}
    assert roles == {"entry": 181.5, "stop": 174.0, "target": 205.0}
    sizing = _nodes(body, "positionSizing")[0]
    params = sizing["attrs"]["params"]
    assert (params["entry"], params["stop"]) == (181.5, 174.0)
    assert "target" not in params                       # the sizer takes entry and stop only
    # V7 (case b): the sizing block's search text is a constant that ignores params, so it is untouched.
    assert sizing["attrs"]["searchText"] == "[position sizing]"
    text = _text(body)
    assert "Price when planned: $182.40 (live price, Oct 14, 10:31 AM ET)" in text
    assert "Levels from your note" in text
    links = []
    stack = [body]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "noteLink":
                links.append(n["attrs"]["noteId"])
            stack.extend(n.get("content") or [])
    assert links == [src["id"]]
    # Both lines sit under the first heading, never above it.
    top = [c["type"] for c in body["content"]]
    assert top.index("heading") < min(i for i, c in enumerate(body["content"]) if "Price when planned" in _text(c))


def test_plan_prefill_without_history_or_price_adds_nothing_invented(member, monkeypatch):
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: None)
    note, _ = _plan(member, "ZZZT")
    body = _body(note)
    assert _nodes(body, "chart")[0]["attrs"]["annotations"] == []
    params = _nodes(body, "positionSizing")[0]["attrs"]["params"]
    assert "entry" not in params and "stop" not in params
    text = _text(body)
    assert "Price when planned" not in text
    assert "Levels from your note" not in text


def test_a_sample_or_trashed_note_is_never_a_source(member):
    member.make_note("NVDA", "sample", "Entry: 1\nStop: 0.5", sample=True)
    trashed = member.make_note("NVDA", "old", "Entry: 2\nStop: 1")
    member.trash(trashed)
    assert plan_prefill.member_levels(member.user_id, "NVDA", member.conn) is None


def test_the_newest_note_that_names_a_level_is_the_source_and_a_blank_newer_one_is_skipped(member):
    member.make_note("NVDA", "older plan", "Entry: 150\nStop: 140")
    newest_plan = member.make_note("NVDA", "newer plan", "Entry: 181.5\nStop: 174")
    member.make_note("NVDA", "just thoughts", "Looks strong into earnings.")
    member.make_note("AMD", "other ticker", "Entry: 99\nStop: 95")
    got = plan_prefill.member_levels(member.user_id, "nvda", member.conn)
    assert got["noteId"] == newest_plan["id"] and got["title"] == "newer plan"
    assert got["levels"] == {"entry": 181.5, "stop": 174.0}


def test_a_note_naming_only_shares_is_not_a_source(member):
    """V6b: "names any of the three" is entry, stop or target. A shares line alone is not a level, so
    the scan goes on to the older note that has one (plan_extract.names_any_level would stop there)."""
    older = member.make_note("NVDA", "older plan", "Entry: 150\nStop: 140")
    member.make_note("NVDA", "size only", "Shares: 100")
    got = plan_prefill.member_levels(member.user_id, "NVDA", member.conn)
    assert got["noteId"] == older["id"] and got["levels"] == {"entry": 150.0, "stop": 140.0}
    # And with nothing else to fall back on, a shares-only note yields no source at all.
    only = member.make_note("TSLA", "size only", "Shares: 100")
    assert only and plan_prefill.member_levels(member.user_id, "TSLA", member.conn) is None


def test_a_level_the_member_kept_as_a_property_still_comes_through(member):
    """V6a: read_note_plan skips a property-named level unless it is handed the member's property
    definitions. The only source note here names its stop as a number property called "Stop"."""
    from api.services.journal_two import note_properties
    pd = note_properties.create_property_def(member.user_id, "Stop", "number", conn=member.conn)
    src = member.make_note("NVDA", "stop as a property", "Thinking about a pullback entry.",
                           properties={pd["id"]: 174})
    got = plan_prefill.member_levels(member.user_id, "NVDA", member.conn)
    assert got is not None and got["noteId"] == src["id"]
    assert got["levels"] == {"stop": 174.0}


def test_the_property_definitions_are_loaded_once_per_call(member, monkeypatch):
    from api.services.journal_two import note_properties
    for i in range(3):
        member.make_note("NVDA", f"thoughts {i}", "Nothing to size yet.")
    member.make_note("NVDA", "plan", "Entry: 181.5")
    calls = []
    real = note_properties.list_property_defs
    monkeypatch.setattr(note_properties, "list_property_defs",
                        lambda *a, **k: calls.append(1) or real(*a, **k))
    assert plan_prefill.member_levels(member.user_id, "NVDA", member.conn)["levels"] == {"entry": 181.5}
    assert len(calls) == 1


def test_plan_prefill_needs_the_trade_plan_kind_and_a_ticker(member):
    with pytest.raises(journal_styles.StyleValidationError):
        journal_styles.create_styled_note(member.user_id, {"kindId": "trade_plan", "planPrefill": True}, member.conn)
    with pytest.raises(journal_styles.StyleValidationError):
        journal_styles.create_styled_note(
            member.user_id, {"kindId": "daily_prep", "ticker": "NVDA", "planPrefill": True}, member.conn)


def test_a_spent_budget_leaves_the_price_out(member, monkeypatch):
    member.make_note("NVDA", "NVDA base", "Entry: 181.5\nStop: 174")
    asked = []
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: asked.append(sym) or dict(GOOD_QUOTE))

    def spent(memo):
        raise tb.BudgetSpent()
    monkeypatch.setattr(tb, "_spend", spent)
    note, _ = _plan(member)
    body = _body(note)
    assert asked == []                                              # the read was never started
    assert "Price when planned" not in _text(body)
    # The levels are the member's own words, not a vendor read: a spent budget does not take them away.
    assert {a["role"] for a in _nodes(body, "chart")[0]["attrs"]["annotations"]} == {"entry", "stop"}


def test_a_failed_price_read_is_a_missing_line_never_a_failed_note(member, monkeypatch):
    def boom(sym, now=None):
        raise OSError("vendor down")
    monkeypatch.setattr(tb, "price_stamp_quote", boom)
    note, _ = _plan(member)
    assert "Price when planned" not in _text(_body(note))


@pytest.mark.parametrize("quote, tail", [
    ({**GOOD_QUOTE, "source": "last close", "asOf": "2026-10-13T20:00:00Z"}, "(last close, Oct 13, 4:00 PM ET)"),
    ({**GOOD_QUOTE, "source": "massive_snapshot"}, "(Oct 14, 10:31 AM ET)"),     # a machine word is never printed
    ({**GOOD_QUOTE, "source": None, "asOf": "not a date"}, ""),                  # nothing to date it by: no tail
])
def test_the_price_line_prints_plain_words_only(member, monkeypatch, quote, tail):
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: dict(quote))
    note, _ = _plan(member)
    lines = [ln for ln in _text(_body(note)).split("Price when planned: ")[1:]]
    assert lines, "the price line is there"
    want = "$182.40" + (f" {tail}" if tail else "")
    assert lines[0].startswith(want), lines[0]
    assert "massive" not in _text(_body(note))


def test_a_price_that_is_not_a_real_number_is_left_out(member, monkeypatch):
    for bad in (0, -3, None, "182.4", True):
        monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None, _b=bad: {**GOOD_QUOTE, "price": _b})
        note, _ = _plan(member)
        assert "Price when planned" not in _text(_body(note)), bad


def test_a_style_with_neither_chart_nor_sizer_gets_no_source_line(member):
    """R-T2A-3: the member's style is honoured. With nowhere to put the levels, saying "Levels from your
    note" would claim a copy that did not happen."""
    member.make_note("NVDA", "NVDA base", "Entry: 181.5\nStop: 174")
    s = journal_styles.create_style(member.user_id, {
        "name": "bare plan", "kindId": "trade_plan",
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]}]},
        "blocks": [{"block": "preEntryChecklist", "enabled": True, "settings": {}}]})
    note, _ = journal_styles.create_styled_note(
        member.user_id, {"styleId": s["id"], "ticker": "NVDA", "planPrefill": True}, member.conn)
    assert "Levels from your note" not in _text(_body(note))


def test_without_planPrefill_a_trade_plan_is_unchanged(member, monkeypatch):
    member.make_note("NVDA", "NVDA base", "Entry: 181.5\nStop: 174")
    asked = []
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: asked.append(sym) or dict(GOOD_QUOTE))
    note, _ = journal_styles.create_styled_note(member.user_id, {"kindId": "trade_plan", "ticker": "NVDA"}, member.conn)
    body = _body(note)
    assert _nodes(body, "chart")[0]["attrs"]["annotations"] == []
    assert "entry" not in _nodes(body, "positionSizing")[0]["attrs"]["params"]
    assert asked == [] and "Price when planned" not in _text(body)


def test_planPrefill_must_be_exactly_true(member):
    """A truthy string is not the flag: nothing is prefilled and nothing is refused."""
    member.make_note("NVDA", "NVDA base", "Entry: 181.5\nStop: 174")
    note, _ = journal_styles.create_styled_note(
        member.user_id, {"kindId": "trade_plan", "ticker": "NVDA", "planPrefill": "true"}, member.conn)
    assert _nodes(_body(note), "chart")[0]["attrs"]["annotations"] == []


def test_the_prefill_is_the_same_insert_no_second_revision(member, monkeypatch):
    """No follow-up write: the note is created and last updated in the same instant, so the prefill
    rode the styled create's ONE insert."""
    member.make_note("NVDA", "NVDA base", "Entry: 181.5\nStop: 174")
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: dict(GOOD_QUOTE))
    note, _ = _plan(member)
    assert note["createdAt"] == note["updatedAt"]
    assert _nodes(_body(note), "chart")[0]["attrs"]["annotations"]            # and the levels are in it


# ── Final-review fixes ────────────────────────────────────────────────────────────────────────────

def _outline_style(member, content):
    """A member style whose OUTLINE is `content` as given (the embeds a member's own outline can carry), with no
    block toggles adding blocks of their own. The outline is written straight to the row so no cleaning step can
    tidy the malformed embed this test is about."""
    s = journal_styles.create_style(member.user_id, {
        "name": "odd plan", "kindId": "trade_plan",
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]}]},
        "blocks": [{"block": "preEntryChecklist", "enabled": True, "settings": {}}]})
    outline = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Plan"}]}, *content]}
    member.conn.execute("UPDATE j2_journal_styles SET outline_body_json = ? WHERE id = ?", (json.dumps(outline), s["id"]))
    member.conn.commit()
    return s


def _embed(widget_id, params):
    return {"type": "widgetEmbed", "attrs": {"widgetId": widget_id, "params": params}}


def test_a_malformed_member_outline_never_fails_the_plan(member, monkeypatch):
    """I4: `/plan` is live on merge, and `_place_levels` used to raise on a member outline whose chart symbol is a
    number (`.upper()` on an int) or whose sizer's params is a list (`dict(list)`), failing the create for that
    member every time. Now the create succeeds with the style's blocks, places nothing and writes no source line."""
    member.make_note("NVDA", "NVDA base", "Entry: 181.5\nStop: 174")
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: dict(GOOD_QUOTE))
    s = _outline_style(member, [_embed("chart", {"symbol": 7}), _embed("positionSizing", ["x"])])
    note, _ = journal_styles.create_styled_note(
        member.user_id, {"styleId": s["id"], "ticker": "NVDA", "planPrefill": True}, member.conn)
    body = _body(note)
    text = _text(body)
    assert "Levels from your note" not in text                       # nothing placed, so nothing claimed
    assert "Price when planned: $182.40" in text                     # the dated price still lands
    assert _nodes(body, "preEntryChecklist")                         # the style's own block is there
    assert _nodes(body, "chart") and _nodes(body, "positionSizing")  # and the outline's embeds, untouched
    assert all(not (c["attrs"].get("annotations") or []) for c in _nodes(body, "chart"))


def test_a_level_placed_before_the_error_never_ships_without_its_source_line(member, monkeypatch):
    """I4: a GOOD chart takes the levels, then a malformed sizer raises. The work is done on a copy, so the chart
    keeps no level that the (unwritten) source line would have explained."""
    member.make_note("NVDA", "NVDA base", "Entry: 181.5\nStop: 174")
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: None)
    s = _outline_style(member, [_embed("chart", {"symbol": "NVDA"}), _embed("positionSizing", ["x"])])
    note, _ = journal_styles.create_styled_note(
        member.user_id, {"styleId": s["id"], "ticker": "NVDA", "planPrefill": True}, member.conn)
    body = _body(note)
    assert "Levels from your note" not in _text(body)
    charts = [c for c in _nodes(body, "chart") if (c["attrs"].get("params") or {}).get("symbol") == "NVDA"]
    assert charts, "control: the good chart is in the note"
    assert all(not (c["attrs"].get("annotations") or []) for c in charts)


def test_apply_on_a_malformed_doc_returns_the_doc_unplaced(monkeypatch):
    """I4 at the unit: `apply` itself never raises for a malformed embed, and leaves the doc as it was."""
    monkeypatch.setattr(plan_prefill, "member_levels", lambda *a: {"noteId": "n9", "title": "", "levels": {"entry": 1.0}})
    monkeypatch.setattr(plan_prefill, "price_line", lambda *a: None)
    for bad in (_embed("chart", {"symbol": 7}), _embed("positionSizing", ["x"]),
                {"type": "widgetEmbed", "attrs": ["not", "an", "object"]}):
        doc = {"type": "doc", "content": [bad]}
        before = json.dumps(doc, sort_keys=True)
        out = plan_prefill.apply(doc, {"ticker": "NVDA", "user_id": UID}, None)
        assert out is doc
        assert json.dumps(doc, sort_keys=True) == before


@pytest.mark.parametrize("price", [0.004, 0.0049, 0.009999])
def test_a_sub_cent_price_is_left_out_never_printed_as_zero(member, monkeypatch, price):
    """M1: `price > 0` admitted 0.004, which `f"{price:,.2f}"` prints as "$0.00" -- R-T2A-2 says never a zero."""
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: {**GOOD_QUOTE, "price": price})
    note, _ = _plan(member)
    text = _text(_body(note))
    assert "Price when planned" not in text
    assert "$0.00" not in text


def test_one_cent_is_a_price(member, monkeypatch):
    """M1 control: the line's floor is one cent, and a one-cent price is printed as one."""
    monkeypatch.setattr(tb, "price_stamp_quote", lambda sym, now=None: {**GOOD_QUOTE, "price": 0.01})
    note, _ = _plan(member)
    assert "Price when planned: $0.01" in _text(_body(note))
