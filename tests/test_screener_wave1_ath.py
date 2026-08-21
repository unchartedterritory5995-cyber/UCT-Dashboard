"""All-time-high fields (dist_ath_pct/new_ath) + the deep-read/400-tail split.

ath_fields reads the FULL bar series (bars.db's since-inception daily history),
never just the 400-bar tail every other technical is computed from — that
split is the point of this test file (spec Task 3).
"""
from api.services.screener import technicals


def bar(c, h=None, l=None):
    return {"o": c, "h": h if h is not None else c + 0.5,
            "l": l if l is not None else c - 0.5, "c": c, "v": 1000}


def test_ath_distance_reads_full_history_not_the_400_tail():
    old_peak = [bar(200.0, h=210.0)]                    # ancient ATH
    recent = [bar(100.0) for _ in range(500)]
    out = technicals.ath_fields(old_peak + recent)
    assert out["dist_ath_pct"] == round((100.0 - 210.0) / 210.0 * 100, 2)
    assert out["new_ath"] is False


def test_new_ath_flag():
    bars = [bar(100.0) for _ in range(50)] + [bar(120.0, h=125.0)]
    out = technicals.ath_fields(bars)
    assert out["new_ath"] is True
    assert out["dist_ath_pct"] == round((120.0 - 125.0) / 125.0 * 100, 2)


def test_ath_fields_empty_bars_is_not_computable():
    out = technicals.ath_fields([])
    assert out == {"dist_ath_pct": None, "new_ath": False}


def test_build_row_existing_columns_identical_under_deep_read():
    """The 400-slice keeps every pre-Wave-1 value byte-identical."""
    from api.services.screener import snapshot_builder
    # old history HIGHER than the recent tape, so the ATH lives outside the
    # 400-bar tail and the two ATH answers must differ
    deep = [bar(200.0) for _ in range(600)] + [bar(100.0) for _ in range(400)]
    row_deep = snapshot_builder.build_row("T", deep, None, None)
    row_400 = snapshot_builder.build_row("T", deep[-400:], None, None)
    for col in ("rsi14", "adr_pct", "atr_pct", "pct_vs_sma200",
                "dist_52w_high_pct", "chg_pct_1m"):
        assert row_deep[col] == row_400[col], col
    assert row_deep["dist_ath_pct"] != row_400["dist_ath_pct"]  # only ATH differs


def test_build_row_existing_columns_identical_under_deep_read_with_a_gap():
    """Same invariant, but with invalid bars INSIDE the raw last-400 window.

    The tail must be the RAW last 400 sessions sanitized ALONE — never
    sanitized-then-sliced, which would reach past session 400 into the older
    200-priced block to backfill each dropped bar and silently deepen every
    window-sensitive column's lookback for exactly this ticker.

    ⚠️ A SINGLE dropped bar cannot actually exercise this: every
    `compute_technicals` window is <=253 bars, so sanitize-then-slice's
    one-bar reach-back always lands at position 0 of the reconstructed
    400-array — outside every window <=253 taken from the array's end — and
    the two code paths would agree by construction regardless of the bug
    (verified empirically: a single gap bar produces byte-identical output
    under BOTH the pre-fix and the fixed `build_row`, i.e. that shape of
    fixture is vacuous here). This fixture instead drops 390 of the 400 raw
    tail bars (10 valid bars survive), which forces the pre-fix code's
    reach-back to pull 390 bars from the older 200-priced block — enough to
    reach every one of the six pinned windows. Confirmed against a throwaway
    simulation of the pre-fix `bars_full = usable_bars(bars); bars =
    bars_full[-400:]` ordering: all six columns diverge there (e.g.
    `dist_52w_high_pct` -50.12 vs -0.5, `chg_pct_1m` -50.0 vs `None`) and
    agree under the shipped fix.
    """
    from api.services.screener import snapshot_builder
    gap_bar = {"o": 100.0, "h": 100.5, "l": 99.5, "c": None, "v": 1000}
    tail = [gap_bar for _ in range(390)] + [bar(100.0) for _ in range(10)]
    deep = [bar(200.0) for _ in range(600)] + tail
    row_deep = snapshot_builder.build_row("T", deep, None, None)
    row_400 = snapshot_builder.build_row("T", deep[-400:], None, None)
    for col in ("rsi14", "adr_pct", "atr_pct", "pct_vs_sma200",
                "dist_52w_high_pct", "chg_pct_1m"):
        assert row_deep[col] == row_400[col], col
    assert row_deep["dist_ath_pct"] != row_400["dist_ath_pct"]  # only ATH differs
