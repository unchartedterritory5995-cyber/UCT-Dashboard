"""Study blocker B2 -- the wire archive records the firm's call for the day.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
1. A "CALL THE MARKET" DRILL KEYED ON A WORD THE FIRM NEVER SAID. The archive
   held only `rundown_html`; the call word (`game_plan.exposure_tier`) lived in
   `wire_data.json`, overwritten every morning. The push now records the word
   and the score as the payload stated them, raw, and NEVER guesses them from
   the html or normalises a word the engine did not say.
2. A SCALE MIX-UP. The engine's five words are not the course's four colours,
   and the 0-150 score changed shape on 2026-03-22. Every recorded call carries
   `tier_scale_id`, so a consumer can refuse to compare across scales.
3. A SILENT REGRESSION OF THE ARCHIVE ITSELF. Entries written before this
   projection existed still serve, and answer the call as "not recorded"
   (None), never as an invented value.
"""
from __future__ import annotations

import json

import pytest

from api.services import wire_archive


@pytest.fixture
def archive(tmp_path, monkeypatch):
    d = tmp_path / "wire_archive"
    monkeypatch.setenv("WIRE_ARCHIVE_DIR", str(d))
    return d


def _wire(date: str, **extra) -> dict:
    return {"date": date, "rundown_html": f"<p>wire of {date}</p>", **extra}


# ── 1. the push records the word and the score, raw ──────────────────────────

def test_a_push_records_the_tier_word_and_score_beside_the_rundown(archive):
    assert wire_archive.record(_wire(
        "2026-10-17",
        game_plan={"exposure_tier": "Constructive"},
        exposure={"score": 92, "exposure": 92},
    ))
    mc = wire_archive.market_call("2026-10-17")
    assert mc == {"exposure_tier": "Constructive", "exposure_score": 92.0,
                  "tier_scale_id": wire_archive.TIER_SCALE_ID}
    # the file itself carries it, so a consumer reading the JSON directly sees it
    on_disk = json.loads((archive / "wire_2026-10-17.json").read_text("utf-8"))
    assert on_disk["market_call"]["exposure_tier"] == "Constructive"


def test_the_word_is_recorded_as_stated_never_normalised_or_guessed(archive):
    # whitespace is stripped; case and wording are kept exactly as the engine said them
    wire_archive.record(_wire("2026-10-16",
                              game_plan={"exposure_tier": "  defensive "},
                              exposure={"score": 12.5}))
    mc = wire_archive.market_call("2026-10-16")
    assert mc["exposure_tier"] == "defensive"
    assert mc["exposure_score"] == 12.5


def test_a_payload_without_a_game_plan_still_archives_and_answers_none(archive):
    html_only = _wire("2026-10-15")
    assert wire_archive.record(html_only)
    assert wire_archive.read("2026-10-15")["rundown_html"] == html_only["rundown_html"]
    assert wire_archive.market_call("2026-10-15") == {
        "exposure_tier": None, "exposure_score": None,
        "tier_scale_id": wire_archive.TIER_SCALE_ID}


def test_a_non_numeric_score_or_blank_word_is_none_not_an_error(archive):
    wire_archive.record(_wire("2026-10-14",
                              game_plan={"exposure_tier": ""},
                              exposure={"score": "n/a"}))
    mc = wire_archive.market_call("2026-10-14")
    assert mc["exposure_tier"] is None
    assert mc["exposure_score"] is None
    # a boolean is not a score
    wire_archive.record(_wire("2026-10-13", exposure={"score": True}))
    assert wire_archive.market_call("2026-10-13")["exposure_score"] is None


# ── 2. the scale travels with the word ───────────────────────────────────────

def test_every_recorded_call_names_its_scale(archive):
    wire_archive.record(_wire("2026-10-12", game_plan={"exposure_tier": "Neutral"}))
    assert wire_archive.market_call("2026-10-12")["tier_scale_id"] == "wire-5word-v1"
    assert wire_archive.TIER_SCALE_ID == "wire-5word-v1"


# ── 3. entries archived before the projection existed still serve ────────────

def test_a_legacy_entry_without_market_call_serves_and_reports_not_recorded(archive):
    archive.mkdir(parents=True)
    legacy = {"date": "2026-09-30", "rundown_html": "<p>old</p>",
              "archived_at": "2026-09-30T12:00:00+00:00"}
    (archive / "wire_2026-09-30.json").write_text(json.dumps(legacy), "utf-8")
    assert wire_archive.read("2026-09-30")["rundown_html"] == "<p>old</p>"
    assert wire_archive.market_call("2026-09-30") == {
        "exposure_tier": None, "exposure_score": None,
        "tier_scale_id": wire_archive.TIER_SCALE_ID}


def test_market_calls_lists_every_held_date_oldest_first_with_gaps_visible(archive):
    wire_archive.record(_wire("2026-10-02", game_plan={"exposure_tier": "Caution"},
                              exposure={"score": 40}))
    wire_archive.record(_wire("2026-10-01"))  # no call recorded that day
    rows = wire_archive.market_calls()
    assert [r["date"] for r in rows] == ["2026-10-01", "2026-10-02"]
    assert rows[0]["exposure_tier"] is None
    assert rows[1]["exposure_tier"] == "Caution" and rows[1]["exposure_score"] == 40.0


def test_a_missing_day_is_none_never_a_neighbour(archive):
    wire_archive.record(_wire("2026-10-02", game_plan={"exposure_tier": "Caution"}))
    assert wire_archive.market_call("2026-10-03") is None
    assert wire_archive.market_call("not-a-date") is None


# ── 4. the backfill door carries the call too (no overwrite of a push) ───────

def test_backfill_keeps_a_pushed_entry_and_its_call(archive):
    wire_archive.record(_wire("2026-10-02", game_plan={"exposure_tier": "Caution"}))
    assert not wire_archive.record(
        _wire("2026-10-02", game_plan={"exposure_tier": "Aggressive"}), overwrite=False)
    assert wire_archive.market_call("2026-10-02")["exposure_tier"] == "Caution"
