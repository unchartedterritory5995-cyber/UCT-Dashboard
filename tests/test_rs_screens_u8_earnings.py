"""RS screens unit U8, item D1: the earnings tag on a row.

A report inside the week changes what a setup means, so the four list screens lead
their row tags with ``earnings``. The server sends the tag's CODE and the row's
``days_to_earnings``; the client words it ("Earnings today", "Earnings tomorrow",
"Earnings in N days"). The date is known for under half the names, so nothing is shown
when it is NULL, and the method page says a row without the tag may still report soon.

What is held here:
  * which screens carry the tag, and that it is first;
  * that nothing carries it while ``RS_SCREENS_ENABLED`` is off;
  * that the column the client reads for it is a real snapshot column, stored whole;
  * that the window the client applies (``EARNINGS_TAG_MAX_DAYS`` in ``rsRows.js``) is
    the one the method page states (``rs_screens.EARNINGS_TAG_DAYS``): the two are
    separate copies by necessity (one is JavaScript), so this file reads both;
  * the method page's one sentence, and that its number is read, not typed.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.services.screener import methodology, rs_screens, snapshot_db
from api.services.screener import saved_screens as ss

ROOT = Path(__file__).resolve().parents[1]
RS_ROWS_JS = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "rsRows.js"

LIST_SCREENS = ("starter_rs_top_rating", "starter_rs_new_high", "starter_rs_nh_before_price",
                "starter_rs_leaders")
EXIT_WARNINGS = "starter_rs_exit_warning_5"


def _v2(monkeypatch):
    from api.services.signature import registry_defs
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)


@pytest.fixture
def on(monkeypatch):
    _v2(monkeypatch)
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")


@pytest.fixture
def off(monkeypatch):
    _v2(monkeypatch)
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)


def test_the_four_list_screens_lead_their_tags_with_earnings(on):
    by = {s["id"]: s for s in ss.starters()}
    for sid in LIST_SCREENS:
        tags = by[sid]["row"]["tags"]
        assert tags[0] == "earnings", (sid, tags)
        assert tags.count("earnings") == 1, (sid, tags)
    assert rs_screens.EARNINGS_TAG == "earnings"
    # the list screens are the ones that leave buyout names out: one definition of "list"
    assert set(LIST_SCREENS) == set(rs_screens.NO_BUYOUT_SCREENS)
    # RS exit warnings keeps its one tag
    assert by[EXIT_WARNINGS]["row"]["tags"] == ["new"]


def test_nothing_carries_the_tag_while_the_screens_are_off(off):
    for s in ss.starters():
        assert "row" not in s, s["id"]
    assert "rs_screens" not in methodology.all_methods()


def test_the_column_the_tag_reads_is_a_snapshot_column_stored_whole():
    """The client tests ``Number.isInteger(days_to_earnings)``: a REAL column would hand
    it 2.0 on some drivers and a text one "2", and the tag would never show."""
    assert "days_to_earnings" in snapshot_db.COLUMNS
    assert "days_to_earnings" in snapshot_db._INT


def test_the_client_applies_the_window_the_method_page_states():
    src = RS_ROWS_JS.read_text(encoding="utf-8")
    m = re.search(r"export const EARNINGS_TAG_MAX_DAYS = (\d+)\b", src)
    assert m, "rsRows.js no longer declares EARNINGS_TAG_MAX_DAYS"
    assert int(m.group(1)) == rs_screens.EARNINGS_TAG_DAYS
    # the tag asks the scan for exactly the column above
    # unit U12: the list also asks for the report's date, which the tag is now counted from
    assert re.search(r"earnings:\s*\['days_to_earnings', 'next_earnings_date'\]", src), \
        "the earnings tag's columns moved"


def test_the_method_page_says_the_date_is_shown_only_when_known(on):
    doc = methodology.all_methods()["rs_screens"]
    said = doc["earnings"]
    assert said == ("A row says when the stock next reports earnings only when that date is known "
                    "to us and is 5 days away or less, so a row without the tag may still have a "
                    "report coming.")
    # one sentence, plain, and no promise about what a missing tag means
    assert said.count(".") == 1 and said.isascii()
    assert "no earnings" not in said.lower()


def test_the_method_sentence_follows_a_changed_window(on, monkeypatch):
    monkeypatch.setattr(rs_screens, "EARNINGS_TAG_DAYS", 3)
    assert "is 3 days away or less" in methodology.rs_screens_section()["earnings"]
