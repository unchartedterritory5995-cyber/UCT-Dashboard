"""INSTANT EVERY SYMBOL — the prewarmer's reference-universe partition.

`_partition_reference_universe` splits Massive's stock-market reference feed into
(etfs, instant_syms). ETFs are ALWAYS collected (unconditional D/W/M ETF warm);
`instant_syms` (the full stock+ETF universe for the shallow D/W/M "instant every
symbol" warm) is EMPTY unless the flag is on — the feature must be fully dark by
default. Indices (`I:`-prefixed) are excluded from both.
"""
from api.services.bars_prewarm import _partition_reference_universe


# A representative slice of the reference feed: common stock, an ADR, an ETF, an
# ETN, a leveraged ETF, an index row (I:-prefixed), a blank, and a lowercase.
_ROWS = [
    {"ticker": "AAPL", "type": "CS"},      # STOCK
    {"ticker": "BABA", "type": "ADRC"},    # STOCK (ADR)
    {"ticker": "SPY", "type": "ETF"},      # ETF
    {"ticker": "TQQQ", "type": "ETF"},     # ETF (leveraged — the cap_universe gap)
    {"ticker": "AMDL", "type": "ETN"},     # ETF-class (ETN)
    {"ticker": "I:SPX", "type": ""},       # index — excluded
    {"ticker": "", "type": "CS"},          # blank — excluded
    {"ticker": "brk.b", "type": "CS"},     # STOCK, lowercased
]


def test_flag_off_stages_no_instant_universe_but_still_collects_etfs():
    etfs, instant = _partition_reference_universe(_ROWS, instant_enabled=False)
    assert instant == set(), "instant-universe must be dark when the flag is off"
    # ETF warm is unconditional and unaffected by the flag.
    assert etfs == {"SPY", "TQQQ", "AMDL"}


def test_flag_on_stages_full_stock_and_etf_universe():
    etfs, instant = _partition_reference_universe(_ROWS, instant_enabled=True)
    # Every chartable stock + ETF, upper-cased, indices/blanks dropped.
    assert instant == {"AAPL", "BABA", "SPY", "TQQQ", "AMDL", "BRK.B"}
    assert "I:SPX" not in instant and "" not in instant
    # ETFs are a subset of the instant set (they're stock-market symbols too).
    assert etfs <= instant


def test_indices_are_never_warmed_by_this_feed():
    rows = [{"ticker": "I:NDX", "type": ""}, {"ticker": "I:VIX", "type": ""}]
    etfs, instant = _partition_reference_universe(rows, instant_enabled=True)
    assert etfs == set() and instant == set()


def test_empty_feed_is_safe():
    assert _partition_reference_universe([], instant_enabled=True) == (set(), set())
