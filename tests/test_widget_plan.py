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
            "setup": _Field("Setup"), "side": _Field("Side"),
            "ticker": _Field("Ticker"), "hour_et": _Field("ET hour")}),
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
     "There's no earlier period to compare with."),
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
    raw["v"] = 2
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
    assert P.PLAN_VERSION == 1


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
    out = P.validate_plan(minimal(filters=[{"field": "side", "op": "is", "values": ["long"]}],
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
    r = P.resolve_range({"token": "last_90d"}, SAT)
    prev = P.previous_range(r)
    assert prev.to_day == "2026-07-26" and prev.from_day == "2026-04-28"

    def span(x):
        return (date.fromisoformat(x.to_day) - date.fromisoformat(x.from_day)).days
    assert span(prev) == span(r) == 89
    wk = P.previous_range(P.resolve_range({"token": "this_week"}, SAT))
    assert (wk.from_day, wk.to_day) == ("2026-10-13", "2026-10-18")
    day = P.previous_range(P.resolve_range({"token": "today"}, SAT))
    assert (day.from_day, day.to_day) == ("2026-10-23", "2026-10-23")
    for tok in ("all", "last_20_trades"):
        with pytest.raises(P.PlanError) as ei:
            P.previous_range(P.resolve_range({"token": tok}, SAT))
        assert str(ei.value) == "There's no earlier period to compare with."


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
