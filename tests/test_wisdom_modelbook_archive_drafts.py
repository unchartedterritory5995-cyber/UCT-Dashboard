"""Model Book drafts from the TSDR trader archive (ARCHIVE-INTEGRATION-PLAN item 11, owner 2026-10-16).

SYNTHETIC data only — the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a library setup linked to an archive setup by anything but the one vocabulary (D9);
2. the archive read while WISDOM_ARCHIVE_ENABLED is off;
3. an entry/stop/target published for a call posted 20 sessions ago or less;
4. a failure example that does not say it is a failure;
5. an archive draft written while WISDOM_MODELBOOK_DRAFTS_ENABLED is off, or anything published
   without the owner's approval;
6. a playbook draft that drops the archive's measured record, its z verdict, or its citations.
"""
from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from api.services import modelbook_service
from api.services.wisdom.archive import service as archive
from api.services.wisdom.core import store, vocab
from api.services.wisdom.publish.adapters import drafts, modelbook
from tests.test_wisdom_publish_adapters_store import adapters_db, seeded  # noqa: F401

LIBRARY_SETUP = "Kicker Candle"   # in setupCatalog.js, no authored playbook, vocab kicker_candle
ARCHIVE_SETUP = "kicker"          # the trader_archive row with that vocab id


def _ctx(dry_run=False):
    return SimpleNamespace(dry_run=dry_run, log=lambda m: None)


def _stats(n, edge, z=None):
    out = {"n": n, "n_scored": n, "win20": 0.55, "med_r20": 0.01, "mean_r20": 0.02, "med_edge20": 0.012,
           "mean_simR": 0.4, "mean_edgeR": edge, "thin": n < 30}
    if z is not None:
        out["edgeR_z"] = z
    return out


def _recent_day() -> str:
    return (date.today() - timedelta(days=2)).isoformat()


def _seed_archive(z=1.4):
    recent = _recent_day()
    recs = [
        {"record_id": "t9201", "author_id": "tsdr", "stated_date": "2025-01-02", "record_type": "CALL",
         "tickers": ["ZZKK"], "note": "synthetic kicker over the moving averages", "quote": "", "image_count": 1},
        {"record_id": "t9202", "author_id": "bracco", "stated_date": recent, "record_type": "CALL",
         "tickers": ["ZZKF"], "note": "synthetic kicker that failed", "quote": "", "image_count": 0},
        {"record_id": "t9203", "author_id": "bracco", "stated_date": "2025-02-01", "record_type": "LESSON",
         "tickers": [], "note": "synthetic definition of a kicker", "quote": "", "image_count": 0},
    ]
    calls = [
        {"call_id": "t9201#0", "record_id": "t9201", "author_id": "tsdr", "ticker": "ZZKK", "direction": "long",
         "setup": ARCHIVE_SETUP, "posted": "2025-01-02T14:00:00", "entry": 10.0, "stop": 9.0, "target": 14.0,
         "outcome": {"r20": 0.18, "sim_R": 4.0, "status": "scored"}},
        {"call_id": "t9202#0", "record_id": "t9202", "author_id": "bracco", "ticker": "ZZKF", "direction": "long",
         "setup": ARCHIVE_SETUP, "posted": recent + "T14:00:00", "entry": 20.0, "stop": 19.0,
         "outcome": {"r20": -0.08, "sim_R": -1.0, "status": "scored"}},
    ]
    playbook = {
        "setup_id": ARCHIVE_SETUP, "name": "Kicker candle / gap over the MAs", "family": "gap",
        "aliases": ["kicker"], "used_by": ["tsdr", "bracco"],
        "stats": _stats(140, 0.25, z), "stats_trades": _stats(60, 0.3, 1.1),
        "context": {"market": {"downtrend": _stats(40, 0.9), "uptrend": _stats(12, 2.0)}},
        "teachings": [{"record_id": "t9203", "author_id": "bracco", "date": "2025-02-01",
                       "note": "synthetic definition of a kicker"}],
        "winners": [{"call_id": "t9201#0", "record_id": "t9201", "ticker": "ZZKK", "author_id": "tsdr",
                     "posted": "2025-01-02", "direction": "long", "action": "entry",
                     "evidence": "synthetic kicker", "r20": 0.18, "sim_R": 4.0, "regime": "uptrend"}],
        "failures": [{"call_id": "t9202#0", "record_id": "t9202", "ticker": "ZZKF", "author_id": "bracco",
                      "posted": recent, "direction": "long", "action": "entry",
                      "evidence": "synthetic failed kicker", "r20": -0.08, "sim_R": -1.0, "regime": "mixed"}],
    }
    with store.write() as conn:
        for kind, items in (("records", recs), ("calls", calls), ("setups", [playbook])):
            out = archive.upsert_batch(conn, kind, items)
            assert out["rejected"] == 0, out["errors"]


@pytest.fixture
def archive_on(seeded, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    _seed_archive()
    return seeded


def _drafts(kind):
    with store.read() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM wisdom_drafts WHERE kind = ?", (kind,))]


# ── 1. the link is the one vocabulary ────────────────────────────────────────

def test_library_setups_reach_archive_setups_only_through_the_vocabulary(monkeypatch):
    links = modelbook.archive_links()
    assert links[LIBRARY_SETUP] == [ARCHIVE_SETUP]
    assert len(links) >= 10 and set(links) <= set(modelbook.catalog_names())          # non-vacuity
    # a library name with no vocab id links to nothing, even when an archive setup shares its idea
    assert "Slingshot" in modelbook.catalog_names() and "Slingshot" not in links
    # control: move the vocabulary and the link moves with it — it is derived, not typed
    real = vocab.load_vocabulary()
    moved = {**real, "maps": {**real["maps"], "setupCatalog.js": {
        **real["maps"]["setupCatalog.js"],
        "rows": [r for r in real["maps"]["setupCatalog.js"]["rows"] if r["external_name"] != LIBRARY_SETUP]}}}
    monkeypatch.setattr(vocab, "load_vocabulary", lambda: moved)
    assert LIBRARY_SETUP not in modelbook.archive_links()


# ── 3. the price-age gate ────────────────────────────────────────────────────

def _sessions_after(start: date, n: int) -> date:
    from api.services.wisdom.core import timeutil

    cur, seen = start, 0
    while seen < n:
        cur += timedelta(days=1)
        if timeutil.is_trading_day(cur):
            seen += 1
    return cur


def test_levels_age_in_only_after_twenty_sessions():
    start = date(2026, 9, 1)
    assert modelbook.price_aged("2026-09-01", today=_sessions_after(start, 21)) is True
    assert modelbook.price_aged("2026-09-01", today=_sessions_after(start, 20)) is False   # the boundary
    assert modelbook.price_aged("2026-09-01T15:30:00", today=_sessions_after(start, 3)) is False
    assert modelbook.price_aged("2024-01-02", today=start) is True
    for unknown in (None, "", "not a date", "2026-13-01"):
        assert modelbook.price_aged(unknown, today=start) is False                     # doubt withholds


# ── 2. the archive flag ──────────────────────────────────────────────────────

def test_the_archive_is_not_read_while_its_flag_is_off(seeded, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    _seed_archive()
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    with store.read() as conn:
        assert modelbook.build_archive_example_drafts(conn) == []
        playbooks = {d["payload"]["setup_name"]: d for d in modelbook.build_playbook_drafts(conn)}
    labels = [s["label"] for s in playbooks[LIBRARY_SETUP]["payload"]["sections"]]
    assert not [x for x in labels if "trader archive" in x], labels
    # control: the same store with the flag on does carry it
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    with store.read() as conn:
        assert modelbook.build_archive_example_drafts(conn)


# ── 3-4. examples ────────────────────────────────────────────────────────────

def test_examples_carry_the_best_call_and_the_labelled_failure_with_aged_levels_only(archive_on):
    with store.read() as conn:
        examples = {d["payload"]["call_id"]: d for d in modelbook.build_archive_example_drafts(conn)
                    if d["payload"]["setup_name"] == LIBRARY_SETUP}
    best, fail = examples["t9201#0"]["payload"], examples["t9202#0"]["payload"]
    assert best["archive_side"] == "best" and fail["archive_side"] == "failure"
    assert (best["entry_price"], best["stop_price"], best["target_price"]) == (10.0, 9.0, 14.0)
    assert best["levels_withheld"] is False and (best["year"], best["label_date"]) == (2025, "2025-01-02")
    # posted two days ago: the levels are withheld, the example is not
    assert (fail["entry_price"], fail["stop_price"], fail["target_price"]) == (None, None, None)
    assert fail["levels_withheld"] is True and fail["symbol"] == "ZZKF"
    assert fail["notes"].startswith("FAILURE of the archive's") and "t9202" in fail["notes"]
    assert best["notes"].startswith("Best call of the archive's") and "r20 +18.0%" in best["notes"]
    assert examples["t9201#0"]["subject_ref"] == f"wisdom_archive_calls:t9201#0:{LIBRARY_SETUP}"
    assert examples["t9201#0"]["provisional"] is True


# ── 6. playbooks ─────────────────────────────────────────────────────────────

def _archive_sections(setup):
    with store.read() as conn:
        pb = {d["payload"]["setup_name"]: d for d in modelbook.build_playbook_drafts(conn)}[setup]
    return pb, {s["label"]: s["items"] for s in pb["payload"]["sections"] if "trader archive" in s["label"]}


def test_a_missing_playbook_gains_the_measured_record_teachings_and_calls(archive_on):
    assert LIBRARY_SETUP in modelbook.missing_playbooks()
    pb, sections = _archive_sections(LIBRARY_SETUP)
    [measured] = sections["Measured record (trader archive)"]
    assert measured["text"].startswith("Kicker candle / gap over the MAs: 140 scored calls")
    assert "edge not proven (z 1.4)" in measured["text"]
    assert "strongest context market = downtrend (edge R +0.90, n 40)" in measured["text"]   # n<30 cut excluded
    assert [t["locator"] for t in sections["In the traders' words (trader archive)"]] == ["t9203"]
    assert {c["status"] for c in sections["Calls worth charting (trader archive)"]} == {"best", "failure"}
    assert pb["payload"]["state"] == "draft"
    assert {"wisdom_archive_setups:kicker", "t9203"} <= set(pb["citations"])


def test_the_verdict_says_measured_only_at_the_z_bar(seeded, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    _seed_archive(z=3.4)
    _, sections = _archive_sections(LIBRARY_SETUP)
    assert "measured edge (z 3.4)" in sections["Measured record (trader archive)"][0]["text"]


# ── 5. drafts, never publication ─────────────────────────────────────────────

def test_daily_writes_archive_drafts_only_with_the_flag_and_publishes_nothing(archive_on, monkeypatch):
    created = []
    monkeypatch.setattr(modelbook_service, "create_setup_example", lambda p: created.append(p) or {"id": 9})
    monkeypatch.delenv("WISDOM_MODELBOOK_DRAFTS_ENABLED", raising=False)
    off = modelbook.daily(_ctx())
    assert off["archive_example_drafts"] >= 2 and _drafts("modelbook_example") == []
    monkeypatch.setenv("WISDOM_MODELBOOK_DRAFTS_ENABLED", "1")
    on = modelbook.daily(_ctx())
    refs = {d["subject_ref"] for d in _drafts("modelbook_example")}
    assert f"wisdom_archive_calls:t9201#0:{LIBRARY_SETUP}" in refs and on["archive_example_drafts"] >= 2
    assert created == []                                                  # a draft is not a publication
    # the owner's approval is the one door, and it carries the withheld levels as withheld
    draft = next(d for d in _drafts("modelbook_example")
                 if d["subject_ref"] == f"wisdom_archive_calls:t9202#0:{LIBRARY_SETUP}")
    out = drafts.decide(draft["draft_id"], decision="approve", actor="owner@test")
    assert out["status"] == "published" and len(created) == 1
    assert created[0]["setup_name"] == LIBRARY_SETUP and created[0]["entry_price"] is None
    assert created[0]["notes"].startswith("FAILURE")
