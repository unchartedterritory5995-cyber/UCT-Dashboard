"""The metric catalogue and its applicability rule.

The claim under test: `UNIVERSE × METRICS` is a PROJECTION with an applicability
rule, not four hand-maintained copies of the catalogue.
"""
import pathlib

from api.services import breadth_metrics as bm
from api.services import breadth_universes as bu


# ── the catalogue ────────────────────────────────────────────────────────────

def test_every_metric_carries_the_metadata_a_chart_needs():
    for key, m in bm.METRICS.items():
        assert m["metric"] == key
        assert m["code"] and m["name"] and m["short_name"] and m["group"]
        assert m["unit"] in {bm.UNIT_PERCENT, bm.UNIT_COUNT, bm.UNIT_RATIO,
                             bm.UNIT_INDEX, bm.UNIT_POINTS}
        assert m["domain"] in {bm.DOMAIN_PCT, bm.DOMAIN_NONNEG, bm.DOMAIN_SIGNED,
                               bm.DOMAIN_RATIO}
        assert m["presentation"] in {bm.PRES_LINE, bm.PRES_HISTOGRAM}
        assert m["portability"] in {bm.PORTABLE, bm.NOT_PORTABLE}


def test_metric_keys_and_codes_are_both_unique():
    # A duplicate code would make two metrics the same namespaced symbol.
    assert len(bm.CODE_TO_METRIC) == len(bm.METRIC_KEYS) == len(bm.METRICS)


def test_the_catalogue_covers_every_symbol_the_shipped_registry_serves():
    """⛔ The projection cannot be a SECOND catalogue: every metric the live UCT
    registry already serves must be described here, or a UCT symbol would have no
    metadata while its US twin had some."""
    from api.services import breadth_symbols
    served = {rec["metric"] for rec in breadth_symbols.SYMBOLS.values()}
    missing = served - set(bm.METRICS)
    assert not missing, f"shipped breadth symbols with no catalogue row: {sorted(missing)}"


# ── applicability ────────────────────────────────────────────────────────────

def test_uct_keeps_everything_including_the_non_portable_metrics():
    # UCT is where the surveys and composites are actually measured.
    for key in bm.METRIC_KEYS:
        assert bm.applies_to(key, "uct"), key
    assert set(bm.metrics_for("uct")) == set(bm.METRIC_KEYS)


def test_a_pit_universe_gets_the_portable_set_and_nothing_else():
    """⚠️ PORTABLE MINUS UNPRODUCIBLE, and the subtraction is the point. This rail
    used to read `== PORTABLE_METRICS`, which was true until a control sweep showed
    that three portable metrics cannot be produced correctly by the PIT sweep (see
    `PIT_UNPRODUCIBLE`). Stating the two-gate rule keeps the rail an invariant
    rather than a snapshot of whichever set happened to be right first."""
    for uni in bu.PIT_UNIVERSE_IDS:
        got = set(bm.metrics_for(uni))
        assert got == set(bm.PORTABLE_METRICS) - bm.PIT_UNPRODUCIBLE
        # the surveys, the ETF pair ratios and the proprietary composites stay out
        for key in ("cnn_fear_greed", "cboe_putcall", "aaii_spread", "uct_exposure",
                    "breadth_score", "rsp_spy_ratio", "iwm_qqq_ratio", "new_ath"):
            assert not bm.applies_to(key, uni), f"{key} must not apply to {uni}"


def test_the_ma_family_and_the_high_low_family_are_portable():
    for key in ("pct_above_5sma", "pct_above_50sma", "pct_above_200sma",
                "new_52w_highs", "new_52w_lows", "net_new_high_low"):
        assert bm.is_portable(key), key


def test_an_unknown_metric_applies_nowhere():
    assert not bm.applies_to("not_a_metric", "uct")
    assert not bm.applies_to("not_a_metric", "us")
    assert bm.get("not_a_metric") is None


def test_the_projection_is_a_product_not_four_hand_written_lists():
    """⭐ The architectural claim: rows = universes × applicable metrics."""
    expected = sum(len(bm.metrics_for(u)) for u in bu.UNIVERSE_IDS)
    actual = sum(1 for u in bu.UNIVERSE_IDS for k in bm.METRIC_KEYS
                 if bm.applies_to(k, u))
    assert expected == actual
    # and it is genuinely smaller than a naive cross product
    assert actual < len(bu.UNIVERSE_IDS) * len(bm.METRIC_KEYS)


# ── the signed metric ────────────────────────────────────────────────────────

def test_net_new_high_low_is_declared_signed_and_a_histogram():
    m = bm.get("net_new_high_low")
    assert m["domain"] == bm.DOMAIN_SIGNED
    assert m["presentation"] == bm.PRES_HISTOGRAM
    assert "net_new_high_low" in bm.signed_metrics()
    # ⛔ and the three identities stay DISTINCT — Net is not a replacement for the
    # two components.
    assert {"new_52w_highs", "new_52w_lows", "net_new_high_low"} <= set(bm.METRICS)


def test_the_other_signed_metrics_are_still_declared_signed():
    # These already ship and already cross zero; the catalogue must not regress them.
    for key in ("adv_decline", "mcclellan_osc", "adv_decline_cum"):
        assert bm.get(key)["domain"] == bm.DOMAIN_SIGNED, key


# ── What the PIT producer can actually make ──────────────────────────────────
#
# ⭐⭐ THESE RAILS EXIST BECAUSE A GRIND WOULD HAVE BAKED WRONG DATA IN. A metric
# can be portable in principle and still be unproducible — or wrongly producible —
# by the sweep that builds the new universes. That is a fact about the PRODUCER,
# not about the measurement, and it was found by measuring a control sweep rather
# than by reading the catalogue.

def test_the_pit_unproducible_set_is_excluded_from_every_pit_universe():
    for metric in bm.PIT_UNPRODUCIBLE:
        assert bm.is_portable(metric), metric        # portable in principle…
        for uni in ("us", "nasdaq", "nyse"):
            assert not bm.applies_to(metric, uni), (metric, uni)   # …unproducible here


def test_uct_keeps_every_one_of_them():
    """⛔ UCT is measured by the COLLECTOR, not by this sweep. The producer's limits
    are not the collector's, and UCT must not lose a metric it has always written."""
    for metric in bm.PIT_UNPRODUCIBLE:
        assert bm.applies_to(metric, "uct"), metric
    assert len(bm.metrics_for("uct")) == len(bm.METRIC_KEYS)


def test_the_set_names_only_real_metrics():
    assert bm.PIT_UNPRODUCIBLE <= set(bm.METRIC_KEYS)


def test_a_pit_universe_offers_exactly_portable_minus_unproducible():
    want = [k for k in bm.METRIC_KEYS
            if bm.is_portable(k) and k not in bm.PIT_UNPRODUCIBLE]
    for uni in ("us", "nasdaq", "nyse"):
        assert bm.metrics_for(uni) == want, uni


def test_mcclellan_is_excluded_and_the_reason_is_recorded():
    """⚰️ The dangerous one: it WROTE plausible values. Measured on 2015-03-09 the
    three universes returned -232.9 / -244.8 / -246.1 over populations of 2,936 /
    1,195 / 1,712 — 1.3 points apart, and all negative on a day all three advanced
    broadly. `build_levels`' McClellan EMAs are the only levels that are not
    per-ticker, so the history is the whole market's while today's net is not."""
    assert "mcclellan_osc" in bm.PIT_UNPRODUCIBLE
    src = (pathlib.Path(__file__).resolve().parents[1]
           / "api" / "services" / "breadth_metrics.py").read_text(encoding="utf-8")
    assert "mcc_ema19" in src and "ratio-adjusted" in src


def test_the_projection_and_the_sweep_read_the_SAME_gate():
    """⛔ One function decides both what a PIT universe may STORE and what it may
    OFFER. If they ever diverge, a member finds an identity that can never have
    rows — which is the failure these three metrics would have been."""
    from api.services import breadth_symbols as bs
    from api.services import breadth_history_recon as recon
    rows = {r["metric"] for r in bs.library_rows(["us"])}
    for metric in bm.PIT_UNPRODUCIBLE:
        assert metric not in rows, metric
        assert not recon._applies(metric, "us"), metric
