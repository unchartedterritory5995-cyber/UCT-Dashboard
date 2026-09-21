"""THE CANONICAL NAAIM SERIES — accept gate, point-in-time semantics, one truth.

⛔ The rules this file pins are the ones the existing production chain broke:
an undated placeholder froze the value at 75.00 for 93 sessions, and the live
collector's `0 <= v <= 200` gate discards the negative readings the index exists to
capture.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    """A throwaway store per test. ⛔ `_INIT_DONE` is module state, so it has to be
    reset alongside the path or the second test writes into the first one's file."""
    from api.services.market_indicators import naaim_store as ns
    monkeypatch.setenv("NAAIM_DB", str(tmp_path / "naaim.db"))
    monkeypatch.setattr(ns, "_INIT_DONE", False, raising=False)
    yield ns
    monkeypatch.setattr(ns, "_INIT_DONE", False, raising=False)


# ── The range bug ────────────────────────────────────────────────────────────

def test_a_negative_reading_is_accepted(isolated_store):
    """⛔⛔ THE LIVE COLLECTOR'S GATE IS `0 <= v <= 200` AND IT IS WRONG.

    NAAIM's published scale runs −200 (leveraged short) to +200 (leveraged long).
    A genuinely bearish week is exactly what the index exists to record, and the
    existing gate silently discards it.
    """
    ns = isolated_store
    res = ns.ingest(-37.5, observed_on="2026-03-04", source=ns.SOURCE_COLLECTOR)
    assert res["accepted"], res
    assert ns.latest()["value"] == pytest.approx(-37.5)


def test_leveraged_extremes_at_both_ends_are_accepted(isolated_store):
    ns = isolated_store
    assert ns.ingest(-200.0, observed_on="2026-03-04")["accepted"]
    assert ns.ingest(200.0, observed_on="2026-03-11")["accepted"]


def test_a_value_outside_the_published_range_is_refused(isolated_store):
    ns = isolated_store
    out = ns.ingest(250.0, observed_on="2026-03-04")
    assert not out["accepted"]
    assert "range" in out["reason"]


def test_a_non_finite_value_is_refused(isolated_store):
    ns = isolated_store
    assert not ns.ingest(float("nan"), observed_on="2026-03-04")["accepted"]
    assert not ns.ingest(None, observed_on="2026-03-04")["accepted"]


# ── The placeholder ──────────────────────────────────────────────────────────

def test_the_undated_seventy_five_placeholder_is_refused(isolated_store):
    """⛔⛔ THE EXACT SIGNATURE OF THE MORNING-WIRE DEFAULT.

    `naaim_cache` ships as `{"exposure": 75.0, "date": ""}` and the repo's own
    open-check rail records the consequence in its message: *"an undated reading is
    how it froze at 75.00 for 93 sessions"*.
    """
    ns = isolated_store
    out = ns.ingest(75.0, observed_on=None, seen_on="2026-03-05")
    assert not out["accepted"]
    assert "placeholder" in out["reason"]
    assert ns.bounds()["count"] == 0


def test_a_DATED_seventy_five_is_a_perfectly_good_observation(isolated_store):
    """⛔ THE VALUE ALONE IS NOT THE PLACEHOLDER. 75.0 is a legal NAAIM reading and
    blanket-refusing it would throw away real weeks. Only undated-AND-75.0 is the
    default's signature."""
    ns = isolated_store
    assert ns.ingest(75.0, observed_on="2026-03-04")["accepted"]


def test_a_frozen_undated_feed_is_refused_after_three_weeks(isolated_store):
    """A bit-identical undated number three weeks running is a stuck source."""
    ns = isolated_store
    assert ns.ingest(61.25, seen_on="2026-03-05")["accepted"]
    assert ns.ingest(61.25, seen_on="2026-03-12")["accepted"]
    out = ns.ingest(61.25, seen_on="2026-03-19")
    assert not out["accepted"]
    assert "stuck source" in out["reason"]


def test_every_refusal_is_recorded_with_its_reason(isolated_store):
    """⛔ A SILENT DROP IS WHY THE FREEZE LASTED 93 SESSIONS. An operator must be able
    to ask the data why there is no reading."""
    ns = isolated_store
    ns.ingest(75.0, seen_on="2026-03-05")
    refusals = ns.stats()["recent_refusals"]
    assert refusals and "placeholder" in refusals[0]["reason"]


# ── Observation date vs knowledge date ───────────────────────────────────────

def test_the_knowledge_date_is_the_publication_thursday(isolated_store):
    ns = isolated_store
    ns.ingest(55.0, observed_on="2026-03-04")          # a Wednesday
    row = ns.latest()
    assert row["observed_on"] == "2026-03-04"
    assert row["known_on"] == "2026-03-05"             # the Thursday


def test_a_point_in_time_read_cannot_know_a_value_before_it_was_published(isolated_store):
    """⛔⛔ THE LOOKAHEAD GUARANTEE. Managers report Wednesday; the number is public
    Thursday. A backtest reading the series as of Wednesday must not see it."""
    ns = isolated_store
    ns.ingest(55.0, observed_on="2026-03-04")
    assert ns.latest(asof="2026-03-04") is None
    assert ns.latest(asof="2026-03-05")["value"] == pytest.approx(55.0)


def test_a_lagging_feed_pushes_the_knowledge_date_out(isolated_store):
    """The free NAAIM table currently runs ~3 months behind. We did not know the
    number on publication day, and the store must not pretend we did."""
    ns = isolated_store
    ns.ingest(55.0, observed_on="2026-03-04", seen_on="2026-06-10")
    row = ns.latest()
    assert row["known_on"] == "2026-06-10"
    assert ns.latest(asof="2026-03-05") is None


def test_an_undated_reading_infers_the_survey_wednesday_and_says_so(isolated_store):
    ns = isolated_store
    out = ns.ingest(61.0, seen_on="2026-03-06")        # a Friday
    assert out["accepted"]
    assert out["observed_on"] == "2026-03-04"          # that week's Wednesday
    assert ns.latest()["date_inferred"] is True


def test_a_reading_seen_ON_the_wednesday_belongs_to_the_previous_week(isolated_store):
    """It cannot be that day's: the survey closes at that close and publishes the
    next morning."""
    from api.services.market_indicators import naaim_store as ns
    assert ns.survey_wednesday("2026-03-04") == "2026-02-25"


# ── Authority ordering ───────────────────────────────────────────────────────

def test_an_inferred_date_never_overwrites_a_dated_row(isolated_store):
    ns = isolated_store
    ns.ingest(55.0, observed_on="2026-03-04", source=ns.SOURCE_COLLECTOR)
    out = ns.ingest(99.0, seen_on="2026-03-06")        # infers 2026-03-04
    assert not out["accepted"]
    assert ns.latest()["value"] == pytest.approx(55.0)


def test_a_seed_never_overwrites_a_collector_row(isolated_store):
    ns = isolated_store
    ns.ingest(55.0, observed_on="2026-03-04", source=ns.SOURCE_COLLECTOR)
    out = ns.ingest(11.0, observed_on="2026-03-04", source=ns.SOURCE_SEED)
    assert not out["accepted"]
    assert ns.latest()["value"] == pytest.approx(55.0)


def test_the_licensed_source_may_revise_a_collector_row(isolated_store):
    """⭐ THE COMMERCIAL SWAP SEAM. When the NAAIM Program Partner API replaces the
    POC feed, its values must win — and the revision must be recorded, not silent."""
    ns = isolated_store
    ns.ingest(55.0, observed_on="2026-03-04", source=ns.SOURCE_COLLECTOR)
    out = ns.ingest(56.7, observed_on="2026-03-04", source=ns.SOURCE_LICENSED)
    assert out["accepted"]
    row = ns.latest()
    assert row["value"] == pytest.approx(56.7)
    assert row["source"] == ns.SOURCE_LICENSED
    assert row["revision"] == 1


def test_re_ingesting_the_same_value_is_idempotent(isolated_store):
    ns = isolated_store
    ns.ingest(55.0, observed_on="2026-03-04", source=ns.SOURCE_COLLECTOR)
    out = ns.ingest(55.0, observed_on="2026-03-04", source=ns.SOURCE_COLLECTOR)
    assert out["accepted"] and out["changed"] is False
    assert ns.bounds()["count"] == 1


# ── The seed ─────────────────────────────────────────────────────────────────

def test_the_bundled_seed_loads_and_is_dated(isolated_store):
    ns = isolated_store
    res = ns.seed_from_bundled_csv()
    assert res["ok"], res
    b = ns.bounds()
    assert b["count"] >= 100, b
    assert b["first"] <= "2023-12-31"
    assert ns.stats()["inferred_dates"] == 0, (
        "every seeded row carries NAAIM's own survey date; none should be inferred")


def test_seeding_twice_does_not_duplicate(isolated_store):
    ns = isolated_store
    ns.seed_from_bundled_csv()
    n1 = ns.bounds()["count"]
    ns.seed_from_bundled_csv(force=True)
    assert ns.bounds()["count"] == n1


# ── ONE TRUTH: the Breadth page and the chart read the same row ──────────────

def test_the_chart_series_and_the_latest_value_come_from_the_same_store(isolated_store,
                                                                        monkeypatch):
    """⭐⭐ THE ARCHITECTURAL REQUIREMENT, AS A TEST. `naaim_store.latest()` is what a
    Breadth surface reads; `series.daily_bars('SENT:NAAIM')` is what the chart draws.
    They must be the same number, from the same row, with no second ingestion path."""
    from api.services.market_indicators import series as mseries
    ns = isolated_store
    ns.ingest(64.25, observed_on="2026-03-04", source=ns.SOURCE_COLLECTOR)

    # No breadth session calendar in a sandbox — the observations themselves are served.
    monkeypatch.setattr(mseries, "session_calendar", lambda *a, **k: [])
    bars = mseries.daily_bars("SENT:NAAIM")
    assert bars, "the chart must see the observation the page sees"
    assert bars[-1]["c"] == pytest.approx(ns.latest()["value"])
    assert bars[-1]["t"] == ns.latest()["observed_on"]


def test_the_breadth_push_appends_to_the_canonical_series(isolated_store):
    """The collector's accepted weekly value must land in the canonical store.

    ⚠️ Exercises the STORE CALL the push hook makes, not the HTTP route — the route
    needs auth, a monitor DB and a degradation check, none of which are what this
    invariant is about.
    """
    ns = isolated_store
    metrics = {"naaim": 71.4, "naaim_date": "2026-03-04"}
    ns.ingest(metrics["naaim"], observed_on=metrics["naaim_date"],
              seen_on="2026-03-05", source=ns.SOURCE_COLLECTOR)
    assert ns.latest()["value"] == pytest.approx(71.4)
    assert ns.latest()["source"] == ns.SOURCE_COLLECTOR


def test_a_push_carrying_the_placeholder_leaves_the_series_untouched(isolated_store):
    ns = isolated_store
    ns.ingest(64.0, observed_on="2026-02-25", source=ns.SOURCE_COLLECTOR)
    ns.ingest(75.0, observed_on=None, seen_on="2026-03-05",
              source=ns.SOURCE_COLLECTOR)                      # the placeholder
    assert ns.bounds()["count"] == 1
    assert ns.latest()["value"] == pytest.approx(64.0)


# ── The series must not ship EMPTY ───────────────────────────────────────────

def test_the_bundled_history_is_actually_wired_into_boot():
    """⛔⛔ THE FUNCTION EXISTING IS NOT THE FUNCTION RUNNING.

    `seed_from_bundled_csv` was written, tested and documented — and called from
    nowhere. `naaim_store` is what the CHART reads, so a fresh pod would have served
    a PUBLISHED indicator with nothing in it, filling one observation per week as the
    collector pushed, and every test here would still have passed.

    ⚠️ ASSERTED AGAINST `api/main.py`'s SOURCE, because the thing under test is the
    WIRING. Importing the module and checking a symbol exists is what missed it.
    """
    import inspect
    import api.main as main
    src = inspect.getsource(main)
    assert "naaim_store" in src, "nothing in main.py mentions the canonical NAAIM store"
    i = src.index("_naaim_series_seed")
    block = src[i:i + 700]
    assert "seed_from_bundled_csv" in block, "the boot hook must seed from the CSV"
    # and it must be started, not merely defined
    assert "threading.Thread(target=_naaim_series_seed" in src
    assert ".start()" in src[src.index("threading.Thread(target=_naaim_series_seed"):][:300]


def test_the_bundled_csv_is_present_and_parses():
    """The seed is only as real as the file it reads."""
    import csv
    import os
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "api", "data", "naaim_history.csv")
    assert os.path.exists(p), "api/data/naaim_history.csv must be version-controlled"
    with open(p, newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh)]
    assert len(rows) > 100, f"only {len(rows)} rows — the seed would be nearly empty"
