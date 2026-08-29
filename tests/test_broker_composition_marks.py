"""Closed-session mark preference — the hero mirrors the broker when the tape is shut.

2026-08-29 (Saturday, market closed): the owner's Robinhood app read $9,728.40
while the journal hero read $9,708.44. The sync was not at fault — that morning's
mirror check drifted $0.02 against SnapTrade's reported total. The gap was created
AFTER the sync, by the composition: it discards the broker's own marks and re-values
every row with our market-data vendor's closes. Two vendors never agree to the penny,
and a 1.5c disagreement on SNAP's close is $30 on a 2,000-share position.

Intraday that trade is correct (the broker's holdings sync runs once, pre-dawn, so
its marks are the PREVIOUS close and would hide the whole day's move). Once the
session is fully closed it inverts: the book is static, the broker's marks are what
the member's broker app is showing, and re-marking buys nothing but a difference.

The preference must therefore be gated on BOTH conditions — closed session AND a
balance sync that landed after that session's close. Mirroring marks that predate
the session would show a day-stale account, which is far worse than a $20 gap.
"""

from __future__ import annotations

from api.services.journal_two.broker import composition


# The 2026-08-29 book, with both vendors' marks, as measured in prod.
ACCOUNT = {
    "balanceSource": "broker",
    "brokerCash": -22165.75,
    "brokerBalanceSyncedAt": "2026-08-29T07:40:30.192050+00:00",
}
POSITIONS = [
    {"symbol": "DELL", "side": "Long", "shares": 5.0, "brokerPrice": 456.07, "source": "broker"},
    {"symbol": "ORCL", "side": "Long", "shares": 100.0, "brokerPrice": 150.72, "source": "broker"},
    {"symbol": "SNAP", "side": "Long", "shares": 2000.0, "brokerPrice": 5.445, "source": "broker"},
    {"symbol": "SPY", "side": "Long", "shares": 0.2606, "brokerPrice": 769.39, "source": "broker"},
    {"symbol": "TH", "side": "Long", "shares": 150.0, "brokerPrice": 18.56, "source": "broker"},
]
STRATEGIES = [
    {"id": "s1", "brokerCurrentValue": 675.0, "netEntry": 610.0, "source": "broker"},
]
# Our vendor's Friday closes — every one differs from the broker's mark.
PRICES = {
    "DELL": {"price": 456.24}, "ORCL": {"price": 150.85}, "SNAP": {"price": 5.43},
    "SPY": {"price": 769.35}, "TH": {"price": 18.55},
}
MARKS = {"s1": {"currentValue": 665.0}}

LAST_CLOSE = "2026-08-28"  # Friday's session


class TestPreferBrokerMarks:
    def test_closed_session_with_a_sync_after_the_close_prefers_the_broker(self):
        assert composition.prefer_broker_marks(ACCOUNT, True, LAST_CLOSE) is True

    def test_open_session_never_prefers_the_broker(self):
        # Intraday the stored marks are the PREVIOUS close — mirroring them
        # would hide the whole day's move.
        assert composition.prefer_broker_marks(ACCOUNT, False, LAST_CLOSE) is False

    def test_sync_predating_the_last_close_is_refused(self):
        # Friday 03:40 ET, before Friday's 16:00 close: the marks are THURSDAY's.
        # A weekday evening must keep the live feed or the hero goes a day stale.
        stale = {**ACCOUNT, "brokerBalanceSyncedAt": "2026-08-28T07:40:30+00:00"}
        assert composition.prefer_broker_marks(stale, True, LAST_CLOSE) is False

    def test_sync_at_the_close_minute_counts(self):
        # 16:00 ET exactly on the session's own date == covers it.
        at_close = {**ACCOUNT, "brokerBalanceSyncedAt": "2026-08-28T20:00:00+00:00"}
        assert composition.prefer_broker_marks(at_close, True, LAST_CLOSE) is True

    def test_sync_one_minute_before_the_close_does_not(self):
        before = {**ACCOUNT, "brokerBalanceSyncedAt": "2026-08-28T19:59:00+00:00"}
        assert composition.prefer_broker_marks(before, True, LAST_CLOSE) is False

    def test_missing_or_unparseable_watermark_refuses(self):
        assert composition.prefer_broker_marks({}, True, LAST_CLOSE) is False
        assert composition.prefer_broker_marks(
            {"brokerBalanceSyncedAt": "not-a-date"}, True, LAST_CLOSE) is False
        assert composition.prefer_broker_marks(ACCOUNT, True, None) is False
        assert composition.prefer_broker_marks(None, True, LAST_CLOSE) is False


class TestComposeWithBrokerMarks:
    def test_live_marks_reproduce_the_reported_hero(self):
        # What the owner saw: $9,708.44.
        got = composition.compose_net_liq(ACCOUNT, POSITIONS, STRATEGIES, PRICES, MARKS)
        assert got["netLiq"] == 9708.44

    def test_broker_marks_close_the_gap(self):
        # Equities at the broker's marks; the option keeps its LIVE mark — that
        # is a prior measured ruling (option_marks.py exists because the
        # sync-time brokerCurrentValue lags), not something this change revisits.
        got = composition.compose_net_liq(
            ACCOUNT, POSITIONS, STRATEGIES, PRICES, MARKS, prefer_broker=True)
        # 31,226.85 of equity at broker marks + 665.00 live option mark.
        assert got["marketValue"] == 31891.85
        assert got["netLiq"] == 9726.10

    def test_broker_marks_move_the_hero_toward_the_broker(self):
        live = composition.compose_net_liq(ACCOUNT, POSITIONS, STRATEGIES, PRICES, MARKS)
        broker = composition.compose_net_liq(
            ACCOUNT, POSITIONS, STRATEGIES, PRICES, MARKS, prefer_broker=True)
        rh_app_regular = 9726.12  # RH's $9,728.40 less its $2.28 after-hours line
        assert abs(broker["netLiq"] - rh_app_regular) < abs(live["netLiq"] - rh_app_regular)

    def test_preference_is_a_preference_not_a_restriction(self):
        # A provisional row from an intraday fill has no broker mark yet. Under
        # prefer_broker it must still fall back to the live price — dropping it
        # would debit cash for a position that vanished from market value (the
        # 2026-08-26 incident class).
        prov = POSITIONS + [
            {"symbol": "NEW", "side": "Long", "shares": 10.0, "source": "broker",
             "brokerPrice": None, "provisional": True},
        ]
        got = composition.compose_net_liq(
            ACCOUNT, prov, STRATEGIES, {**PRICES, "NEW": {"price": 4.0}},
            MARKS, prefer_broker=True)
        assert got["marketValue"] == 31931.85  # +40.00 of live-priced provisional

    def test_no_price_at_all_still_skips_the_row(self):
        got = composition.compose_net_liq(
            {"balanceSource": "broker", "brokerCash": 0.0},
            [{"symbol": "X", "side": "Long", "shares": 1.0, "source": "broker"}],
            [], {}, {}, prefer_broker=True)
        assert got["marketValue"] == 0.0

    def test_shorts_still_contribute_negatively_under_broker_marks(self):
        got = composition.compose_net_liq(
            {"balanceSource": "broker", "brokerCash": 0.0},
            [{"symbol": "X", "side": "Short", "shares": 10.0, "brokerPrice": 7.0,
              "source": "broker"}],
            [], {"X": {"price": 9.0}}, {}, prefer_broker=True)
        assert got["marketValue"] == -70.0
