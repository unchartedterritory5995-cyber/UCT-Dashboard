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
