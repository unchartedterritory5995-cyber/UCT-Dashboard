"""Notebook P3b Task 2 -- the `example` mode of the ONE public reducer and its change list.

An EXAMPLE NOTE is a sanitized copy of one of an author's notes, attached to a style they share
in the community library. `public_note_payload.reduce(mode="example")` makes it, and the change
list (`report=`) tells the author exactly what was replaced. Each row of plan R-P3b-3 is one test
here (the numbers in the test names are the brief's).

⛔ "GALLERY'S RULE" IS THE SAME CODE PATH (ruling P3b-R3). The example decision for a node type
is ONE lookup over `NODE_POLICY` that falls back to the gallery column, except a DECLARED override
set (image, imageFigure, imageCaption). The rail below derives the rows from `NODE_POLICY` itself.

⛔ THE OLD MODES DO NOT MOVE (test 16). `tests/fixtures/example_reduce_old_mode_goldens.json` was
captured on the base before the reducer changed; every case is re-reduced and compared as JSON text.
"""
from __future__ import annotations

import ast
import copy
import io
import json
import re
import tokenize
from datetime import datetime, timezone
from pathlib import Path

import pytest

from api.services.journal_two import example_sanitize as xs
from api.services.journal_two import public_note_payload as pnp
from api.services.journal_two import trader_blocks as tb
from tests.test_public_note_payload import (FACTS, NOTE, OTHER, OWN_ATT, OWNER, OTHER_ATT, doc, find,
                                            p, t, texts_in, types_in)

ROOT = Path(__file__).resolve().parents[1]
SANITIZE_PY = ROOT / "api" / "services" / "journal_two" / "example_sanitize.py"
PAYLOAD_PY = ROOT / "api" / "services" / "journal_two" / "public_note_payload.py"
GOLDENS = ROOT / "tests" / "fixtures" / "example_reduce_old_mode_goldens.json"

V, B = xs.VALUE_TEXT, xs.BROKER_TEXT
NEUTRAL = pnp.NEUTRAL_LINE
KINDS = {"money", "pnl_figure", "broker", "email", "block_reset", "fact", "market_data", "trade_link",
         "image_off", "dropped"}
GALLERY_IMG = "/api/j2/template-gallery/ITEM/images/"


def ex(body: dict, *, report: list | None = None, images_on=frozenset(), brokers=xs.BROKER_NAMES,
       image_src_for=None) -> dict:
    return pnp.reduce(copy.deepcopy(body), mode="example", owner_id=OWNER, note_id=NOTE,
                      attachment_base="", facts=FACTS, note_links={}, images_on=frozenset(images_on),
                      brokers=tuple(brokers), image_src_for=image_src_for, report=report)


def gallery(body: dict) -> dict:
    return pnp.reduce(copy.deepcopy(body), mode="gallery", owner_id=OWNER, note_id="",
                      attachment_base="", facts={}, note_links={})


def text_doc(*lines: str) -> dict:
    return doc(*[p(t(s)) for s in lines])


def kinds(changes: list) -> list[str]:
    return [c["kind"] for c in changes]


def block(widget_id: str, params: dict, **extra) -> dict:
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": widget_id, "embedId": "e-author", "mode": "snapshot", "params": params,
        "capturedAt": "2026-10-01T13:30:00Z", "annotations": [{"id": 1}], "caption": "my caption",
        "layout": {"width": "full", "height": 320}, "fallback": None, "searchText": "x", **extra}}


_NO_READ_NOW = datetime(2026, 10, 18, 14, 0, tzinfo=timezone.utc)


def empty_params(block_id: str) -> dict:
    """The block's builder, in its NO-READ mode ("update", no member): the params a reset carries."""
    node, _ = tb.BUILDERS[block_id]({"settings": {}}, {"now": _NO_READ_NOW, "mode": "update"})
    return node["attrs"]["params"]


# ── 1-5: the text patterns ──────────────────────────────────────────────────────────────

def test_1_money_pnl_and_broker_in_one_sentence():
    """Review Focus 1, pinned here."""
    changes: list = []
    out = ex(text_doc("made $1,240 on NVDA, up 3.2R, at Schwab"), report=changes)
    assert texts_in(out) == ["made your value here on NVDA, up your value here, at your broker"]
    assert kinds(changes) == ["money", "pnl_figure", "broker"]
    assert [c["before"] for c in changes] == ["$1,240", "3.2R", "Schwab"]
    assert [c["after"] for c in changes] == [V, V, B]
    assert all(c["path"] == [0, 0] for c in changes), changes      # doc > paragraph 0 > text 0
    direct: list = []
    assert xs.scrub_text("made $1,240 on NVDA, up 3.2R, at Schwab", xs.BROKER_NAMES, direct) == \
        "made your value here on NVDA, up your value here, at your broker"
    assert kinds(direct) == ["money", "pnl_figure", "broker"]


def test_2_a_price_with_no_dollar_sign_is_kept():
    changes: list = []
    assert texts_in(ex(text_doc("NVDA 132.40 support"), report=changes)) == ["NVDA 132.40 support"]
    assert changes == []


@pytest.mark.parametrize("line", [
    "NVDA 3.2R target",                         # the control: a figure with no P&L word
    "profit came in at a 3R",                   # the P&L word is FOUR words before: outside the window
    "NVDA target 12% away",
])
def test_2_CONTROL_a_figure_with_no_pnl_word_in_the_window_is_kept(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


def test_3_a_signed_or_suffixed_amount_is_ONE_money_entry():
    changes: list = []
    out = ex(text_doc("lost -$500k then made $2.5M"), report=changes)
    assert texts_in(out) == [f"lost {V} then made {V}"]
    assert kinds(changes) == ["money", "money"]
    assert [c["before"] for c in changes] == ["-$500k", "$2.5M"]


#: name -> a shorter name in the list that it contains. "Charles Schwab" holds "Schwab"; for the
#: other two the shorter name is a PREFIX, which is the case a pattern built shortest-first gets wrong.
LONGER_NAMES = {"Charles Schwab": "Schwab", "Merrill Edge": "Merrill", "Cobra Trading": "Cobra"}


@pytest.mark.parametrize("name", sorted(LONGER_NAMES))
def test_4_the_longest_broker_name_wins_and_is_one_entry(name):
    shortest_first = tuple(sorted(xs.BROKER_NAMES, key=len))         # the order must not matter
    assert shortest_first.index(LONGER_NAMES[name]) < shortest_first.index(name)
    changes: list = []
    assert xs.scrub_text(f"I trade at {name} daily", shortest_first, changes) == f"I trade at {B} daily"
    assert changes == [{"kind": "broker", "before": name, "after": B}]
    report: list = []
    assert texts_in(ex(text_doc(f"{name.upper()} account"), brokers=shortest_first, report=report)) == \
        [f"{B} account"]                                              # any case
    assert kinds(report) == ["broker"]


def test_4_a_broker_name_matches_whole_words_only():
    assert xs.scrub_text("Fidelityish and unSchwab", xs.BROKER_NAMES, None) == "Fidelityish and unSchwab"
    assert xs.scrub_text("via E*TRADE, Public.com.", xs.BROKER_NAMES, None) == f"via {B}, {B}."


@pytest.mark.parametrize("line, want", [
    ("Down 4% today", f"Down {V} today"),
    # Accepted and documented: "up" is within 3 words before, so a relative-strength figure is
    # replaced too. The author sees it in the preview.
    ("RS up 4% vs SPY", f"RS up {V} vs SPY"),
    ("P&L: +2.5R on the week", f"P&L: {V} on the week"),
    ("Gained 12%", f"Gained {V}"),
])
def test_5_a_figure_with_a_pnl_word_in_the_window_is_replaced(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["pnl_figure"]


def test_5_the_window_counts_the_words_the_author_wrote_not_the_replacement():
    """"made $1,240 3R": the replacement is three words long, the original amount is one."""
    assert xs.scrub_text("made $1,240 3R", (), None) == f"made {V} {V}"


# ── 6, 7, P3b-R10: trader blocks reset through their builder's NO-READ output ─────────────

def test_6_position_sizing_comes_out_with_the_builders_empty_params():
    changes: list = []
    out = ex(doc(block("positionSizing", {"grade": "B", "accountSize": 25000, "riskPct": 1})), report=changes)
    w = find(out, "widgetEmbed")
    assert len(w) == 1 and w[0]["attrs"]["widgetId"] == "positionSizing"
    assert w[0]["attrs"]["params"] == empty_params("positionSizing") == {"grade": "A"}
    blob = json.dumps(out)
    assert "25000" not in blob and "my caption" not in blob and "e-author" not in blob
    assert w[0]["attrs"]["capturedAt"] is None and w[0]["attrs"]["embedId"] is None   # never today's stamp
    assert "block_reset" in kinds(changes)
    reset = [c for c in changes if c["kind"] == "block_reset"][0]
    assert "25000" in reset["before"] and len(reset["before"]) <= xs.BEFORE_MAX


def test_7_a_trade_review_block_loses_its_trade():
    changes: list = []
    out = ex(doc(block("tradeReview", {"tradeId": "trade-123"})), report=changes)
    assert find(out, "widgetEmbed")[0]["attrs"]["params"] == {"tradeId": ""}
    assert "trade-123" not in json.dumps(out)
    assert "block_reset" in kinds(changes)


#: The trader-block readers (trader_blocks.READS_ON_CREATE's builders and what they call), plus the
#: database door. A reset must reach none of them.
READERS = ("_regime_field", "_breadth", "_quotes", "price_stamp_quote", "market_context_params",
           "prep_part", "_my_names", "_cached_quote", "_last_close", "_frozen_close",
           "recent_closed_trades", "trade_review", "save_pre_entry", "_prep_wire", "_prep_earnings",
           "_prep_movers", "_prep_levels")


def test_R10_every_block_resets_through_its_builder_and_reads_nothing(monkeypatch):
    calls: list[str] = []

    def spy(name):
        def refuse(*a, **k):
            calls.append(name)
            raise AssertionError(f"a reset read through {name}")
        return refuse

    for name in READERS:
        assert hasattr(tb, name), f"non-vacuity: trader_blocks.{name} is gone -- update READERS"
        monkeypatch.setattr(tb, name, spy(name))
    from api.services import auth_db
    monkeypatch.setattr(auth_db, "get_connection", spy("auth_db.get_connection"))
    monkeypatch.setitem(tb.BUILDERS, "marketcontext", spy("build_market_context"))
    assert len(tb.BLOCK_IDS) == 9 and set(tb.READS_ON_CREATE) - set(tb.BLOCK_IDS) == {"marketcontext"}
    authored = {bid: {"secret": f"author-{bid}", "snapshot": {"rows": [1]}} for bid in tb.BLOCK_IDS}
    body = doc(*[block(bid, authored[bid]) for bid in tb.BLOCK_IDS], block("marketcontext", {"fields": "all"}))
    changes: list = []
    out = ex(body, report=changes)
    assert calls == [], calls
    widgets = find(out, "widgetEmbed")
    assert [w["attrs"]["widgetId"] for w in widgets] == list(tb.BLOCK_IDS)
    for w in widgets:
        assert w["attrs"]["params"] == empty_params(w["attrs"]["widgetId"]), w
    assert "author-" not in json.dumps(out)
    assert texts_in(out) == [NEUTRAL]                         # marketcontext: the market-data rule
    assert kinds(changes).count("block_reset") == 9 and kinds(changes).count("market_data") == 1


def test_R10_marketcontext_is_a_market_data_embed_and_takes_gallerys_rule():
    body = doc(block("marketcontext", {"uncaptured": False, "fields": "all"}))
    assert ex(body) == gallery(body)
    assert texts_in(ex(body)) == [NEUTRAL]


# ── 8-11: facts, market data, private embeds, trade links ───────────────────────────────

def test_8_a_financial_fact_becomes_your_value_here():
    changes: list = []
    out = ex(doc(p(t("before")), {"type": "financialFact", "attrs": {"factId": "fact-fmp"}}), report=changes)
    assert texts_in(out) == ["before", V]
    assert "financialFact" not in types_in(out) and "212.5" not in json.dumps(out)
    assert kinds(changes) == ["fact"]


@pytest.mark.parametrize("widget_id", ["chart", "fundamentals", "optionsflow"])
def test_9_a_market_data_embed_is_the_neutral_line_whatever_its_vendor(widget_id):
    changes: list = []
    body = doc(block(widget_id, {"symbol": "AAPL"}))
    out = ex(body, report=changes)
    assert texts_in(out) == [NEUTRAL] and out == gallery(body)
    assert kinds(changes) == ["market_data"]


@pytest.mark.parametrize("widget_id", ["notebook", "alerts"])
def test_10_a_private_embed_is_dropped(widget_id):
    changes: list = []
    out = ex(doc(p(t("kept")), block(widget_id, {"noteId": OTHER})), report=changes)
    assert texts_in(out) == ["kept"] and "widgetEmbed" not in types_in(out)
    assert OTHER not in json.dumps(out)
    assert kinds(changes) == ["dropped"]


def test_11_a_trade_ref_attr_is_removed_and_the_node_kept():
    changes: list = []
    out = ex(doc(block("preEntryChecklist", {"setup": "", "includeRules": "yes", "requireAll": "no",
                                              "checked": []}, tradeRef="trade-9", tradeRefType="equity_trade")),
             report=changes)
    w = find(out, "widgetEmbed")
    assert len(w) == 1 and w[0]["attrs"]["widgetId"] == "preEntryChecklist"
    assert "tradeRef" not in w[0]["attrs"] and "tradeRefType" not in w[0]["attrs"]
    assert "trade-9" not in json.dumps(out)
    assert "trade_link" in kinds(changes)


def test_11_a_trade_link_mark_goes_and_its_words_stay():
    changes: list = []
    link = {"type": "link", "attrs": {"href": "/journal-2-0/trade/t-1"}}
    out = ex(doc(p(t("my "), t("NVDA trade", link))), report=changes)
    assert texts_in(out) == ["my ", "NVDA trade"] and "/trade/" not in json.dumps(out)
    assert kinds(changes) == ["trade_link"]


# ── 12: images, the author's switch ─────────────────────────────────────────────────────

def _src_for(src: str) -> str:
    return GALLERY_IMG + src.rsplit("/", 1)[-1].split(".")[0]


def test_12_an_image_left_off_is_dropped_and_one_switched_on_is_kept_rewritten():
    on, off = f"{OWN_ATT}inline/a.png", f"{OWN_ATT}inline/b.png"
    body = doc({"type": "image", "attrs": {"src": on, "alt": "my account page", "width": 300}},
               {"type": "image", "attrs": {"src": off}},
               {"type": "imageFigure", "content": [{"type": "image", "attrs": {"src": on}},
                                                   {"type": "imageCaption", "content": [t("made $1,240")]}]},
               {"type": "imageFigure", "content": [{"type": "image", "attrs": {"src": off}},
                                                   {"type": "imageCaption", "content": [t("gone $5")]}]})
    changes: list = []
    out = ex(body, images_on={on}, image_src_for=_src_for, report=changes)
    srcs = [i["attrs"]["src"] for i in find(out, "image")]
    assert srcs == [GALLERY_IMG + "a", GALLERY_IMG + "a"]
    assert find(out, "image")[0]["attrs"] == {"src": GALLERY_IMG + "a", "width": 300}
    assert len(find(out, "imageFigure")) == 1                     # the off image's figure went with it
    assert texts_in(out) == [f"made {V}"]                         # the kept caption is scrubbed
    assert "/notes/attachments/" not in json.dumps(out)
    assert kinds(changes) == ["image_off", "money", "image_off"]  # the dropped caption reports nothing
    assert [c["before"] for c in changes if c["kind"] == "image_off"] == ["b.png", "b.png"]


def test_12_CONTROLS_an_image_on_with_no_rewriter_or_a_bad_rewrite_is_dropped():
    src = f"{OWN_ATT}inline/a.png"
    body = doc({"type": "image", "attrs": {"src": src}})
    assert "image" not in types_in(ex(body, images_on={src}))                      # nothing to rewrite with
    assert "image" not in types_in(ex(body, images_on={src}, image_src_for=lambda s: ""))
    assert "image" not in types_in(ex(body, images_on={src}, image_src_for=lambda s: 'x" onerror="'))
    assert "image" not in types_in(ex(body))                                       # off by default
    # the switch names the ORIGINAL src: the attachment prefix is not rewritten in example mode
    assert "image" in types_in(ex(body, images_on={src}, image_src_for=_src_for))


def test_12_a_link_cards_image_stays_nulled_exactly_as_gallery_does():
    body = doc({"type": "linkPreview", "attrs": {"url": "https://example.com/a", "title": "A card",
                                                 "domain": "example.com", "image": "https://example.com/i.png"}})
    out = ex(body)
    assert find(out, "linkPreview")[0]["attrs"]["image"] is None
    assert out == gallery(body)


# ── 13-15: gallery's rules, the existing rules ──────────────────────────────────────────

def test_13_task_items_come_out_unchecked():
    out = ex(doc({"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": True}, "content": [p(t("done"))]}]}))
    assert find(out, "taskItem")[0]["attrs"]["checked"] is False


def test_14_an_email_becomes_email_address():
    changes: list = []
    out = ex(text_doc("write to me@example.com today"), report=changes)
    assert texts_in(out) == [f"write to {pnp.EMAIL_TEXT} today"]
    assert changes == [{"kind": "email", "before": "me@example.com", "after": pnp.EMAIL_TEXT, "path": [0, 0]}]


def test_15_a_note_link_becomes_linked_note():
    out = ex(doc(p(t("see "), {"type": "noteLink", "attrs": {"noteId": OTHER}})))
    assert texts_in(out) == ["see ", pnp.LINKED_NOTE_TEXT] and OTHER not in json.dumps(out)


def test_ask_inserts_and_citations_go_and_are_reported_dropped():
    changes: list = []
    out = ex(doc({"type": "askInsert", "attrs": {"question": "q", "action": "rewrite"},
                  "content": [p(t("a"), {"type": "askCitation", "attrs": {"n": 1}})]}, p(t("kept"))),
             report=changes)
    assert texts_in(out) == ["kept"]
    assert kinds(changes) == ["dropped"]


# ── 16: the other three modes, byte for byte ────────────────────────────────────────────

def _goldens() -> dict:
    return json.loads(GOLDENS.read_text(encoding="utf-8"))


def test_16_the_golden_is_real():
    g = _goldens()
    assert len(g) >= 200, len(g)
    for must in ("fixture:image", "fixture:widgetEmbed", "widget:positionSizing", "example-prose", "leaky-note"):
        assert must in g and set(g[must]) == {"share", "publish", "gallery"}, must
    assert "your value here" not in json.dumps(g)                  # captured before the example mode


@pytest.mark.parametrize("mode", ["share", "publish", "gallery"])
def test_16_the_old_modes_are_byte_identical_to_the_base(mode):
    from tests.fixtures import _gen_example_reduce_goldens as gen
    g = _goldens()
    produced = {cid: (body, links) for cid, body, links in gen.cases()}
    vanished = sorted(set(g) - set(produced))
    assert not vanished, f"golden cases the generator no longer builds: {vanished}"
    moved = []
    for cid in sorted(g):
        body, links = produced[cid]
        if gen.reduce_old(body, mode, links) != g[cid][mode]:
            moved.append(cid)
    assert not moved, f"{mode}: {len(moved)} case(s) moved, first {moved[:5]}"


# ── 17: the change list is a report, never an input ─────────────────────────────────────

RICH = doc(
    p(t("made $1,240 on NVDA, up 3.2R, at Schwab; mail me@example.com")),
    block("positionSizing", {"grade": "B", "accountSize": 25000}),
    block("chart", {"symbol": "NVDA"}),
    {"type": "financialFact", "attrs": {"factId": "fact-fmp"}},
    {"type": "image", "attrs": {"src": f"{OWN_ATT}inline/a.png"}},
    {"type": "image", "attrs": {"src": f"{OTHER_ATT}inline/b.png"}},
    p(t("see "), {"type": "noteLink", "attrs": {"noteId": OTHER}}),
    {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": True}, "content": [p(t("x"))]}]},
)


def test_17_report_None_gives_the_same_body_as_a_list():
    kw = {"images_on": {f"{OWN_ATT}inline/a.png"}, "image_src_for": _src_for}
    with_list: list = []
    assert ex(RICH, report=None, **kw) == ex(RICH, report=with_list, **kw)
    assert with_list and set(kinds(with_list)) <= KINDS
    assert all(len(c["before"]) <= xs.BEFORE_MAX and isinstance(c["path"], list) for c in with_list)


def test_17_the_old_modes_ignore_the_example_arguments():
    for mode in ("share", "publish", "gallery"):
        report: list = []
        plain = pnp.reduce(copy.deepcopy(RICH), mode=mode, owner_id=OWNER, note_id=NOTE,
                           attachment_base="/api/j2/shared/T/att/", facts=FACTS)
        loaded = pnp.reduce(copy.deepcopy(RICH), mode=mode, owner_id=OWNER, note_id=NOTE,
                            attachment_base="/api/j2/shared/T/att/", facts=FACTS, images_on=frozenset({"x"}),
                            brokers=("Schwab",), image_src_for=_src_for, report=report)
        assert plain == loaded and report == [], mode


# ── brokers: the list is always scrubbed, and the author's own names join it ────────────

def test_the_broker_list_is_scrubbed_even_when_no_names_are_passed():
    assert texts_in(ex(text_doc("my Fidelity account"), brokers=())) == [f"my {B} account"]


def test_the_authors_own_institution_names_are_scrubbed():
    out = ex(text_doc("cleared through Acme Clearing Co"), brokers=xs.BROKER_NAMES + ("Acme Clearing Co",))
    assert texts_in(out) == [f"cleared through {B}"]


def test_attribute_text_is_scrubbed_too():
    changes: list = []
    out = ex(doc({"type": "linkPreview", "attrs": {"url": "https://example.com/a", "title": "I made $5,000 at Schwab",
                                                   "domain": "example.com"}}), report=changes)
    assert find(out, "linkPreview")[0]["attrs"]["title"] == f"I made {V} at {B}"
    assert {"money", "broker"} <= set(kinds(changes))


# ── 18: OCR warnings ────────────────────────────────────────────────────────────────────

def test_18_ocr_warnings_name_digits_money_and_brokers():
    got = xs.ocr_warnings("Acct 12345678 bal $48,210 Fidelity", xs.BROKER_NAMES)
    assert got == [{"kind": "digits", "match": "12345678"}, {"kind": "money", "match": "$48,210"},
                   {"kind": "broker", "match": "Fidelity"}]


def test_18_a_digit_run_counts_through_spaces_and_dashes_and_a_short_one_does_not():
    assert xs.ocr_warnings("card 1234-5678 9012", ()) == [{"kind": "digits", "match": "1234-5678 9012"}]
    assert xs.ocr_warnings("NVDA 132.40 on 10/17, 12345", ()) == []


# ── P3b-R3: the example decision IS gallery's, except the declared override set ─────────

DECLARED_OVERRIDES = {"image", "imageFigure", "imageCaption"}


def test_R3_the_override_set_is_exactly_the_declared_three():
    assert set(pnp.EXAMPLE_OVERRIDES) == DECLARED_OVERRIDES


@pytest.mark.parametrize("type_", sorted(pnp.NODE_POLICY))
def test_R3_every_rows_example_decision_is_its_gallery_decision_except_the_overrides(type_):
    row = pnp.NODE_POLICY[type_]
    assert "example" not in row, f"{type_}: an example column was copied into NODE_POLICY"
    assert set(row) == set(pnp.BASE_MODES), type_
    if type_ in DECLARED_OVERRIDES:
        assert pnp.node_action(type_, "example") != row["gallery"], type_
    else:
        assert pnp.node_action(type_, "example") == row["gallery"], type_
    for mode in pnp.BASE_MODES:
        assert pnp.node_action(type_, mode) == row[mode], (type_, mode)


def test_R3_the_attribute_rows_follow_the_same_lookup():
    for row, decision in pnp.ATTR_POLICY.items():
        assert set(decision) == set(pnp.BASE_MODES), row
        assert pnp.attr_decision(row, "example") == decision["gallery"], row


def test_R3_the_modes():
    assert pnp.MODES == ("share", "publish", "gallery", "example")
    assert pnp.BASE_MODES == pnp.MODES[:3]


def _code_only(path: Path) -> str:
    """The file with comments and docstrings/strings removed (a literal hunt must not read prose)."""
    src = path.read_text(encoding="utf-8")
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type in (tokenize.COMMENT, tokenize.STRING):
            continue
        out.append(tok.string)
    return " ".join(out)


def test_R3_the_reducer_decides_through_the_one_lookup():
    code = _code_only(PAYLOAD_PY)
    assert re.search(r"node_action \( t , ctx \. mode \)", code), "_reduce_node does not ask node_action"
    assert not re.search(r"policy \[ ctx \. mode \]", code), "a mode column is indexed directly"


# ── 19: purity and the import closure ───────────────────────────────────────────────────

def _module_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in tree.body:                      # module level only
        if isinstance(node, ast.Import):
            names |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split(".")[0])
    return names


def test_19_example_sanitize_imports_nothing_but_re_and_unicodedata():
    tree = ast.parse(SANITIZE_PY.read_text(encoding="utf-8"))
    every = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            every |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            every.add((node.module or "").split(".")[0])
    assert every <= {"re", "unicodedata", "__future__"}, every


def test_19_the_reducer_imports_no_web_framework_at_module_level():
    assert not _module_imports(PAYLOAD_PY) & {"fastapi", "starlette"}
    assert "fastapi" in _module_imports(ROOT / "api" / "routers" / "notebook_template_gallery.py"), \
        "non-vacuity: the scan sees a module-level framework import where one exists"


def _calls(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else "")
            base = f.value.id if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) else ""
            out.append(f"{base}.{name}" if base else name)
    return out


@pytest.mark.parametrize("path", [SANITIZE_PY, PAYLOAD_PY], ids=["example_sanitize", "public_note_payload"])
def test_no_line_logs_or_prints_note_text(path):
    bad = [c for c in _calls(path) if c == "print" or c.startswith(("logging.", "logger.", "log."))
           or c in ("warning", "info", "debug", "error", "exception")]
    assert bad == [], bad
    assert "print" in _calls(ROOT / "tests" / "fixtures" / "_gen_example_reduce_goldens.py"), \
        "non-vacuity: the scan sees a print where one exists"
