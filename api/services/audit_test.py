"""Tests for api.services.audit.

The diff logic is the keystone of Phase 2C: every "is the chart correct?"
question routes through this. Tests cover:

  - Identical bars → no diffs, 100% pass rate
  - Sub-tolerance noise → no diffs (cent rounding doesn't trigger false
    positives that would otherwise drown real bugs in noise)
  - Above-tolerance differences → correct severity classification
  - Bars only in cache vs only in canonical → correctly enumerated
  - Empty inputs → graceful degradation
  - Per-field diff isolation → an outlier in `c` doesn't taint `o/h/l/v`
  - The to_dict shape stays JSON-serializable for the HTTP endpoint
"""
from api.services.audit import (
    AuditResult,
    BarDiff,
    diff_bars,
    _diff_field,
    _classify_price_severity,
    _classify_volume_severity,
    PRICE_ABS_TOLERANCE,
    VOLUME_ABS_TOLERANCE,
)


def _bar(t, o, h, l, c, v):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


# ── _classify_*_severity ─────────────────────────────────────────────────

class TestPriceSeverity:
    def test_zero_delta_is_ok(self):
        assert _classify_price_severity(0.0, 100.0) == "ok"

    def test_at_abs_tolerance_is_ok_for_low_priced(self):
        """On a $1 stock, abs tolerance dominates (0.01 > 0.05% of $1).
        A 1¢ diff stays within ok."""
        assert _classify_price_severity(PRICE_ABS_TOLERANCE, 1.0) == "ok"

    def test_just_above_relative_tolerance_is_warn(self):
        """For a $100 stock, 0.05% relative = $0.05 (dominates $0.01 abs).
        A diff just above $0.05 should be warn-severity."""
        assert _classify_price_severity(0.06, 100.0) == "warn"

    def test_far_above_tolerance_is_fail(self):
        """At 10× the threshold or more, severity escalates to fail.
        On a $100 stock threshold is $0.05, so $0.50+ is fail."""
        assert _classify_price_severity(0.60, 100.0) == "fail"

    def test_relative_tolerance_dominates_on_high_priced(self):
        """For a $5000 price, 0.05% relative = $2.50, which is well above
        the $0.01 absolute. Differences within the relative band must be ok."""
        assert _classify_price_severity(2.0, 5000.0) == "ok"  # 0.04% — under 0.05%
        assert _classify_price_severity(3.0, 5000.0) == "warn"  # 0.06% — over

    def test_absolute_tolerance_dominates_on_low_priced(self):
        """For a 50¢ stock, 0.05% relative = $0.00025 (negligible).
        Absolute $0.01 threshold dominates so we don't flag every cent
        rounding on penny stocks."""
        assert _classify_price_severity(0.005, 0.50) == "ok"   # half a cent
        assert _classify_price_severity(0.02, 0.50) == "warn"  # 2¢ on a 50¢ stock


class TestVolumeSeverity:
    def test_small_diff_under_abs_tolerance_is_ok(self):
        assert _classify_volume_severity(50.0, 1_000_000.0) == "ok"

    def test_pct_tolerance_for_low_volume_bars(self):
        """1% relative for a 50-share bar = 0.5 shares, but absolute floor
        is 100 shares — we use the larger threshold so low-volume bars
        don't flag on every single share difference."""
        assert _classify_volume_severity(50.0, 50.0) == "ok"

    def test_above_tolerance_is_warn_then_fail(self):
        assert _classify_volume_severity(VOLUME_ABS_TOLERANCE * 1.5, 100.0) == "warn"
        assert _classify_volume_severity(VOLUME_ABS_TOLERANCE * 20, 100.0) == "fail"


# ── _diff_field ──────────────────────────────────────────────────────────

class TestDiffField:
    def test_within_tolerance_returns_none(self):
        """Sub-tolerance diff = no signal = no BarDiff. Critical: bugs
        will be drowned in noise if every cent rounding triggers a diff."""
        assert _diff_field(123, "c", 67.50, 67.50) is None
        assert _diff_field(123, "c", 67.50, 67.495) is None  # rounding noise
        assert _diff_field(123, "v", 100_000, 100_050) is None  # 50 < 100 abs

    def test_price_diff_classified_correctly(self):
        """A 5-cent price gap is real — test it surfaces with correct
        severity and metadata."""
        d = _diff_field(123, "c", 67.50, 67.45)
        assert d is not None
        assert d.field_name == "c"
        assert d.cached == 67.50
        assert d.canonical == 67.45
        assert abs(d.delta - 0.05) < 1e-9
        assert d.severity in ("warn", "fail")  # exact severity depends on price magnitude

    def test_pct_delta_computed(self):
        d = _diff_field(123, "c", 100.10, 100.00)
        assert d is not None
        assert d.pct_delta is not None
        assert abs(d.pct_delta - 0.001) < 1e-6  # 0.1%

    def test_pct_delta_when_canonical_zero_uses_max_as_base(self):
        """When canonical = 0, base falls back to abs(cached). The pct_delta
        of (0.05 - 0) / 0.05 = 1.0 (100% relative) is meaningful and
        avoids division by zero. The diff is reported because it crosses
        the absolute threshold."""
        d = _diff_field(123, "c", 0.05, 0.0)
        assert d is not None
        assert d.pct_delta == 1.0  # 100% relative

    def test_both_zero_returns_no_diff(self):
        """Both values zero = no disagreement = no BarDiff at all."""
        assert _diff_field(123, "c", 0.0, 0.0) is None


# ── diff_bars ────────────────────────────────────────────────────────────

class TestDiffBars:
    def test_identical_bars_zero_diffs(self):
        bars = [_bar(1000, 67.5, 67.6, 67.4, 67.55, 100_000)]
        result = diff_bars(bars, bars, ticker="QQQ", tf="30")
        assert result.bars_compared == 1
        assert result.diffs == []
        assert result.pass_rate == 1.0

    def test_subtolerance_noise_no_false_positives(self):
        """The MOST IMPORTANT test: cent rounding between cache and
        canonical must NOT generate diff entries. If this fails, the
        audit is useless because real bugs hide in the noise."""
        cached = [_bar(1000, 67.50, 67.60, 67.40, 67.55, 100_000)]
        canonical = [_bar(1000, 67.499, 67.604, 67.395, 67.554, 100_050)]
        result = diff_bars(cached, canonical, ticker="QQQ", tf="30")
        assert result.diffs == []
        assert result.pass_rate == 1.0

    def test_real_price_bug_surfaces_as_fail(self):
        """A clear 50-cent price disagreement on a $67 stock = real bug."""
        cached = [_bar(1000, 67.50, 67.60, 67.40, 67.55, 100_000)]
        canonical = [_bar(1000, 67.50, 67.60, 67.40, 67.05, 100_000)]  # close differs by 50¢
        result = diff_bars(cached, canonical, ticker="QQQ", tf="30")
        c_diffs = [d for d in result.diffs if d.field_name == "c"]
        assert len(c_diffs) == 1
        assert c_diffs[0].severity == "fail"
        # Other fields are fine — diff isolation
        for fld in ("o", "h", "l", "v"):
            assert all(d.field_name != fld for d in result.diffs), (
                f"field {fld} got a spurious diff"
            )

    def test_bars_only_in_cache(self):
        """Cache has bars canonical doesn't (pre/post-market is the
        common case). Reported separately from field-diffs."""
        cached = [_bar(1000, 67.5, 67.5, 67.5, 67.5, 1), _bar(2000, 68, 68, 68, 68, 1)]
        canonical = [_bar(2000, 68, 68, 68, 68, 1)]
        result = diff_bars(cached, canonical, ticker="QQQ", tf="30")
        assert result.bars_only_in_cache == [1000]
        assert result.bars_only_in_canonical == []
        assert result.bars_compared == 1

    def test_bars_only_in_canonical_indicate_cache_gaps(self):
        """The flip side: canonical has bars cache doesn't = cache gap.
        This is what surfaces 'missing data' bugs in the user's reports."""
        cached = [_bar(1000, 67.5, 67.5, 67.5, 67.5, 1)]
        canonical = [
            _bar(1000, 67.5, 67.5, 67.5, 67.5, 1),
            _bar(2000, 68, 68, 68, 68, 1),
            _bar(3000, 69, 69, 69, 69, 1),
        ]
        result = diff_bars(cached, canonical, ticker="QQQ", tf="30")
        assert result.bars_only_in_canonical == [2000, 3000]
        assert result.bars_compared == 1

    def test_empty_inputs_dont_crash(self):
        result = diff_bars([], [], ticker="QQQ", tf="30")
        assert result.bars_compared == 0
        assert result.diffs == []
        assert result.bars_only_in_cache == []
        assert result.bars_only_in_canonical == []
        assert result.pass_rate == 1.0

    def test_empty_cache_with_canonical_means_total_gap(self):
        """No cache + canonical exists = every canonical bar is "missing
        from cache". Pass rate is undefined-but-positive (no compared
        bars failed); the signal is in bars_only_in_canonical."""
        canonical = [_bar(1000, 67.5, 67.5, 67.5, 67.5, 1)]
        result = diff_bars([], canonical, ticker="QQQ", tf="30")
        assert len(result.bars_only_in_canonical) == 1
        assert result.bars_compared == 0


# ── AuditResult ──────────────────────────────────────────────────────────

class TestAuditResult:
    def test_pass_rate_with_no_failures(self):
        r = AuditResult(ticker="X", tf="30", bars_compared=10)
        assert r.pass_rate == 1.0

    def test_pass_rate_counts_unique_failed_timestamps(self):
        """A bar with diffs in c AND v counts as ONE failed bar, not two.
        Without this de-dup, the pass rate is meaninglessly low."""
        r = AuditResult(
            ticker="X", tf="30", bars_compared=10,
            diffs=[
                BarDiff(timestamp=1000, field_name="c", cached=67, canonical=68,
                        delta=-1, pct_delta=-0.014, severity="fail"),
                BarDiff(timestamp=1000, field_name="v", cached=100, canonical=200,
                        delta=-100, pct_delta=-0.5, severity="fail"),
            ],
        )
        assert r.pass_rate == 0.9   # 9/10 = 1 unique failed timestamp out of 10 compared
        assert r.fail_count == 2     # both individual diffs reported

    def test_warn_doesnt_count_against_pass_rate(self):
        """Warn-severity = "investigate, may not be a bug". Don't penalize
        the pass rate; that's reserved for fail-severity."""
        r = AuditResult(
            ticker="X", tf="30", bars_compared=10,
            diffs=[
                BarDiff(timestamp=1000, field_name="c", cached=67, canonical=67.05,
                        delta=-0.05, pct_delta=-0.0007, severity="warn"),
            ],
        )
        assert r.pass_rate == 1.0
        assert r.warn_count == 1
        assert r.fail_count == 0

    def test_to_dict_is_json_serializable(self):
        """The HTTP endpoint serializes via json.dumps — to_dict() output
        must be plain types only (no dataclasses, no datetimes)."""
        import json
        r = AuditResult(
            ticker="X", tf="30", bars_compared=2,
            bars_only_in_cache=[1000],
            bars_only_in_canonical=[2000],
            diffs=[
                BarDiff(timestamp=1500, field_name="c", cached=67, canonical=68,
                        delta=-1, pct_delta=-0.014, severity="warn"),
            ],
        )
        json.dumps(r.to_dict())  # raises if non-serializable

    def test_to_dict_includes_error_field(self):
        r = AuditResult(ticker="X", tf="30", error="Massive key missing")
        d = r.to_dict()
        assert d["error"] == "Massive key missing"
        assert d["bars_compared"] == 0
