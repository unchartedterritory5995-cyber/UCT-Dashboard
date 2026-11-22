"""The RS screens' row words, server side (RS screens unit U11).

The Focus screener words each row in the page: the caption under the ticker, the one
tag beside it and the place numeral (``app/src/pages/screener/focus/rsRows.js``). The
server sent codes and numbers only (CONTRACT-SCREENS.md section 3), so until this unit
those words existed in the client alone. The assistant (Compass, the UCT Agent) lists
the same screens outside the page and must say a row the way the screen prints it.

THIS MODULE IS THAT WORDING, ONCE, ON THE SERVER, AND IT IS HELD EQUAL TO THE CLIENT'S.
``tests/test_rs_screens_u11_words.py`` writes what these functions answer for a table
of rows into ``tests/fixtures/rs_screens_words.json``, and the client's own test
(``focus/__tests__/rsServerWords.test.js``) runs ``rsRows.js`` on the same rows and
must read the same words. A word changed on one side reds the other side's suite.

WHAT IS READ, NEVER RETYPED
* the Setup label and the flag words: ``rs_setup.SETUP_LABELS``;
* the three warning names: ``rs_columns.EXIT_NAMES``;
* the earnings tag's window: ``rs_screens.EARNINGS_TAG_DAYS``;
* the "Before price" line (3% under its own high): ``rs_screens.BELOW_HIGH_NEAR``.
What IS typed here is only the phrasing the client typed too ("RS high today",
"was #N a month ago"), which the cross-lane fixture pins.

PURE. No I/O, no env read. FAIL CLOSED, exactly as the client: a value the row does not
carry prints nothing, and a missing part leaves no separator behind.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import rs_columns, rs_screens, rs_setup

#: The column a row's place and its "was #N a month ago" are both about.
OVERALL_PLACE = "rs_rating_pos"
#: ``row.place`` for a list numbered by position (UCT RS Leaders).
INDEX_PLACE = "index"
#: The list's own "New" pill (the client's membership read decides who carries it).
NEW_TAG = "New"
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
#: "Tight range" follows a comma on every setup except these two (contract section 3).
_NO_TIGHT = rs_setup.NOT_BUY_POINT_SETUPS

#: Plain names for the rules "is this stock an RS leader?" may have to say out loud.
#: The registry's own label is used for every other key (``filters.FILTERS``); these
#: four are the ones the Focus page renames (``plainWords.js`` PLAIN_COLUMN_LABELS), and
#: the contract forbids "ADR" in member copy. Pinned against the client by the same
#: cross-lane fixture as the row words.
PLAIN_RULE_LABELS = {
    "adr_pct": "Avg daily range",
    "pct_vs_sma200": "vs 200-day avg",
    "dist_52w_high_pct": "From 52-week high",
    "rs_line_above_ma": "RS line above its 21-day avg",
}


def _num(v) -> bool:
    """A finite number, as the client's ``isNum`` reads one (a JSON true is not 1)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _round(x) -> int:
    """JavaScript's ``Math.round``: a half goes UP (4.5 is 5, -4.5 is -4). Python's
    ``round`` sends a half to the even neighbour, and "4% below its high" beside the
    screen's "5% below its high" is the difference this unit exists to prevent."""
    return int(math.floor(x + 0.5))


def _int_words(n) -> str:
    """``Math.round(n).toLocaleString('en-US')``: a whole number with thousands commas."""
    return f"{_round(n):,}"


def short_day(v):
    """``"2026-11-13"`` or ``"20261113"`` -> ``"Nov 13"``, else None (``dates.shortDay``)."""
    t = str(v).strip() if isinstance(v, (str, int)) and not isinstance(v, bool) else ""
    if len(t) >= 10 and t[4] == "-" and t[7] == "-":
        y, m, d = t[:4], t[5:7], t[8:10]
    elif len(t) == 8:
        y, m, d = t[:4], t[4:6], t[6:8]
    else:
        return None
    if not (y.isdigit() and m.isdigit() and d.isdigit()):
        return None
    if not (1 <= int(m) <= 12 and 1 <= int(d) <= 31):
        return None
    return f"{_MONTHS[int(m) - 1]} {int(d)}"


def ratings_as_of(session) -> str:
    """The header line: "Ratings as of Nov 13", or "" without a usable date."""
    day = short_day(session)
    return f"Ratings as of {day}" if day else ""


def row_config(starter, place=None):
    """A starter's ``row`` as the row code reads it, or None when it has none.
    ``place`` is the chosen option's own place column (``rsScreens.placeOverride``): it
    stands in only on a screen that already numbers its rows by a column."""
    r = (starter or {}).get("row")
    if not isinstance(r, dict):
        return None
    own = r.get("place") if isinstance(r.get("place"), str) and r.get("place") else None
    over = place if isinstance(place, str) and place else None
    return {
        "place": over if (own and own != INDEX_PLACE and over) else own,
        "caption": [p for p in (r.get("caption") or []) if isinstance(p, str)],
        "tags": [t for t in (r.get("tags") or []) if isinstance(t, str)],
        # unit U12: the why strip's own notes a starter asks for ("days" on UCT RS Leaders).
        # They add columns to the row's read; they are never part of the caption or the tag.
        "facts": [p for p in (r.get("facts") or []) if isinstance(p, str)],
    }


# ── the caption's parts ─────────────────────────────────────────────────────

def setup_words(row) -> str:
    code = (row or {}).get("rs_setup")
    if not isinstance(code, str) or code not in rs_setup.SETUPS:
        return ""
    base = rs_setup.SETUP_LABELS[code]
    tight = (row or {}).get("rs_tight")
    if not (_num(tight) and tight == 1):
        return base
    words = rs_setup.SETUP_LABELS["tight"]
    if code == "uptrend":
        return words
    return base if code in _NO_TIGHT else f"{base}, {words[0].lower()}{words[1:]}"


def flag_words(row) -> str:
    code = (row or {}).get("rs_flag")
    return rs_setup.SETUP_LABELS[code] if isinstance(code, str) and code in rs_setup.FLAGS else ""


def _age_words(n) -> str:
    return "today" if n == 0 else "yesterday" if n == 1 else f"{_int_words(n)} sessions ago"


def rs_high_age_words(row) -> str:
    n = (row or {}).get("rs_nh_bars_ago")
    if not _num(n) or n < 0:
        return ""
    return f"RS high {_age_words(n)}"


def below_high_words(row) -> str:
    p = (row or {}).get("px_below_high_pct")
    if not _num(p):
        return ""
    return "At its high" if p > -0.5 else f"{_round(abs(p))}% below its high"


def moving_words(row, *, overall=True) -> str:
    row = row or {}
    prev = row.get("rs_rating_pos_prev20")
    pos = row.get("rs_rating_pos")
    if overall and _num(prev) and not (_num(pos) and pos == prev):
        return f"was #{_int_words(prev)} a month ago"
    chg = row.get("rs_rating_chg_5")
    if _num(chg) and chg != 0:
        return f"RS Rating {'up' if chg > 0 else 'down'} {_int_words(abs(chg))} this week"
    return ""


def exit_warning_words(row) -> str:
    name, n = (row or {}).get("rs_exit_last"), (row or {}).get("rs_exit_bars_ago")
    if name not in rs_columns.EXIT_NAMES or not _num(n) or n < 0:
        return ""
    return f"{name} {_age_words(n)}"


def group_words(row, theme=None) -> str:
    """The row's theme when it has one, else its industry."""
    if isinstance(theme, str) and theme:
        return theme
    industry = (row or {}).get("industry")
    return industry if isinstance(industry, str) else ""


def _moving_part(row, theme, cfg):
    place = (cfg or {}).get("place")
    return moving_words(row, overall=(not place or place in (OVERALL_PLACE, INDEX_PLACE)))


_PARTS = {
    "setup": lambda row, theme, cfg: setup_words(row),
    "group": lambda row, theme, cfg: group_words(row, theme),
    "rs_high_age": lambda row, theme, cfg: rs_high_age_words(row),
    "below_high": lambda row, theme, cfg: below_high_words(row),
    "moving": _moving_part,
    "exit_warning": lambda row, theme, cfg: exit_warning_words(row),
}


def caption_of(row, cfg, theme=None) -> str:
    """The starter's caption parts in its order, joined with " · "."""
    words = [_PARTS[p](row, theme, cfg) if p in _PARTS else "" for p in (cfg or {}).get("caption") or []]
    return " · ".join(w for w in words if w)


# ── the tag: ONE per row, the first of the starter's list that applies ──────

_NEW_YORK = ZoneInfo("America/New_York")


def _day_number(v):
    """A calendar day as a whole number of days, or None (``dates.isoDay`` then the page's
    ``etCalendarDaysBetween``): ``"2026-11-17"`` or ``"20261117"``, and an impossible day
    of a real month rolls over as JavaScript's ``Date.UTC`` rolls it, so both sides count
    the same number whatever the row carries."""
    t = str(v).strip() if isinstance(v, (str, int)) and not isinstance(v, bool) else ""
    if len(t) >= 10 and t[4] == "-" and t[7] == "-":
        y, m, d = t[:4], t[5:7], t[8:10]
    elif len(t) == 8:
        y, m, d = t[:4], t[4:6], t[6:8]
    else:
        return None
    if not (y.isdigit() and m.isdigit() and d.isdigit()):
        return None
    if not (1 <= int(m) <= 12 and 1 <= int(d) <= 31) or int(y) < 1:
        return None
    return (date(int(y), int(m), 1) + timedelta(days=int(d) - 1)).toordinal()


def today_in_new_york() -> date:
    return datetime.now(_NEW_YORK).date()


def earnings_days(row, today=None):
    """Whole calendar days from TODAY IN NEW YORK to the stock's next report, or None
    (``rsRows.earningsDays``, unit U12). The row's own ``next_earnings_date`` is counted
    from today; ``days_to_earnings`` (counted from the build's date, so a day or two too
    many over a weekend) is read only when the row carries no date. A date already past
    is a negative number here and says nothing; it is never replaced by the stored count."""
    row = row or {}
    day = _day_number(row.get("next_earnings_date"))
    if day is not None:
        return day - (today or today_in_new_york()).toordinal()
    n = row.get("days_to_earnings")
    return int(n) if _num(n) and n == int(n) else None


def earnings_words(row, today=None) -> str:
    n = earnings_days(row, today)
    if n is None or n < 0 or n > rs_screens.EARNINGS_TAG_DAYS:
        return ""
    return "Earnings today" if n == 0 else "Earnings tomorrow" if n == 1 else f"Earnings in {n} days"


def weekly_words(row) -> str:
    """``rs_nh_weekly`` (unit U12): only a stored 1 says it (``rsRows.weeklyWords``)."""
    v = (row or {}).get("rs_nh_weekly")
    return "Weekly RS high" if _num(v) and v == 1 else ""


def days_words(row) -> str:
    """``rs_leaders_days`` (unit U12): sessions in a row on UCT RS Leaders, today included
    (``rsRows.daysWords``). A note about the row, never a caption part."""
    n = (row or {}).get("rs_leaders_days")
    return f"Day {_int_words(n)} on this list" if _num(n) and n == int(n) and n >= 1 else ""


def _before_price(row) -> str:
    age, below = (row or {}).get("rs_nhbp_age"), (row or {}).get("px_below_high_pct")
    return "Before price" if _num(age) and _num(below) and below <= rs_screens.BELOW_HIGH_NEAR else ""


def _down_day(row) -> str:
    red, newest = (row or {}).get("rs_nh_red_bars_ago"), (row or {}).get("rs_nh_bars_ago")
    return "Market down day" if _num(red) and _num(newest) and red == newest else ""


_TAGS = {
    rs_screens.EARNINGS_TAG: lambda row, is_new, today: earnings_words(row, today),
    rs_screens.WEEKLY_TAG: lambda row, is_new, today: weekly_words(row),
    "before_price": lambda row, is_new, today: _before_price(row),
    "down_day": lambda row, is_new, today: _down_day(row),
    "flag": lambda row, is_new, today: flag_words(row),
    "new": lambda row, is_new, today: NEW_TAG if is_new else "",
}


def tag_of(row, cfg, is_new=False, today=None) -> str:
    """``today``: the New York calendar date the earnings tag counts from (now, when not
    given). Passed by a caller that words many rows so they all count from one day."""
    for t in (cfg or {}).get("tags") or []:
        words = _TAGS[t](row, is_new, today) if t in _TAGS else ""
        if words:
            return words
    return ""


def place_of(row, cfg, index):
    """The place numeral: a column's value, the 1-based position, or None."""
    place = (cfg or {}).get("place")
    if not place:
        return None
    if place == INDEX_PLACE:
        return index + 1
    v = (row or {}).get(place)
    return v if _num(v) else None


def row_display(row, cfg, *, index=0, theme=None, is_new=False, today=None) -> dict:
    """What one row shows: ``{place, caption, tag}``."""
    return {"place": place_of(row, cfg, index), "caption": caption_of(row, cfg, theme),
            "tag": tag_of(row, cfg, is_new, today)}


# ── the columns a row's words read ──────────────────────────────────────────

_PART_COLUMNS = {
    "setup": ("rs_setup", "rs_tight"),
    "group": ("industry",),
    "rs_high_age": ("rs_nh_bars_ago",),
    "below_high": ("px_below_high_pct",),
    "moving": ("rs_rating_pos_prev20", "rs_rating_pos", "rs_rating_chg_5"),
    "exit_warning": ("rs_exit_last", "rs_exit_bars_ago"),
}
_TAG_COLUMNS = {
    rs_screens.EARNINGS_TAG: ("days_to_earnings", "next_earnings_date"),
    rs_screens.WEEKLY_TAG: ("rs_nh_weekly",),
    "before_price": ("rs_nhbp_age", "px_below_high_pct"),
    "down_day": ("rs_nh_red_bars_ago", "rs_nh_bars_ago"),
    "flag": ("rs_flag",),
    "new": (),
}
#: The why strip's own notes (``row.facts``, unit U12) and the column each reads.
_FACTS = {"days": days_words}
_FACT_COLUMNS = {"days": ("rs_leaders_days",)}


def facts_of(row, cfg) -> list:
    """The notes this screen asks for by name, in its order, blanks left out."""
    words = [_FACTS[p](row) if p in _FACTS else "" for p in (cfg or {}).get("facts") or []]
    return [w for w in words if w]
#: Read on every RS screen whatever its caption (``rsRows.RS_ROW_BASE_COLUMNS``).
BASE_COLUMNS = ("rs_rank", "rs_rating_session", "rs_setup", "rs_tight", "rs_nh_bars_ago",
                "px_below_high_pct", "rs_rating_pos", "rs_rating_pos_n")


def row_columns(cfg) -> list:
    """The columns the row words of this configuration read, each once, in the client's
    order (``rsRows.rowColumns``)."""
    if not cfg:
        return []
    out = list(BASE_COLUMNS)
    if cfg.get("place") and cfg["place"] != INDEX_PLACE:
        out.append(cfg["place"])
    for p in cfg.get("caption") or []:
        out.extend(_PART_COLUMNS.get(p, ()))
    for t in cfg.get("tags") or []:
        out.extend(_TAG_COLUMNS.get(t, ()))
    for p in cfg.get("facts") or []:
        out.extend(_FACT_COLUMNS.get(p, ()))
    return list(dict.fromkeys(out))


def rule_label(key: str) -> str:
    """What a filter rule is called when it is said to a member: the Focus page's plain
    name where it has one, else the registry's own label."""
    if key in PLAIN_RULE_LABELS:
        return PLAIN_RULE_LABELS[key]
    from . import filters                                 # noqa: PLC0415 - lazy: no cycle
    entry = filters.FILTERS.get(key) or {}
    return str(entry.get("label") or key)
