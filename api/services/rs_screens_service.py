"""The five Relative Strength screens as lists an assistant can read (RS screens unit U11).

A member asks "who are the RS leaders today?", "which stocks made RS new highs this
week?", "is NVDA an RS leader?". Compass (text chat and voice) answers from the two
functions below, and each of them answers from THE SCREEN ITSELF:

* the rules are the starter's own spec, read from ``saved_screens.starters(user)``
  (the payload the Screener page opens the screen from), never a filter list typed here;
* a named quick-control choice ("today", "near a buy point") is the starter's own
  ``controls`` option, laid over the spec the way the page lays it
  (``app/src/pages/screener/focus/rsScreens.js`` ``specWithOption``);
* the rows come from ``screener.query.run_scan``, the function behind
  ``POST /api/screener/scan``, so the tickers and their order are the screen's;
* each row is worded by ``screener.rs_words``, which is held equal to the page's own
  wording by a cross-lane fixture.

So an answer cannot differ from the screen: there is one definition and one scan.
``tests/test_rs_screens_u11_service.py`` replays every request the page itself makes
(``tests/fixtures/rs_screens_scan_requests.json``) through both doors and compares.

AGENT-PORTABLE. Pure orchestration over the screener services: no web framework import,
plain dicts in and out, nothing stored. Compass wraps it today
(``voice_tool_impls._rs_screen`` / ``_rs_screen_check``); the UCT Agent can wrap the same
two functions the way ``rs_read_tools`` describes for its own pair.

NEVER RAISES. Every failure is ``{"ok": False, "reason": <one plain sentence>}``.
While the screens are not on for the user the reason is exactly ``"not available"``.

A LIST IS A WATCHLIST. Every answer carries ``note``, which says so and names the date
the ratings are from. Nothing here grades a stock or says what to do with one.
"""
from __future__ import annotations

import logging
import math
import re
from typing import Optional

log = logging.getLogger(__name__)

#: The names the tools take, each the name of the function in ``screener.rs_screens``
#: that defines that screen. The starter id is read from that definition
#: (:func:`starter_id`), so no id and no rule is typed in this module.
SCREENS = ("leaders", "new_highs", "before_price", "top_rating", "exit_warnings")
DEFAULT_LIMIT = 15
#: The most rows one answer carries: a spoken or chat answer, not a table.
MAX_LIMIT = 50
#: At most this many quick controls per screen are read (``rsScreens.MAX_CONTROLS``).
MAX_CONTROLS = 3

NOT_AVAILABLE = "not available"
#: The Screener's own sentence for a ticker it holds no row for
#: (``api/routers/screener.NO_SUCH_STOCK``; the service test holds the two equal).
NO_SUCH_STOCK = "No such stock in the Screener."
NOT_A_TICKER = "Name one ticker, like NVDA."
COULD_NOT_READ = "The screen could not be read just now."
#: Said with every list and every check.
WATCHLIST_NOTE = "The RS screens are watchlists to study, not advice."
STALE_NOTE = ("Its price data has stopped updating, so it is left out of every screen "
              "until new bars arrive.")
#: The screen whose first missed rule a check names ("is NVDA an RS leader?").
FIRST_MISS_SCREENS = ("leaders",)
#: Rows read to place a member on a list that keeps its own members (it holds 65 at most).
STEADY_PAGE = 200


# ── what a tool says about itself (one text for every surface that registers it) ──
#
# Compass voice and Compass chat register the two tools with THESE texts, so the
# surfaces cannot drift (the `rs_read_tools` arrangement). Each text is BUILT from the
# screens' own definitions: a screen's name, its one-line description, its search words
# and the example choices are read off `screener.rs_screens`, so a screen renamed there
# is renamed for the assistant too.

def _definitions() -> dict:
    """``{screen name: its definition}`` from ``screener.rs_screens`` (pure data: no
    flag is read, so a description can be built while the screens are off)."""
    from api.services.screener import rs_screens            # noqa: PLC0415 - lazy
    return {screen: getattr(rs_screens, screen)() for screen in SCREENS}


def _example_choice(definition) -> Optional[str]:
    """The first choice of a screen that is not how it opens, in the screen's words."""
    for control in definition.get("controls") or []:
        for option in control.get("options") or []:
            if not option.get("default") and option.get("label"):
                return str(option["label"])
    return None


def screen_description() -> str:
    defs = _definitions()
    screens = "; ".join(
        f"'{key}' is {d['name']}"
        + (f" (also called {', '.join(a for a in d['aliases'] if _norm(a) != _norm(d['name']))})"
           if d.get("aliases") else "")
        + f": {d['description']}"
        for key, d in defs.items())
    examples = ", ".join(f"'{_example_choice(d)}' on {d['name']}" for d in defs.values() if _example_choice(d))
    return (
        "One of the five UCT Relative Strength (RS) screens, exactly as the Screener lists it: the "
        "same stocks in the same order. The screens: " + screens + ". Each row gives the stock, its "
        "RS Rating, its place, its setup in words, one tag and its group; `total` is how many stocks "
        "the screen lists. `options` narrows a screen with a choice the screen itself offers, in "
        "its own words (for example " + examples + "); leave it out for the screen as it opens. A "
        "word the screen does not offer is refused and the answer lists the choices. Always say the "
        "'Ratings as of' date from `note`. These lists are watchlists to study, not advice: never "
        "present one as a recommendation or a trade signal. RS compares a stock with the market "
        "and is NOT RSI. Call for 'who are the RS leaders today', 'which stocks made RS new highs "
        "this week', 'RS new highs before price', 'top rated stocks by RS'."
    )


def screen_parameters() -> dict:
    return {
        "screen": {"type": "string", "enum": list(SCREENS),
                   "description": "Which screen: " + ", ".join(SCREENS) + "."},
        "limit": {"type": "integer",
                  "description": f"How many rows, 1 to {MAX_LIMIT}. Defaults to {DEFAULT_LIMIT}."},
        "options": {"type": "string",
                    "description": "Optional. Choices the screen offers, in its own words, separated by commas."},
    }


def check_description() -> str:
    defs = _definitions()
    names = ", ".join(d["name"] for d in defs.values())
    first = " and ".join(defs[s]["name"] for s in FIRST_MISS_SCREENS)
    return (
        "Which of the five UCT Relative Strength (RS) screens ONE stock is on right now (" + names
        + "), judged by each screen's own rules. For " + first + " it also gives the stock's place "
        "on the list, or the first rule it misses when it is not on it. Always say the 'Ratings as "
        "of' date from `note`. The screens are watchlists to study, not advice: being on one is "
        "never a recommendation or a trade signal. One ticker per call: never call it in a loop "
        "over a list. Call for 'is NVDA an RS leader', 'is AAPL on the RS new highs list', 'why is "
        "TSLA not an RS leader'."
    )


CHECK_PARAMETERS = {
    "ticker": {"type": "string", "description": "One ticker, e.g. NVDA."},
}


def _screens_on(user) -> bool:
    """Are the RS screens on for this user?"""
    from api.services.screener import rs_post_pass          # noqa: PLC0415 - lazy
    # Unit U10: the member-facing reader. Under RS_SCREENS_ENABLED=admin only an admin is
    # shown the screens; a caller with no user (a tool registry) gets a member's answer.
    return bool(rs_post_pass.surfaces_on(user))


def available(user=None) -> bool:
    """Are the screens on for this user? The one question a tool registry asks before
    it shows the two tools (it has no user and passes None: a member's answer). Never
    raises: a gate that cannot be read is off."""
    try:
        return bool(_screens_on(user))
    except Exception:                                       # noqa: BLE001 - an unreadable gate shows nothing
        return False


def _refuse(reason: str, **extra) -> dict:
    return {"ok": False, "reason": reason, **extra}


def _norm(v) -> str:
    """Lower case, letters and digits only: "Two Words" and "two_words" are one name."""
    return re.sub(r"[^a-z0-9]+", "", str(v if v is not None else "").lower())


def starter_id(screen: str) -> Optional[str]:
    """The starter a screen name stands for, read from the screen's own definition."""
    if screen not in SCREENS:
        return None
    from api.services.screener import rs_screens            # noqa: PLC0415 - lazy
    return getattr(rs_screens, screen)()["id"]


def _starters(user) -> dict:
    """The served starters of the five, by screen name. A screen the payload does not
    carry (the RS columns are dark on this pod) is simply absent."""
    from api.services.screener import saved_screens         # noqa: PLC0415 - lazy
    served = {s.get("id"): s for s in saved_screens.starters(user)}
    out = {}
    for screen in SCREENS:
        s = served.get(starter_id(screen))
        if s and isinstance(s.get("spec"), dict):
            out[screen] = s
    return out


def screen_named(screen, starters) -> Optional[str]:
    """The screen a caller means: its tool name, or the starter's own id, name or one
    of its search words ("RSNHBP", "blue dot"), compared without case or punctuation."""
    want = _norm(screen)
    if not want:
        return None
    for name, s in starters.items():
        words = [name, s.get("id"), s.get("name"), *(s.get("aliases") or [])]
        if want in {_norm(w) for w in words if w}:
            return name
    return None


# ── the quick controls: a starter's own options, by id or by its own words ──

def _controls(starter) -> list:
    return [c for c in (starter.get("controls") or [])
            if isinstance(c, dict) and isinstance(c.get("keys"), list)
            and isinstance(c.get("options"), list)][:MAX_CONTROLS]


def _default(control):
    return next((o for o in control["options"] if o.get("default")), None)


def _tokens(option_ids) -> list:
    """What the caller named, as ``(control or None, option)`` pairs.

    Accepts a mapping ``{control: option}``, a list of words, or one string with the
    choices separated by commas or semicolons. A word may be ``control=option``."""
    if option_ids is None:
        return []
    if isinstance(option_ids, dict):
        return [(str(c), str(o)) for c, o in option_ids.items() if o not in (None, "")]
    parts = re.split(r"[,;]", option_ids) if isinstance(option_ids, str) else list(option_ids)
    out = []
    for part in parts:
        text = str(part if part is not None else "").strip()
        if not text:
            continue
        control, sep, option = text.partition("=")
        out.append((control.strip(), option.strip()) if sep else (None, text))
    return out


def choices_offered(starter) -> list:
    """The screen's quick controls as a caller may name them: every id and label is
    the starter's own."""
    return [{"control": c.get("id"), "label": c.get("label"),
             "default": (_default(c) or {}).get("id"),
             "options": [{"id": o.get("id"), "label": o.get("label")} for o in c["options"]]}
            for c in _controls(starter)]


def resolve_options(starter, option_ids) -> tuple:
    """``({control id: option id}, [problem, ...])`` for what the caller named.

    A word names an option by its id or its label, compared without case, spaces or
    punctuation; ``control=option`` (the control by id or label) settles a word two
    controls share. A word that names nothing, or names options of two controls, is a
    PROBLEM and nothing is guessed: a list said to be "today" must be today's."""
    controls = _controls(starter)
    chosen, problems = {}, []
    for control_word, option_word in _tokens(option_ids):
        want = _norm(option_word)
        pool = controls
        if control_word is not None:
            pool = [c for c in controls if _norm(control_word) in (_norm(c.get("id")), _norm(c.get("label")))]
        hits = [(c, o) for c in pool for o in c["options"]
                if want and want in (_norm(o.get("id")), _norm(o.get("label")))]
        named = "=".join(w for w in (control_word, option_word) if w)
        if len(hits) == 1:
            chosen[hits[0][0]["id"]] = hits[0][1]["id"]
        elif not hits:
            problems.append(f"'{named}' is not a choice this screen offers")
        elif len({c["id"] for c, _ in hits}) == 1:
            chosen[hits[0][0]["id"]] = hits[0][1]["id"]
        else:
            problems.append(f"'{named}' is a choice of more than one control: say it as control=choice")
    return chosen, problems


def _clause_of(option, key):
    return next((f for f in (option.get("filters") or []) if isinstance(f, dict) and f.get("key") == key), None)


def spec_with_choices(starter, choices) -> dict:
    """The starter's spec with each chosen option laid over it, as the page does it
    (``rsScreens.specWithOption``): every clause on the control's keys is replaced by
    the option's (possibly none), and the sort is set when the option carries one.
    Returns a new spec; the starter is not touched."""
    spec = dict(starter["spec"])
    spec["filters"] = [dict(f) for f in spec.get("filters") or []]
    for control in _controls(starter):
        option = next((o for o in control["options"] if o.get("id") == (choices or {}).get(control.get("id"))), None)
        if option is None:
            continue
        keys = list(control["keys"])
        keep = [f for f in spec["filters"] if f.get("key") not in keys]
        add = [dict(c) for c in (_clause_of(option, k) for k in keys) if c]
        spec["filters"] = keep + add
        if option.get("sort"):
            sort = dict(option["sort"])
            if isinstance(sort.get("then"), dict):
                sort["then"] = dict(sort["then"])
            spec["sort"] = sort
    return spec


def _active(starter, choices) -> list:
    """``(control, option)`` as the screen stands: the chosen option, else the default."""
    out = []
    for control in _controls(starter):
        option = next((o for o in control["options"] if o.get("id") == (choices or {}).get(control.get("id"))), None)
        out.append((control, option or _default(control)))
    return out


def _place_override(starter, choices):
    """The place column the chosen option numbers the rows by, when it names one
    (Top RS Rating's 1-month board): ``rsScreens.placeOverride``."""
    for _control, option in _active(starter, choices):
        if option and isinstance(option.get("place"), str) and option["place"]:
            return option["place"]
    return None


def _theme_of(ticker) -> Optional[str]:
    """The theme the page prints for a row: the first one the Watchlist's own theme
    read names (``POST /api/watchlists/themes-batch`` asks the same function the same
    way). None when the stock has no theme or the read fails: the group is then the
    row's industry, as on the page."""
    try:
        from api.services.theme_db import get_themes_for_ticker   # noqa: PLC0415 - lazy
        themes = get_themes_for_ticker(str(ticker or "").upper().strip())
        first = themes[0] if themes else None
        return (first.get("theme_name") if isinstance(first, dict) else None) or None
    except Exception:                                       # noqa: BLE001 - a theme is never worth an answer
        return None


def _limit(limit) -> int:
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = DEFAULT_LIMIT
    return min(max(n, 1), MAX_LIMIT)


# ── the list ────────────────────────────────────────────────────────────────

def list_screen(screen, *, user, limit=DEFAULT_LIMIT, option_ids=None) -> dict:
    """One of the five screens, as the Screener lists it.

    ``screen`` is one of :data:`SCREENS`. ``option_ids`` names quick-control choices
    (see :func:`resolve_options`); none means the screen as it opens. ``limit`` is how
    many rows come back (1 to :data:`MAX_LIMIT`); ``total`` is how many the screen lists.

    Returns ``{ok, screen, name, description, asof, total, rows, chosen, controls,
    note}``. ``asof`` is the rating session the rows carry (``rs_rating_session``).
    Each row: ``{ticker, company, rs_rank, place, setup, tag, group, caption}``, the
    words exactly as the screen prints them. Never raises."""
    try:
        if not _screens_on(user):
            return _refuse(NOT_AVAILABLE)
        starters = _starters(user)
        if not starters:
            return _refuse(NOT_AVAILABLE)
        name = screen_named(screen, starters)
        if name is None:
            return _refuse(f"'{screen}' is not one of the RS screens.",
                           screens=[{"screen": k, "name": v.get("name")} for k, v in starters.items()])
        starter = starters[name]
        choices, problems = resolve_options(starter, option_ids)
        if problems:
            return _refuse("; ".join(problems) + ".", screen=name, name=starter.get("name"),
                           controls=choices_offered(starter))
        return _list(name, starter, choices, user or {}, _limit(limit))
    except ValueError as exc:
        # the scan's own refusals are sentences written for a member (query.build_where)
        return _refuse(str(exc))
    except Exception:                                       # noqa: BLE001 - a tool answers, never raises
        log.exception("rs_screens_service: list_screen(%r) failed", screen)
        return _refuse(COULD_NOT_READ)


def _list(name, starter, choices, user, limit) -> dict:
    from api.services.screener import query, rs_words      # noqa: PLC0415 - lazy
    cfg = rs_words.row_config(starter, _place_override(starter, choices))
    # `industry` is read on every screen: a row's `group` is answered whether or not the
    # screen's own caption prints it
    columns = list(dict.fromkeys(["ticker", "company", "industry", *rs_words.row_columns(cfg)]))
    spec = spec_with_choices(starter, choices)
    out = query.run_scan({**spec, "columns": columns, "page": 1, "page_size": limit},
                         user_id=user.get("id"), user=user)
    served = out.get("rows") or []
    rows = []
    # one New York date for the whole list: the earnings tag counts from it (unit U12)
    today = rs_words.today_in_new_york()
    for i, r in enumerate(served):
        theme = _theme_of(r.get("ticker"))
        shown = rs_words.row_display(r, cfg, index=i, theme=theme, today=today)
        rank = r.get("rs_rank")
        rows.append({
            "ticker": r.get("ticker"), "company": r.get("company"),
            "rs_rank": rank if rs_words._num(rank) else None,
            "place": shown["place"], "setup": rs_words.setup_words(r), "tag": shown["tag"],
            "group": rs_words.group_words(r, theme), "caption": shown["caption"],
        })
    asof = next((r.get("rs_rating_session") for r in served if r.get("rs_rating_session")), None)
    total = out.get("total")
    result = {
        "ok": True, "screen": name, "name": starter.get("name"),
        "description": starter.get("description"), "asof": asof, "total": total, "rows": rows,
        "chosen": {c.get("id"): (o or {}).get("id") for c, o in _active(starter, choices)},
        "controls": choices_offered(starter),
    }
    receipt = out.get("rank")
    if isinstance(receipt, dict):
        # a ranked screen lists its top N; `qualify` is how many passed its rules
        result["qualify"], result["top_n"] = receipt.get("ranked"), receipt.get("top_n")
    result["note"] = _list_note(starter, result)
    return result


def _list_note(starter, result) -> str:
    from api.services.screener import rs_words              # noqa: PLC0415 - lazy
    parts = []
    as_of = rs_words.ratings_as_of(result.get("asof"))
    if as_of:
        parts.append(f"{as_of}.")
    shown, total, top_n = len(result["rows"]), result.get("total"), result.get("top_n")
    empty = (starter.get("empty") or {}).get("text")
    if not shown:
        parts.append(str(empty) if empty else "No stock is on this list right now.")
    elif isinstance(top_n, int) and isinstance(total, int):
        # a ranked screen lists its top N of the stocks that pass its rules
        listed = min(total, top_n)
        parts.append(f"Showing the first {shown} of the {listed:,} listed; {total:,} stocks pass the rules."
                     if total > listed else f"Showing {shown} of {listed:,}.")
    elif isinstance(total, int) and total > shown:
        parts.append(f"Showing the first {shown} of {total:,}.")
    steady = _steady(starter)
    if shown and steady and _is_number(steady.get("enter")) and _is_number(steady.get("hold")):
        parts.append(f"A stock joins in the top {int(steady['enter']):,} of those that pass the rules "
                     f"and stays until it falls past {_ordinal(int(steady['hold']))}.")
    parts.append(WATCHLIST_NOTE)
    return " ".join(parts)


# ── one stock against the five ──────────────────────────────────────────────

def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def clause_passes(clause, row) -> Optional[bool]:
    """Does ``row`` pass one filter clause, judged the way the scan judges it
    (``query.build_where``)? True or False, or None when one row cannot say (a pool, a
    scan join, a field compared with a field, a list stored as tokens).

    A comparison FAILS on a blank value: the scan cannot compare what it does not hold.
    An exclude list PASSES on a blank: the scan keeps a row whose value it does not
    hold, so a stock with no Setup flag is not a "Buyout pending" stock."""
    from api.services.screener import filters               # noqa: PLC0415 - lazy
    key, op = clause.get("key"), clause.get("op")
    column = filters.column_for(key) if isinstance(key, str) and key in filters.FILTERS else None
    if not column or not filters.is_valid_op(key, op):
        return None
    v = row.get(column)
    blank = v is None or (isinstance(v, float) and not math.isfinite(v))
    if op in ("in", "not_in"):
        values = clause.get("values")
        if not isinstance(values, list) or not values or filters.is_token_list(key):
            return None
        return (blank or v not in values) if op == "not_in" else (not blank and v in values)
    if op == "eq":
        if clause.get("value") is None:
            return None
        return (not blank) and v == clause["value"]
    lo, hi = clause.get("min"), clause.get("max")
    needs = {"gte": (lo,), "gt": (lo,), "lte": (hi,), "lt": (hi,), "between": (lo, hi)}.get(op)
    if needs is None or not all(_is_number(x) for x in needs):
        return None
    if blank:
        return False
    if not _is_number(v):
        return None
    return {"gte": lambda: v >= lo, "gt": lambda: v > lo, "lte": lambda: v <= hi,
            "lt": lambda: v < hi, "between": lambda: lo <= v <= hi}[op]()


def _say(key, v) -> str:
    """One value in words: a yes/no, a label code as its word, a number plainly."""
    from api.services.screener import filters, rs_setup    # noqa: PLC0415 - lazy
    if v is None:
        return "no value"
    if (filters.FILTERS.get(key) or {}).get("type") == "bool":
        return "yes" if v in (1, True) else "no"
    if isinstance(v, str):
        return rs_setup.SETUP_LABELS.get(v, v)
    if _is_number(v):
        return f"{int(v):,}" if float(v) == int(v) else f"{round(float(v), 2):,}"
    return str(v)


def rule_words(clause, row) -> dict:
    """A rule a stock misses: ``{key, label, text}``, the text one plain sentence
    ("Avg daily range: needs at least 3, has 2.1")."""
    from api.services.screener import filters, rs_words    # noqa: PLC0415 - lazy
    key, op = clause.get("key"), clause.get("op")
    label = rs_words.rule_label(key)
    has = _say(key, row.get(filters.column_for(key)))
    lo, hi = _say(key, clause.get("min")), _say(key, clause.get("max"))
    if op in ("in", "not_in"):
        listed = ", ".join(_say(key, x) for x in clause.get("values") or [])
        needs = f"must not be {listed}" if op == "not_in" else f"needs one of {listed}"
    else:
        needs = "needs " + {"gte": f"at least {lo}", "gt": f"more than {lo}", "lte": f"at most {hi}",
                            "lt": f"less than {hi}", "between": f"between {lo} and {hi}",
                            "eq": _say(key, clause.get("value"))}.get(op, "a value this check does not know")
    return {"key": key, "label": label, "text": f"{label}: {needs}, has {has}"}


def _check_columns(starters) -> list:
    """Every column the five screens' rules and rankings read, each once."""
    from api.services.screener import filters               # noqa: PLC0415 - lazy
    cols = ["company", "rs_rank", "rs_rating_session"]
    for s in starters.values():
        spec = s["spec"]
        keys = [f.get("key") for f in spec.get("filters") or []]
        keys += [c.get("key") for c in (spec.get("rank") or {}).get("criteria") or []]
        steady = _steady(s)
        if steady:
            keys += [steady["key"], steady["by"]]
        for key in keys:
            column = filters.column_for(key) if key in filters.FILTERS else None
            if column:
                cols.append(column)
    return list(dict.fromkeys(cols))


def _ranked_place(starter, ticker, user):
    """Where a stock that passes a RANKED screen's rules stands on it: its 1-based
    place on the list the screen shows, or None when it is outside the top N. Asked of
    the scan itself, so the answer is the screen's."""
    from api.services.screener import query                 # noqa: PLC0415 - lazy
    top_n = (starter["spec"].get("rank") or {}).get("top_n")
    out = query.run_scan({**starter["spec"], "columns": ["ticker"], "page": 1,
                          "page_size": top_n if isinstance(top_n, int) and top_n > 0 else MAX_LIMIT},
                         user_id=user.get("id"), user=user)
    listed = [str(r.get("ticker") or "").upper() for r in out.get("rows") or []]
    receipt = out.get("rank") if isinstance(out.get("rank"), dict) else {}
    return (listed.index(ticker) + 1 if ticker in listed else None), receipt.get("ranked"), top_n


def _steady(starter) -> Optional[dict]:
    """How a list that keeps its own members is kept (``row.steady``, unit U12: UCT RS
    Leaders), or None for every other screen: ``{key, by, enter, hold}``, the membership
    column, the column the qualifiers are ranked by, and the two ranks of the rule."""
    st = (starter.get("row") or {}).get("steady")
    if not isinstance(st, dict) or not all(isinstance(st.get(k), str) and st.get(k) for k in ("key", "by")):
        return None
    return st


def _ordinal(n: int) -> str:
    """1 -> "1st", 22 -> "22nd", 63 -> "63rd", 111 -> "111th" (the page's ``whyNot.ordinal``)."""
    k = abs(n) % 100
    return f"{n:,}" + ("th" if 11 <= k <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(k % 10, "th"))


def _steady_place(starter, ticker, user, *, member: bool):
    """Where a stock that passes the rules of a KEPT list stands: ``(place, of)``.

    A member: its place on the list and how many the list holds, asked of the scan with
    the starter's own spec, so it is the numeral the screen prints. A stock that is not
    a member: its rank among every stock that passes the rules and how many do, by the
    rating pass's own ranking (``rs_leaders_list.standing``: the order the list was
    decided on). No rule is typed here for either."""
    from api.services.screener import query, rs_leaders_list     # noqa: PLC0415 - lazy
    if not member:
        return rs_leaders_list.standing(ticker)
    out = query.run_scan({**starter["spec"], "columns": ["ticker"], "page": 1, "page_size": STEADY_PAGE},
                         user_id=user.get("id"), user=user)
    listed = [str(r.get("ticker") or "").upper() for r in out.get("rows") or []]
    total = out.get("total")
    return (listed.index(ticker) + 1 if ticker in listed else None), (total if isinstance(total, int) else None)


def steady_words(steady, rank) -> str:
    """Why a stock that passes every rule of a kept list is not on it: the page's own
    sentence (``whyNot.whyNotHeadline``)."""
    enter, hold = steady.get("enter"), steady.get("hold")
    if not (_is_number(enter) and _is_number(hold)):
        return "Passes every rule, but it is not on the list today."
    kept = (f"the list holds the top {int(enter):,} (a listed stock stays until it falls "
            f"past {_ordinal(int(hold))})")
    if isinstance(rank, int):
        return f"Passes every rule; ranked {_ordinal(rank)}, {kept}."
    return f"Passes every rule and is not on the list today: {kept}."


def check_ticker(ticker, *, user) -> dict:
    """Which of the five screens one stock is on, as each opens, and for UCT RS Leaders
    the first rule it misses.

    The stock's row is ``query.rows_for``'s (the values the scan itself serves) and
    every rule is the starter's own clause, judged by :func:`clause_passes`.

    Returns ``{ok, ticker, company, rs_rank, asof, stale, on, screens, note}``; ``on``
    is the names of the screens it is on. Each of ``screens``: ``{screen, name, on}``,
    plus ``place`` and ``of`` on a ranked screen and ``misses`` (``rule_words``) on UCT
    RS Leaders when it is not on it. UCT RS Leaders keeps its own members (unit U12): a
    member carries its ``place`` on the list and ``of`` (how many it holds); a stock
    that passes every rule and is not a member carries ``rank`` (among the stocks that
    pass), ``of`` (how many pass) and ``why``, the page's own sentence. Never raises."""
    try:
        if not _screens_on(user):
            return _refuse(NOT_AVAILABLE)
        return _check(ticker, user or {})
    except ValueError as exc:
        return _refuse(str(exc))
    except Exception:                                       # noqa: BLE001 - a tool answers, never raises
        log.exception("rs_screens_service: check_ticker failed")
        return _refuse(COULD_NOT_READ)


def _check(ticker, user) -> dict:
    from api.services.screener import query, rs_words      # noqa: PLC0415 - lazy
    text = str(ticker if ticker is not None else "").strip().lstrip("$")
    syms = query.row_tickers(text) if "," not in text else []
    if len(syms) != 1:
        return _refuse(NOT_A_TICKER)
    sym = syms[0]
    starters = _starters(user)
    if not starters:
        return _refuse(NOT_AVAILABLE)
    hit = query.rows_for([sym], _check_columns(starters), user=user).get(sym)
    if hit is None:
        return _refuse(NO_SUCH_STOCK, ticker=sym)
    row, stale = hit["row"], bool(hit.get("stale"))
    screens = []
    for name, starter in starters.items():
        spec = starter["spec"]
        steady = _steady(starter)
        # a kept list's membership clause is its ANSWER, never one of the rules a stock
        # passes or misses (unit U12)
        rules = [f for f in spec.get("filters") or [] if not (steady and f.get("key") == steady["key"])]
        verdicts = [(f, clause_passes(f, row)) for f in rules]
        missed = next((f for f, ok in verdicts if ok is False), None)
        unsure = any(ok is None for _f, ok in verdicts) or bool(spec.get("logic"))
        item = {"screen": name, "name": starter.get("name")}
        if missed is not None or stale:
            item["on"] = False
        elif unsure:
            # a rule one row cannot settle is never counted as passed
            item["on"] = None
        elif steady:
            # the starter's own membership clause, judged like any other
            own = next((f for f in spec.get("filters") or [] if f.get("key") == steady["key"]), None)
            member = own is not None and clause_passes(own, row) is True
            place, of = _steady_place(starter, sym, user, member=member)
            item["on"] = member
            item["place"], item["of"] = (place if member else None), of
            if not member:
                item["rank"] = place
                item["why"] = steady_words(steady, place)
        elif spec.get("rank"):
            place, ranked, top_n = _ranked_place(starter, sym, user)
            item["on"] = place is not None
            item["place"], item["of"] = place, ranked
            if place is None:
                item["why"] = (f"Passes every rule, but the list shows the top {top_n} by "
                               f"{(starter.get('row') or {}).get('sort_label') or 'its ranking'}.")
        else:
            item["on"] = True
        if missed is not None and name in FIRST_MISS_SCREENS:
            item["misses"] = rule_words(missed, row)
        screens.append(item)
    on = [s["name"] for s in screens if s["on"] is True]
    asof = row.get("rs_rating_session")
    rank = row.get("rs_rank")
    notes = []
    as_of = rs_words.ratings_as_of(asof)
    if as_of:
        notes.append(f"{as_of}.")
    if stale:
        notes.append(STALE_NOTE)
    notes.append(WATCHLIST_NOTE)
    return {"ok": True, "ticker": sym, "company": row.get("company"),
            "rs_rank": rank if _is_number(rank) else None, "asof": asof, "stale": stale,
            "on": on, "screens": screens, "note": " ".join(notes)}
