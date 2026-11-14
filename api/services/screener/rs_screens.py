"""The five Relative Strength screens (plan 2026-11-14 v2, sections 1, 4 and 5).

Top RS Rating, RS New Highs, RS New High Before Price, UCT RS Leaders and RS exit
warnings: the starters `saved_screens.rs_starters()` serves while
``RS_SCREENS_ENABLED`` is on, with the quick controls, the row recipe and the empty
state each one carries. The client (unit U5) builds to the same contract,
``CONTRACT-SCREENS.md`` in the project's RS screens folder; a key or a word changed
here changes there.

PURE DATA. No I/O, no env read: the flag is read by the caller. Every function returns
fresh dicts, so a caller may mutate what it is handed.

WHY THE CONTROLS ARE FILTERS (plan section 4: "a member can change who is on a list,
never how it is ranked or labelled"). A control owns the filter keys in ``keys``.
Choosing an option replaces every clause on those keys in the working spec with the
option's ``filters`` (and sets ``spec.sort`` when the option carries one), so the
Filters drawer, its count and the "(edited)" mark agree with the control. That only
works while three things hold, and `tests/test_rs_screens_u4_starters.py` holds them:
the default option's clauses ARE the spec's clauses on the control's keys; no two
controls of one screen share a key; and every option, applied, is a spec the scan
accepts.

ONE FLOOR. `rs_post_pass.LIQUID_FLOOR` (price $10+, $20M+ traded a day) is read, never
retyped; "stocks only" is added by `saved_screens._stocks_only` like every starter's.
"""
from __future__ import annotations

from . import rs_post_pass, rs_setup

#: The picker group. Equal to `saved_screens.RS_STARTER_GROUP` (a test holds the two).
GROUP = "Relative strength"

#: Starters that leave the picker while the five are served (plan section 1, owner
#: decision D4): six single-rule RS lists the five absorb, and "Leaders (RS >= 90)",
#: which Top RS Rating and UCT RS Leaders replace. HIDDEN, NEVER DELETED: each stays in
#: the payload with ``hidden: true`` so a pinned or last-used id still resolves and its
#: nightly membership record goes on.
RETIRED_IDS = (
    "starter_rs_nh_red_day", "starter_rs_green_on_red", "starter_rs_cross_up_21ema",
    "starter_rs_mansfield_positive", "starter_rs_leaders_equal_weight",
    "starter_rs_quicksand_5", "starter_momentum_leaders",
)

# ── the windows and thresholds (each named once; the methodology reads them) ──

#: "This week" is the last five sessions: ages 0 to 4 (0 = the newest session).
WEEK_AGE = 4
#: "This month": ages 0 to 20.
MONTH_AGE = 20
#: "Down days only": an RS new high on a market down day within the last ten sessions.
DOWN_DAY_AGE = 9
#: Before price: the close is this far under its own 252-session closing high, percent.
#: 3% is the default (owner decision D6); past 25% it is a broken chart, not a lag.
BELOW_HIGH_NEAR = -3
BELOW_HIGH_FAR = -25
BELOW_HIGH_CHOICES = (3, 5, 10)
#: UCT RS Leaders (plan section 1.4; owner decisions D2 and D7).
LEADERS_MIN_RATING = 80
LEADERS_RATING_CHOICES = (80, 85, 90, 95)
LEADERS_MIN_ADR_PCT = 3
LEADERS_MIN_MARKET_CAP = 300_000_000
LEADERS_MAX_BELOW_HIGH = -25
LEADERS_TOP_N = 50
#: What the list head calls the order of UCT RS Leaders (unit U7): its one rank
#: criterion, `rs_rating_score`, is the RS Rating before rounding.
LEADERS_SORT_LABEL = "RS Rating"
#: RS exit warnings: a warning in the last five sessions.
EXIT_AGE = 4
#: "New to 90+" and "90 and up" on Top RS Rating.
TOP_RATING_LINE = 90
#: Setup flags the four LIST screens leave out (coordinator decision, unit U6,
#: 2026-11-14): a stock pinned at a deal price ranks near the top on relative strength
#: and has nowhere left to go, so it is not a name to study. Written as an ordinary
#: exclude clause (`no_buyouts`), so the Filters drawer shows it and a member can take
#: it off. RS exit warnings does NOT carry it: a warning on a stock a member holds is
#: worth seeing whatever the stock is.
EXCLUDED_FLAGS = ("buyout_pending",)
#: The four screens that carry the exclusion, by id (the method page reads this).
NO_BUYOUT_SCREENS = ("starter_rs_top_rating", "starter_rs_new_high",
                     "starter_rs_nh_before_price", "starter_rs_leaders")


# ── clause and control builders ─────────────────────────────────────────────

def _whole(v):
    """`10.0` -> `10`: a floor read from its constant, as the whole number it is."""
    return int(v) if float(v) == int(v) else float(v)


def _gte(key, v):
    return {"key": key, "op": "gte", "min": v}


def _gt(key, v):
    return {"key": key, "op": "gt", "min": v}


def _lt(key, v):
    return {"key": key, "op": "lt", "max": v}


def _between(key, lo, hi):
    return {"key": key, "op": "between", "min": lo, "max": hi}


def _eq(key, v):
    return {"key": key, "op": "eq", "value": v}


def _not_in(key, values):
    return {"key": key, "op": "not_in", "values": list(values)}


def _sort(key, direction, then=None):
    out = {"key": key, "dir": direction}
    if then:
        out["then"] = {"key": then[0], "dir": then[1]}
    return out


def _option(option_id, label, filters=(), *, default=False, sort=None, place=None):
    """One option of a control. ``place`` (unit U6) names the column the row's place
    numeral reads WHILE THIS OPTION IS CHOSEN, when it is not the screen's own
    (``row.place``): the 1-month board of Top RS Rating numbers its rows by
    ``rs_pos_1m``. Without it a list ordered by the 1-month place printed each row's
    OVERALL place beside it (3, 7, 29, 1, ...), which reads as a list out of order."""
    out = {"id": option_id, "label": label}
    if default:
        out["default"] = True
    out["filters"] = [dict(f) for f in filters]
    if sort:
        out["sort"] = sort
    if place:
        out["place"] = place
    return out


def _control(control_id, label, keys, options):
    return {"id": control_id, "label": label, "keys": list(keys), "options": list(options)}


def floor() -> list:
    """The two clauses of the RS liquid floor, from `rs_post_pass.LIQUID_FLOOR`."""
    f = rs_post_pass.LIQUID_FLOOR
    return [_gte("price", _whole(f["price_min"])),
            _gte("dollar_vol_30d", _whole(f["dollar_vol_30d_min"]))]


def no_buyouts() -> dict:
    """The clause that leaves :data:`EXCLUDED_FLAGS` out of a list screen.

    ⛔ A ROW WITH NO FLAG STAYS. Nearly every row's ``rs_flag`` is NULL (no flag
    applies), and the scan keeps a NULL under an exclude list (`query.build_where`,
    ``not_in``: ``col NOT IN (...) OR col IS NULL``). A plain ``!=`` would have emptied
    all four screens. `tests/test_rs_screens_u4_starters.py` runs it both ways."""
    return _not_in("rs_flag", EXCLUDED_FLAGS)


def _min_rating(levels, default=None):
    """The "Min RS Rating" control over `rs_rank`. ``default=None`` leads with "Any"."""
    options = [] if default is not None else [_option("any", "Any", default=True)]
    options += [_option(f"r{n}", str(n), [_gte("rs_rank", n)], default=(n == default))
                for n in levels]
    return _control("min", "Min RS Rating", ["rs_rank"], options)


def _when(key, default="week"):
    """The "When" control over an age column: today, this week, this month."""
    spans = (("today", "Today", 0), ("week", "This week", WEEK_AGE),
             ("month", "This month", MONTH_AGE))
    return _control("when", "When", [key],
                    [_option(i, label, [_between(key, 0, hi)], default=(i == default))
                     for i, label, hi in spans])


# ── the five ────────────────────────────────────────────────────────────────

def top_rating() -> dict:
    """1. Top RS Rating: every liquid stock in exact rating order (plan 1.1)."""
    place = _gte("rs_rating_pos", 1)        # ">= 1" is the presence test: a ranked row
    periods = (("m1", "1M", "rs_pos_1m"), ("m3", "3M", "rs_pos_3m"),
               ("m6", "6M", "rs_pos_6m"), ("m12", "12M", "rs_pos_12m"))
    rank_by = _control(
        "rank_by", "Rank by",
        ["rs_rating_pos", "rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m",
         "rs_rating_chg_20", "pct_vs_sma50"],
        [_option("overall", "Overall", [place], default=True,
                 sort=_sort("rs_rating_pos", "asc")),
         # each period board is numbered by its own place column (`place`, unit U6)
         *[_option(i, label, [_gte(col, 1)], sort=_sort(col, "asc"), place=col)
           for i, label, col in periods],
         # Rising fastest is partly names bouncing back (plan 1.1), so it is held to
         # stocks above their 50-day line, and ties fall to the overall place.
         _option("rising", "Rising fastest",
                 [place, _gte("rs_rating_chg_20", 1), _gt("pct_vs_sma50", 0)],
                 sort=_sort("rs_rating_chg_20", "desc", then=("rs_rating_pos", "asc")))])
    show = _control(
        "show", "Show", ["rs_rank", "rs_rating_prev20"],
        [_option("all", "All", default=True),
         _option("r90", f"{TOP_RATING_LINE} and up", [_gte("rs_rank", TOP_RATING_LINE)]),
         _option("new90", f"New to {TOP_RATING_LINE}+",
                 [_gte("rs_rank", TOP_RATING_LINE), _lt("rs_rating_prev20", TOP_RATING_LINE)])])
    return {
        "id": "starter_rs_top_rating", "name": "Top RS Rating", "group": GROUP,
        "description": ("Every liquid stock ranked by RS Rating, strongest first, "
                        "with its exact place"),
        "spec": {"filters": [*floor(), place, no_buyouts()], "view": "rs_top_rating",
                 "sort": _sort("rs_rating_pos", "asc")},
        "controls": [rank_by, show],
        "row": {"place": "rs_rating_pos", "caption": ["setup", "moving"],
                "tags": ["flag", "new"]},
    }


def new_highs() -> dict:
    """2. RS New Highs: the RS line at a 52-week high this week (plan 1.2)."""
    return {
        "id": "starter_rs_new_high", "name": "RS New Highs", "group": GROUP,
        "description": "Stocks whose RS line (price against SPY) hit a 52-week high this week",
        "spec": {"filters": [*floor(), _gt("pct_vs_sma200", 0),
                             _between("rs_nh_bars_ago", 0, WEEK_AGE), no_buyouts()],
                 "view": "rs_new_highs",
                 "sort": _sort("rs_nh_bars_ago", "asc", then=("rs_rating_score", "desc"))},
        "controls": [
            _when("rs_nh_bars_ago"),
            _min_rating((70, 80, 90)),
            _control("down", "Market", ["rs_nh_red_bars_ago"],
                     [_option("all", "Any day", default=True),
                      _option("down", "Down days only",
                              [_between("rs_nh_red_bars_ago", 0, DOWN_DAY_AGE)])]),
        ],
        "row": {"place": None, "caption": ["rs_high_age", "group"],
                "tags": ["before_price", "down_day", "flag", "new"]},
    }


def before_price() -> dict:
    """3. RS New High Before Price: the RS line leads, price has not followed (plan 1.3)."""
    below = _control(
        "below", "Below its high by", ["px_below_high_pct"],
        [_option(f"p{n}", f"{n}%", [_between("px_below_high_pct", BELOW_HIGH_FAR, -n)],
                 default=(-n == BELOW_HIGH_NEAR))
         for n in BELOW_HIGH_CHOICES])
    return {
        "id": "starter_rs_nh_before_price", "name": "RS New High Before Price", "group": GROUP,
        "aliases": ["RSNHBP", "RS new high before price", "blue dot"],
        "description": ("RS line at a 52-week high while price is still below its own "
                        "high. Often an early sign"),
        "spec": {"filters": [*floor(), _gt("pct_vs_sma200", 0),
                             _between("rs_nhbp_age", 0, WEEK_AGE),
                             _between("px_below_high_pct", BELOW_HIGH_FAR, BELOW_HIGH_NEAR),
                             no_buyouts()],
                 "view": "rs_before_price",
                 "sort": _sort("px_below_high_pct", "desc", then=("rs_rating_score", "desc"))},
        "controls": [_when("rs_nhbp_age"), below, _min_rating((70, 80))],
        "row": {"place": None, "caption": ["below_high", "group"],
                "tags": ["down_day", "flag", "new"]},
        "empty": {
            "text": ("No RS line made a 52-week high ahead of price this week. "
                     "That is normal in a weak market."),
            "actions": [
                {"label": "Show this month", "control": "when", "option": "month"},
                {"label": "Open RS New Highs", "open": "starter_rs_new_high"},
            ]},
    }


def leaders() -> dict:
    """4. UCT RS Leaders: the gate written as ordinary filters, so the controls and the
    Filters drawer can adjust it (plan 1.4 and 9); ordered by the unrounded score."""
    show = _control(
        "show", "Show", ["rs_near_buy", "rs_setup"],
        [_option("all", "All", default=True),
         _option("near", "Near a buy point", [_eq("rs_near_buy", 1)]),
         _option("noext", "Hide extended",
                 [_not_in("rs_setup", rs_setup.NOT_BUY_POINT_SETUPS)])])
    return {
        "id": "starter_rs_leaders", "name": "UCT RS Leaders", "group": GROUP,
        "description": ("The strongest liquid stocks in real uptrends, each labelled "
                        "extended or near a buy point"),
        "spec": {"filters": [*floor(),
                             _gte("adr_pct", LEADERS_MIN_ADR_PCT),
                             _gte("market_cap", LEADERS_MIN_MARKET_CAP),
                             _gte("rs_rank", LEADERS_MIN_RATING),
                             _gt("pct_vs_sma200", 0),
                             _eq("sma200_rising", 1),
                             _gte("dist_52w_high_pct", LEADERS_MAX_BELOW_HIGH),
                             _eq("rs_line_above_ma", 1),
                             no_buyouts()],
                 "view": "rs_leaders",
                 "rank": {"criteria": [{"key": "rs_rating_score", "weight": 1}],
                          "top_n": LEADERS_TOP_N}},
        "controls": [show, _min_rating(LEADERS_RATING_CHOICES, default=LEADERS_MIN_RATING)],
        # `sort_label` (unit U7): the list head said "Sort: Your ranking", the wording for
        # any ranked screen. This ranking is ours and it is the RS Rating, so the screen
        # says so. The client prints it only while the working spec still carries this
        # rank; every other ranked screen (UCT 50) keeps "Your ranking".
        "row": {"place": "index", "caption": ["setup", "group"], "tags": ["flag", "new"],
                "sort_label": LEADERS_SORT_LABEL},
    }


def exit_warnings() -> dict:
    """5. RS exit warnings: the existing five-session screen on the RS floor, with one
    Type option per warning the `rs_exit_last` filter itself offers."""
    from . import filters                                # noqa: PLC0415 - lazy: no cycle
    kinds = [p for p in filters.FILTERS["rs_exit_last"]["presets"] if p.get("op") == "eq"]
    kind = _control(
        "type", "Type", ["rs_exit_last"],
        [_option("any", "Any", default=True),
         *[_option(str(p["value"]).lower().replace(" ", "_"), p["label"],
                   [_eq("rs_exit_last", p["value"])]) for p in kinds]])
    return {
        "id": "starter_rs_exit_warning_5", "name": "RS exit warnings", "group": GROUP,
        "description": ("RS line just broke down. A prompt to review a position, "
                        "not an order to sell"),
        "spec": {"filters": [_between("rs_exit_bars_ago", 0, EXIT_AGE), *floor()],
                 "view": "relative_strength",
                 "sort": _sort("rs_exit_bars_ago", "asc")},
        "controls": [kind],
        "row": {"place": None, "caption": ["group"], "tags": ["new"]},
    }


def screens() -> list:
    """The five, in the picker's order."""
    return [top_rating(), new_highs(), before_price(), leaders(), exit_warnings()]


def retire(starter: dict) -> dict:
    """``starter`` with ``hidden: true`` when it is one of :data:`RETIRED_IDS`, else as
    it came. Idempotent; never mutates its argument."""
    if starter.get("id") in RETIRED_IDS and not starter.get("hidden"):
        return {**starter, "hidden": True}
    return starter


def starters(previous: list) -> list:
    """What `saved_screens.rs_starters()` returns while the screens are on: the five,
    then every earlier RS starter the five did not replace, the retired ones hidden.
    ``previous`` is the list it returned before this unit (ids are kept, so three of
    the five take the place of the starter that held their id)."""
    five = screens()
    taken = {s["id"] for s in five}
    return five + [retire(s) for s in previous if s["id"] not in taken]
