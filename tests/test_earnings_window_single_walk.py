"""One earnings-window walk, two consumers, provably the same result (Seam 4).

`awareness/engine.py::_collect_earnings_window` and
`watchlist_intelligence.py::_earnings_facts` each carried their own copy of the
same loop: walk the next N calendar days via calendar_alerts' per-date reporter
lookup, keep the earliest date per symbol. The duplication was deliberate at the
time -- the watchlist side declined to import the engine's private, memoized
version -- but the copies had already diverged: only one was memoized, and the
window length was declared twice as separate literals.

⛔ THE OWNER'S CONDITION FOR SHIPPING THIS: memoizing one consumer is a
PERFORMANCE change, not a behaviour change, only if the outputs are identical.
`test_both_consumers_agree_across_the_window` is that proof. If it ever fails,
the unification became a behaviour change and must go back to scope-only.
"""
import datetime

import pytest


@pytest.fixture
def fake_calendar(monkeypatch):
    """A deterministic reporter calendar, plus a call counter.

    Deliberately includes a symbol reporting on TWO days so "earliest wins" is
    actually exercised -- with one date per symbol the rule is unfalsifiable.
    """
    today = datetime.date.today()
    day = lambda n: (today + datetime.timedelta(days=n)).isoformat()  # noqa: E731
    table = {
        day(0): ({"AAA", "BBB"}, True),
        day(1): ({"CCC", "AAA"}, True),          # AAA repeats -> day(0) must win
        day(2): ({"DDD"}, True),
        day(3): ({"EEE"}, True),
    }
    calls = []

    from api.services import calendar_alerts as ca

    def _lookup(d_str):
        calls.append(d_str)
        return table.get(d_str, (set(), True))

    monkeypatch.setattr(ca, "_get_reporters_for_date_with_status", _lookup)
    return {"today": today, "day": day, "table": table, "calls": calls}


def test_the_shared_walk_keeps_the_earliest_date(fake_calendar):
    from api.services.calendar_alerts import collect_earnings_window

    out, failed = collect_earnings_window(fake_calendar["today"], 3)
    assert failed is False
    assert out["AAA"] == fake_calendar["day"](0), "a later repeat overwrote the earliest"
    assert out["CCC"] == fake_calendar["day"](1)
    assert out["EEE"] == fake_calendar["day"](3)


def test_both_consumers_agree_across_the_window(fake_calendar, monkeypatch):
    """THE OWNER'S CONDITION. Same inputs, same symbol -> date mapping, from
    both call paths. The watchlist side wraps the walk in a symbol filter and
    fact-building; the awareness side wraps it in memoization. Neither wrapper
    may change WHICH symbol maps to WHICH date."""
    from api.services.awareness import engine as aw
    from api.services import watchlist_intelligence as wi

    # awareness: clear its memo so this is a real walk, not a cached answer
    aw._EARNINGS_MEMO.clear()
    aw_out = aw._collect_earnings_window(fake_calendar["today"], 3)

    symbols = sorted({s for syms, _ in fake_calendar["table"].values() for s in syms})
    wi_facts, _ = wi._earnings_facts(symbols)

    wi_dates = {sym: fact["as_of"] for sym, fact in wi_facts.items()}
    aw_dates = {sym: d for sym, d in aw_out.items() if sym in set(symbols)}

    assert wi_dates == aw_dates, (
        "the two consumers disagree about when a symbol reports -- the "
        "unification changed behaviour and must revert to scope-only"
    )


def test_the_watchlist_filters_to_requested_symbols_only(fake_calendar):
    """The consumer-specific half that must NOT be shared."""
    from api.services import watchlist_intelligence as wi

    facts, _ = wi._earnings_facts(["AAA"])
    assert set(facts) == {"AAA"}


def test_a_failed_day_propagates_to_both(monkeypatch):
    """`any_failed` is what makes a total source outage distinguishable from a
    quiet week. It must survive the extraction."""
    from api.services import calendar_alerts as ca
    from api.services import watchlist_intelligence as wi

    monkeypatch.setattr(ca, "_get_reporters_for_date_with_status",
                        lambda d: (set(), False))
    out, failed = ca.collect_earnings_window(datetime.date.today(), 2)
    assert out == {} and failed is True

    _, wi_failed = wi._earnings_facts(["AAA"])
    assert wi_failed is True


def test_a_raising_lookup_is_caught_and_flagged(monkeypatch):
    from api.services import calendar_alerts as ca

    def _boom(d):
        raise RuntimeError("provider down")

    monkeypatch.setattr(ca, "_get_reporters_for_date_with_status", _boom)
    out, failed = ca.collect_earnings_window(datetime.date.today(), 2)
    assert out == {} and failed is True


def test_the_window_length_has_one_declaration():
    """Both sides read the same constant rather than two literals that happen
    to agree."""
    from api.services import calendar_alerts as ca
    from api.services import watchlist_intelligence as wi
    from api.services.awareness import rules as aw_rules

    assert wi._earnings_proximity_days() == ca.EARNINGS_PROXIMITY_DEFAULT_DAYS
    assert aw_rules.EARNINGS_PROXIMITY_DEFAULT_DAYS == ca.EARNINGS_PROXIMITY_DEFAULT_DAYS


def test_the_walk_is_called_once_per_day_not_per_symbol(fake_calendar):
    """The whole point of the shared lookup: one call per day in the window,
    never per ticker. A per-symbol walk would multiply provider load by the
    watchlist size."""
    from api.services import watchlist_intelligence as wi

    fake_calendar["calls"].clear()
    wi._earnings_facts(["AAA", "BBB", "CCC", "DDD", "EEE"])
    assert len(fake_calendar["calls"]) == 4, fake_calendar["calls"]
