"""Owner rulings 2026-09-29 on the letter's render endpoints.

/api/r/book:
  * ONE set of levels everywhere: a leadership row carrying the letter's
    trade-card levels (card_entry / card_stop / card_t1 / card_t2) is shown
    with exactly those; a row without card_entry takes the original
    entry_px/stop_px/t1_px/t2_px -> prose path, unchanged (the controls).
  * no internal score in the payload (the rendered board dropped its score
    badge); the score still ORDERS the rows.
/api/r/econ:
  * Fed rows pass speaker/title through so the panel can name a speaker.
"""
from __future__ import annotations

import pytest

from api.routers import render_panels as rp


def _row(**kw):
    base = {"sym": "nvda", "theme": "AI Semis", "setup_type": "VCP", "score": 80,
            "price": 180.0, "entry_px": 182.5, "stop_px": 171.2, "t1_px": 195.0, "t2_px": 210.0,
            "entry": "$182.50 break", "stop": "$171.20", "target_1": "$195", "target_2": "$210"}
    base.update(kw)
    return base


# ── _levels_for_book ───────────────────────────────────────────────────────

def test_card_levels_win_when_present():
    lv = rp._levels_for_book(_row(card_entry=183.1, card_stop=174.0, card_t1=199.5, card_t2=215))
    assert lv == {"entry": 183.1, "stop": 174.0, "t1": 199.5, "t2": 215.0, "levels_source": "card"}


def test_card_levels_are_never_mixed_with_engine_levels():
    # a card with no targets must NOT borrow the engine's t1/t2
    lv = rp._levels_for_book(_row(card_entry=183.1, card_stop=174.0))
    assert lv == {"entry": 183.1, "stop": 174.0, "t1": None, "t2": None, "levels_source": "card"}


def test_card_levels_accept_numeric_strings():
    lv = rp._levels_for_book(_row(card_entry="183.10", card_stop="174", card_t1="199.5", card_t2=""))
    assert (lv["entry"], lv["stop"], lv["t1"], lv["t2"]) == (183.1, 174.0, 199.5, None)


@pytest.mark.parametrize("bad", [None, "", 0, -5, "n/a"])
def test_CONTROL_absent_or_invalid_card_entry_takes_the_old_engine_path(bad):
    kw = {} if bad is None else {"card_entry": bad}
    lv = rp._levels_for_book(_row(**kw))
    assert lv == {"entry": 182.5, "stop": 171.2, "t1": 195.0, "t2": 210.0, "levels_source": "engine_px"}


def test_CONTROL_insane_engine_px_still_falls_back_to_the_prose():
    lv = rp._levels_for_book(_row(entry_px=1.0, stop_px=0.9, t1_px=1.1, t2_px=1.2,
                                  entry="$1,020.50 break", stop="$980", target_1="$1,100", target_2="$1,180",
                                  price=1015.0))
    assert lv == {"entry": 1020.5, "stop": 980.0, "t1": 1100.0, "t2": 1180.0, "levels_source": "prose"}


def test_CONTROL_a_row_with_no_levels_anywhere_is_all_none():
    lv = rp._levels_for_book({"sym": "PLTR", "price": 150})
    assert (lv["entry"], lv["stop"], lv["t1"], lv["t2"]) == (None, None, None, None)


# ── render_book ────────────────────────────────────────────────────────────

@pytest.fixture
def wire(monkeypatch):
    from api.services import engine as eng
    holder = {"wire": {}}
    monkeypatch.setattr(eng, "_load_wire_data", lambda: holder["wire"])
    monkeypatch.setattr(rp, "_check_token", lambda *a, **k: None)
    return holder


def test_render_book_sends_no_score_but_still_orders_by_it(wire):
    wire["wire"] = {"date": "2026-09-29", "leadership": [
        _row(sym="low", score=10), _row(sym="high", score=90, card_entry=183.1, card_stop=174.0),
    ]}
    out = rp.render_book(token="x", part=0)
    assert [r["sym"] for r in out["rows"]] == ["HIGH", "LOW"]
    assert [r["rank"] for r in out["rows"]] == [1, 2]
    assert all("score" not in r for r in out["rows"])
    assert out["rows"][0]["levels_source"] == "card"
    assert out["rows"][0]["entry"] == 183.1
    assert out["rows"][1]["levels_source"] == "engine_px"
    assert out["rows"][0]["setup"] == "VCP"


# ── render_econ ────────────────────────────────────────────────────────────

def test_render_econ_passes_speaker_and_title_through(wire):
    wire["wire"] = {"date": "2026-09-29", "risk_calendar": {
        "econ": [{"time": "15:00", "event": "Crude", "estimate": ""}],
        "fed": [{"time": "10:00", "event": "Fed Speaker", "note": "", "speaker": "Waller"},
                {"time": "13:00", "event": "Fed Speaker", "note": ""}],
        "amc": ["NKE"], "amc_count": 1}}
    out = rp.render_econ(token="x")
    fed = [r for r in out["rows"] if r["kind"] == "fed"]
    assert fed[0]["speaker"] == "Waller" and fed[0]["title"] == ""
    assert fed[1]["speaker"] == "" and fed[1]["title"] == ""
    assert [r["time"] for r in out["rows"]] == ["10:00", "13:00", "15:00"]   # still chronological
