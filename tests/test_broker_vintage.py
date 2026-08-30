"""A composed net-liq must say WHICH MOMENT its parts came from.

Every broker defect this month was one defect wearing different clothes:
a number carrying no vintage, silently blended with a number from another
moment.

  2026-08-26  cash 20h stale paired with live positions      → $21,763 hero
  2026-08-29  hero on our vendor's closes, broker on its own → $19.96 gap
  2026-08-29  Today measured from our prev close against a
              broker mark                                    → −61.06 vs −23.29
  2026-08-29  snapshots filed under the sync day             → Friday's close on Saturday

Each was found the same way — the owner looked at a screen and said "that's
wrong." Nothing in the system could say "these components disagree about what
time it is," because a component had no time.

So `compose_net_liq` now reports the vintage of what it composed. It does not
refuse to mix — mixing is often correct (a just-filled row has only a live
price; a quiet symbol has only a broker mark). It makes the mix VISIBLE, which
is the thing that was missing.

⛔ Computed in BOTH modes, not only under broker marks. Intraday, a row falling
back to `brokerPrice` while its neighbours are live is exactly the same silent
blend — it just never had a name.

MULTI-BROKER: this derives vintage from each account's OWN data, so a broker
nobody has integrated yet is described correctly without a table entry. The
Schwab-shaped cases below exist because 7 of 11 live accounts are Schwab while
every defect this month was found on the single Robinhood one.
"""

from __future__ import annotations

from api.services.journal_two.broker import composition


ACCT = {"balanceSource": "broker", "brokerCash": 1000.0,
        "brokerBalanceSyncedAt": "2026-08-29T07:40:30+00:00"}


def _eq(sym, shares, *, broker=None, session=None, source="broker"):
    p = {"symbol": sym, "side": "Long", "shares": shares, "source": source}
    if broker is not None:
        p["brokerPrice"] = broker
    if session is not None:
        p["brokerPriceSession"] = session
    return p


class TestBasis:
    def test_all_live_reports_a_live_basis(self):
        out = composition.compose_net_liq(
            ACCT, [_eq("A", 10, broker=9, session="2026-08-28")],
            [], {"A": {"price": 10}})
        v = out["vintage"]
        assert v["basis"] == "live"
        assert v["components"] == {"live": 1, "broker": 0, "cost": 0}

    def test_all_broker_reports_the_session_they_share(self):
        out = composition.compose_net_liq(
            ACCT,
            [_eq("A", 10, broker=9, session="2026-08-28"),
             _eq("B", 5, broker=20, session="2026-08-28")],
            [], {"A": {"price": 10}, "B": {"price": 21}}, prefer_broker=True)
        v = out["vintage"]
        assert v["basis"] == "broker"
        assert v["session"] == "2026-08-28"
        assert v["conflicts"] == []

    def test_a_silent_intraday_blend_is_now_NAMED(self):
        # The shape nobody could see: one row falls back to its broker mark
        # because the feed has no tick for it, while its neighbours are live.
        # Perfectly reasonable, and previously invisible.
        out = composition.compose_net_liq(
            ACCT,
            [_eq("LIQUID", 10, broker=9, session="2026-08-28"),
             _eq("THIN", 5, broker=20, session="2026-08-28")],
            [], {"LIQUID": {"price": 10}})     # no tick for THIN
        v = out["vintage"]
        assert v["basis"] == "mixed"
        assert v["components"] == {"live": 1, "broker": 1, "cost": 0}


class TestConflicts:
    def test_broker_marks_from_two_different_sessions_are_reported(self):
        # A position that stopped syncing keeps an older mark. Blending it with
        # a current one is exactly the 2026-08-26 class, one level down.
        out = composition.compose_net_liq(
            ACCT,
            [_eq("FRESH", 10, broker=9, session="2026-08-28"),
             _eq("STALE", 5, broker=20, session="2026-08-21")],
            [], {}, prefer_broker=True)
        v = out["vintage"]
        assert v["basis"] == "broker"
        assert v["session"] is None, "no single session — the parts disagree"
        assert v["conflicts"] == [{"symbol": "STALE", "session": "2026-08-21"}]

    def test_a_broker_mark_with_no_session_is_reported_as_unknown(self):
        # Rows written before the session stamp existed, and any broker whose
        # marks we have not yet learned to date.
        out = composition.compose_net_liq(
            ACCT, [_eq("A", 10, broker=9)], [], {}, prefer_broker=True)
        v = out["vintage"]
        assert v["session"] is None
        assert v["conflicts"] == [{"symbol": "A", "session": None}]

    def test_conflicts_are_named_never_counted(self):
        out = composition.compose_net_liq(
            ACCT,
            [_eq("A", 1, broker=1, session="2026-08-28"),
             _eq("B", 1, broker=1, session="2026-08-01"),
             _eq("C", 1, broker=1, session="2026-08-02")],
            [], {}, prefer_broker=True)
        syms = {c["symbol"] for c in out["vintage"]["conflicts"]}
        assert syms == {"B", "C"}, "a count would not tell you WHICH to go look at"


class TestOptions:
    def test_a_strategy_valued_at_COST_is_its_own_basis(self):
        # A just-filled contract with no mark yet shows at netEntry. That is
        # neither a live mark nor a broker mark and must not masquerade as one.
        out = composition.compose_net_liq(
            {"balanceSource": "broker", "brokerCash": 0.0}, [],
            [{"id": "s1", "netEntry": 610.0, "source": "broker"}], {}, {})
        assert out["vintage"]["components"] == {"live": 0, "broker": 0, "cost": 1}
        assert out["vintage"]["basis"] == "cost"


class TestSchwabShaped:
    """7 of 11 live accounts are Schwab; every defect this month was Robinhood's."""

    def test_date_only_stamps_do_not_break_the_vintage_read(self):
        # Schwab stamps at midnight UTC. The session on the row is what matters,
        # and it is derived upstream — the composition must simply report it.
        acct = {**ACCT, "brokerBalanceSyncedAt": "2026-08-29T00:00:00+00:00"}
        out = composition.compose_net_liq(
            acct, [_eq("A", 10, broker=9, session="2026-08-28")], [], {},
            prefer_broker=True)
        assert out["vintage"]["session"] == "2026-08-28"
        assert out["vintage"]["basis"] == "broker"

    def test_a_manual_row_inside_a_broker_account_never_reaches_the_vintage(self):
        # Mirror purity: manual rows are excluded from the hero, so they must
        # not be able to invent a conflict either.
        out = composition.compose_net_liq(
            ACCT,
            [_eq("A", 10, broker=9, session="2026-08-28"),
             _eq("MANUAL", 99, broker=1, session="2020-01-01", source=None)],
            [], {}, prefer_broker=True)
        assert out["vintage"]["conflicts"] == []
        assert out["vintage"]["components"]["broker"] == 1


class TestItDoesNotChangeTheNumbers:
    def test_market_value_and_net_liq_are_untouched(self):
        args = (ACCT, [_eq("A", 10, broker=9, session="2026-08-28")], [],
                {"A": {"price": 10}})
        out = composition.compose_net_liq(*args)
        assert out["marketValue"] == 100.0
        assert out["netLiq"] == 1100.0

    def test_an_empty_book_reports_an_honest_empty_vintage(self):
        out = composition.compose_net_liq(ACCT, [], [], {})
        v = out["vintage"]
        assert v["basis"] is None and v["session"] is None
        assert v["components"] == {"live": 0, "broker": 0, "cost": 0}
