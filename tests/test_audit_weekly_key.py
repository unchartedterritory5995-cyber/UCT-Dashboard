"""Weekly audit key alignment — the silent-no-op bug.

The canonical side normalizes weekly bars to the ISO FRIDAY; the cache side
used to re-key to ISO MONDAY. The two never lined up, so every Weekly audit
silently reported bars_compared:0 — and a continuous reconciler run on 'W'
would have seen all bars as diverged and could DELETE correct rows. This test
is the prerequisite guard before Weekly can join the reconciler: it asserts a
Friday-keyed cache vs Friday-normalized canonical actually COMPARES bars.
"""
from unittest.mock import patch

import datetime

from api.services import audit


def _friday(y, m, d):
    dt = datetime.date(y, m, d)
    assert dt.weekday() == 4, f"{dt} is not a Friday"
    return int(dt.strftime("%Y%m%d"))


def test_weekly_audit_compares_friday_keyed_cache_against_canonical():
    # Three real Fridays; identical OHLC on both sides → should compare cleanly.
    fridays = [_friday(2026, 6, 19), _friday(2026, 6, 26), _friday(2026, 7, 3)]
    cache_rows = [(fk, 10.0, 11.0, 9.5, 10.5, 1000) for fk in fridays]
    canonical = [
        {"t": fk, "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 1000}
        for fk in fridays
    ]

    with patch.object(audit, "fetch_canonical_bars", return_value=(canonical, None)), \
         patch("api.services.bars_sqlite.get_bars", return_value=cache_rows):
        result = audit.audit_ticker("MSTR", "W", bars=200)

    # The regression: before the Friday-key fix this was 0 (Monday vs Friday
    # keys never intersect). It must now compare every week.
    assert result.bars_compared == 3, (
        f"expected 3 weeks compared, got {result.bars_compared} "
        f"(only_in_cache={result.bars_only_in_cache}, "
        f"only_in_canonical={result.bars_only_in_canonical})"
    )
    assert result.fail_count == 0
    assert not result.bars_only_in_cache
    assert not result.bars_only_in_canonical


def test_weekly_audit_still_flags_a_genuinely_diverged_bar():
    # A real value divergence on one week must still be caught (the fix aligns
    # keys; it must NOT mask actual data drift).
    fridays = [_friday(2026, 6, 19), _friday(2026, 6, 26)]
    cache_rows = [
        (fridays[0], 10.0, 11.0, 9.5, 10.5, 1000),
        (fridays[1], 10.0, 11.0, 9.5, 99.0, 1000),  # close diverges badly
    ]
    canonical = [
        {"t": fridays[0], "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 1000},
        {"t": fridays[1], "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 1000},
    ]
    with patch.object(audit, "fetch_canonical_bars", return_value=(canonical, None)), \
         patch("api.services.bars_sqlite.get_bars", return_value=cache_rows):
        result = audit.audit_ticker("MSTR", "W", bars=200)

    assert result.bars_compared == 2
    assert result.fail_count >= 1  # the diverged close is caught
