"""Seed data + store rails for the dark publish adapters (stream S-F).

Other adapter test modules import `adapters_db`, `seed_basic` and the `add_*`
helpers from here. Everything is synthetic: no transcript text, no member data.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an adapter migration whose name the registry would refuse (wrong prefix).
2. a migration that does not create its table, or is not idempotent.
3. S-F1's code landed but `publish/schema.py` does not append these migrations —
   the registry would never create the adapters' tables in production.
"""
from __future__ import annotations

import importlib.util
import json

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import ids, store
from api.services.wisdom.publish.adapters import schema as adapters_schema

T0 = "2026-09-08T10:05:00-04:00"


def apply_adapter_migrations() -> list[str]:
    """store.init_db() plus this stream's migrations (until S-F1 appends them)."""
    applied = store.init_db()
    with store.write() as conn:
        done = {r[0] for r in conn.execute("SELECT name FROM wisdom_migrations")}
    for name, sql in adapters_schema.MIGRATIONS:
        if name in done:
            continue
        with store.WRITE_LOCK:
            conn = store.connect()
            try:
                conn.executescript(sql)
                conn.execute("INSERT INTO wisdom_migrations(name, applied_at) VALUES (?, ?)", (name, T0))
                conn.commit()
                applied.append(name)
            finally:
                conn.close()
    return applied


@pytest.fixture
def adapters_db(tmp_path, monkeypatch):
    path = tmp_path / "wisdom.db"
    monkeypatch.setenv("WISDOM_DB_PATH", str(path))
    for env in ("WISDOM_INGEST_ENABLED", "WISDOM_RETRIEVAL_INDEX_ENABLED", "ASKAI_WISDOM_RETRIEVAL_ENABLED",
                "WISDOM_DESK_MARKERS_ENABLED", "WISDOM_BADGES_ENABLED", "WISDOM_DOSSIER_ENABLED",
                "WISDOM_BRAINKB_PUBLISH_ENABLED", "WISDOM_PV_EXAMPLES_ENABLED", "WISDOM_MODELBOOK_DRAFTS_ENABLED",
                "WISDOM_VOICE_PROFILE_ENABLED", "WISDOM_LEVEL_ALERTS_ENABLED", "WISDOM_LOOKALIKE_ENABLED"):
        monkeypatch.delenv(env, raising=False)
    apply_adapter_migrations()
    return path


# ── seed helpers ─────────────────────────────────────────────────────────────

def add_source(conn, source_id, stream, external_ref, **kw):
    row = dict(source_id=source_id, stream=stream, external_ref=external_ref, version=1,
               raw_sha256=ids.sha256_text(source_id), ingest_version="test-v0", ingested_at=T0)
    row.update(kw)
    cols = ", ".join(row)
    conn.execute(f"INSERT INTO wisdom_sources({cols}) VALUES ({', '.join('?' * len(row))})", list(row.values()))


def add_segment(conn, segment_id, source_id, ordinal, text, author_id, **kw):
    row = dict(segment_id=segment_id, source_id=source_id, source_version=1, ordinal=ordinal,
               kind=kw.pop("kind", "cue_window"), text=text, text_sha256=ids.sha256_text(text),
               author_id=author_id, normalizer_version="test-v0")
    row.update(kw)
    cols = ", ".join(row)
    conn.execute(f"INSERT INTO wisdom_segments({cols}) VALUES ({', '.join('?' * len(row))})", list(row.values()))


def add_record(conn, record_id, record_type, segment_id, source_id, **kw):
    row = dict(record_id=record_id, record_type=record_type, segment_id=segment_id, source_id=source_id,
               source_version=1, extractor_version="test-x0", record_hash=ids.sha256_text(record_id),
               extraction_confidence="high", status="provisional", created_at=T0, stated_at_et=T0)
    row.update(kw)
    for key in ("targets_json", "levels_json", "tickers_json", "confidence_language_json"):
        if key in row and not isinstance(row[key], str):
            row[key] = json.dumps(row[key])
    cols = ", ".join(row)
    conn.execute(f"INSERT INTO wisdom_records({cols}) VALUES ({', '.join('?' * len(row))})", list(row.values()))


#: ⛔⛔ R89 (2026-09-17) put CALL, NEGATIVE_CALL and MENTION under the publication floor, which
#: fails closed on a NULL stability — so a seed record of one of those types with no score is
#: WITHHELD from every consumer, and this corpus would have gone silently empty at nine call
#: sites at once. The corpus stands for records that HAVE been stability-voted and passed, so it
#: carries the score explicitly.
#:
#: ⭐ It is spread onto the guest and rejected records too, deliberately. Without it,
#: `test_guests_rejected_and_negative_calls_are_not_markers` would still pass — for the WRONG
#: REASON, because the floor would be excluding them before the guest and status filters ever
#: ran, and deleting those filters would leave the suite green
#: (`lesson_a_guard_that_tests_the_adjacent_thing`).
#:
#: ⛔ recPRIN keeps a NULL stability ON PURPOSE: several floor tests rely on the corpus carrying
#: one genuinely-blocked PRINCIPLE, and say so in their own comments.
PASSES_FLOOR = {"stability": 1.0, "stability_runs": 3}


def seed_basic(conn) -> dict:
    """A small corpus: a TSDR live session, a Sunday Scans issue, a guest workshop,
    a Bracco Discord message, one attendee cue. Every string is synthetic."""
    add_source(conn, "srcLIVE", "zoom_live", "edu_videos:42", media_pointer="ytLIVE42",
               title="Live Trading Sessions — Sep 8, 2026", host_author_id="tsdr",
               recording_started_at_et="2026-09-08T09:30:00-04:00", published_at_et="2026-09-08T16:10:00-04:00")
    add_source(conn, "srcSCAN", "sunday_scans", "substack:https://example.test/p/scan-0906",
               title="Sunday Scans 9/6", published_at_et="2026-09-06T10:00:00-04:00")
    add_source(conn, "srcWORK", "workshop", "edu_videos:77", media_pointer="ytWORK77",
               title="Guest workshop", recording_started_at_et="2026-09-10T19:00:00-04:00")
    add_source(conn, "srcDISC", "discord", "discord:427:9001", title="#bracco",
               published_at_et="2026-09-10T12:00:00-04:00")

    add_segment(conn, "segLIVE1", "srcLIVE", 1, "Synthetic cue: flat base on the daily, watching the pivot for "
                "volume confirmation.", "tsdr", t_start_s=120.0, t_end_s=180.0)
    add_segment(conn, "segLIVE2", "srcLIVE", 2, "Synthetic attendee question about sizing.", None,
                t_start_s=200.0, t_end_s=210.0)
    add_segment(conn, "segSCAN1", "srcSCAN", 1, "Synthetic section: never add to a losing position, cut it "
                "quickly and move on.", "tsdr", kind="section", path="TSDR's Weekly Outlook & Watchlist > NVDA (Daily)")
    add_segment(conn, "segWORK1", "srcWORK", 1, "Synthetic guest cue: momentum bursts come in clusters.",
                "guest:stockbee", t_start_s=60.0)
    add_segment(conn, "segDISC1", "srcDISC", 1, "Synthetic message: passing on AMD, relative strength is weak.",
                "bracco", kind="message")

    # open CALL: levels present, NO entry (open-position entry lives only in the private store)
    add_record(conn, "recCALL_OPEN", "CALL", "segLIVE1", "srcLIVE", author_id="tsdr", ticker="NVDA",
               direction="long", stance="watching", vocab_id="v_flat_base", setup_name_raw="flat base",
               trigger_text="break over the pivot on volume", thesis="tight base under the highs",
               entry_zone_lo=140.25, entry_zone_hi=142.75, stop=131.5,
               targets_json=[{"price": 160.0, "text": "measured move"}],
               levels_json=[{"type": "breakout", "price": 142.75, "price_as_heard": "142"}],
               stated_at_et="2026-09-08T10:05:00-04:00", **PASSES_FLOOR)
    # closed / hindsight CALL (a teaching example with a stated outcome)
    add_record(conn, "recCALL_DONE", "CALL", "segSCAN1", "srcSCAN", author_id="tsdr", ticker="NVDA",
               direction="long", stance="hindsight", hindsight=1, vocab_id="v_ep",
               setup_name_raw="episodic pivot", thesis="the gap held and the base resolved higher",
               stated_outcome="profit", entry=100.0, stop=95.0, targets_json=[{"price": 120.0, "text": "prior high"}],
               status="confirmed", stated_at_et="2026-09-06T10:00:00-04:00", **PASSES_FLOOR)
    add_record(conn, "recPRIN", "PRINCIPLE", "segSCAN1", "srcSCAN", author_id="tsdr",
               principle_key="never_add_to_loser", status="confirmed", stated_at_et="2026-09-06T10:00:00-04:00")
    add_record(conn, "recNEG", "NEGATIVE_CALL", "segDISC1", "srcDISC", author_id="bracco", ticker="AMD",
               direction="long", stance="passed", reason="relative strength is weak", reason_class="chart",
               stated_at_et="2026-09-10T12:00:00-04:00", **PASSES_FLOOR)
    add_record(conn, "recGUEST", "MENTION", "segWORK1", "srcWORK", author_id="guest:stockbee", is_guest=1,
               ticker="TSLA", stated_at_et="2026-09-10T19:05:00-04:00", **PASSES_FLOOR)
    add_record(conn, "recREJECT", "MENTION", "segLIVE1", "srcLIVE", author_id="tsdr", ticker="AMD",
               stance="no_view", status="rejected", stated_at_et="2026-09-08T10:06:00-04:00", **PASSES_FLOOR)

    conn.execute("INSERT INTO wisdom_principles(principle_key, statement, category, author_id, status, "
                 "first_seen_at) VALUES ('never_add_to_loser', 'Never add to a losing position; cut it quickly.', "
                 "'risk', 'tsdr', 'confirmed', '2026-09-06T10:00:00-04:00')")
    conn.execute("INSERT INTO wisdom_principles(principle_key, statement, category, author_id, is_guest, status) "
                 "VALUES ('guest_bursts', 'Momentum bursts cluster.', 'setup', 'guest:stockbee', 1, 'provisional')")
    conn.execute("INSERT INTO wisdom_principles(principle_key, statement, category, author_id, canonical, status) "
                 "VALUES ('noncanonical_ema', 'Hold the 20EMA only.', 'setup', 'tsdr', 0, 'provisional')")
    conn.execute("INSERT INTO wisdom_principle_support(principle_key, record_id, relation) "
                 "VALUES ('never_add_to_loser', 'recPRIN', 'states')")

    for vid, name in (("v_flat_base", "Flat Base Breakout"), ("v_ep", "Episodic Pivot")):
        conn.execute("INSERT INTO wisdom_vocab(vocab_id, name, kind, status, version) VALUES (?, ?, 'setup', "
                     "'approved', 'v0')", (vid, name))
    for list_name, external, vid in (("setupCatalog.js", "Flat Base Breakout", "v_flat_base"),
                                      ("setupCatalog.js", "Episodic Pivot", "v_ep"),
                                      ("pv_FOCUSED_SETUPS", "flat_base", "v_flat_base"),
                                      ("pv_FOCUSED_SETUPS", "episodic_pivot", "v_ep")):
        conn.execute("INSERT INTO wisdom_vocab_maps(list_name, external_name, vocab_id) VALUES (?, ?, ?)",
                     (list_name, external, vid))

    conn.execute("INSERT INTO wisdom_chart_images(image_id, source_id, segment_id, origin, public_url, r2_key, "
                 "label_text, label_ticker, label_timeframe, linked_record_id, status, created_at) VALUES "
                 "('img1', 'srcSCAN', 'segSCAN1', 'sunday_scans', 'https://example.test/img1.png', "
                 "'wisdom/sources/sunday_scans_chart/img1.png', 'NVDA (Daily)', 'NVDA', 'D', 'recCALL_DONE', "
                 "'provisional', ?)", (T0,))
    conn.execute("INSERT INTO wisdom_outcomes(record_id, methodology_version, ret_10, stop_hit, target_hit, "
                 "reconciliation, n_sessions_available, computed_at) VALUES ('recCALL_DONE', 'm0', 0.12, 0, 1, "
                 "'agrees', 20, ?)", (T0,))
    return {"sources": 4, "records": 6}


@pytest.fixture
def seeded(adapters_db):
    with store.write() as conn:
        seed_basic(conn)
    return adapters_db


# ── rails ────────────────────────────────────────────────────────────────────

def test_adapter_migrations_are_prefixed_for_the_registry_and_create_their_tables(adapters_db):
    names = [n for n, _ in adapters_schema.MIGRATIONS]
    assert names and all(n.startswith("publish_adapters_") for n in names)
    # the registry's own admission rule is "<pkg>_" — publish_
    assert all(n.startswith("publish_") for n in names)
    with store.read() as conn:
        have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table')")}
        applied = {r[0] for r in conn.execute("SELECT name FROM wisdom_migrations")}
    for table in ("wisdom_drafts", "wisdom_kb_rows", "wisdom_level_crosses", "wisdom_lookalike_scores",
                  "wisdom_d20_scoring_runs", "wisdom_retrieval_docs", "wisdom_segments_fts"):
        assert table in have, table
    assert set(names) <= applied
    # control: the base contract table the adapters read is there too
    assert "wisdom_publish_log" in have
    assert apply_adapter_migrations() == []  # idempotent


def test_seed_is_accepted_by_the_contract_ddl(seeded):
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_records").fetchone()[0] == 6
        assert conn.execute("SELECT COUNT(*) FROM wisdom_segments").fetchone()[0] == 5


def test_s_f1_publish_schema_appends_the_adapter_migrations_once_integrated():
    if importlib.util.find_spec("api.services.wisdom.publish.review") is None:
        pytest.skip("S-F1 (publish/review.py) is not in this tree yet; the append is integration work")
    registered = {name for name, _ in registry.schema_migrations()}
    missing = [n for n, _ in adapters_schema.MIGRATIONS if n not in registered]
    assert not missing, (
        "api/services/wisdom/publish/schema.py must end its MIGRATIONS with "
        f"`+ adapters.schema.MIGRATIONS`; the registry would never create {missing}")
