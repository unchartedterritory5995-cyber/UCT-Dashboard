"""The rail under the vendor-truth harness.

⛔⛔ WHY THIS FILE EXISTS AT ALL. `tools/vendor_truth.py` and
`tools/vendor_spec_probes.py` are the only instruments in this repository that
can say our indicators are RIGHT rather than merely UNCHANGED. Two scripts
nobody runs are worth nothing, and a harness that cannot fail is worth less than
nothing because it prints reassurance. So the harness is gated here, and what is
gated is not "does it pass" but "can it still fail".

The three things this file pins, in order of importance:

  1. THE HARNESSES DISCRIMINATE. `--selfcheck` and `--control` plant known
     disagreements and are required to catch them. A comparator with an inverted
     test, an off-by-one bar index, or a tolerance read from the wrong field all
     produce a perfect page over a real store.
  2. THE EMPTY STORE IS LOUD. An observation directory with nothing in it must
     REFUSE, not pass. Iterate-nothing-find-nothing-exit-0 is how this becomes
     decorative without anybody deciding to make it so.
  3. THE ROSTER CANNOT ROT. Every `divergences.json` row carries a probe that
     names BOTH answers, so a row cannot degrade into a description of nothing
     (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

⭐ AND ONE MEASURED FINDING IS PINNED AS A FINDING. `probe_atr` disagrees with
TradingView's published `ta.rma(ta.tr(true), length)` — one bar late, 0.0065
worst delta. That is asserted here so the day somebody fixes `compute_atr_raw`,
this file goes red and MAKES THEM UPDATE THE ROSTER rather than leaving a
`spec-falsified` row describing a divergence that no longer exists. A finding
with no expiry becomes folklore.
"""

from __future__ import annotations

import io
import json
import os

import pytest

from tools import vendor_spec_probes as probes
from tools import vendor_truth as vt


# ─── 1. the harnesses can fail ───────────────────────────────────────────────

def test_the_vendor_truth_harness_DISCRIMINATES():
    """The positive control. Without it a green --check means nothing."""
    out = io.StringIO()
    assert vt.selfcheck(out=out) == 0, out.getvalue()
    text = out.getvalue()
    assert "MATCH" in text and "DELTA" in text, text
    assert "DISCRIMINATES" in text


def test_the_spec_probe_DISCRIMINATES_on_value_AND_on_alignment():
    """⛔ TWO AXES, NOT ONE. Two engines can agree on every shared bar and still
    disagree about WHICH BAR an indicator begins on — which is exactly the ATR
    finding, and a comparator that only walked shared bars would have missed it
    entirely."""
    out = io.StringIO()
    assert probes.control(out=out) == 0, out.getvalue()
    assert "discriminates on BOTH axes" in out.getvalue()


# ─── 2. emptiness is loud ────────────────────────────────────────────────────

def test_an_EMPTY_observation_store_REFUSES_rather_than_passing(tmp_path, monkeypatch):
    """⛔ THE FAILURE MODE THIS WHOLE DIRECTORY IS WRITTEN AGAINST.

    A `--check` over zero observations finds zero deltas. Exit 0 would read as
    "we match the vendor" and mean "we have never looked".
    """
    monkeypatch.setattr(vt, "OBS_DIR", str(tmp_path / "nothing"))
    out = io.StringIO()
    assert vt.check(out=out) == 2
    text = out.getvalue()
    assert "NO VENDOR OBSERVATIONS ARE HELD" in text
    assert "This is NOT a pass" in text
    # …and it must say what to DO, or it is a refusal nobody can act on.
    assert "README.md" in text


def test_the_report_leads_with_its_DENOMINATOR(tmp_path, monkeypatch):
    """"0 deltas" over 0 comparisons and over 400 print the same way unless the
    denominator is there. `lesson_a_hit_rate_is_meaningless_without_its_base_rate`."""
    obs_dir = tmp_path / "observations"
    obs_dir.mkdir()
    bars = [{"t": 20260100 + i, "o": 10.0 + i, "h": 10.0 + i, "l": 10.0 + i,
             "c": 10.0 + i, "v": 100} for i in range(1, 31)]
    ast = {"type": "call", "name": "sma",
           "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 5}]}
    truth = vt.evaluate({"engine": {"ast": ast},
                         "market": {"bars": bars, "timeframe": "1D"}})[9]
    obs = {
        "id": "synthetic-denominator-probe", "shape": "stateless",
        "script": {"dialect": "pine", "source": "plot(ta.sma(close, 5))", "plot": "plot0"},
        "engine": {"formula": "sma(close, 5)", "ast": ast},
        "market": {"symbol": "_SYNTHETIC", "timeframe": "1D", "bars": bars},
        "vendor": {"readDecimals": 6, "values": {str(bars[9]["t"]): round(truth, 6)}},
        "provenance": {"platform": "_test", "who": "test_vendor_truth.py",
                       "when": "2026-08-29"},
    }
    (obs_dir / "synthetic.json").write_text(json.dumps(obs), encoding="utf-8")
    monkeypatch.setattr(vt, "OBS_DIR", str(obs_dir))
    out = io.StringIO()
    assert vt.check(out=out) == 0, out.getvalue()
    assert "ran     : 1 observations, 1 compared values" in out.getvalue()


def test_an_observation_WITHOUT_PROVENANCE_is_refused(tmp_path, monkeypatch):
    """A vendor number with no 'who read this, off what, when' is indistinguishable
    from one somebody invented — and the whole value of the directory is that the
    difference is knowable."""
    obs_dir = tmp_path / "observations"
    obs_dir.mkdir()
    (obs_dir / "bad.json").write_text(json.dumps({
        "id": "x", "shape": "stateless", "script": {}, "engine": {},
        "market": {"bars": []}, "vendor": {"values": {"1": 1}},
        "provenance": {"platform": "TradingView"},          # no who, no when
    }), encoding="utf-8")
    monkeypatch.setattr(vt, "OBS_DIR", str(obs_dir))
    with pytest.raises(vt.VendorTruthError, match="provenance"):
        vt.load_observations(str(obs_dir))


def test_a_MALFORMED_observation_is_an_error_not_a_SKIP(tmp_path):
    """A run that quietly skipped the file it could not read would report a clean
    pass over a store it had not looked at — the empty-store defect, one level in."""
    obs_dir = tmp_path / "observations"
    obs_dir.mkdir()
    (obs_dir / "broken.json").write_text("{ not json", encoding="utf-8")
    with pytest.raises(vt.VendorTruthError, match="unreadable"):
        vt.load_observations(str(obs_dir))


# ─── 3. the roster cannot rot ────────────────────────────────────────────────

def _rows():
    doc = json.load(io.open(vt.DIVERGENCES, encoding="utf-8"))
    return doc["rows"], doc


def test_every_divergence_row_carries_a_probe_that_NAMES_BOTH_ANSWERS():
    rows, doc = _rows()
    assert rows, "the roster is empty"
    for row in rows:
        probe = row.get("probe") or {}
        assert probe.get("case"), f"{row['id']}: no probe case"
        # ⛔ BOTH SIDES, NAMED. A probe that states only what WE do describes
        # nothing a reader could disagree with, and cannot discriminate.
        theirs = [k for k in probe if k.startswith("under_") and k != "under_ours"]
        assert probe.get("under_ours"), f"{row['id']}: probe does not say what WE do"
        assert theirs, f"{row['id']}: probe does not say what the OTHER convention does"
        assert probe.get("discriminates"), \
            f"{row['id']}: probe does not say HOW the two are told apart"


def test_every_row_status_is_in_the_declared_vocabulary():
    """DERIVED from the vocabulary block, never a second hand-typed list."""
    rows, doc = _rows()
    allowed = set(doc["_status_vocabulary"])
    for row in rows:
        assert row["status"] in allowed, \
            f"{row['id']}: status {row['status']!r} not in {sorted(allowed)}"


def test_a_MEASURED_row_carries_the_measurement_and_a_suspected_row_does_not():
    """⛔ THE ASYMMETRY IS THE POINT. `spec-falsified`/`refuted` are claims about a
    number somebody computed; `suspected` is a belief. A `suspected` row wearing a
    `measured` block would be a forecast dressed as a finding —
    `lesson_an_acceptance_number_is_a_forecast_until_derived`."""
    rows, _ = _rows()
    for row in rows:
        if row["status"] == "spec-falsified":
            assert row.get("measured"), f"{row['id']}: falsified with no measurement"
            assert row["measured"].get("by"), f"{row['id']}: measurement names no source"
        if row["status"] == "refuted":
            assert row.get("refutedBy"), f"{row['id']}: refuted by nothing named"
        if row["status"] == "suspected":
            assert not row.get("measured"), \
                f"{row['id']}: carries a measurement but is still only 'suspected'"


# ─── 4. the findings, pinned so they expire honestly ─────────────────────────

def test_the_STATELESS_AND_SEEDED_probes_AGREE_with_the_published_definition():
    """⭐ THE CALIBRATION, AND IT IS WHAT MAKES THE ATR FINDING BELIEVABLE.

    If every probe disagreed, the instrument would be the suspect. Three agree to
    floating-point noise — including the two SEEDED ones, which is the class most
    likely to hide a silent divergence — so a fourth disagreeing at 0.0065 and by
    a whole bar is a fact about ATR, not about the harness.
    """
    for fn, name in ((probes.probe_sma, "sma"), (probes.probe_ema, "ema"),
                     (probes.probe_rma, "rma")):
        r = fn()
        assert r["compared"] > 40, f"{name}: only {r['compared']} bars compared"
        assert r["aligned"], f"{name}: first value on bar {r['our_first_bar']} vs {r['their_first_bar']}"
        assert r["worst"] < 1e-9, f"{name}: worst delta {r['worst']}"


def test_ATR_DISAGREES_with_TradingViews_published_definition_ONE_BAR_LATE():
    """🔴 A MEASURED, MEMBER-FACING DIVERGENCE — asserted so it cannot be
    forgotten, and so that FIXING it turns this red.

    Ours defines True Range from bar 1 (`compute_atr_raw`: `for i in range(1, n)`).
    TradingView's `ta.atr(length)` is `ta.rma(ta.tr(true), length)`, and
    `ta.tr(true)` defines bar 0 as `high - low`. So their TR array starts one bar
    earlier and their seed averages a different set of ranges.

    ⛔ WHEN THIS GOES RED BECAUSE SOMEBODY FIXED IT: do not delete this test.
    Invert it, and move the `atr-tr-starts-at-bar-1` row to `refuted` with the
    commit that fixed it. A finding that is silently dropped becomes folklore.
    """
    r = probes.probe_atr()
    assert not r["agrees"], (
        "ATR now AGREES with the published definition. If that is deliberate, "
        "invert this test and move `atr-tr-starts-at-bar-1` to `refuted` in "
        "tests/fixtures/vendor/divergences.json, naming the commit.")
    # The two axes, separately, because they are two different defects.
    assert r["our_first_bar"] == r["their_first_bar"] + 1, \
        f"alignment moved: ours {r['our_first_bar']}, spec {r['their_first_bar']}"
    assert r["worst"] > 1e-4, f"the value delta collapsed to {r['worst']}"


def test_the_roster_ROW_for_atr_matches_what_the_probe_actually_measures():
    """⛔ THE ROSTER IS AN ARTEFACT A LATER ENGINEER AUDITS AGAINST, which is this
    repo's most expensive defect class when it is wrong. So the recorded numbers
    are re-derived from the live probe rather than trusted."""
    rows, _ = _rows()
    row = next(r for r in rows if r["id"] == "atr-tr-starts-at-bar-1")
    measured = row["measured"]
    r = probes.probe_atr()
    assert measured["our_first_value"] == pytest.approx(r["our_first_value"], rel=1e-12)
    assert measured["spec_first_value"] == pytest.approx(r["their_first_value"], rel=1e-12)
    assert measured["worst_abs_delta"] == pytest.approx(r["worst"], rel=1e-6)
    assert measured["shared_bars_compared"] == r["compared"]
