"""Unit tests for bar_rollup."""
import pytest

from api.services.bar_rollup import (
    bucket_start, aggregate, TF_TO_SECONDS,
)


def test_bucket_start_5min_aligns_to_minute_boundary():
    # 14:32:17 ET (epoch ms) → bucket starts 14:30:00
    # 2026-05-05 14:32:17 ET == 2026-05-05 18:32:17 UTC == 1778005937000 ms
    ts_ms = 1778005937000
    expected = 1778005800000  # 14:30:00 ET = 18:30:00 UTC
    assert bucket_start(ts_ms, "5") == expected


def test_bucket_start_15min_aligns():
    # 14:32:17 ET → bucket starts 14:30:00 (15-min)
    assert bucket_start(1778005937000, "15") == 1778005800000


def test_bucket_start_30min_aligns():
    # 14:32:17 ET → bucket starts 14:30:00 (30-min)
    assert bucket_start(1778005937000, "30") == 1778005800000


def test_bucket_start_60min_not_supported_in_v1():
    # 60-min uses ET-anchored buckets per existing _session_resample_hourly;
    # UTC rounding would mismatch. Defer to v1.1.
    with pytest.raises(ValueError):
        bucket_start(1778005937000, "60")


def test_bucket_start_unknown_tf_raises():
    with pytest.raises(ValueError):
        bucket_start(1778005937000, "D")


def test_aggregate_first_bar_produces_partial_bucket():
    bar = {"t": 1778005800000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    out = aggregate(None, bar)
    assert out == {"t": 1778005800000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}


def test_aggregate_extends_high_low_and_sums_volume():
    prev = {"t": 1778005800000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bar  = {"t": 1778005860000, "o": 100.5, "h": 102.0, "l": 100.2, "c": 101.8, "v": 750}
    out = aggregate(prev, bar)
    assert out["o"] == 100.0   # open from first bar of bucket
    assert out["h"] == 102.0   # extended high
    assert out["l"] == 99.5    # unchanged low
    assert out["c"] == 101.8   # close from latest bar
    assert out["v"] == 1750    # summed volume
    assert out["t"] == 1778005800000  # bucket start unchanged


def test_aggregate_does_not_lower_existing_low():
    prev = {"t": 1778005800000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bar  = {"t": 1778005860000, "o": 100.5, "h": 100.7, "l": 100.4, "c": 100.6, "v": 500}
    out = aggregate(prev, bar)
    assert out["l"] == 99.5  # not raised — keeps prev low even though new bar's low is higher
