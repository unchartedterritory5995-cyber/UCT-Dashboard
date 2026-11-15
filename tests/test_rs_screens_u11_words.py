"""RS screens unit U11: the row words, server side, held equal to the page's.

`api/services/screener/rs_words.py` words an RS screen's rows for the assistant the way
`app/src/pages/screener/focus/rsRows.js` words them on the page. Two copies of one
wording drift unless something holds them, so this suite writes what the SERVER says
for a table of rows into `tests/fixtures/rs_screens_words.json` and the client's suite
(`focus/__tests__/rsServerWords.test.js`) runs the PAGE's code on the same rows and must
read the same words. Refresh on a deliberate change with ``UPDATE_RS_SCREENS_GOLDEN=1``,
then run the client's test: it fails until both sides agree.

The rows are of two kinds: the rows the scan route really served for each screen
(`rs_screens_rows.json`, written by the end-to-end test), and a hand-built table that
walks every branch of every part (each setup with and without a tight range, each age,
the rounding of a half, a JSON true where a 1 is read, a blank).

A handful of answers are also typed below. The fixture alone would let both sides be
wrong together on the day one of them is written; these are read from the contract.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from api.services.screener import filters, rs_columns, rs_screens, rs_setup, rs_words

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
WORDS_GOLDEN = FIXTURES / "rs_screens_words.json"
STARTERS = json.loads((FIXTURES / "rs_screens_starters.json").read_text(encoding="utf-8"))
SERVED_ROWS = json.loads((FIXTURES / "rs_screens_rows.json").read_text(encoding="utf-8"))
CLIENT_TEST = (ROOT / "app" / "src" / "pages" / "screener" / "focus" / "__tests__" / "rsServerWords.test.js")

#: Every caption part and every tag at once, so one row is read by every rule.
EVERYTHING = {"place": "rs_rating_pos",
              "caption": ["setup", "moving", "rs_high_age", "below_high", "exit_warning", "group"],
              "tags": ["earnings", "weekly", "before_price", "down_day", "flag", "new"]}


def _tags(*order):
    return {"place": None, "caption": [], "tags": list(order)}


def _hand_built() -> list:
    """``(name, row, cfg, index, theme, is_new)``: one branch each."""
    out = []

    def add(name, row, cfg=EVERYTHING, index=0, theme=None, is_new=False, today=None):
        out.append({"name": name, "row": row, "cfg": cfg, "index": index, "theme": theme, "is_new": is_new,
                    "today": today})

    for code in (*rs_setup.SETUPS, "not_a_setup", None):
        for tight in (None, 0, 1, True):
            add(f"setup {code} tight {tight!r}", {"rs_setup": code, "rs_tight": tight})
    for flag in (*rs_setup.FLAGS, "not_a_flag", None):
        add(f"flag {flag}", {"rs_flag": flag})
    for age in (0, 1, 2, 4, 1500, -1, None, "3", 2.5, True):
        add(f"rs high age {age!r}", {"rs_nh_bars_ago": age})
    for pct in (0, 0.0, -0.49, -0.5, -1.4, -1.5, -2.5, -3, -4.5, -12, -24.51, None, "5"):
        add(f"below high {pct!r}", {"px_below_high_pct": pct})
    # where the rating is going
    add("moved place", {"rs_rating_pos": 14, "rs_rating_pos_prev20": 40, "rs_rating_chg_5": 6})
    add("moved from a big place", {"rs_rating_pos": 14, "rs_rating_pos_prev20": 1234})
    add("same place, week up", {"rs_rating_pos": 14, "rs_rating_pos_prev20": 14, "rs_rating_chg_5": 6})
    add("no place a month ago, week down", {"rs_rating_pos": 14, "rs_rating_pos_prev20": None, "rs_rating_chg_5": -3})
    add("week unchanged", {"rs_rating_pos": 14, "rs_rating_pos_prev20": 14, "rs_rating_chg_5": 0})
    add("no place now", {"rs_rating_pos": None, "rs_rating_pos_prev20": 12, "rs_rating_chg_5": 2})
    add("a period board says the week, never the month",
        {"rs_rating_pos": 14, "rs_rating_pos_prev20": 40, "rs_rating_chg_5": 6, "rs_pos_1m": 3},
        cfg={**EVERYTHING, "place": "rs_pos_1m"})
    add("a list numbered by position still says the month",
        {"rs_rating_pos": 14, "rs_rating_pos_prev20": 40}, cfg={**EVERYTHING, "place": "index"}, index=6)
    for name in (*rs_columns.EXIT_NAMES, "Not A Warning", None):
        for age in (0, 1, 4, None):
            add(f"exit {name} age {age!r}", {"rs_exit_last": name, "rs_exit_bars_ago": age})
    add("group: the theme", {"industry": "Semiconductors"}, theme="AI chips")
    add("group: the industry", {"industry": "Semiconductors"})
    add("group: neither", {"industry": None})
    for days in (0, 1, 2, 5, 6, -1, None, 2.0, 2.5, "1", True):
        add(f"earnings in {days!r}", {"days_to_earnings": days})
    # unit U12: the report's own DATE is counted from today in New York; the stored count
    # (from the build's date) is read only when the row carries no date. 2026-11-14 is a
    # Saturday: Monday's report is 2 days away while the stored count still says 3.
    sat = "2026-11-14"
    for day, stored in (("2026-11-14", 0), ("2026-11-15", 1), ("2026-11-16", 3), ("2026-11-19", 5),
                        ("2026-11-20", 2), ("2026-11-13", 2), ("20261117", None), (20261117, None),
                        ("2026-11-17T00:00:00", 9), ("not a date", 4), ("", 1), (None, 2),
                        ("2026-13-01", 3)):
        add(f"earnings on {day!r} read on a Saturday, stored count {stored!r}",
            {"next_earnings_date": day, "days_to_earnings": stored}, today=sat)
    add("earnings: an impossible day of a real month rolls over on both sides",
        {"next_earnings_date": "2026-02-31", "days_to_earnings": None}, today="2026-02-28")
    add("earnings: across the new year", {"next_earnings_date": "2027-01-02"}, today="2026-12-30")
    for v in (1, 0, None, True, "1", 1.0):
        add(f"weekly {v!r}", {"rs_nh_weekly": v})
    add("tag: weekly follows earnings and leads before price",
        {"rs_nh_weekly": 1, "rs_nhbp_age": 0, "px_below_high_pct": -6.0}, is_new=True)
    # the one tag: the first of the starter's list that applies
    busy = {"days_to_earnings": 3, "rs_nhbp_age": 0, "px_below_high_pct": -6.0, "rs_nh_bars_ago": 0,
            "rs_nh_red_bars_ago": 0, "rs_flag": "one_day_move"}
    add("tag: earnings leads", busy, is_new=True)
    add("tag: before price", {**busy, "days_to_earnings": None}, is_new=True)
    add("tag: before price needs 3% under the high", {**busy, "days_to_earnings": None, "px_below_high_pct": -2.99,
                                                       "rs_nh_red_bars_ago": None, "rs_flag": None})
    add("tag: before price at exactly 3%", {"rs_nhbp_age": 2, "px_below_high_pct": -3})
    add("tag: down day", {**busy, "days_to_earnings": None, "rs_nhbp_age": None}, is_new=True)
    add("tag: an older down day is not the newest high", {"rs_nh_bars_ago": 1, "rs_nh_red_bars_ago": 4})
    add("tag: flag", {"rs_flag": "new_issue"}, is_new=True)
    add("tag: new", {"rs_flag": None}, is_new=True)
    add("tag: none", {"rs_flag": None})
    add("tag: the starter's order decides", busy, cfg=_tags("flag", "down_day", "earnings"))
    add("tag: one the page does not know", busy, cfg=_tags("not_a_tag", "new"), is_new=True)
    # the place numeral
    add("place: a column", {"rs_rating_pos": 7})
    add("place: a blank column", {"rs_rating_pos": None})
    add("place: position", {}, cfg={**EVERYTHING, "place": "index"}, index=11)
    add("place: none", {"rs_rating_pos": 7}, cfg={**EVERYTHING, "place": None})
    add("caption: a part the page does not know", {"rs_setup": "extended", "industry": "Banks"},
        cfg={"place": None, "caption": ["not_a_part", "setup", "group"], "tags": []})
    return out


def _served() -> list:
    """The rows the scan route answered each screen's opening request with, under that
    starter's own row description (and the 1-month board under its own place column)."""
    out = []
    by = {s["id"]: s for s in STARTERS}
    for sid, block in SERVED_ROWS["screens"].items():
        cfg = rs_words.row_config(by[sid])
        for i, row in enumerate(block["rows"]):
            out.append({"name": f"{sid} row {i + 1} {row['ticker']}", "row": row, "cfg": cfg,
                        "index": i, "theme": None, "is_new": False})
    top = by["starter_rs_top_rating"]
    m1 = next(o for c in top["controls"] for o in c["options"] if o["id"] == "m1")
    cfg = rs_words.row_config(top, m1["place"])
    for i, row in enumerate(SERVED_ROWS["top_rating_one_month"]["rows"]):
        out.append({"name": f"top rating 1M row {i + 1} {row['ticker']}", "row": row, "cfg": cfg,
                    "index": i, "theme": None, "is_new": False})
    return out


def _answer(case) -> dict:
    from datetime import date
    row, cfg = case["row"], case["cfg"]
    today = date.fromisoformat(case["today"]) if case.get("today") else None
    # a case that reads a report DATE must name its day, or the file would change by itself
    assert today is not None or row.get("next_earnings_date") is None, case["name"]
    shown = rs_words.row_display(row, cfg, index=case["index"], theme=case["theme"], is_new=case["is_new"],
                                 today=today)
    return {**shown, "setup": rs_words.setup_words(row), "group": rs_words.group_words(row, case["theme"])}


def _first_miss_keys() -> list:
    """The rule keys a check may have to name: the specs of the screens whose first
    missed rule `rs_screens_service.check_ticker` words."""
    from api.services import rs_screens_service as svc
    out = []
    for screen in svc.FIRST_MISS_SCREENS:
        starter = next(s for s in STARTERS if s["id"] == svc.starter_id(screen))
        # a kept list's membership clause is its answer, never a rule the check names (unit U12)
        kept = (svc._steady(starter) or {}).get("key")
        for f in starter["spec"]["filters"]:
            if f["key"] != kept and f["key"] not in out:
                out.append(f["key"])
    return out


def words_document() -> dict:
    cases = _hand_built() + _served()
    columns = []
    for s in STARTERS:
        columns.append({"starter": s["id"], "place": None,
                        "columns": rs_words.row_columns(rs_words.row_config(s))})
        for c in s["controls"]:
            for o in c["options"]:
                if o.get("place"):
                    columns.append({"starter": s["id"], "place": o["place"],
                                    "columns": rs_words.row_columns(rs_words.row_config(s, o["place"]))})
    days = ["2026-11-13", "20261113", "2026-01-05", "2026-13-01", "not a day", None, ""]
    return {
        "about": ("Written by tests/test_rs_screens_u11_words.py (UPDATE_RS_SCREENS_GOLDEN=1 rewrites): "
                  "what api/services/screener/rs_words.py says for each row. Read by "
                  "app/src/pages/screener/focus/__tests__/rsServerWords.test.js, which runs "
                  "rsRows.js on the same rows and must read the same words."),
        "cases": [{**c, "want": _answer(c)} for c in cases],
        "columns": columns,
        "ratings_as_of": [{"session": d, "want": rs_words.ratings_as_of(d)} for d in days],
        "days_on_list": [{"days": n, "want": rs_words.days_words({"rs_leaders_days": n})}
                         for n in (1, 2, 12, 1500, 0, -1, None, 2.5, "3", True)],
        "rule_labels": {k: rs_words.rule_label(k) for k in _first_miss_keys()},
    }


def test_the_words_the_server_says_match_the_file_the_page_is_tested_on():
    doc = words_document()
    if os.environ.get("UPDATE_RS_SCREENS_GOLDEN") == "1":
        WORDS_GOLDEN.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n",
                                encoding="utf-8", newline="\n")
    assert json.loads(WORDS_GOLDEN.read_text(encoding="utf-8")) == doc
    assert json.loads(json.dumps(doc)) == doc, "it survives JSON, so the page reads what was written"
    names = [c["name"] for c in doc["cases"]]
    assert len(names) == len(set(names)) >= 150


def test_the_page_s_test_reads_this_file_and_runs_the_page_s_own_code():
    """The other side of the join: without it the fixture pins the server to itself."""
    src = CLIENT_TEST.read_text(encoding="utf-8")
    assert WORDS_GOLDEN.name in src
    for fn in ("rowDisplay", "setupWords", "groupWords", "rowColumns", "rowConfigOf", "ratingsAsOf",
               "plainColumnLabel"):
        assert fn in src, fn


def _say(row, cfg=EVERYTHING, **kw):
    return rs_words.row_display(row, cfg, **kw)


def test_the_contract_s_own_examples():
    """CONTRACT-SCREENS.md section 3 and section 4, typed from the contract."""
    assert rs_words.setup_words({"rs_setup": "at_pivot", "rs_tight": 1}) == "At pivot, tight range"
    assert rs_words.setup_words({"rs_setup": "uptrend", "rs_tight": 1}) == "Tight range"
    assert rs_words.setup_words({"rs_setup": "uptrend", "rs_tight": 0}) == "Uptrend, no setup"
    for code in ("extended", "below_50"):
        assert rs_words.setup_words({"rs_setup": code, "rs_tight": 1}) == rs_setup.SETUP_LABELS[code]
    assert [rs_words.rs_high_age_words({"rs_nh_bars_ago": n}) for n in (0, 1, 3)] == [
        "RS high today", "RS high yesterday", "RS high 3 sessions ago"]
    assert rs_words.below_high_words({"px_below_high_pct": -0.4}) == "At its high"
    assert rs_words.below_high_words({"px_below_high_pct": -7.2}) == "7% below its high"
    assert rs_words.moving_words({"rs_rating_pos": 14, "rs_rating_pos_prev20": 40}) == "was #40 a month ago"
    assert rs_words.moving_words({"rs_rating_pos": 14, "rs_rating_pos_prev20": 14, "rs_rating_chg_5": 12}) == (
        "RS Rating up 12 this week")
    assert rs_words.moving_words({"rs_rating_chg_5": -4}) == "RS Rating down 4 this week"
    assert rs_words.exit_warning_words({"rs_exit_last": "Quicksand", "rs_exit_bars_ago": 1}) == "Quicksand yesterday"
    assert [rs_words.earnings_words({"days_to_earnings": n}) for n in (0, 1, 4, 6)] == [
        "Earnings today", "Earnings tomorrow", "Earnings in 4 days", ""]
    # unit U12: the report's date, counted from today in New York, beats the stored count
    from datetime import date
    sat = date(2026, 11, 14)
    said = lambda day, stored=None: rs_words.earnings_words(                       # noqa: E731
        {"next_earnings_date": day, "days_to_earnings": stored}, today=sat)
    assert said("2026-11-16", 3) == "Earnings in 2 days"
    assert said("2026-11-14", 4) == "Earnings today" and said("2026-11-15") == "Earnings tomorrow"
    assert said("2026-11-13", 1) == "", "a date already past is never replaced by the stored count"
    assert said("2026-11-20", 1) == "" and said("2026-11-19") == "Earnings in 5 days"
    assert said(None, 2) == "Earnings in 2 days" and said("not a date", 2) == "Earnings in 2 days"
    assert rs_words.weekly_words({"rs_nh_weekly": 1}) == "Weekly RS high"
    assert [rs_words.weekly_words({"rs_nh_weekly": v}) for v in (0, None, True, "1")] == ["", "", "", ""]
    assert rs_words.days_words({"rs_leaders_days": 12}) == "Day 12 on this list"
    assert [rs_words.days_words({"rs_leaders_days": v}) for v in (0, None, 2.5, True)] == ["", "", "", ""]
    assert rs_words.ratings_as_of("2026-11-13") == "Ratings as of Nov 13"
    assert rs_words.flag_words({"rs_flag": "buyout_pending"}) == "Buyout pending"


def test_a_half_rounds_up_as_the_page_rounds_it():
    """`Math.round` sends 4.5 to 5; Python's `round` sends it to 4. The screen says 5."""
    assert rs_words.below_high_words({"px_below_high_pct": -4.5}) == "5% below its high"
    assert rs_words.below_high_words({"px_below_high_pct": -2.5}) == "3% below its high"
    assert rs_words.below_high_words({"px_below_high_pct": -0.5}) == "1% below its high"
    assert rs_words.rs_high_age_words({"rs_nh_bars_ago": 2.5}) == "RS high 3 sessions ago"


def test_one_caption_and_one_tag_in_the_starter_s_order():
    row = {"rs_setup": "pullback_21", "rs_tight": 1, "industry": "Banks", "rs_rating_pos": 9,
           "rs_rating_pos_prev20": 30, "days_to_earnings": 2, "rs_flag": "new_issue"}
    cfg = {"place": "rs_rating_pos", "caption": ["setup", "moving", "group"], "tags": ["earnings", "flag", "new"]}
    assert _say(row, cfg) == {"place": 9, "tag": "Earnings in 2 days",
                              "caption": "Pullback to the 21-day, tight range · was #30 a month ago · Banks"}
    assert _say({**row, "days_to_earnings": None}, cfg)["tag"] == "New issue"
    assert _say({**row, "days_to_earnings": None, "rs_flag": None}, cfg, is_new=True)["tag"] == "New"
    assert _say({}, cfg) == {"place": None, "caption": "", "tag": ""}, "a blank row prints nothing"
    assert _say(row, {**cfg, "place": "index"}, index=4)["place"] == 5


def test_a_json_true_is_not_a_one():
    """The page reads `rs_tight === 1`; a stored true must not turn a label tight."""
    assert rs_words.setup_words({"rs_setup": "at_pivot", "rs_tight": True}) == "At pivot"
    assert rs_words.rs_high_age_words({"rs_nh_bars_ago": True}) == ""
    assert rs_words.earnings_words({"days_to_earnings": True}) == ""


def test_the_words_are_read_from_their_owners_never_typed_here():
    import ast
    src = (ROOT / "api" / "services" / "screener" / "rs_words.py").read_text(encoding="utf-8")
    literals = {n.value for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert "RS high " in literals, "control: the walk does read this module's string literals"
    typed = sorted(literals & {*rs_setup.SETUP_LABELS.values(), *rs_columns.EXIT_NAMES})
    assert typed == [], f"typed in rs_words.py, owned elsewhere: {typed}"
    # the two numbers the tags turn on are the screens' own
    assert rs_words.earnings_words({"days_to_earnings": rs_screens.EARNINGS_TAG_DAYS}) != ""
    assert rs_words.earnings_words({"days_to_earnings": rs_screens.EARNINGS_TAG_DAYS + 1}) == ""
    at = {"rs_nhbp_age": 0, "px_below_high_pct": rs_screens.BELOW_HIGH_NEAR}
    assert rs_words.tag_of(at, _tags("before_price")) == "Before price"
    assert rs_words.tag_of({**at, "px_below_high_pct": rs_screens.BELOW_HIGH_NEAR + 0.01}, _tags("before_price")) == ""


def test_every_part_and_tag_the_five_screens_use_has_words_and_columns():
    """A caption part or a tag added to a starter without words here would print nothing
    for the assistant while the page printed it."""
    for s in STARTERS:
        cfg = rs_words.row_config(s)
        assert set(cfg["caption"]) <= set(rs_words._PARTS) == set(rs_words._PART_COLUMNS), s["id"]
        assert set(cfg["tags"]) <= set(rs_words._TAGS) == set(rs_words._TAG_COLUMNS), s["id"]
        assert set(cfg["facts"]) <= set(rs_words._FACTS) == set(rs_words._FACT_COLUMNS), s["id"]
        from api.services.screener import snapshot_db
        assert set(rs_words.row_columns(cfg)) <= set(snapshot_db.COLUMNS), s["id"]


def test_a_rule_is_named_plainly_and_never_as_adr():
    assert rs_words.rule_label("adr_pct") == "Avg daily range"
    assert rs_words.rule_label("rs_rank") == filters.FILTERS["rs_rank"]["label"]
    assert set(rs_words.PLAIN_RULE_LABELS) <= set(filters.FILTERS)
    labels = [rs_words.rule_label(k) for k in _first_miss_keys()]
    assert not [x for x in labels if "ADR" in x.split()], labels


@pytest.mark.parametrize("v,want", [("2026-11-13", "Nov 13"), ("20260105", "Jan 5"), (20260105, "Jan 5"),
                                    ("2026-11-13T04:15:00", "Nov 13"), ("2026-00-10", None), (None, None)])
def test_short_day(v, want):
    assert rs_words.short_day(v) == want
