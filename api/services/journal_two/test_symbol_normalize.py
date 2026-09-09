"""Shared symbol-spelling canonicalization (Identity Normalization Hardening V1).

symbol_normalize.normalize_symbol is the single implementation reused by
manual AddPosition/AddTrade, CSV import, and SnapTrade broker sync
(broker/snaptrade_adapter.py now imports it rather than defining its own)."""
from api.services.journal_two.symbol_normalize import normalize_symbol


def test_uppercases_and_trims():
    assert normalize_symbol("  nvda  ") == "NVDA"


def test_class_share_dot_becomes_hyphen():
    assert normalize_symbol("BRK.B") == "BRK-B"
    assert normalize_symbol("bf.b") == "BF-B"


def test_already_hyphenated_class_share_passes_through_unchanged():
    assert normalize_symbol("BRK-B") == "BRK-B"


def test_none_returns_none():
    assert normalize_symbol(None) is None


def test_blank_string_returns_none():
    assert normalize_symbol("   ") is None


def test_arbitrary_nonexistent_ticker_passes_through():
    """Spelling normalization only -- never an existence check."""
    assert normalize_symbol("notarealtickerxyz") == "NOTAREALTICKERXYZ"


def test_dot_only_matches_a_single_trailing_letter_suffix():
    """The transform is narrowly scoped to the one class-share shape
    (LETTERS.LETTER at the end) -- it must not mangle an unrelated dot,
    e.g. in a multi-part symbol some provider might send."""
    assert normalize_symbol("BRK.BB") == "BRK.BB"  # not a single-letter suffix
    assert normalize_symbol("A.B.C") == "A.B-C"  # only the trailing .LETTER converts


def test_snaptrade_adapter_reuses_the_shared_implementation():
    """Locked invariant: broker/snaptrade_adapter.py must import this
    function rather than define its own -- a second local definition would
    silently shadow this one (the exact bug class documented in this repo's
    CLAUDE.md for api/live_massive_router.py's duplicate _parse_mdy)."""
    from api.services.journal_two.broker import snaptrade_adapter
    assert snaptrade_adapter.normalize_symbol is normalize_symbol
