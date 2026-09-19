"""Writer rails (stream S-D): the labeling rules the code enforces, and D16a.

Synthetic text only (this repository is public); tickers are invented four-letter
symbols so nothing here names a real call.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a record kept whose quote is absent from, or repeated in, its segment;
2. R1 / R3 / R4 / D14 / §2.1 / W1 §4.2 not enforced (CALL without direction or
   trigger, "next pullback", no-view as a pass, a guest CALL, a non-author CALL, a
   CALL with no resolved entity);
3. a share count or an open-position entry reaching any structured wisdom.db table —
   including through record_hash;
4. a second write duplicating a record, an overlapping window storing it twice, an
   older version deleted instead of superseded;
5. provenance spans that do not point at the quote.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.extract import prompt, seams, segmenter, writer

TEXT = ("ZZZT (Daily)\n"
        "Bought ZZZT at 10.50 today and the stop is 9.80. Watching QQQX on the next pullback. "
        "Passed on YYYT, too thin. No thoughts on WWWT at all. Your stop is your north star. "
        "Have 4321 shares of VVVT at 987.65 still open. Closed UUUT at 20 from 15. "
        "Watching TTTT over 55 for a breakout.\n")
VOCAB = {"Range Breakout"}
SOURCE = {"source_id": "src1", "stream": "sunday_scans", "published_at_et": "2026-09-06T08:00:00-04:00",
          "host_author_id": "tsdr", "guest_names_json": "[]"}


def RESOLVER(ticker, as_of):
    return {"entity_id": f"ent:{ticker}", "confidence": 0.9}


def make(**kw):
    rec = {name: None for name in prompt.record_fields()}
    rec.update({"tickers": [], "targets": [], "levels": [], "confidence_language": [], "hindsight": False,
                "extraction_confidence": "high"})
    rec.update(kw)
    return rec


def section(text=TEXT, ordinal=0, author="tsdr"):
    seg = segmenter.Segment(ordinal=ordinal, kind="section", text=text, char_start=0, char_end=len(text),
                            path="TSDR's Weekly Outlook & Watchlist", author_id=author, speaker_confidence="high")
    row = seg.to_row("src1", 1)
    return seg, row


def validate(records, *, segment=None, source=SOURCE, resolver=RESOLVER):
    seg = segment or section()[1]
    return writer.validate_output({"segment_id": seg["segment_id"], "records": records}, segment=seg,
                                  source=source, resolver=resolver, vocab_names=VOCAB)


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "published_at_et, host_author_id, ingest_version, ingested_at) VALUES "
                     "('src1', 'sunday_scans', 'test:1', 1, 'x', '2026-09-06T08:00:00-04:00', 'tsdr', 't', 't')")
        seg, _ = section()
        seg2, _ = section(ordinal=1)
        segmenter.write_segments(conn, "src1", 1, [seg, seg2])
    return tmp_path / "wisdom.db"


def _loaded(ordinal=0):
    with store.read() as conn:
        seg = writer.load_segment(conn, segmenter.Segment(ordinal=ordinal, kind="section", text="", char_start=0,
                                                          char_end=0).segment_id("src1", 1))
        src = writer.load_source(conn, "src1", 1)
    return seg, src


# ── 1. quotes ────────────────────────────────────────────────────────────────

def _rec(**kw):
    rec = {name: None for name in prompt.record_fields()}
    rec.update({"tickers": [], "targets": [], "levels": [], "confidence_language": [], "hindsight": False,
                "extraction_confidence": "high"})
    rec.update(kw)
    return rec


def test_an_empty_string_is_null_wherever_the_contract_allows_null():
    text = "PPPT holds support at 101.50 today. Rule of the week: cut losers fast."
    seg = {"segment_id": "s-empty", "kind": "section", "text": text, "author_id": "tsdr", "speaker_confidence": "high"}
    level = _rec(record_type="LEVEL", quote="PPPT holds support at 101.50 today.", ticker_as_written="PPPT",
                 speaker_label="", setup_vocab="", trigger="", stop_text=" ", notes="",
                 levels=[{"type": "support", "price": 101.5, "price_as_heard": ""}])
    rule = _rec(record_type="PRINCIPLE", quote="cut losers fast.", speaker_label="",
                principle={"statement": "cut losers fast", "category": "exit", "empirical_claim": False,
                           "testable_claim": ""})
    validation = writer.validate_output({"records": [level, rule]}, segment=seg, source=SOURCE, resolver=None,
                                        vocab_names=VOCAB)
    lv, pr = validation.kept
    for name in ("speaker_label", "setup_vocab", "trigger", "stop_text", "notes"):
        assert lv.fields[name] is None, name
    assert lv.fields["levels"][0]["price_as_heard"] is None and lv.fields["levels"][0]["price"] == 101.5
    assert pr.fields["principle"]["testable_claim"] is None
    assert validation.counts["setup_vocab_not_in_vocabulary"] == 0
    # control: a real value survives the mapping
    noted = _rec(record_type="LEVEL", quote="PPPT holds support at 101.50 today.", ticker_as_written="PPPT",
                 notes="flag this")
    kept = writer.validate_output({"records": [noted]}, segment=seg, source=SOURCE, resolver=None,
                                  vocab_names=VOCAB).kept
    assert kept[0].fields["notes"] == "flag this"


def test_a_quote_must_occur_exactly_once():
    v = validate([make(record_type="NEGATIVE_CALL", quote="Passed on YYYT, too thin.", ticker_as_written="YYYT",
                       stance="passed", reason_class="liquidity"),
                  make(record_type="MENTION", quote="never said this", ticker_as_written="AAAT"),
                  make(record_type="MENTION", quote="ZZZT", ticker_as_written="ZZZT")])
    assert len(v.kept) == 1 and v.kept[0].record_type == "NEGATIVE_CALL"
    assert v.counts["reject:quote_absent"] == 1 and v.counts["reject:quote_ambiguous"] == 1


# ── 2. labeling rules ────────────────────────────────────────────────────────

def test_R1_a_call_needs_direction_and_a_level_trigger_or_action():
    q = "Bought ZZZT at 10.50 today and the stop is 9.80."
    kept = validate([make(record_type="CALL", quote=q, ticker_as_written="ZZZT", direction="long", stance="taking",
                          entry=10.5, stop=9.8)]).kept
    assert kept[0].record_type == "CALL"
    no_dir = validate([make(record_type="CALL", quote=q, ticker_as_written="ZZZT", entry=10.5)])
    assert no_dir.kept[0].record_type == "MENTION" and no_dir.counts["downgrade:call_without_direction"] == 1
    bare = validate([make(record_type="CALL", quote="Watching TTTT over 55 for a breakout.", ticker_as_written="TTTT",
                          direction="long", stance="watching")])
    assert bare.kept[0].record_type == "MENTION"
    assert bare.counts["downgrade:call_without_level_trigger_or_action"] == 1
    pullback = validate([make(record_type="CALL", quote="Watching QQQX on the next pullback.", ticker_as_written="QQQX",
                              direction="long", stance="watching", trigger="the next pullback")])
    assert pullback.kept[0].record_type == "MENTION" and pullback.counts["downgrade:trigger_not_observable"] == 1
    trigger = validate([make(record_type="CALL", quote="Watching TTTT over 55 for a breakout.", ticker_as_written="TTTT",
                             direction="long", stance="watching", trigger="over 55", levels=[
                                 {"type": "breakout", "price": 55, "price_as_heard": None}])])
    assert trigger.kept[0].record_type == "CALL"


def test_R3_a_no_view_is_never_a_pass_and_a_pass_names_its_ticker():
    v = validate([make(record_type="NEGATIVE_CALL", quote="No thoughts on WWWT at all.", ticker_as_written="WWWT",
                       stance="no_view")])
    assert v.kept[0].record_type == "MENTION" and v.counts["downgrade:no_view_is_never_a_call"] == 1
    v2 = validate([make(record_type="NEGATIVE_CALL", quote="Passed on YYYT, too thin.", stance="passed")])
    assert v2.kept == [] and v2.counts["reject:negative_call_without_ticker"] == 1


def test_W1_4_2_a_call_without_a_resolved_entity_is_a_mention():
    q = "Bought ZZZT at 10.50 today and the stop is 9.80."
    call = dict(record_type="CALL", quote=q, ticker_as_written="ZZZT", direction="long", stance="taking", stop=9.8)
    none_installed = validate([make(**call)], resolver=None)
    assert none_installed.kept[0].record_type == "MENTION"
    assert none_installed.kept[0].pre_entity_type == "CALL"
    assert none_installed.counts["downgrade:call_entity_unresolved:no_resolver"] == 1
    unresolved = validate([make(**call)], resolver=lambda t, a: None)
    assert unresolved.counts["downgrade:call_entity_unresolved"] == 1
    shape = validate([make(**dict(call, ticker_as_written="not a ticker"))], resolver=None)
    assert shape.counts["downgrade:call_entity_unresolved:ticker_shape"] == 1
    resolved = validate([make(**call)])
    assert resolved.kept[0].record_type == "CALL" and resolved.kept[0].entity["entity_id"] == "ent:ZZZT"


def test_D14_a_guest_never_calls_but_keeps_a_principle():
    cues = [{"t": 0, "text": "Jane Guest: Bought ZZZT at 10.50 today and the stop is 9.80."},
            {"t": 5, "text": "Jane Guest: Your stop is your north star."}]
    seg = segmenter.segment_transcript(cues, [])[0].to_row("src2", 1)
    src = dict(SOURCE, stream="interview", guest_names_json=json.dumps(["Jane Guest"]))
    v = validate([make(record_type="CALL", quote="Bought ZZZT at 10.50 today", ticker_as_written="ZZZT",
                       direction="long", stance="taking", entry=10.5, speaker_label="Jane Guest"),
                  make(record_type="PRINCIPLE", quote="Your stop is your north star.", speaker_label="Jane Guest",
                       principle={"statement": "stops first", "category": "risk", "empirical_claim": False,
                                  "testable_claim": None})], segment=seg, source=src)
    by_type = {c.record_type: c for c in v.kept}
    assert set(by_type) == {"MENTION", "PRINCIPLE"}
    assert by_type["MENTION"].is_guest and by_type["PRINCIPLE"].is_guest
    assert by_type["PRINCIPLE"].author_id == "guest:jane-guest"
    assert v.counts["downgrade:guest_authors_mention_or_principle_only"] == 1


def test_S2_1_only_the_four_call_authors_call():
    cues = [{"t": 0, "text": "Ravi: Bought ZZZT at 10.50 today and the stop is 9.80."}]
    seg = segmenter.segment_transcript(cues, [])[0].to_row("src3", 1)
    v = validate([make(record_type="CALL", quote="Bought ZZZT at 10.50 today", ticker_as_written="ZZZT",
                       direction="long", stance="taking", stop=9.8, speaker_label="Ravi")], segment=seg,
                 source=dict(SOURCE, stream="zoom_live"))
    assert v.kept[0].record_type == "MENTION" and v.counts["downgrade:not_a_call_author"] == 1
    tsdr = validate([make(record_type="CALL", quote="Bought ZZZT at 10.50 today", ticker_as_written="ZZZT",
                          direction="long", stance="taking", stop=9.8, speaker_label="Patrick (TSDR)")], segment=seg,
                    source=dict(SOURCE, stream="zoom_live"))
    assert tsdr.kept[0].record_type == "CALL" and tsdr.kept[0].author_id == "tsdr"


def test_R4_hindsight_is_tagged_and_vocab_is_enforced_and_lists_expand():
    v = validate([make(record_type="CALL", quote="Closed UUUT at 20 from 15.", ticker_as_written="UUUT",
                       direction="long", stance="hindsight", entry=15, setup_vocab="Range Breakout"),
                  make(record_type="MENTION", quote="Watching TTTT over 55 for a breakout.",
                       ticker_as_written="TTTT", setup_vocab="Invented Setup", setup_name_raw="breakout")])
    call = next(c for c in v.kept if c.ticker == "UUUT")
    assert call.hindsight and call.fields["hindsight"] is True and v.counts["hindsight_tagged"] == 1
    assert call.fields["entry"] == 15 and not call.private
    mention = next(c for c in v.kept if c.ticker == "TTTT")
    assert mention.fields["setup_vocab"] is None and mention.fields["setup_name_raw"] == "breakout"
    assert v.counts["setup_vocab_not_in_vocabulary"] == 1
    listed = validate([make(record_type="MENTION", quote="Watching TTTT over 55 for a breakout.",
                            tickers=["AAAT", "BBBT", "$aaat"])])
    assert sorted(c.ticker for c in listed.kept) == ["AAAT", "BBBT"]


# ── 3. D16a private fields ───────────────────────────────────────────────────

OPEN = dict(record_type="CALL", quote="Have 4321 shares of VVVT at 987.65 still open.", ticker_as_written="VVVT",
            direction="long", stance="in_it", entry=987.65, size_shares=4321)


def _structured_dump(conn) -> str:
    parts = []
    for table in ("wisdom_records", "wisdom_field_provenance", "wisdom_extract_requests",
                  "wisdom_extract_record_keys", "wisdom_principles", "wisdom_principle_support",
                  "wisdom_review_queue", "wisdom_vocab_candidates"):
        for row in conn.execute(f"SELECT * FROM {table}"):
            parts.append(json.dumps([row[k] for k in row.keys()], default=str))
    return "\n".join(parts)


def test_private_values_split_out_and_never_reach_a_structured_table(db):
    seg, src = _loaded()
    v = validate([make(**OPEN)], segment=seg, source=src)
    ch = v.kept[0]
    assert ch.private == {"size_shares": 4321, "open_entry": 987.65}
    assert ch.fields["entry"] is None and ch.fields["size_shares"] is None
    with store.write() as conn:
        counts = writer.write_output(conn, segment=seg, source=src, output={"records": [make(**OPEN)]},
                                     extractor_version="wx-v0-aaaaaaaa", resolver=RESOLVER, private_put=None,
                                     vocab_names=VOCAB)
    assert counts["private_dropped_no_store:size_shares"] == 1 and counts["private_dropped_no_store:open_entry"] == 1
    with store.read() as conn:
        dump = _structured_dump(conn)
        row = conn.execute("SELECT entry, has_private, record_hash FROM wisdom_records").fetchone()
    assert "4321" not in dump and "987.65" not in dump
    assert row["entry"] is None and row["has_private"] == 0
    # the stored hash is over the REDACTED record: it cannot be brute-forced back to a size
    redacted = dict(ch.fields)
    assert writer._canonical_hash(redacted, "CALL") == row["record_hash"]
    assert writer._canonical_hash(dict(redacted, size_shares=4321), "CALL") != row["record_hash"]


def test_private_values_go_to_the_private_store_when_it_accepts(db):
    seg, src = _loaded()
    stored = []
    with store.write() as conn:
        writer.write_output(conn, segment=seg, source=src, output={"records": [make(**OPEN)]},
                            extractor_version="wx-v0-aaaaaaaa", resolver=RESOLVER, vocab_names=VOCAB,
                            private_put=lambda rid, f, val, loc: stored.append((f, val)) or True)
    assert sorted(stored) == [("open_entry", 987.65), ("size_shares", 4321)]
    with store.read() as conn:
        assert conn.execute("SELECT has_private FROM wisdom_records").fetchone()[0] == 1
        assert "987.65" not in _structured_dump(conn)


# ── 4. idempotency, overlap, supersede ───────────────────────────────────────

CLEAN = dict(record_type="NEGATIVE_CALL", quote="Passed on YYYT, too thin.", ticker_as_written="YYYT", stance="passed",
             reason="too thin", reason_class="liquidity")


def test_writing_twice_and_through_an_overlapping_window_stores_one_record(db):
    seg0, src = _loaded(0)
    seg1, _ = _loaded(1)
    out = {"records": [make(**CLEAN)]}
    with store.write() as conn:
        first = writer.write_output(conn, segment=seg0, source=src, output=out, extractor_version="wx-v0-aaaaaaaa",
                                    resolver=RESOLVER, vocab_names=VOCAB)
        again = writer.write_output(conn, segment=seg0, source=src, output=out, extractor_version="wx-v0-aaaaaaaa",
                                    resolver=RESOLVER, vocab_names=VOCAB)
        overlap = writer.write_output(conn, segment=seg1, source=src, output=out, extractor_version="wx-v0-aaaaaaaa",
                                      resolver=RESOLVER, vocab_names=VOCAB)
    assert first["written"] == 1 and again["already_written"] == 1 and overlap["dedupe_overlapping_window"] == 1
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_records").fetchone()[0] == 1


def test_the_SAME_quote_from_a_NON_adjacent_segment_is_a_distinct_occurrence(db):
    """⛔⛔ BUG FOUND 2026-09-19 (adversarial review, session 28 part 3): the overlap key
    (source, source_version, extractor_version, record_type, ticker, normalized quote) carries
    NO segment/position information, so it could not distinguish "the same statement read through
    two OVERLAPPING windows" (the documented intent -- module docstring) from "the identical
    short phrase spoken again later, in a genuinely separate, non-overlapping segment" -- and
    silently dropped the second, real, distinct occurrence with no row and no review item.

    segmenter.py's windows only overlap their IMMEDIATE neighbour, so ordinal adjacency
    (`abs(diff) <= 1`) is the correct proxy. Segment ordinal 5 here is nowhere near segment 0's
    overlap window -- the SAME wording said again, hours later, must be written as its own record."""
    with store.write() as conn:
        far_seg = segmenter.Segment(ordinal=5, kind="section", text=TEXT, char_start=0, char_end=len(TEXT),
                                    path="TSDR's Weekly Outlook & Watchlist", author_id="tsdr",
                                    speaker_confidence="high")
        segmenter.write_segments(conn, "src1", 1, [far_seg])
    seg0, src = _loaded(0)
    seg_far, _ = _loaded(5)
    out = {"records": [make(**CLEAN)]}
    with store.write() as conn:
        first = writer.write_output(conn, segment=seg0, source=src, output=out, extractor_version="wx-v0-aaaaaaaa",
                                    resolver=RESOLVER, vocab_names=VOCAB)
        later = writer.write_output(conn, segment=seg_far, source=src, output=out, extractor_version="wx-v0-aaaaaaaa",
                                    resolver=RESOLVER, vocab_names=VOCAB)
    assert first["written"] == 1
    assert later["written"] == 1, (
        f"the non-adjacent occurrence was dropped instead of written: {later}")
    assert later.get("dedupe_overlapping_window", 0) == 0
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_records").fetchone()[0] == 2, (
            "both occurrences are real, distinct records and must both be stored")


def test_a_new_extractor_version_supersedes_provisional_records_and_never_deletes(db):
    seg, src = _loaded()
    out = {"records": [make(**CLEAN), make(record_type="MENTION", quote="No thoughts on WWWT at all.",
                                           ticker_as_written="WWWT", stance="no_view")]}
    with store.write() as conn:
        writer.write_output(conn, segment=seg, source=src, output=out, extractor_version="wx-v0-aaaaaaaa",
                            resolver=RESOLVER, vocab_names=VOCAB)
        conn.execute("UPDATE wisdom_records SET status = 'confirmed' WHERE ticker = 'WWWT'")
        writer.write_output(conn, segment=seg, source=src, output={"records": [make(**CLEAN)]},
                            extractor_version="wx-v0-bbbbbbbb", resolver=RESOLVER, vocab_names=VOCAB)
    with store.read() as conn:
        rows = {(r["extractor_version"], r["ticker"]): dict(r) for r in conn.execute("SELECT * FROM wisdom_records")}
    assert len(rows) == 3
    old = rows[("wx-v0-aaaaaaaa", "YYYT")]
    assert old["status"] == "superseded" and old["superseded_by"] == rows[("wx-v0-bbbbbbbb", "YYYT")]["record_id"]
    assert rows[("wx-v0-aaaaaaaa", "WWWT")]["status"] == "confirmed"


# ── 5. provenance, time, principles, candidates ──────────────────────────────

def test_provenance_points_at_the_quote_and_the_cue_time(db):
    cues = [{"t": 0, "text": "Patrick (TSDR): good morning everyone."},
            {"t": 120, "text": "Patrick (TSDR): Passed on YYYT, too thin."}]
    seg_obj = segmenter.segment_transcript(cues, [])[0]
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "recording_started_at_et, ingest_version, ingested_at) VALUES ('src9', 'zoom_live', 'test:9', 1, "
                     "'x', '2026-09-11T08:51:59-04:00', 't', 't')")
        segmenter.write_segments(conn, "src9", 1, [seg_obj])
    with store.read() as conn:
        seg = writer.load_segment(conn, seg_obj.segment_id("src9", 1))
        src = writer.load_source(conn, "src9", 1)
    with store.write() as conn:
        writer.write_output(conn, segment=seg, source=src, output={"records": [make(**CLEAN)]},
                            extractor_version="wx-v0-aaaaaaaa", resolver=RESOLVER, vocab_names=VOCAB)
    with store.read() as conn:
        prov = {r["field"]: dict(r) for r in conn.execute("SELECT * FROM wisdom_field_provenance")}
        rec = conn.execute("SELECT stated_at_et, stated_at_precision FROM wisdom_records").fetchone()
    q = prov["quote"]
    assert seg["text"][q["char_start"]:q["char_end"]] == CLEAN["quote"]
    t = prov["ticker_as_written"]
    assert seg["text"][t["char_start"]:t["char_end"]] == "YYYT"
    assert q["t_start_s"] == 120
    assert rec["stated_at_et"] == "2026-09-11T08:53:59-04:00" and rec["stated_at_precision"] == "minute"


def test_a_repeated_principle_reinforces_instead_of_duplicating(db):
    seg0, src = _loaded(0)
    seg1, _ = _loaded(1)
    p = make(record_type="PRINCIPLE", quote="Your stop is your north star.",
             principle={"statement": "Stops come first.", "category": "risk", "empirical_claim": False,
                        "testable_claim": None})
    with store.write() as conn:
        writer.write_output(conn, segment=seg0, source=src, output={"records": [p]}, extractor_version="v-a",
                            resolver=RESOLVER, vocab_names=VOCAB)
        writer.write_output(conn, segment=seg1, source=src, output={"records": [p]}, extractor_version="v-b",
                            resolver=RESOLVER, vocab_names=VOCAB)
    with store.read() as conn:
        assert conn.execute("SELECT times_reinforced FROM wisdom_principles").fetchone()[0] == 1
        assert sorted(r[0] for r in conn.execute("SELECT relation FROM wisdom_principle_support")) == [
            "reinforces", "states"]


VOCAB_SEAM = ("api.services.wisdom.core.vocab", "record_candidate")


def _seam_is(monkeypatch, fn):
    real = seams.seam
    monkeypatch.setattr(seams, "seam", lambda m, a: fn if (m, a) == VOCAB_SEAM else real(m, a))


def test_new_setup_names_go_to_core_vocab_when_it_exists(db, monkeypatch):
    seg, src = _loaded()
    rec = make(record_type="MENTION", quote="Watching TTTT over 55 for a breakout.", ticker_as_written="TTTT",
               setup_name_raw="fresh coinage")
    _seam_is(monkeypatch, None)
    with store.write() as conn:
        counts = writer.write_output(conn, segment=seg, source=src, output={"records": [rec]},
                                     extractor_version="v-a", resolver=RESOLVER, vocab_names=VOCAB)
    assert counts["vocab_candidate_pending_no_store"] == 1
    calls = []
    _seam_is(monkeypatch, lambda name, **kw: calls.append(name))
    with store.write() as conn:
        counts = writer.write_output(conn, segment=seg, source=src, output={"records": [rec]},
                                     extractor_version="v-b", resolver=RESOLVER, vocab_names=VOCAB)
    assert calls == ["fresh coinage"] and counts["vocab_candidate_recorded"] == 1


def test_the_writer_completes_inside_the_callers_transaction_with_the_REAL_seams(db):
    """⛔⛔ REGRESSION RAIL FOR A PROCESS DEADLOCK, and it can only fail by HANGING.

    Every other test here injects a fake resolver and a fake vocab store, so none of
    them ever touches the live core seams. Both of those open their OWN `store.write()`
    (entities -> aliases.seed, vocab -> ensure_seeded), and write_output runs inside the
    caller's transaction — which is exactly what batch.handle_result does in production.
    Before store.write() learned to JOIN a transaction the same thread already holds,
    this hung forever: no exception, no red test, just pytest-timeout killing the whole
    process and taking the run's totals line with it.

    It is deliberately given nothing to stub. If it stops completing, the writer can no
    longer run in production at all."""
    seg, src = _loaded()
    rec = make(record_type="MENTION", quote="Watching TTTT over 55 for a breakout.", ticker_as_written="TTTT",
               setup_name_raw="fresh coinage")
    assert seams.seam(*VOCAB_SEAM) is not None, "core.vocab is absent — this rail proves nothing"
    assert seams.seam("api.services.wisdom.core.entities", "resolve") is not None
    with store.write() as conn:
        counts = writer.write_output(conn, segment=seg, source=src, output={"records": [rec]},
                                     extractor_version="v-c", vocab_names=VOCAB)
    assert counts["written"] == 1
    assert counts.get("vocab_candidate_recorded") == 1, counts
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_vocab_candidate_uses").fetchone()[0] == 1


# ── reviewer fixes, 2026-09-14 ───────────────────────────────────────────────

def _src(guests):
    return {"source_id": "s", "stream": "zoom_live", "host_author_id": "tsdr",
            "guest_names_json": json.dumps(guests)}


def test_a_speaker_label_is_matched_to_a_guest_only_on_whole_words():
    """⛔ §8a.3: unattributable speech in a guest session is `unresolved` — never the
    guest's. The guest branch matched on a bare `startswith` in EITHER direction, so the
    label 'P' resolved to `guest:patricia-kim` with confidence 'medium', and D14 then let
    that "guest" author MENTION and PRINCIPLE rows. authors.json's own readme says
    matching is exact, no fuzzy matching. Third sighting of this class (drift #3, drift
    #4, S-C's guest minting)."""
    src, seg = _src(["Patricia Kim"]), {"speaker_label": None}
    for label in ("P", "Pat", "patr", "Patricia Kimble", "Patrick"):
        assert writer.resolve_author(label, seg, src) == (None, False, "low"), label
    # ...and the cases the prefix rule was actually there for still resolve:
    for label in ("Patricia Kim", "patricia kim (Guest)", "Patricia", "PATRICIA KIM"):
        assert writer.resolve_author(label, seg, src) == ("guest:patricia-kim", True, "medium"), label
    one = _src(["Qullamaggie"])
    assert writer.resolve_author("Qullamaggie (Guest)", seg, one) == ("guest:qullamaggie", True, "medium")
    for label in ("Q", "Qu", "Qullamaggies"):
        assert writer.resolve_author(label, seg, one) == (None, False, "low"), label


def test_an_unmapped_label_never_invents_anybody(db):
    """The owner's checklist item 1, at the writer's own resolver: unmapped means
    `unresolved`, never a new person and never the host."""
    seg = {"speaker_label": None}
    for label in ("Somebody Nobody Declared", "zz", "Uncharted Territory"):
        author, is_guest, _ = writer.resolve_author(label, seg, _src([]))
        assert author is None and is_guest is False, (label, author)


def test_the_private_store_seam_is_declared_by_its_owner_and_still_reported():
    """⛔ W1 §0.4d: only core/private.py, extract/writer.py and api/routers/wisdom_core.py
    may reach the owner-private store. `seams.SEAMS` is PROBED with importlib, so a row
    there IS a reach — and `tests/test_wisdom_bans.py::...[private_store]` was RED on this
    branch because of it. The row moved to its owner rather than being renamed to dodge
    the rail, and it must still appear in the report or the move lost a reading."""
    from api.services.wisdom.core import bans

    seams_file = pathlib.Path(seams.__file__)
    rel = "api/services/wisdom/extract/seams.py"
    found = bans.scan_source(rel, seams_file.read_text(encoding="utf-8"), ("private_store",))
    assert found == [], [v.render() for v in found]
    # CONTROL: the scanner CAN see this file — put the row back and it fires by name.
    planted = seams_file.read_text(encoding="utf-8").replace(
        'SEAMS: tuple[tuple[str, str, str], ...] = (',
        'SEAMS: tuple[tuple[str, str, str], ...] = (\n    ("api.services.wisdom.core.private", "put_private", "x"),', 1)
    assert [v.rail for v in bans.scan_source(rel, planted, ("private_store",))] == ["private_store"]
    row = writer.private_seam_row()
    assert row["module"] == "api.services.wisdom.core.private" and row["attr"] == "put_private"
    report = {(r["module"], r["attr"]) for r in seams.seam_report()}
    assert ("api.services.wisdom.core.private", "put_private") in report
    assert ("api.services.wisdom.core.bars", "session_range") in report   # control: the table still reports


def test_the_default_bar_range_seam_is_absent_so_every_inferred_ticker_is_downgraded(db):
    """⛔ Every other F6 test passes `bar_range=` explicitly, so the PRODUCTION default
    ("auto", through the seam) was covered by nothing. With no core.bars installed the
    seam is None and the verdict must be `no_bar_source` — a not-a-pass."""
    assert writer._bar_range("auto") is None, "core.bars exists now: this rail needs re-deriving"
    seg, src = _loaded()
    rec = make(record_type="CALL", quote="Watching TTTT over 55 for a breakout.", ticker_as_written="WWWT",
               direction="long", stop=52.0)
    with store.write() as conn:
        counts = writer.write_output(conn, segment=seg, source=src, output={"records": [rec]},
                                     extractor_version="v-bars", resolver=RESOLVER, private_put=None,
                                     vocab_names=VOCAB)
    assert counts["inferred_ticker_bar_range:no_bar_source"] == 1
    assert counts["inferred_ticker_review:no_bar_source"] == 1
    with store.read() as conn:
        row, = [dict(r) for r in conn.execute("SELECT * FROM wisdom_records")]
    assert row["record_type"] == "MENTION" and row["entity_id"] is None and row["ticker_inferred"] == 1


# ── Wave 1.5 item 4: the PRINCIPLE/MARKET_SIGNAL shape is a STABILITY lever ──

def _principle(statement):
    return make(record_type="PRINCIPLE", quote="Your stop is your north star.",
                principle={"statement": statement, "category": "risk",
                           "empirical_claim": False, "testable_claim": None})


def test_a_principle_statement_over_thirty_words_is_REJECTED_not_truncated():
    """⛔ OWNER RULING, Wave 1.5 item 4 (2026-09-14): "statement <= 30 words ... one claim per
    record". This is a stability lever, not tidiness: a PRINCIPLE's identity IS its statement
    (`Chunk.key` = (type, normalize_quote_key(statement))), so every extra word is another
    chance for two runs of the same model to disagree about the same teaching. Measured drift
    for PRINCIPLE on 2026-09-14 was 6 of ~30.

    ⛔ REJECTED, never truncated. Cutting at 30 words keeps a fragment and silently discards the
    rest, and the discarded half is invisible afterwards — the record would look well-formed and
    be wrong. A rejection is counted BY NAME and can be re-extracted.
    """
    ok = validate([_principle(" ".join(["word"] * 30))])
    assert ok.counts["kept"] == 1 and not [k for k in ok.counts if k.startswith("reject:")]

    too_long = validate([_principle(" ".join(["word"] * 31))])
    assert too_long.counts["kept"] == 0
    assert too_long.counts["reject:principle_statement_too_long"] == 1


def test_two_claims_in_one_principle_are_REJECTED_so_they_come_back_as_two_records():
    joined = validate([_principle("Cut the loser fast. Then reassess the setup before re-entry.")])
    assert joined.counts["reject:principle_more_than_one_claim"] == 1 and joined.counts["kept"] == 0
    semi = validate([_principle("Cut the loser fast; reassess before re-entry")])
    assert semi.counts["reject:principle_more_than_one_claim"] == 1
    andalso = validate([_principle("Size down in a hostile regime and also stop trading it")])
    assert andalso.counts["reject:principle_more_than_one_claim"] == 1

    # CONTROL — one claim survives, INCLUDING an abbreviation whose dot is not a sentence end.
    # ⚰️ The first version of this check used `[.;]\s+\S` and flagged "i.e." as a second claim,
    # which would have rejected real teachings for containing a shorthand.
    assert validate([_principle("Use the 20 EMA, i.e. the fast one, as the line")]).counts["kept"] == 1
    assert validate([_principle("Your stop is your north star.")]).counts["kept"] == 1


def test_a_market_signal_NAME_that_is_really_a_sentence_is_rejected():
    """R8c: `name` is a short name for the read ("breadth washout"), not a sentence and not the
    quote. Same identity argument as the principle statement — MARKET_SIGNAL's key is its name,
    and it drifted worse than anything else (4 of ~17)."""
    def signal(name):
        return make(record_type="MARKET_SIGNAL", quote="Your stop is your north star.",
                    market_signal={"name": name, "direction": "bearish"})

    assert validate([signal("breadth washout")]).counts["kept"] == 1
    long_name = validate([signal(" ".join(["word"] * 13))])
    assert long_name.counts["reject:market_signal_name_too_long"] == 1 and long_name.counts["kept"] == 0
