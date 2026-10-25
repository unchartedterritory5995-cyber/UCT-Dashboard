"""Task 8.4 - the widget plan module: validator, upgrader, range resolver, summary.

Pure: every test passes a small stub catalog and a fixed `today`.
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from datetime import date

import pytest

from api.services.journal_two.widget_engine import plan as P


# -- a small stub catalog ----------------------------------------------------

@dataclass(frozen=True)
class _Field:
    label: str
    type: str | None = None
    ops: frozenset | None = None


@dataclass(frozen=True)
class _Source:
    label: str
    fields: dict


@dataclass(frozen=True)
class _Measure:
    label: str
    sources: frozenset
    unit: str = "dollars"


@dataclass
class _Catalog:
    sources: dict = field(default_factory=lambda: {
        "closed_trades": _Source("Closed trades", {
            "setup": _Field("Setup", "text"), "side": _Field("Side", "enum"),
            "ticker": _Field("Ticker", "text"), "hour_et": _Field("ET hour", "number"),
            "flagged": _Field("Flagged", "bool"), "exit_day": _Field("Exit day", "day"),
            "r_mult": _Field("R multiple", "number"), "tags": _Field("Tags", "tag"),
            # a field that declares its ops as a SET (I-1: an unhashable op crashed here)
            "venue": _Field("Venue", "enum", frozenset({"in", "not_in"}))}),
        "open_positions": _Source("Open positions", {
            "setup": _Field("Setup"), "ticker": _Field("Ticker")}),
        "trading_days": _Source("Trading days", {"weekday": _Field("Weekday")}),
    })
    measures: dict = field(default_factory=lambda: {
        "net_pnl": _Measure("Net P&L", frozenset({"closed_trades", "trading_days"})),
        "win_rate": _Measure("Win rate", frozenset({"closed_trades"}), "percent"),
        "avg_r": _Measure("Average R", frozenset({"closed_trades"}), "r"),
        "open_risk": _Measure("Open risk", frozenset({"open_positions"})),
    })
    accents: tuple = ("gold", "green", "red")
    refuse_view: str | None = None

    def view_allowed(self, plan):
        if self.refuse_view and plan["view"]["type"] == self.refuse_view:
            return "A line needs dates along the bottom."
        if plan["view"]["type"] == "line" and self.refuse_view is None:
            return "A line needs dates along the bottom."
        return None


CAT = _Catalog()


def full_plan() -> dict:
    """Every key specified, every value a non-default: validate must not touch it."""
    return {
        "v": 1,
        "source": "closed_trades",
        "accounts": {"id": "acct-1"},
        "range": {"from": "2026-10-01", "to": "2026-10-24"},
        "filters": [{"field": "side", "op": "in", "values": ["long"], "overridable": True}],
        "measures": [{"key": "net_pnl"}, {"key": "win_rate"}],
        "split": {"by": "setup", "then": "ticker"},
        "view": {"type": "table", "auto": False},
        "sort": {"measure": 1, "dir": "asc", "top": 12},
        "compare": {"mode": "range", "from": "2026-09-01", "to": "2026-09-24"},
        "display": {"title": "My setups", "titleAuto": False, "subtitle": "Oct",
                    "accent": "green", "showN": False, "target": 2500},
    }


def minimal(**over) -> dict:
    p = {"v": 1, "source": "closed_trades", "measures": [{"key": "net_pnl"}]}
    p.update(over)
    return p


# -- refusals: one row per refusal, exact member sentence ---------------------

def _f(field_="side", op="in", values=("long",), overridable=False):
    return {"field": field_, "op": op, "values": list(values), "overridable": overridable}


REFUSALS = [
    ("unknown source", minimal(source="journal_notes"), "That data isn't available for a widget."),
    ("unknown filter field", minimal(filters=[_f(field_="mood")]), "That field isn't available here."),
    ("unknown split field", minimal(split={"by": "mood", "then": None}), "That field isn't available here."),
    ("unknown op", minimal(filters=[_f(op="sounds_like")]), "That filter comparison isn't supported."),
    ("unknown measure", minimal(measures=[{"key": "vibes"}]), "That measure isn't available."),
    ("unknown view", minimal(view={"type": "pie", "auto": True}), "That view isn't available."),
    ("unknown range token", minimal(range={"token": "last_3_fortnights"}),
     "That date range isn't available."),
    ("unknown accent", minimal(display={"accent": "chartreuse"}), "That color isn't available."),
    ("four measures", minimal(measures=[{"key": "net_pnl"}, {"key": "win_rate"},
                                        {"key": "avg_r"}, {"key": "net_pnl"}]),
     "Pick up to 3 measures."),
    ("no measures", minimal(measures=[]), "Pick at least one measure."),
    ("two overridable", minimal(filters=[_f(overridable=True),
                                         _f(field_="setup", values=["x"], overridable=True)]),
     "Only one filter can be changed from the note."),
    ("then outside table", minimal(split={"by": "setup", "then": "ticker"},
                                   view={"type": "bar", "auto": True}),
     "A second split only works in a table."),
    ("top zero", minimal(sort={"measure": 0, "dir": "desc", "top": 0}),
     "Top N must be between 1 and 40."),
    ("top 41", minimal(sort={"measure": 0, "dir": "desc", "top": 41}),
     "Top N must be between 1 and 40."),
    ("nine filters", minimal(filters=[_f() for _ in range(9)]), "Use up to 8 filters."),
    ("51 values", minimal(filters=[_f(values=[f"v{i}" for i in range(51)])]),
     "A filter can hold up to 50 values."),
    ("long string", minimal(display={"title": "x" * 201}), "Text can be at most 200 characters."),
    ("long filter value", minimal(filters=[_f(values=["y" * 201])]),
     "Text can be at most 200 characters."),
    ("measure excludes source", minimal(source="open_positions"),
     "That measure doesn't apply to what this widget looks at."),
    ("view the shape cannot show", minimal(view={"type": "line", "auto": True}),
     "A line needs dates along the bottom."),
    ("fixed range reversed", minimal(range={"from": "2026-10-24", "to": "2026-10-01"}),
     "The start date is after the end date."),
    ("compare range reversed", minimal(compare={"mode": "range", "from": "2026-10-24",
                                                "to": "2026-10-01"}),
     "The start date is after the end date."),
    ("malformed date", minimal(range={"from": "10/01/2026", "to": "2026-10-24"}),
     "Dates need to look like 2026-10-24."),
    ("sort past measures", minimal(sort={"measure": 2, "dir": "desc", "top": 5}),
     "Sort by one of the measures you picked."),
    ("bad accounts", minimal(accounts="_all_"), "Pick all your accounts or one account."),
    ("previous of all", minimal(range={"token": "all"}, compare={"mode": "previous"}),
     "Comparing with the period before needs a date range, not all time or a number of trades."),
    # R-12: still refused for last-N-trades, with the same member sentence
    ("previous of last 20 trades", minimal(range={"token": "last_20_trades"},
                                           compare={"mode": "previous"}),
     "Comparing with the period before needs a date range, not all time or a number of trades."),
    # I-1: a non-string op against a field whose ops is a frozenset is refused, not a TypeError
    ("unhashable op", minimal(filters=[{"field": "venue", "op": ["x"], "values": ["a"]}]),
     "That filter comparison isn't supported."),
    # M-4: per-op value counts and value types
    ("between one value", minimal(filters=[_f("r_mult", "between", [1])]),
     "This filter needs a low value and a high value."),
    ("between three values", minimal(filters=[_f("r_mult", "between", [1, 2, 3])]),
     "This filter needs a low value and a high value."),
    ("between low above high", minimal(filters=[_f("r_mult", "between", [3, 1])]),
     "The low value is above the high value."),
    ("between text", minimal(filters=[_f("r_mult", "between", ["a", "b"])]),
     "That value doesn't fit this field."),
    ("between days reversed", minimal(filters=[_f("exit_day", "between",
                                                  ["2026-10-24", "2026-10-01"])]),
     "The low value is above the high value."),
    ("in with no values", minimal(filters=[_f("side", "in", [])]),
     "Pick at least one value for this filter."),
    ("not_in with no values", minimal(filters=[_f("side", "not_in", [])]),
     "Pick at least one value for this filter."),
    ("has_any with no values", minimal(filters=[_f("tags", "has_any", [])]),
     "Pick at least one value for this filter."),
    ("contains two values", minimal(filters=[_f("ticker", "contains", ["A", "B"])]),
     "This filter takes exactly one value."),
    ("contains a number", minimal(filters=[_f("ticker", "contains", [5])]),
     "That value doesn't fit this field."),
    ("is with no values", minimal(filters=[_f("flagged", "is", [])]),
     "This filter takes exactly one value."),
    ("is a string", minimal(filters=[_f("flagged", "is", ["yes"])]),
     "That value doesn't fit this field."),
    ("gt two values", minimal(filters=[_f("r_mult", "gt", [1, 2])]),
     "This filter takes exactly one value."),
    ("gte a string", minimal(filters=[_f("r_mult", "gte", ["1"])]),
     "That value doesn't fit this field."),
    ("eq on a text field", minimal(filters=[_f("setup", "eq", [1])]),
     "That value doesn't fit this field."),
    ("in number field with text", minimal(filters=[_f("hour_et", "in", ["ten"])]),
     "That value doesn't fit this field."),
    ("in text field with number", minimal(filters=[_f("setup", "in", [7])]),
     "That value doesn't fit this field."),
    ("in day field with bad day", minimal(filters=[_f("exit_day", "in", ["2026-02-30"])]),
     "That value doesn't fit this field."),
    ("in bool field with text", minimal(filters=[_f("flagged", "in", ["true"])]),
     "That value doesn't fit this field."),
    ("bad compare mode", minimal(compare={"mode": "yesterday"}), "That comparison isn't available."),
    ("unknown key", minimal(colour="red"), "This widget's settings couldn't be read."),
    ("missing source", {"v": 1, "measures": [{"key": "net_pnl"}]},
     "That data isn't available for a widget."),
    ("target not a number", minimal(display={"target": "lots"}), "The target must be a number."),
    ("bool top", minimal(sort={"measure": 0, "dir": "desc", "top": True}),
     "This widget's settings couldn't be read."),
]


@pytest.mark.parametrize("raw,sentence", [r[1:] for r in REFUSALS],
                         ids=[r[0] for r in REFUSALS])
def test_refuses(raw, sentence):
    with pytest.raises(P.PlanError) as ei:
        P.validate_plan(raw, CAT)
    assert str(ei.value) == sentence
    assert ei.value.sentence == sentence


def test_refusal_table_is_not_one_answer():
    # a validator that refused everything with one sentence would pass a sloppier table
    assert len({r[2] for r in REFUSALS}) >= 20


def test_view_refusal_uses_the_catalog_reason():
    cat = _Catalog(refuse_view="bar")
    with pytest.raises(P.PlanError) as ei:
        P.validate_plan(minimal(view={"type": "bar", "auto": True}), cat)
    assert str(ei.value) == "A line needs dates along the bottom."


def test_member_copy_avoids_internal_words():
    banned = ("plan", "source", "scope", "definition", "shelf", "built widget")
    sentences = [getattr(P, n) for n in dir(P) if n.startswith("S_")]
    assert len(sentences) >= 20   # non-vacuity: the sweep actually found the copy
    for text in sentences:
        for w in banned:
            assert w not in text.lower(), (text, w)


def test_missing_version_refused():
    raw = minimal()
    del raw["v"]
    with pytest.raises(P.PlanError) as ei:
        P.upgrade_plan(raw)
    assert not isinstance(ei.value, P.PlanTooNew)
    assert str(ei.value) == "This widget couldn't be read. Build it again to use it."


def test_too_new_refused_with_reload_sentence():
    raw = full_plan()
    raw["v"] = P.PLAN_VERSION + 1          # wave 9: PLAN_VERSION is 2 (ruling W9-R3)
    for fn in (lambda: P.upgrade_plan(raw), lambda: P.validate_plan(raw, CAT)):
        with pytest.raises(P.PlanTooNew) as ei:
            fn()
        assert str(ei.value) == ("This widget was made with a newer version of the app. "
                                 "Reload to use it.")
    assert issubclass(P.PlanTooNew, P.PlanError)
    assert issubclass(P.PlanError, ValueError)


def test_upgrade_is_identity_for_v1():
    p = full_plan()
    assert P.upgrade_plan(p) == p
    assert P.PLAN_VERSION == 2             # wave 9 (W9-R3); a wave 8 plan is still v1
    assert P.validate_plan(p, CAT)["v"] == 1


def test_v1_round_trips_unchanged():
    p = full_plan()
    before = copy.deepcopy(p)
    out = P.validate_plan(p, CAT)
    assert out == p
    assert p == before  # the input is not mutated
    assert P.validate_plan(out, CAT) == out


def test_defaults_range_last_90d():
    out = P.validate_plan(minimal(), CAT)
    assert out["range"] == {"token": "last_90d"}
    assert out["accounts"] == "all"
    assert out["filters"] == [] and out["split"] is None
    assert out["sort"] is None and out["compare"] is None
    assert out["view"] == {"type": "number", "auto": True}
    assert out["display"] == {"title": "", "titleAuto": True, "subtitle": "",
                              "accent": "gold", "showN": True, "target": None}
    # nothing else added
    assert set(out) == set(full_plan())


def test_partial_sub_objects_get_defaults():
    out = P.validate_plan(minimal(filters=[{"field": "side", "op": "in", "values": ["long"]}],
                                  sort={"top": 5}, display={"title": "Mine"}), CAT)
    assert out["filters"][0]["overridable"] is False
    assert out["sort"] == {"measure": 0, "dir": "desc", "top": 5}
    assert out["display"]["title"] == "Mine" and out["display"]["accent"] == "gold"


def test_split_defaults_the_view_to_bar():
    out = P.validate_plan(minimal(split={"by": "setup"}), CAT)
    assert out["split"] == {"by": "setup", "then": None}
    assert out["view"] == {"type": "bar", "auto": True}


# -- ranges ------------------------------------------------------------------

SAT = date(2026, 10, 24)


def test_resolve_range_weekend_this_week():
    assert SAT.weekday() == 5
    r = P.resolve_range({"token": "this_week"}, SAT)
    assert (r.from_day, r.to_day, r.last_n) == ("2026-10-19", "2026-10-24", None)
    assert r.label == "this week"


@pytest.mark.parametrize("token,frm,to,label", [
    ("today", "2026-10-24", "2026-10-24", "today"),
    ("last_week", "2026-10-12", "2026-10-18", "last week"),
    ("last_7d", "2026-10-18", "2026-10-24", "last 7 days"),
    ("last_30d", "2026-09-25", "2026-10-24", "last 30 days"),
    ("last_90d", "2026-07-27", "2026-10-24", "last 90 days"),
    ("this_month", "2026-10-01", "2026-10-24", "this month"),
    ("last_month", "2026-09-01", "2026-09-30", "last month"),
    ("this_quarter", "2026-10-01", "2026-10-24", "this quarter"),
    ("last_12m", "2025-10-25", "2026-10-24", "last 12 months"),
])
def test_resolve_range_tokens(token, frm, to, label):
    r = P.resolve_range({"token": token}, SAT)
    assert (r.from_day, r.to_day, r.last_n, r.label) == (frm, to, None, label)


def test_every_token_resolves():
    for tok in P.RANGE_TOKENS:
        r = P.resolve_range({"token": tok}, SAT)
        assert r.to_day and r.label


def test_last_quarter_and_ytd_labels():
    lq = P.resolve_range({"token": "last_quarter"}, SAT)
    assert (lq.from_day, lq.to_day, lq.label) == ("2026-07-01", "2026-09-30", "last quarter")
    q1 = P.resolve_range({"token": "last_quarter"}, date(2026, 2, 3))
    assert (q1.from_day, q1.to_day) == ("2025-10-01", "2025-12-31")
    ytd = P.resolve_range({"token": "ytd"}, SAT)
    assert (ytd.from_day, ytd.to_day, ytd.label) == ("2026-01-01", "2026-10-24", "year to date")


def test_all_and_last_n_trades():
    a = P.resolve_range({"token": "all"}, SAT)
    assert (a.from_day, a.to_day, a.last_n, a.label) == (None, "2026-10-24", None, "all time")
    for n in (20, 50, 100):
        t = P.resolve_range({"token": f"last_{n}_trades"}, SAT)
        assert (t.from_day, t.to_day, t.last_n, t.label) == (None, "2026-10-24", n,
                                                              f"last {n} trades")


def test_fixed_range_and_leap_day():
    r = P.resolve_range({"from": "2026-10-01", "to": "2026-10-24"}, SAT)
    assert (r.from_day, r.to_day, r.label) == ("2026-10-01", "2026-10-24",
                                               "Oct 1 to Oct 24, 2026")
    r2 = P.resolve_range({"from": "2025-12-30", "to": "2026-01-02"}, SAT)
    assert r2.label == "Dec 30, 2025 to Jan 2, 2026"
    leap = P.resolve_range({"token": "last_12m"}, date(2028, 2, 29))
    assert (leap.from_day, leap.to_day) == ("2027-03-01", "2028-02-29")
    with pytest.raises(P.PlanError):
        P.resolve_range({"from": "2026-10-24", "to": "2026-10-01"}, SAT)


def test_previous_range_same_length():
    """Trailing-day tokens and fixed ranges: the same length, immediately before."""
    r = P.resolve_range({"token": "last_90d"}, SAT)
    prev = P.previous_range(r)
    assert prev.to_day == "2026-07-26" and prev.from_day == "2026-04-28"

    def span(x):
        return (date.fromisoformat(x.to_day) - date.fromisoformat(x.from_day)).days
    assert span(prev) == span(r) == 89
    seven = P.previous_range(P.resolve_range({"token": "last_7d"}, SAT))
    assert (seven.from_day, seven.to_day) == ("2026-10-11", "2026-10-17")
    thirty = P.previous_range(P.resolve_range({"token": "last_30d"}, SAT))
    assert (thirty.from_day, thirty.to_day) == ("2026-08-26", "2026-09-24")
    fixed = P.previous_range(P.resolve_range({"from": "2026-10-01", "to": "2026-10-24"}, SAT))
    assert (fixed.from_day, fixed.to_day, fixed.label) == (
        "2026-09-07", "2026-09-30", "Sep 7 to Sep 30, 2026")
    for tok in ("all", "last_20_trades"):
        with pytest.raises(P.PlanError) as ei:
            P.previous_range(P.resolve_range({"token": tok}, SAT))
        assert str(ei.value) == P.S_NO_EARLIER


def test_resolved_range_carries_its_token():
    assert P.resolve_range({"token": "this_month"}, SAT).token == "this_month"
    assert P.resolve_range({"from": "2026-10-01", "to": "2026-10-02"}, SAT).token is None


@pytest.mark.parametrize("today,token,frm,to,label", [
    # Saturday 2026-10-24
    (SAT, "today", "2026-10-23", "2026-10-23", "Oct 23, 2026"),
    (SAT, "this_week", "2026-10-12", "2026-10-17", "the week of Oct 12"),
    (SAT, "last_week", "2026-10-05", "2026-10-11", "the week of Oct 5"),
    (SAT, "this_month", "2026-09-01", "2026-09-24", "Sep 1 to Sep 24, 2026"),
    (SAT, "last_month", "2026-08-01", "2026-08-31", "August 2026"),
    (SAT, "this_quarter", "2026-07-01", "2026-07-24", "Jul 1 to Jul 24, 2026"),
    (SAT, "last_quarter", "2026-04-01", "2026-06-30", "Q2 2026"),
    (SAT, "ytd", "2025-01-01", "2025-10-24", "Jan 1 to Oct 24, 2025"),
    (SAT, "last_12m", "2024-10-25", "2025-10-24", "Oct 25, 2024 to Oct 24, 2025"),
    # Monday 'today' -> the previous Friday session
    (date(2026, 10, 19), "today", "2026-10-16", "2026-10-16", "Oct 16, 2026"),
    # year boundary: Monday 2026-01-05 (Jan 1 is a holiday, Jan 2 a session)
    (date(2026, 1, 5), "today", "2026-01-02", "2026-01-02", "Jan 2, 2026"),
    (date(2026, 1, 5), "this_week", "2025-12-29", "2025-12-29", "the week of Dec 29"),
    (date(2026, 1, 5), "last_week", "2025-12-22", "2025-12-28", "the week of Dec 22"),
    (date(2026, 1, 5), "this_month", "2025-12-01", "2025-12-05", "Dec 1 to Dec 5, 2025"),
    (date(2026, 1, 5), "last_month", "2025-11-01", "2025-11-30", "November 2025"),
    (date(2026, 1, 5), "this_quarter", "2025-10-01", "2025-10-05", "Oct 1 to Oct 5, 2025"),
    (date(2026, 1, 5), "last_quarter", "2025-07-01", "2025-09-30", "Q3 2025"),
    (date(2026, 1, 5), "ytd", "2025-01-01", "2025-01-05", "Jan 1 to Jan 5, 2025"),
    (date(2026, 1, 5), "last_12m", "2024-01-06", "2025-01-05", "Jan 6, 2024 to Jan 5, 2025"),
    # month-end clamp: Mar 31 this_month -> Feb 1..Feb 28 (a whole month)
    (date(2026, 3, 31), "this_month", "2026-02-01", "2026-02-28", "February 2026"),
    # Feb 29 ytd -> the year before ends Feb 28
    (date(2028, 2, 29), "ytd", "2027-01-01", "2027-02-28", "Jan 1 to Feb 28, 2027"),
])
def test_previous_range_calendar_aligned(today, token, frm, to, label):
    prev = P.previous_range(P.resolve_range({"token": token}, today))
    assert (prev.from_day, prev.to_day, prev.last_n, prev.label) == (frm, to, None, label)


def test_one_day_span_reads_as_one_day():
    r = P.resolve_range({"from": "2026-01-04", "to": "2026-01-04"}, SAT)
    assert r.label == "Jan 4, 2026"


@pytest.mark.parametrize("flt", [
    {"field": "r_mult", "op": "between", "values": [1, 2.5]},
    {"field": "r_mult", "op": "between", "values": [2, 2]},
    {"field": "exit_day", "op": "between", "values": ["2026-10-01", "2026-10-24"]},
    {"field": "exit_day", "op": "gte", "values": ["2026-10-01"]},
    {"field": "side", "op": "in", "values": ["long", "short"]},
    {"field": "side", "op": "not_in", "values": ["short"]},
    {"field": "tags", "op": "has_any", "values": ["a+", "breakout"]},
    {"field": "ticker", "op": "contains", "values": ["NV"]},
    {"field": "flagged", "op": "is", "values": [False]},
    {"field": "r_mult", "op": "eq", "values": [1]},
    {"field": "r_mult", "op": "lt", "values": [-0.5]},
    {"field": "hour_et", "op": "in", "values": [9, 10]},
    {"field": "venue", "op": "in", "values": ["arca"]},
])
def test_valid_filters_pass(flt):
    out = P.validate_plan(minimal(filters=[dict(flt, overridable=False)]), CAT)
    assert out["filters"][0]["values"] == flt["values"]


def test_size_cap_applies_to_the_default_filled_plan():
    """M-2: a raw plan just under 16,384 B that crosses it once defaults are filled."""
    def size(p):
        return len(json.dumps(p, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    # 'overridable' omitted on purpose: the validator adds it to each of the 8 filters.
    filters = [{"field": "setup", "op": "in", "values": ["x"]} for _ in range(8)]
    raw = minimal(filters=filters)
    target = 16_380
    i = 0
    while size(raw) + 203 <= target:     # each 200-char value costs 203 bytes
        raw["filters"][i % 8]["values"].append("x" * 200)
        i += 1
    pad = target - size(raw) - 3
    if pad >= 0:
        raw["filters"][0]["values"].append("y" * pad)
    assert 16_300 <= size(raw) <= 16_384 and P.plan_size_ok(raw)
    assert size(raw) + 8 * len(',"overridable":false') > 16_384   # the defaults cross it
    with pytest.raises(P.PlanError) as ei:
        P.validate_plan(raw, CAT)
    assert str(ei.value) == "This widget is too large to save."


# -- summary + default name + hash -------------------------------------------

def test_summary_and_default_name_exact():
    p = P.validate_plan(minimal(split={"by": "setup"}), CAT)
    assert P.summary(p, CAT, 47, "trades") == (
        "Net P&L, split by setup, for closed trades in the last 90 days, all accounts. "
        "47 trades.")
    assert P.default_name(p, CAT) == "Net P&L by setup, last 90 days"

    q = P.validate_plan(full_plan(), CAT)
    assert P.summary(q, CAT, 1, "trades") == (
        "Net P&L and Win rate, split by setup then ticker, filtered by side, "
        "for closed trades from Oct 1 to Oct 24, 2026, compared with Sep 1 to Sep 24, 2026, "
        "one account. 1 trade.")
    assert P.default_name(q, CAT) == (
        "Net P&L and Win rate by setup and ticker, Oct 1 to Oct 24, 2026")

    r = P.validate_plan(minimal(source="trading_days", range={"token": "this_week"},
                                compare={"mode": "previous"}), CAT)
    assert P.summary(r, CAT, None, "days") == (
        "Net P&L for trading days this week, compared with the period before, all accounts.")
    assert P.summary(r, CAT, 5000, "days").endswith("all accounts. 5,000 days.")
    assert P.default_name(r, CAT) == "Net P&L, this week"

    t = P.validate_plan(minimal(range={"token": "last_50_trades"}, split={"by": "hour_et"}),
                        CAT)
    assert P.summary(t, CAT, 12, "trades") == (
        "Net P&L, split by ET hour, for closed trades in the last 50 trades, all accounts. "
        "12 trades.")


def test_plan_hash_is_canonical():
    a = P.validate_plan(full_plan(), CAT)
    b = json.loads(json.dumps(a))
    b = dict(reversed(list(b.items())))
    assert P.plan_hash(a) == P.plan_hash(b)
    assert len(P.plan_hash(a)) == 40
    c = copy.deepcopy(a)
    c["display"]["title"] = "Other"
    assert P.plan_hash(c) != P.plan_hash(a)


def test_plan_size_cap():
    ok = P.validate_plan(full_plan(), CAT)
    assert P.plan_size_ok(ok)
    big = copy.deepcopy(ok)
    big["display"]["subtitle"] = "z" * (17 * 1024)
    assert not P.plan_size_ok(big)
    with pytest.raises(P.PlanError) as ei:
        P.validate_plan(big, CAT)
    assert str(ei.value) == "This widget is too large to save."

    deep: object = "leaf"
    for _ in range(16):          # 16 nested lists inside the top-level dict = depth 17
        deep = [deep]
    d17 = minimal(filters=deep)
    assert not P.plan_size_ok(d17)
    with pytest.raises(P.PlanError) as ei:
        P.validate_plan(d17, CAT)
    assert str(ei.value) == "This widget is too large to save."

    d16: object = "leaf"
    for _ in range(15):
        d16 = [d16]
    assert P.plan_size_ok(minimal(filters=d16))  # the boundary itself is fine


def test_a_lone_surrogate_is_a_member_sentence_not_a_server_error():
    """Task 10.2 fix 1: JSON can carry a lone surrogate; it has no UTF-8 form, so the size
    check's encode (and every later one) would raise. It is refused with a sentence."""
    bad = full_plan()
    bad["display"]["title"] = "My " + chr(0xD800) + " setups"
    with pytest.raises(P.PlanError) as ei:
        P.plan_size_ok(bad)
    assert str(ei.value) == P.S_BAD_CHARACTER
    with pytest.raises(P.PlanError) as ei:
        P.validate_plan(bad, CAT)
    assert str(ei.value) == ("This widget has a character that can't be saved. "
                             "Remove it and try again.")
    # Control: a real astral character (a surrogate PAIR in JSON) is ordinary text.
    ok = full_plan()
    ok["display"]["title"] = "My " + chr(0x1F600) + " setups"
    assert P.plan_size_ok(ok)
    assert P.validate_plan(ok, CAT)["display"]["title"] == ok["display"]["title"]


# -- wave 9 (Task 9.8): routine and tracker history, refs and the plan version -------------------

RID = "0c005e04-610d-4565-89f2-5f1f76bb8fd6"
RID2 = "1d116f15-721e-4676-9a03-6a2a87cc9ae7"


def _real():
    from api.services.journal_two.widget_engine import sources
    return sources.CATALOG


def _days(**over):
    p = {"v": 1, "source": "trading_days", "measures": [{"key": "avg_day_pnl"}],
         "range": {"from": "2026-10-19", "to": "2026-10-23"}}
    p.update(over)
    return p


def test_needed_version_v1_for_wave8_plans_v2_for_tools():
    cat = _real()
    for raw in (full_plan(), minimal(), _days(split={"by": "weekday"})):
        assert P.needed_version(raw) == 1 and not P.uses_tools(raw)
    wave8 = minimal(range={"token": "last_30d"})
    before = json.dumps(wave8, sort_keys=True)
    valid = P.validate_plan(copy.deepcopy(wave8), cat)
    assert valid["v"] == 1 and json.dumps(wave8, sort_keys=True) == before
    # even a sender writing v2 on a plain plan gets the v1 it needs (byte-identical to wave 8)
    assert P.validate_plan(dict(copy.deepcopy(wave8), v=2), cat) == valid
    for raw in (minimal(source="routine_history", measures=[{"key": "routine_days_done"}]),
                minimal(source="tracker_history", measures=[{"key": "tracker_avg"}]),
                _days(split={"by": "routine_done", "ref": RID}),
                _days(filters=[{"field": "tracker_value", "op": "gte", "values": [1],
                                "ref": "checkin:mood"}])):
        assert P.needed_version(raw) == 2 and P.uses_tools(raw)
        assert P.validate_plan(raw, cat)["v"] == 2
    for odd in (None, [], "x", {"split": "x", "filters": "y"}):
        assert P.needed_version(odd) == 1 and not P.uses_tools(odd)


def test_ref_only_on_ref_fields_and_required_there():
    cat = _real()
    with pytest.raises(P.PlanError) as e:                       # required on a ref field
        P.validate_plan(_days(split={"by": "routine_done"}), cat)
    assert e.value.sentence == P.S_BAD_REF
    with pytest.raises(P.PlanError) as e:
        P.validate_plan(_days(filters=[{"field": "tracker_value", "op": "gte", "values": [1]}]),
                        cat)
    assert e.value.sentence == P.S_BAD_REF
    with pytest.raises(P.PlanError):                            # refused anywhere else
        P.validate_plan(_days(split={"by": "weekday", "ref": RID}), cat)
    with pytest.raises(P.PlanError):
        P.validate_plan(_days(filters=[{"field": "trade_count", "op": "gte", "values": [1],
                                        "ref": RID}]), cat)
    for bad in ("not-a-uuid", "checkin:mood", 7, "", RID.upper(), RID + "x"):
        with pytest.raises(P.PlanError) as e:                   # a routine ref is a uuid4
            P.validate_plan(_days(split={"by": "routine_done", "ref": bad}), cat)
        assert e.value.sentence == P.S_BAD_REF, bad
    for ok in (RID, "checkin:mood", "checkin:focus"):          # a tracker ref may be a built-in
        p = P.validate_plan(_days(split={"by": "tracker_bucket", "ref": ok}), cat)
        assert p["split"] == {"by": "tracker_bucket", "then": None, "ref": ok}
    p = P.validate_plan(_days(split={"by": "weekday", "then": "routine_done", "ref2": RID},
                              view={"type": "table"}), cat)
    assert p["split"]["ref2"] == RID and "ref" not in p["split"]


def test_one_ref_per_kind():
    cat = _real()
    with pytest.raises(P.PlanError) as e:
        P.validate_plan(_days(split={"by": "routine_done", "ref": RID},
                              filters=[{"field": "routine_done", "op": "in", "values": ["done"],
                                        "ref": RID2}]), cat)
    assert e.value.sentence == P.S_ONE_REF == "A widget can look at one routine and one tracker."
    # the same routine twice, and one routine with one tracker, are fine
    p = P.validate_plan(_days(split={"by": "routine_done", "ref": RID},
                              filters=[{"field": "routine_done", "op": "in", "values": ["done"],
                                        "ref": RID},
                                       {"field": "tracker_value", "op": "gte", "values": [6],
                                        "ref": RID2}]), cat)
    assert P.plan_refs(p, cat.sources["trading_days"].fields) == {"routine": RID, "tracker": RID2}


def test_tool_source_refuses_one_account_and_last_n_trades():
    cat = _real()
    for src, m in (("routine_history", "routine_consistency"), ("tracker_history", "tracker_avg")):
        with pytest.raises(P.PlanError) as e:
            P.validate_plan(minimal(source=src, measures=[{"key": m}], accounts={"id": "a-1"}), cat)
        assert e.value.sentence == P.S_TOOL_ACCOUNTS == "Routines and trackers cover all your accounts."
        for tok in ("last_20_trades", "last_50_trades", "last_100_trades"):
            with pytest.raises(P.PlanError) as e:
                P.validate_plan(minimal(source=src, measures=[{"key": m}], range={"token": tok}),
                                cat)
            assert e.value.sentence == P.S_UNKNOWN_RANGE
        assert P.validate_plan(minimal(source=src, measures=[{"key": m}],
                                       range={"token": "last_30d"}), cat)["accounts"] == "all"
        with pytest.raises(P.PlanError) as e:                   # a closed-trades measure
            P.validate_plan(minimal(source=src), cat)
        assert e.value.sentence == P.S_MEASURE_WRONG_DATA


def test_v2_plan_too_new_for_a_v1_server(monkeypatch):
    cat = _real()
    v2 = P.validate_plan(minimal(source="routine_history",
                                 measures=[{"key": "routine_days_done"}]), cat)
    assert v2["v"] == 2
    monkeypatch.setattr(P, "PLAN_VERSION", 1)                    # a server still on wave 8
    with pytest.raises(P.PlanTooNew) as e:
        P.validate_plan(copy.deepcopy(v2), cat)
    assert e.value.sentence == P.S_TOO_NEW
    assert P.validate_plan(minimal(range={"token": "last_30d"}), cat)["v"] == 1   # v1 still runs


def test_wave9_member_copy_avoids_internal_words():
    for text in (P.S_ONE_REF, P.S_TOOL_ACCOUNTS, P.S_BAD_REF, P.S_NOT_A_FILTER):
        for w in ("plan", "source", "scope", "definition", "ref"):
            assert w not in text.lower().split(), (text, w)
