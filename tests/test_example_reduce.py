"""Notebook P3b Task 2 -- the `example` mode of the ONE public reducer and its change list.

An EXAMPLE NOTE is a sanitized copy of one of an author's notes, attached to a style they share
in the community library. `public_note_payload.reduce(mode="example")` makes it, and the change
list (`report=`) tells the author exactly what was replaced. Each row of plan R-P3b-3 is one test
here (the numbers in the test names are the brief's).

⛔ "GALLERY'S RULE" IS THE SAME CODE PATH (ruling P3b-R3). The example decision for a node type
is ONE lookup over `NODE_POLICY` that falls back to the gallery column, except a DECLARED override
set (image, imageFigure, imageCaption; and since ruling P3b-T2-R8 linkPreview, webEmbed and the link
mark). The rail below derives the rows from `NODE_POLICY` itself.

Fix round 1 (rulings P3b-T2-R3..R13): the reviewer's probe inputs
(scratchpad `p3b_t2_review_probe.py`, groups A-P) are used verbatim as cases below.

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
#: P3b-T2-R22 (N-8): the ONE exported list of change kinds. Never a hand-typed copy here: the rails
#: below check the docstring table AND every kind the code can emit (derived by AST) against it.
KINDS = frozenset(xs.KINDS)
GALLERY_IMG = "/api/j2/template-gallery/ITEM/images/"


def ex(body: dict, *, report: list | None = None, images_on=frozenset(), brokers=(),
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


def at_path(body: dict, path: list) -> dict:
    """The node of the REDUCED body a change entry's `path` names (ruling P3b-T2-R5)."""
    node = body
    for i in path:
        node = node["content"][i]
    return node


def assert_paths_point_at_their_after(out: dict, changes: list) -> None:
    for c in changes:
        if c["after"]:
            assert c["after"] in json.dumps(at_path(out, c["path"])), (c, out)


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
    assert_paths_point_at_their_after(out, changes)
    direct: list = []
    assert xs.scrub_text("made $1,240 on NVDA, up 3.2R, at Schwab", (), direct) == \
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


def test_4_the_authors_own_names_are_matched_longest_first_too():
    """The house list's prefix pairs are already in order in the tuple; an author's names arrive in
    any order, so this is the case the sort is for."""
    changes: list = []
    assert xs.scrub_text("cleared via Acme Clearing desk", ("Acme", "Acme Clearing"), changes) == \
        f"cleared via {B} desk"
    assert changes == [{"kind": "broker", "before": "Acme Clearing", "after": B}]


def test_R3_author_names_match_case_sensitively_and_only_at_four_or_more_characters():
    """Probe J verbatim: an institution recorded as an ordinary word does not wipe the word."""
    out = ex(text_doc("Ally said the Public library is public"), brokers=("Ally", "Public", "IB"))
    assert texts_in(out) == [f"{B} said the {B} library is public"]
    assert xs.scrub_text("IB desk and ib", ("IB",), None) == "IB desk and ib"       # 2 chars: ignored
    assert xs.scrub_text("FIDELITY and fidelity", (), None) == f"{B} and {B}"     # the house list: any case


def test_4_a_broker_name_matches_whole_words_only():
    assert xs.scrub_text("Fidelityish and unSchwab", xs.BROKER_NAMES, None) == "Fidelityish and unSchwab"
    # "Public.com" is a house broker name AND a bare domain with a listed TLD (R18); the address pass
    # runs first (R9), so it reads "link" -- replaced either way.
    assert xs.scrub_text("via E*TRADE, Public.com.", xs.BROKER_NAMES, None) == f"via {B}, link."


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


# ── fix round 1: the wider text rules (rulings P3b-T2-R9..R12, minors M-3) ─────────────

#: Probe A verbatim (money forms), plus ruling R11's other named forms.
MONEY_CASES = [
    ("paid $ 1,240 fees", f"paid {V} fees"), ("USD 1,240 profit", f"{V} profit"),
    ("1,240 dollars made", f"{V} made"), ("made $1.2k", f"made {V}"), ("(-$500) on it", f"({V}) on it"),
    ("made €1,240", f"made {V}"), ("lost £500", f"lost {V}"), ("made 1240$", f"made {V}"),
    ("made $1,240.50", f"made {V}"), ("lost -$1.2M", f"lost {V}"), ("1.2k profit", f"{V} profit"),
    ("+$1,240", V), ("made $1,24", f"made {V}"), ("balance 48,210.55", f"balance {V}"),
    ("C$500 gain", f"{V} gain"), ("1,240 USD back", f"{V} back"), ("5 grand", V),
    ("buying power 25,000", f"buying power {V}"), ("cash 0.5 left", f"cash {V} left"),
]


@pytest.mark.parametrize("line, want", MONEY_CASES)
def test_R11_money_forms_are_one_money_entry_each(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"], changes


#: Probe B verbatim (account ids in text), plus ruling R10's other named forms.
ACCOUNT_CASES = [
    ("acct ...4821", f"acct ...{V}", ["account"]), ("account #12345678", f"account #{V}", ["account"]),
    ("Acct 12345678 at the desk", f"Acct {V} at the desk", ["account"]),
    ("acct ending 4821", f"acct ending {V}", ["account"]), ("IBKR U1234567", f"{B} {V}", ["broker", "account"]),
    ("card 1234 5678 9012 3456", f"card {V}", ["account"]), ("routing 021000021", f"routing {V}", ["account"]),
    ("ref 98765432", f"ref {V}", ["account"]), ("it ends in 4821", f"it ends in {V}", ["account"]),
    # P3b-T2-R16: a run joins across separators only as 4-digit groups or across dashes
    ("1234 5678 9012 3456 on file", f"{V} on file", ["account"]), ("ref 12-3456-789 here", f"ref {V} here", ["account"]),
    ("it was 12345678 then", f"it was {V} then", ["account"]),
]


@pytest.mark.parametrize("line, want, kind", ACCOUNT_CASES)
def test_R10_account_ids_in_text_are_replaced(line, want, kind):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == kind, changes


@pytest.mark.parametrize("line", ["NVDA 132.40 support", "bought 1500 shares", "on 2026-10-17 we met",
                                  "acct up 12 today",
                                  # P3b-T2-R16: price levels survive -- a level in a plan is the point
                                  "targets 145 150 155", "levels 132.40 135 140", "stops 98 95"])
def test_R10_CONTROL_prices_counts_and_dates_are_not_account_ids(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


#: Probe C verbatim (P&L figures and the trigger list).
PNL_CASES = [
    ("P/L 3.2R", f"P/L {V}"), ("PnL +2.5R", f"PnL {V}"), ("net +4.5%", f"net {V}"),
    ("realized 2R", f"realized {V}"), ("drawdown 8%", f"drawdown {V}"), ("returned 15%", f"returned {V}"),
    ("closed +3.2R", f"closed {V}"), ("4% loss today", f"{V} loss today"), ("stopped -1R", f"stopped {V}"),
    ("win rate 62%", f"win rate {V}"), ("account down 12%", f"account down {V}"), ("up 1,240%", f"up {V}"),
    ("made 3.2r", f"made {V}"), ("booked +2R", f"booked {V}"), ("2R profit on it", f"{V} profit on it"),
]


@pytest.mark.parametrize("line, want", PNL_CASES)
def test_R12_pnl_figures_with_the_wider_trigger_list(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["pnl_figure"], changes


@pytest.mark.parametrize("line", ["R:R 3", "the 3rd attempt", "NVDA 3.2R target then", "a 12% move later on"])
def test_R12_CONTROL_no_trigger_on_either_side_keeps_the_figure(line):
    assert texts_in(ex(text_doc(line))) == [line]


@pytest.mark.parametrize("line, want", [
    ("see https://www.fidelity.com/acct/12345678 for it", "see link for it"),     # probe D verbatim
    ("visit www.schwab.com.", "visit link."),
    ("(https://example.com/a?b=1)", "(link)"),
])
def test_R9_a_url_in_prose_is_replaced_whole(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["link"]


def test_R9_the_url_pass_runs_first_so_no_other_pass_edits_inside_an_address():
    changes: list = []
    out = ex(text_doc("see https://x.com/u/me@example.com/12345678?p=$1,240 now"), report=changes)
    assert texts_in(out) == ["see link now"]
    assert kinds(changes) == ["link"]


# ── fix round 2 (rulings P3b-T2-R18..R22): the re-reviewer's probe inputs, verbatim ────

#: Probe group 2 verbatim, plus R18's two shapes: a listed TLD with or without a path, ANY host.tld + "/".
BARE_DOMAIN_CASES = [
    ("schwab.com/acct/123", "link"), ("schwab.com/acct/4821", "link"),
    ("see client.schwab.com/accounts/482193 now", "see link now"), ("fidelity.com/12345678", "link"),
    ("robinhood.com/account?id=4821", "link"), ("my page: tradingview.com/u/patrick482", "my page: link"),
    ("mybank.com/acct/4821?email=me@example.com", "link"),
    ("go to schwab.com.", "go to link."), ("ask on example.io today", "ask on link today"),
    ("mybroker.xyz/acct/4821 here", "link here"),
]


@pytest.mark.parametrize("line, want", BARE_DOMAIN_CASES)
def test_R18_a_bare_domain_is_replaced_whole(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["link"], changes


def test_R18_a_bare_domain_in_a_code_mark_is_replaced_whole():
    """Probe group 1 verbatim."""
    out = ex(doc(p(t("schwab.com/acct/4821", {"type": "code"}))))
    assert texts_in(out) == ["link"]


@pytest.mark.parametrize("line", ["BRK.B", "U.S.", "e.g.", "3.2R", "v1.2", "NVDA 132.40",
                                  "BRK.B and U.S. data, e.g. v1.2 at 3.2R"])
def test_R18_CONTROL_tickers_abbreviations_versions_and_prices_are_not_domains(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


#: Probe groups 12 and 13 verbatim (R19's prefixes and glued `$`).
COUNTRY_DOLLAR_CASES = [
    ("made US$1,240", f"made {V}"), ("made CA$1,240", f"made {V}"), ("made HK$500", f"made {V}"),
    ("made S$500", f"made {V}"), ("made R$500", f"made {V}"), ("made NZ$500", f"made {V}"),
    ("made$1,240", f"made {V}"),                     # R25: one space where the replacement was glued
]


@pytest.mark.parametrize("line, want", COUNTRY_DOLLAR_CASES)
def test_R19_a_country_prefix_or_a_glued_dollar_sign_is_money(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"], changes


@pytest.mark.parametrize("line", ["$NVDA ripped", "watching$NVDA", "US$ only"])
def test_R19_CONTROL_a_cashtag_with_no_digit_stays(line):
    assert texts_in(ex(text_doc(line))) == [line]


#: Probe group 13 verbatim, plus R20's named controls.
BARE_NUMBER_CASES = [
    ("made 1,240 on NVDA", f"made {V} on NVDA"), ("P&L 1,240", f"P&L {V}"), ("P&L: -1,240", f"P&L: {V}"),
    ("lost 2k", f"lost {V}"), ("up 5k today", f"up {V} today"), ("down 1.2k", f"down {V}"),
    ("net liq 48k", f"net liq {V}"), ("bal 48,210", f"bal {V}"), ("up 1,240 today", f"up {V} today"),
    ("realized 350 on it", f"realized {V} on it"), ("cash 500 idle", f"cash {V} idle"),
]


@pytest.mark.parametrize("line, want", BARE_NUMBER_CASES)
def test_R20_a_bare_number_after_a_pnl_or_balance_word_is_money(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"], changes


@pytest.mark.parametrize("line", ["up to 5850", "down to 132.40", "up 5850 then", "made 12 trades",
                                  "equity 12.5% of book", "cash 4.5% yield", "made 0.5 BTC"])
def test_R20_CONTROL_levels_small_counts_and_percents_stay(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


#: Probe group 14 verbatim (R21's narrowing of R16), and R21's named replacements.
@pytest.mark.parametrize("line", ["SPX 5800 5850", "ES levels 5850 5875 5900", "range 5850-5900", "on 10-17-2026",
                                  "on 10-17-2026 I", "fiscal year ending 2025", "the card from 2024",
                                  "account grew in 2025", "NQ 21000 21250", "BTC 65000 66000", "on 2026-10-17",
                                  "levels 5850 5875 5900 or 132.40"])
def test_R21_CONTROL_levels_ranges_dates_and_years_are_not_account_ids(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


@pytest.mark.parametrize("line, want", [
    ("1234 5678 9012 3456", V), ("12-3456-789", V), ("acct 4821", f"acct {V}"),
    ("card ending in 4821", f"card ending in {V}"), ("card ending with 4821", f"card ending with {V}"),
    ("phone 555-123-4567", f"phone {V}"), ("acct 2025", f"acct {V}"), ("routing # 1999", f"routing # {V}"),
])
def test_R21_card_shaped_dashed_and_keyword_numbers_are_account_ids(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["account"], changes


#: Probe group 12 verbatim (R22's currencies), and the space-grouped thousands (group 13).
CURRENCY_CASES = [
    ("made ₹1,240", f"made {V}"), ("made ₩50000", f"made {V}"), ("made ₽500", f"made {V}"),
    ("made ₿0.5", f"made {V}"), ("made CHF 1,240", f"made {V}"), ("made JPY 50000", f"made {V}"),
    ("made AUD 500", f"made {V}"), ("made NZD 500", f"made {V}"), ("made HKD 500", f"made {V}"),
    ("made SGD 500", f"made {V}"), ("made ＄1,240", f"made {V}"), ("made ￥1,240", f"made {V}"),
    ("made ¥1,240", f"made {V}"), ("made 1 240 €", f"made {V}"), ("$1 240", V),
    ("made €1.240,50", f"made {V}"), ("made $ 1,240", f"made {V}"),
]


@pytest.mark.parametrize("line, want", CURRENCY_CASES)
def test_R22_more_currencies_and_space_grouped_thousands_are_one_money_entry(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"], changes


# ── fix round 3 (rulings P3b-T2-R23..R25) ───────────────────────────────────────────────

@pytest.mark.parametrize("line, want", [
    ("ES 5850 5875 5900 5925", f"ES {V}"),                     # four 4-digit levels join: card-shaped
    ("card 1234 5678 9012", f"card {V} {V} {V}"),              # each group after "card", one by one
])
def test_R23_accepted_over_redaction_is_pinned(line, want):
    """Ruling P3b-T2-R23: privacy-safe over-redaction, visible in the preview, ACCEPTED -- pinned so
    it stays a decision rather than an accident."""
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert set(kinds(changes)) == {"account"}


#: "loss zone 140" and "profit area 150" left this list in fix round 4: ruling P3b-T2-R27 makes the
#: plan phrases an EXACT list that names neither, so both are replaced now (see the R27 test below).
@pytest.mark.parametrize("line", ["profit target 150", "stop loss 145", "take profit 160", "loss level 140",
                                  "profit taking at 155", "profit targets 150 and 160"])
def test_R24_plan_level_phrases_survive_the_pnl_word_money_rule(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


@pytest.mark.parametrize("line, want", [
    ("made 1,240 on NVDA", f"made {V} on NVDA"), ("lost 2k", f"lost {V}"), ("P&L 1,240", f"P&L {V}"),
    ("made 1,240 shares of NVDA", f"made {V} shares of NVDA"),   # share counts after a P&L word: as ruled
    ("stop loss 145, lost 2k", f"stop loss 145, lost {V}"),      # only the plan phrase is skipped
])
def test_R24_CONTROL_dollar_pnl_and_share_counts_are_still_replaced(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"], changes


@pytest.mark.parametrize("line, want, kind", [
    ("made$1,240", f"made {V}", "money"),
    ("ref abc12345678 here", f"ref abc {V} here", "account"),
    ("up3.2R today", f"up {V} today", "pnl_figure"),
])
def test_R25_a_replacement_glued_to_the_word_before_gets_one_space(line, want, kind):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == [kind]
    assert changes[0]["after"] == {"money": V, "account": V, "pnl_figure": V}[kind]   # the entry has no space


@pytest.mark.parametrize("line, want", [
    ("made $1,240", f"made {V}"), ("(-$500) on it", f"({V}) on it"), ("account #12345678", f"account #{V}"),
    ("acct ...4821", f"acct ...{V}"), ("see https://x.com/a now", "see link now"),
])
def test_R25_CONTROL_never_a_double_space_and_never_after_punctuation(line, want):
    out = texts_in(ex(text_doc(line)))
    assert out == [want] and "  " not in out[0]


# ── fix round 4 (rulings P3b-T2-R26..R28) ───────────────────────────────────────────────

#: Ruling P3b-T2-R26's survive rows verbatim, then the connectors it names and the level lists that
#: must stay levels: a plan phrase keeps a number only when the number is the VERY NEXT token after
#: it, with at most one connector (at, @, ":", near, ~) between -- "of" left the list in round 5
#: (ruling P3b-T2-R30) -- and is unsigned with no k/m suffix (P3b-T2-R31; comma groups are fine).
R26_SURVIVE = ["profit target 150", "stop loss 145", "take profit 160", "loss level 140", "profit taking at 155",
               "stop loss @ 98.5",
               "stop loss: 145", "stop loss ~145", "stop loss near 145", "profit target at 150",
               "stop loss 5,850", "profit target 1,250.50",
               "loss levels 140", "Stop Loss 145", "profit targets 150 and 160", "stop loss 145 profit target 160",
               "stop loss 145 take profit 160"]


@pytest.mark.parametrize("line", R26_SURVIVE)
def test_R26_a_level_directly_after_a_plan_phrase_survives(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


#: Review finding I-1's rows (task-2-r3-rereview.md), the ruling's nine verbatim first: a P&L figure
#: written after a plan phrase, with words between, is replaced. (R30 and R31's rows are below.)
I1_ROWS = [
    ("stop loss hit for 2k", f"stop loss hit for {V}"),
    ("stop loss hit -2,000", f"stop loss hit {V}"),
    ("stop loss cost 2,000", f"stop loss cost {V}"),
    ("stop loss triggered 1,500", f"stop loss triggered {V}"),
    ("profit target hit +1,240", f"profit target hit {V}"),
    ("profit target hit: 1240", f"profit target hit: {V}"),
    ("take profit and banked 1,240", f"take profit and banked {V}"),
    ("profit taking netted 1,240", f"profit taking netted {V}"),
    ("take profit 1,240 realized", f"take profit {V} realized"),     # a P&L word AFTER wins (R26)
    ("stop loss hit -2k", f"stop loss hit {V}"),
    ("stop loss hit, 2k", f"stop loss hit, {V}"),
    ("stop loss cost me 2k", f"stop loss cost me {V}"),
    ("profit target hit 1,240", f"profit target hit {V}"),
    ("loss level hit 1,240", f"loss level hit {V}"),
    ("Stop Loss hit for 2k", f"Stop Loss hit for {V}"),
    ("STOP LOSS HIT FOR 2K", f"STOP LOSS HIT FOR {V}"),
    ("stop loss at @ 145", f"stop loss at @ {V}"),                    # two connectors: not adjacent
]


@pytest.mark.parametrize("line, want", I1_ROWS)
def test_R26_a_pnl_figure_after_a_plan_phrase_with_words_between_is_replaced(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"], changes


#: Ruling P3b-T2-R27 (review M-1): the exempt phrases are an EXACT list, not take|stop + any P&L
#: word. The ruling's three rows verbatim, then R24's zone/area forms, which the exact list leaves out.
@pytest.mark.parametrize("line, want", [
    ("take gain 1,240", f"take gain {V}"), ("take loss 1,240", f"take loss {V}"),
    ("stop profit 1,240", f"stop profit {V}"),
    ("loss zone 140", f"loss zone {V}"), ("profit area 150", f"profit area {V}"),
    ("loss target 140", f"loss target {V}"), ("profit level 150", f"profit level {V}"),
])
def test_R27_only_the_declared_plan_phrases_are_exempt(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"], changes


def test_R27_the_plan_phrases_and_connectors_are_the_ruled_lists():
    assert xs.PLAN_PHRASES == ("stop loss", "take profit", "profit target", "profit targets", "loss level",
                               "loss levels", "profit taking")
    assert xs.PLAN_CONNECTORS == ("at", "@", ":", "near", "~")     # R30: "of" removed


def test_R27_the_plan_phrases_are_declared_once():
    """Each plan phrase is ONE string constant in example_sanitize (its declared tuple), and the R24
    take|stop word lists are gone, so nothing else can grant the exemption."""
    tree = ast.parse(SANITIZE_PY.read_text(encoding="utf-8"))
    docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                  if isinstance(n, (ast.Module, ast.FunctionDef, ast.ClassDef)) and n.body
                  and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
    consts = [n.value.casefold() for n in ast.walk(tree)
              if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings]
    for phrase in xs.PLAN_PHRASES:
        assert consts.count(phrase) == 1, phrase
    bound = [n for n in ast.walk(tree)
             if (isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "PLAN_PHRASES" for t in n.targets))
             or (isinstance(n, ast.AnnAssign) and getattr(n.target, "id", "") == "PLAN_PHRASES")]
    assert len(bound) == 1, bound
    assert not hasattr(xs, "PLAN_WORDS_AFTER") and not hasattr(xs, "PLAN_WORDS_BEFORE")


# ── fix round 5 (rulings P3b-T2-R30, R31) ───────────────────────────────────────────────

#: R30: "of" is no connector ("stop loss of 1,240" reads as a dollar loss). R31: the exemption keeps
#: only an UNSIGNED number with no k/m suffix. The rulings' rows verbatim, then the obvious kin.
@pytest.mark.parametrize("line, want", [
    ("stop loss of 1,240", f"stop loss of {V}"), ("stop loss of 145", f"stop loss of {V}"),
    ("stop loss 2k", f"stop loss {V}"), ("stop loss -2,000", f"stop loss {V}"),
    ("take profit +1,240", f"take profit {V}"), ("profit target 1.2k", f"profit target {V}"),
    ("stop loss @ -500", f"stop loss @ {V}"), ("loss level 3M", f"loss level {V}"),
    ("profit taking at +2k", f"profit taking at {V}"),
])
def test_R30_R31_of_signed_and_k_m_numbers_are_not_plan_levels(line, want):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"], changes


@pytest.mark.parametrize("line", ["stop loss 5,850", "stop loss 145", "profit target 150", "take profit 160",
                                  "profit taking at 155", "stop loss @ 98.5"])
def test_R31_CONTROL_an_unsigned_plain_or_comma_grouped_level_survives(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


#: Ruling P3b-T2-R28: the two pre-existing leaks (task-2-r3-rereview.md, out-of-scope observations).
@pytest.mark.parametrize("line, want, n", [
    ("$500$600", f"{V} {V}", 2),                       # a second `$` amount glued to the first
    ("made$1,240$500", f"made {V} {V}", 2),
    ("madeUSD 1,240", f"made {V}", 1),                 # a currency code glued to a word, R25's spacing
    ("netEUR 500", f"net {V}", 1),
])
def test_R28_glued_amounts_and_a_glued_currency_code_are_money(line, want, n):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [want]
    assert kinds(changes) == ["money"] * n, changes
    assert all(c["after"] == V for c in changes)       # the entry carries no space (R25)


@pytest.mark.parametrize("line", ["BTCUSD 65000", "EURUSD 1.0850", "fraud 500", "USDCAD 1.36"])
def test_R28_CONTROL_a_currency_pair_and_an_ordinary_word_stay(line):
    changes: list = []
    assert texts_in(ex(text_doc(line), report=changes)) == [line]
    assert changes == []


# ── 6, 7, P3b-R10: trader blocks reset through their builder's NO-READ output ─────────────

def test_6_position_sizing_comes_out_with_the_builders_empty_params():
    changes: list = []
    out = ex(doc(block("positionSizing", {"grade": "B", "accountSize": 25000, "riskPct": 1})), report=changes)
    w = find(out, "widgetEmbed")
    assert len(w) == 1 and w[0]["attrs"]["widgetId"] == "positionSizing"
    assert w[0]["attrs"]["params"] == empty_params("positionSizing") == {"grade": "A"}
    blob = json.dumps(out)
    assert "25000" not in blob and "my caption" not in blob and "e-author" not in blob
    assert w[0]["attrs"]["capturedAt"] is None and w[0]["attrs"].get("embedId") is None   # never today's stamp
    assert "block_reset" in kinds(changes)
    reset = [c for c in changes if c["kind"] == "block_reset"][0]
    assert "25000" in reset["before"] and len(reset["before"]) <= xs.BEFORE_MAX


def test_7_a_trade_review_block_loses_its_trade():
    changes: list = []
    out = ex(doc(block("tradeReview", {"tradeId": "trade-123"})), report=changes)
    assert find(out, "widgetEmbed")[0]["attrs"]["params"] == {"tradeId": ""}
    assert "trade-123" not in json.dumps(out)
    assert "block_reset" in kinds(changes)


#: The readers a review named (trader_blocks.READS_ON_CREATE's builders and what they call). A FLOOR:
#: the set the spy patches is DERIVED below (M-5), and must hold every one of these.
KNOWN_READERS = ("_regime_field", "_breadth", "_quotes", "price_stamp_quote", "market_context_params",
                 "prep_part", "_my_names", "_cached_quote", "_last_close", "_frozen_close",
                 "recent_closed_trades", "trade_review", "save_pre_entry", "_prep_wire", "_prep_earnings",
                 "_prep_movers", "_prep_levels")
#: The one importing function a reset may call: `_node` imports journal_styles for a block's static label.
RESET_MAY_CALL = {"_node"}


def derived_readers() -> list[str]:
    """Every top-level function in trader_blocks.py that imports a module inside its body (a store, a
    vendor, the engine, the database), or calls one that does, transitively: the doors a read goes
    through. A new reader is covered the day it lands. The block BUILDERS themselves are left out:
    the reset calls them, and their no-read branch is exactly what the spy proves."""
    tree = ast.parse((ROOT / "api" / "services" / "journal_two" / "trader_blocks.py").read_text(encoding="utf-8"))
    funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    calls = {name: {c.func.id for c in ast.walk(fn) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
             for name, fn in funcs.items()}
    readers = {name for name, fn in funcs.items()
               if name not in RESET_MAY_CALL and any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(fn))}
    while True:
        more = {name for name in funcs if name not in readers and name not in RESET_MAY_CALL
                and calls[name] & readers}
        if not more:
            break
        readers |= more
    builders = {getattr(f, "__name__", "") for f in tb.BUILDERS.values()}
    return sorted(readers - builders)


READERS = tuple(derived_readers())


def test_M5_the_reader_set_is_derived_and_holds_the_known_ones():
    assert set(KNOWN_READERS) <= set(READERS), sorted(set(KNOWN_READERS) - set(READERS))


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
    assert find(out, "image")[0]["attrs"] == {"src": GALLERY_IMG + "a", "alt": "my account page", "width": 300}
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
    assert "image" not in types_in(ex(body, images_on={src}, image_src_for=lambda s: "https://cdn.example/a.png"))
    assert "image" not in types_in(ex(body))                                       # off by default
    # the switch names the ORIGINAL src: the attachment prefix is not rewritten in example mode
    assert "image" in types_in(ex(body, images_on={src}, image_src_for=_src_for))


#: Probe I verbatim: switched on, and still not this note's own attachment.
FOREIGN_IMAGES = {
    "another member's attachment": ("/api/j2/notes/attachments/VICTIM/THEIR-NOTE/inline/secret.png",
                                    lambda s: "/api/j2/template-gallery/I/images/x"),
    "an external tracker": ("https://tracker.example/pixel.png?u=owner-1", lambda s: s),
    "another note of this member": (f"{OTHER_ATT}inline/c.png", _src_for),
    "a path that climbs out": (f"{OWN_ATT}inline/../../{OTHER}/inline/c.png", _src_for),
}


@pytest.mark.parametrize("case", sorted(FOREIGN_IMAGES))
def test_R13_an_image_is_kept_only_when_it_is_this_notes_own_attachment(case):
    src, src_for = FOREIGN_IMAGES[case]
    changes: list = []
    out = ex(doc({"type": "image", "attrs": {"src": src}}), images_on={src}, image_src_for=src_for, report=changes)
    assert "image" not in types_in(out), out
    assert "secret" not in json.dumps(out) and "tracker" not in json.dumps(out)
    assert kinds(changes) == ["image_off"]


# ── P3b-T2-R8: links, link cards and web embeds ─────────────────────────────────────────

def test_R8_a_link_mark_is_removed_and_its_words_stay_scrubbed():
    """Probe D verbatim: the href carried a broker domain, an account number and an email."""
    changes: list = []
    link = {"type": "link", "attrs": {"href": "https://client.schwab.com/accounts/12345678?email=me@example.com"}}
    out = ex(doc(p(t("my statement", link)), p(t("at Schwab", {"type": "link", "attrs": {"href": "https://example.com"}}))),
             report=changes)
    assert texts_in(out) == ["my statement", f"at {B}"]
    blob = json.dumps(out)
    assert '"link"' not in blob and "schwab" not in blob.lower() and "12345678" not in blob and "@" not in blob
    assert kinds(changes) == ["link", "broker", "link"]           # a node's text, then its marks
    assert_paths_point_at_their_after(out, changes)


def test_R8_a_link_card_is_dropped():
    changes: list = []
    out = ex(doc({"type": "linkPreview", "attrs": {
        "url": "https://client.schwab.com/accounts/12345678", "title": "Schwab account 12345678",
        "description": "Balance $48,210", "domain": "client.schwab.com", "image": None}}, p(t("kept"))), report=changes)
    assert texts_in(out) == ["kept"] and "linkPreview" not in types_in(out)
    assert "schwab" not in json.dumps(out).lower()
    assert kinds(changes) == ["dropped"]


def test_R8_a_web_embed_is_dropped():
    changes: list = []
    out = ex(doc({"type": "webEmbed", "attrs": {"provider": "youtube", "ref": "abcdefghijk",
                                                "url": "https://robinhood.com/account/12345678"}}), report=changes)
    assert "webEmbed" not in types_in(out) and "robinhood" not in json.dumps(out)
    assert kinds(changes) == ["dropped"]


# ── P3b-T2-R7: a formula holding a replacement is replaced whole ───────────────────────

def test_R7_an_inline_formula_with_an_amount_becomes_your_value_here():
    """Probe E verbatim."""
    changes: list = []
    out = ex(doc(p(t("x "), {"type": "inlineMath", "attrs": {"latex": r"\$1,240 \times 3"}})), report=changes)
    assert texts_in(out) == ["x ", V] and "inlineMath" not in types_in(out)
    assert kinds(changes) == ["money"] and changes[0]["path"] == [0, 1]
    assert_paths_point_at_their_after(out, changes)


def test_R7_a_block_formula_with_an_amount_becomes_a_paragraph():
    changes: list = []
    out = ex(doc({"type": "blockMath", "attrs": {"latex": r"P = \$48,210"}}), report=changes)
    assert out["content"] == [{"type": "paragraph", "content": [{"type": "text", "text": V}]}]
    assert kinds(changes) == ["money"]


def test_R7_CONTROL_a_formula_with_nothing_to_replace_is_kept_verbatim():
    body = doc(p({"type": "inlineMath", "attrs": {"latex": r"\pi r^2"}}), {"type": "blockMath", "attrs": {"latex": "E=mc^2"}})
    changes: list = []
    assert ex(body, report=changes) == gallery(body) and changes == []


def test_R7_the_split_across_marks_limit_is_recorded():
    """A known limit by ruling, not a fix: the docstring says so, and so does this pin (probe H)."""
    assert "split across" in (xs.__doc__ or "") and "KNOWN LIMIT" in (xs.__doc__ or "")
    out = ex(doc(p(t("made $1,"), t("240", {"type": "bold"}), t(" today"))))
    assert texts_in(out)[1] == "240"


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


def test_R4_a_kept_images_alt_text_is_kept_and_scrubbed_and_its_title_goes():
    """Probe F verbatim (ruling P3b-T2-R4; the dropped title is reported, M-1)."""
    src = f"{OWN_ATT}inline/a.png"
    changes: list = []
    out = ex(doc({"type": "image", "attrs": {"src": src, "alt": "made $1,240 at Schwab", "title": "acct 12345678"}}),
             images_on={src}, image_src_for=_src_for, report=changes)
    img = find(out, "image")[0]["attrs"]
    assert img == {"src": GALLERY_IMG + "a", "alt": f"made {V} at {B}"}
    assert kinds(changes) == ["money", "broker", "dropped"]
    assert_paths_point_at_their_after(out, changes)


# ── P3b-T2-R5: a change entry's path addresses the REDUCED body ────────────────────────

def test_R5_the_path_skips_what_was_dropped_before_it():
    """Probe K verbatim: the paragraph is at reduced index 0, not author index 2."""
    changes: list = []
    out = ex(doc({"type": "attachmentChip", "attrs": {}}, {"type": "widgetEmbed", "attrs": {"widgetId": "notebook"}},
                 p(t("made $1,240"))), report=changes)
    assert [c.get("type") for c in out["content"]] == ["paragraph"]
    money = [c for c in changes if c["kind"] == "money"]
    assert [c["path"] for c in money] == [[0, 0]]
    assert_paths_point_at_their_after(out, changes)
    assert [c["path"] for c in changes if c["kind"] == "dropped"] == [[0], [0]]   # the insertion point


def test_R5_nested_drops_collapsed_neutral_lines_and_a_reset_block_point_at_the_reduced_node():
    changes: list = []
    body = doc({"type": "callout", "attrs": {"variant": "note"}, "content": [
                   {"type": "askInsert", "attrs": {"question": "q"}, "content": [p(t("an answer"))]},
                   p(t("lost $500 at Fidelity"))]},
               block("chart", {}), block("themes", {}), block("positionSizing", {"accountSize": 25000}),
               {"type": "financialFact", "attrs": {"factId": "fact-fmp"}})
    out = ex(body, report=changes)
    assert_paths_point_at_their_after(out, changes)
    by_kind = {}
    for c in changes:
        by_kind.setdefault(c["kind"], []).append(c["path"])
    assert by_kind["money"] == [[0, 0, 0]] and by_kind["broker"] == [[0, 0, 0]]
    assert by_kind["market_data"] == [[1], [1]]                    # ONE neutral line for the run
    assert by_kind["block_reset"] == [[2]] and by_kind["fact"] == [[3]]
    assert at_path(out, [2])["attrs"]["widgetId"] == "positionSizing"


# ── M-1, M-2: nothing goes silently; the reset block carries only the allowlist ────────

def test_M1_a_dropped_formula_an_unknown_mark_and_an_unknown_node_are_reported():
    changes: list = []
    out = ex(doc(p(t("a "), {"type": "inlineMath", "attrs": {"latex": r"\href{x}{y}"}}),       # probe O
                 p(t("word", {"type": "comment", "attrs": {"id": "c1"}})),
                 {"type": "brandNewNode"}), report=changes)
    assert texts_in(out) == ["a ", "word"]
    assert kinds(changes) == ["dropped", "dropped", "dropped"]


def test_M2_a_reset_block_carries_only_the_embed_allowlist():
    """Probe L verbatim."""
    changes: list = []
    out = ex(doc({"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "positionSizing", "embedId": "e",
                                                   "params": {"accountSize": 25000}, "caption": "my $25k acct",
                                                   "tradeRef": "t-1", "ta": {"plan": 1}}}), report=changes)
    attrs = out["content"][0]["attrs"]
    assert set(attrs) <= set(pnp.EMBED_KEPT_ATTRS) | {"params"}, sorted(attrs)
    assert "25k" not in json.dumps(out) and attrs["caption"] is None
    assert sorted(kinds(changes)) == ["block_reset", "dropped", "trade_link"]   # the caption is reported


# ── R6: every kind is documented ────────────────────────────────────────────────────────

@pytest.mark.parametrize("kind", xs.KINDS)
def test_R6_every_change_kind_is_documented_in_the_module(kind):
    assert f"`{kind}`" in (pnp.__doc__ or ""), kind


def _docstring_table_kinds() -> list[str]:
    """The kinds the payload docstring's table lists: each row starts with a backticked kind."""
    doc_ = pnp.__doc__ or ""
    table = doc_[doc_.index("The change entries"):]
    return re.findall(r"^\s{4,}`([a-z_]+)`\s{2,}", table, re.M)


def test_R22_the_docstring_table_is_exactly_the_exported_kinds():
    rows = _docstring_table_kinds()
    assert rows and len(rows) == len(set(rows)), rows
    assert set(rows) == set(xs.KINDS), (sorted(set(rows) ^ set(xs.KINDS)))
    assert len(xs.KINDS) == len(set(xs.KINDS)) and isinstance(xs.KINDS, tuple)


def emitted_kinds() -> set[str]:
    """Every change kind the two modules CAN emit, read by AST (review N-8): the first argument of
    every `note(...)` / `ctx.note(...)` / `self.note(...)` call (both arms of a conditional), every
    constant `"kind": ...` dict value, every `kind = <constant or conditional>` assignment, and the
    keys of example_sanitize's `_AFTER` table."""
    found: set[str] = set()

    def consts(node) -> set[str]:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return {node.value}
        if isinstance(node, ast.IfExp):
            return consts(node.body) | consts(node.orelse)
        return set()

    for path in (SANITIZE_PY, PAYLOAD_PY):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for n in ast.walk(tree):
            if isinstance(n, ast.Call) and n.args:
                f = n.func
                name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else "")
                if name == "note":
                    found |= consts(n.args[0])
            elif isinstance(n, ast.Dict):
                for k, v in zip(n.keys, n.values):
                    if isinstance(k, ast.Constant) and k.value == "kind":
                        found |= consts(v)
            elif isinstance(n, ast.Assign) and any(isinstance(tg, ast.Name) and tg.id == "kind" for tg in n.targets):
                found |= consts(n.value)
            elif isinstance(n, ast.Assign) and any(isinstance(tg, ast.Name) and tg.id == "_AFTER" for tg in n.targets):
                found |= {k.value for k in n.value.keys if isinstance(k, ast.Constant)}
    return found


def test_R22_every_kind_the_code_can_emit_is_exactly_the_exported_kinds():
    found = emitted_kinds()
    assert "image_off" in found and "account" in found, f"non-vacuity: {sorted(found)}"
    assert found == set(xs.KINDS), sorted(found ^ set(xs.KINDS))


# ── 18: OCR warnings ────────────────────────────────────────────────────────────────────

def test_18_ocr_warnings_name_digits_money_and_brokers():
    got = xs.ocr_warnings("Acct 12345678 bal $48,210 Fidelity", xs.BROKER_NAMES)
    assert got == [{"kind": "digits", "match": "12345678"}, {"kind": "money", "match": "$48,210"},
                   {"kind": "broker", "match": "Fidelity"}]


def test_18_a_digit_run_counts_through_spaces_and_dashes_and_a_short_one_does_not():
    assert xs.ocr_warnings("card 1234-5678 9012", ()) == [{"kind": "digits", "match": "1234-5678 9012"}]
    assert xs.ocr_warnings("NVDA 132.40 on 10/17, 12345", ()) == []


# ── P3b-R3: the example decision IS gallery's, except the declared override set ─────────

#: P3b-R3's three, and ruling P3b-T2-R8's: a link card, a web embed and the link mark are dropped.
DECLARED_OVERRIDES = {"image", "imageFigure", "imageCaption", "linkPreview", "webEmbed", "link"}


def test_R3_the_override_set_is_exactly_the_declared_set():
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


def test_19_example_sanitize_imports_nothing_but_re():
    tree = ast.parse(SANITIZE_PY.read_text(encoding="utf-8"))
    every = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            every |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            every.add((node.module or "").split(".")[0])
    assert every <= {"re", "__future__"}, every


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


# ── P3b-F-R1 (final review C-1): the scrub is LINEAR in a text node's length ───────────────────────────
#
# The scrub re-split the whole prefix of a text node for every number (`_words(text[:at])`), and three of its
# regexes re-scanned a long run from every start inside it: 70 KB of a pasted trade CSV took 22.7 s and 200 KB
# about three minutes, all of it holding the GIL of the one web process. The rails below hold the fix to two
# things at once: the output did not move by one byte (every rewritten piece equals the old one), and the cost
# grows with the text, not with its square.

#: The three patterns as they were before P3b-F-R1, VERBATIM: the reference the rewritten ones must equal.
_OLD_PNL = re.compile(r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(?:[Rr]|%)(?!\w)")
_OLD_SPACED = re.compile(rf"(?<![\w.,$]){xs._NUM_SPACED}\s?(?:{xs._CURRENCY}|\$)(?!\w)", re.IGNORECASE)
_OLD_URL = re.compile(
    r"(?<![\w@.-])(?:[A-Za-z][A-Za-z0-9+.-]*://|www\.)" + xs._URL_TAIL + r"+"
    + r"|(?<![\w@./-])" + xs._HOST + r"(?:" + "|".join(xs.URL_TLDS) + r")(?![\w-])(?:[/?#]" + xs._URL_TAIL + r"*)?"
    + r"|(?<![\w@./-])" + xs._HOST + r"[A-Za-z]{2,}/" + xs._URL_TAIL + r"+",
    re.IGNORECASE)


def _corpus() -> list[str]:
    """Every string literal of this file (the cases every rule above is pinned on) plus the shapes that made the
    old scrub quadratic, short and long."""
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    out = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)
           and 0 < len(n.value) <= 2000}
    shapes = ["145 150 155 160 €", "1234 567 890 €", "x123 456 789 €", "123 45 678 €", "(12 345 €", "12 345.67 €",
              "1,2345%", "12345,678,901%", "1,23,456%", "1234,567,890%", "123,456,789", "1234567890R",
              "a+b+http://x.com/p", "x.com+http://y", "é+abc://q", "ſ+k://z", "C++ and a+b", "www.x.io+www.y.io",
              "acct # no 2024", "card ending in 4421", ";;;;up 1,240", "made;" * 20 + "1,240", "1;2;3;4 profit 1,240"]
    out.update(shapes)
    out.update(s * 40 for s in shapes)
    return sorted(out)


@pytest.mark.parametrize("ref,new", [
    (_OLD_PNL, lambda t: [m.span() for m in xs._PNL.finditer(t)]),
    (_OLD_SPACED, lambda t: [m.span() for m in xs._MONEY_EXTRA[5].finditer(t)]),
    (_OLD_URL, xs._url_spans),
], ids=["pnl-figure", "spaced-amount", "address"])
def test_F_R1_each_rewritten_pattern_matches_exactly_what_the_old_one_did(ref, new):
    import itertools
    alphabets = {"pnl-figure": "1,%. +", "spaced-amount": "1 €,.$", "address": "a+.:/w "}
    cases = _corpus()
    for alpha in alphabets.values():                    # and every short string over the characters that matter
        cases += ["".join(p) for n in range(1, 6) for p in itertools.product(alpha, repeat=n)]
    differ = [c for c in cases if [m.span() for m in ref.finditer(c)] != new(c)]
    assert differ == [], differ[:5]
    assert any(ref.search(c) for c in cases), "non-vacuity: the reference matches somewhere in the corpus"


def test_F_R1_the_one_tokenisation_answers_exactly_what_the_prefix_split_did():
    """`_Words.before/after` against `_words(text[:at])` / `_words(text[at:])` at EVERY offset. A word longer than
    every vocabulary entry is compared as `_LONG_WORD` (it can match none of them either way)."""
    def capped(words):
        return [w if len(w) <= xs._WORD_CAP else xs._LONG_WORD for w in words]
    texts = [c for c in _corpus() if len(c) <= 400] + ["x" * 90 + ";up 1", ";" * 90 + "profit 1,240", "a" * 70]
    for text in texts:
        words = xs._Words(text)
        for at in range(len(text) + 1):
            for n in (1, 3, 4):
                assert words.before(at, n) == capped(xs._words(text[:at])[-n:]), (text, at, n)
            assert words.after(at, 2) == capped(xs._words(text[at:])[:2]), (text, at)
            assert words.count_before(at) == len(xs._words(text[:at])), (text, at)


def test_F_R1_a_word_is_cut_by_the_same_whitespace_str_split_cuts_on():
    import sys
    differ = [c for c in range(sys.maxunicode + 1) if (xs._TOKEN.fullmatch(chr(c)) is None) != chr(c).isspace()]
    assert differ == []


def test_F_R1_every_vocabulary_entry_is_shorter_than_the_long_word_cap():
    vocab = (xs.BALANCE_WORDS + xs.PNL_MONEY_WORDS + xs.UP_DOWN_WORDS + xs.PNL_WORDS + xs.PNL_WORDS_AFTER
             + xs.ACCOUNT_WORDS + xs.ACCOUNT_YEAR_WORDS + xs._YEAR_GAP_WORDS)
    assert max(len(w) for v in vocab for w in v.split()) < xs._WORD_CAP


#: The worst text node P3b-F-R1's measurement found, built from the shapes that cost the most per byte -- dense
#: amounts and P&L words, single digits, a token with no space in it -- and one run of EACH shape a rewritten
#: regex restarted on: a list of 3-digit levels (the spaced amount), a long digit run and a comma-grouped list
#: (the P&L figure), and "+"-joined words (the address scheme).
_WORST_UNITS = ("made 1,240 profit balance 12,345 up 2k down 1,500 acct 12345678 $1,240 EUR 500 3.2R loss "
                "stop loss 145 take profit 1,240 realized card ending in 4421 fiscal year 2025 # 2024 ",
                "145 150 155 160 ", "1 1 1 1 1 1 1 1 ", "1;2;3;4;5;6;7;8;", "$1 $2 1 240 € ", "1\u00a01\u00a0",
                "1234567890", "123,456,789,", "ab+cd+")
#: ⛔ The stated bound for a 200 KB worst-case body (measured well under it on this box; the old scrub took
#: minutes): through `scrub_text`, and through the reducer in example mode, as one text node.
COST_BOUND_S = 30.0


def _worst_text(n_bytes: int) -> str:
    per = n_bytes // len(_WORST_UNITS)
    return "".join((u * (per // len(u) + 1))[:per] for u in _WORST_UNITS)


def _timed(fn) -> float:
    import time
    best = None
    for _ in range(2):
        t0 = time.perf_counter()
        fn()
        took = time.perf_counter() - t0
        best = took if best is None else min(best, took)
    return best


def test_F_R1_the_scrub_reads_a_bounded_slice_per_number_never_the_prefix(monkeypatch):
    """The operation count: every `_words` split the scrub makes, summed. The old lookup split the whole prefix for
    each number, so this summed to the text's length times its numbers; now it is a bounded slice per number."""
    text = _worst_text(40_000)
    seen = []
    real = xs._words

    def counting(s):
        seen.append(len(s))
        return real(s)
    monkeypatch.setattr(xs, "_words", counting)
    xs.scrub_text(text, ("Acme Bank",), [])
    assert sum(seen) <= 2 * len(text), (sum(seen), len(text), len(seen))
    assert seen, "non-vacuity: the plan-phrase rule splits its bounded slice, so the counter sees calls"


def test_F_R1_four_times_the_text_costs_about_four_times_the_time():
    """The growth ratio: a quadratic scrub costs 16x for 4x the text, a linear one about 4x. Best of two runs each,
    and a bound well above 4 and well below 16, so a loaded box does not decide it."""
    small, large = _worst_text(25_000), _worst_text(100_000)
    t_small = _timed(lambda: xs.scrub_text(small, ("Acme Bank",), []))
    t_large = _timed(lambda: xs.scrub_text(large, ("Acme Bank",), []))
    assert t_large / t_small < 8, (t_small, t_large)


def test_F_R1_a_200_kb_worst_case_body_reduces_inside_the_stated_bound():
    import time
    text = _worst_text(200_000)
    assert len(text) >= 199_000                         # non-vacuity: the body is the size the ruling names
    t0 = time.perf_counter()
    xs.scrub_text(text, ("Acme Bank",), [])
    t_scrub = time.perf_counter() - t0
    report: list = []
    t0 = time.perf_counter()
    out = ex(doc(p(t(text))), report=report)
    t_reduce = time.perf_counter() - t0
    assert t_scrub < COST_BOUND_S and t_reduce < COST_BOUND_S, (t_scrub, t_reduce)
    assert report and V in texts_in(out)[0]             # non-vacuity: it really replaced things on the way
