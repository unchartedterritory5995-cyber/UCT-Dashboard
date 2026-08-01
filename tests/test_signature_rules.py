from api.services.signature.rules import parse_money, VERSIONS


def test_parse_money_plain_and_suffixed():
    assert parse_money("1500000") == 1_500_000.0
    assert parse_money("$1.5M") == 1_500_000.0
    assert parse_money("250K") == 250_000.0
    assert parse_money("1,500,000") == 1_500_000.0


def test_parse_money_garbage_is_zero():
    assert parse_money(None) == 0.0
    assert parse_money("") == 0.0
    assert parse_money("N/A") == 0.0


def test_versions_are_pinned_strings():
    assert VERSIONS["fcb"] == "fcb-v1"
