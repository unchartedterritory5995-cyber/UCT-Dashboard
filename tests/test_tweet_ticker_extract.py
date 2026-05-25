from api.services.tweet_ticker_extract import extract_tickers


def test_extracts_single_cashtag():
    assert extract_tickers("$AAPL just hit a new high") == {"AAPL"}


def test_extracts_multiple_cashtags():
    assert extract_tickers("$AAPL and $MSFT both up") == {"AAPL", "MSFT"}


def test_case_insensitive_input_normalizes_to_upper():
    assert extract_tickers("$aapl beats") == {"AAPL"}


def test_excludes_forex():
    assert extract_tickers("$USD weak, $EUR strong, $AAPL up") == {"AAPL"}


def test_keeps_crypto():
    assert extract_tickers("$BTC $ETH $SOL all green") == {"BTC", "ETH", "SOL"}


def test_ignores_dollar_amounts():
    assert extract_tickers("Earnings beat by $5 vs $0.10 est") == set()


def test_ignores_long_strings():
    # Tickers cap at 5 chars in our regex; 6+ chars don't match
    assert extract_tickers("$ABCDEF some text") == set()


def test_ignores_plain_text():
    assert extract_tickers("Apple just hit a new high (no cashtag)") == set()


def test_empty_string():
    assert extract_tickers("") == set()


def test_none_input_safe():
    assert extract_tickers(None) == set()


def test_cashtag_with_punctuation_after():
    assert extract_tickers("Big day for $AAPL, $TSLA, and $NVDA!") == {"AAPL", "TSLA", "NVDA"}
