"""Two merge gates S-D owes, both asserted over the ROWS THE WRITER PERSISTS
(PROGRAM-MANIFEST §"per-stream Definition of Done", stream S-D).

Synthetic text only (this repository is public); tickers are invented four-letter
symbols, so nothing here names a real call, and no quote comes from a paid session.

1. THE DRIFT-#4 END-TO-END ASSERTION (owner ruling, checkpoint 3). A session
   containing an attendee whose Zoom display name is a CALL author's GIVEN NAME
   must produce ZERO records attributed to that author.
   ⛔ Asserted over WRITTEN RECORDS, not over the resolver. S-B's rail
   (tests/test_wisdom_authors_aliases.py) asserts at the layer that DECIDES
   authorship — the strongest claim available there, and it says so itself. S-D
   owns the record WRITER, so this is the only place the property the owner
   actually asked about can be stated: not "the resolver would say nobody" but
   "no row in wisdom_records carries that author_id".
   ⭐ Not hypothetical: the measured "Zack" control found 142 cues in one session
   colliding on a bare given name, and the collision class has now shipped three
   times (drift #3, drift #4, S-C's `guest:uncharted-territory` minting).

2. F6 — `ticker_inferred` HAS A COLUMN AND NOW HAS A WRITER (CONTRACTS §8a.4).
   An inferred ticker carries ticker_inferred=1, entity_confidence <= 0.5 and
   extraction_confidence='low', and must pass the bar-range sanity check before
   storage — else it is stored as a MENTION with entity_id NULL plus a review item.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
  * a bare given name attributing a written row to a CALL author (any of the four,
    through any of the collision labels DERIVED from authors.json);
  * the writer never attributing anything at all — the control in
    test_the_same_pipeline_does_attribute_a_declared_alias, without which "zero
    rows for tsdr" is satisfied by a pipeline that writes no author on anything;
  * an inferred ticker stored with ticker_inferred=0, a confidence above 0.5, or
    extraction_confidence left high;
  * a FAILING bar-range check stored as a CALL, or with an entity_id, or without a
    review item;
  * an UNCHECKABLE bar-range (no bar source installed) read as a pass;
  * every ticker being called inferred — the discriminator in
    test_a_ticker_its_own_quote_names_is_not_inferred.
"""
from __future__ import annotations

import json
import re

import pytest

from api.services.wisdom.core import authors, store
from api.services.wisdom.extract import prompt, segmenter, writer

# ── the fixture session ──────────────────────────────────────────────────────

ZOOM_TEXT = ("I'm long ZZZT here and the stop is 9.80.\n"
             "Your stop is your north star.\n"
             "Passed on YYYT, too thin.\n")

#: A ticker that only the HEADING names — the §8a.4 "inferred from an adjacent line" case.
SECTION_TEXT = ("WWWT (Daily)\n"
                "Taking it over 55 with the stop at 52.\n"
                "Bought VVVT at 10.50 and I am holding.\n"
                "Nvidia-like action out of it here.\n")

SOURCE = {"source_id": "zsrc", "stream": "zoom_live", "published_at_et": "2026-09-06T08:00:00-04:00",
          "recording_started_at_et": "2026-09-06T08:00:00-04:00", "host_author_id": "tsdr",
          "guest_names_json": "[]"}
VOCAB = {"Range Breakout"}
EXTRACTOR = "wx-v0-aaaaaaaa"


def RESOLVER(ticker, as_of):
    return {"entity_id": f"ent:{ticker}", "confidence": 0.9}


def IN_RANGE(ticker, as_of):
    return {"low": 50.0, "high": 56.0}


def OUT_OF_RANGE(ticker, as_of):
    return {"low": 2.0, "high": 3.00}


def make(**kw):
    rec = {name: None for name in prompt.record_fields()}
    rec.update({"tickers": [], "targets": [], "levels": [], "confidence_language": [], "hindsight": False,
                "extraction_confidence": "high"})
    rec.update(kw)
    return rec


def _segment(ordinal, text, kind="cue_window"):
    """A Zoom cue window with NO resolved author: a multi-attendee call, where the
    speaker label on each record is the only authorship signal there is."""
    return segmenter.Segment(ordinal=ordinal, kind=kind, text=text, char_start=0, char_end=len(text),
                             t_start_s=0.0, t_end_s=60.0,
                             path=None if kind == "cue_window" else "TSDR's Weekly Outlook & Watchlist",
                             author_id=None, speaker_confidence=None)


SEGMENTS = [_segment(0, ZOOM_TEXT), _segment(1, SECTION_TEXT, kind="section")]


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, version, raw_sha256, "
                     "published_at_et, recording_started_at_et, host_author_id, ingest_version, ingested_at) "
                     "VALUES ('zsrc', 'zoom_live', 'test:zoom:1', 1, 'x', '2026-09-06T08:00:00-04:00', "
                     "'2026-09-06T08:00:00-04:00', 'tsdr', 't', 't')")
        segmenter.write_segments(conn, "zsrc", 1, SEGMENTS)
    return tmp_path / "wisdom.db"


def _loaded(ordinal=0):
    with store.read() as conn:
        seg = writer.load_segment(conn, SEGMENTS[ordinal].segment_id("zsrc", 1))
        src = writer.load_source(conn, "zsrc", 1)
    return seg, src


def _write(records, *, ordinal=0, resolver=RESOLVER, bar_range=None, extractor=EXTRACTOR):
    seg, src = _loaded(ordinal)
    with store.write() as conn:
        counts = writer.write_output(conn, segment=seg, source=src, output={"records": records},
                                     extractor_version=extractor, resolver=resolver, private_put=None,
                                     vocab_names=VOCAB, bar_range=bar_range)
    return counts


def _rows(sql="SELECT * FROM wisdom_records"):
    with store.read() as conn:
        return [dict(r) for r in conn.execute(sql)]


def _review_items():
    with store.read() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM wisdom_review_queue")]


# ── 1. drift #4, over written records ────────────────────────────────────────

_ALPHA_TOKEN = re.compile(r"[^\W\d_]+", re.UNICODE)


def collision_labels() -> dict:
    """Every single-token alphabetic label that appears INSIDE a CALL author's own
    display name or aliases and has NOT been argued for in authors.json
    `single_token_aliases_reviewed` — "Patrick" out of "Patrick (TSDR)", "Joe" out of
    "Joe Walburn". DERIVED, never typed: a bare given name added to an alias list
    tomorrow becomes a case here the day it lands."""
    declared = authors.declared_single_token_aliases()
    out: dict = {}
    for author in authors.authors():
        if author.get("can_author_calls") is not True:
            continue
        for label in [author.get("display_name") or ""] + list(author.get("aliases") or []):
            if _ALPHA_TOKEN.fullmatch(label.strip()):
                continue                      # the whole label is one token: it IS the alias
            for token in _ALPHA_TOKEN.findall(label):
                if len(token) > 2 and token.casefold() not in declared:
                    out.setdefault(token, author["author_id"])
    return out


def test_the_collision_set_is_derived_and_contains_the_measured_case():
    """Non-vacuity: an empty set would make every parametrised case below pass by
    never running (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`)."""
    labels = collision_labels()
    assert labels, "derived no collision labels at all — the derivation is broken, not the data"
    assert labels.get("Patrick") == "tsdr", labels


def _attendee_records(label):
    return [
        make(record_type="CALL", quote="I'm long ZZZT here and the stop is 9.80.", speaker_label=label,
             ticker_as_written="ZZZT", direction="long", stop=9.80),
        make(record_type="CALL", quote="I'm long ZZZT here and the stop is 9.80.", speaker_label=label.lower(),
             ticker_as_written="ZZZT", direction="long", stop=9.80),
        make(record_type="PRINCIPLE", quote="Your stop is your north star.", speaker_label=f"  {label}  ",
             principle={"statement": "Respect the stop.", "category": "risk", "empirical_claim": False,
                        "testable_claim": None}),
        make(record_type="NEGATIVE_CALL", quote="Passed on YYYT, too thin.", speaker_label=label.upper(),
             ticker_as_written="YYYT", stance="passed", reason="too thin", reason_class="liquidity"),
    ]


def _assert_no_rows_for(author_id, label):
    _write(_attendee_records(label))
    rows = _rows()
    assert rows, "no records were written at all — the assertion below would pass vacuously"
    attributed = [r["author_id"] for r in rows]
    assert author_id not in attributed, (
        f"an attendee displaying {label!r} produced {attributed.count(author_id)} row(s) for {author_id}")
    assert not (set(attributed) & set(authors.call_authors())), attributed
    # and the CALLs did not survive as CALLs: nobody who is not a CALL author may call.
    assert {r["record_type"] for r in rows} == {"MENTION", "PRINCIPLE"}, [r["record_type"] for r in rows]
    with store.read() as conn:
        principle_authors = [r[0] for r in conn.execute("SELECT author_id FROM wisdom_principles")]
    assert author_id not in principle_authors, principle_authors


def test_an_attendee_called_Patrick_writes_zero_records_for_TSDR(db):
    """⭐ THE OWNER'S NAMED CASE (checkpoint 3), asserted UNCONDITIONALLY.

    Not derived, and deliberately not skippable: the derived sweep below subtracts the
    labels authors.json has argued for, so declaring "Patrick" a reviewed alias would
    quietly remove the measured case from that sweep — which is drift #4's mistake with
    a signature on it. This test cannot be silenced by editing the data; making it pass
    again requires changing the owner's ruling."""
    _assert_no_rows_for("tsdr", "Patrick")


@pytest.mark.parametrize("label", sorted(collision_labels()))
def test_an_attendee_named_like_a_call_author_writes_zero_records_for_that_author(db, label):
    _assert_no_rows_for(collision_labels()[label], label)


def test_the_same_pipeline_does_attribute_a_declared_alias(db):
    """THE CONTROL. Without it, "zero rows for tsdr" is equally satisfied by a writer
    that attributes nothing to anybody, and the rail above would be measuring nothing."""
    _write([make(record_type="CALL", quote="I'm long ZZZT here and the stop is 9.80.",
                 speaker_label="Patrick (TSDR)", ticker_as_written="ZZZT", direction="long", stop=9.80)])
    rows = _rows()
    assert [r["author_id"] for r in rows] == ["tsdr"]
    assert rows[0]["record_type"] == "CALL"


# ── 2. F6: ticker_inferred + the bar-range pass (§8a.4) ──────────────────────

INFERRED_CALL = dict(record_type="CALL", quote="Taking it over 55 with the stop at 52.",
                     speaker_label="Patrick (TSDR)", ticker_as_written="WWWT", direction="long", stop=52.0,
                     targets=[{"price": 55.0, "text": "over 55"}])


def test_an_inferred_ticker_that_passes_the_bar_range_check_is_stored_with_its_required_fields(db):
    counts = _write([make(**INFERRED_CALL)], ordinal=1, bar_range=IN_RANGE)
    assert counts["inferred_ticker_bar_range:pass"] == 1
    row, = _rows()
    assert row["ticker"] == "WWWT"
    assert row["ticker_inferred"] == 1                                   # the column has a writer
    assert row["extraction_confidence"] == writer.INFERRED_EXTRACTION_CONFIDENCE
    assert row["entity_confidence"] is not None                          # not vacuous: 0.9 was CLAMPED
    assert row["entity_confidence"] <= writer.INFERRED_ENTITY_CONFIDENCE_MAX
    assert row["entity_id"] == "ent:WWWT"                                # a pass keeps its entity
    assert row["record_type"] == "CALL"                                  # and is not downgraded
    assert _review_items() == []


def test_an_inferred_ticker_that_fails_the_bar_range_check_is_a_mention_with_no_entity_and_a_review_item(db):
    counts = _write([make(**INFERRED_CALL)], ordinal=1, bar_range=OUT_OF_RANGE)
    assert counts["inferred_ticker_bar_range:out_of_range"] == 1
    assert counts["downgrade:inferred_ticker_not_bar_checked:out_of_range"] == 1
    row, = _rows()
    assert row["record_type"] == "MENTION"
    assert row["entity_id"] is None and row["entity_confidence"] is None
    assert row["ticker_inferred"] == 1 and row["ticker"] == "WWWT"
    assert row["extraction_confidence"] == writer.INFERRED_EXTRACTION_CONFIDENCE

    item, = _review_items()
    assert item["tab"] == "extraction_audit" and item["status"] == "open"
    assert item["subject_ref"] == f"record:{row['record_id']}"
    evidence = json.loads(item["evidence_json"])
    assert evidence["bar_verdict"] == "out_of_range" and evidence["ticker"] == "WWWT"
    assert evidence["model_record_type"] == "CALL" and evidence["stored_record_type"] == "MENTION"
    # quote-free: the queue carries a locator, never the sentence.
    assert "Taking it over 55" not in json.dumps(item, default=str)


def test_a_bar_range_that_cannot_be_read_is_not_a_pass(db):
    """⛔ With no bar source installed the check cannot run, and "could not be read" is
    not "was verified" — otherwise §8a.4 is inert on the day it ships, which is F6
    itself. The verdict NAMES the case, so it never reads as a range mismatch."""
    counts = _write([make(**INFERRED_CALL)], ordinal=1, bar_range=None)
    assert counts["inferred_ticker_bar_range:no_bar_source"] == 1
    assert counts["inferred_ticker_review:no_bar_source"] == 1
    row, = _rows()
    assert row["record_type"] == "MENTION" and row["entity_id"] is None and row["ticker_inferred"] == 1
    assert json.loads(_review_items()[0]["evidence_json"])["bar_verdict"] == "no_bar_source"


def test_a_ticker_its_own_quote_names_is_not_inferred(db):
    """THE DISCRIMINATOR. A rule that calls every ticker inferred would satisfy every
    assertion above while destroying the catalog."""
    counts = _write([make(record_type="CALL", quote="Bought VVVT at 10.50 and I am holding.",
                          speaker_label="Patrick (TSDR)", ticker_as_written="VVVT", direction="long",
                          stance="taking", entry=10.50, stop=9.0)],
                    ordinal=1, bar_range=OUT_OF_RANGE)
    assert "ticker_inferred" not in counts
    row, = _rows()
    assert row["ticker_inferred"] == 0
    assert row["extraction_confidence"] == "high"          # untouched
    assert row["entity_confidence"] == 0.9                 # unclamped
    assert row["record_type"] == "CALL" and row["entity_id"] == "ent:VVVT"
    assert _review_items() == []


def test_a_ticker_spoken_as_a_word_is_not_inferred_when_the_quote_carries_that_word():
    """R9 puts the spoken form in ticker_as_heard. "Nvidia-like action" is a company
    name in the quote, not a ticker taken from an adjacent line."""
    assert writer.ticker_is_inferred("Nvidia-like action out of it here.", "NVDX", "Nvidia") is False
    assert writer.ticker_is_inferred("Nvidia-like action out of it here.", "NVDX", None) is True
    assert writer.ticker_is_inferred("Taking $WWWT over 55.", "WWWT", None) is False
    assert writer.ticker_is_inferred("WWWTX is extended.", "WWWT", None) is True   # word boundary
    assert writer.ticker_is_inferred("Taking it over 55.", None, None) is False    # no ticker, no claim


def test_the_bar_range_verdict_names_every_case_it_can_return():
    assert writer.bar_range_verdict("WWWT", [], "2026-09-06", IN_RANGE) == "no_stated_price"
    assert writer.bar_range_verdict("WWWT", [52.0], "2026-09-06", None) == "no_bar_source"
    assert writer.bar_range_verdict("WWWT", [52.0], "2026-09-06", lambda t, a: None) == "no_bars"
    assert writer.bar_range_verdict("WWWT", [52.0], "2026-09-06",
                                    lambda t, a: (_ for _ in ()).throw(RuntimeError("boom"))) == "bar_lookup_failed"
    assert writer.bar_range_verdict("WWWT", [52.0, 55.0], "2026-09-06", IN_RANGE) == "pass"
    assert writer.bar_range_verdict("WWWT", [52.0, 900.0], "2026-09-06", IN_RANGE) == "out_of_range"
    assert set(writer.BAR_VERDICTS) == {"pass", "out_of_range", "no_stated_price", "no_bar_source", "no_bars",
                                        "bar_lookup_failed"}
